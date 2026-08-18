import {
  edgeRangeSequenceLength,
  getPatternEdges,
  resolveEdgeRangeSequenceProgress,
  seamSideRanges,
  type EdgeRange,
  type GarmentDraft,
  type Seam,
} from "../domain/pattern";
import type {
  AssemblyPanelInstance,
  AssemblyStitchConstraint,
  GarmentAssemblyState,
  GlobalPointReference,
} from "./GarmentAssembly";
import { orderCompositeEdgeRangesByContinuity } from "./CompositeEdgeRangeOrder";

const METERS_TO_MM = 1_000;
const EPSILON = 1e-8;
const WEIGHT_TOLERANCE = 1e-4;

export type SeamResidualClass =
  | "structural-alignment"
  | "local-shaping-closure"
  | "intentional-mismatch";

export interface SeamResidualSideSample {
  panelInstanceId?: string;
  patternDefinitionId?: string;
  range?: EdgeRange;
  rangeOrder?: number;
  localArcLengthMm?: number;
  globalArcLengthMm?: number;
  t?: number;
  particleIndices: number[];
  interpolationWeights: number[];
  positionM: [number, number, number];
}

export interface SeamResidualWorstSample {
  sampleIndex: number;
  constraintIndex: number;
  sideA: SeamResidualSideSample;
  sideB: SeamResidualSideSample;
  distanceMm: number;
  intendedRestDistanceMm: number;
  residualMm: number;
}

export interface SeamGroupResidualDiagnostic {
  seamGroupId: string;
  seamIds: string[];
  classification: SeamResidualClass;
  treatments: string[];
  directions: string[];
  instanceIds: string[];
  patternDefinitionIds: string[];
  rangesA: EdgeRange[];
  rangesB: EdgeRange[];
  materialLengthAMm: number;
  materialLengthBMm: number;
  sampleCount: number;
  meanDistanceMm: number;
  maxDistanceMm: number;
  meanResidualMm: number;
  maxResidualMm: number;
  worstSample: SeamResidualWorstSample;
}

export interface InitialSeamResidualAudit {
  stage: "assembly" | "adapter";
  sampleCount: number;
  meanResidualMm: number;
  maxResidualMm: number;
  groups: SeamGroupResidualDiagnostic[];
  invariantErrors: string[];
}

export interface AdapterSeamSampleDiagnostic {
  constraintIndex: number;
  seamGroupId: string;
  assemblyDistanceMm: number;
  adapterDistanceMm: number;
  correspondenceJumpMm: number;
  adapterRestDistanceMm: number;
  adapterResidualMm: number;
}

export interface AdapterSeamResidualAudit extends InitialSeamResidualAudit {
  stage: "adapter";
  maximumCorrespondenceJumpMm: number;
  worstCorrespondenceJump?: AdapterSeamSampleDiagnostic;
}

export interface TubeGroupAlignmentCorrection {
  fixedTubeGroupIds: string[];
  movingTubeGroupId: string;
  seamGroupIds: string[];
  sampleCount: number;
  phaseRotationRad: number;
  translationM: [number, number, number];
  meanDistanceBeforeMm: number;
  maxDistanceBeforeMm: number;
  meanDistanceAfterMm: number;
  maxDistanceAfterMm: number;
}

export interface TubeGroupAlignmentResult {
  corrections: TubeGroupAlignmentCorrection[];
}

/**
 * Audita a condição espacial que o assembly entregará ao adapter.
 * O gap físico e o residual contra o restDistance são mantidos separados para
 * que uma diferença de semântica de rest distance nunca pareça erro de mapping.
 */
export function auditAssemblySeamResiduals(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
): InitialSeamResidualAudit {
  return buildAudit(
    "assembly",
    state,
    garment,
    state.positions,
    state.stitchConstraints.map((constraint) => ({
      a: constraint.a,
      b: constraint.b,
      restDistanceM: Math.max(0, constraint.restDistance),
    })),
  );
}

/**
 * Reavalia exatamente as references que serão serializadas para o Worker.
 * Um salto entre assemblyDistanceMm e adapterDistanceMm significa que o erro
 * nasceu no adapter/source mapping, independentemente do valor de restDistance.
 */
