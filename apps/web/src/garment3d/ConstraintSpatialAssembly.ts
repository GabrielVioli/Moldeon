import { getPatternEdges, type EdgeRange } from "../domain/pattern";
import {
  measureIntrinsicDistortion,
  type AssemblyPanelInstance,
  type AssemblyStitchConstraint,
  type GarmentAssemblyState,
  type GlobalPointReference,
} from "./GarmentAssembly";

type Vec3 = [number, number, number];
type Quaternion = [number, number, number, number]; // x, y, z, w

export type SpatialConstraintClassification =
  | "structural-alignment"
  | "local-shaping-closure"
  | "intentional-mismatch";

export interface SpatialConstraintSample {
  id: string;
  progress: number;
  a: GlobalPointReference;
  b: GlobalPointReference;
  rangeA?: EdgeRange;
  rangeB?: EdgeRange;
  restDistanceM: number;
}

export interface GarmentSpatialConstraintRelation {
  id: string;
  seamGroupId: string;
  panelA: string;
  panelB: string;
  samples: SpatialConstraintSample[];
  classification: SpatialConstraintClassification;
  structuralWeight: number;
  characteristicLengthM: number;
  treatment: string;
  targetRatio: number;
  slackMm: number;
  direction: "same" | "opposite";
  /** Tangentes no espaço material 2D do painel, embutidas em XY. */
  localTangentA: Vec3;
  localTangentB: Vec3;
  /** Vetores laterais do contorno no espaço material, derivados das tangentes. */
  localBoundaryOrientationA: Vec3;
  localBoundaryOrientationB: Vec3;
}

export interface GarmentSpatialConstraintNode {
  id: string;
  pieceId: string;
  geometrySignature: string;
  vertexCount: number;
}

export interface GarmentSpatialConstraintComponent {
  id: string;
  nodeIds: string[];
  relationIds: string[];
  anchorId: string;
  cycleCount: number;
  parallelRelationCount: number;
  freeBoundaryCount: number;
  supportsSpatialShell: boolean;
}

export interface GarmentSpatialConstraintGraph {
  nodes: GarmentSpatialConstraintNode[];
  relations: GarmentSpatialConstraintRelation[];
  components: GarmentSpatialConstraintComponent[];
}

export interface PanelSpatialPose {
  panelInstanceId: string;
  rotation: Quaternion;
  translation: Vec3;
}

export interface SpatialRelationResidualDiagnostic {
  relationId: string;
  seamGroupId: string;
  classification: SpatialConstraintClassification;
  meanResidualMm: number;
  maxResidualMm: number;
  normalizedMeanResidual: number;
}

export interface ConstraintSpatialComponentDiagnostic {
  componentId: string;
  nodeIds: string[];
  anchorId: string;
  constraintCount: number;
  cycleCount: number;
  freeBoundaryCount: number;
  candidateCount: number;
  selectedSeed: string;
  assemblySolveMs: number;
  nonPlanarityRad: number;
  coarseOverlapScore: number;
  intrinsicDistortion: number;
  normalizedResidual: number;
  meanResidualMm: number;
  maxResidualMm: number;
  beforeMeanResidualMm: number;
  beforeMaxResidualMm: number;
  strategy: "constraint-spatial-shell" | "underconstrained-open" | "analytic-fast-path" | "isolated";
  reason: string;
  relationResiduals: SpatialRelationResidualDiagnostic[];
}

export interface ConstraintSpatialAssemblyResult {
  graph: GarmentSpatialConstraintGraph;
  poses: PanelSpatialPose[];
  components: ConstraintSpatialComponentDiagnostic[];
  assemblySolveMs: number;
}

export interface ConstraintSpatialAssemblyOptions {
  maxIterations?: number;
  poseDamping?: number;
  tangentWeight?: number;
}

interface Pose {
  q: Quaternion;
  t: Vec3;
}

interface WeightedPair {
  source: Vec3;
  target: Vec3;
  weight: number;
}

interface CandidateSolution {
  name: string;
  positions: Float32Array;
  poses: Map<string, Pose>;
  score: number;
  normalizedResidual: number;
  meanResidualMm: number;
  maxResidualMm: number;
  nonPlanarityRad: number;
  coarseOverlapScore: number;
  intrinsicDistortion: number;
  relationResiduals: SpatialRelationResidualDiagnostic[];
}

const EPS = 1e-9;
const IDENTITY_POSE: Pose = { q: [0, 0, 0, 1], t: [0, 0, 0] };

/**
 * Material multigraph used by Prompt 10.6. A relation is keyed by SeamGroup +
 * concrete EdgeRange pair, not merely by the two PanelInstances. Parallel
 * material relations between the same nodes are intentionally preserved.
 */
