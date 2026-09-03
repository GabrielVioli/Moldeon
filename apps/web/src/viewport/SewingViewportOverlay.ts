import * as THREE from "three";
import type { EdgeRange } from "../domain/pattern";
import type { AssemblyStitchConstraint, GarmentAssemblyState, GlobalPointReference } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";

export interface SewingOverlaySelection {
  first: readonly EdgeRange[];
  second: readonly EdgeRange[];
}

interface EdgeSegment {
  mesh: GarmentAssemblyMeshData;
  edge: EdgeRange;
  firstVertex: number;
  secondVertex: number;
}

interface ThreadSegment {
  constraint: AssemblyStitchConstraint;
  firstMesh: GarmentAssemblyMeshData;
  secondMesh: GarmentAssemblyMeshData;
  firstParticleStart: number;
  secondParticleStart: number;
  proposal: boolean;
}

const EDGE_COLOR = new THREE.Color(0x46cfe8);
const FIRST_COLOR = new THREE.Color(0xff5b66);
const SECOND_COLOR = new THREE.Color(0x54a8ff);
const HOVER_COLOR = new THREE.Color(0xffffff);
const THREAD_COLOR = new THREE.Color(0xe6d33e);
const PROPOSAL_THREAD_COLOR = new THREE.Color(0x53ffd0);

export class SewingViewportOverlay {
  readonly group = new THREE.Group();
  readonly edgeLines = createLines(0.95);
  readonly threadLines = createLines(0.78);
  private edgeSegments: EdgeSegment[] = [];
  private threadSegments: ThreadSegment[] = [];
  private selection: SewingOverlaySelection = { first: [], second: [] };
  private hoveredKey: string | null = null;

  constructor() {
    this.group.name = "sewing-overlay";
    this.edgeLines.name = "sewing-edge-overlay";
    this.threadLines.name = "sewing-thread-overlay";
    this.edgeLines.renderOrder = 80;
    this.threadLines.renderOrder = 79;
    this.group.add(this.edgeLines, this.threadLines);
  }

  rebuild(
    meshes: readonly GarmentAssemblyMeshData[],
    state: GarmentAssemblyState | null,
    selection: SewingOverlaySelection,
    proposalConstraints: readonly AssemblyStitchConstraint[] = [],
  ): void {
    this.selection = selection;
    this.edgeSegments = buildEdgeSegments(meshes);
    this.threadSegments = state
      ? buildThreadSegments(meshes, state, proposalConstraints)
      : [];
    resetGeometry(this.edgeLines.geometry, this.edgeSegments.length);
    resetGeometry(this.threadLines.geometry, this.threadSegments.length);
    this.refreshPositions();
    this.refreshColors();
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setHovered(segmentIndex: number | null): void {
    const segment = segmentIndex === null ? undefined : this.edgeSegments[segmentIndex];
    const key = segment ? edgeKey(segment.edge, segment.mesh.key) : null;
    if (key === this.hoveredKey) return;
    this.hoveredKey = key;
    this.refreshColors();
  }

  edgeAtIntersection(intersection: THREE.Intersection): { range: EdgeRange; panelInstanceId: string; segmentIndex: number } | null {
    if (intersection.object !== this.edgeLines || intersection.index === undefined) return null;
    const segmentIndex = Math.floor(intersection.index / 2);
    const segment = this.edgeSegments[segmentIndex];
    return segment ? {
      range: { ...segment.edge, startT: 0, endT: 1 },
      panelInstanceId: segment.mesh.key,
      segmentIndex,
    } : null;
  }

  refreshPositions(): void {
    writeEdgePositions(this.edgeLines.geometry, this.edgeSegments);
    writeThreadPositions(this.threadLines.geometry, this.threadSegments);
  }

  dispose(): void {
    this.edgeLines.geometry.dispose();
    this.threadLines.geometry.dispose();
    (this.edgeLines.material as THREE.Material).dispose();
    (this.threadLines.material as THREE.Material).dispose();
    this.group.clear();
  }

  private refreshColors(): void {
    const edgeColors = this.edgeLines.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let index = 0; index < this.edgeSegments.length; index += 1) {
      const segment = this.edgeSegments[index];
      const key = edgeKey(segment.edge, segment.mesh.key);
      const color = key === this.hoveredKey
        ? HOVER_COLOR
        : matchesAny(segment.edge, this.selection.first)
          ? FIRST_COLOR
          : matchesAny(segment.edge, this.selection.second)
            ? SECOND_COLOR
            : EDGE_COLOR;
      writeSegmentColor(edgeColors, index, color);
    }
    edgeColors.needsUpdate = true;

    const threadColors = this.threadLines.geometry.getAttribute("color") as THREE.BufferAttribute;
    this.threadSegments.forEach((segment, index) => writeSegmentColor(
      threadColors,
      index,
      segment.proposal ? PROPOSAL_THREAD_COLOR : THREAD_COLOR,
    ));
    threadColors.needsUpdate = true;
  }
}