export function auditAdapterSeamResiduals(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  positions: Float32Array,
  seamIndices: Uint32Array,
  seamWeights: Float32Array,
  seamRestDistances: Float32Array,
  seamGroupIds: readonly string[],
): AdapterSeamResidualAudit {
  const references = state.stitchConstraints.map((_constraint, index) => ({
    a: packedReference(seamIndices, seamWeights, index, 0),
    b: packedReference(seamIndices, seamWeights, index, 2),
    restDistanceM: seamRestDistances[index] ?? 0,
  }));
  const base = buildAudit("adapter", state, garment, positions, references);
  const samples: AdapterSeamSampleDiagnostic[] = state.stitchConstraints.map((constraint, index) => {
    const assemblyDistanceMm = referenceDistanceM(state.positions, constraint.a, constraint.b) * METERS_TO_MM;
    const adapterDistanceMm = referenceDistanceM(positions, references[index].a, references[index].b) * METERS_TO_MM;
    const adapterRestDistanceMm = references[index].restDistanceM * METERS_TO_MM;
    return {
      constraintIndex: index,
      seamGroupId: seamGroupIds[index] ?? constraint.seamGroupId,
      assemblyDistanceMm,
      adapterDistanceMm,
      correspondenceJumpMm: Math.abs(adapterDistanceMm - assemblyDistanceMm),
      adapterRestDistanceMm,
      adapterResidualMm: Math.abs(adapterDistanceMm - adapterRestDistanceMm),
    };
  });
  const worstCorrespondenceJump = [...samples].sort(
    (left, right) => right.correspondenceJumpMm - left.correspondenceJumpMm,
  )[0];
  return {
    ...base,
    stage: "adapter",
    maximumCorrespondenceJumpMm: worstCorrespondenceJump?.correspondenceJumpMm ?? 0,
    worstCorrespondenceJump,
  };
}

/**
 * Corrige somente a pose rígida entre subestruturas tubulares já válidas.
 * Nenhuma partícula é ajustada individualmente, nenhum raio é escalado e o 2D
 * permanece intocado. Primeiro resolve a fase angular, depois a translação.
 */
export function alignSecondaryTubeGroups(
  state: GarmentAssemblyState,
): TubeGroupAlignmentResult {
  const groups = collectTubeGroups(state.instances);
  if (groups.size < 2) return { corrections: [] };

  const groupByInstanceId = new Map<string, string>();
  for (const [groupId, group] of groups) {
    for (const instance of group.instances) groupByInstanceId.set(instance.id, groupId);
  }

  const bridges = new Map<string, AssemblyStitchConstraint[]>();
  const adjacency = new Map<string, Set<string>>(
    [...groups.keys()].map((groupId) => [groupId, new Set<string>()]),
  );
  for (const constraint of state.stitchConstraints) {
    if (!isRigidStructuralBridge(constraint)) continue;
    const firstGroup = constraint.instanceA ? groupByInstanceId.get(constraint.instanceA) : undefined;
    const secondGroup = constraint.instanceB ? groupByInstanceId.get(constraint.instanceB) : undefined;
    if (!firstGroup || !secondGroup || firstGroup === secondGroup) continue;
    const key = groupPairKey(firstGroup, secondGroup);
    const list = bridges.get(key) ?? [];
    list.push(constraint);
    bridges.set(key, list);
    adjacency.get(firstGroup)?.add(secondGroup);
    adjacency.get(secondGroup)?.add(firstGroup);
  }

  const corrections: TubeGroupAlignmentCorrection[] = [];
  const visitedComponents = new Set<string>();
  for (const start of [...groups.keys()].sort()) {
    if (visitedComponents.has(start)) continue;
    const component: string[] = [];
    const discover = [start];
    visitedComponents.add(start);
    while (discover.length > 0) {
      const current = discover.shift()!;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (visitedComponents.has(neighbor)) continue;
        visitedComponents.add(neighbor);
        discover.push(neighbor);
      }
    }
    if (component.length < 2) continue;
    component.sort((left, right) => {
      const scoreDifference = (groups.get(right)?.scoreMm2 ?? 0) - (groups.get(left)?.scoreMm2 ?? 0);
      return Math.abs(scoreDifference) > EPSILON ? scoreDifference : left.localeCompare(right);
    });
    const root = component[0];
    const placed = new Set([root]);
    const queue = [root];
    while (queue.length > 0) {
      const fixedGroupId = queue.shift()!;
      for (const movingGroupId of [...(adjacency.get(fixedGroupId) ?? [])].sort()) {
        if (placed.has(movingGroupId)) continue;
        const connectedPlacedGroups = [...placed].filter(
          (candidate) => (adjacency.get(movingGroupId) ?? new Set()).has(candidate),
        );
        const constraints = connectedPlacedGroups.flatMap(
          (candidate) => bridges.get(groupPairKey(candidate, movingGroupId)) ?? [],
        );
        const moving = groups.get(movingGroupId);
        if (!moving || constraints.length === 0) continue;
        const correction = alignTubeGroup(
          state,
          groups,
          groupByInstanceId,
          connectedPlacedGroups,
          movingGroupId,
          moving.instances,
          constraints,
        );
        if (correction) corrections.push(correction);
        placed.add(movingGroupId);
        queue.push(movingGroupId);
      }
    }
  }

  return { corrections };
}