export function buildGarmentSpatialConstraintGraph(
  state: GarmentAssemblyState,
  visibleInstanceIds?: ReadonlySet<string>,
): GarmentSpatialConstraintGraph {
  const instances = state.instances
    .filter((instance) => !visibleInstanceIds || visibleInstanceIds.has(instance.id))
    .sort(compareInstances);
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const relationMap = new Map<string, GarmentSpatialConstraintRelation>();

  for (const stitch of state.stitchConstraints) {
    const rawA = stitch.instanceA;
    const rawB = stitch.instanceB;
    if (!rawA || !rawB || !instanceById.has(rawA) || !instanceById.has(rawB)) continue;
    const normalized = normalizeStitchOrientation(stitch, rawA, rawB);
    const relationId = materialRelationKey(normalized.stitch, normalized.panelA, normalized.panelB);
    const existing = relationMap.get(relationId);
    const sample: SpatialConstraintSample = {
      id: stitch.id,
      progress: stitch.progress ?? 0,
      a: cloneReference(normalized.a),
      b: cloneReference(normalized.b),
      ...(normalized.rangeA ? { rangeA: { ...normalized.rangeA } } : {}),
      ...(normalized.rangeB ? { rangeB: { ...normalized.rangeB } } : {}),
      restDistanceM: Math.max(0, stitch.restDistance),
    };
    if (existing) {
      existing.samples.push(sample);
      existing.characteristicLengthM = Math.max(
        existing.characteristicLengthM,
        characteristicLengthFromStitch(stitch),
      );
      continue;
    }
    const classification = classifyStitchRelation(stitch, normalized.panelA, normalized.panelB);
    relationMap.set(relationId, {
      id: relationId,
      seamGroupId: stitch.seamGroupId || stitch.seamId,
      panelA: normalized.panelA,
      panelB: normalized.panelB,
      samples: [sample],
      classification,
      structuralWeight: classificationWeight(classification),
      characteristicLengthM: characteristicLengthFromStitch(stitch),
      treatment: stitch.treatment,
      targetRatio: stitch.targetRatio,
      slackMm: stitch.slackMm,
      direction: stitch.direction ?? "same",
      localTangentA: [0, 0, 0],
      localTangentB: [0, 0, 0],
      localBoundaryOrientationA: [0, 0, 0],
      localBoundaryOrientationB: [0, 0, 0],
    });
  }

  const relations = [...relationMap.values()]
    .map((relation) => {
      const samples = [...relation.samples].sort((left, right) => left.progress - right.progress || left.id.localeCompare(right.id));
      const panelA = instanceById.get(relation.panelA);
      const panelB = instanceById.get(relation.panelB);
      const localTangentA = panelA ? localMaterialTangent(panelA, samples, "a") : [0, 0, 0] as Vec3;
      const localTangentB = panelB ? localMaterialTangent(panelB, samples, "b") : [0, 0, 0] as Vec3;
      return {
        ...relation,
        samples,
        characteristicLengthM: Math.max(
          0.001,
          relation.characteristicLengthM,
          sampledRelationLength(state.positions, relation),
        ),
        localTangentA,
        localTangentB,
        localBoundaryOrientationA: [-localTangentA[1], localTangentA[0], 0] as Vec3,
        localBoundaryOrientationB: [-localTangentB[1], localTangentB[0], 0] as Vec3,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const nodes = instances.map((instance) => ({
    id: instance.id,
    pieceId: instance.pieceId,
    geometrySignature: instance.geometrySignature,
    vertexCount: instance.vertexCount,
  }));
  const components = buildComponents(instances, relations);
  return { nodes, relations, components };
}

/**
 * Reconciles every connected component with a global rigid-pose optimization.
 * Legacy tube/rigid propagation may seed the input positions, but no seed is
 * accepted as the final answer until all material relations have participated
 * in the objective.
 */
export function solveGarmentSpatialConstraints(
  state: GarmentAssemblyState,
  visibleInstanceIds?: ReadonlySet<string>,
  options: ConstraintSpatialAssemblyOptions = {},
): ConstraintSpatialAssemblyResult {
  const startedAt = nowMs();
  const graph = buildGarmentSpatialConstraintGraph(state, visibleInstanceIds);
  const relationById = new Map(graph.relations.map((relation) => [relation.id, relation]));
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  const legacyStatePositions = new Float32Array(state.positions);
  // `initialPositions` is the material-preserving physical-panel state emitted by
  // GarmentAssembly before semantic/tube mappings bend individual panels. It is
  // a first-class seed so a legacy analytical embedding cannot win merely because
  // it already curved a panel while preloading structural strain.
  const intrinsicFlatStatePositions = new Float32Array(state.initialPositions);
  const allPoses = new Map<string, Pose>();
  for (const instance of state.instances) allPoses.set(instance.id, clonePose(IDENTITY_POSE));
  const diagnostics: ConstraintSpatialComponentDiagnostic[] = [];

  for (const component of graph.components) {
    const componentStartedAt = nowMs();
    const relations = component.relationIds
      .map((id) => relationById.get(id))
      .filter((relation): relation is GarmentSpatialConstraintRelation => relation !== undefined);
    if (component.nodeIds.length === 1) {
      const instance = instanceById.get(component.nodeIds[0]);
      const strategy = instance?.arrangement?.mapping === "seam-derived-tube"
        ? "analytic-fast-path" as const
        : relations.length > 0
          ? "underconstrained-open" as const
          : "isolated" as const;
      const metrics = evaluateCandidateMetrics(
        state,
        legacyStatePositions,
        component,
        relations,
      );
      diagnostics.push({
        componentId: component.id,
        nodeIds: [...component.nodeIds],
        anchorId: component.anchorId,
        constraintCount: relations.length,
        cycleCount: component.cycleCount,
        freeBoundaryCount: component.freeBoundaryCount,
        candidateCount: 1,
        selectedSeed: "existing-isometric-seed",
        assemblySolveMs: nowMs() - componentStartedAt,
        beforeMeanResidualMm: metrics.meanResidualMm,
        beforeMaxResidualMm: metrics.maxResidualMm,
        ...metrics,
        strategy,
        reason: strategy === "analytic-fast-path"
          ? "self-seam-isometric-embedding-preserved"
          : strategy === "isolated"
            ? "no-material-relations"
            : "single-panel-local-closure",
      });
      continue;
    }

    const beforeMetrics = evaluateCandidateMetrics(
      state,
      legacyStatePositions,
      component,
      relations,
    );

    // A graph with no cycle and no parallel independent material relation is
    // genuinely underconstrained around at least one hinge. The previous
    // geometric propagation already provides a deterministic rigid/open pose.
    // Do not manufacture a dihedral angle or introduce Float32 drift merely to
    // reduce a local seam residual when the material graph cannot disambiguate
    // that degree of freedom.
    if (!component.supportsSpatialShell) {
      const frozen = evaluateFrozenCandidate(
        state,
        legacyStatePositions,
        component,
        relations,
        "validated-existing-embedding",
        "existing-embedding",
      );
      diagnostics.push({
        componentId: component.id,
        nodeIds: [...component.nodeIds],
        anchorId: component.anchorId,
        constraintCount: relations.length,
        cycleCount: component.cycleCount,
        freeBoundaryCount: component.freeBoundaryCount,
        candidateCount: 1,
        selectedSeed: frozen.name,
        assemblySolveMs: nowMs() - componentStartedAt,
        nonPlanarityRad: frozen.nonPlanarityRad,
        coarseOverlapScore: frozen.coarseOverlapScore,
        intrinsicDistortion: frozen.intrinsicDistortion,
        normalizedResidual: frozen.normalizedResidual,
        meanResidualMm: frozen.meanResidualMm,
        maxResidualMm: frozen.maxResidualMm,
        beforeMeanResidualMm: beforeMetrics.meanResidualMm,
        beforeMaxResidualMm: beforeMetrics.maxResidualMm,
        strategy: "underconstrained-open",
        reason: "insufficient-independent-relations-preserve-deterministic-open-pose",
        relationResiduals: frozen.relationResiduals,
      });
      continue;
    }

    const candidates: Array<{
      name: string;
      positions: Float32Array;
      intrinsicMode: "existing-embedding" | "euclidean";
      optimize: boolean;
    }> = [
      {
        name: "validated-existing-embedding",
        positions: new Float32Array(legacyStatePositions),
        intrinsicMode: "existing-embedding",
        optimize: false,
      },
      {
        name: "legacy-geometric-seed",
        positions: new Float32Array(legacyStatePositions),
        intrinsicMode: "existing-embedding",
        optimize: true,
      },
      {
        name: "material-flat-seed",
        positions: new Float32Array(intrinsicFlatStatePositions),
        intrinsicMode: "euclidean",
        optimize: true,
      },
    ];
    if (component.supportsSpatialShell) {
      candidates.push({
        name: "material-flat-hinge-positive",
        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, 1),
        intrinsicMode: "euclidean",
        optimize: true,
      });
      candidates.push({
        name: "material-flat-hinge-negative",
        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, -1),
        intrinsicMode: "euclidean",
        optimize: true,
      });
    }

    let best: CandidateSolution | undefined;
    for (const candidate of candidates) {
      const solved = candidate.optimize
        ? optimizeCandidate(
            state,
            candidate.positions,
            component,
            relations,
            options,
            candidate.name,
            candidate.intrinsicMode,
          )
        : evaluateFrozenCandidate(
            state,
            candidate.positions,
            component,
            relations,
            candidate.name,
            candidate.intrinsicMode,
          );
      if (!best || solved.score < best.score - 1e-10 || (
        Math.abs(solved.score - best.score) <= 1e-10 && solved.name.localeCompare(best.name) < 0
      )) best = solved;
    }
    if (!best) continue;

    copyComponentPositions(best.positions, state.positions, component, instanceById);
    for (const nodeId of component.nodeIds) {
      allPoses.set(nodeId, clonePose(best.poses.get(nodeId) ?? IDENTITY_POSE));
      const instance = instanceById.get(nodeId);
      if (!instance?.arrangement) continue;
      instance.arrangement.outwardNormal = representativeNormal(state.positions, instance);
      // The component strategy is constraint-based, but a validated analytical
      // embedding remains an internal representation of this individual panel.
      // Keeping it prevents the global solver from erasing geodesic/isometric
      // metadata for self-seam tubes and bands.
      if (instance.arrangement.mapping !== "seam-derived-tube") {
        instance.arrangement.mapping = "constraint-spatial-shell";
      }
    }

    diagnostics.push({
      componentId: component.id,
      nodeIds: [...component.nodeIds],
      anchorId: component.anchorId,
      constraintCount: relations.length,
      cycleCount: component.cycleCount,
      freeBoundaryCount: component.freeBoundaryCount,
      candidateCount: candidates.length,
      selectedSeed: best.name,
      assemblySolveMs: nowMs() - componentStartedAt,
      nonPlanarityRad: best.nonPlanarityRad,
      coarseOverlapScore: best.coarseOverlapScore,
      intrinsicDistortion: best.intrinsicDistortion,
      normalizedResidual: best.normalizedResidual,
      meanResidualMm: best.meanResidualMm,
      maxResidualMm: best.maxResidualMm,
      beforeMeanResidualMm: beforeMetrics.meanResidualMm,
      beforeMaxResidualMm: beforeMetrics.maxResidualMm,
      strategy: component.supportsSpatialShell ? "constraint-spatial-shell" : "underconstrained-open",
      reason: component.supportsSpatialShell
        ? "global-material-constraint-pose-optimization"
        : "global-best-fit-with-underconstrained-hinges",
      relationResiduals: best.relationResiduals,
    });
  }

  return {
    graph,
    poses: [...allPoses.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([panelInstanceId, pose]) => ({
        panelInstanceId,
        rotation: [...pose.q] as Quaternion,
        translation: [...pose.t] as Vec3,
      })),
    components: diagnostics,
    assemblySolveMs: nowMs() - startedAt,
  };
}

function evaluateFrozenCandidate(
  state: GarmentAssemblyState,
  positions: Float32Array,
  component: GarmentSpatialConstraintComponent,
  relations: readonly GarmentSpatialConstraintRelation[],
  name: string,
  intrinsicMode: "existing-embedding" | "euclidean",
): CandidateSolution {
  const frozen = new Float32Array(positions);
  const metrics = evaluateCandidateMetrics(state, frozen, component, relations, intrinsicMode);
  const poses = new Map<string, Pose>(component.nodeIds.map((id) => [id, clonePose(IDENTITY_POSE)]));
  return {
    name,
    positions: frozen,
    poses,
    score: objectiveScore(component, metrics),
    ...metrics,
  };
}

function optimizeCandidate(
  state: GarmentAssemblyState,
  candidatePositions: Float32Array,
  component: GarmentSpatialConstraintComponent,
  relations: readonly GarmentSpatialConstraintRelation[],
  options: ConstraintSpatialAssemblyOptions,
  name: string,
  intrinsicMode: "existing-embedding" | "euclidean",
): CandidateSolution {
  const basePositions = new Float32Array(candidatePositions);
  const poses = new Map<string, Pose>(component.nodeIds.map((id) => [id, clonePose(IDENTITY_POSE)]));
  const maxIterations = Math.max(4, Math.min(80, options.maxIterations ?? 28));
  const damping = clamp(options.poseDamping ?? 0.62, 0.1, 1);
  const tangentWeight = clamp(options.tangentWeight ?? 0.22, 0, 1);
  const relationByNode = new Map<string, GarmentSpatialConstraintRelation[]>();
  for (const id of component.nodeIds) relationByNode.set(id, []);
  for (const relation of relations) {
    if (relation.panelA === relation.panelB) continue;
    relationByNode.get(relation.panelA)?.push(relation);
    relationByNode.get(relation.panelB)?.push(relation);
  }
  for (const list of relationByNode.values()) list.sort((left, right) => left.id.localeCompare(right.id));

  let previousObjective = Number.POSITIVE_INFINITY;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const poseSnapshot = new Map([...poses.entries()].map(([id, pose]) => [id, clonePose(pose)]));
    const pending = new Map<string, Pose>();
    for (const nodeId of component.nodeIds) {
      if (nodeId === component.anchorId) continue;
      const currentPose = poseSnapshot.get(nodeId) ?? IDENTITY_POSE;
      const pairs = buildNodePairs(
        nodeId,
        basePositions,
        poseSnapshot,
        relationByNode.get(nodeId) ?? [],
        state,
        component,
        tangentWeight,
      );
      if (pairs.length === 0) continue;
      const solved = solveWeightedRigidPose(pairs);
      pending.set(nodeId, blendPose(currentPose, solved, damping));
    }
    for (const [id, pose] of pending) poses.set(id, pose);

    if (iteration % 3 === 2 || iteration === maxIterations - 1) {
      const scratch = renderComponentPoses(basePositions, state, component, poses);
      const metrics = evaluateCandidateMetrics(state, scratch, component, relations, intrinsicMode);
      const objective = objectiveScore(component, metrics);
      if (Math.abs(previousObjective - objective) <= 2e-7) break;
      previousObjective = objective;
    }
  }

  const positions = renderComponentPoses(basePositions, state, component, poses);
  const metrics = evaluateCandidateMetrics(state, positions, component, relations, intrinsicMode);
  return {
    name,
    positions,
    poses,
    score: objectiveScore(component, metrics),
    ...metrics,
  };
}

