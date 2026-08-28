import type { BodyAnchorId } from "../domain/pattern";
import type { AvatarParametricModel, AvatarVector3 } from "./AvatarParametricModel";
import type { HumanBodyLandmarkId, HumanBodyRegionId, HumanBodyVector3 } from "./HumanBodyModel";

export type BodyProjectionView = "front" | "back" | "left" | "right";

export interface BodyProjectionPoint2D {
  xMm: number;
  yMm: number;
}

export interface BodyProjectionSegment2D {
  start: BodyProjectionPoint2D;
  end: BodyProjectionPoint2D;
}

export interface BodyProjectionLandmark2D extends BodyProjectionPoint2D {
  id: HumanBodyLandmarkId;
}

export interface BodyProjectionAnchor2D extends BodyProjectionPoint2D {
  id: BodyAnchorId;
  facing: number;
}

export interface BodyProjectionRegion2D extends BodyProjectionPoint2D {
  id: HumanBodyRegionId;
}

export interface BodyProjection2D {
  view: BodyProjectionView;
  silhouette: BodyProjectionSegment2D[];
  landmarks: BodyProjectionLandmark2D[];
  anchors: BodyProjectionAnchor2D[];
  regions: BodyProjectionRegion2D[];
  boundsMm: { minX: number; minY: number; maxX: number; maxY: number };
  sourceTopologySignature: string;
}

interface EdgeFaces {
  a: number;
  b: number;
  facing: number[];
}

export function projectAvatarBody2D(
  avatar: AvatarParametricModel,
  view: BodyProjectionView,
): BodyProjection2D {
  const mesh = avatar.humanBody.visualMesh;
  const viewDirection = projectionViewDirection(view);
  const edgeFaces = new Map<string, EdgeFaces>();

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index];
    const b = mesh.indices[index + 1];
    const c = mesh.indices[index + 2];
    const normal = triangleNormal(mesh.positions, a, b, c);
    const facing = dot3(normal, viewDirection);
    addEdge(edgeFaces, a, b, facing);
    addEdge(edgeFaces, b, c, facing);
    addEdge(edgeFaces, c, a, facing);
  }

  const silhouette: BodyProjectionSegment2D[] = [];
  for (const edge of edgeFaces.values()) {
    const crossesSilhouette = edge.facing.length === 1
      || (Math.min(...edge.facing) <= 0 && Math.max(...edge.facing) >= 0);
    if (!crossesSilhouette) continue;
    silhouette.push({
      start: projectPoint(vertex(mesh.positions, edge.a), view),
      end: projectPoint(vertex(mesh.positions, edge.b), view),
    });
  }

  const landmarks = Object.values(avatar.humanBody.landmarks)
    .map((landmark) => ({ id: landmark.id, ...projectPoint(landmark.position, view) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const toCamera: AvatarVector3 = [-viewDirection[0], -viewDirection[1], -viewDirection[2]];
  const anchors = avatar.anchors
    .filter((anchor): anchor is typeof anchor & { id: BodyAnchorId } => anchor.id !== "head")
    .map((anchor) => ({
      id: anchor.id,
      ...projectPoint(anchor.position, view),
      facing: dot3(anchor.outwardNormal, toCamera),
    }));
  const regions = avatar.humanBody.surfaceRegions.map((region) => {
    const center: HumanBodyVector3 = [0, 0, 0];
    let weight = 0;
    for (let index = 0; index < region.visualVertexIndices.length; index += 1) {
      const vertexIndex = region.visualVertexIndices[index];
      const vertexWeight = region.visualWeights[index] ?? 1;
      const point = vertex(mesh.positions, vertexIndex);
      center[0] += point[0] * vertexWeight;
      center[1] += point[1] * vertexWeight;
      center[2] += point[2] * vertexWeight;
      weight += vertexWeight;
    }
    if (weight > 0) {
      center[0] /= weight;
      center[1] /= weight;
      center[2] /= weight;
    }
    return { id: region.id, ...projectPoint(center, view) };
  });
  const projectedVertices = Array.from({ length: mesh.positions.length / 3 }, (_, index) => projectPoint(vertex(mesh.positions, index), view));
  const xs = projectedVertices.map((point) => point.xMm);
  const ys = projectedVertices.map((point) => point.yMm);

  return {
    view,
    silhouette,
    landmarks,
    anchors,
    regions,
    boundsMm: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    sourceTopologySignature: mesh.topologySignature,
  };
}

export function projectPoint(point: readonly [number, number, number], view: BodyProjectionView): BodyProjectionPoint2D {
  const xM = view === "front" ? point[0]
    : view === "back" ? -point[0]
      : view === "left" ? point[2]
        : -point[2];
  return { xMm: xM * 1000, yMm: -point[1] * 1000 };
}

export function projectionViewDirection(view: BodyProjectionView): AvatarVector3 {
  if (view === "front") return [0, 0, -1];
  if (view === "back") return [0, 0, 1];
  if (view === "left") return [1, 0, 0];
  return [-1, 0, 0];
}

function addEdge(edges: Map<string, EdgeFaces>, first: number, second: number, facing: number): void {
  const a = Math.min(first, second);
  const b = Math.max(first, second);
  const key = `${a}:${b}`;
  const edge = edges.get(key) ?? { a, b, facing: [] };
  edge.facing.push(facing);
  edges.set(key, edge);
}

function vertex(positions: Float32Array, index: number): HumanBodyVector3 {
  const offset = index * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function triangleNormal(positions: Float32Array, a: number, b: number, c: number): HumanBodyVector3 {
  const first = vertex(positions, a);
  const second = vertex(positions, b);
  const third = vertex(positions, c);
  const ab: HumanBodyVector3 = [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
  const ac: HumanBodyVector3 = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
  const normal: HumanBodyVector3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal);
  return length <= 1e-12 ? [0, 0, 0] : [normal[0] / length, normal[1] / length, normal[2] / length];
}

function dot3(first: readonly number[], second: readonly number[]): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}