export function assertSeamReferenceInvariants(
  state: GarmentAssemblyState,
): void {
  const errors = collectInvariantErrors(state, state.positions, state.stitchConstraints.map((constraint) => ({
    a: constraint.a,
    b: constraint.b,
    restDistanceM: constraint.restDistance,
  })));
  if (errors.length > 0) {
    throw new RangeError(`Seam reference inválida:\n${errors.join("\n")}`);
  }
}

interface AuditReferencePair {
  a: GlobalPointReference;
  b: GlobalPointReference;
  restDistanceM: number;
}

function buildAudit(
  stage: "assembly" | "adapter",
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  positions: Float32Array,
  references: readonly AuditReferencePair[],
): InitialSeamResidualAudit {
  const seamById = new Map((garment.seams ?? []).map((seam) => [seam.id, seam]));
  const pieces = garment.pieces;
  const grouped = new Map<string, number[]>();
  state.stitchConstraints.forEach((constraint, index) => {
    const list = grouped.get(constraint.seamGroupId) ?? [];
    list.push(index);
    grouped.set(constraint.seamGroupId, list);
  });

  let residualSum = 0;
  let residualMaximum = 0;
  let sampleCount = 0;
  const groups: SeamGroupResidualDiagnostic[] = [];
  for (const [seamGroupId, indices] of grouped) {
    let distanceSum = 0;
    let distanceMaximum = 0;
    let groupResidualSum = 0;
    let groupResidualMaximum = -1;
    let worst: SeamResidualWorstSample | undefined;
    const constraints = indices.map((index) => state.stitchConstraints[index]);
    const seams = unique(
      constraints.map((constraint) => seamById.get(constraint.seamId)).filter((seam): seam is Seam => Boolean(seam)),
      (seam) => seam.id,
    );
    const treatments = uniqueStrings(constraints.map((constraint) => constraint.treatment));
    const directions = uniqueStrings(seams.map((seam) => seam.direction));
    const instances = uniqueStrings(constraints.flatMap((constraint) => [constraint.instanceA, constraint.instanceB].filter(Boolean) as string[]));
    const patternDefinitionIds = uniqueStrings(instances.map(
      (id) => state.instances.find((instance) => instance.id === id)?.sourcePatternId,
    ).filter(Boolean) as string[]);
    const rangesA = seams.length > 0
      ? seams.flatMap((seam) => orderCompositeEdgeRangesByContinuity(pieces, seamSideRanges(seam, "first"))).map(cloneRange)
      : uniqueRanges(constraints.map((constraint) => constraint.rangeA).filter(isEdgeRange));
    const rangesB = seams.length > 0
      ? seams.flatMap((seam) => orderCompositeEdgeRangesByContinuity(pieces, seamSideRanges(seam, "second"))).map(cloneRange)
      : uniqueRanges(constraints.map((constraint) => constraint.rangeB).filter(isEdgeRange));
    const materialLengthAMm = rangesA.length > 0 ? edgeRangeSequenceLength(pieces, rangesA) : 0;
    const materialLengthBMm = rangesB.length > 0 ? edgeRangeSequenceLength(pieces, rangesB) : 0;

    indices.forEach((constraintIndex, sampleIndex) => {
      const constraint = state.stitchConstraints[constraintIndex];
      const pair = references[constraintIndex];
      if (!pair) return;
      const distanceMm = referenceDistanceM(positions, pair.a, pair.b) * METERS_TO_MM;
      const intendedRestDistanceMm = Math.max(0, pair.restDistanceM) * METERS_TO_MM;
      const residualMm = Math.abs(distanceMm - intendedRestDistanceMm);
      distanceSum += distanceMm;
      distanceMaximum = Math.max(distanceMaximum, distanceMm);
      groupResidualSum += residualMm;
      residualSum += residualMm;
      residualMaximum = Math.max(residualMaximum, residualMm);
      sampleCount += 1;
      if (residualMm > groupResidualMaximum) {
        groupResidualMaximum = residualMm;
        const seam = seamById.get(constraint.seamId);
        const progress = clamp01(constraint.progress ?? (indices.length <= 1 ? 0 : sampleIndex / (indices.length - 1)));
        const secondProgress = seam?.direction === "opposite" ? 1 - progress : progress;
        worst = {
          sampleIndex,
          constraintIndex,
          sideA: describeSide(
            state,
            garment,
            positions,
            pair.a,
            constraint.instanceA,
            seam ? seamSideRanges(seam, "first") : constraint.rangeA ? [constraint.rangeA] : [],
            progress,
          ),
          sideB: describeSide(
            state,
            garment,
            positions,
            pair.b,
            constraint.instanceB,
            seam ? seamSideRanges(seam, "second") : constraint.rangeB ? [constraint.rangeB] : [],
            secondProgress,
          ),
          distanceMm,
          intendedRestDistanceMm,
          residualMm,
        };
      }
    });

    if (!worst) continue;
    groups.push({
      seamGroupId,
      seamIds: uniqueStrings(constraints.map((constraint) => constraint.seamId)),
      classification: classifySeamGroup(constraints, seams, garment),
      treatments,
      directions,
      instanceIds: instances,
      patternDefinitionIds,
      rangesA,
      rangesB,
      materialLengthAMm,
      materialLengthBMm,
      sampleCount: indices.length,
      meanDistanceMm: distanceSum / Math.max(1, indices.length),
      maxDistanceMm: distanceMaximum,
      meanResidualMm: groupResidualSum / Math.max(1, indices.length),
      maxResidualMm: groupResidualMaximum,
      worstSample: worst,
    });
  }

  groups.sort((left, right) => right.maxResidualMm - left.maxResidualMm || left.seamGroupId.localeCompare(right.seamGroupId));
  return {
    stage,
    sampleCount,
    meanResidualMm: residualSum / Math.max(1, sampleCount),
    maxResidualMm: residualMaximum,
    groups,
    invariantErrors: collectInvariantErrors(state, positions, references),
  };
}