function buildNodePairs(
  nodeId: string,
  basePositions: Float32Array,
  poses: ReadonlyMap<string, Pose>,
  relations: readonly GarmentSpatialConstraintRelation[],
  state: GarmentAssemblyState,
  component: GarmentSpatialConstraintComponent,
  tangentWeight: number,
): WeightedPair[] {
  const pairs: WeightedPair[] = [];
  const currentPose = poses.get(nodeId) ?? IDENTITY_POSE;
  for (const relation of relations) {
    if (relation.panelA === relation.panelB || relation.structuralWeight <= 0) continue;
    const nodeIsA = relation.panelA === nodeId;
    const neighborId = nodeIsA ? relation.panelB : relation.panelA;
    const neighborPose = poses.get(neighborId) ?? IDENTITY_POSE;
    const weight = relation.structuralWeight;
    for (const sample of relation.samples) {
      const sourceRef = nodeIsA ? sample.a : sample.b;
      const targetRef = nodeIsA ? sample.b : sample.a;
      const source = evaluateReference(basePositions, sourceRef);
      const targetLocal = evaluateReference(basePositions, targetRef);
      pairs.push({ source, target: transformPoint(neighborPose, targetLocal), weight });
    }
    if (relation.samples.length >= 2 && tangentWeight > 0) {
      const first = relation.samples[0];
      const last = relation.samples[relation.samples.length - 1];
      const sourceFirst = evaluateReference(basePositions, nodeIsA ? first.a : first.b);
      const sourceLast = evaluateReference(basePositions, nodeIsA ? last.a : last.b);
      const targetFirst = transformPoint(neighborPose, evaluateReference(basePositions, nodeIsA ? first.b : first.a));
      const targetLast = transformPoint(neighborPose, evaluateReference(basePositions, nodeIsA ? last.b : last.a));
      const sourceTangent = normalize(subtract(sourceLast, sourceFirst));
      const targetTangent = normalize(subtract(targetLast, targetFirst));
      const sourceMid = scale(add(sourceFirst, sourceLast), 0.5);
      const targetMid = scale(add(targetFirst, targetLast), 0.5);
      const lever = clamp(relation.characteristicLengthM * 0.16, 0.008, 0.055);
      const tangentPairWeight = weight * tangentWeight;
      pairs.push({
        source: add(sourceMid, scale(sourceTangent, lever)),
        target: add(targetMid, scale(targetTangent, lever)),
        weight: tangentPairWeight,
      });
      pairs.push({
        source: subtract(sourceMid, scale(sourceTangent, lever)),
        target: subtract(targetMid, scale(targetTangent, lever)),
        weight: tangentPairWeight,
      });
    }
  }

  const instance = state.instances.find((candidate) => candidate.id === nodeId);
  if (instance) {
    const relationCount = relations.filter((relation) => relation.panelA !== relation.panelB).length;
    const regularizationWeight = component.supportsSpatialShell
      ? 0.012
      : relationCount <= 1 ? 0.16 : 0.045;
    const controlPoints = panelControlPoints(basePositions, instance);
    for (const source of controlPoints) {
      pairs.push({
        source,
        target: transformPoint(currentPose, source),
        weight: regularizationWeight,
      });
    }
  }
  return pairs;
}