function buildEdgeSegments(meshes: readonly GarmentAssemblyMeshData[]): EdgeSegment[] {
  const result: EdgeSegment[] = [];
  for (const mesh of meshes) {
    const byEdge = new Map<string, Array<{ vertex: number; t: number }>>();
    for (const source of mesh.vertexSources) {
      const edgeId = source.edgeId ?? source.sourceSegmentId;
      if (!edgeId || source.t === undefined) continue;
      const samples = byEdge.get(edgeId) ?? [];
      samples.push({ vertex: source.meshVertexIndex, t: source.t });
      byEdge.set(edgeId, samples);
    }
    for (const [edgeId, raw] of byEdge) {
      const samples = raw
        .sort((left, right) => left.t - right.t || left.vertex - right.vertex)
        .filter((sample, index, all) => index === 0 || sample.vertex !== all[index - 1].vertex);
      for (let index = 1; index < samples.length; index += 1) {
        result.push({
          mesh,
          edge: { pieceId: mesh.sourcePatternId, edgeId, startT: samples[index - 1].t, endT: samples[index].t },
          firstVertex: samples[index - 1].vertex,
          secondVertex: samples[index].vertex,
        });
      }
    }
  }
  return result;
}

function buildThreadSegments(
  meshes: readonly GarmentAssemblyMeshData[],
  state: GarmentAssemblyState,
  proposalConstraints: readonly AssemblyStitchConstraint[],
): ThreadSegment[] {
  const meshById = new Map(meshes.map((mesh) => [mesh.key, mesh]));
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  return [...state.stitchConstraints.map((constraint) => ({ constraint, proposal: false })),
    ...proposalConstraints.map((constraint) => ({ constraint, proposal: true }))]
    .flatMap(({ constraint, proposal }) => {
      if (!constraint.instanceA || !constraint.instanceB || constraint.seamGroupId.startsWith("dart:")) return [];
      const firstMesh = meshById.get(constraint.instanceA);
      const secondMesh = meshById.get(constraint.instanceB);
      const firstInstance = instanceById.get(constraint.instanceA);
      const secondInstance = instanceById.get(constraint.instanceB);
      if (!firstMesh || !secondMesh || !firstInstance || !secondInstance) return [];
      return [{ constraint, proposal, firstMesh, secondMesh, firstParticleStart: firstInstance.particleStart, secondParticleStart: secondInstance.particleStart }];
    });
}

function writeEdgePositions(geometry: THREE.BufferGeometry, segments: readonly EdgeSegment[]): void {
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  segments.forEach((segment, index) => {
    segment.mesh.mesh.updateMatrixWorld(true);
    writeVertex(attribute, index * 2, segment.mesh, segment.firstVertex);
    writeVertex(attribute, index * 2 + 1, segment.mesh, segment.secondVertex);
  });
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function writeThreadPositions(geometry: THREE.BufferGeometry, segments: readonly ThreadSegment[]): void {
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  segments.forEach((segment, index) => {
    segment.firstMesh.mesh.updateMatrixWorld(true);
    segment.secondMesh.mesh.updateMatrixWorld(true);
    writeReference(attribute, index * 2, segment.firstMesh, segment.firstParticleStart, segment.constraint.a);
    writeReference(attribute, index * 2 + 1, segment.secondMesh, segment.secondParticleStart, segment.constraint.b);
  });
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function writeVertex(attribute: THREE.BufferAttribute, targetIndex: number, mesh: GarmentAssemblyMeshData, vertexIndex: number): void {
  const source = mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3().fromBufferAttribute(source, vertexIndex).applyMatrix4(mesh.mesh.matrixWorld);
  attribute.setXYZ(targetIndex, point.x, point.y, point.z);
}

function writeReference(
  attribute: THREE.BufferAttribute,
  targetIndex: number,
  mesh: GarmentAssemblyMeshData,
  particleStart: number,
  reference: GlobalPointReference,
): void {
  const source = mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const sample = new THREE.Vector3();
  reference.particleIndices.forEach((particleIndex, index) => {
    sample.fromBufferAttribute(source, particleIndex - particleStart);
    point.addScaledVector(sample, reference.weights[index] ?? 0);
  });
  point.applyMatrix4(mesh.mesh.matrixWorld);
  attribute.setXYZ(targetIndex, point.x, point.y, point.z);
}

function resetGeometry(geometry: THREE.BufferGeometry, segmentCount: number): void {
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segmentCount * 6), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(segmentCount * 6), 3));
  geometry.setDrawRange(0, segmentCount * 2);
}

function createLines(opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  resetGeometry(geometry, 0);
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthTest: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  return lines;
}

function matchesAny(segment: EdgeRange, ranges: readonly EdgeRange[]): boolean {
  return ranges.some((range) => range.pieceId === segment.pieceId
    && range.edgeId === segment.edgeId
    && Math.max(range.startT, segment.startT) < Math.min(range.endT, segment.endT) + 1e-7);
}

function edgeKey(range: EdgeRange, panelInstanceId: string): string {
  return `${panelInstanceId}/${range.pieceId}/${range.edgeId}`;
}

function writeSegmentColor(attribute: THREE.BufferAttribute, segmentIndex: number, color: THREE.Color): void {
  attribute.setXYZ(segmentIndex * 2, color.r, color.g, color.b);
  attribute.setXYZ(segmentIndex * 2 + 1, color.r, color.g, color.b);
}
