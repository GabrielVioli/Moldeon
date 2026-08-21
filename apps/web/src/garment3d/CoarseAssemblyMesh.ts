import { buildPanelTopology, type PanelTopology } from "./PanelTopology";
import {
  refinePanelTopology,
  remeshStructuredQuadrilateral,
  remeshStructuredQuadrilateralWithEdgeStops,
} from "./PanelRefinement";
import type {
  AssemblyPanelInstance,
  GarmentAssemblyState,
} from "./GarmentAssembly";

const METERS_PER_MM = 0.001;
const BARY_EPSILON = 1e-7;

export interface CoarseMetricEdge {
  a: number;
  b: number;
  restLengthM: number;
}

export interface CoarseInternalHinge {
  edgeA: number;
  edgeB: number;
  oppositeA: number;
  oppositeB: number;
  restEdgeLengthM: number;
}

export interface CoarseBoundaryPath {
  edgeId: string;
  vertexIndices: Uint32Array;
  cumulativeLengthsMm: Float32Array;
  lengthMm: number;
}

export interface CoarseMaterialBinding {
  triangleIndex: number;
  vertices: readonly [number, number, number];
  weights: readonly [number, number, number];
  materialXMm: number;
  materialYMm: number;
}

export interface CoarseAssemblyMesh {
  panelInstanceId: string;
  sourcePatternId: string;
  geometrySignature: string;
  materialPositionsMm: Float32Array;
  positions: Float32Array;
  triangles: Uint32Array;
  metricEdges: CoarseMetricEdge[];
  hinges: CoarseInternalHinge[];
  boundaryPaths: Record<string, CoarseBoundaryPath>;
  boundaryVertices: Uint32Array;
  sourceMapping: Array<{
    sourcePatternId: string;
    sourcePointId?: string;
    sourceSegmentId?: string;
    edgeId?: string;
    t?: number;
  }>;
  materialAreaM2: number;
}

export interface CoarseAssemblySet {
  meshes: CoarseAssemblyMesh[];
  byInstanceId: Map<string, CoarseAssemblyMesh>;
  coarseVertexCount: number;
  coarseTriangleCount: number;
  hingeCount: number;
  fineVertexCount: number;
  reductionRatio: number;
}

/**
 * Build a derived, deliberately lower-resolution surface for geometric
 * assembly. PatternDefinition/PanelInstance remain canonical; this structure
 * exists only for STEP-0 embedding and is rebuilt on every geometry revision.
 *
 * The current fine physics mesh remains independent. The coarse mesh uses a
 * deliberately local material triangulation: structured quadrilaterals are
 * remeshed to adaptive cells, while general polygons receive one localizing
 * subdivision pass. This prevents long contour-fan diagonals from acting as
 * non-local metric bars when the panel bends.
 */
export function buildCoarseAssemblySet(state: GarmentAssemblyState): CoarseAssemblySet {
  const meshes = state.instances
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((instance) => buildCoarseAssemblyMesh(state, instance));
  const byInstanceId = new Map(meshes.map((mesh) => [mesh.panelInstanceId, mesh]));
  const coarseVertexCount = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const coarseTriangleCount = meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0);
  const hingeCount = meshes.reduce((sum, mesh) => sum + mesh.hinges.length, 0);
  const fineVertexCount = state.instances.reduce((sum, instance) => sum + instance.vertexCount, 0);
  return {
    meshes,
    byInstanceId,
    coarseVertexCount,
    coarseTriangleCount,
    hingeCount,
    fineVertexCount,
    reductionRatio: fineVertexCount > 0 ? coarseVertexCount / fineVertexCount : 0,
  };
}

