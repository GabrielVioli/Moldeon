import * as THREE from "three";
import type { EdgeRange } from "../domain/pattern";
import type {
  AssemblyStitchConstraint,
  GarmentAssemblyState,
  GlobalPointReference,
} from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";

export interface SewingOverlaySelection {
  first: readonly EdgeRange[];
  second: readonly EdgeRange[];
  selectedSeamId?: string | null;
}

interface EdgeSegment {
  mesh: GarmentAssemblyMeshData;
  edge: EdgeRange;
  firstVertex: number;
  secondVertex: number;
}

interface ThreadSegment {
  seamId: string;
  seamGroupId: string;
  direction?: "same" | "opposite";
  firstReference: GlobalPointReference;
  secondReference: GlobalPointReference;
  canonicalSecondReference: GlobalPointReference;
  firstMesh: GarmentAssemblyMeshData;
  secondMesh: GarmentAssemblyMeshData;
  firstParticleStart: number;
  secondParticleStart: number;
  proposal: boolean;
  inactive: boolean;
  progress: number;
}

interface DirectionNotch {
  firstMesh: GarmentAssemblyMeshData;
  secondMesh: GarmentAssemblyMeshData;
  firstParticleStart: number;
  secondParticleStart: number;
  firstStart: GlobalPointReference;
  firstEnd: GlobalPointReference;
  secondStart: GlobalPointReference;
  secondEnd: GlobalPointReference;
  seamId: string;
  inactive: boolean;
  proposal: boolean;
}

const EDGE_COLOR = new THREE.Color(0x46cfe8);
const FIRST_COLOR = new THREE.Color(0xff5b66);
const SECOND_COLOR = new THREE.Color(0x54a8ff);
const HOVER_COLOR = new THREE.Color(0xffffff);
// High-contrast magenta is deliberately used for confirmed sewing threads.
// Yellow disappeared against the avatar/floor in the manual CLO-style gate.
const CONFIRMED_THREAD_PALETTE = [
  new THREE.Color(0xff3fb4), // magenta
  new THREE.Color(0x7c5cff), // violet
  new THREE.Color(0xff6b4a), // coral
  new THREE.Color(0x00c2ff), // cyan-blue
  new THREE.Color(0x5bd68a), // green
] as const;
const PROPOSAL_THREAD_COLOR = new THREE.Color(0x00f0ff);
const INACTIVE_THREAD_COLOR = new THREE.Color(0x8f969f);
const SELECTED_THREAD_COLOR = new THREE.Color(0xffffff);
const MIN_VISUAL_THREADS_PER_PAIR = 14;
const MAX_VISUAL_THREADS_PER_PAIR = 48;
const REFERENCE_EPSILON = 1e-8;

export class SewingViewportOverlay {
  readonly group = new THREE.Group();
  readonly edgeLines = createLines(0.95);
  readonly threadLines = createLines(0.96);
  readonly notchLines = createLines(0.98);
  private edgeSegments: EdgeSegment[] = [];
  private threadSegments: ThreadSegment[] = [];
  private directionNotches: DirectionNotch[] = [];
  private selection: SewingOverlaySelection = { first: [], second: [] };
  private hoveredKey: string | null = null;

  constructor() {
    this.group.name = "sewing-overlay";
    this.edgeLines.name = "sewing-edge-overlay";
    this.threadLines.name = "sewing-thread-overlay";
    this.notchLines.name = "sewing-direction-overlay";
    this.edgeLines.renderOrder = 80;
    this.threadLines.renderOrder = 79;
    this.notchLines.renderOrder = 81;
    this.group.add(this.edgeLines, this.threadLines, this.notchLines);
  }

  get visualThreadCount(): number {
    return this.threadSegments.length;
  }

  get directionNotchCount(): number {
    return this.directionNotches.length;
  }