function solveWeightedRigidPose(pairs: readonly WeightedPair[]): Pose {
  let totalWeight = 0;
  let sourceCenter: Vec3 = [0, 0, 0];
  let targetCenter: Vec3 = [0, 0, 0];
  for (const pair of pairs) {
    if (!Number.isFinite(pair.weight) || pair.weight <= 0) continue;
    totalWeight += pair.weight;
    sourceCenter = add(sourceCenter, scale(pair.source, pair.weight));
    targetCenter = add(targetCenter, scale(pair.target, pair.weight));
  }
  if (totalWeight <= EPS) return clonePose(IDENTITY_POSE);
  sourceCenter = scale(sourceCenter, 1 / totalWeight);
  targetCenter = scale(targetCenter, 1 / totalWeight);

  let sxx = 0; let sxy = 0; let sxz = 0;
  let syx = 0; let syy = 0; let syz = 0;
  let szx = 0; let szy = 0; let szz = 0;
  for (const pair of pairs) {
    if (!Number.isFinite(pair.weight) || pair.weight <= 0) continue;
    const s = subtract(pair.source, sourceCenter);
    const t = subtract(pair.target, targetCenter);
    const w = pair.weight;
    sxx += w * s[0] * t[0]; sxy += w * s[0] * t[1]; sxz += w * s[0] * t[2];
    syx += w * s[1] * t[0]; syy += w * s[1] * t[1]; syz += w * s[1] * t[2];
    szx += w * s[2] * t[0]; szy += w * s[2] * t[1]; szz += w * s[2] * t[2];
  }
  const trace = sxx + syy + szz;
  const matrix = [
    trace, syz - szy, szx - sxz, sxy - syx,
    syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
    szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
    sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
  ];
  let qWxyz: [number, number, number, number] = [1, 0, 0, 0];
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const next: [number, number, number, number] = [
      matrix[0] * qWxyz[0] + matrix[1] * qWxyz[1] + matrix[2] * qWxyz[2] + matrix[3] * qWxyz[3],
      matrix[4] * qWxyz[0] + matrix[5] * qWxyz[1] + matrix[6] * qWxyz[2] + matrix[7] * qWxyz[3],
      matrix[8] * qWxyz[0] + matrix[9] * qWxyz[1] + matrix[10] * qWxyz[2] + matrix[11] * qWxyz[3],
      matrix[12] * qWxyz[0] + matrix[13] * qWxyz[1] + matrix[14] * qWxyz[2] + matrix[15] * qWxyz[3],
    ];
    const length = Math.hypot(...next);
    if (length <= EPS) break;
    qWxyz = next.map((value) => value / length) as [number, number, number, number];
  }
  const q = normalizeQuaternion([qWxyz[1], qWxyz[2], qWxyz[3], qWxyz[0]]);
  const rotatedCenter = rotateVector(q, sourceCenter);
  const t = subtract(targetCenter, rotatedCenter);
  return { q, t };
}