export function buildCoarseAssemblyMesh(
  state: GarmentAssemblyState,
  instance: AssemblyPanelInstance,
): CoarseAssemblyMesh {
  const baseTopology = buildPanelTopology(
    instance.topology.sourcePiece,
    METERS_PER_MM,
    instance.geometrySignature,
  );
  const hasStructuredSelfSeam = state.stitchConstraints.some((stitch) =>
    stitch.instanceA === instance.id
    && stitch.instanceB === instance.id
    && stitch.treatment.toLowerCase() !== "dart");
  const topology = buildLocalCoarseTopology(
    baseTopology,
    hasStructuredSelfSeam,
    instance.structuredAttachmentPlan,
  );
  const positions = new Float32Array(topology.positions2DMm.length / 2 * 3);
  for (let vertex = 0; vertex < topology.positions2DMm.length / 2; vertex += 1) {
    const xMm = topology.positions2DMm[vertex * 2];
    const yMm = topology.positions2DMm[vertex * 2 + 1];
    const sampled = sampleFineSurfaceAtMaterial(state, instance, xMm, yMm);
    const offset = vertex * 3;
    positions[offset] = sampled[0];
    positions[offset + 1] = sampled[1];
    positions[offset + 2] = sampled[2];
  }
  applyClosedDartDevelopableSeed(topology, positions, instance);

  return {
    panelInstanceId: instance.id,
    sourcePatternId: instance.sourcePatternId,
    geometrySignature: instance.geometrySignature,
    materialPositionsMm: new Float32Array(topology.positions2DMm),
    positions,
    triangles: new Uint32Array(topology.triangles),
    metricEdges: buildMetricEdges(topology),
    hinges: buildInternalHinges(topology),
    boundaryPaths: buildBoundaryPaths(topology),
    boundaryVertices: Uint32Array.from(topology.boundaryVertices),
    sourceMapping: topology.vertexSources.map((source) => ({
      sourcePatternId: source.sourcePatternId,
      ...(source.sourcePointId === undefined ? {} : { sourcePointId: source.sourcePointId }),
      ...(source.sourceSegmentId === undefined ? {} : { sourceSegmentId: source.sourceSegmentId }),
      ...(source.edgeId === undefined ? {} : { edgeId: source.edgeId }),
      ...(source.t === undefined ? {} : { t: source.t }),
    })),
    materialAreaM2: triangleAreaSum2D(topology.positions2DMm, topology.triangles) * 1e-6,
  };
}

function buildLocalCoarseTopology(
  base: PanelTopology,
  hasStructuredSelfSeam: boolean,
  attachmentPlan: AssemblyPanelInstance["structuredAttachmentPlan"],
): PanelTopology {
  // This is the exact parent topology used by buildGarmentAssembly before two
  // midpoint subdivisions. Fine vertices are therefore nested barycentric
  // points of coarse triangles, not samples of an unrelated triangulation.
  if (hasStructuredSelfSeam) {
    const structured = attachmentPlan
      ? remeshStructuredQuadrilateralWithEdgeStops(
          base,
          attachmentPlan.edgeId,
          attachmentPlan.stopsT,
          80,
        )
      : remeshStructuredQuadrilateral(base, 80);
    if (structured) return structured;
  }
  const structured = remeshStructuredQuadrilateral(base, 40);
  if (structured) return structured;
  return refinePanelTopology(base, 1);
}

/**
 * Builds the exact discrete developable surface of one closed dart.  The body
 * fan becomes a polyhedral cone, both dart legs share one generator, and the
 * intake folds back through the centre line.  Every triangle is moved
 * rigidly from the authored 2D material net; no edge length is rescaled.
 */