function describeSide(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  positions: Float32Array,
  reference: GlobalPointReference,
  instanceId: string | undefined,
  ranges: readonly EdgeRange[],
  progress: number,
): SeamResidualSideSample {
  const pieces = garment.pieces;
  const resolved = ranges.length > 0
    ? resolveEdgeRangeSequenceProgress(pieces, ranges, progress)
    : undefined;
  const range = resolved?.range;
  const rangeOrder = range
    ? ranges.findIndex((candidate) => sameRange(candidate, range))
    : undefined;
  const rangeLengthMm = resolved?.rangeLengthMm ?? 0;
  const rangeSpan = range ? Math.abs(range.endT - range.startT) : 0;
  const localFraction = range && resolved && rangeSpan > EPSILON
    ? Math.abs(resolved.t - range.startT) / rangeSpan
    : 0;
  const totalLengthMm = ranges.length > 0 ? edgeRangeSequenceLength(pieces, ranges) : 0;
  const instance = instanceId ? state.instances.find((candidate) => candidate.id === instanceId) : undefined;
  return {
    panelInstanceId: instanceId,
    patternDefinitionId: instance?.sourcePatternId,
    range: range ? cloneRange(range) : undefined,
    rangeOrder: rangeOrder !== undefined && rangeOrder >= 0 ? rangeOrder : undefined,
    localArcLengthMm: resolved ? localFraction * rangeLengthMm : undefined,
    globalArcLengthMm: totalLengthMm > 0 ? clamp01(progress) * totalLengthMm : undefined,
    t: resolved?.t,
    particleIndices: [...reference.particleIndices],
    interpolationWeights: [...reference.weights],
    positionM: evaluateReference(positions, reference),
  };
}

