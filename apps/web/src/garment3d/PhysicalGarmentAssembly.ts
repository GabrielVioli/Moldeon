import type {
  GarmentDraft,
  PatternEdge,
  PatternPiece,
  PatternSnapshot,
  PreviewBodySide,
} from "../domain/pattern";
import { getPatternEdges } from "../domain/pattern";
import {
  buildGarmentAssembly,
  type AssemblyAnchorConstraint,
  type AssemblyDistanceConstraint,
  type AssemblyPanelInstance,
  type AssemblyStitchConstraint,
  type GarmentAssemblyState,
  type GlobalPointReference,
} from "./GarmentAssembly";
import type { PanelEdgePath } from "./types";

interface InstancePlan {
  source: AssemblyPanelInstance;
  instance: AssemblyPanelInstance;
  positions: Float32Array;
  inverseMasses: Float32Array;
  side: PreviewBodySide;
  foldGroupId?: string;
  foldEdgeId?: string;
}

const FOLD_REST_DISTANCE = 0.0001;
const POSITION_EPSILON = 1e-8;

/**
 * Converte a montagem lógica em peças físicas.
 *
 * Um molde marcado como cutOnFold representa apenas metade da peça de
 * tecido. O editor 2D deve continuar mostrando essa meia peça, mas o 3D
 * precisa criar as duas metades espelhadas e uni-las pela linha de dobra.
 */
export function buildPhysicalGarmentAssembly(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
  geometrySignatures: ReadonlyMap<string, string> = new Map(),
): GarmentAssemblyState {
  const base = buildGarmentAssembly(snapshots, garment, geometrySignatures);

  if (base.instances.length === 0) {
    return base;
  }

  const pieceById = new Map(
    garment.pieces.map((piece) => [piece.id, piece]),
  );
  const plansBySourceId = new Map<string, InstancePlan[]>();
  const plans: InstancePlan[] = [];
  const warnings = [...base.warnings];

  for (const source of base.instances) {
    const piece = pieceById.get(source.pieceId);
    const sourcePositions = sliceInstanceValues(base.initialPositions, source, 3);
    const sourceMasses = sliceInstanceValues(base.inverseMasses, source, 1);
    normalizeSurfaceDepth(sourcePositions, source);

    if (!piece?.cutOnFold) {
      const plan = createSinglePlan(source, sourcePositions, sourceMasses);
      plans.push(plan);
      plansBySourceId.set(source.id, [plan]);
      continue;
    }

    const foldEdge = findFoldEdge(piece, source);

    if (!foldEdge) {
      warnings.push(
        `${piece.name}: a peça está marcada para corte na dobra, mas nenhuma borda de dobra válida foi encontrada.`,
      );
      const plan = createSinglePlan(source, sourcePositions, sourceMasses);
      plans.push(plan);
      plansBySourceId.set(source.id, [plan]);
      continue;
    }

    const foldPlans = createFoldPlans(
      source,
      sourcePositions,
      sourceMasses,
      foldEdge,
    );

    plans.push(...foldPlans);
    plansBySourceId.set(source.id, foldPlans);
  }

  assignParticleRanges(plans);

  const initialPositions = concatenatePlanPositions(plans);
  const inverseMasses = concatenatePlanMasses(plans);
  const positions = new Float32Array(initialPositions);
  const previousPositions = new Float32Array(initialPositions);
  const sourceByParticle = indexSourceInstances(base.instances, base.positions.length / 3);

  const structuralConstraints = duplicateStructuralConstraints(
    base.structuralConstraints,
    plansBySourceId,
    sourceByParticle,
  );
  const stitchConstraints = duplicateStitchConstraints(
    base.stitchConstraints,
    plansBySourceId,
    sourceByParticle,
  );
  stitchConstraints.push(...buildFoldConstraints(plans));

  const anchorConstraints = remapAnchors(
    base.anchorConstraints,
    plansBySourceId,
    sourceByParticle,
    initialPositions,
  );

  return {
    positions,
    initialPositions,
    previousPositions,
    inverseMasses,
    instances: plans.map((plan) => plan.instance),
    structuralConstraints,
    stitchConstraints,
    anchorConstraints,
    warnings,
    invalid: base.invalid,
  };
}