function applyClosedDartDevelopableSeed(
  topology: PanelTopology,
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): boolean {
  const materialized = topology.darts.filter((dart) =>
    dart.dart.closed
    && dart.apexVertex !== null
    && dart.legAVertices.length >= 2
    && dart.legBVertices.length >= 2);
  if (materialized.length !== 1) return false;
  const dart = materialized[0];
  const apexIndex = dart.apexVertex!;
  const legAIndex = dart.legAVertices[0];
  const legBIndex = dart.legBVertices[0];
  const boundary = topology.boundaryVertices;
  const cursorA = boundary.indexOf(legAIndex);
  const cursorB = boundary.indexOf(legBIndex);
  if (cursorA < 0 || cursorB < 0) return false;

  const forwardAtoB = cyclicTopologyPath(boundary, cursorA, cursorB);
  const forwardBtoA = cyclicTopologyPath(boundary, cursorB, cursorA);
  const lengthAtoB = topologyPathLengthMm(forwardAtoB, topology.positions2DMm);
  const lengthBtoA = topologyPathLengthMm(forwardBtoA, topology.positions2DMm);
  const mouthBoundary = lengthAtoB <= lengthBtoA ? forwardAtoB : forwardBtoA;
  const bodyBoundary = lengthAtoB <= lengthBtoA ? forwardBtoA : forwardAtoB;
  if (bodyBoundary.length < 3) return false;

  const apex2 = topologyPoint(topology.positions2DMm, apexIndex);
  const materialAngles: number[] = [];
  for (let cursor = 0; cursor < bodyBoundary.length - 1; cursor += 1) {
    const first = sub2(topologyPoint(topology.positions2DMm, bodyBoundary[cursor]), apex2);
    const second = sub2(topologyPoint(topology.positions2DMm, bodyBoundary[cursor + 1]), apex2);
    materialAngles.push(angleBetween2(first, second));
  }
  const totalMaterialAngle = materialAngles.reduce((sum, angle) => sum + angle, 0);
  if (!(totalMaterialAngle > Math.PI && totalMaterialAngle < Math.PI * 2 - 1e-5)) return false;
  const coneHalfAngle = solveConeHalfAngle(materialAngles);
  if (coneHalfAngle === null) return false;

  const previousCentroid = centroid3(positions);
  const spatialFrame = fitMaterialChartFrame(topology, positions, instance);
  if (!spatialFrame) return false;
  const mapped = new Float64Array(positions.length);
  const assigned = new Uint8Array(positions.length / 3);
  const sinBeta = Math.sin(coneHalfAngle);
  const cosBeta = Math.cos(coneHalfAngle);
  let azimuth = 0;
  const bodyDirections: Array<readonly [number, number, number]> = [];
  for (let cursor = 0; cursor < bodyBoundary.length; cursor += 1) {
    if (cursor === bodyBoundary.length - 1) azimuth = Math.PI * 2;
    const direction: readonly [number, number, number] = [
      sinBeta * Math.cos(azimuth),
      cosBeta,
      sinBeta * Math.sin(azimuth),
    ];
    bodyDirections.push(direction);
    assignRadialVertex(mapped, assigned, topology.positions2DMm, bodyBoundary[cursor], apex2, direction);
    if (cursor < materialAngles.length) {
      azimuth += coneAzimuthIncrement(materialAngles[cursor], coneHalfAngle);
    }
  }

  const seamDirection = bodyDirections[0];
  for (const vertex of [...dart.legAVertices, ...dart.legBVertices]) {
    if (vertex === apexIndex) continue;
    assignRadialVertex(mapped, assigned, topology.positions2DMm, vertex, apex2, seamDirection);
  }
  mapped[apexIndex * 3] = 0;
  mapped[apexIndex * 3 + 1] = 0;
  mapped[apexIndex * 3 + 2] = 0;
  assigned[apexIndex] = 1;

  const legAVector = sub2(topologyPoint(topology.positions2DMm, legAIndex), apex2);
  const legBVector = sub2(topologyPoint(topology.positions2DMm, legBIndex), apex2);
  const dartAngle = angleBetween2(legAVector, legBVector);
  const foldTangent = normalize3(cross3(seamDirection, [0, 1, 0]));
  const stableFoldTangent = lengthSquared3(foldTangent) > 0.5
    ? foldTangent
    : normalize3(cross3(seamDirection, [1, 0, 0]));
  for (const vertex of mouthBoundary) {
    if (vertex === legAIndex || vertex === legBIndex) continue;
    const radial = sub2(topologyPoint(topology.positions2DMm, vertex), apex2);
    const fromA = angleBetween2(legAVector, radial);
    const fromB = angleBetween2(legBVector, radial);
    const foldedAngle = Math.min(fromA, fromB, dartAngle * 0.5);
    const direction: readonly [number, number, number] = [
      seamDirection[0] * Math.cos(foldedAngle) + stableFoldTangent[0] * Math.sin(foldedAngle),
      seamDirection[1] * Math.cos(foldedAngle) + stableFoldTangent[1] * Math.sin(foldedAngle),
      seamDirection[2] * Math.cos(foldedAngle) + stableFoldTangent[2] * Math.sin(foldedAngle),
    ];
    assignRadialVertex(mapped, assigned, topology.positions2DMm, vertex, apex2, direction);
  }

  // Refinement appends exact edge midpoints after all of their parents.
  for (let vertex = 0; vertex < assigned.length; vertex += 1) {
    if (assigned[vertex]) continue;
    const parents = topology.vertexSources[vertex]?.derivedFromVertexIndices;
    if (!parents?.length || parents.some((parent) => !assigned[parent])) return false;
    for (const parent of parents) {
      mapped[vertex * 3] += mapped[parent * 3] / parents.length;
      mapped[vertex * 3 + 1] += mapped[parent * 3 + 1] / parents.length;
      mapped[vertex * 3 + 2] += mapped[parent * 3 + 2] / parents.length;
    }
    assigned[vertex] = 1;
  }

  const mappedCentroid = centroid3(mapped);
  const radial2 = normalize2([
    topology.positions2DMm[bodyBoundary[0] * 2] - apex2[0],
    -(topology.positions2DMm[bodyBoundary[0] * 2 + 1] - apex2[1]),
  ]);
  const next2 = normalize2([
    topology.positions2DMm[bodyBoundary[1] * 2] - apex2[0],
    -(topology.positions2DMm[bodyBoundary[1] * 2 + 1] - apex2[1]),
  ]);
  const traversalSign = radial2[0] * next2[1] - radial2[1] * next2[0] >= 0 ? 1 : -1;
  const transverse2: readonly [number, number] = [
    -radial2[1] * traversalSign,
    radial2[0] * traversalSign,
  ];
  const targetRadial = add3(
    scale3(spatialFrame.u, radial2[0]),
    scale3(spatialFrame.v, radial2[1]),
  );
  const targetTransverse = add3(
    scale3(spatialFrame.u, transverse2[0]),
    scale3(spatialFrame.v, transverse2[1]),
  );
  const targetNormal = scale3(spatialFrame.w, traversalSign);
  const canonicalRadial = normalize3(seamDirection);
  const canonicalTransverse = normalize3([0, 0, 1]);
  const canonicalNormal = normalize3(cross3(canonicalRadial, canonicalTransverse));
  for (let offset = 0; offset < positions.length; offset += 3) {
    const local: readonly [number, number, number] = [
      mapped[offset] - mappedCentroid[0],
      mapped[offset + 1] - mappedCentroid[1],
      mapped[offset + 2] - mappedCentroid[2],
    ];
    const transformed = add3(
      add3(
        scale3(targetRadial, dot3(local, canonicalRadial)),
        scale3(targetTransverse, dot3(local, canonicalTransverse)),
      ),
      scale3(targetNormal, dot3(local, canonicalNormal)),
    );
    positions[offset] = transformed[0] + previousCentroid[0];
    positions[offset + 1] = transformed[1] + previousCentroid[1];
    positions[offset + 2] = transformed[2] + previousCentroid[2];
  }
  return true;
}