function classifySeamGroup(
  constraints: readonly AssemblyStitchConstraint[],
  seams: readonly Seam[],
  garment: GarmentDraft,
): SeamResidualClass {
  const treatments = constraints.map((constraint) => constraint.treatment);
  if (treatments.some((treatment) => ["ease", "gather", "stretch", "intentional-mismatch"].includes(treatment))
    || constraints.some((constraint) => Math.abs(constraint.targetRatio - 1) > 1e-6 || constraint.slackMm > 1e-6)) {
    return "intentional-mismatch";
  }
  if (treatments.some((treatment) => treatment === "dart") || seams.some((seam) => seamUsesShapingEdges(seam, garment))) {
    return "local-shaping-closure";
  }
  return "structural-alignment";
}

function seamUsesShapingEdges(seam: Seam, garment: GarmentDraft): boolean {
  const pieceById = new Map(garment.pieces.map((piece) => [piece.id, piece]));
  const ranges = [...seamSideRanges(seam, "first"), ...seamSideRanges(seam, "second")];
  if (ranges.length === 0) return false;
  const roles = ranges.map((range) => {
    const piece = pieceById.get(range.pieceId);
    return piece ? String(getPatternEdges(piece).find((edge) => edge.id === range.edgeId)?.role ?? "") : "";
  });
  return roles.length > 0 && roles.every((role) => /dart|pence/i.test(role));
}

function collectInvariantErrors(
  state: GarmentAssemblyState,
  positions: Float32Array,
  references: readonly AuditReferencePair[],
): string[] {
  const errors: string[] = [];
  const particleCount = positions.length / 3;
  state.stitchConstraints.forEach((constraint, constraintIndex) => {
    const pair = references[constraintIndex];
    if (!pair) {
      errors.push(`${constraint.id}: reference pair ausente no índice ${constraintIndex}.`);
      return;
    }
    checkReference("A", constraint, constraint.instanceA, pair.a);
    checkReference("B", constraint, constraint.instanceB, pair.b);
    if (constraint.progress !== undefined && (!Number.isFinite(constraint.progress) || constraint.progress < -EPSILON || constraint.progress > 1 + EPSILON)) {
      errors.push(`${constraint.id}: progress fora de [0,1].`);
    }
    for (const [side, range, instanceId] of [
      ["A", constraint.rangeA, constraint.instanceA],
      ["B", constraint.rangeB, constraint.instanceB],
    ] as const) {
      if (!range || !instanceId) continue;
      const instance = state.instances.find((candidate) => candidate.id === instanceId);
      if (instance && !instance.topology.edges.has(range.edgeId)) {
        errors.push(`${constraint.id}/${side}: EdgeRange ${range.edgeId} não existe na topologia de ${instanceId}.`);
      }
      if (![range.startT, range.endT].every((value) => Number.isFinite(value) && value >= -EPSILON && value <= 1 + EPSILON)) {
        errors.push(`${constraint.id}/${side}: EdgeRange fora de [0,1].`);
      }
    }

    function checkReference(
      side: "A" | "B",
      ownerConstraint: AssemblyStitchConstraint,
      ownerId: string | undefined,
      reference: GlobalPointReference,
    ): void {
      if (reference.particleIndices.length === 0 || reference.particleIndices.length !== reference.weights.length) {
        errors.push(`${ownerConstraint.id}/${side}: particleIndices/weights incompatíveis.`);
        return;
      }
      const weightSum = reference.weights.reduce((sum, weight) => sum + weight, 0);
      if (!reference.weights.every((weight) => Number.isFinite(weight) && weight >= -EPSILON)) {
        errors.push(`${ownerConstraint.id}/${side}: peso não finito ou negativo.`);
      }
      if (Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
        errors.push(`${ownerConstraint.id}/${side}: soma dos pesos = ${weightSum}.`);
      }
      const owner = ownerId ? state.instances.find((instance) => instance.id === ownerId) : undefined;
      for (const particle of reference.particleIndices) {
        if (!Number.isInteger(particle) || particle < 0 || particle >= particleCount) {
          errors.push(`${ownerConstraint.id}/${side}: particle ${particle} fora do range global.`);
          continue;
        }
        if (owner && (particle < owner.particleStart || particle >= owner.particleStart + owner.vertexCount)) {
          errors.push(`${ownerConstraint.id}/${side}: particle ${particle} não pertence a ${owner.id}.`);
        }
        const offset = particle * 3;
        if (![positions[offset], positions[offset + 1], positions[offset + 2]].every(Number.isFinite)) {
          errors.push(`${ownerConstraint.id}/${side}: posição não finita em particle ${particle}.`);
        }
      }
    }
  });
  return errors;
}