function createSinglePlan(
  source: AssemblyPanelInstance,
  positions: Float32Array,
  inverseMasses: Float32Array,
): InstancePlan {
  return {
    source,
    instance: {
      ...source,
      placement: { ...source.placement },
    },
    positions,
    inverseMasses,
    side: source.placement.bodySide,
  };
}

function createFoldPlans(
  source: AssemblyPanelInstance,
  sourcePositions: Float32Array,
  sourceMasses: Float32Array,
  foldEdge: PanelEdgePath,
): InstancePlan[] {
  const original = new Float32Array(sourcePositions);
  const mirrored = reflectAcrossFoldLine(sourcePositions, foldEdge.vertexIndices);

  centerFoldPair(original, mirrored, sourcePositions);

  const originalCenterX = averageAxis(original, 0);
  const mirroredCenterX = averageAxis(mirrored, 0);
  const originalSide: PreviewBodySide =
    originalCenterX <= mirroredCenterX ? "left" : "right";
  const mirroredSide: PreviewBodySide =
    originalSide === "left" ? "right" : "left";
  const groupId = `${source.id}:cut-on-fold`;

  const makePlan = (
    suffix: string,
    positions: Float32Array,
    side: PreviewBodySide,
  ): InstancePlan => ({
    source,
    instance: {
      ...source,
      id: `${source.id}:${suffix}`,
      placement: {
        ...source.placement,
        id: `${source.placement.id}:${suffix}`,
        bodySide: side,
      },
    },
    positions,
    inverseMasses: new Float32Array(sourceMasses),
    side,
    foldGroupId: groupId,
    foldEdgeId: foldEdge.edgeId,
  });

  return [
    makePlan("fold-a", original, originalSide),
    makePlan("fold-b", mirrored, mirroredSide),
  ];
}

function findFoldEdge(
  piece: PatternPiece,
  instance: AssemblyPanelInstance,
): PanelEdgePath | undefined {
  const declared = getPatternEdges(piece).find((edge) => edge.role === "fold");

  if (declared) {
    return instance.topology.edges.get(declared.id);
  }

  const candidates = getPatternEdges(piece)
    .map((edge) => ({
      edge,
      path: instance.topology.edges.get(edge.id),
    }))
    .filter(
      (candidate): candidate is { edge: PatternEdge; path: PanelEdgePath } =>
        Boolean(candidate.path),
    )
    .filter(({ path }) => edgeIsStraightAndPeripheral(instance, path))
    .sort((left, right) => right.path.lengthMm - left.path.lengthMm);

  return candidates[0]?.path;
}

function edgeIsStraightAndPeripheral(
  instance: AssemblyPanelInstance,
  path: PanelEdgePath,
): boolean {
  if (path.vertexIndices.length < 2) return false;

  const positions = instance.topology.positions2DMm;
  const first = path.vertexIndices[0];
  const last = path.vertexIndices[path.vertexIndices.length - 1];
  const startX = positions[first * 2];
  const startY = positions[first * 2 + 1];
  const endX = positions[last * 2];
  const endY = positions[last * 2 + 1];
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);

  if (length <= POSITION_EPSILON) return false;

  let maximumDeviation = 0;
  let meanX = 0;
  let meanY = 0;

  for (const vertexIndex of path.vertexIndices) {
    const x = positions[vertexIndex * 2];
    const y = positions[vertexIndex * 2 + 1];
    maximumDeviation = Math.max(
      maximumDeviation,
      Math.abs(dy * x - dx * y + endX * startY - endY * startX) / length,
    );
    meanX += x;
    meanY += y;
  }

  if (maximumDeviation > 1.5) return false;

  meanX /= path.vertexIndices.length;
  meanY /= path.vertexIndices.length;

  const bounds = instance.topology.boundsMm;
  const tolerance = Math.max(3, Math.min(bounds.width, bounds.height) * 0.025);

  return (
    Math.abs(meanX - bounds.minX) <= tolerance ||
    Math.abs(meanX - bounds.maxX) <= tolerance ||
    Math.abs(meanY - bounds.minY) <= tolerance ||
    Math.abs(meanY - bounds.maxY) <= tolerance
  );
}

