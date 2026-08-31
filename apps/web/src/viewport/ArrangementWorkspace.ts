import * as THREE from "three";
import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";
import { anchorById } from "../avatar/AvatarParametricModel";
import {
  raycastBodySurface,
  resolveBodySurfaceAttachment,
  type BodySurfaceFrame,
} from "../avatar/BodySurfaceQuery";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import type { PatternPreviewPlacement } from "../domain/pattern";
import type { PanelArrangementAnchorV3 } from "../domain/patternDocumentV3.types";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";

export type ArrangementVisualState = "POSICIONAR" | "AJUSTADO" | "SIMULADO";

export interface ArrangementTransform {
  positionM: [number, number, number];
  orientationDeg: [number, number, number];
}

export interface ArrangementCommit {
  instanceId: string;
  positionMm: [number, number, number];
  orientationDeg: [number, number, number];
  surfaceAttachment?: NonNullable<PanelArrangementAnchorV3["surfaceAttachment"]>;
}

export interface SurfaceCandidatePolicy {
  enterDistanceM: number;
  exitDistanceM: number;
  maxCandidateJumpM: number;
}

export interface SurfaceConformOptions {
  clearanceMm?: number;
  maximumMetricDistortion?: number;
  minimumProjectedVertexRatio?: number;
}

export interface SurfaceConformResult {
  conformed: boolean;
  metricDistortionMax: number;
  minimumClearanceMm: number;
  projectedVertexRatio: number;
  reason?: "surface-unavailable" | "coverage" | "metric" | "clearance";
}

export const DEFAULT_SURFACE_CANDIDATE_POLICY: SurfaceCandidatePolicy = {
  enterDistanceM: 0.16,
  exitDistanceM: 0.24,
  maxCandidateJumpM: 0.14,
};

export function arrangementVisualState(
  placement: PatternPreviewPlacement | undefined,
  simulated: boolean,
): ArrangementVisualState {
  if (simulated) return "SIMULADO";
  return placement?.presentationMode === "authored" ? "AJUSTADO" : "POSICIONAR";
}

export function createCameraDragPlane(
  grabPointWorld: THREE.Vector3,
  cameraDirectionWorld: THREE.Vector3,
): THREE.Plane {
  const normal = cameraDirectionWorld.clone();
  if (normal.lengthSq() <= 1e-12) normal.set(0, 0, -1);
  normal.normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, grabPointWorld);
}

export function intersectPointerRayWithDragPlane(
  ray: THREE.Ray,
  plane: THREE.Plane,
): THREE.Vector3 | null {
  return ray.intersectPlane(plane, new THREE.Vector3());
}

export function updateSurfaceCandidate(
  previous: BodySurfaceFrame | undefined,
  next: BodySurfaceFrame | null,
  freeGrabPointWorld: THREE.Vector3,
  policy: SurfaceCandidatePolicy = DEFAULT_SURFACE_CANDIDATE_POLICY,
): BodySurfaceFrame | undefined {
  const previousPosition = previous ? new THREE.Vector3(...previous.position) : null;
  const nextPosition = next ? new THREE.Vector3(...next.position) : null;
  const previousDistance = previousPosition?.distanceTo(freeGrabPointWorld) ?? Number.POSITIVE_INFINITY;
  const nextDistance = nextPosition?.distanceTo(freeGrabPointWorld) ?? Number.POSITIVE_INFINITY;

  if (!previous) {
    return next && nextDistance <= policy.enterDistanceM ? next : undefined;
  }

  if (next && nextDistance <= policy.exitDistanceM && nextPosition && previousPosition) {
    const candidateJump = nextPosition.distanceTo(previousPosition);
    if (candidateJump <= policy.maxCandidateJumpM || previousDistance > policy.exitDistanceM) return next;
  }

  if (previousDistance <= policy.exitDistanceM) return previous;
  return next && nextDistance <= policy.enterDistanceM ? next : undefined;
}

