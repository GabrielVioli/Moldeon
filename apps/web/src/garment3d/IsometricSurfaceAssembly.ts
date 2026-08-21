import type { GarmentAssemblyState } from "./GarmentAssembly";
import {
  evaluateCoarseBinding,
  type CoarseAssemblyMesh,
  type CoarseAssemblySet,
  type CoarseInternalHinge,
  type CoarseMaterialBinding,
  type CoarseMetricEdge,
} from "./CoarseAssemblyMesh";
import type {
  CoarseSeamConstraint,
  CoarseSeamResolution,
} from "./CoarseSeamConstraints";

const EPS = 1e-9;
const METRIC_WEIGHT = 48;
const STRUCTURAL_SEAM_WEIGHT = 1.15;
const HINGE_BARRIER_WEIGHT = 0.35;
const OVERLAP_WEIGHT = 2.2;
const GAUGE_WEIGHT = 0.025;
const HINGE_SOFT_LIMIT_RAD = 72 * Math.PI / 180;
const DEFAULT_ITERATIONS = 128;
const DEFAULT_ZERO_ENERGY_ITERATIONS = 3_000;
const ZERO_ENERGY_SEAM_RELAXATION = 0.04;
const ZERO_ENERGY_METRIC_TOLERANCE = 2.5e-5;
const ZERO_ENERGY_SEAM_TOLERANCE_M = 2.5e-5;

export type AssemblyConstraintState = "well-constrained" | "partially-constrained" | "ambiguous";

export interface IsometricAssemblyMetrics {
  metricDistortionMean: number;
  metricDistortionMax: number;
  areaDistortionMean: number;
  areaDistortionMax: number;
  structuralSeamMeanMm: number;
  structuralSeamMaxMm: number;
  normalizedResidual: number;
  overlapScore: number;
  triangleCrossingProxyCount: number;
  nonPlanarityRad: number;
}

export interface IsometricAssemblyComponentDiagnostic extends IsometricAssemblyMetrics {
  componentId: string;
  panelInstanceIds: string[];
  structuralRelationCount: number;
  cycleRank: number;
  parallelRelationCount: number;
  freeBoundaryEstimate: number;
  selectedSeed: string;
  candidateCount: number;
  candidateDiagnostics: Array<{
    name: string;
    score: number;
    metrics: IsometricAssemblyMetrics;
  }>;
  constraintState: AssemblyConstraintState;
  assemblyConfidence: number;
  ambiguityReason?: string;
  solveMs: number;
}

export interface IsometricSurfaceAssemblyResult {
  strategy: "coarse-isometric-surface";
  components: IsometricAssemblyComponentDiagnostic[];
  metrics: IsometricAssemblyMetrics;
  assemblySolveMs: number;
  candidateCount: number;
  invalid: boolean;
  warnings: string[];
}

export interface IsometricAssemblyOptions {
  iterations?: number;
  overlapBarrier?: boolean;
  zeroEnergyIterations?: number;
}

interface Component {
  id: string;
  meshIds: string[];
  seams: CoarseSeamConstraint[];
  relations: Relation[];
  cycleRank: number;
  parallelRelationCount: number;
  supportsShell: boolean;
}

interface Relation {
  key: string;
  a: string;
  b: string;
  seamGroupId: string;
  sampleCount: number;
}

interface Candidate {
  name: string;
  positions: Map<string, Float32Array>;
  project?: boolean;
}

interface CandidateScore {
  candidate: Candidate;
  metrics: IsometricAssemblyMetrics;
  score: number;
}

interface ProjectionBuffer {
  sum: Float64Array;
  weight: Float64Array;
}

/**
 * Geometric STEP-0 embedding. This is deliberately not a cloth simulation:
 * there is no velocity, mass, gravity, timestep or physical history. The
 * variables are coarse surface vertices. Triangle-edge metric constraints
 * preserve the material first fundamental form approximately while shared
 * internal hinges remain free to bend. All panels in a connected component
 * are updated from one Jacobi projection pass, so no first-visit placement is
 * frozen as the final answer.
 */
export function solveIsometricSurfaceAssembly(
  state: GarmentAssemblyState,
  coarse: CoarseAssemblySet,
  seams: CoarseSeamResolution,
  options: IsometricAssemblyOptions = {},
): IsometricSurfaceAssemblyResult {
  const started = nowMs();
  const warnings = [...seams.warnings];
  const components = buildComponents(coarse, seams);
  const diagnostics: IsometricAssemblyComponentDiagnostic[] = [];
  let candidateCount = 0;

  for (const component of components) {
    const componentStarted = nowMs();
    const candidates = buildCandidates(component, coarse);
    candidateCount += candidates.length;
    const solved = candidates.map((candidate) => {
      setComponentPositions(component, coarse, candidate.positions);
      if (candidate.project !== false) {
        preAlignComponentRigidTranslations(component, coarse);
        projectComponent(component, coarse, options);
      }
      const metrics = measureComponentMetrics(component, coarse);
      return {
        candidate: snapshotCandidate(candidate.name, component, coarse),
        metrics,
        score: objective(metrics, component),
      };
    });
    solved.sort((left, right) =>
      candidateAdmissibilityRank(left.metrics) - candidateAdmissibilityRank(right.metrics)
      || left.score - right.score
      || left.candidate.name.localeCompare(right.candidate.name),
    );
    const best = solved[0];
    if (!best) continue;
    setComponentPositions(component, coarse, best.candidate.positions);
    const prePolish = snapshotCandidate("pre-zero-energy-polish", component, coarse);
    polishZeroEnergyPose(component, coarse, options);
    let finalMetrics = measureComponentMetrics(component, coarse);
    if (!zeroEnergyPolishPreservesMaterial(best.metrics, finalMetrics)) {
      // An incompatible/under-resolved constraint system must never purchase a
      // smaller seam residual by damaging the material surface. Keep the
      // readable isometric candidate and report its residual explicitly.
      setComponentPositions(component, coarse, prePolish.positions);
      finalMetrics = best.metrics;
    }
    const constraint = classifyConstraintState(component, finalMetrics, solved);
    diagnostics.push({
      componentId: component.id,
      panelInstanceIds: [...component.meshIds],
      structuralRelationCount: component.relations.length,
      cycleRank: component.cycleRank,
      parallelRelationCount: component.parallelRelationCount,
      freeBoundaryEstimate: estimateFreeBoundaries(component, coarse),
      selectedSeed: best.candidate.name,
      candidateCount: candidates.length,
      candidateDiagnostics: solved.map((candidate) => ({
        name: candidate.candidate.name,
        score: candidate.score,
        metrics: candidate.metrics,
      })),
      constraintState: constraint.state,
      assemblyConfidence: constraint.confidence,
      ...(constraint.reason ? { ambiguityReason: constraint.reason } : {}),
      solveMs: nowMs() - componentStarted,
      ...finalMetrics,
    });
  }

  const metrics = aggregateMetrics(diagnostics);
  const invalid = coarse.meshes.some((mesh) => [...mesh.positions].some((value) => !Number.isFinite(value)));
  if (invalid) warnings.push("O solver isométrico produziu uma posição coarse não finita.");
  return {
    strategy: "coarse-isometric-surface",
    components: diagnostics,
    metrics,
    assemblySolveMs: nowMs() - started,
    candidateCount,
    invalid,
    warnings,
  };
}

function candidateAdmissibilityRank(metrics: IsometricAssemblyMetrics): number {
  // A numerically cheaper candidate that self-overlaps heavily is not a dress
  // pose.  Keep this as an admissibility gate instead of letting a weighted
  // scalar objective trade a collapsed/hidden surface for a slightly smaller
  // local metric residual.
  if (metrics.overlapScore > 0.5 || metrics.triangleCrossingProxyCount > 8_000) return 2;
  if (metrics.overlapScore > 0.2 || metrics.triangleCrossingProxyCount > 4_000) return 1;
  return 0;
}

function zeroEnergyPolishPreservesMaterial(
  before: IsometricAssemblyMetrics,
  after: IsometricAssemblyMetrics,
): boolean {
  return after.metricDistortionMean <= Math.max(0.005, before.metricDistortionMean * 1.5)
    && after.metricDistortionMax <= Math.max(0.01, before.metricDistortionMax * 1.5)
    && after.areaDistortionMean <= Math.max(0.02, before.areaDistortionMean * 1.5)
    && after.overlapScore <= before.overlapScore + 0.05;
}

/**
 * Final STEP-0 geometric projection.
 *
 * This is intentionally not XPBD: it has no mass, velocity, timestep,
 * compliance, gravity or collision. It solves the intersection between the
 * immutable material bars and authored zero-distance closures. Every material
 * edge is projected back to its 2D length after seam projection, so a seam is
 * never closed by silently changing how much cloth exists.
 *
 * The coarse candidate solver above remains responsible for selecting a
 * readable spatial branch. This pass only removes the residual energy that
 * would otherwise make the dynamic solver act as an assembly solver.
 */
function polishZeroEnergyPose(
  component: Component,
  coarse: CoarseAssemblySet,
  options: IsometricAssemblyOptions,
): void {
  const closures = component.seams.filter((seam) =>
    seam.classification === "structural-alignment"
    || seam.classification === "local-shaping-closure",
  );
  if (closures.length === 0) return;

  const iterations = Math.max(
    0,
    Math.min(4_000, Math.round(options.zeroEnergyIterations ?? DEFAULT_ZERO_ENERGY_ITERATIONS)),
  );
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    // A symmetric order avoids giving either the material metric or seams the
    // last word. Reversing alternate passes also removes insertion-order bias.
    for (const id of component.meshIds) {
      const mesh = coarse.byInstanceId.get(id)!;
      projectMetricEdgesSequential(mesh, iteration % 2 === 1);
    }
    projectClosuresSequential(coarse, closures, iteration % 2 === 1);
    for (const id of component.meshIds) {
      const mesh = coarse.byInstanceId.get(id)!;
      projectMetricEdgesSequential(mesh, iteration % 2 === 0);
    }
    projectClosuresSequential(coarse, closures, iteration % 2 === 0);

    if (iteration >= 24 && iteration % 8 === 7) {
      const residual = zeroEnergyResidual(component, coarse, closures);
      if (
        residual.maximumMetricRelative <= ZERO_ENERGY_METRIC_TOLERANCE
        && residual.maximumSeamM <= ZERO_ENERGY_SEAM_TOLERANCE_M
      ) break;
    }
  }
}

function projectMetricEdgesSequential(mesh: CoarseAssemblyMesh, reverse: boolean): void {
  const edges = mesh.metricEdges;
  for (let cursor = 0; cursor < edges.length; cursor += 1) {
    const edge = edges[reverse ? edges.length - 1 - cursor : cursor];
    const a = vertex(mesh.positions, edge.a);
    const b = vertex(mesh.positions, edge.b);
    const delta = sub(b, a);
    const current = length3(delta);
    if (current <= EPS || edge.restLengthM <= EPS) continue;
    const correction = (current - edge.restLengthM) * 0.5 / current;
    translateVertex(mesh.positions, edge.a, scale(delta, correction));
    translateVertex(mesh.positions, edge.b, scale(delta, -correction));
  }
}

function projectClosuresSequential(
  coarse: CoarseAssemblySet,
  closures: readonly CoarseSeamConstraint[],
  reverse: boolean,
): void {
  for (let cursor = 0; cursor < closures.length; cursor += 1) {
    const seam = closures[reverse ? closures.length - 1 - cursor : cursor];
    const meshA = coarse.byInstanceId.get(seam.instanceA);
    const meshB = coarse.byInstanceId.get(seam.instanceB);
    if (!meshA || !meshB) continue;
    const a = evaluateCoarseBinding(meshA, seam.a);
    const b = evaluateCoarseBinding(meshB, seam.b);
    const delta = sub(b, a);
    const distance = length3(delta);
    if (distance <= EPS) continue;
    const rest = Math.max(0, seam.restDistanceM);
    const excess = distance - rest;
    if (Math.abs(excess) <= EPS) continue;
    const correction = scale(
      delta,
      excess * 0.5 / distance * ZERO_ENERGY_SEAM_RELAXATION,
    );
    translateBinding(meshA, seam.a, correction);
    translateBinding(meshB, seam.b, scale(correction, -1));
  }
}