function reflectAcrossFoldLine(
  source: Float32Array,
  foldVertices: readonly number[],
): Float32Array {
  const result = new Float32Array(source);

  if (foldVertices.length < 2) return result;

  const first = foldVertices[0];
  const last = foldVertices[foldVertices.length - 1];
  const startX = source[first * 3];
  const startY = source[first * 3 + 1];
  const endX = source[last * 3];
  const endY = source[last * 3 + 1];
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= POSITION_EPSILON) return result;

  for (let index = 0; index < source.length / 3; index += 1) {
    const x = source[index * 3];
    const y = source[index * 3 + 1];
    const projection =
      ((x - startX) * dx + (y - startY) * dy) /
      lengthSquared;
    const projectedX = startX + projection * dx;
    const projectedY = startY + projection * dy;

    result[index * 3] = projectedX * 2 - x;
    result[index * 3 + 1] = projectedY * 2 - y;
  }

  return result;
}

function centerFoldPair(
  original: Float32Array,
  mirrored: Float32Array,
  source: Float32Array,
): void {
  const sourceCenter = boundsCenter(source);
  const pairCenter = combinedBoundsCenter(original, mirrored);
  const dx = sourceCenter.x - pairCenter.x;
  const dy = sourceCenter.y - pairCenter.y;

  translateValues(original, dx, dy, 0);
  translateValues(mirrored, dx, dy, 0);
}

function normalizeSurfaceDepth(
  values: Float32Array,
  instance: AssemblyPanelInstance,
): void {
  const averageZ = averageAxis(values, 2);
  translateValues(values, 0, 0, -averageZ);
}

function assignParticleRanges(plans: InstancePlan[]): void {
  let particleStart = 0;

  for (const plan of plans) {
    plan.instance = {
      ...plan.instance,
      particleStart,
      vertexCount: plan.positions.length / 3,
    };
    particleStart += plan.instance.vertexCount;
  }
}

function concatenatePlanPositions(plans: readonly InstancePlan[]): Float32Array {
  const totalLength = plans.reduce((total, plan) => total + plan.positions.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const plan of plans) {
    result.set(plan.positions, offset);
    offset += plan.positions.length;
  }

  return result;
}

function concatenatePlanMasses(plans: readonly InstancePlan[]): Float32Array {
  const totalLength = plans.reduce((total, plan) => total + plan.inverseMasses.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const plan of plans) {
    result.set(plan.inverseMasses, offset);
    offset += plan.inverseMasses.length;
  }

  return result;
}

function duplicateStructuralConstraints(
  constraints: readonly AssemblyDistanceConstraint[],
  plansBySourceId: ReadonlyMap<string, InstancePlan[]>,
  sourceByParticle: readonly (AssemblyPanelInstance | undefined)[],
): AssemblyDistanceConstraint[] {
  const result: AssemblyDistanceConstraint[] = [];

  for (const constraint of constraints) {
    const source = sourceByParticle[constraint.a];
    if (!source) continue;

    for (const plan of plansBySourceId.get(source.id) ?? []) {
      result.push({
        ...constraint,
        a: remapParticle(constraint.a, source, plan),
        b: remapParticle(constraint.b, source, plan),
      });
    }
  }

  return result;
}