export function resolveArrangementTransform(
  placement: PatternPreviewPlacement,
  avatar: AvatarParametricModel,
): ArrangementTransform {
  if (placement.surfaceAttachment) {
    const frame = resolveBodySurfaceAttachment(avatar.humanBody.visualMesh, placement.surfaceAttachment);
    if (frame) {
      return {
        positionM: frame.position,
        orientationDeg: placement.orientationDeg ?? frameEulerDeg(frame.tangent, frame.axis, frame.outwardNormal),
      };
    }
  }
  if (placement.positionMm) {
    return {
      positionM: placement.positionMm.map((value) => value * 0.001) as [number, number, number],
      orientationDeg: placement.orientationDeg ?? [0, 0, placement.rotationDeg],
    };
  }
  if (placement.bodyAnchorId) {
    const anchor = anchorById(avatar, placement.bodyAnchorId);
    if (anchor) {
      const position = new THREE.Vector3(...anchor.position)
        .addScaledVector(new THREE.Vector3(...anchor.tangent), placement.offsetXMm * 0.001)
        .addScaledVector(new THREE.Vector3(...anchor.axis), placement.offsetYMm * 0.001)
        .addScaledVector(
          new THREE.Vector3(...anchor.outwardNormal),
          anchor.initialMarginM + placement.offsetZMm * 0.001,
        );
      return {
        positionM: [position.x, position.y, position.z],
        orientationDeg: placement.orientationDeg
          ?? frameEulerDeg(anchor.tangent, anchor.axis, anchor.outwardNormal, placement.rotationDeg),
      };
    }
  }
  return {
    positionM: (placement.positionMm ?? [-900, 1_350, 0]).map((value) => value * 0.001) as [number, number, number],
    orientationDeg: placement.orientationDeg ?? [0, 0, 0],
  };
}

export function placeMeshCentroid(
  mesh: THREE.Mesh,
  transform: ArrangementTransform,
): void {
  mesh.geometry.computeBoundingBox();
  const localCenter = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  mesh.quaternion.setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(transform.orientationDeg[0]),
    THREE.MathUtils.degToRad(transform.orientationDeg[1]),
    THREE.MathUtils.degToRad(transform.orientationDeg[2]),
    "XYZ",
  ));
  const rotatedCenter = localCenter.clone().applyQuaternion(mesh.quaternion);
  mesh.position.set(...transform.positionM).sub(rotatedCenter);
  mesh.scale.setScalar(1);
  mesh.updateMatrixWorld(true);
}

export function restoreMeshMaterialGeometry(
  mesh: THREE.Mesh,
  positions: Float32Array,
): void {
  const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  if (attribute.count * 3 !== positions.length) return;
  (attribute.array as Float32Array).set(positions);
  attribute.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

/**
 * One-shot geometric body conform used only after a placement gesture or an
 * explicit Adjust action. It never runs XPBD. The panel is first placed in a
 * rigid tangent pose with positive body-normal clearance. A local projection
 * is accepted only if edge metric and clearance remain inside the gate;
 * otherwise the rigid external pose is preserved.
 */
export function adjustMeshToBodySurface(
  mesh: THREE.Mesh,
  body: HumanBodyMesh,
  attachmentValue: NonNullable<PanelArrangementAnchorV3["surfaceAttachment"]>,
  materialReferencePositions?: Float32Array,
  options: SurfaceConformOptions = {},
): SurfaceConformResult {
  const clearanceMm = Math.max(1, options.clearanceMm ?? attachmentValue.normalOffsetMm ?? 12);
  const maximumMetricDistortion = options.maximumMetricDistortion ?? 0.008;
  const minimumProjectedVertexRatio = options.minimumProjectedVertexRatio ?? 0.65;
  const attachment = { ...attachmentValue, normalOffsetMm: clearanceMm };
  const frame = resolveBodySurfaceAttachment(body, attachment);
  if (!frame) {
    return {
      conformed: false,
      metricDistortionMax: 0,
      minimumClearanceMm: 0,
      projectedVertexRatio: 0,
      reason: "surface-unavailable",
    };
  }

  if (materialReferencePositions) restoreMeshMaterialGeometry(mesh, materialReferencePositions);
  alignMeshToSurfaceFrame(mesh, frame);

  const positionAttribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const positions = positionAttribute.array as Float32Array;
  const rigidPositions = new Float32Array(positions);
  const metricReference = materialReferencePositions && materialReferencePositions.length === positions.length
    ? materialReferencePositions
    : rigidPositions;
  const bodyNormal = new THREE.Vector3(...frame.outwardNormal).normalize();
  let projected = 0;
  let minimumClearanceMm = Number.POSITIVE_INFINITY;
  const world = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const localTarget = new THREE.Vector3();

  mesh.updateMatrixWorld(true);
  for (let index = 0; index < positionAttribute.count; index += 1) {
    world.fromBufferAttribute(positionAttribute, index).applyMatrix4(mesh.matrixWorld);
    rayOrigin.copy(world).addScaledVector(bodyNormal, 0.35);
    const hit = raycastBodySurface(
      body,
      [rayOrigin.x, rayOrigin.y, rayOrigin.z],
      [-bodyNormal.x, -bodyNormal.y, -bodyNormal.z],
      clearanceMm,
      0.7,
    );
    if (!hit) continue;
    const target = new THREE.Vector3(...hit.position);
    if (target.distanceTo(world) > 0.22) continue;
    localTarget.copy(target);
    mesh.worldToLocal(localTarget);
    positions[index * 3] = localTarget.x;
    positions[index * 3 + 1] = localTarget.y;
    positions[index * 3 + 2] = localTarget.z;
    const hitNormal = new THREE.Vector3(...hit.outwardNormal);
    const surfacePoint = target.clone().addScaledVector(hitNormal, -hit.attachment.normalOffsetMm * 0.001);
    minimumClearanceMm = Math.min(
      minimumClearanceMm,
      target.clone().sub(surfacePoint).dot(hitNormal) * 1_000,
    );
    projected += 1;
  }

  const projectedVertexRatio = positionAttribute.count > 0 ? projected / positionAttribute.count : 0;
  positionAttribute.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  const metricDistortionMax = maximumEdgeMetricDistortion(mesh.geometry, metricReference, positions);
  const clearanceValid = Number.isFinite(minimumClearanceMm) && minimumClearanceMm >= clearanceMm * 0.5;
  const coverageValid = projectedVertexRatio >= minimumProjectedVertexRatio;
  const metricValid = metricDistortionMax <= maximumMetricDistortion;

  if (!coverageValid || !metricValid || !clearanceValid) {
    positions.set(rigidPositions);
    positionAttribute.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.updateMatrixWorld(true);
    return {
      conformed: false,
      metricDistortionMax,
      minimumClearanceMm: Number.isFinite(minimumClearanceMm) ? minimumClearanceMm : clearanceMm,
      projectedVertexRatio,
      reason: !coverageValid ? "coverage" : !metricValid ? "metric" : "clearance",
    };
  }

  mesh.updateMatrixWorld(true);
  return {
    conformed: true,
    metricDistortionMax,
    minimumClearanceMm,
    projectedVertexRatio,
  };
}

export function captureMeshArrangement(
  instanceId: string,
  mesh: THREE.Mesh,
  surfaceAttachment?: ArrangementCommit["surfaceAttachment"],
): ArrangementCommit {
  mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  mesh.localToWorld(center);
  const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, "XYZ");
  return {
    instanceId,
    positionMm: [center.x * 1_000, center.y * 1_000, center.z * 1_000],
    orientationDeg: [
      THREE.MathUtils.radToDeg(euler.x),
      THREE.MathUtils.radToDeg(euler.y),
      THREE.MathUtils.radToDeg(euler.z),
    ],
    ...(surfaceAttachment ? { surfaceAttachment: structuredClone(surfaceAttachment) } : {}),
  };
}