function translateBinding(
  mesh: CoarseAssemblyMesh,
  binding: CoarseMaterialBinding,
  translation: readonly [number, number, number],
): void {
  const squaredWeight = binding.weights.reduce((sum, weight) => sum + weight * weight, 0);
  if (squaredWeight <= EPS) return;
  for (let index = 0; index < binding.vertices.length; index += 1) {
    const factor = binding.weights[index] / squaredWeight;
    translateVertex(mesh.positions, binding.vertices[index], scale(translation, factor));
  }
}

function translateVertex(
  positions: Float32Array,
  index: number,
  translation: readonly [number, number, number],
): void {
  const offset = index * 3;
  positions[offset] += translation[0];
  positions[offset + 1] += translation[1];
  positions[offset + 2] += translation[2];
}

function zeroEnergyResidual(
  component: Component,
  coarse: CoarseAssemblySet,
  closures: readonly CoarseSeamConstraint[],
): { maximumMetricRelative: number; maximumSeamM: number } {
  let maximumMetricRelative = 0;
  let maximumSeamM = 0;
  for (const id of component.meshIds) {
    const mesh = coarse.byInstanceId.get(id)!;
    for (const edge of mesh.metricEdges) {
      if (edge.restLengthM <= EPS) continue;
      const current = length3(sub(vertex(mesh.positions, edge.b), vertex(mesh.positions, edge.a)));
      maximumMetricRelative = Math.max(
        maximumMetricRelative,
        Math.abs(current - edge.restLengthM) / edge.restLengthM,
      );
    }
  }
  for (const seam of closures) {
    const meshA = coarse.byInstanceId.get(seam.instanceA);
    const meshB = coarse.byInstanceId.get(seam.instanceB);
    if (!meshA || !meshB) continue;
    const distance = length3(sub(
      evaluateCoarseBinding(meshB, seam.b),
      evaluateCoarseBinding(meshA, seam.a),
    ));
    maximumSeamM = Math.max(maximumSeamM, Math.abs(distance - Math.max(0, seam.restDistanceM)));
  }
  return { maximumMetricRelative, maximumSeamM };
}