interface TubeGroup {
  id: string;
  instances: AssemblyPanelInstance[];
  scoreMm2: number;
}

function collectTubeGroups(instances: readonly AssemblyPanelInstance[]): Map<string, TubeGroup> {
  const groups = new Map<string, TubeGroup>();
  for (const instance of instances) {
    if (instance.arrangement?.mapping !== "seam-derived-tube") continue;
    const groupId = instance.arrangement.tubeGroupId ?? `tube:${instance.id}`;
    const group = groups.get(groupId) ?? { id: groupId, instances: [], scoreMm2: 0 };
    group.instances.push(instance);
    group.scoreMm2 = Math.max(group.scoreMm2, instance.arrangement.tubeScoreMm2 ?? 0);
    groups.set(groupId, group);
  }
  return groups;
}

function isRigidStructuralBridge(constraint: AssemblyStitchConstraint): boolean {
  return constraint.instanceA !== constraint.instanceB
    && !["dart", "ease", "gather", "stretch", "intentional-mismatch"].includes(constraint.treatment)
    && Math.abs(constraint.targetRatio - 1) <= 1e-6
    && constraint.slackMm <= 1e-6;
}

function alignTubeGroup(
  state: GarmentAssemblyState,
  groups: ReadonlyMap<string, TubeGroup>,
  groupByInstanceId: ReadonlyMap<string, string>,
  fixedGroupIds: readonly string[],
  movingGroupId: string,
  movingInstances: readonly AssemblyPanelInstance[],
  constraints: readonly AssemblyStitchConstraint[],
): TubeGroupAlignmentCorrection | undefined {
  const movingCenter = commonTubeCenter(movingInstances);
  const movingAxis = commonTubeAxis(movingInstances);
  if (!movingCenter || !movingAxis) return undefined;
  const before = constraintDistances(state.positions, constraints);

  let sinSum = 0;
  let cosSum = 0;
  let phaseSamples = 0;
  for (const constraint of constraints) {
    const fixedIsA = constraint.instanceA ? fixedGroupIds.includes(groupByInstanceId.get(constraint.instanceA) ?? "") : false;
    const fixedReference = fixedIsA ? constraint.a : constraint.b;
    const movingReference = fixedIsA ? constraint.b : constraint.a;
    const fixedInstanceId = fixedIsA ? constraint.instanceA : constraint.instanceB;
    const fixedGroupId = fixedInstanceId ? groupByInstanceId.get(fixedInstanceId) : undefined;
    const fixedGroup = fixedGroupId ? groups.get(fixedGroupId) : undefined;
    const fixedCenter = fixedGroup ? commonTubeCenter(fixedGroup.instances) : undefined;
    if (!fixedCenter) continue;
    const fixedPoint = evaluateReference(state.positions, fixedReference);
    const movingPoint = evaluateReference(state.positions, movingReference);
    const fixedRadial = radialUnit(subtract3(fixedPoint, fixedCenter), movingAxis);
    const movingRadial = radialUnit(subtract3(movingPoint, movingCenter), movingAxis);
    if (!fixedRadial || !movingRadial) continue;
    const cross = cross3(movingRadial, fixedRadial);
    const sine = dot3(movingAxis, cross);
    const cosine = clamp(dot3(movingRadial, fixedRadial), -1, 1);
    sinSum += sine;
    cosSum += cosine;
    phaseSamples += 1;
  }
  const phaseRotationRad = phaseSamples > 0 && (Math.abs(sinSum) > EPSILON || Math.abs(cosSum) > EPSILON)
    ? Math.atan2(sinSum, cosSum)
    : 0;
  if (Math.abs(phaseRotationRad) > EPSILON) {
    rotateTubeGroup(state.positions, movingInstances, movingCenter, movingAxis, phaseRotationRad);
  }

  const translation: [number, number, number] = [0, 0, 0];
  let translationSamples = 0;
  for (const constraint of constraints) {
    const firstGroup = constraint.instanceA ? groupByInstanceId.get(constraint.instanceA) : undefined;
    const fixedIsA = firstGroup ? fixedGroupIds.includes(firstGroup) : false;
    const fixedReference = fixedIsA ? constraint.a : constraint.b;
    const movingReference = fixedIsA ? constraint.b : constraint.a;
    const fixedPoint = evaluateReference(state.positions, fixedReference);
    const movingPoint = evaluateReference(state.positions, movingReference);
    translation[0] += fixedPoint[0] - movingPoint[0];
    translation[1] += fixedPoint[1] - movingPoint[1];
    translation[2] += fixedPoint[2] - movingPoint[2];
    translationSamples += 1;
  }
  if (translationSamples > 0) {
    translation[0] /= translationSamples;
    translation[1] /= translationSamples;
    translation[2] /= translationSamples;
    translateTubeGroup(state.positions, movingInstances, translation);
  }

  const after = constraintDistances(state.positions, constraints);
  return {
    fixedTubeGroupIds: [...fixedGroupIds].sort(),
    movingTubeGroupId: movingGroupId,
    seamGroupIds: uniqueStrings(constraints.map((constraint) => constraint.seamGroupId)),
    sampleCount: constraints.length,
    phaseRotationRad,
    translationM: translation,
    meanDistanceBeforeMm: mean(before) * METERS_TO_MM,
    maxDistanceBeforeMm: Math.max(0, ...before) * METERS_TO_MM,
    meanDistanceAfterMm: mean(after) * METERS_TO_MM,
    maxDistanceAfterMm: Math.max(0, ...after) * METERS_TO_MM,
  };
}