/** Applies authored rigid poses to STEP 0 without changing material lengths. */
export function applyAuthoredArrangementToAssemblyState(
  state: GarmentAssemblyState,
  input: ResolvedAssemblyInput,
  avatar: AvatarParametricModel,
): void {
  const placements = new Map(
    input.garmentProjection.pieces.flatMap((piece) =>
      (piece.previewPlacements ?? []).map((placement) => [placement.id, placement] as const),
    ),
  );
  for (const instance of state.instances) {
    const placement = placements.get(instance.id);
    if (!placement || placement.presentationMode !== "authored") continue;
    const transform = resolveArrangementTransform(placement, avatar);
    const start = instance.particleStart;
    const count = instance.vertexCount;
    if (count === 0) continue;
    const center = assemblyInstanceCentroid(state.positions, start, count);
    const currentOrientation = materialFrameQuaternion(state.positions, instance);
    const targetOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(transform.orientationDeg[0]),
      THREE.MathUtils.degToRad(transform.orientationDeg[1]),
      THREE.MathUtils.degToRad(transform.orientationDeg[2]),
      "XYZ",
    ));
    const rotation = targetOrientation.multiply(currentOrientation.invert());
    for (const buffer of [state.positions, state.initialPositions, state.previousPositions]) {
      for (let local = 0; local < count; local += 1) {
        const offset = (start + local) * 3;
        const point = new THREE.Vector3(buffer[offset], buffer[offset + 1], buffer[offset + 2])
          .sub(center)
          .applyQuaternion(rotation)
          .add(new THREE.Vector3(...transform.positionM));
        buffer[offset] = point.x;
        buffer[offset + 1] = point.y;
        buffer[offset + 2] = point.z;
      }
    }
  }
}