function buildComponents(coarse: CoarseAssemblySet, seamResolution: CoarseSeamResolution): Component[] {
  const meshIds = coarse.meshes.map((mesh) => mesh.panelInstanceId).sort();
  const adjacency = new Map(meshIds.map((id) => [id, new Set<string>()]));
  const relationSamples = new Map<string, Relation>();
  for (const seam of seamResolution.constraints) {
    // Connectivity and metric compatibility are separate concerns. Inter-panel
    // ease/gather seams still define the garment shell, even though the exact
    // projector may not stretch them closed. A dart is a local closure: letting
    // it increase cycle rank made a small intake compete with side seams and
    // occasionally promoted it to the dominant garment loop.
    if (seam.instanceA !== seam.instanceB) {
      adjacency.get(seam.instanceA)?.add(seam.instanceB);
      adjacency.get(seam.instanceB)?.add(seam.instanceA);
    }
    if (!participatesInShellTopology(seam)) continue;
    const pair = seam.instanceA <= seam.instanceB
      ? `${seam.instanceA}|${seam.instanceB}`
      : `${seam.instanceB}|${seam.instanceA}`;
    const key = `${pair}|${seam.seamGroupId}`;
    if (!relationSamples.has(key)) {
      relationSamples.set(key, {
        key,
        a: seam.instanceA <= seam.instanceB ? seam.instanceA : seam.instanceB,
        b: seam.instanceA <= seam.instanceB ? seam.instanceB : seam.instanceA,
        seamGroupId: seam.seamGroupId,
        sampleCount: 0,
      });
    }
    relationSamples.get(key)!.sampleCount += 1;
  }
  const relations = [...relationSamples.values()].sort((a, b) => a.key.localeCompare(b.key));
  const visited = new Set<string>();
  const result: Component[] = [];
  for (const root of meshIds) {
    if (visited.has(root)) continue;
    const queue = [root];
    visited.add(root);
    const nodes: string[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      nodes.push(current);
      for (const next of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    nodes.sort();
    const nodeSet = new Set(nodes);
    const componentRelations = relations.filter((relation) => nodeSet.has(relation.a) && nodeSet.has(relation.b));
    const componentSeams = seamResolution.constraints
    .filter((seam) => nodeSet.has(seam.instanceA) && nodeSet.has(seam.instanceB))
    .sort((left, right) =>
      left.seamGroupId.localeCompare(right.seamGroupId)
      || left.instanceA.localeCompare(right.instanceA)
      || left.instanceB.localeCompare(right.instanceB)
      || left.progress - right.progress
      || left.id.localeCompare(right.id),
    );
    const nonSelfEdges = componentRelations.filter((relation) => relation.a !== relation.b).length;
    const selfEdges = componentRelations.filter((relation) => relation.a === relation.b).length;
    const cycleRank = Math.max(0, nonSelfEdges - Math.max(0, nodes.length - 1)) + selfEdges;
    const pairCounts = new Map<string, number>();
    for (const relation of componentRelations) {
      const pair = `${relation.a}|${relation.b}`;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }
    const parallelRelationCount = [...pairCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    result.push({
      id: `coarse-component:${result.length + 1}:${nodes.join("+")}`,
      meshIds: nodes,
      seams: componentSeams,
      relations: componentRelations,
      cycleRank,
      parallelRelationCount,
      supportsShell: cycleRank > 0 || parallelRelationCount > 0,
    });
  }
  return result;
}

function buildCandidates(component: Component, coarse: CoarseAssemblySet): Candidate[] {
  const authoredDevelopable = snapshotCandidate("authored-developable-seed", component, coarse);
  const flat = buildFlatCandidate(component, coarse);
  const developable = buildDevelopableCandidate(component, coarse);
  const metricRelaxed = relaxCandidateMaterialMetric(
    component,
    coarse,
    developable,
    "developable-metric-restored",
  );
  const metricRelaxedRaw: Candidate = {
    name: "developable-metric-restored-raw",
    positions: new Map([...metricRelaxed.positions].map(([id, values]) => [id, new Float32Array(values)])),
    project: false,
  };
  const materialFramed = transportCandidateThroughSurfaceFrames(
    component,
    coarse,
    authoredDevelopable,
    developable,
    "material-framed-shell-seed",
  );
  const structurallyAligned = alignCandidateAlongStructuralTree(
    component,
    coarse,
    materialFramed,
    developable,
    "material-preserving-shell-seed",
  );
  const materialPreserving = alignStructuralIslandsByAttachments(
    component,
    coarse,
    structurallyAligned,
  );
  const materialPreservingRaw: Candidate = {
    name: "material-preserving-shell-raw",
    positions: new Map([...materialPreserving.positions].map(([id, values]) => [id, new Float32Array(values)])),
    project: false,
  };
  const developableRaw: Candidate = {
    name: "developable-cycle-raw",
    positions: new Map([...developable.positions].map(([id, values]) => [id, new Float32Array(values)])),
    project: false,
  };
  const mirrored = mirrorCandidate(developable, "developable-cycle-mirror");
  const materialPreservingMirror = mirrorCandidate(
    materialPreserving,
    "material-preserving-shell-mirror",
  );
  const hinged = buildAmbiguousHingeCandidate(component, coarse, flat);
  const hingedMirror = mirrorCandidate(hinged, "ambiguous-hinge-mirror");
  const candidates = component.supportsShell
    ? [
        authoredDevelopable,
        flat,
        metricRelaxedRaw,
        metricRelaxed,
        materialPreservingRaw,
        materialPreserving,
        materialPreservingMirror,
        developableRaw,
        developable,
        mirrored,
      ]
    : [authoredDevelopable, flat, developable, hinged, hingedMirror];
  return dedupeCandidates(candidates);
}

function buildAmbiguousHingeCandidate(
  component: Component,
  coarse: CoarseAssemblySet,
  flat: Candidate,
): Candidate {
  const ids = [...component.meshIds].sort();
  const positions = new Map<string, Float32Array>();
  const centerRank = (ids.length - 1) * 0.5;

  for (let rank = 0; rank < ids.length; rank += 1) {
    const id = ids[rank];
    const source = flat.positions.get(id);
    const mesh = coarse.byInstanceId.get(id);
    if (!source || !mesh) continue;

    const target = new Float32Array(source);
    const center = centroidOfPositions(target);
    const axis = preferredAmbiguousHingeAxis(component, mesh, id);
    // Underconstrained components have mathematically equivalent hinge families.
    // Pick one deterministic, mild member of that family. This is only a seed:
    // all seams, metric constraints and overlap barriers still participate in
    // the subsequent global solve. The transform is rigid, so it adds no
    // artificial stretch/shear to material space.
    const rankOffset = rank - centerRank;
    const angle = clamp(rankOffset * 0.42, -0.72, 0.72);
    for (let offset = 0; offset < target.length; offset += 3) {
      const rotated = rotateAroundAxis(
        [target[offset], target[offset + 1], target[offset + 2]],
        center,
        axis,
        angle,
      );
      target[offset] = rotated[0];
      target[offset + 1] = rotated[1];
      target[offset + 2] = rotated[2];
    }
    positions.set(id, target);
  }
  return { name: "ambiguous-hinge-seed", positions };
}

function preferredAmbiguousHingeAxis(
  component: Component,
  mesh: CoarseAssemblyMesh,
  id: string,
): readonly [number, number, number] {
  const materialSamples: Array<readonly [number, number]> = [];
  for (const seam of component.seams) {
    if (!participatesInShellTopology(seam)) continue;
    if (seam.instanceA === id) materialSamples.push([seam.a.materialXMm, seam.a.materialYMm]);
    if (seam.instanceB === id) materialSamples.push([seam.b.materialXMm, seam.b.materialYMm]);
  }

  if (materialSamples.length >= 2) {
    const meanX = materialSamples.reduce((sum, point) => sum + point[0], 0) / materialSamples.length;
    const meanY = materialSamples.reduce((sum, point) => sum + point[1], 0) / materialSamples.length;
    const varianceX = materialSamples.reduce((sum, point) => sum + (point[0] - meanX) ** 2, 0);
    const varianceY = materialSamples.reduce((sum, point) => sum + (point[1] - meanY) ** 2, 0);
    if (varianceX > varianceY * 1.05) return [1, 0, 0];
    if (varianceY > varianceX * 1.05) return [0, -1, 0];
  }

  const bounds = materialBounds(mesh);
  return (bounds.maxX - bounds.minX) >= (bounds.maxY - bounds.minY)
    ? [1, 0, 0]
    : [0, -1, 0];
}

function buildFlatCandidate(component: Component, coarse: CoarseAssemblySet): Candidate {
  const positions = new Map<string, Float32Array>();
  const meshes = component.meshIds.map((id) => coarse.byInstanceId.get(id)!).filter(Boolean);
  let cursorX = 0;
  for (const mesh of meshes) {
    const bounds = materialBounds(mesh);
    const target = new Float32Array(mesh.materialPositionsMm.length / 2 * 3);
    for (let vertex = 0; vertex < mesh.materialPositionsMm.length / 2; vertex += 1) {
      const offset = vertex * 3;
      target[offset] = cursorX + (mesh.materialPositionsMm[vertex * 2] - bounds.minX) * 0.001;
      target[offset + 1] = -(mesh.materialPositionsMm[vertex * 2 + 1] - bounds.minY) * 0.001;
      target[offset + 2] = 0;
    }
    positions.set(mesh.panelInstanceId, target);
    cursorX += (bounds.maxX - bounds.minX) * 0.001 + 0.08;
  }
  return { name: "material-flat-seed", positions };
}

function buildDevelopableCandidate(component: Component, coarse: CoarseAssemblySet): Candidate {
  const base = buildFlatCandidate(component, coarse);
  if (!component.supportsShell) return { name: "open-developable-seed", positions: base.positions };

  const selectedCycle = findHighestAreaCycle(component, coarse);
  const shellIds = selectedCycle.length > 0 ? selectedCycle : component.meshIds;
  const spans = shellIds.map((id) => acrossAxis(
    coarse.byInstanceId.get(id)!,
    selfStructuralSeams(component, id),
  ));
  const seeded = new Set<string>();

  const profiledShell = selectedCycle.length > 1
    ? mapProfiledShellCycle(component, selectedCycle, spans, coarse)
    : null;
  if (profiledShell) {
    for (const [id, positions] of profiledShell) {
      base.positions.set(id, positions);
      seeded.add(id);
    }
  } else {
    const circumferenceM = spans.reduce((sum, span) => sum + span.acrossSpanMm * 0.001, 0);
    const radius = Math.max(0.025, circumferenceM / (2 * Math.PI));
    let angleCursor = 0;
    for (let index = 0; index < shellIds.length; index += 1) {
      const id = shellIds[index];
      const mesh = coarse.byInstanceId.get(id)!;
      const axis = spans[index];
      const angularSpan = Math.max(0.12, axis.acrossSpanMm * 0.001 / radius);
      const centerAngle = angleCursor + angularSpan * 0.5;
      const acrossDirection = selectedCycle.length > 1
        ? cycleAcrossDirection(component, id, selectedCycle, index, axis)
        : 1;
      base.positions.set(id, mapMeshToCylinder(mesh, axis, radius, centerAngle, acrossDirection));
      seeded.add(id);
      angleCursor += angularSpan;
    }
  }

  // Small loops/branches are only seed attachments. They never freeze or own
  // the component. A self-sewn strip is mapped developably, then translated
  // near the already seeded material relation before the global solve.
  for (const id of component.meshIds) {
    if (seeded.has(id)) continue;
    const mesh = coarse.byInstanceId.get(id)!;
    const hasSelf = component.relations.some((relation) => relation.a === id && relation.b === id);
    if (hasSelf) {
      const axis = acrossAxis(mesh, selfStructuralSeams(component, id));
      const closed = mapSelfClosedMeshToCylinder(component, mesh, axis);
      const localRadius = Math.max(0.01, axis.acrossSpanMm * 0.001 / (2 * Math.PI));
      base.positions.set(id, closed ?? mapMeshToCylinder(mesh, axis, localRadius, 0));
      phaseAlignClosedSeed(id, seeded, component, coarse, base.positions);
    } else {
      translateSeedNearConnectedSeam(id, seeded, component, coarse, base.positions);
    }
    seeded.add(id);
  }
  return { name: "developable-cycle-seed", positions: base.positions };
}

function relaxCandidateMaterialMetric(
  component: Component,
  coarse: CoarseAssemblySet,
  candidate: Candidate,
  name: string,
): Candidate {
  setComponentPositions(component, coarse, candidate.positions);
  for (let iteration = 0; iteration < 1_200; iteration += 1) {
    for (const id of component.meshIds) {
      projectMetricEdgesSequential(coarse.byInstanceId.get(id)!, iteration % 2 === 1);
    }
  }
  return snapshotCandidate(name, component, coarse);
}

/**
 * Uses the graph-derived shell only as an arrangement guide.  Every authored
 * panel surface (including an already developed dart) is transported by one
 * rigid transform, so taper, mirror parity and the material first fundamental
 * form are never replaced by the cylindrical seed itself.
 */
function transportCandidateThroughSurfaceFrames(
  component: Component,
  coarse: CoarseAssemblySet,
  material: Candidate,
  target: Candidate,
  name: string,
): Candidate {
  const positions = new Map<string, Float32Array>();
  for (const [id, source] of material.positions) {
    const guide = target.positions.get(id);
    const mesh = coarse.byInstanceId.get(id);
    if (!mesh || !guide || guide.length !== source.length) {
      positions.set(id, new Float32Array(source));
      continue;
    }
    const selfClosed = selfStructuralSeams(component, id).length >= 2;
    const hasLocalShaping = component.seams.some((seam) =>
      seam.classification === "local-shaping-closure"
      && (seam.instanceA === id || seam.instanceB === id));
    if (selfClosed && !hasLocalShaping) {
      // A self-sewn surface already has a graph-derived developable seed.
      // Replacing it with a rigidly moved flat chart re-opens its closure and
      // forces XPBD to manufacture the tube. Keep the developed local shell;
      // attachment seams will place the complete shell as one rigid island.
      positions.set(id, new Float32Array(guide));
      continue;
    }
    const sourceFrame = materialSurfaceFrame(mesh, source);
    const targetFrame = materialSurfaceFrame(mesh, guide);
    if (!sourceFrame || !targetFrame) {
      positions.set(id, new Float32Array(source));
      continue;
    }
    const sourcePoints = frameFitPoints(sourceFrame);
    const targetPoints = frameFitPoints(targetFrame);
    positions.set(id, transformPositionsRigidly(
      source,
      bestRigidPointFit(sourcePoints, targetPoints),
    ));
  }
  return { name, positions };
}

/**
 * Structural seams define independent material shells.  Intentional mismatch
 * seams (ease/gather/stretch) connect those shells but must not redefine their
 * topology.  Once every shell has been developed, place each complete island
 * with one rigid transform against already placed neighbours.  This keeps a
 * closed sleeve/body tube closed while bringing its attachment curve near the
 * corresponding armhole without stretching either 2D chart.
 */
function alignStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
  candidate: Candidate,
): Candidate {
  const islands = structuralIslands(component);
  if (islands.length < 2) return candidate;
  const positions: Map<string, Float32Array> = new Map(
    [...candidate.positions].map(([id, values]) => [id, new Float32Array(values)]),
  );
  islands.sort((left, right) =>
    structuralIslandScore(right, component, coarse) - structuralIslandScore(left, component, coarse)
    || left.join("|").localeCompare(right.join("|")),
  );
  const placed = new Set(islands[0]);
  const remaining = islands.slice(1);

  while (remaining.length > 0) {
    let selectedIndex = -1;
    let selectedAttachments: CoarseSeamConstraint[] = [];
    for (let index = 0; index < remaining.length; index += 1) {
      const island = new Set(remaining[index]);
      const attachments = component.seams.filter((seam) =>
        seam.classification === "intentional-mismatch"
        && ((island.has(seam.instanceA) && placed.has(seam.instanceB))
          || (island.has(seam.instanceB) && placed.has(seam.instanceA))));
      if (attachments.length > selectedAttachments.length) {
        selectedIndex = index;
        selectedAttachments = attachments;
      }
    }
    if (selectedIndex < 0 || selectedAttachments.length === 0) break;
    const island = remaining.splice(selectedIndex, 1)[0];
    const islandSet = new Set(island);
    const sourcePoints: Array<readonly [number, number, number]> = [];
    const targetPoints: Array<readonly [number, number, number]> = [];
    for (const seam of selectedAttachments) {
      const localIsA = islandSet.has(seam.instanceA);
      const localId = localIsA ? seam.instanceA : seam.instanceB;
      const fixedId = localIsA ? seam.instanceB : seam.instanceA;
      const localBinding = localIsA ? seam.a : seam.b;
      const fixedBinding = localIsA ? seam.b : seam.a;
      const local = positions.get(localId);
      const fixed = positions.get(fixedId);
      if (!local || !fixed) continue;
      sourcePoints.push(evaluateBindingOnPositions(local, localBinding));
      targetPoints.push(evaluateBindingOnPositions(fixed, fixedBinding));
    }
    if (sourcePoints.length > 0) {
      const fit = bestRigidPointFit(sourcePoints, targetPoints);
      for (const id of island) {
        const source = positions.get(id);
        if (source) positions.set(id, transformPositionsRigidly(source, fit));
        placed.add(id);
      }
    }
  }
  return { ...candidate, positions };
}

function structuralIslands(component: Component): string[][] {
  const adjacency = new Map(component.meshIds.map((id) => [id, new Set<string>()]));
  for (const seam of component.seams) {
    if (seam.classification !== "structural-alignment" || seam.instanceA === seam.instanceB) continue;
    adjacency.get(seam.instanceA)?.add(seam.instanceB);
    adjacency.get(seam.instanceB)?.add(seam.instanceA);
  }
  const visited = new Set<string>();
  const islands: string[][] = [];
  for (const root of [...component.meshIds].sort()) {
    if (visited.has(root)) continue;
    const queue = [root];
    const island: string[] = [];
    visited.add(root);
    while (queue.length > 0) {
      const current = queue.shift()!;
      island.push(current);
      for (const next of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    islands.push(island.sort());
  }
  return islands;
}

function structuralIslandScore(
  ids: readonly string[],
  component: Component,
  coarse: CoarseAssemblySet,
): number {
  const members = new Set(ids);
  const area = ids.reduce((sum, id) => sum + (coarse.byInstanceId.get(id)?.materialAreaM2 ?? 0), 0);
  const structuralSamples = component.seams.filter((seam) =>
    seam.classification === "structural-alignment"
    && members.has(seam.instanceA)
    && members.has(seam.instanceB)).length;
  return area + structuralSamples * 1e-6;
}

interface MaterialSurfaceFrame {
  center: readonly [number, number, number];
  x: readonly [number, number, number];
  y: readonly [number, number, number];
  normal: readonly [number, number, number];
}

function materialSurfaceFrame(
  mesh: CoarseAssemblyMesh,
  positions: Float32Array,
): MaterialSurfaceFrame | null {
  const bounds = materialBounds(mesh);
  const targetX = (bounds.minX + bounds.maxX) * 0.5;
  const targetY = (bounds.minY + bounds.maxY) * 0.5;
  const diagonalSquared = Math.max(
    1,
    (bounds.maxX - bounds.minX) ** 2 + (bounds.maxY - bounds.minY) ** 2,
  );
  let selected: readonly [number, number, number] | null = null;
  let selectedScore = Number.POSITIVE_INFINITY;
  let maximumArea = 0;
  for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
    maximumArea = Math.max(maximumArea, triangleMaterialArea(
      mesh,
      mesh.triangles[offset],
      mesh.triangles[offset + 1],
      mesh.triangles[offset + 2],
    ));
  }
  for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
    const a = mesh.triangles[offset];
    const b = mesh.triangles[offset + 1];
    const c = mesh.triangles[offset + 2];
    const area = triangleMaterialArea(mesh, a, b, c);
    if (area <= EPS) continue;
    const x = (
      mesh.materialPositionsMm[a * 2]
      + mesh.materialPositionsMm[b * 2]
      + mesh.materialPositionsMm[c * 2]
    ) / 3;
    const y = (
      mesh.materialPositionsMm[a * 2 + 1]
      + mesh.materialPositionsMm[b * 2 + 1]
      + mesh.materialPositionsMm[c * 2 + 1]
    ) / 3;
    const score = ((x - targetX) ** 2 + (y - targetY) ** 2) / diagonalSquared
      + maximumArea / area * 1e-4;
    if (score < selectedScore) {
      selected = [a, b, c];
      selectedScore = score;
    }
  }
  if (!selected) return null;

  const [a, b, c] = selected;
  const ua = mesh.materialPositionsMm[a * 2];
  const va = mesh.materialPositionsMm[a * 2 + 1];
  const ub = mesh.materialPositionsMm[b * 2];
  const vb = mesh.materialPositionsMm[b * 2 + 1];
  const uc = mesh.materialPositionsMm[c * 2];
  const vc = mesh.materialPositionsMm[c * 2 + 1];
  const du1 = ub - ua;
  const dv1 = vb - va;
  const du2 = uc - ua;
  const dv2 = vc - va;
  const determinant = du1 * dv2 - dv1 * du2;
  if (Math.abs(determinant) <= EPS) return null;

  const pa = vertex(positions, a);
  const pb = vertex(positions, b);
  const pc = vertex(positions, c);
  const edge1 = sub(pb, pa);
  const edge2 = sub(pc, pa);
  const derivativeX = scale(sub(scale(edge1, dv2), scale(edge2, dv1)), 1 / determinant);
  const derivativeY = scale(sub(scale(edge2, du1), scale(edge1, du2)), 1 / determinant);
  const x = normalize(derivativeX);
  const y = normalize(sub(derivativeY, scale(x, dot(derivativeY, x))));
  const normal = normalize(cross(x, y));
  if (length3(x) <= EPS || length3(y) <= EPS || length3(normal) <= EPS) return null;
  return {
    center: scale(add(add(pa, pb), pc), 1 / 3),
    x,
    y,
    normal,
  };
}

function frameFitPoints(frame: MaterialSurfaceFrame): Array<readonly [number, number, number]> {
  const span = 0.1;
  return [
    frame.center,
    add(frame.center, scale(frame.x, span)),
    add(frame.center, scale(frame.y, span)),
    add(frame.center, scale(frame.normal, span)),
  ];
}

/**
 * Closes a deterministic spanning tree with rigid panel transforms only. The
 * remaining cycle edge is deliberately left as a residual instead of buying
 * closure with stretch. This gives the global solver a near-shell seed while
 * preserving every authored dart/developable surface exactly.
 */
function alignCandidateAlongStructuralTree(
  component: Component,
  coarse: CoarseAssemblySet,
  candidate: Candidate,
  guide: Candidate,
  name: string,
): Candidate {
  const positions: Map<string, Float32Array> = new Map(
    [...candidate.positions].map(([id, values]) => [id, new Float32Array(values)]),
  );
  const structural = component.seams.filter((seam) =>
    participatesInShellTopology(seam) && seam.instanceA !== seam.instanceB);
  const ids = [...component.meshIds].sort();
  if (ids.length < 2 || structural.length === 0) return { name, positions };

  const placed = new Set<string>([ids[0]]);
  while (placed.size < ids.length) {
    let progressed = false;
    for (const id of ids) {
      if (placed.has(id)) continue;
      const relevant = structural.filter((seam) =>
        (seam.instanceA === id && placed.has(seam.instanceB))
        || (seam.instanceB === id && placed.has(seam.instanceA)));
      if (relevant.length === 0) continue;
      const local = positions.get(id);
      const mesh = coarse.byInstanceId.get(id);
      if (!local || !mesh) continue;
      const sourcePoints: Array<readonly [number, number, number]> = [];
      const targetPoints: Array<readonly [number, number, number]> = [];
      for (const seam of relevant) {
        const localBinding = seam.instanceA === id ? seam.a : seam.b;
        const fixedId = seam.instanceA === id ? seam.instanceB : seam.instanceA;
        const fixedBinding = seam.instanceA === id ? seam.b : seam.a;
        const fixed = positions.get(fixedId);
        if (!fixed) continue;
        sourcePoints.push(evaluateBindingOnPositions(local, localBinding));
        targetPoints.push(evaluateBindingOnPositions(fixed, fixedBinding));
      }
      if (sourcePoints.length === 0) continue;

      // Samples on a straight seam leave twist underconstrained. Retain the
      // graph-derived outward side with one frame-normal witness; seam samples
      // still dominate its translation and tangent fit.
      const localFrame = materialSurfaceFrame(mesh, local);
      const guidePositions = guide.positions.get(id);
      const guideFrame = guidePositions ? materialSurfaceFrame(mesh, guidePositions) : null;
      if (localFrame && guideFrame) {
        const sourceMid = centroidOfPointList(sourcePoints);
        const targetMid = centroidOfPointList(targetPoints);
        sourcePoints.push(add(sourceMid, scale(localFrame.normal, 0.04)));
        targetPoints.push(add(targetMid, scale(guideFrame.normal, 0.04)));
      }
      positions.set(id, transformPositionsRigidly(local, bestRigidPointFit(sourcePoints, targetPoints)));
      placed.add(id);
      progressed = true;
    }
    if (!progressed) break;
  }

  // Reconcile the one or more cycle-closing relations as a rigid pose graph.
  // The anchor remains fixed; every other node receives one O(3)-preserving
  // transform per Jacobi round. No vertex-level deformation is permitted here.
  const anchor = ids[0];
  for (let iteration = 0; iteration < 256; iteration += 1) {
    const snapshot = new Map([...positions].map(([id, values]) => [id, new Float32Array(values)]));
    const pending = new Map<string, Float32Array>();
    for (const id of ids) {
      if (id === anchor) continue;
      const local = snapshot.get(id);
      const mesh = coarse.byInstanceId.get(id);
      if (!local || !mesh) continue;
      const relevant = structural.filter((seam) => seam.instanceA === id || seam.instanceB === id);
      const sourcePoints: Array<readonly [number, number, number]> = [];
      const targetPoints: Array<readonly [number, number, number]> = [];
      for (const seam of relevant) {
        const localBinding = seam.instanceA === id ? seam.a : seam.b;
        const fixedId = seam.instanceA === id ? seam.instanceB : seam.instanceA;
        const fixedBinding = seam.instanceA === id ? seam.b : seam.a;
        const fixed = snapshot.get(fixedId);
        if (!fixed) continue;
        sourcePoints.push(evaluateBindingOnPositions(local, localBinding));
        targetPoints.push(evaluateBindingOnPositions(fixed, fixedBinding));
      }
      if (sourcePoints.length < 2) continue;
      const localFrame = materialSurfaceFrame(mesh, local);
      const guidePositions = guide.positions.get(id);
      const guideFrame = guidePositions ? materialSurfaceFrame(mesh, guidePositions) : null;
      if (localFrame && guideFrame) {
        const sourceMid = centroidOfPointList(sourcePoints);
        const targetMid = centroidOfPointList(targetPoints);
        sourcePoints.push(add(sourceMid, scale(localFrame.normal, 0.025)));
        targetPoints.push(add(targetMid, scale(guideFrame.normal, 0.025)));
      }
      const fit = dampRigidPointFit(bestRigidPointFit(sourcePoints, targetPoints), 0.58);
      pending.set(id, transformPositionsRigidly(local, fit));
    }
    for (const [id, values] of pending) positions.set(id, values);
  }
  return { name, positions };
}

function evaluateBindingOnPositions(
  positions: Float32Array,
  binding: CoarseMaterialBinding,
): readonly [number, number, number] {
  let x = 0; let y = 0; let z = 0;
  for (let index = 0; index < binding.vertices.length; index += 1) {
    const offset = binding.vertices[index] * 3;
    const weight = binding.weights[index];
    x += positions[offset] * weight;
    y += positions[offset + 1] * weight;
    z += positions[offset + 2] * weight;
  }
  return [x, y, z];
}

/**
 * Develops a self-sewn panel from the two authored seam generators instead
 * of its bounding box.  A sleeve cap, crotch extension or any other free
 * boundary is allowed to extend beyond those generators; it must not change
 * the circumference of the closed portion of the material.
 */
function mapSelfClosedMeshToCylinder(
  component: Component,
  mesh: CoarseAssemblyMesh,
  axis: ReturnType<typeof acrossAxis>,
): Float32Array | null {
  const self = component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && seam.instanceA === mesh.panelInstanceId
    && seam.instanceB === mesh.panelInstanceId,
  );
  if (self.length < 2) return null;
  const first = self.map((seam) => materialAxisSample(seam.a, axis));
  const second = self.map((seam) => materialAxisSample(seam.b, axis));
  const profileA: ShellBoundaryProfile = {
    samples: collapseBoundarySamples(first.sort((left, right) => left.along - right.along)),
    meanAcross: first.reduce((sum, sample) => sum + sample.across, 0) / first.length,
  };
  const profileB: ShellBoundaryProfile = {
    samples: collapseBoundarySamples(second.sort((left, right) => left.along - right.along)),
    meanAcross: second.reduce((sum, sample) => sum + sample.across, 0) / second.length,
  };
  if (Math.abs(profileA.meanAcross - profileB.meanAcross) < 1) return null;
  const low = profileA.meanAcross <= profileB.meanAcross ? profileA : profileB;
  const high = low === profileA ? profileB : profileA;
  const positions = new Float32Array(mesh.materialPositionsMm.length / 2 * 3);
  for (let vertexIndex = 0; vertexIndex < mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
    const materialX = mesh.materialPositionsMm[vertexIndex * 2];
    const materialY = mesh.materialPositionsMm[vertexIndex * 2 + 1];
    const across = axis.acrossIsX ? materialX : materialY;
    const along = axis.acrossIsX ? materialY : materialX;
    const lowAcross = sampleBoundaryAcross(low, along);
    const highAcross = sampleBoundaryAcross(high, along);
    const widthMm = Math.max(1, highAcross - lowAcross);
    const progress = (across - lowAcross) / widthMm;
    const angle = progress * Math.PI * 2;
    const radiusM = Math.max(0.01, widthMm * 0.001 / (Math.PI * 2));
    const offset = vertexIndex * 3;
    positions[offset] = Math.cos(angle) * radiusM;
    positions[offset + 1] = -along * 0.001;
    positions[offset + 2] = Math.sin(angle) * radiusM;
  }
  return positions;
}

function materialAxisSample(
  binding: CoarseMaterialBinding,
  axis: ReturnType<typeof acrossAxis>,
): { along: number; across: number } {
  return axis.acrossIsX
    ? { along: binding.materialYMm, across: binding.materialXMm }
    : { along: binding.materialXMm, across: binding.materialYMm };
}

interface ShellBoundaryProfile {
  samples: Array<{ along: number; across: number }>;
  meanAcross: number;
}

interface ShellPanelProfile {
  id: string;
  mesh: CoarseAssemblyMesh;
  axis: ReturnType<typeof acrossAxis>;
  incoming: ShellBoundaryProfile;
  outgoing: ShellBoundaryProfile;
}

/**
 * Maps a material cycle from the actual longitudinal seam curves instead of
 * from each panel's bounding box.  At every material height the accumulated
 * widths determine one shared circumference, so adjacent authored boundary
 * ranges land on the same spatial generator even when a torso/skirt tapers.
 * The map remains a seed; exact material bars are restored by the static
 * isometric projection below.
 */
function mapProfiledShellCycle(
  component: Component,
  cycle: readonly string[],
  axes: readonly ReturnType<typeof acrossAxis>[],
  coarse: CoarseAssemblySet,
): Map<string, Float32Array> | null {
  const panels: ShellPanelProfile[] = [];
  for (let index = 0; index < cycle.length; index += 1) {
    const id = cycle[index];
    const previous = cycle[(index - 1 + cycle.length) % cycle.length];
    const next = cycle[(index + 1) % cycle.length];
    const mesh = coarse.byInstanceId.get(id);
    const axis = axes[index];
    if (!mesh || !axis) return null;
    const incoming = selectLongitudinalBoundaryProfile(component, id, previous, axis);
    const outgoing = selectLongitudinalBoundaryProfile(component, id, next, axis);
    if (!incoming || !outgoing || Math.abs(incoming.meanAcross - outgoing.meanAcross) < 1) return null;
    panels.push({ id, mesh, axis, incoming, outgoing });
  }

  const result = new Map<string, Float32Array>();
  for (const panel of panels) {
    const positions = new Float32Array(panel.mesh.materialPositionsMm.length / 2 * 3);
    for (let vertexIndex = 0; vertexIndex < panel.mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
      const materialX = panel.mesh.materialPositionsMm[vertexIndex * 2];
      const materialY = panel.mesh.materialPositionsMm[vertexIndex * 2 + 1];
      const across = panel.axis.acrossIsX ? materialX : materialY;
      const along = panel.axis.acrossIsX ? materialY : materialX;
      const widths = panels.map((candidate) => {
        const incoming = sampleBoundaryAcross(candidate.incoming, along);
        const outgoing = sampleBoundaryAcross(candidate.outgoing, along);
        return Math.max(1e-3, Math.abs(outgoing - incoming));
      });
      const circumferenceMm = widths.reduce((sum, width) => sum + width, 0);
      if (circumferenceMm <= 1e-3) return null;
      const panelIndex = panels.indexOf(panel);
      const accumulatedMm = widths.slice(0, panelIndex).reduce((sum, width) => sum + width, 0);
      const incomingAcross = sampleBoundaryAcross(panel.incoming, along);
      const outgoingAcross = sampleBoundaryAcross(panel.outgoing, along);
      const signedWidth = outgoingAcross - incomingAcross;
      const progress = Math.abs(signedWidth) > 1e-6
        ? (across - incomingAcross) / signedWidth
        : 0.5;
      const arcMm = accumulatedMm + progress * widths[panelIndex];
      const angle = arcMm / circumferenceMm * Math.PI * 2;
      const radiusM = Math.max(0.01, circumferenceMm * 0.001 / (Math.PI * 2));
      const offset = vertexIndex * 3;
      positions[offset] = Math.cos(angle) * radiusM;
      positions[offset + 1] = -along * 0.001;
      positions[offset + 2] = Math.sin(angle) * radiusM;
    }
    result.set(panel.id, positions);
  }
  return result;
}

function selectLongitudinalBoundaryProfile(
  component: Component,
  id: string,
  neighbor: string,
  axis: ReturnType<typeof acrossAxis>,
): ShellBoundaryProfile | null {
  const byGroup = new Map<string, Array<{ along: number; across: number }>>();
  for (const seam of component.seams) {
    if (!participatesInShellTopology(seam)) continue;
    const matches = (seam.instanceA === id && seam.instanceB === neighbor)
      || (seam.instanceB === id && seam.instanceA === neighbor);
    if (!matches) continue;
    const binding = seam.instanceA === id ? seam.a : seam.b;
    const across = axis.acrossIsX ? binding.materialXMm : binding.materialYMm;
    const along = axis.acrossIsX ? binding.materialYMm : binding.materialXMm;
    const samples = byGroup.get(seam.seamGroupId) ?? [];
    samples.push({ along, across });
    byGroup.set(seam.seamGroupId, samples);
  }

  let best: ShellBoundaryProfile | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const samples of byGroup.values()) {
    if (samples.length < 2) continue;
    samples.sort((left, right) => left.along - right.along || left.across - right.across);
    const alongSpan = samples[samples.length - 1].along - samples[0].along;
    const acrossValues = samples.map((sample) => sample.across);
    const acrossSpan = Math.max(...acrossValues) - Math.min(...acrossValues);
    const score = alongSpan - acrossSpan * 0.75 + Math.sqrt(samples.length);
    if (score <= bestScore) continue;
    bestScore = score;
    best = {
      samples: collapseBoundarySamples(samples),
      meanAcross: acrossValues.reduce((sum, value) => sum + value, 0) / acrossValues.length,
    };
  }
  return best;
}