interface MaterialChartFrame {
  u: readonly [number, number, number];
  v: readonly [number, number, number];
  w: readonly [number, number, number];
}

function fitMaterialChartFrame(
  topology: PanelTopology,
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): MaterialChartFrame | null {
  const vertices = [...topology.boundaryVertices];
  if (vertices.length < 3) return null;
  let meanX = 0; let meanY = 0;
  let meanP: [number, number, number] = [0, 0, 0];
  for (const vertex of vertices) {
    meanX += topology.positions2DMm[vertex * 2];
    meanY += -topology.positions2DMm[vertex * 2 + 1];
    meanP = add3(meanP, position3(positions, vertex)) as [number, number, number];
  }
  meanX /= vertices.length;
  meanY /= vertices.length;
  meanP = scale3(meanP, 1 / vertices.length) as [number, number, number];

  let xx = 0; let xy = 0; let yy = 0;
  let px: [number, number, number] = [0, 0, 0];
  let py: [number, number, number] = [0, 0, 0];
  for (const vertex of vertices) {
    const x = topology.positions2DMm[vertex * 2] - meanX;
    const y = -topology.positions2DMm[vertex * 2 + 1] - meanY;
    const p = sub3(position3(positions, vertex), meanP);
    xx += x * x;
    xy += x * y;
    yy += y * y;
    px = add3(px, scale3(p, x)) as [number, number, number];
    py = add3(py, scale3(p, y)) as [number, number, number];
  }
  const determinant = xx * yy - xy * xy;
  if (Math.abs(determinant) <= BARY_EPSILON) return null;
  const rawU = scale3(sub3(scale3(px, yy), scale3(py, xy)), 1 / determinant);
  const rawV = scale3(sub3(scale3(py, xx), scale3(px, xy)), 1 / determinant);
  const u = normalize3(rawU);
  const v = normalize3(sub3(rawV, scale3(u, dot3(rawV, u))));
  const chartNormal = normalize3(cross3(u, v));
  if (lengthSquared3(u) < 0.5 || lengthSquared3(v) < 0.5 || lengthSquared3(chartNormal) < 0.5) {
    return null;
  }
  const surfaceSign = instance.placement.surface === "back" ? -1 : 1;
  return {
    u,
    v,
    w: scale3(chartNormal, surfaceSign * instance.materialParity),
  };
}