function rotateTubeGroup(
  positions: Float32Array,
  instances: readonly AssemblyPanelInstance[],
  center: [number, number, number],
  axis: [number, number, number],
  angle: number,
): void {
  for (const instance of instances) {
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const offset = (instance.particleStart + local) * 3;
      const point: [number, number, number] = [positions[offset], positions[offset + 1], positions[offset + 2]];
      const rotated = add3(center, rotateAroundAxis(subtract3(point, center), axis, angle));
      positions[offset] = rotated[0];
      positions[offset + 1] = rotated[1];
      positions[offset + 2] = rotated[2];
    }
    const normal = instance.arrangement?.outwardNormal;
    if (normal && instance.arrangement) {
      instance.arrangement.outwardNormal = rotateAroundAxis([...normal] as [number, number, number], axis, angle);
    }
  }
}

function translateTubeGroup(
  positions: Float32Array,
  instances: readonly AssemblyPanelInstance[],
  translation: [number, number, number],
): void {
  for (const instance of instances) {
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const offset = (instance.particleStart + local) * 3;
      positions[offset] += translation[0];
      positions[offset + 1] += translation[1];
      positions[offset + 2] += translation[2];
    }
    const center = instance.arrangement?.tubeCenter;
    if (center && instance.arrangement) {
      instance.arrangement.tubeCenter = add3([...center] as [number, number, number], translation);
    }
  }
}

function commonTubeCenter(instances: readonly AssemblyPanelInstance[]): [number, number, number] | undefined {
  const centers = instances.map((instance) => instance.arrangement?.tubeCenter).filter(Boolean) as Array<readonly [number, number, number]>;
  if (centers.length === 0) return undefined;
  return [
    centers.reduce((sum, center) => sum + center[0], 0) / centers.length,
    centers.reduce((sum, center) => sum + center[1], 0) / centers.length,
    centers.reduce((sum, center) => sum + center[2], 0) / centers.length,
  ];
}