function collapseBoundarySamples(
  samples: readonly { along: number; across: number }[],
): Array<{ along: number; across: number }> {
  const result: Array<{ along: number; across: number }> = [];
  for (const sample of samples) {
    const previous = result[result.length - 1];
    if (previous && Math.abs(previous.along - sample.along) <= 1e-5) {
      previous.across = (previous.across + sample.across) * 0.5;
    } else {
      result.push({ ...sample });
    }
  }
  return result;
}

function sampleBoundaryAcross(profile: ShellBoundaryProfile, along: number): number {
  const samples = profile.samples;
  if (samples.length === 0) return profile.meanAcross;
  if (along <= samples[0].along) return samples[0].across;
  if (along >= samples[samples.length - 1].along) return samples[samples.length - 1].across;
  let upper = 1;
  while (upper < samples.length && samples[upper].along < along) upper += 1;
  const lower = samples[upper - 1];
  const next = samples[Math.min(upper, samples.length - 1)];
  const span = next.along - lower.along;
  if (span <= 1e-9) return (lower.across + next.across) * 0.5;
  const t = (along - lower.along) / span;
  return lower.across + (next.across - lower.across) * t;
}

function preAlignComponentRigidTranslations(
  component: Component,
  coarse: CoarseAssemblySet,
): void {
  const structural = component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && seam.instanceA !== seam.instanceB,
  );
  if (structural.length === 0) return;

  const groupCounts = new Map<string, number>();
  for (const seam of structural) {
    groupCounts.set(seam.seamGroupId, (groupCounts.get(seam.seamGroupId) ?? 0) + 1);
  }

  // Global Jacobi rigid-translation prealignment. Every relation votes in the
  // same iteration and no visited/frozen panel exists. Because each update is
  // a whole-panel translation, the material metric is preserved exactly.
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sums = new Map<string, { x: number; y: number; z: number; w: number }>(
      component.meshIds.map((id) => [id, { x: 0, y: 0, z: 0, w: 0 }]),
    );

    for (const seam of structural) {
      const meshA = coarse.byInstanceId.get(seam.instanceA);
      const meshB = coarse.byInstanceId.get(seam.instanceB);
      if (!meshA || !meshB) continue;
      const pa = evaluateCoarseBinding(meshA, seam.a);
      const pb = evaluateCoarseBinding(meshB, seam.b);
      const delta = sub(pb, pa);
      const distance = length3(delta);
      if (distance <= EPS) continue;
      const excess = Math.max(0, distance - Math.max(0, seam.restDistanceM));
      if (excess <= EPS) continue;
      const direction = scale(delta, 1 / distance);
      const correction = scale(direction, excess * 0.5);
      const groupWeight = 1 / Math.sqrt(groupCounts.get(seam.seamGroupId) ?? 1);
      const a = sums.get(seam.instanceA)!;
      const b = sums.get(seam.instanceB)!;
      a.x += correction[0] * groupWeight;
      a.y += correction[1] * groupWeight;
      a.z += correction[2] * groupWeight;
      a.w += groupWeight;
      b.x -= correction[0] * groupWeight;
      b.y -= correction[1] * groupWeight;
      b.z -= correction[2] * groupWeight;
      b.w += groupWeight;
    }

    let maximumTranslation = 0;
    for (const id of component.meshIds) {
      const sum = sums.get(id)!;
      if (sum.w <= EPS) continue;
      const mesh = coarse.byInstanceId.get(id)!;
      const blend = iteration < 3 ? 0.9 : 0.72;
      const translation: readonly [number, number, number] = [
        sum.x / sum.w * blend,
        sum.y / sum.w * blend,
        sum.z / sum.w * blend,
      ];
      maximumTranslation = Math.max(maximumTranslation, length3(translation));
      for (let offset = 0; offset < mesh.positions.length; offset += 3) {
        mesh.positions[offset] += translation[0];
        mesh.positions[offset + 1] += translation[1];
        mesh.positions[offset + 2] += translation[2];
      }
    }
    if (maximumTranslation < 0.00025) break;
  }
}