function duplicateStitchConstraints(
  constraints: readonly AssemblyStitchConstraint[],
  plansBySourceId: ReadonlyMap<string, InstancePlan[]>,
  sourceByParticle: readonly (AssemblyPanelInstance | undefined)[],
): AssemblyStitchConstraint[] {
  const result: AssemblyStitchConstraint[] = [];

  for (const constraint of constraints) {
    const sourceA = resolveConstraintSource(
      constraint.instanceA,
      constraint.a,
      sourceByParticle,
    );
    const sourceB = resolveConstraintSource(
      constraint.instanceB,
      constraint.b,
      sourceByParticle,
    );

    if (!sourceA || !sourceB) continue;

    const plansA = plansBySourceId.get(sourceA.id) ?? [];
    const plansB = plansBySourceId.get(sourceB.id) ?? [];

    for (const [planA, planB] of pairPlans(sourceA, sourceB, plansA, plansB)) {
      result.push({
        ...constraint,
        id: `${constraint.id}/${planA.instance.id}/${planB.instance.id}`,
        a: remapReference(constraint.a, sourceA, planA),
        b: remapReference(constraint.b, sourceB, planB),
        instanceA: planA.instance.id,
        instanceB: planB.instance.id,
      });
    }
  }

  return result;
}

function buildFoldConstraints(
  plans: readonly InstancePlan[],
): AssemblyStitchConstraint[] {
  const byGroup = new Map<string, InstancePlan[]>();
  const result: AssemblyStitchConstraint[] = [];

  for (const plan of plans) {
    if (!plan.foldGroupId || !plan.foldEdgeId) continue;
    const group = byGroup.get(plan.foldGroupId) ?? [];
    group.push(plan);
    byGroup.set(plan.foldGroupId, group);
  }

  for (const [groupId, group] of byGroup) {
    if (group.length !== 2) continue;

    const first = group[0];
    const second = group[1];
    const path = first.instance.topology.edges.get(first.foldEdgeId!);
    if (!path) continue;

    path.vertexIndices.forEach((localIndex, sampleIndex) => {
      result.push({
        id: `${groupId}:${sampleIndex}`,
        seamId: `fold:${groupId}`,
        seamGroupId: `fold:${groupId}`,
        treatment: "fold",
        distribution: "uniform",
        targetRatio: 1,
        slackMm: 0,
        a: directReference(first.instance.particleStart + localIndex),
        b: directReference(second.instance.particleStart + localIndex),
        restDistance: FOLD_REST_DISTANCE,
        stiffness: 1,
        instanceA: first.instance.id,
        instanceB: second.instance.id,
      });
    });
  }

  return result;
}

function remapAnchors(
  anchors: readonly AssemblyAnchorConstraint[],
  plansBySourceId: ReadonlyMap<string, InstancePlan[]>,
  sourceByParticle: readonly (AssemblyPanelInstance | undefined)[],
  initialPositions: Float32Array,
): AssemblyAnchorConstraint[] {
  const result: AssemblyAnchorConstraint[] = [];

  for (const anchor of anchors) {
    const source = sourceByParticle[anchor.particleIndex];
    const plan = source ? plansBySourceId.get(source.id)?.[0] : undefined;
    if (!source || !plan) continue;

    const particleIndex = remapParticle(anchor.particleIndex, source, plan);
    result.push({
      particleIndex,
      targetX: initialPositions[particleIndex * 3],
      targetY: initialPositions[particleIndex * 3 + 1],
      targetZ: initialPositions[particleIndex * 3 + 2],
      stiffness: anchor.stiffness,
    });
  }

  return result;
}