function cyclicTopologyPath(
  boundary: readonly number[] | Uint32Array,
  fromCursor: number,
  toCursor: number,
): number[] {
  const result = [boundary[fromCursor]];
  let cursor = fromCursor;
  while (cursor !== toCursor && result.length <= boundary.length) {
    cursor = (cursor + 1) % boundary.length;
    result.push(boundary[cursor]);
  }
  return result;
}

function topologyPathLengthMm(
  path: readonly number[],
  positions: Float32Array,
): number {
  let total = 0;
  for (let cursor = 1; cursor < path.length; cursor += 1) {
    const first = topologyPoint(positions, path[cursor - 1]);
    const second = topologyPoint(positions, path[cursor]);
    total += Math.hypot(second[0] - first[0], second[1] - first[1]);
  }
  return total;
}

function topologyPoint(
  positions: Float32Array,
  vertex: number,
): readonly [number, number] {
  return [positions[vertex * 2], positions[vertex * 2 + 1]];
}

function sub2(
  first: readonly [number, number],
  second: readonly [number, number],
): readonly [number, number] {
  return [first[0] - second[0], first[1] - second[1]];
}

function normalize2(value: readonly [number, number]): readonly [number, number] {
  const length = Math.hypot(value[0], value[1]);
  return length <= BARY_EPSILON ? [1, 0] : [value[0] / length, value[1] / length];
}

function position3(values: Float32Array, vertex: number): readonly [number, number, number] {
  return [values[vertex * 3], values[vertex * 3 + 1], values[vertex * 3 + 2]];
}