function projectComponent(component: Component, coarse: CoarseAssemblySet, options: IsometricAssemblyOptions): void {
  const iterations = Math.max(8, Math.min(240, Math.round(options.iterations ?? DEFAULT_ITERATIONS)));
  const shapingMeshIds = localShapingMeshIds(component);
  const initialGauge = new Map<string, readonly [number, number, number]>();
  for (const id of component.meshIds) {
    const mesh = coarse.byInstanceId.get(id)!;
    initialGauge.set(id, [mesh.positions[0], mesh.positions[1], mesh.positions[2]]);
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const buffers = new Map<string, ProjectionBuffer>();
    for (const id of component.meshIds) {
      const mesh = coarse.byInstanceId.get(id)!;
      buffers.set(id, {
        sum: new Float64Array(mesh.positions.length),
        weight: new Float64Array(mesh.positions.length / 3),
      });
    }

    for (const id of component.meshIds) {
      const mesh = coarse.byInstanceId.get(id)!;
      const buffer = buffers.get(id)!;
      for (const edge of mesh.metricEdges) projectMetricEdge(mesh, buffer, edge);
      // A closed dart deliberately creates sharp folds and local layer
      // overlap. Generic anti-fold/anti-overlap barriers would unfold that
      // valid material configuration and reintroduce STEP-0 energy.
      if (!shapingMeshIds.has(id)) {
        for (const hinge of mesh.hinges) projectHingeBarrier(mesh, buffer, hinge);
      }
    }
    const structuralGroupCounts = new Map<string, number>();
    for (const seam of component.seams) {
      if (seam.classification !== "structural-alignment") continue;
      structuralGroupCounts.set(seam.seamGroupId, (structuralGroupCounts.get(seam.seamGroupId) ?? 0) + 1);
    }
    for (const seam of component.seams) {
      if (seam.classification !== "structural-alignment") continue;
      const sampleCount = structuralGroupCounts.get(seam.seamGroupId) ?? 1;
      projectStructuralSeam(coarse, buffers, seam, 1 / Math.sqrt(sampleCount));
    }
    if (options.overlapBarrier !== false && iteration % 3 === 0) {
      projectOverlapBarrier(component, coarse, buffers, shapingMeshIds);
    }
    const gaugeId = component.meshIds[0];
    if (gaugeId) {
      const mesh = coarse.byInstanceId.get(gaugeId)!;
      const target = initialGauge.get(gaugeId)!;
      addTarget(buffers.get(gaugeId)!, 0, target, GAUGE_WEIGHT);
      // A second point removes free global rotation without freezing the panel.
      if (mesh.positions.length >= 6) {
        const second: readonly [number, number, number] = [mesh.positions[3], mesh.positions[4], mesh.positions[5]];
        addTarget(buffers.get(gaugeId)!, 1, second, GAUGE_WEIGHT * 0.25);
      }
    }
    applyProjectionBuffers(component, coarse, buffers, iteration);
  }
}

function projectMetricEdge(mesh: CoarseAssemblyMesh, buffer: ProjectionBuffer, edge: CoarseMetricEdge): void {
  const pa = vertex(mesh.positions, edge.a);
  const pb = vertex(mesh.positions, edge.b);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const dz = pb[2] - pa[2];
  const length = Math.hypot(dx, dy, dz);
  if (length <= EPS || edge.restLengthM <= EPS) return;
  const correction = (length - edge.restLengthM) * 0.5 / length;
  addTarget(buffer, edge.a, [
    pa[0] + dx * correction,
    pa[1] + dy * correction,
    pa[2] + dz * correction,
  ], METRIC_WEIGHT);
  addTarget(buffer, edge.b, [
    pb[0] - dx * correction,
    pb[1] - dy * correction,
    pb[2] - dz * correction,
  ], METRIC_WEIGHT);
}

function projectStructuralSeam(
  coarse: CoarseAssemblySet,
  buffers: Map<string, ProjectionBuffer>,
  seam: CoarseSeamConstraint,
  groupScale: number,
): void {
  const meshA = coarse.byInstanceId.get(seam.instanceA);
  const meshB = coarse.byInstanceId.get(seam.instanceB);
  if (!meshA || !meshB) return;
  const pa = evaluateCoarseBinding(meshA, seam.a);
  const pb = evaluateCoarseBinding(meshB, seam.b);
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const dz = pb[2] - pa[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= EPS) return;
  const rest = Math.max(0, seam.restDistanceM);
  const excess = Math.max(0, distance - rest);
  if (excess <= EPS) return;
  const half: readonly [number, number, number] = [
    dx / distance * excess * 0.5,
    dy / distance * excess * 0.5,
    dz / distance * excess * 0.5,
  ];
  const seamWeight = STRUCTURAL_SEAM_WEIGHT * groupScale;
  projectBindingTranslation(meshA, buffers.get(seam.instanceA)!, seam.a, half, seamWeight);
  projectBindingTranslation(meshB, buffers.get(seam.instanceB)!, seam.b, [-half[0], -half[1], -half[2]], seamWeight);
}

function projectBindingTranslation(
  mesh: CoarseAssemblyMesh,
  buffer: ProjectionBuffer,
  binding: CoarseMaterialBinding,
  requested: readonly [number, number, number],
  weight: number,
): void {
  const squared = binding.weights.reduce((sum, value) => sum + value * value, 0);
  if (squared <= EPS) return;
  for (let index = 0; index < 3; index += 1) {
    const vertexIndex = binding.vertices[index];
    const factor = binding.weights[index] / squared;
    const current = vertex(mesh.positions, vertexIndex);
    addTarget(buffer, vertexIndex, [
      current[0] + requested[0] * factor,
      current[1] + requested[1] * factor,
      current[2] + requested[2] * factor,
    ], weight * Math.max(0.08, binding.weights[index] * binding.weights[index]));
  }
}

function projectHingeBarrier(mesh: CoarseAssemblyMesh, buffer: ProjectionBuffer, hinge: CoarseInternalHinge): void {
  const a = vertex(mesh.positions, hinge.edgeA);
  const b = vertex(mesh.positions, hinge.edgeB);
  const c = vertex(mesh.positions, hinge.oppositeA);
  const d = vertex(mesh.positions, hinge.oppositeB);
  const edge = normalize(sub(b, a));
  if (length3(edge) <= EPS) return;
  const n1 = normalize(cross(sub(b, a), sub(c, a)));
  const n2raw = normalize(cross(sub(d, a), sub(b, a)));
  if (length3(n1) <= EPS || length3(n2raw) <= EPS) return;
  const cosine = clamp(dot(n1, n2raw), -1, 1);
  const angle = Math.acos(cosine);
  if (angle <= HINGE_SOFT_LIMIT_RAD) return;
  const correctionAngle = Math.min(0.18, (angle - HINGE_SOFT_LIMIT_RAD) * 0.16);
  const midpoint = scale(add(a, b), 0.5);
  const targetC = rotateAroundAxis(c, midpoint, edge, correctionAngle);
  const targetD = rotateAroundAxis(d, midpoint, edge, -correctionAngle);
  addTarget(buffer, hinge.oppositeA, targetC, HINGE_BARRIER_WEIGHT);
  addTarget(buffer, hinge.oppositeB, targetD, HINGE_BARRIER_WEIGHT);
}