function buildSpreadSeed(
  source: Float32Array,
  state: GarmentAssemblyState,
  component: GarmentSpatialConstraintComponent,
  relations: readonly GarmentSpatialConstraintRelation[],
  sign: 1 | -1,
): Float32Array {
  const positions = new Float32Array(source);
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  const adjacency = new Map<string, GarmentSpatialConstraintRelation[]>();
  for (const id of component.nodeIds) adjacency.set(id, []);
  for (const relation of relations) {
    if (relation.panelA === relation.panelB || relation.structuralWeight <= 0) continue;
    adjacency.get(relation.panelA)?.push(relation);
    adjacency.get(relation.panelB)?.push(relation);
  }
  for (const list of adjacency.values()) list.sort((left, right) => {
    return right.characteristicLengthM - left.characteristicLengthM || left.id.localeCompare(right.id);
  });
  const visited = new Set([component.anchorId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: component.anchorId, depth: 0 }];
  const baseAngle = Math.PI * 2 / Math.max(5, component.nodeIds.length + component.cycleCount + 3);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const relation of adjacency.get(current.id) ?? []) {
      const childId = relation.panelA === current.id ? relation.panelB : relation.panelA;
      if (visited.has(childId)) continue;
      const child = instanceById.get(childId);
      if (!child) continue;
      const currentIsA = relation.panelA === current.id;
      const pairs: WeightedPair[] = relation.samples.map((sample) => ({
        source: evaluateReference(positions, currentIsA ? sample.b : sample.a),
        target: evaluateReference(positions, currentIsA ? sample.a : sample.b),
        weight: Math.max(0.1, relation.structuralWeight),
      }));
      const align = solveWeightedRigidPose(pairs);
      applyPoseToInstance(positions, child, align);

      const first = relation.samples[0];
      const last = relation.samples[relation.samples.length - 1];
      if (first && last) {
        const parentFirst = evaluateReference(positions, currentIsA ? first.a : first.b);
        const parentLast = evaluateReference(positions, currentIsA ? last.a : last.b);
        const axis = normalize(subtract(parentLast, parentFirst));
        if (length(axis) > 0.5) {
          const origin = scale(add(parentFirst, parentLast), 0.5);
          const parity = current.depth % 2 === 0 ? 1 : -1;
          rotateInstanceAroundLine(
            positions,
            child,
            origin,
            axis,
            sign * parity * baseAngle,
          );
        }
      }
      visited.add(childId);
      queue.push({ id: childId, depth: current.depth + 1 });
    }
  }
  return positions;
}

function evaluateCandidateMetrics(
  state: GarmentAssemblyState,
  positions: Float32Array,
  component: GarmentSpatialConstraintComponent,
  relations: readonly GarmentSpatialConstraintRelation[],
  intrinsicMode: "existing-embedding" | "euclidean" = "existing-embedding",
): Omit<CandidateSolution, "name" | "positions" | "poses" | "score"> {
  const relationResiduals: SpatialRelationResidualDiagnostic[] = [];
  let weightedResidualM = 0;
  let weightedNormalized = 0;
  let weightTotal = 0;
  let maxResidualM = 0;
  for (const relation of relations) {
    if (relation.samples.length === 0) continue;
    let sum = 0;
    let maximum = 0;
    for (const sample of relation.samples) {
      const distance = length(subtract(
        evaluateReference(positions, sample.a),
        evaluateReference(positions, sample.b),
      ));
      sum += distance;
      maximum = Math.max(maximum, distance);
    }
    const mean = sum / relation.samples.length;
    const normalized = mean / Math.max(0.001, relation.characteristicLengthM);
    const w = relation.structuralWeight;
    if (w > 0) {
      weightedResidualM += mean * w;
      weightedNormalized += normalized * w;
      weightTotal += w;
    }
    maxResidualM = Math.max(maxResidualM, maximum);
    relationResiduals.push({
      relationId: relation.id,
      seamGroupId: relation.seamGroupId,
      classification: relation.classification,
      meanResidualMm: mean * 1000,
      maxResidualMm: maximum * 1000,
      normalizedMeanResidual: normalized,
    });
  }
  const intrinsicDistortion = intrinsicMode === "existing-embedding"
    ? measureIntrinsicDistortion({
        positions,
        structuralConstraints: state.structuralConstraints,
        instances: state.instances,
      }).maxRelativeDistortion
    : measurePhysicalEuclideanIntrinsicDistortion(positions, state, component);
  return {
    normalizedResidual: weightTotal > 0 ? weightedNormalized / weightTotal : 0,
    meanResidualMm: weightTotal > 0 ? weightedResidualM / weightTotal * 1000 : 0,
    maxResidualMm: maxResidualM * 1000,
    nonPlanarityRad: componentNonPlanarity(positions, state, component),
    coarseOverlapScore: componentOverlapScore(positions, state, component),
    intrinsicDistortion,
    relationResiduals: relationResiduals.sort((left, right) => left.relationId.localeCompare(right.relationId)),
  };
}