function commonTubeAxis(instances: readonly AssemblyPanelInstance[]): [number, number, number] | undefined {
  const axis = instances[0]?.arrangement?.axis;
  return axis ? normalize3([...axis] as [number, number, number]) : undefined;
}

function constraintDistances(
  positions: Float32Array,
  constraints: readonly AssemblyStitchConstraint[],
): number[] {
  return constraints.map((constraint) => referenceDistanceM(positions, constraint.a, constraint.b));
}

function packedReference(
  indices: Uint32Array,
  weights: Float32Array,
  constraintIndex: number,
  slotOffset: 0 | 2,
): GlobalPointReference {
  const particles: number[] = [];
  const packedWeights: number[] = [];
  for (let slot = 0; slot < 2; slot += 1) {
    const packedIndex = constraintIndex * 4 + slotOffset + slot;
    const particle = indices[packedIndex];
    const weight = weights[packedIndex] ?? 0;
    if (particle === undefined || particle === 0xffffffff || weight <= EPSILON) continue;
    particles.push(particle);
    packedWeights.push(weight);
  }
  return { particleIndices: particles, weights: packedWeights };
}

function evaluateReference(
  positions: Float32Array,
  reference: GlobalPointReference,
): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  reference.particleIndices.forEach((particle, index) => {
    const weight = reference.weights[index] ?? 0;
    const offset = particle * 3;
    result[0] += positions[offset] * weight;
    result[1] += positions[offset + 1] * weight;
    result[2] += positions[offset + 2] * weight;
  });
  return result;
}

function referenceDistanceM(
  positions: Float32Array,
  first: GlobalPointReference,
  second: GlobalPointReference,
): number {
  const a = evaluateReference(positions, first);
  const b = evaluateReference(positions, second);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function radialUnit(
  vector: [number, number, number],
  axis: [number, number, number],
): [number, number, number] | undefined {
  const along = dot3(vector, axis);
  const radial: [number, number, number] = [
    vector[0] - axis[0] * along,
    vector[1] - axis[1] * along,
    vector[2] - axis[2] * along,
  ];
  const length = Math.hypot(...radial);
  return length > EPSILON ? radial.map((value) => value / length) as [number, number, number] : undefined;
}

function rotateAroundAxis(
  vector: [number, number, number],
  axis: [number, number, number],
  angle: number,
): [number, number, number] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const cross = cross3(axis, vector);
  const projection = dot3(axis, vector) * (1 - cosine);
  return [
    vector[0] * cosine + cross[0] * sine + axis[0] * projection,
    vector[1] * cosine + cross[1] * sine + axis[1] * projection,
    vector[2] * cosine + cross[2] * sine + axis[2] * projection,
  ];
}

function normalize3(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  return length > EPSILON
    ? vector.map((value) => value / length) as [number, number, number]
    : [0, 1, 0];
}

function cross3(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): [number, number, number] {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dot3(first: readonly number[], second: readonly number[]): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function add3(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): [number, number, number] {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function subtract3(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): [number, number, number] {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function groupPairKey(first: string, second: string): string {
  return first < second ? `${first}\u0000${second}` : `${second}\u0000${first}`;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cloneRange(range: EdgeRange): EdgeRange {
  return { ...range };
}

function isEdgeRange(range: EdgeRange | undefined): range is EdgeRange {
  return Boolean(range);
}

function sameRange(first: EdgeRange, second: EdgeRange): boolean {
  return first.pieceId === second.pieceId
    && first.edgeId === second.edgeId
    && Math.abs(first.startT - second.startT) <= EPSILON
    && Math.abs(first.endT - second.endT) <= EPSILON;
}

function uniqueRanges(ranges: readonly EdgeRange[]): EdgeRange[] {
  const result: EdgeRange[] = [];
  for (const range of ranges) if (!result.some((candidate) => sameRange(candidate, range))) result.push(cloneRange(range));
  return result;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(value);
  }
  return result;
}