  rebuild(
    meshes: readonly GarmentAssemblyMeshData[],
    state: GarmentAssemblyState | null,
    selection: SewingOverlaySelection,
    proposalConstraints: readonly AssemblyStitchConstraint[] = [],
    inactiveConstraints: readonly AssemblyStitchConstraint[] = [],
  ): void {
    this.selection = selection;
    this.edgeSegments = buildEdgeSegments(meshes);
    this.threadSegments = state
      ? buildThreadSegments(meshes, state, proposalConstraints, inactiveConstraints)
      : [];
    this.directionNotches = buildDirectionNotches(this.threadSegments);
    ensureGeometryCapacity(this.edgeLines.geometry, this.edgeSegments.length);
    ensureGeometryCapacity(this.threadLines.geometry, this.threadSegments.length);
    // Each side of a notch is a shaft plus two arrow-head wings = 3 segments.
    // Two sides per sewing relation = 6 line segments per relation.
    ensureGeometryCapacity(this.notchLines.geometry, this.directionNotches.length * 6);
    this.refreshPositions();
    this.refreshColors();
  }

  setVisibility(edgesVisible: boolean, threadsVisible: boolean): void {
    this.edgeLines.visible = edgesVisible;
    this.threadLines.visible = threadsVisible;
    this.notchLines.visible = threadsVisible;
    this.group.visible = edgesVisible || threadsVisible;
  }

  setHovered(segmentIndex: number | null): void {
    const segment = segmentIndex === null ? undefined : this.edgeSegments[segmentIndex];
    const key = segment ? edgeKey(segment.edge, segment.mesh.key) : null;
    if (key === this.hoveredKey) return;
    this.hoveredKey = key;
    this.refreshColors();
  }

  edgeAtIntersection(intersection: THREE.Intersection): { range: EdgeRange; panelInstanceId: string; segmentIndex: number; t: number } | null {
    if (intersection.object !== this.edgeLines || intersection.index === undefined) return null;
    const segmentIndex = Math.floor(intersection.index / 2);
    const segment = this.edgeSegments[segmentIndex];
    return segment ? {
      range: { ...segment.edge, startT: 0, endT: 1 },
      panelInstanceId: segment.mesh.key,
      segmentIndex,
      t: edgeIntersectionT(intersection.point, segment),
    } : null;
  }

  threadAtIntersection(intersection: THREE.Intersection): { seamId: string; seamGroupId: string } | null {
    if (intersection.object !== this.threadLines || intersection.index === undefined) return null;
    const segment = this.threadSegments[Math.floor(intersection.index / 2)];
    if (!segment || segment.proposal) return null;
    return { seamId: segment.seamId, seamGroupId: segment.seamGroupId };
  }

  refreshPositions(): void {
    writeEdgePositions(this.edgeLines.geometry, this.edgeSegments);
    this.refreshThreads();
  }

  refreshThreads(): void {
    writeThreadPositions(this.threadLines.geometry, this.threadSegments);
    writeDirectionNotches(this.notchLines.geometry, this.directionNotches);
  }