function objectiveScore(
  component: GarmentSpatialConstraintComponent,
  metrics: Pick<CandidateSolution, "normalizedResidual" | "nonPlanarityRad" | "coarseOverlapScore" | "intrinsicDistortion" | "relationResiduals">,
): number {
  const tangent = tangentObjective(metrics.relationResiduals);
  let planarityPenalty = 0;
  if (component.supportsSpatialShell) {
    const signal = component.cycleCount + component.parallelRelationCount;
    const targetSpread = Math.min(
      Math.PI * 0.5,
      Math.PI * signal / Math.max(2, component.nodeIds.length + component.relationIds.length),
    );
    planarityPenalty = targetSpread <= EPS
      ? 0
      : Math.max(0, targetSpread - metrics.nonPlanarityRad) / targetSpread;
  }
  return metrics.normalizedResidual
    + metrics.coarseOverlapScore * 0.32
    + planarityPenalty * 0.22
    + tangent * 0.04
    + metrics.intrinsicDistortion * 120;
}

function tangentObjective(_relations: readonly SpatialRelationResidualDiagnostic[]): number {
  // Tangent consistency already participates in Kabsch through explicit
  // pseudo-correspondences. Keeping this hook in the objective makes the
  // decomposition explicit without double-counting an angle surrogate.
  return 0;
}

function buildComponents(
  instances: readonly AssemblyPanelInstance[],
  relations: readonly GarmentSpatialConstraintRelation[],
): GarmentSpatialConstraintComponent[] {
  const adjacency = new Map<string, Set<string>>(instances.map((instance) => [instance.id, new Set<string>()]));
  for (const relation of relations) {
    if (relation.panelA === relation.panelB) continue;
    adjacency.get(relation.panelA)?.add(relation.panelB);
    adjacency.get(relation.panelB)?.add(relation.panelA);
  }
  const visited = new Set<string>();
  const result: GarmentSpatialConstraintComponent[] = [];
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const nodeIds: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      nodeIds.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    nodeIds.sort();
    const members = new Set(nodeIds);
    const componentRelations = relations.filter((relation) => members.has(relation.panelA) && members.has(relation.panelB));
    const interRelations = componentRelations.filter((relation) => relation.panelA !== relation.panelB);
    const pairCounts = new Map<string, number>();
    for (const relation of interRelations) {
      const key = pairKey(relation.panelA, relation.panelB);
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
    const parallelRelationCount = [...pairCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    const cycleCount = Math.max(0, interRelations.length - nodeIds.length + 1);
    const anchorId = deterministicAnchor(nodeIds, instances);
    result.push({
      id: nodeIds.join("|"),
      nodeIds,
      relationIds: componentRelations.map((relation) => relation.id).sort(),
      anchorId,
      cycleCount,
      parallelRelationCount,
      freeBoundaryCount: countFreeBoundaries(nodeIds, instances, componentRelations),
      supportsSpatialShell: cycleCount > 0 || parallelRelationCount > 0,
    });
  }
  return result;
}

function countFreeBoundaries(
  nodeIds: readonly string[],
  instances: readonly AssemblyPanelInstance[],
  relations: readonly GarmentSpatialConstraintRelation[],
): number {
  const members = new Set(nodeIds);
  const used = new Set<string>();
  for (const relation of relations) {
    for (const sample of relation.samples) {
      if (sample.rangeA) used.add(`${relation.panelA}\u0000${sample.rangeA.edgeId}`);
      if (sample.rangeB) used.add(`${relation.panelB}\u0000${sample.rangeB.edgeId}`);
    }
  }
  let free = 0;
  for (const instance of instances) {
    if (!members.has(instance.id)) continue;
    for (const edge of getPatternEdges(instance.topology.sourcePiece)) {
      if (!used.has(`${instance.id}\u0000${edge.id}`)) free += 1;
    }
  }
  return free;
}

function deterministicAnchor(
  nodeIds: readonly string[],
  instances: readonly AssemblyPanelInstance[],
): string {
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  return [...nodeIds].sort((left, right) => {
    const a = byId.get(left);
    const b = byId.get(right);
    const aKey = `${a?.geometrySignature ?? ""}\u0000${a?.vertexCount ?? 0}\u0000${left}`;
    const bKey = `${b?.geometrySignature ?? ""}\u0000${b?.vertexCount ?? 0}\u0000${right}`;
    return aKey.localeCompare(bKey);
  })[0];
}

function normalizeStitchOrientation(
  stitch: AssemblyStitchConstraint,
  rawA: string,
  rawB: string,
): {
  stitch: AssemblyStitchConstraint;
  panelA: string;
  panelB: string;
  a: GlobalPointReference;
  b: GlobalPointReference;
  rangeA?: EdgeRange;
  rangeB?: EdgeRange;
} {
  if (rawA.localeCompare(rawB) <= 0) {
    return {
      stitch,
      panelA: rawA,
      panelB: rawB,
      a: stitch.a,
      b: stitch.b,
      ...(stitch.rangeA ? { rangeA: stitch.rangeA } : {}),
      ...(stitch.rangeB ? { rangeB: stitch.rangeB } : {}),
    };
  }
  return {
    stitch,
    panelA: rawB,
    panelB: rawA,
    a: stitch.b,
    b: stitch.a,
    ...(stitch.rangeB ? { rangeA: stitch.rangeB } : {}),
    ...(stitch.rangeA ? { rangeB: stitch.rangeA } : {}),
  };
}

function materialRelationKey(
  stitch: AssemblyStitchConstraint,
  panelA: string,
  panelB: string,
): string {
  const normalized = normalizeStitchOrientation(stitch, stitch.instanceA ?? panelA, stitch.instanceB ?? panelB);
  return [
    pairKey(panelA, panelB),
    stitch.seamGroupId || stitch.seamId,
    rangeKey(normalized.rangeA),
    rangeKey(normalized.rangeB),
  ].join("\u0001");
}

function rangeKey(range: EdgeRange | undefined): string {
  if (!range) return "no-range";
  return `${range.edgeId}:${roundKey(range.startT)}:${roundKey(range.endT)}`;
}

function roundKey(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function classifyStitchRelation(
  stitch: AssemblyStitchConstraint,
  panelA: string,
  panelB: string,
): SpatialConstraintClassification {
  if (panelA === panelB || stitch.treatment === "dart" || stitch.seamId.startsWith("dart:")) {
    return "local-shaping-closure";
  }
  const treatment = stitch.treatment.toLowerCase();
  const ratioMismatch = Math.abs(stitch.targetRatio - 1);
  if (stitch.slackMm > 1 || ratioMismatch > 0.025 || treatment.includes("gather") || treatment.includes("ease")) {
    return "intentional-mismatch";
  }
  return "structural-alignment";
}

function classificationWeight(classification: SpatialConstraintClassification): number {
  if (classification === "structural-alignment") return 1;
  if (classification === "intentional-mismatch") return 0.32;
  return 0;
}

function characteristicLengthFromStitch(stitch: AssemblyStitchConstraint): number {
  return Math.max(stitch.rangeLengthAMm ?? 0, stitch.rangeLengthBMm ?? 0) * 0.001;
}

function localMaterialTangent(
  instance: AssemblyPanelInstance,
  samples: readonly SpatialConstraintSample[],
  side: "a" | "b",
): Vec3 {
  if (samples.length < 2) return [0, 0, 0];
  const first = evaluateLocalReference(instance, samples[0][side]);
  const last = evaluateLocalReference(instance, samples[samples.length - 1][side]);
  return normalize(subtract(last, first));
}

function evaluateLocalReference(
  instance: AssemblyPanelInstance,
  reference: GlobalPointReference,
): Vec3 {
  let result: Vec3 = [0, 0, 0];
  let total = 0;
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const globalParticle = reference.particleIndices[index];
    const local = globalParticle - instance.particleStart;
    if (local < 0 || local >= instance.vertexCount) continue;
    const weight = reference.weights[index] ?? 0;
    result = add(result, [
      instance.topology.positions2DMm[local * 2] * 0.001 * weight,
      -instance.topology.positions2DMm[local * 2 + 1] * 0.001 * weight,
      0,
    ]);
    total += weight;
  }
  return total > EPS && Math.abs(total - 1) > 1e-8 ? scale(result, 1 / total) : result;
}

function sampledRelationLength(
  positions: Float32Array,
  relation: GarmentSpatialConstraintRelation,
): number {
  if (relation.samples.length < 2) return 0;
  const first = relation.samples[0];
  const last = relation.samples[relation.samples.length - 1];
  return Math.max(
    length(subtract(evaluateReference(positions, last.a), evaluateReference(positions, first.a))),
    length(subtract(evaluateReference(positions, last.b), evaluateReference(positions, first.b))),
  );
}

function panelControlPoints(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): Vec3[] {
  const indices = new Set<number>();
  if (instance.vertexCount > 0) indices.add(0);
  if (instance.vertexCount > 1) indices.add(Math.floor(instance.vertexCount / 3));
  if (instance.vertexCount > 2) indices.add(Math.floor(instance.vertexCount * 2 / 3));
  if (instance.vertexCount > 3) indices.add(instance.vertexCount - 1);
  return [...indices].map((local) => {
    const offset = (instance.particleStart + local) * 3;
    return [positions[offset], positions[offset + 1], positions[offset + 2]];
  });
}

function measurePhysicalEuclideanIntrinsicDistortion(
  positions: Float32Array,
  state: GarmentAssemblyState,
  component: GarmentSpatialConstraintComponent,
): number {
  const members = new Set(component.nodeIds);
  const instanceByParticle = new Map<number, string>();
  for (const instance of state.instances) {
    if (!members.has(instance.id)) continue;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      instanceByParticle.set(instance.particleStart + local, instance.id);
    }
  }
  let maximum = 0;
  for (const constraint of state.structuralConstraints) {
    const instanceA = instanceByParticle.get(constraint.a);
    const instanceB = instanceByParticle.get(constraint.b);
    if (!instanceA || instanceA !== instanceB || constraint.restLength <= EPS) continue;
    const offsetA = constraint.a * 3;
    const offsetB = constraint.b * 3;
    const current = Math.hypot(
      positions[offsetB] - positions[offsetA],
      positions[offsetB + 1] - positions[offsetA + 1],
      positions[offsetB + 2] - positions[offsetA + 2],
    );
    maximum = Math.max(maximum, Math.abs(current - constraint.restLength) / constraint.restLength);
  }
  return maximum;
}