function add3(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): [number, number, number] {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function sub3(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): [number, number, number] {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function scale3(
  value: readonly [number, number, number],
  scalar: number,
): [number, number, number] {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot3(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function angleBetween2(
  first: readonly [number, number],
  second: readonly [number, number],
): number {
  const denominator = Math.hypot(first[0], first[1]) * Math.hypot(second[0], second[1]);
  if (denominator <= BARY_EPSILON) return 0;
  return Math.acos(clampUnit((first[0] * second[0] + first[1] * second[1]) / denominator));
}

function solveConeHalfAngle(materialAngles: readonly number[]): number | null {
  const maximum = Math.max(...materialAngles);
  let low = maximum * 0.5 + 1e-7;
  let high = Math.PI * 0.5;
  const target = Math.PI * 2;
  const lowSum = materialAngles.reduce(
    (sum, angle) => sum + coneAzimuthIncrement(angle, low),
    0,
  );
  const highSum = materialAngles.reduce(
    (sum, angle) => sum + coneAzimuthIncrement(angle, high),
    0,
  );
  if (!Number.isFinite(lowSum) || lowSum < target || highSum > target) return null;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) * 0.5;
    const sum = materialAngles.reduce(
      (total, angle) => total + coneAzimuthIncrement(angle, middle),
      0,
    );
    if (sum > target) low = middle;
    else high = middle;
  }
  return (low + high) * 0.5;
}

function coneAzimuthIncrement(materialAngle: number, coneHalfAngle: number): number {
  const cosine = Math.cos(coneHalfAngle);
  const sine = Math.sin(coneHalfAngle);
  const denominator = sine * sine;
  if (denominator <= BARY_EPSILON) return Number.POSITIVE_INFINITY;
  return Math.acos(clampUnit((Math.cos(materialAngle) - cosine * cosine) / denominator));
}

function assignRadialVertex(
  mapped: Float64Array,
  assigned: Uint8Array,
  material: Float32Array,
  vertex: number,
  apex: readonly [number, number],
  direction: readonly [number, number, number],
): void {
  const point = topologyPoint(material, vertex);
  const radiusM = Math.hypot(point[0] - apex[0], point[1] - apex[1]) * METERS_PER_MM;
  mapped[vertex * 3] = direction[0] * radiusM;
  mapped[vertex * 3 + 1] = direction[1] * radiusM;
  mapped[vertex * 3 + 2] = direction[2] * radiusM;
  assigned[vertex] = 1;
}

function centroid3(values: ArrayLike<number>): readonly [number, number, number] {
  const count = Math.max(1, values.length / 3);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let offset = 0; offset < values.length; offset += 3) {
    x += values[offset];
    y += values[offset + 1];
    z += values[offset + 2];
  }
  return [x / count, y / count, z / count];
}

function cross3(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function normalize3(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  const length = Math.hypot(...value);
  return length <= BARY_EPSILON
    ? [0, 0, 0]
    : [value[0] / length, value[1] / length, value[2] / length];
}

function lengthSquared3(value: readonly [number, number, number]): number {
  return value[0] * value[0] + value[1] * value[1] + value[2] * value[2];
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function bindMaterialPoint(
  mesh: Pick<CoarseAssemblyMesh, "materialPositionsMm" | "triangles">,
  xMm: number,
  yMm: number,
): CoarseMaterialBinding {
  const found = locateTriangle(mesh.materialPositionsMm, mesh.triangles, xMm, yMm);
  if (found) return found;

  // Boundary points can land a few ulps outside an ear-clipped triangle. Pick
  // the least-negative barycentric triangle rather than using a geometric
  // nearest-neighbour search. This stays deterministic in material space.
  let best: CoarseMaterialBinding | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let tri = 0; tri < mesh.triangles.length / 3; tri += 1) {
    const a = mesh.triangles[tri * 3];
    const b = mesh.triangles[tri * 3 + 1];
    const c = mesh.triangles[tri * 3 + 2];
    const weights = barycentric2D(mesh.materialPositionsMm, a, b, c, xMm, yMm);
    if (!weights) continue;
    const penalty = Math.max(0, -weights[0]) + Math.max(0, -weights[1]) + Math.max(0, -weights[2]);
    if (penalty < bestPenalty - 1e-12) {
      bestPenalty = penalty;
      const clamped = normalizeWeights([
        Math.max(0, weights[0]),
        Math.max(0, weights[1]),
        Math.max(0, weights[2]),
      ]);
      best = {
        triangleIndex: tri,
        vertices: [a, b, c],
        weights: clamped,
        materialXMm: xMm,
        materialYMm: yMm,
      };
    }
  }
  if (!best) throw new Error(`Não foi possível vincular o ponto material (${xMm}, ${yMm}) à coarse surface.`);
  return best;
}

export function evaluateCoarseBinding(
  mesh: Pick<CoarseAssemblyMesh, "positions">,
  binding: CoarseMaterialBinding,
): readonly [number, number, number] {
  const [a, b, c] = binding.vertices;
  const [wa, wb, wc] = binding.weights;
  return [
    mesh.positions[a * 3] * wa + mesh.positions[b * 3] * wb + mesh.positions[c * 3] * wc,
    mesh.positions[a * 3 + 1] * wa + mesh.positions[b * 3 + 1] * wb + mesh.positions[c * 3 + 1] * wc,
    mesh.positions[a * 3 + 2] * wa + mesh.positions[b * 3 + 2] * wb + mesh.positions[c * 3 + 2] * wc,
  ];
}

export function materialPointFromFineReference(
  instance: AssemblyPanelInstance,
  particleIndices: readonly number[],
  weights: readonly number[],
): readonly [number, number] {
  let x = 0;
  let y = 0;
  let total = 0;
  for (let index = 0; index < particleIndices.length; index += 1) {
    const particle = particleIndices[index];
    const local = particle - instance.particleStart;
    if (local < 0 || local >= instance.vertexCount) continue;
    const weight = weights[index] ?? 0;
    x += instance.topology.positions2DMm[local * 2] * weight;
    y += instance.topology.positions2DMm[local * 2 + 1] * weight;
    total += weight;
  }
  if (Math.abs(total) <= BARY_EPSILON) {
    throw new Error(`Referência material sem peso válido em ${instance.id}.`);
  }
  return [x / total, y / total];
}

function buildMetricEdges(topology: PanelTopology): CoarseMetricEdge[] {
  const seen = new Set<string>();
  const result: CoarseMetricEdge[] = [];
  for (let offset = 0; offset < topology.triangles.length; offset += 3) {
    add(topology.triangles[offset], topology.triangles[offset + 1]);
    add(topology.triangles[offset + 1], topology.triangles[offset + 2]);
    add(topology.triangles[offset + 2], topology.triangles[offset]);
  }
  return result;

  function add(a: number, b: number): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    if (seen.has(key)) return;
    seen.add(key);
    const dx = (topology.positions2DMm[hi * 2] - topology.positions2DMm[lo * 2]) * METERS_PER_MM;
    const dy = (topology.positions2DMm[hi * 2 + 1] - topology.positions2DMm[lo * 2 + 1]) * METERS_PER_MM;
    result.push({ a: lo, b: hi, restLengthM: Math.hypot(dx, dy) });
  }
}

function buildInternalHinges(topology: PanelTopology): CoarseInternalHinge[] {
  const edges = new Map<string, Array<{ opposite: number; a: number; b: number }>>();
  for (let offset = 0; offset < topology.triangles.length; offset += 3) {
    const a = topology.triangles[offset];
    const b = topology.triangles[offset + 1];
    const c = topology.triangles[offset + 2];
    register(a, b, c);
    register(b, c, a);
    register(c, a, b);
  }
  const result: CoarseInternalHinge[] = [];
  for (const records of edges.values()) {
    if (records.length !== 2) continue;
    const first = records[0];
    const second = records[1];
    const dx = (topology.positions2DMm[first.a * 2] - topology.positions2DMm[first.b * 2]) * METERS_PER_MM;
    const dy = (topology.positions2DMm[first.a * 2 + 1] - topology.positions2DMm[first.b * 2 + 1]) * METERS_PER_MM;
    result.push({
      edgeA: first.a,
      edgeB: first.b,
      oppositeA: first.opposite,
      oppositeB: second.opposite,
      restEdgeLengthM: Math.hypot(dx, dy),
    });
  }
  return result;

  function register(a: number, b: number, opposite: number): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    const records = edges.get(key) ?? [];
    records.push({ opposite, a: lo, b: hi });
    edges.set(key, records);
  }
}

