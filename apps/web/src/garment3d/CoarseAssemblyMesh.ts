import { buildPanelTopology, type PanelTopology } from "./PanelTopology";
import { refinePanelTopology, remeshStructuredQuadrilateral } from "./PanelRefinement";
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
  const topology = buildLocalCoarseTopology(baseTopology);
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

function buildLocalCoarseTopology(base: PanelTopology): PanelTopology {
  const characteristicMm = Math.sqrt(Math.max(
    1,
    base.boundsMm.width * base.boundsMm.height,
  ));
  // Scale cell size with the material patch instead of hard-coding one garment
  // resolution. Small pieces keep enough bending DOFs; large panels remain
  // substantially coarser than the physics mesh.
  const targetCellMm = Math.min(55, Math.max(24, characteristicMm / 5));
  const structured = remeshStructuredQuadrilateral(base, targetCellMm);
  if (structured) return structured;

  // General boundaries keep their exact authored sampling. A single midpoint
  // subdivision turns potentially long ear-clipping diagonals into local hinge
  // chains while remaining well below the normal two-pass physics refinement.
  return refinePanelTopology(base, 1);
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