function componentNonPlanarity(
  positions: Float32Array,
  state: GarmentAssemblyState,
  component: GarmentSpatialConstraintComponent,
): number {
  const byId = new Map(state.instances.map((instance) => [instance.id, instance]));
  const normals = component.nodeIds
    .map((id) => byId.get(id))
    .filter((instance): instance is AssemblyPanelInstance => instance !== undefined)
    .map((instance) => representativeNormal(positions, instance));
  let spread = 0;
  for (let i = 0; i < normals.length; i += 1) {
    for (let j = i + 1; j < normals.length; j += 1) {
      const cosine = clamp(Math.abs(dot(normals[i], normals[j])), -1, 1);
      spread = Math.max(spread, Math.acos(cosine));
    }
  }
  return spread;
}

function componentOverlapScore(
  positions: Float32Array,
  state: GarmentAssemblyState,
  component: GarmentSpatialConstraintComponent,
): number {
  const byId = new Map(state.instances.map((instance) => [instance.id, instance]));
  const proxies = component.nodeIds
    .map((id) => byId.get(id))
    .filter((instance): instance is AssemblyPanelInstance => instance !== undefined)
    .map((instance) => panelProxy(positions, instance));
  if (proxies.length < 2) return 0;
  let score = 0;
  let pairs = 0;
  for (let i = 0; i < proxies.length; i += 1) {
    for (let j = i + 1; j < proxies.length; j += 1) {
      const threshold = Math.max(0.01, (proxies[i].radius + proxies[j].radius) * 0.22);
      const distance = length(subtract(proxies[i].center, proxies[j].center));
      score += Math.max(0, 1 - distance / threshold);
      pairs += 1;
    }
  }
  return pairs > 0 ? score / pairs : 0;
}

function panelProxy(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): { center: Vec3; radius: number } {
  let center: Vec3 = [0, 0, 0];
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    center = add(center, [positions[offset], positions[offset + 1], positions[offset + 2]]);
  }
  center = scale(center, 1 / Math.max(1, instance.vertexCount));
  let radius = 0;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    radius = Math.max(radius, length(subtract(
      [positions[offset], positions[offset + 1], positions[offset + 2]],
      center,
    )));
  }
  return { center, radius };
}