function buildBoundaryPaths(topology: PanelTopology): Record<string, CoarseBoundaryPath> {
  const result: Record<string, CoarseBoundaryPath> = {};
  for (const [edgeId, path] of [...topology.edges.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    result[edgeId] = {
      edgeId,
      vertexIndices: Uint32Array.from(path.vertexIndices),
      cumulativeLengthsMm: Float32Array.from(path.cumulativeLengthsMm),
      lengthMm: path.lengthMm,
    };
  }
  return result;
}

function sampleFineSurfaceAtMaterial(
  state: GarmentAssemblyState,
  instance: AssemblyPanelInstance,
  xMm: number,
  yMm: number,
): readonly [number, number, number] {
  const binding = locateTriangle(instance.topology.positions2DMm, instance.topology.triangles, xMm, yMm);
  if (!binding) {
    // Base/coarse vertices are boundary points present in the refined topology.
    // If a refined ear-clipping tolerance differs, fall back to the material
    // nearest fine vertex once during rebuild only. This is never a per-frame
    // coarse→fine binding path.
    let local = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < instance.vertexCount; index += 1) {
      const dx = instance.topology.positions2DMm[index * 2] - xMm;
      const dy = instance.topology.positions2DMm[index * 2 + 1] - yMm;
      const distance2 = dx * dx + dy * dy;
      if (distance2 < best) {
        best = distance2;
        local = index;
      }
    }
    const offset = (instance.particleStart + local) * 3;
    return [state.positions[offset], state.positions[offset + 1], state.positions[offset + 2]];
  }
  const [a, b, c] = binding.vertices;
  const [wa, wb, wc] = binding.weights;
  const ga = (instance.particleStart + a) * 3;
  const gb = (instance.particleStart + b) * 3;
  const gc = (instance.particleStart + c) * 3;
  return [
    state.positions[ga] * wa + state.positions[gb] * wb + state.positions[gc] * wc,
    state.positions[ga + 1] * wa + state.positions[gb + 1] * wb + state.positions[gc + 1] * wc,
    state.positions[ga + 2] * wa + state.positions[gb + 2] * wb + state.positions[gc + 2] * wc,
  ];
}