  dispose(): void {
    this.edgeLines.geometry.dispose();
    this.threadLines.geometry.dispose();
    this.notchLines.geometry.dispose();
    (this.edgeLines.material as THREE.Material).dispose();
    (this.threadLines.material as THREE.Material).dispose();
    (this.notchLines.material as THREE.Material).dispose();
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
    this.threadSegments.forEach((segment, index) => {
      const color = segment.proposal
        ? PROPOSAL_THREAD_COLOR
        : this.selection.selectedSeamId === segment.seamId
          ? SELECTED_THREAD_COLOR
          : segment.inactive
            ? INACTIVE_THREAD_COLOR
            : confirmedThreadColor(segment.seamGroupId);
      writeSegmentColor(threadColors, index, color);
    });
    threadColors.needsUpdate = true;

    const notchColors = this.notchLines.geometry.getAttribute("color") as THREE.BufferAttribute;
    this.directionNotches.forEach((notch, notchIndex) => {
      const base = notchIndex * 6;
      const selected = this.selection.selectedSeamId === notch.seamId;
      const firstColor = notch.proposal
        ? PROPOSAL_THREAD_COLOR
        : selected ? SELECTED_THREAD_COLOR : notch.inactive ? INACTIVE_THREAD_COLOR : FIRST_COLOR;
      const secondColor = notch.proposal
        ? PROPOSAL_THREAD_COLOR
        : selected ? SELECTED_THREAD_COLOR : notch.inactive ? INACTIVE_THREAD_COLOR : SECOND_COLOR;
      for (let offset = 0; offset < 3; offset += 1) writeSegmentColor(notchColors, base + offset, firstColor);
      for (let offset = 3; offset < 6; offset += 1) writeSegmentColor(notchColors, base + offset, secondColor);
    });
    notchColors.needsUpdate = true;
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
  inactiveConstraints: readonly AssemblyStitchConstraint[],
): ThreadSegment[] {
  const meshById = new Map(meshes.map((mesh) => [mesh.key, mesh]));
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  const canonical = [
    ...state.stitchConstraints.map((constraint) => ({ constraint, proposal: false, inactive: false })),
    ...proposalConstraints.map((constraint) => ({ constraint, proposal: true, inactive: false })),
    ...inactiveConstraints.map((constraint) => ({ constraint, proposal: false, inactive: true })),
  ].flatMap(({ constraint, proposal, inactive }) => {
      if (!constraint.instanceA || !constraint.instanceB || constraint.seamGroupId.startsWith("dart:")) return [];
      const firstMesh = meshById.get(constraint.instanceA);
      const secondMesh = meshById.get(constraint.instanceB);
      const firstInstance = instanceById.get(constraint.instanceA);
      const secondInstance = instanceById.get(constraint.instanceB);
      if (!firstMesh || !secondMesh || !firstInstance || !secondInstance) return [];
      return [{
        seamId: constraint.seamId,
        seamGroupId: constraint.seamGroupId,
        direction: constraint.direction,
        firstReference: cloneReference(constraint.a),
        secondReference: cloneReference(constraint.b),
        canonicalSecondReference: cloneReference(constraint.b),
        firstMesh,
        secondMesh,
        firstParticleStart: firstInstance.particleStart,
        secondParticleStart: secondInstance.particleStart,
        proposal,
        inactive,
        progress: Number.isFinite(constraint.progress) ? constraint.progress! : 0,
      } satisfies ThreadSegment];
    });

  return resampleCanonicalThreads(canonical);
}

/**
 * CLO-like thread density is a rendering concern, not a physics concern.
 * We therefore never add stitch constraints to the garment. Sparse visual
 * spans are filled only by interpolation between adjacent canonical physical
 * references. The visual fan remains a faithful sampling of the exact same
 * correspondence that the compiler produced.
 */
function resampleCanonicalThreads(segments: readonly ThreadSegment[]): ThreadSegment[] {
  const grouped = new Map<string, ThreadSegment[]>();
  for (const segment of segments) {
    const key = `${segment.proposal ? "proposal" : segment.inactive ? "inactive" : "confirmed"}/${segment.seamId}/${segment.firstMesh.key}/${segment.secondMesh.key}`;
    const group = grouped.get(key) ?? [];
    group.push(segment);
    grouped.set(key, group);
  }

  const result: ThreadSegment[] = [];
  for (const group of grouped.values()) {
    const ordered = [...group].sort((left, right) => left.progress - right.progress);
    const sampled = densifyCanonicalThreadGroup(ordered);
    result.push(...untangleVisualThreadGroup(sampled));
  }
  return result;
}

function densifyCanonicalThreadGroup(ordered: readonly ThreadSegment[]): ThreadSegment[] {
  if (ordered.length < 2) {
    return ordered.map((segment) => ({
      ...segment,
      firstReference: cloneReference(segment.firstReference),
      canonicalSecondReference: cloneReference(segment.canonicalSecondReference),
      secondReference: cloneReference(segment.canonicalSecondReference),
    }));
  }

  const targetCount = Math.min(
    MAX_VISUAL_THREADS_PER_PAIR,
    Math.max(MIN_VISUAL_THREADS_PER_PAIR, ordered.length),
  );
  const result: ThreadSegment[] = [];
  for (let sampleIndex = 0; sampleIndex < targetCount; sampleIndex += 1) {
    const u = targetCount === 1 ? 0 : sampleIndex / (targetCount - 1);
    const scaled = u * (ordered.length - 1);
    const lowerIndex = Math.floor(scaled);
    const upperIndex = Math.min(ordered.length - 1, Math.ceil(scaled));
    const alpha = scaled - lowerIndex;
    const lower = ordered[lowerIndex];
    const upper = ordered[upperIndex];
    const canonicalSecondReference = interpolateReference(
      lower.canonicalSecondReference,
      upper.canonicalSecondReference,
      alpha,
    );
    result.push({
      ...lower,
      firstReference: interpolateReference(lower.firstReference, upper.firstReference, alpha),
      canonicalSecondReference,
      secondReference: cloneReference(canonicalSecondReference),
      progress: lower.progress + (upper.progress - lower.progress) * alpha,
    });
  }
  return result;
}

/**
 * Rendering-only de-crossing, inspired by CLO's readable sewing relationship
 * lines. The canonical stitch correspondence stays untouched in
 * canonicalSecondReference and in GarmentAssembly constraints. For display we
 * choose the B-side ordering with the shorter total rung length, which avoids
 * the giant X/fan when panels face opposite local directions.
 */
function untangleVisualThreadGroup(group: readonly ThreadSegment[]): ThreadSegment[] {
  if (group.length < 2) return [...group];
  const firstPoints = group.map((segment) => referenceWorldPoint(
    segment.firstMesh,
    segment.firstParticleStart,
    segment.firstReference,
  ).toArray() as [number, number, number]);
  const secondPoints = group.map((segment) => referenceWorldPoint(
    segment.secondMesh,
    segment.secondParticleStart,
    segment.canonicalSecondReference,
  ).toArray() as [number, number, number]);
  const reverse = shouldReverseVisualSewingSide(firstPoints, secondPoints);
  return group.map((segment, index) => ({
    ...segment,
    secondReference: cloneReference(
      reverse
        ? group[group.length - 1 - index].canonicalSecondReference
        : segment.canonicalSecondReference,
    ),
  }));
}

export function shouldReverseVisualSewingSide(
  firstPoints: readonly [number, number, number][],
  secondPoints: readonly [number, number, number][],
): boolean {
  if (firstPoints.length < 2 || firstPoints.length !== secondPoints.length) return false;
  let directScore = 0;
  let reversedScore = 0;
  for (let index = 0; index < firstPoints.length; index += 1) {
    directScore += pointDistanceSquared(firstPoints[index], secondPoints[index]);
    reversedScore += pointDistanceSquared(firstPoints[index], secondPoints[firstPoints.length - 1 - index]);
  }
  return reversedScore + 1e-10 < directScore;
}

function pointDistanceSquared(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const dx = first[0] - second[0];
  const dy = first[1] - second[1];
  const dz = first[2] - second[2];
  return dx * dx + dy * dy + dz * dz;
}

function buildDirectionNotches(segments: readonly ThreadSegment[]): DirectionNotch[] {
  const grouped = new Map<string, ThreadSegment[]>();
  for (const segment of segments) {
    const key = `${segment.proposal ? "proposal" : segment.inactive ? "inactive" : "confirmed"}/${segment.seamId}/${segment.firstMesh.key}/${segment.secondMesh.key}`;
    const group = grouped.get(key) ?? [];
    group.push(segment);
    grouped.set(key, group);
  }
  return [...grouped.values()].flatMap((raw) => {
    const ordered = [...raw].sort((left, right) => left.progress - right.progress);
    const first = ordered[0];
    const last = ordered.at(-1);
    if (!first || !last || ordered.length < 2) return [];
    return [{
      firstMesh: first.firstMesh,
      secondMesh: first.secondMesh,
      firstParticleStart: first.firstParticleStart,
      secondParticleStart: first.secondParticleStart,
      firstStart: cloneReference(first.firstReference),
      firstEnd: cloneReference(last.firstReference),
      // For an opposite seam these endpoints are already reversed by the
      // canonical compiler, so the arrow visibly flips with Reverse.
      secondStart: cloneReference(first.canonicalSecondReference),
      secondEnd: cloneReference(last.canonicalSecondReference),
      seamId: first.seamId,
      inactive: first.inactive,
      proposal: first.proposal,
    } satisfies DirectionNotch];
  });
}

function confirmedThreadColor(seamGroupId: string): THREE.Color {
  let hash = 2166136261;
  for (let index = 0; index < seamGroupId.length; index += 1) {
    hash ^= seamGroupId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return CONFIRMED_THREAD_PALETTE[(hash >>> 0) % CONFIRMED_THREAD_PALETTE.length];
}

function interpolateReference(
  first: GlobalPointReference,
  second: GlobalPointReference,
  alpha: number,
): GlobalPointReference {
  if (alpha <= REFERENCE_EPSILON) return cloneReference(first);
  if (alpha >= 1 - REFERENCE_EPSILON) return cloneReference(second);
  const weights = new Map<number, number>();
  first.particleIndices.forEach((particleIndex, index) => {
    weights.set(particleIndex, (weights.get(particleIndex) ?? 0) + (first.weights[index] ?? 0) * (1 - alpha));
  });
  second.particleIndices.forEach((particleIndex, index) => {
    weights.set(particleIndex, (weights.get(particleIndex) ?? 0) + (second.weights[index] ?? 0) * alpha);
  });
  const entries = [...weights.entries()].filter(([, weight]) => Math.abs(weight) > REFERENCE_EPSILON);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (Math.abs(total) <= REFERENCE_EPSILON) return cloneReference(first);
  return {
    particleIndices: entries.map(([particleIndex]) => particleIndex),
    weights: entries.map(([, weight]) => weight / total),
  };
}

function cloneReference(reference: GlobalPointReference): GlobalPointReference {
  return {
    particleIndices: [...reference.particleIndices],
    weights: [...reference.weights],
  };
}


function edgeIntersectionT(point: THREE.Vector3, segment: EdgeSegment): number {
  segment.mesh.mesh.updateMatrixWorld(true);
  const source = segment.mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const first = new THREE.Vector3()
    .fromBufferAttribute(source, segment.firstVertex)
    .applyMatrix4(segment.mesh.mesh.matrixWorld);
  const second = new THREE.Vector3()
    .fromBufferAttribute(source, segment.secondVertex)
    .applyMatrix4(segment.mesh.mesh.matrixWorld);
  const delta = second.clone().sub(first);
  const denominator = delta.lengthSq();
  const alpha = denominator <= 1e-12
    ? 0
    : THREE.MathUtils.clamp(point.clone().sub(first).dot(delta) / denominator, 0, 1);
  return segment.edge.startT + (segment.edge.endT - segment.edge.startT) * alpha;
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
    writeReference(attribute, index * 2, segment.firstMesh, segment.firstParticleStart, segment.firstReference);
    writeReference(attribute, index * 2 + 1, segment.secondMesh, segment.secondParticleStart, segment.secondReference);
  });
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function writeDirectionNotches(geometry: THREE.BufferGeometry, notches: readonly DirectionNotch[]): void {
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  notches.forEach((notch, index) => {
    notch.firstMesh.mesh.updateMatrixWorld(true);
    notch.secondMesh.mesh.updateMatrixWorld(true);
    const firstStart = referenceWorldPoint(notch.firstMesh, notch.firstParticleStart, notch.firstStart);
    const firstEnd = referenceWorldPoint(notch.firstMesh, notch.firstParticleStart, notch.firstEnd);
    const secondStart = referenceWorldPoint(notch.secondMesh, notch.secondParticleStart, notch.secondStart);
    const secondEnd = referenceWorldPoint(notch.secondMesh, notch.secondParticleStart, notch.secondEnd);
    const firstMid = firstStart.clone().lerp(firstEnd, 0.5);
    const secondMid = secondStart.clone().lerp(secondEnd, 0.5);
    writeArrow(attribute, index * 6, firstStart, firstEnd, secondMid.clone().sub(firstMid));
    writeArrow(attribute, index * 6 + 3, secondStart, secondEnd, firstMid.clone().sub(secondMid));
  });
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function writeArrow(
  attribute: THREE.BufferAttribute,
  segmentStart: number,
  edgeStart: THREE.Vector3,
  edgeEnd: THREE.Vector3,
  towardOtherSide: THREE.Vector3,
): void {
  const span = edgeEnd.clone().sub(edgeStart);
  const spanLength = span.length();
  if (spanLength <= 1e-7) {
    for (let offset = 0; offset < 6; offset += 1) attribute.setXYZ((segmentStart * 2) + offset, edgeStart.x, edgeStart.y, edgeStart.z);
    return;
  }
  const direction = span.multiplyScalar(1 / spanLength);
  const midpoint = edgeStart.clone().lerp(edgeEnd, 0.5);
  const shaftLength = THREE.MathUtils.clamp(spanLength * 0.18, 0.018, 0.055);
  const shaftStart = midpoint.clone().addScaledVector(direction, -shaftLength * 0.5);
  const tip = midpoint.clone().addScaledVector(direction, shaftLength * 0.5);

  let perpendicular = towardOtherSide.clone().addScaledVector(direction, -towardOtherSide.dot(direction));
  if (perpendicular.lengthSq() <= 1e-8) {
    perpendicular = new THREE.Vector3(0, 1, 0).addScaledVector(direction, -direction.y);
  }
  if (perpendicular.lengthSq() <= 1e-8) {
    perpendicular = new THREE.Vector3(1, 0, 0).addScaledVector(direction, -direction.x);
  }
  perpendicular.normalize();
  const headLength = shaftLength * 0.38;
  const headWidth = shaftLength * 0.24;
  const headBase = tip.clone().addScaledVector(direction, -headLength);
  const left = headBase.clone().addScaledVector(perpendicular, headWidth);
  const right = headBase.clone().addScaledVector(perpendicular, -headWidth);

  writeWorldSegment(attribute, segmentStart, shaftStart, tip);
  writeWorldSegment(attribute, segmentStart + 1, tip, left);
  writeWorldSegment(attribute, segmentStart + 2, tip, right);
}

function writeWorldSegment(
  attribute: THREE.BufferAttribute,
  segmentIndex: number,
  first: THREE.Vector3,
  second: THREE.Vector3,
): void {
  attribute.setXYZ(segmentIndex * 2, first.x, first.y, first.z);
  attribute.setXYZ(segmentIndex * 2 + 1, second.x, second.y, second.z);
}

function writeVertex(attribute: THREE.BufferAttribute, targetIndex: number, mesh: GarmentAssemblyMeshData, vertexIndex: number): void {
  const source = mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3().fromBufferAttribute(source, vertexIndex).applyMatrix4(mesh.mesh.matrixWorld);
  attribute.setXYZ(targetIndex, point.x, point.y, point.z);
}

function referenceWorldPoint(
  mesh: GarmentAssemblyMeshData,
  particleStart: number,
  reference: GlobalPointReference,
): THREE.Vector3 {
  const source = mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  const sample = new THREE.Vector3();
  reference.particleIndices.forEach((particleIndex, index) => {
    const localIndex = particleIndex - particleStart;
    if (localIndex < 0 || localIndex >= source.count) return;
    sample.fromBufferAttribute(source, localIndex);
    point.addScaledVector(sample, reference.weights[index] ?? 0);
  });
  return point.applyMatrix4(mesh.mesh.matrixWorld);
}

function writeReference(
  attribute: THREE.BufferAttribute,
  targetIndex: number,
  mesh: GarmentAssemblyMeshData,
  particleStart: number,
  reference: GlobalPointReference,
): void {
  const point = referenceWorldPoint(mesh, particleStart, reference);
  attribute.setXYZ(targetIndex, point.x, point.y, point.z);
}

function ensureGeometryCapacity(geometry: THREE.BufferGeometry, segmentCount: number): void {
  const requiredVertices = segmentCount * 2;
  const currentPosition = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const currentColor = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!currentPosition || !currentColor || currentPosition.count < requiredVertices || currentColor.count < requiredVertices) {
    const previousCapacity = Math.max(currentPosition?.count ?? 0, currentColor?.count ?? 0);
    const grownCapacity = previousCapacity > 0 ? Math.ceil(previousCapacity * 1.5) : 16;
    const capacity = Math.max(requiredVertices, grownCapacity);
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  }
  geometry.setDrawRange(0, requiredVertices);
}

function createLines(opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  ensureGeometryCapacity(geometry, 0);
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
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