function representativeNormal(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): Vec3 {
  const triangles = instance.topology.triangles;
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = particlePoint(positions, instance.particleStart + triangles[index]);
    const b = particlePoint(positions, instance.particleStart + triangles[index + 1]);
    const c = particlePoint(positions, instance.particleStart + triangles[index + 2]);
    const normal = cross(subtract(b, a), subtract(c, a));
    if (length(normal) > 1e-8) return normalize(normal);
  }
  return [0, 0, 1];
}

function renderComponentPoses(
  basePositions: Float32Array,
  state: GarmentAssemblyState,
  component: GarmentSpatialConstraintComponent,
  poses: ReadonlyMap<string, Pose>,
): Float32Array {
  const positions = new Float32Array(basePositions);
  const byId = new Map(state.instances.map((instance) => [instance.id, instance]));
  for (const nodeId of component.nodeIds) {
    const instance = byId.get(nodeId);
    const pose = poses.get(nodeId);
    if (!instance || !pose) continue;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const offset = (instance.particleStart + local) * 3;
      const source: Vec3 = [basePositions[offset], basePositions[offset + 1], basePositions[offset + 2]];
      const target = transformPoint(pose, source);
      positions[offset] = target[0];
      positions[offset + 1] = target[1];
      positions[offset + 2] = target[2];
    }
  }
  return positions;
}

function copyComponentPositions(
  source: Float32Array,
  target: Float32Array,
  component: GarmentSpatialConstraintComponent,
  instanceById: ReadonlyMap<string, AssemblyPanelInstance>,
): void {
  for (const nodeId of component.nodeIds) {
    const instance = instanceById.get(nodeId);
    if (!instance) continue;
    const start = instance.particleStart * 3;
    const end = start + instance.vertexCount * 3;
    target.set(source.subarray(start, end), start);
  }
}

function applyPoseToInstance(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  pose: Pose,
): void {
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const target = transformPoint(pose, [positions[offset], positions[offset + 1], positions[offset + 2]]);
    positions[offset] = target[0];
    positions[offset + 1] = target[1];
    positions[offset + 2] = target[2];
  }
}

function rotateInstanceAroundLine(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  origin: Vec3,
  axis: Vec3,
  angle: number,
): void {
  const q = quaternionFromAxisAngle(axis, angle);
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const relative = subtract([positions[offset], positions[offset + 1], positions[offset + 2]], origin);
    const rotated = add(origin, rotateVector(q, relative));
    positions[offset] = rotated[0];
    positions[offset + 1] = rotated[1];
    positions[offset + 2] = rotated[2];
  }
}

function evaluateReference(
  positions: Float32Array,
  reference: GlobalPointReference,
): Vec3 {
  let result: Vec3 = [0, 0, 0];
  let total = 0;
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const particle = reference.particleIndices[index];
    const weight = reference.weights[index] ?? 0;
    const offset = particle * 3;
    result = add(result, scale([
      positions[offset],
      positions[offset + 1],
      positions[offset + 2],
    ], weight));
    total += weight;
  }
  return total > EPS && Math.abs(total - 1) > 1e-8 ? scale(result, 1 / total) : result;
}

function particlePoint(positions: Float32Array, particle: number): Vec3 {
  const offset = particle * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function cloneReference(reference: GlobalPointReference): GlobalPointReference {
  return { particleIndices: [...reference.particleIndices], weights: [...reference.weights] };
}

function pairKey(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function compareInstances(left: AssemblyPanelInstance, right: AssemblyPanelInstance): number {
  return left.id.localeCompare(right.id);
}

function blendPose(from: Pose, to: Pose, amount: number): Pose {
  return {
    q: slerp(from.q, to.q, amount),
    t: [
      from.t[0] + (to.t[0] - from.t[0]) * amount,
      from.t[1] + (to.t[1] - from.t[1]) * amount,
      from.t[2] + (to.t[2] - from.t[2]) * amount,
    ],
  };
}

function transformPoint(pose: Pose, point: Vec3): Vec3 {
  return add(rotateVector(pose.q, point), pose.t);
}

function rotateVector(q: Quaternion, vector: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const qv: Vec3 = [x, y, z];
  const uv = cross(qv, vector);
  const uuv = cross(qv, uv);
  return add(vector, add(scale(uv, 2 * w), scale(uuv, 2)));
}

function quaternionFromAxisAngle(axis: Vec3, angle: number): Quaternion {
  const unit = normalize(axis);
  const half = angle * 0.5;
  const sine = Math.sin(half);
  return normalizeQuaternion([unit[0] * sine, unit[1] * sine, unit[2] * sine, Math.cos(half)]);
}

function slerp(first: Quaternion, second: Quaternion, amount: number): Quaternion {
  let b = [...second] as Quaternion;
  let cosine = first[0] * b[0] + first[1] * b[1] + first[2] * b[2] + first[3] * b[3];
  if (cosine < 0) {
    b = [-b[0], -b[1], -b[2], -b[3]];
    cosine = -cosine;
  }
  if (cosine > 0.9995) {
    return normalizeQuaternion([
      first[0] + (b[0] - first[0]) * amount,
      first[1] + (b[1] - first[1]) * amount,
      first[2] + (b[2] - first[2]) * amount,
      first[3] + (b[3] - first[3]) * amount,
    ]);
  }
  const theta = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(theta);
  const aWeight = Math.sin((1 - amount) * theta) / sine;
  const bWeight = Math.sin(amount * theta) / sine;
  return normalizeQuaternion([
    first[0] * aWeight + b[0] * bWeight,
    first[1] * aWeight + b[1] * bWeight,
    first[2] * aWeight + b[2] * bWeight,
    first[3] * aWeight + b[3] * bWeight,
  ]);
}

function normalizeQuaternion(q: Quaternion): Quaternion {
  const magnitude = Math.hypot(...q);
  if (magnitude <= EPS) return [0, 0, 0, 1];
  const normalized = q.map((value) => value / magnitude) as Quaternion;
  return normalized[3] < 0
    ? [-normalized[0], -normalized[1], -normalized[2], -normalized[3]]
    : normalized;
}

function clonePose(pose: Pose): Pose {
  return { q: [...pose.q] as Quaternion, t: [...pose.t] as Vec3 };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  return magnitude <= EPS ? [0, 0, 0] : scale(vector, 1 / magnitude);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