function projectOverlapBarrier(
  component: Component,
  coarse: CoarseAssemblySet,
  buffers: Map<string, ProjectionBuffer>,
  ignoredSelfOverlapIds: ReadonlySet<string>,
): void {
  const triangles: Array<{
    mesh: CoarseAssemblyMesh;
    tri: number;
    vertices: readonly [number, number, number];
    centroid: readonly [number, number, number];
    normal: readonly [number, number, number];
    materialCentroid: readonly [number, number];
    materialRadiusM: number;
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  }> = [];
  for (const id of component.meshIds) {
    const mesh = coarse.byInstanceId.get(id)!;
    for (let tri = 0; tri < mesh.triangles.length / 3; tri += 1) {
      const verts: readonly [number, number, number] = [
        mesh.triangles[tri * 3], mesh.triangles[tri * 3 + 1], mesh.triangles[tri * 3 + 2],
      ];
      const pa = vertex(mesh.positions, verts[0]);
      const pb = vertex(mesh.positions, verts[1]);
      const pc = vertex(mesh.positions, verts[2]);
      const material = materialTriangleNeighborhood(mesh, verts);
      triangles.push({
        mesh,
        tri,
        vertices: verts,
        centroid: scale(add(add(pa, pb), pc), 1 / 3),
        normal: normalize(cross(sub(pb, pa), sub(pc, pa))),
        materialCentroid: material.centroid,
        materialRadiusM: material.radiusM,
        min: [Math.min(pa[0], pb[0], pc[0]), Math.min(pa[1], pb[1], pc[1]), Math.min(pa[2], pb[2], pc[2])],
        max: [Math.max(pa[0], pb[0], pc[0]), Math.max(pa[1], pb[1], pc[1]), Math.max(pa[2], pb[2], pc[2])],
      });
    }
  }
  const padding = 0.004;
  const minimumCentroidDistance = 0.012;
  triangles.sort((left, right) =>
    left.min[0] - right.min[0]
    || left.mesh.panelInstanceId.localeCompare(right.mesh.panelInstanceId)
    || left.tri - right.tri,
  );
  for (let i = 0; i < triangles.length; i += 1) {
    const first = triangles[i];
    for (let j = i + 1; j < triangles.length; j += 1) {
      const second = triangles[j];
      if (second.min[0] > first.max[0] + padding) break;
      if (first.mesh.panelInstanceId === second.mesh.panelInstanceId) {
        if (ignoredSelfOverlapIds.has(first.mesh.panelInstanceId)) continue;
        if (trianglesShareVertex(first.vertices, second.vertices)) continue;
        if (materialNeighborhoodsTouch(first, second)) continue;
      }
      if (!aabbOverlaps(first, second, padding)) continue;
      const delta = sub(second.centroid, first.centroid);
      const distance = length3(delta);
      if (distance >= minimumCentroidDistance) continue;
      let direction = distance > EPS ? scale(delta, 1 / distance) : first.normal;
      if (length3(direction) <= EPS) {
        direction = first.mesh.panelInstanceId.localeCompare(second.mesh.panelInstanceId) <= 0 ? [0, 0, 1] : [0, 0, -1];
      }
      const amount = (minimumCentroidDistance - distance) * 0.5;
      for (const vertexIndex of first.vertices) {
        const current = vertex(first.mesh.positions, vertexIndex);
        addTarget(buffers.get(first.mesh.panelInstanceId)!, vertexIndex, sub(current, scale(direction, amount)), OVERLAP_WEIGHT);
      }
      for (const vertexIndex of second.vertices) {
        const current = vertex(second.mesh.positions, vertexIndex);
        addTarget(buffers.get(second.mesh.panelInstanceId)!, vertexIndex, add(current, scale(direction, amount)), OVERLAP_WEIGHT);
      }
    }
  }
}

function applyProjectionBuffers(
  component: Component,
  coarse: CoarseAssemblySet,
  buffers: Map<string, ProjectionBuffer>,
  iteration: number,
): void {
  const blend = iteration < 8 ? 0.58 : 0.72;
  for (const id of component.meshIds) {
    const mesh = coarse.byInstanceId.get(id)!;
    const buffer = buffers.get(id)!;
    for (let vertexIndex = 0; vertexIndex < mesh.positions.length / 3; vertexIndex += 1) {
      const weight = buffer.weight[vertexIndex];
      if (weight <= EPS) continue;
      const offset = vertexIndex * 3;
      const tx = buffer.sum[offset] / weight;
      const ty = buffer.sum[offset + 1] / weight;
      const tz = buffer.sum[offset + 2] / weight;
      mesh.positions[offset] += (tx - mesh.positions[offset]) * blend;
      mesh.positions[offset + 1] += (ty - mesh.positions[offset + 1]) * blend;
      mesh.positions[offset + 2] += (tz - mesh.positions[offset + 2]) * blend;
    }
  }
}

function measureComponentMetrics(component: Component, coarse: CoarseAssemblySet): IsometricAssemblyMetrics {
  let metricSum = 0;
  let metricMax = 0;
  let metricCount = 0;
  let areaWeightedSum = 0;
  let areaWeightTotal = 0;
  const areaSamples: Array<{ relative: number; materialArea: number }> = [];
  const componentMaterialArea = component.meshIds.reduce(
    (sum, id) => sum + (coarse.byInstanceId.get(id)?.materialAreaM2 ?? 0),
    0,
  );
  const robustAreaFloor = Math.max(1e-10, componentMaterialArea * 1e-5);
  const normals: Array<readonly [number, number, number]> = [];
  for (const id of component.meshIds) {
    const mesh = coarse.byInstanceId.get(id)!;
    for (const edge of mesh.metricEdges) {
      const pa = vertex(mesh.positions, edge.a);
      const pb = vertex(mesh.positions, edge.b);
      const current = length3(sub(pb, pa));
      const relative = edge.restLengthM > EPS ? Math.abs(current - edge.restLengthM) / edge.restLengthM : 0;
      metricSum += relative;
      metricMax = Math.max(metricMax, relative);
      metricCount += 1;
    }
    for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
      const a = mesh.triangles[offset];
      const b = mesh.triangles[offset + 1];
      const c = mesh.triangles[offset + 2];
      const pa = vertex(mesh.positions, a);
      const pb = vertex(mesh.positions, b);
      const pc = vertex(mesh.positions, c);
      const currentArea = length3(cross(sub(pb, pa), sub(pc, pa))) * 0.5;
      const materialArea = triangleMaterialArea(mesh, a, b, c);
      const relative = materialArea > EPS ? Math.abs(currentArea - materialArea) / materialArea : 0;
      if (materialArea > EPS && Number.isFinite(relative)) {
        areaWeightedSum += relative * materialArea;
        areaWeightTotal += materialArea;
        areaSamples.push({ relative, materialArea });
      }
      const normal = normalize(cross(sub(pb, pa), sub(pc, pa)));
      if (length3(normal) > EPS) normals.push(normal);
    }
  }
  const structural = component.seams.filter((seam) => seam.classification === "structural-alignment");
  let seamSum = 0;
  let seamMax = 0;
  for (const seam of structural) {
    const a = coarse.byInstanceId.get(seam.instanceA)!;
    const b = coarse.byInstanceId.get(seam.instanceB)!;
    const pa = evaluateCoarseBinding(a, seam.a);
    const pb = evaluateCoarseBinding(b, seam.b);
    const residual = Math.max(0, length3(sub(pb, pa)) - seam.restDistanceM);
    seamSum += residual;
    seamMax = Math.max(seamMax, residual);
  }
  const characteristic = componentCharacteristicLength(component, coarse);
  const overlap = measureOverlap(component, coarse);
  const robustAreaMax = areaSamples
    .filter((sample) => sample.materialArea >= robustAreaFloor)
    .reduce((maximum, sample) => Math.max(maximum, sample.relative), 0);
  return {
    metricDistortionMean: metricCount > 0 ? metricSum / metricCount : 0,
    metricDistortionMax: metricMax,
    areaDistortionMean: areaWeightTotal > EPS ? areaWeightedSum / areaWeightTotal : 0,
    areaDistortionMax: robustAreaMax,
    structuralSeamMeanMm: structural.length > 0 ? seamSum / structural.length * 1000 : 0,
    structuralSeamMaxMm: seamMax * 1000,
    normalizedResidual: characteristic > EPS && structural.length > 0 ? seamSum / structural.length / characteristic : 0,
    overlapScore: overlap.score,
    triangleCrossingProxyCount: overlap.count,
    nonPlanarityRad: normalSpread(normals),
  };
}

function objective(metrics: IsometricAssemblyMetrics, component: Component): number {
  const flatPenalty = component.supportsShell && metrics.nonPlanarityRad < 0.12
    ? (0.12 - metrics.nonPlanarityRad) * 35
    : 0;
  return (
    metrics.metricDistortionMean * 160
    + metrics.metricDistortionMax * 45
    + metrics.areaDistortionMean * 70
    + metrics.areaDistortionMax * 18
    + metrics.normalizedResidual * 18
    + metrics.overlapScore * 220
    + metrics.triangleCrossingProxyCount * 0.08
    + flatPenalty
  );
}

function localShapingMeshIds(component: Component): Set<string> {
  const result = new Set<string>();
  for (const seam of component.seams) {
    if (seam.classification !== "local-shaping-closure") continue;
    result.add(seam.instanceA);
    result.add(seam.instanceB);
  }
  return result;
}

function classifyConstraintState(
  component: Component,
  metrics: IsometricAssemblyMetrics,
  candidates: CandidateScore[],
): { state: AssemblyConstraintState; confidence: number; reason?: string } {
  const scoreGap = candidates.length > 1
    ? Math.max(0, candidates[1].score - candidates[0].score) / Math.max(1, Math.abs(candidates[0].score))
    : 0;
  const graphEvidence = clamp((component.cycleRank + component.parallelRelationCount * 0.75) / Math.max(1, component.meshIds.length), 0, 1);
  const quality = clamp(1 - metrics.normalizedResidual * 4 - metrics.metricDistortionMean * 8 - metrics.overlapScore * 2, 0, 1);
  const confidence = clamp(graphEvidence * 0.45 + quality * 0.45 + Math.min(0.1, scoreGap), 0, 1);
  if (!component.supportsShell) {
    return { state: "ambiguous", confidence: Math.min(0.45, confidence), reason: "material graph leaves one or more hinge rotations underconstrained" };
  }
  if (metrics.overlapScore > 0.12 || metrics.normalizedResidual > 0.25 || confidence < 0.55) {
    return { state: "partially-constrained", confidence, reason: "global constraints admit competing or imperfect embeddings" };
  }
  return { state: "well-constrained", confidence };
}

function snapshotCandidate(name: string, component: Component, coarse: CoarseAssemblySet): Candidate {
  return {
    name,
    positions: new Map(component.meshIds.map((id) => [id, new Float32Array(coarse.byInstanceId.get(id)!.positions)])),
  };
}

function setComponentPositions(component: Component, coarse: CoarseAssemblySet, positions: Map<string, Float32Array>): void {
  for (const id of component.meshIds) {
    const next = positions.get(id);
    const mesh = coarse.byInstanceId.get(id);
    if (next && mesh && next.length === mesh.positions.length) mesh.positions.set(next);
  }
}