function locateTriangle(
  material: Float32Array,
  triangles: Uint32Array,
  xMm: number,
  yMm: number,
): CoarseMaterialBinding | null {
  for (let tri = 0; tri < triangles.length / 3; tri += 1) {
    const a = triangles[tri * 3];
    const b = triangles[tri * 3 + 1];
    const c = triangles[tri * 3 + 2];
    const weights = barycentric2D(material, a, b, c, xMm, yMm);
    if (!weights) continue;
    if (weights[0] >= -BARY_EPSILON && weights[1] >= -BARY_EPSILON && weights[2] >= -BARY_EPSILON) {
      return {
        triangleIndex: tri,
        vertices: [a, b, c],
        weights: normalizeWeights(weights),
        materialXMm: xMm,
        materialYMm: yMm,
      };
    }
  }
  return null;
}

function barycentric2D(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
  x: number,
  y: number,
): [number, number, number] | null {
  const ax = positions[a * 2];
  const ay = positions[a * 2 + 1];
  const bx = positions[b * 2];
  const by = positions[b * 2 + 1];
  const cx = positions[c * 2];
  const cy = positions[c * 2 + 1];
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denominator) <= BARY_EPSILON) return null;
  const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
  const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator;
  return [wa, wb, 1 - wa - wb];
}

function normalizeWeights(weights: readonly number[]): [number, number, number] {
  const total = weights[0] + weights[1] + weights[2];
  if (Math.abs(total) <= BARY_EPSILON) return [1, 0, 0];
  return [weights[0] / total, weights[1] / total, weights[2] / total];
}

function triangleAreaSum2D(positions: Float32Array, triangles: Uint32Array): number {
  let area = 0;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const a = triangles[offset] * 2;
    const b = triangles[offset + 1] * 2;
    const c = triangles[offset + 2] * 2;
    area += Math.abs(
      (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1])
      - (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a])
    ) * 0.5;
  }
  return area;
}