function alignMeshToSurfaceFrame(mesh: THREE.Mesh, frame: BodySurfaceFrame): void {
  const bodyNormal = new THREE.Vector3(...frame.outwardNormal).normalize();
  const tangent = new THREE.Vector3(...frame.tangent).normalize();
  const currentNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).normalize();
  const parity = currentNormal.dot(bodyNormal) < 0 ? -1 : 1;
  const panelNormal = bodyNormal.clone().multiplyScalar(parity);
  const axis = new THREE.Vector3().crossVectors(panelNormal, tangent).normalize();
  const currentX = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
  currentX.addScaledVector(bodyNormal, -currentX.dot(bodyNormal));
  const roll = currentX.lengthSq() > 1e-12
    ? Math.atan2(currentX.normalize().dot(axis), currentX.dot(tangent))
    : 0;
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(tangent, axis, panelNormal),
  );
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  mesh.geometry.computeBoundingBox();
  const localCenter = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  mesh.quaternion.copy(quaternion);
  const rotatedCenter = localCenter.clone().applyQuaternion(mesh.quaternion);
  mesh.position.set(...frame.position).sub(rotatedCenter);
  mesh.scale.setScalar(1);
  mesh.updateMatrixWorld(true);
}

function maximumEdgeMetricDistortion(
  geometry: THREE.BufferGeometry,
  referencePositions: Float32Array,
  candidatePositions: Float32Array,
): number {
  if (referencePositions.length !== candidatePositions.length) return Number.POSITIVE_INFINITY;
  const edges = uniqueGeometryEdges(geometry);
  let maximum = 0;
  for (const [first, second] of edges) {
    const referenceLength = pointDistance(referencePositions, first, second);
    if (referenceLength <= 1e-9) continue;
    const candidateLength = pointDistance(candidatePositions, first, second);
    maximum = Math.max(maximum, Math.abs(candidateLength / referenceLength - 1));
  }
  return maximum;
}

function uniqueGeometryEdges(geometry: THREE.BufferGeometry): Array<[number, number]> {
  const positionCount = geometry.getAttribute("position").count;
  const index = geometry.index;
  const edgeKeys = new Set<string>();
  const edges: Array<[number, number]> = [];
  const add = (firstValue: number, secondValue: number) => {
    const first = Math.min(firstValue, secondValue);
    const second = Math.max(firstValue, secondValue);
    const key = `${first}:${second}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push([first, second]);
  };
  const triangleCount = index ? index.count / 3 : Math.floor(positionCount / 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = index ? index.getX(triangle * 3) : triangle * 3;
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    add(a, b);
    add(b, c);
    add(c, a);
  }
  return edges;
}

function pointDistance(values: Float32Array, first: number, second: number): number {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  return Math.hypot(
    values[firstOffset] - values[secondOffset],
    values[firstOffset + 1] - values[secondOffset + 1],
    values[firstOffset + 2] - values[secondOffset + 2],
  );
}

function assemblyInstanceCentroid(
  positions: Float32Array,
  start: number,
  count: number,
): THREE.Vector3 {
  const center = new THREE.Vector3();
  for (let local = 0; local < count; local += 1) {
    const offset = (start + local) * 3;
    center.x += positions[offset];
    center.y += positions[offset + 1];
    center.z += positions[offset + 2];
  }
  return center.multiplyScalar(1 / count);
}

function materialFrameQuaternion(
  positions: Float32Array,
  instance: GarmentAssemblyState["instances"][number],
): THREE.Quaternion {
  const center = assemblyInstanceCentroid(positions, instance.particleStart, instance.vertexCount);
  const material = instance.topology.positions2DMm;
  let meanU = 0;
  let meanV = 0;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    meanU += material[local * 2];
    meanV += material[local * 2 + 1];
  }
  meanU /= instance.vertexCount;
  meanV /= instance.vertexCount;
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const point = new THREE.Vector3(positions[offset], positions[offset + 1], positions[offset + 2]).sub(center);
    x.addScaledVector(point, material[local * 2] - meanU);
    y.addScaledVector(point, material[local * 2 + 1] - meanV);
  }
  if (x.lengthSq() <= 1e-12) x.set(1, 0, 0);
  x.normalize();
  y.addScaledVector(x, -y.dot(x));
  if (y.lengthSq() <= 1e-12) y.set(0, 1, 0);
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function frameEulerDeg(
  tangentValue: readonly [number, number, number],
  axisValue: readonly [number, number, number],
  normalValue: readonly [number, number, number],
  rollDeg = 0,
): [number, number, number] {
  const tangent = new THREE.Vector3(...tangentValue).normalize();
  const axis = new THREE.Vector3(...axisValue).normalize();
  const normal = new THREE.Vector3(...normalValue).normalize();
  const basis = new THREE.Matrix4().makeBasis(tangent, axis, normal);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(rollDeg)));
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ];
}