function mirrorCandidate(candidate: Candidate, name: string): Candidate {
  const positions = new Map<string, Float32Array>();
  for (const [id, source] of candidate.positions) {
    const target = new Float32Array(source);
    for (let offset = 2; offset < target.length; offset += 3) target[offset] *= -1;
    positions.set(id, target);
  }
  return { name, positions };
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    let hash = 2166136261;
    for (const id of [...candidate.positions.keys()].sort()) {
      for (const value of candidate.positions.get(id)!) {
        const quantized = Math.round(value * 1e5);
        hash ^= quantized;
        hash = Math.imul(hash, 16777619);
      }
    }
    const key = `${hash >>> 0}:${candidate.project === false ? "raw" : "projected"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function findHighestAreaCycle(component: Component, coarse: CoarseAssemblySet): string[] {
  if (component.meshIds.length === 1) {
    return component.relations.some((relation) => relation.a === relation.b) ? [...component.meshIds] : [];
  }

  const selfClosed = new Set(component.meshIds.filter((id) => selfStructuralSeams(component, id).length > 0));
  const independentIds = component.meshIds.filter((id) => !selfClosed.has(id));
  // A self-closed developable surface is already a complete local loop. Do
  // not let its multiple attachment relations enlarge/redefine an independent
  // multipanel cycle. If the remaining graph has no cycle, fall back to all
  // nodes so a garment made only from self-closed parts is still seedable.
  const independentCycle = enumerateBestCycle(independentIds);
  if (independentCycle.length > 0) return independentCycle;
  const allCycle = enumerateBestCycle(component.meshIds);
  if (allCycle.length > 0) return allCycle;
  if (component.parallelRelationCount > 0 && component.meshIds.length === 2) return [...component.meshIds];
  return [];

  function enumerateBestCycle(allowedIds: readonly string[]): string[] {
    if (allowedIds.length < 3) return [];
    const allowed = new Set(allowedIds);
    const adjacency = new Map(allowedIds.map((id) => [id, new Set<string>()]));
    for (const relation of component.relations) {
      if (relation.a === relation.b || !allowed.has(relation.a) || !allowed.has(relation.b)) continue;
      adjacency.get(relation.a)?.add(relation.b);
      adjacency.get(relation.b)?.add(relation.a);
    }
    const cycles = new Map<string, string[]>();
    const maxDepth = Math.min(10, allowedIds.length);
    for (const start of [...allowedIds].sort()) dfs(start, start, [start], new Set([start]));
    let best: string[] = [];
    let bestArea = -1;
    for (const cycle of cycles.values()) {
      const area = cycle.reduce((sum, id) => sum + (coarse.byInstanceId.get(id)?.materialAreaM2 ?? 0), 0);
      if (area > bestArea + 1e-12 || (Math.abs(area - bestArea) <= 1e-12 && cycle.join("|").localeCompare(best.join("|")) < 0)) {
        bestArea = area;
        best = cycle;
      }
    }
    return best;

    function dfs(start: string, current: string, path: string[], visited: Set<string>): void {
      if (path.length > maxDepth) return;
      for (const next of [...(adjacency.get(current) ?? [])].sort()) {
        if (next === start && path.length >= 3) {
          const canonical = canonicalCycle(path);
          cycles.set(canonical.join("|"), canonical);
          continue;
        }
        if (visited.has(next) || next.localeCompare(start) < 0) continue;
        visited.add(next);
        path.push(next);
        dfs(start, next, path, visited);
        path.pop();
        visited.delete(next);
      }
    }
  }
}

function canonicalCycle(cycle: string[]): string[] {
  const rotations: string[][] = [];
  for (const source of [cycle, [...cycle].reverse()]) {
    for (let index = 0; index < source.length; index += 1) {
      rotations.push([...source.slice(index), ...source.slice(0, index)]);
    }
  }
  rotations.sort((a, b) => a.join("|").localeCompare(b.join("|")));
  return rotations[0];
}

function phaseAlignClosedSeed(
  id: string,
  seeded: Set<string>,
  component: Component,
  coarse: CoarseAssemblySet,
  positions: Map<string, Float32Array>,
): void {
  const relevant = component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && seam.instanceA !== seam.instanceB
    && ((seam.instanceA === id && seeded.has(seam.instanceB)) || (seam.instanceB === id && seeded.has(seam.instanceA))),
  );
  if (relevant.length === 0) return;
  const source = positions.get(id);
  const mesh = coarse.byInstanceId.get(id);
  if (!source || !mesh) return;
  const center = centroidOfPositions(source);
  let bestPositions: Float32Array = new Float32Array(source);
  let bestCost = Number.POSITIVE_INFINITY;

  const variants = [source, reflectWindingAroundY(source, center)];
  for (const windingSource of variants) {
    const original = mesh.positions;
    mesh.positions = windingSource;
    const localPoints: Array<readonly [number, number, number]> = [];
    const fixedPoints: Array<readonly [number, number, number]> = [];
    for (const seam of relevant) {
      const localBinding = seam.instanceA === id ? seam.a : seam.b;
      const fixedId = seam.instanceA === id ? seam.instanceB : seam.instanceA;
      const fixedBinding = seam.instanceA === id ? seam.b : seam.a;
      const fixedMesh = coarse.byInstanceId.get(fixedId)!;
      const fixedOriginal = fixedMesh.positions;
      const fixedSeed = positions.get(fixedId)!;
      fixedMesh.positions = fixedSeed;
      localPoints.push(evaluateCoarseBinding(mesh, localBinding));
      fixedPoints.push(evaluateCoarseBinding(fixedMesh, fixedBinding));
      fixedMesh.positions = fixedOriginal;
    }
    mesh.positions = original;
    const fit = bestRigidPointFit(localPoints, fixedPoints);
    const fitted = transformPositionsRigidly(windingSource, fit);
    let cost = 0;
    for (let index = 0; index < localPoints.length; index += 1) {
      const shifted = transformPointRigidly(localPoints[index], fit);
      const delta = sub(shifted, fixedPoints[index]);
      cost += dot(delta, delta);
    }
    if (cost < bestCost - 1e-12) {
      bestCost = cost;
      bestPositions = fitted;
    }
  }
  positions.set(id, bestPositions);
}

interface RigidPointFit {
  quaternion: readonly [number, number, number, number]; // w, x, y, z
  sourceCenter: readonly [number, number, number];
  targetCenter: readonly [number, number, number];
}

function bestRigidPointFit(
  source: readonly (readonly [number, number, number])[],
  target: readonly (readonly [number, number, number])[],
): RigidPointFit {
  const sourceCenter = centroidOfPointList(source);
  const targetCenter = centroidOfPointList(target);
  if (source.length < 2 || source.length !== target.length) {
    return { quaternion: [1, 0, 0, 0], sourceCenter, targetCenter };
  }

  let sxx = 0; let sxy = 0; let sxz = 0;
  let syx = 0; let syy = 0; let syz = 0;
  let szx = 0; let szy = 0; let szz = 0;
  for (let index = 0; index < source.length; index += 1) {
    const a = sub(source[index], sourceCenter);
    const b = sub(target[index], targetCenter);
    sxx += a[0] * b[0]; sxy += a[0] * b[1]; sxz += a[0] * b[2];
    syx += a[1] * b[0]; syy += a[1] * b[1]; syz += a[1] * b[2];
    szx += a[2] * b[0]; szy += a[2] * b[1]; szz += a[2] * b[2];
  }
  const trace = sxx + syy + szz;
  const matrix = [
    [trace, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const shift = Math.sqrt(matrix.flat().reduce((sum, value) => sum + value * value, 0)) + 1e-12;
  let quaternion: [number, number, number, number] = [1, 0.173, 0.311, 0.419];
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const next: [number, number, number, number] = [0, 0, 0, 0];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        next[row] += (matrix[row][column] + (row === column ? shift : 0)) * quaternion[column];
      }
    }
    const magnitude = Math.hypot(...next);
    if (magnitude <= EPS) break;
    quaternion = next.map((value) => value / magnitude) as [number, number, number, number];
  }
  return { quaternion, sourceCenter, targetCenter };
}

function dampRigidPointFit(fit: RigidPointFit, amount: number): RigidPointFit {
  const sign = fit.quaternion[0] < 0 ? -1 : 1;
  const blended: [number, number, number, number] = [
    1 + (fit.quaternion[0] * sign - 1) * amount,
    fit.quaternion[1] * sign * amount,
    fit.quaternion[2] * sign * amount,
    fit.quaternion[3] * sign * amount,
  ];
  const magnitude = Math.max(EPS, Math.hypot(...blended));
  const quaternion = blended.map((value) => value / magnitude) as [number, number, number, number];
  return {
    quaternion,
    sourceCenter: fit.sourceCenter,
    targetCenter: add(
      fit.sourceCenter,
      scale(sub(fit.targetCenter, fit.sourceCenter), amount),
    ),
  };
}

function centroidOfPointList(
  points: readonly (readonly [number, number, number])[],
): readonly [number, number, number] {
  if (points.length === 0) return [0, 0, 0];
  const sum = points.reduce(
    (total, point) => add(total, point) as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  return scale(sum, 1 / points.length);
}

function transformPositionsRigidly(source: Float32Array, fit: RigidPointFit): Float32Array {
  const result = new Float32Array(source.length);
  for (let offset = 0; offset < source.length; offset += 3) {
    const transformed = transformPointRigidly(
      [source[offset], source[offset + 1], source[offset + 2]],
      fit,
    );
    result[offset] = transformed[0];
    result[offset + 1] = transformed[1];
    result[offset + 2] = transformed[2];
  }
  return result;
}

function transformPointRigidly(
  point: readonly [number, number, number],
  fit: RigidPointFit,
): readonly [number, number, number] {
  const local = sub(point, fit.sourceCenter);
  const [w, x, y, z] = fit.quaternion;
  const qVector: readonly [number, number, number] = [x, y, z];
  const twiceCross = scale(cross(qVector, local), 2);
  const rotated = add(local, add(scale(twiceCross, w), cross(qVector, twiceCross)));
  return add(rotated, fit.targetCenter);
}

function centroidOfPositions(positions: Float32Array): readonly [number, number, number] {
  let x = 0; let y = 0; let z = 0;
  const count = Math.max(1, positions.length / 3);
  for (let offset = 0; offset < positions.length; offset += 3) {
    x += positions[offset]; y += positions[offset + 1]; z += positions[offset + 2];
  }
  return [x / count, y / count, z / count];
}

function reflectWindingAroundY(
  source: Float32Array,
  center: readonly [number, number, number],
): Float32Array {
  const result = new Float32Array(source);
  for (let offset = 0; offset < result.length; offset += 3) {
    result[offset + 2] = center[2] - (result[offset + 2] - center[2]);
  }
  return result;
}

function translateSeedNearConnectedSeam(
  id: string,
  seeded: Set<string>,
  component: Component,
  coarse: CoarseAssemblySet,
  positions: Map<string, Float32Array>,
): void {
  const relevant = component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && ((seam.instanceA === id && seeded.has(seam.instanceB)) || (seam.instanceB === id && seeded.has(seam.instanceA))),
  );
  if (relevant.length === 0) return;
  const mesh = coarse.byInstanceId.get(id)!;
  const original = mesh.positions;
  const targetPositions = positions.get(id)!;
  mesh.positions = targetPositions;
  let localSum: [number, number, number] = [0, 0, 0];
  let fixedSum: [number, number, number] = [0, 0, 0];
  let count = 0;
  for (const seam of relevant) {
    const localBinding = seam.instanceA === id ? seam.a : seam.b;
    const fixedId = seam.instanceA === id ? seam.instanceB : seam.instanceA;
    const fixedBinding = seam.instanceA === id ? seam.b : seam.a;
    const fixedMesh = coarse.byInstanceId.get(fixedId)!;
    const fixedOriginal = fixedMesh.positions;
    const fixedSeed = positions.get(fixedId)!;
    fixedMesh.positions = fixedSeed;
    const local = evaluateCoarseBinding(mesh, localBinding);
    const fixed = evaluateCoarseBinding(fixedMesh, fixedBinding);
    fixedMesh.positions = fixedOriginal;
    localSum = add(localSum, local) as [number, number, number];
    fixedSum = add(fixedSum, fixed) as [number, number, number];
    count += 1;
  }
  mesh.positions = original;
  if (count === 0) return;
  const delta = sub(scale(fixedSum, 1 / count), scale(localSum, 1 / count));
  for (let offset = 0; offset < targetPositions.length; offset += 3) {
    targetPositions[offset] += delta[0];
    targetPositions[offset + 1] += delta[1];
    targetPositions[offset + 2] += delta[2];
  }
}

function mapMeshToCylinder(
  mesh: CoarseAssemblyMesh,
  axis: ReturnType<typeof acrossAxis>,
  radius: number,
  centerAngle: number,
  acrossDirection = 1,
): Float32Array {
  const result = new Float32Array(mesh.materialPositionsMm.length / 2 * 3);
  const acrossCenter = (axis.acrossMin + axis.acrossMax) * 0.5;
  const alongCenter = (axis.alongMin + axis.alongMax) * 0.5;
  for (let vertexIndex = 0; vertexIndex < mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
    const x = mesh.materialPositionsMm[vertexIndex * 2];
    const y = mesh.materialPositionsMm[vertexIndex * 2 + 1];
    const across = axis.acrossIsX ? x : y;
    const along = axis.acrossIsX ? y : x;
    const angle = centerAngle + acrossDirection * (across - acrossCenter) * 0.001 / radius;
    const offset = vertexIndex * 3;
    result[offset] = Math.cos(angle) * radius;
    result[offset + 1] = -(along - alongCenter) * 0.001;
    result[offset + 2] = Math.sin(angle) * radius;
  }
  return result;
}

function cycleAcrossDirection(
  component: Component,
  id: string,
  cycle: readonly string[],
  index: number,
  axis: ReturnType<typeof acrossAxis>,
): 1 | -1 {
  const previous = cycle[(index - 1 + cycle.length) % cycle.length];
  const next = cycle[(index + 1) % cycle.length];
  const previousAcross = meanRelationAcross(component, id, previous, axis);
  const nextAcross = meanRelationAcross(component, id, next, axis);
  if (previousAcross === null || nextAcross === null) return 1;
  return previousAcross <= nextAcross ? 1 : -1;
}

function meanRelationAcross(
  component: Component,
  id: string,
  neighbor: string,
  axis: ReturnType<typeof acrossAxis>,
): number | null {
  const samples: number[] = [];
  for (const seam of component.seams) {
    if (!participatesInShellTopology(seam)) continue;
    const matches = (seam.instanceA === id && seam.instanceB === neighbor)
      || (seam.instanceB === id && seam.instanceA === neighbor);
    if (!matches) continue;
    const binding = seam.instanceA === id ? seam.a : seam.b;
    samples.push(axis.acrossIsX ? binding.materialXMm : binding.materialYMm);
  }
  if (samples.length === 0) return null;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function acrossAxis(
  mesh: CoarseAssemblyMesh,
  selfSeams: readonly CoarseSeamConstraint[] = [],
) {
  const bounds = materialBounds(mesh);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  let acrossIsX: boolean;
  const samples = selfSeams
    .filter(participatesInShellTopology)
    .map((seam) => seam.a)
    .sort((a, b) => a.materialXMm - b.materialXMm || a.materialYMm - b.materialYMm);
  if (samples.length >= 2) {
    const meanX = samples.reduce((sum, sample) => sum + sample.materialXMm, 0) / samples.length;
    const meanY = samples.reduce((sum, sample) => sum + sample.materialYMm, 0) / samples.length;
    const varianceX = samples.reduce((sum, sample) => sum + (sample.materialXMm - meanX) ** 2, 0);
    const varianceY = samples.reduce((sum, sample) => sum + (sample.materialYMm - meanY) ** 2, 0);
    const tangentIsX = varianceX > varianceY;
    acrossIsX = !tangentIsX;
  } else {
    acrossIsX = width <= height * 1.4 || height <= EPS;
  }
  return {
    acrossIsX,
    acrossMin: acrossIsX ? bounds.minX : bounds.minY,
    acrossMax: acrossIsX ? bounds.maxX : bounds.maxY,
    alongMin: acrossIsX ? bounds.minY : bounds.minX,
    alongMax: acrossIsX ? bounds.maxY : bounds.maxX,
    acrossSpanMm: acrossIsX ? width : height,
  };
}

function selfStructuralSeams(component: Component, id: string): CoarseSeamConstraint[] {
  return component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && seam.instanceA === id
    && seam.instanceB === id,
  );
}

/**
 * Topology and metric compatibility are independent. Ease/gather/stretch
 * seams still connect material shells and therefore participate in cycle and
 * placement discovery; only their unequal-length closure is excluded from
 * the exact zero-distance projection. Local dart shaping must never become a
 * garment-wide shell relation.
 */
function participatesInShellTopology(seam: CoarseSeamConstraint): boolean {
  return seam.classification !== "local-shaping-closure";
}

function materialBounds(mesh: CoarseAssemblyMesh) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < mesh.materialPositionsMm.length / 2; vertex += 1) {
    const x = mesh.materialPositionsMm[vertex * 2];
    const y = mesh.materialPositionsMm[vertex * 2 + 1];
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function measureOverlap(component: Component, coarse: CoarseAssemblySet): { score: number; count: number } {
  const ignoredSelfOverlapIds = localShapingMeshIds(component);
  const centroids: Array<{
    id: string;
    tri: number;
    vertices: readonly [number, number, number];
    centroid: readonly [number, number, number];
    radius: number;
    materialCentroid: readonly [number, number];
    materialRadiusM: number;
  }> = [];
  for (const id of component.meshIds) {
    const mesh = coarse.byInstanceId.get(id)!;
    for (let tri = 0; tri < mesh.triangles.length / 3; tri += 1) {
      const vertices: readonly [number, number, number] = [
        mesh.triangles[tri * 3],
        mesh.triangles[tri * 3 + 1],
        mesh.triangles[tri * 3 + 2],
      ];
      const a = vertex(mesh.positions, vertices[0]);
      const b = vertex(mesh.positions, vertices[1]);
      const c = vertex(mesh.positions, vertices[2]);
      const centroid = scale(add(add(a, b), c), 1 / 3);
      const radius = Math.max(length3(sub(a, centroid)), length3(sub(b, centroid)), length3(sub(c, centroid)));
      const material = materialTriangleNeighborhood(mesh, vertices);
      centroids.push({
        id,
        tri,
        vertices,
        centroid,
        radius,
        materialCentroid: material.centroid,
        materialRadiusM: material.radiusM,
      });
    }
  }
  let count = 0;
  let magnitude = 0;
  centroids.sort((left, right) =>
    left.centroid[0] - right.centroid[0]
    || left.id.localeCompare(right.id)
    || left.tri - right.tri,
  );
  for (let i = 0; i < centroids.length; i += 1) {
    const a = centroids[i];
    for (let j = i + 1; j < centroids.length; j += 1) {
      const b = centroids[j];
      // The overlap threshold below is always <= 18 mm. If X alone is farther
      // apart, Euclidean distance cannot qualify and every later sorted entry
      // can be rejected as well.
      if (b.centroid[0] - a.centroid[0] >= 0.018) break;
      if (a.id === b.id) {
        if (ignoredSelfOverlapIds.has(a.id)) continue;
        if (trianglesShareVertex(a.vertices, b.vertices)) continue;
        if (materialNeighborhoodsTouch(a, b)) continue;
      }
      const distance = length3(sub(a.centroid, b.centroid));
      const threshold = Math.min(0.018, Math.max(0.004, (a.radius + b.radius) * 0.28));
      if (distance >= threshold) continue;
      count += 1;
      magnitude += (threshold - distance) / threshold;
    }
  }
  return { score: centroids.length > 0 ? magnitude / centroids.length : 0, count };
}

function estimateFreeBoundaries(component: Component, coarse: CoarseAssemblySet): number {
  const stitchedByInstance = new Map<string, Set<string>>(component.meshIds.map((id) => [id, new Set<string>()]));
  for (const seam of component.seams) {
    if (!participatesInShellTopology(seam)) continue;
    // Material binding preserves x/y but not the named source edge after
    // triangulation. Estimate free boundary richness by structural relation
    // count versus authored boundary path count; it is diagnostic only.
    stitchedByInstance.get(seam.instanceA)?.add(seam.seamGroupId);
    stitchedByInstance.get(seam.instanceB)?.add(seam.seamGroupId);
  }
  let free = 0;
  for (const id of component.meshIds) {
    const mesh = coarse.byInstanceId.get(id)!;
    free += Math.max(0, Object.keys(mesh.boundaryPaths).length - (stitchedByInstance.get(id)?.size ?? 0));
  }
  return free;
}

function aggregateMetrics(components: readonly IsometricAssemblyComponentDiagnostic[]): IsometricAssemblyMetrics {
  if (components.length === 0) return {
    metricDistortionMean: 0, metricDistortionMax: 0, areaDistortionMean: 0, areaDistortionMax: 0,
    structuralSeamMeanMm: 0, structuralSeamMaxMm: 0, normalizedResidual: 0,
    overlapScore: 0, triangleCrossingProxyCount: 0, nonPlanarityRad: 0,
  };
  return {
    metricDistortionMean: average(components.map((item) => item.metricDistortionMean)),
    metricDistortionMax: Math.max(...components.map((item) => item.metricDistortionMax)),
    areaDistortionMean: average(components.map((item) => item.areaDistortionMean)),
    areaDistortionMax: Math.max(...components.map((item) => item.areaDistortionMax)),
    structuralSeamMeanMm: average(components.map((item) => item.structuralSeamMeanMm)),
    structuralSeamMaxMm: Math.max(...components.map((item) => item.structuralSeamMaxMm)),
    normalizedResidual: average(components.map((item) => item.normalizedResidual)),
    overlapScore: average(components.map((item) => item.overlapScore)),
    triangleCrossingProxyCount: components.reduce((sum, item) => sum + item.triangleCrossingProxyCount, 0),
    nonPlanarityRad: Math.max(...components.map((item) => item.nonPlanarityRad)),
  };
}

function componentCharacteristicLength(component: Component, coarse: CoarseAssemblySet): number {
  const area = component.meshIds.reduce((sum, id) => sum + coarse.byInstanceId.get(id)!.materialAreaM2, 0);
  return Math.max(0.02, Math.sqrt(Math.max(EPS, area)));
}

function triangleMaterialArea(mesh: CoarseAssemblyMesh, a: number, b: number, c: number): number {
  const ax = mesh.materialPositionsMm[a * 2] * 0.001;
  const ay = mesh.materialPositionsMm[a * 2 + 1] * 0.001;
  const bx = mesh.materialPositionsMm[b * 2] * 0.001;
  const by = mesh.materialPositionsMm[b * 2 + 1] * 0.001;
  const cx = mesh.materialPositionsMm[c * 2] * 0.001;
  const cy = mesh.materialPositionsMm[c * 2 + 1] * 0.001;
  return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
}

function normalSpread(normals: readonly (readonly [number, number, number])[]): number {
  let maximum = 0;
  for (let i = 0; i < normals.length; i += 1) {
    for (let j = i + 1; j < normals.length; j += 1) {
      maximum = Math.max(maximum, Math.acos(clamp(Math.abs(dot(normals[i], normals[j])), -1, 1)));
    }
  }
  return maximum;
}

function materialTriangleNeighborhood(
  mesh: CoarseAssemblyMesh,
  vertices: readonly [number, number, number],
): { centroid: readonly [number, number]; radiusM: number } {
  const points = vertices.map((vertexIndex) => [
    mesh.materialPositionsMm[vertexIndex * 2] * 0.001,
    mesh.materialPositionsMm[vertexIndex * 2 + 1] * 0.001,
  ] as const);
  const centroid: readonly [number, number] = [
    (points[0][0] + points[1][0] + points[2][0]) / 3,
    (points[0][1] + points[1][1] + points[2][1]) / 3,
  ];
  const radiusM = Math.max(...points.map((point) => Math.hypot(
    point[0] - centroid[0],
    point[1] - centroid[1],
  )));
  return { centroid, radiusM };
}

function materialNeighborhoodsTouch(
  a: { materialCentroid: readonly [number, number]; materialRadiusM: number },
  b: { materialCentroid: readonly [number, number]; materialRadiusM: number },
): boolean {
  const distance = Math.hypot(
    a.materialCentroid[0] - b.materialCentroid[0],
    a.materialCentroid[1] - b.materialCentroid[1],
  );
  return distance <= (a.materialRadiusM + b.materialRadiusM) * 2.15 + 1e-6;
}

function aabbOverlaps(
  a: { min: readonly [number, number, number]; max: readonly [number, number, number] },
  b: { min: readonly [number, number, number]; max: readonly [number, number, number] },
  padding: number,
): boolean {
  return a.min[0] <= b.max[0] + padding && a.max[0] + padding >= b.min[0]
    && a.min[1] <= b.max[1] + padding && a.max[1] + padding >= b.min[1]
    && a.min[2] <= b.max[2] + padding && a.max[2] + padding >= b.min[2];
}

function trianglesShareVertex(a: readonly number[], b: readonly number[]): boolean {
  return a.some((value) => b.includes(value));
}

function addTarget(buffer: ProjectionBuffer, index: number, target: readonly [number, number, number], weight: number): void {
  if (!Number.isFinite(weight) || weight <= 0) return;
  const offset = index * 3;
  buffer.sum[offset] += target[0] * weight;
  buffer.sum[offset + 1] += target[1] * weight;
  buffer.sum[offset + 2] += target[2] * weight;
  buffer.weight[index] += weight;
}

function vertex(positions: Float32Array, index: number): readonly [number, number, number] {
  const offset = index * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function rotateAroundAxis(
  point: readonly [number, number, number],
  origin: readonly [number, number, number],
  axis: readonly [number, number, number],
  angle: number,
): readonly [number, number, number] {
  const p = sub(point, origin);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotated = add(add(scale(p, cosine), scale(cross(axis, p), sine)), scale(axis, dot(axis, p) * (1 - cosine)));
  return add(origin, rotated);
}

function add(a: readonly number[], b: readonly number[]): readonly [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: readonly number[], b: readonly number[]): readonly [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: readonly number[], value: number): readonly [number, number, number] {
  return [a[0] * value, a[1] * value, a[2] * value];
}
function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: readonly number[], b: readonly number[]): readonly [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length3(a: readonly number[]): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: readonly number[]): readonly [number, number, number] {
  const length = length3(a);
  return length > EPS ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function average(values: readonly number[]): number { return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function nowMs(): number { return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now(); }