function pairPlans(
  sourceA: AssemblyPanelInstance,
  sourceB: AssemblyPanelInstance,
  plansA: readonly InstancePlan[],
  plansB: readonly InstancePlan[],
): Array<readonly [InstancePlan, InstancePlan]> {
  if (sourceA.id === sourceB.id) {
    return plansA.map((plan) => [plan, plan] as const);
  }

  if (plansA.length === plansB.length && plansA.length > 1) {
    const remaining = [...plansB];
    const pairs: Array<readonly [InstancePlan, InstancePlan]> = [];

    for (const planA of plansA) {
      const matchingIndex = remaining.findIndex((planB) => planB.side === planA.side);
      const index = matchingIndex >= 0 ? matchingIndex : 0;
      const planB = remaining.splice(index, 1)[0];
      if (planB) pairs.push([planA, planB]);
    }

    return pairs;
  }

  if (plansA.length === 1) {
    const sideMatched = plansB.find((planB) =>
      plansA[0].side !== "center" && planB.side === plansA[0].side,
    );
    if (sideMatched) return [[plansA[0], sideMatched]];
    return plansB.map((planB) => [plansA[0], planB] as const);
  }

  if (plansB.length === 1) {
    const sideMatched = plansA.find((planA) =>
      plansB[0].side !== "center" && planA.side === plansB[0].side,
    );
    if (sideMatched) return [[sideMatched, plansB[0]]];
    return plansA.map((planA) => [planA, plansB[0]] as const);
  }

  const count = Math.min(plansA.length, plansB.length);
  return Array.from({ length: count }, (_, index) => [plansA[index], plansB[index]] as const);
}

function resolveConstraintSource(
  declaredId: string | undefined,
  reference: GlobalPointReference,
  sourceByParticle: readonly (AssemblyPanelInstance | undefined)[],
): AssemblyPanelInstance | undefined {
  const particle = reference.particleIndices[0];
  const source = sourceByParticle[particle];
  if (!declaredId || source?.id === declaredId) return source;
  return source;
}

function remapReference(
  reference: GlobalPointReference,
  source: AssemblyPanelInstance,
  plan: InstancePlan,
): GlobalPointReference {
  return {
    particleIndices: reference.particleIndices.map((particleIndex) =>
      remapParticle(particleIndex, source, plan),
    ),
    weights: [...reference.weights],
  };
}

function remapParticle(
  particleIndex: number,
  source: AssemblyPanelInstance,
  plan: InstancePlan,
): number {
  return plan.instance.particleStart + particleIndex - source.particleStart;
}

function indexSourceInstances(
  instances: readonly AssemblyPanelInstance[],
  particleCount: number,
): Array<AssemblyPanelInstance | undefined> {
  const result = new Array<AssemblyPanelInstance | undefined>(particleCount);

  for (const instance of instances) {
    for (let localIndex = 0; localIndex < instance.vertexCount; localIndex += 1) {
      result[instance.particleStart + localIndex] = instance;
    }
  }

  return result;
}

function sliceInstanceValues(
  values: Float32Array,
  instance: AssemblyPanelInstance,
  stride: number,
): Float32Array {
  const start = instance.particleStart * stride;
  const end = start + instance.vertexCount * stride;
  return new Float32Array(values.slice(start, end));
}

function directReference(particleIndex: number): GlobalPointReference {
  return { particleIndices: [particleIndex], weights: [1] };
}

function boundsCenter(values: Float32Array): { x: number; y: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < values.length / 3; index += 1) {
    const x = values[index * 3];
    const y = values[index * 3 + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function combinedBoundsCenter(
  first: Float32Array,
  second: Float32Array,
): { x: number; y: number } {
  const combined = new Float32Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);
  return boundsCenter(combined);
}

function averageAxis(values: Float32Array, axis: 0 | 1 | 2): number {
  if (values.length === 0) return 0;
  let total = 0;

  for (let index = axis; index < values.length; index += 3) {
    total += values[index];
  }

  return total / (values.length / 3);
}

function translateValues(
  values: Float32Array,
  dx: number,
  dy: number,
  dz: number,
): void {
  for (let index = 0; index < values.length / 3; index += 1) {
    values[index * 3] += dx;
    values[index * 3 + 1] += dy;
    values[index * 3 + 2] += dz;
  }
}
