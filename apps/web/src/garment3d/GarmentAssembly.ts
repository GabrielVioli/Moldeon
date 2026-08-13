import {
  edgeRangeSequenceLength,
  resolveEdgeRangeSequenceProgress,
  seamSideRanges,
  type EdgeRange,
  type GarmentDraft,
  type PatternPiece,
  type PatternPreviewPlacement,
  type PatternSnapshot,
  type Seam,
  type SeamDistribution,
  type SeamTreatment,
  type AssemblyPlacement,
} from "../domain/pattern";
import {
  buildPanelTopology,
  type PanelTopology,
} from "./PanelTopology";
import {
  recommendedPanelRefinement,
  refinePanelTopology,
} from "./PanelRefinement";
import type { PanelEdgePath, PanelVertexSourceMapping } from "./types";

export interface GlobalPointReference {
  particleIndices: number[];
  weights: number[];
}

export interface AssemblyDistanceConstraint {
  a: number;
  b: number;
  restLength: number;
  stiffness: number;
}

export interface AssemblyStitchConstraint {
  id: string;
  seamId: string;
  seamGroupId: string;
  treatment: string;
  distribution: SeamDistribution;
  targetRatio: number;
  slackMm: number;
  a: GlobalPointReference;
  b: GlobalPointReference;
  restDistance: number;
  stiffness: number;
  instanceA?: string;
  instanceB?: string;
  /** Correspondência canônica preservada para placement e futuro XPBD. */
  rangeA?: EdgeRange;
  rangeB?: EdgeRange;
  rangeLengthAMm?: number;
  rangeLengthBMm?: number;
  progress?: number;
}

export interface AssemblyAnchorConstraint {
  particleIndex: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  stiffness: number;
}

export interface AssemblyInstanceArrangement {
  anchorId: string;
  outwardNormal: [number, number, number];
  axis: [number, number, number];
  /** Centro geométrico usado por mapeamentos tubulares analíticos. */
  tubeCenter?: [number, number, number];
  tubeRadiusM?: number;
  bodySide: PatternPreviewPlacement["bodySide"];
  marginM: number;
  mapping: "rigid-panel" | "body-surface" | "local-tube" | "anatomical-half-tube" | "seam-derived-tube";
  flipWinding: boolean;
}

export interface AssemblyPanelInstance {
  id: string;
  pieceId: string;
  sourcePatternId: string;
  geometrySignature: string;
  placement: PatternPreviewPlacement;
  topology: PanelTopology;
  particleStart: number;
  vertexCount: number;
  vertexSources: Array<PanelVertexSourceMapping & { panelInstanceId: string; meshVertexIndex: number }>;
  arrangement?: AssemblyInstanceArrangement;
}

export interface GarmentAssemblyState {
  positions: Float32Array;
  initialPositions: Float32Array;
  previousPositions: Float32Array;
  inverseMasses: Float32Array;
  instances: AssemblyPanelInstance[];
  structuralConstraints: AssemblyDistanceConstraint[];
  stitchConstraints: AssemblyStitchConstraint[];
  anchorConstraints: AssemblyAnchorConstraint[];
  warnings: string[];
  invalid: boolean;
}

export interface IntrinsicDistortionMetric {
  maxRelativeDistortion: number;
  maxAbsoluteDistortionM: number;
  evaluatedConstraintCount: number;
  byInstance: Record<string, {
    maxRelativeDistortion: number;
    maxAbsoluteDistortionM: number;
    evaluatedConstraintCount: number;
  }>;
}

const METERS_PER_MM = 0.001;
const SEAM_SAMPLE_SPACING_MM = 14;
const MAX_SEAM_SAMPLES = 220;
const DISTANCE_EPSILON = 1e-8;

/**
 * Mede somente comprimentos estruturais internos, nunca distâncias de costura.
 * Assim a métrica continua válida mesmo quando o initial assembly aceita gaps.
 */
export function measureIntrinsicDistortion(
  state: Pick<GarmentAssemblyState, "positions" | "structuralConstraints" | "instances">,
): IntrinsicDistortionMetric {
  let maxRelativeDistortion = 0;
  let maxAbsoluteDistortionM = 0;
  let evaluatedConstraintCount = 0;
  const byInstance: IntrinsicDistortionMetric["byInstance"] = Object.fromEntries(
    state.instances.map((instance) => [instance.id, {
      maxRelativeDistortion: 0,
      maxAbsoluteDistortionM: 0,
      evaluatedConstraintCount: 0,
    }]),
  );
  const instanceByParticle = new Map<number, AssemblyPanelInstance>();
  for (const instance of state.instances) {
    for (let local = 0; local < instance.vertexCount; local += 1) {
      instanceByParticle.set(instance.particleStart + local, instance);
    }
  }

  for (const constraint of state.structuralConstraints) {
    if (constraint.restLength <= DISTANCE_EPSILON) continue;
    const offsetA = constraint.a * 3;
    const offsetB = constraint.b * 3;
    const instance = instanceByParticle.get(constraint.a);
    const currentLength = intrinsicConstraintLength(state.positions, offsetA, offsetB, instance);
    const absolute = Math.abs(currentLength - constraint.restLength);
    maxAbsoluteDistortionM = Math.max(maxAbsoluteDistortionM, absolute);
    maxRelativeDistortion = Math.max(
      maxRelativeDistortion,
      absolute / constraint.restLength,
    );
    evaluatedConstraintCount += 1;
    const instanceId = instance?.id;
    const perInstance = instanceId ? byInstance[instanceId] : undefined;
    if (perInstance) {
      perInstance.maxAbsoluteDistortionM = Math.max(perInstance.maxAbsoluteDistortionM, absolute);
      perInstance.maxRelativeDistortion = Math.max(
        perInstance.maxRelativeDistortion,
        absolute / constraint.restLength,
      );
      perInstance.evaluatedConstraintCount += 1;
    }
  }

  return {
    maxRelativeDistortion,
    maxAbsoluteDistortionM,
    evaluatedConstraintCount,
    byInstance,
  };
}

function intrinsicConstraintLength(
  positions: Float32Array,
  offsetA: number,
  offsetB: number,
  instance: AssemblyPanelInstance | undefined,
): number {
  const arrangement = instance?.arrangement;
  const center = arrangement?.tubeCenter;
  const radius = arrangement?.tubeRadiusM;
  if (arrangement?.mapping !== "seam-derived-tube" || !center || !radius || radius <= DISTANCE_EPSILON) {
    return Math.hypot(
      positions[offsetB] - positions[offsetA],
      positions[offsetB + 1] - positions[offsetA + 1],
      positions[offsetB + 2] - positions[offsetA + 2],
    );
  }

  const axisLength = Math.hypot(...arrangement.axis);
  const axis = arrangement.axis.map((value) => value / Math.max(axisLength, DISTANCE_EPSILON));
  const first = [
    positions[offsetA] - center[0],
    positions[offsetA + 1] - center[1],
    positions[offsetA + 2] - center[2],
  ];
  const second = [
    positions[offsetB] - center[0],
    positions[offsetB + 1] - center[1],
    positions[offsetB + 2] - center[2],
  ];
  const axialFirst = first[0] * axis[0] + first[1] * axis[1] + first[2] * axis[2];
  const axialSecond = second[0] * axis[0] + second[1] * axis[1] + second[2] * axis[2];
  const radialFirst = first.map((value, index) => value - axis[index] * axialFirst);
  const radialSecond = second.map((value, index) => value - axis[index] * axialSecond);
  const cosine = (
    radialFirst[0] * radialSecond[0]
    + radialFirst[1] * radialSecond[1]
    + radialFirst[2] * radialSecond[2]
  ) / Math.max(DISTANCE_EPSILON, Math.hypot(...radialFirst) * Math.hypot(...radialSecond));
  const angle = Math.acos(Math.min(1, Math.max(-1, cosine)));
  return Math.hypot(axialSecond - axialFirst, angle * radius);
}

export function buildGarmentAssembly(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
  geometrySignatures: ReadonlyMap<string, string> = new Map(),
): GarmentAssemblyState {
  const warnings: string[] = [];
  const instances: AssemblyPanelInstance[] = [];
  const positionValues: number[] = [];
  for (const snapshot of snapshots) {
    let topology: PanelTopology;

    try {
      const baseTopology = buildPanelTopology(snapshot.piece, METERS_PER_MM, geometrySignatures.get(snapshot.piece.id));
      topology = refinePanelTopology(
        baseTopology,
        recommendedPanelRefinement(baseTopology),
      );
    } catch (error) {
      warnings.push(
        `${snapshot.piece.name}: ${
          error instanceof Error
            ? error.message
            : "não foi possível gerar a topologia 3D"
        }`,
      );
      continue;
    }

    const placements = resolvePiecePlacements(snapshot.piece, garment);
    if (placements.length === 0) {
      warnings.push(`${snapshot.piece.name}: nenhuma instância possui anchor explícito; a peça foi omitida do 3D.`);
    }
    for (const placement of placements) {
      const particleStart = positionValues.length / 3;
      const instance: AssemblyPanelInstance = {
        id: placement.id,
        pieceId: snapshot.piece.id,
        sourcePatternId: snapshot.piece.id,
        geometrySignature: topology.geometrySignature,
        placement,
        topology,
        particleStart,
        vertexCount: topology.positions2DMm.length / 2,
        vertexSources: topology.vertexSources.map((source) => ({
          ...source,
          panelInstanceId: placement.id,
          meshVertexIndex: source.vertexIndex,
        })),
      };

      appendInitialPositions(positionValues, instance);
      applyDartDepthBias(positionValues, instance);
      instances.push(instance);
    }
  }

  const positions = Float32Array.from(positionValues);
  const structuralConstraints = buildStructuralConstraints(instances);
  const stitchConstraints = buildGlobalStitchConstraints(
    instances,
    garment.seams ?? [],
    warnings,
  );
  stitchConstraints.push(...buildDartConstraints(instances));

  prealignConnectedInstances(positions, instances, stitchConstraints);

  const initialPositions = new Float32Array(positions);
  const previousPositions = new Float32Array(positions);
  const inverseMasses = new Float32Array(positions.length / 3).fill(1);
  const anchorConstraints = buildComponentAnchors(
    instances,
    stitchConstraints,
    initialPositions,
  );

  if (instances.length === 0) {
    warnings.push("Nenhuma peça válida chegou à montagem 3D.");
  }

  if ((garment.seams?.length ?? 0) > 0 && stitchConstraints.length === 0) {
    warnings.push(
      "As costuras existem no projeto, mas nenhuma pôde ser convertida em restrição 3D.",
    );
  }

  return {
    positions,
    initialPositions,
    previousPositions,
    inverseMasses,
    instances,
    structuralConstraints,
    stitchConstraints,
    anchorConstraints,
    warnings,
    invalid: false,
  };
}

function appendInitialPositions(
  target: number[],
  instance: AssemblyPanelInstance,
): void {
  const { topology, placement } = instance;
  const centerX = (topology.boundsMm.minX + topology.boundsMm.maxX) / 2;
  const topY = topology.boundsMm.minY;
  const rotation = placement.rotationDeg * Math.PI / 180;

  for (let localIndex = 0; localIndex < instance.vertexCount; localIndex += 1) {
    const xMm = topology.positions2DMm[localIndex * 2];
    const yMm = topology.positions2DMm[localIndex * 2 + 1];
    const rawX = (xMm - centerX) * METERS_PER_MM * (placement.mirrorX ? -1 : 1);
    const rawY = -(yMm - topY) * METERS_PER_MM;
    const rotatedX = rawX * Math.cos(rotation) - rawY * Math.sin(rotation);
    const rotatedY = rawX * Math.sin(rotation) + rawY * Math.cos(rotation);
    target.push(rotatedX, rotatedY, 0);
  }
}

function buildStructuralConstraints(
  instances: readonly AssemblyPanelInstance[],
): AssemblyDistanceConstraint[] {
  const result: AssemblyDistanceConstraint[] = [];

  for (const instance of instances) {
    const seen = new Set<string>();
    const triangles = instance.topology.triangles;

    for (let offset = 0; offset < triangles.length; offset += 3) {
      addStructuralEdge(instance, triangles[offset], triangles[offset + 1], seen, result);
      addStructuralEdge(instance, triangles[offset + 1], triangles[offset + 2], seen, result);
      addStructuralEdge(instance, triangles[offset + 2], triangles[offset], seen, result);
    }
  }

  return result;
}

function addStructuralEdge(
  instance: AssemblyPanelInstance,
  localA: number,
  localB: number,
  seen: Set<string>,
  target: AssemblyDistanceConstraint[],
): void {
  const key = localA < localB ? `${localA}:${localB}` : `${localB}:${localA}`;
  if (seen.has(key)) return;
  seen.add(key);

  const positions = instance.topology.positions2DMm;
  const dx = (positions[localB * 2] - positions[localA * 2]) * METERS_PER_MM;
  const dy = (positions[localB * 2 + 1] - positions[localA * 2 + 1]) * METERS_PER_MM;

  target.push({
    a: instance.particleStart + localA,
    b: instance.particleStart + localB,
    restLength: Math.hypot(dx, dy),
    stiffness: 0.86,
  });
}

function buildGlobalStitchConstraints(
  instances: readonly AssemblyPanelInstance[],
  seams: readonly Seam[],
  warnings: string[],
): AssemblyStitchConstraint[] {
  const byPiece = new Map<string, AssemblyPanelInstance[]>();
  const result: AssemblyStitchConstraint[] = [];

  for (const instance of instances) {
    const list = byPiece.get(instance.pieceId) ?? [];
    list.push(instance);
    byPiece.set(instance.pieceId, list);
  }

  for (const seam of seams) {
    if (seam.active === false) continue;
    const firstRanges = seamSideRanges(seam, "first");
    const secondRanges = seamSideRanges(seam, "second");
    if (rangeSequencesAreIdentical(firstRanges, secondRanges)) {
      warnings.push(`${seam.name ?? seam.id}: a mesma faixa não pode ser costurada sobre ela mesma.`);
      continue;
    }
    const pieces = [...new Map(instances.map((instance) => [instance.pieceId, instance.topology.sourcePiece])).values()];
    const firstLength = edgeRangeSequenceLength(pieces, firstRanges);
    const secondLength = edgeRangeSequenceLength(pieces, secondRanges);
    if (firstLength <= DISTANCE_EPSILON || secondLength <= DISTANCE_EPSILON) continue;
    if ([...firstRanges, ...secondRanges].some((range) => (byPiece.get(range.pieceId) ?? []).length === 0)) {
      warnings.push(`${seam.name ?? seam.id}: uma das peças da costura não está no preview 3D.`);
      continue;
    }
    const sampleCount = Math.min(MAX_SEAM_SAMPLES, Math.max(2,
      Math.ceil(Math.max(firstLength, secondLength) / SEAM_SAMPLE_SPACING_MM) + 1));
    const stiffness = seamStiffness(seam.treatment);
    const targetRatio = Number.isFinite(seam.targetRatio) && (seam.targetRatio ?? 0) > 0
      ? seam.targetRatio! : Math.max(0.000001, 1 + seam.easeRatio);
    const slackMm = Number.isFinite(seam.slackMm) && (seam.slackMm ?? 0) >= 0 ? seam.slackMm! : 0;
    const distribution = seam.distribution ?? "uniform";
    const mismatchMm = Math.abs(firstLength - secondLength * targetRatio);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const progress = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
      const firstPoint = resolveEdgeRangeSequenceProgress(pieces, firstRanges, progress);
      const secondProgress = seam.direction === "opposite" ? 1 - progress : progress;
      const secondPoint = resolveEdgeRangeSequenceProgress(pieces, secondRanges, secondProgress);
      if (!firstPoint || !secondPoint) continue;
      const firstInstances = byPiece.get(firstPoint.range.pieceId) ?? [];
      const secondInstances = byPiece.get(secondPoint.range.pieceId) ?? [];
      const pairs = firstPoint.range.pieceId === secondPoint.range.pieceId
        ? firstInstances.map((instance) => [instance, instance] as const)
        : pairInstances(firstInstances, secondInstances);
      for (const [firstInstance, secondInstance] of pairs) {
        const firstPath = firstInstance.topology.edges.get(firstPoint.range.edgeId);
        const secondPath = secondInstance.topology.edges.get(secondPoint.range.edgeId);
        if (!firstPath || !secondPath) continue;
        const firstT = firstPoint.t;
        const secondT = secondPoint.t;
        const a = pointReference(firstInstance, firstPath, firstT);
        const b = pointReference(secondInstance, secondPath, secondT);

        if (pointReferenceKey(a) === pointReferenceKey(b)) continue;

        result.push({
          id: `${seam.id}/${firstInstance.id}/${secondInstance.id}/${sampleIndex}`,
          seamId: seam.id,
          seamGroupId: seam.groupId ?? seam.id,
          treatment: seam.canonicalTreatment ?? seam.treatment ?? "standard",
          distribution,
          targetRatio,
          slackMm,
          a,
          b,
          restDistance: 0.0015 + (mismatchMm + slackMm) * METERS_PER_MM / sampleCount,
          stiffness,
          instanceA: firstInstance.id,
          instanceB: secondInstance.id,
          rangeA: { ...firstPoint.range },
          rangeB: { ...secondPoint.range },
          rangeLengthAMm: firstPoint.rangeLengthMm,
          rangeLengthBMm: secondPoint.rangeLengthMm,
          progress,
        });
      }
    }
  }

  return result;
}

function buildDartConstraints(
  instances: readonly AssemblyPanelInstance[],
): AssemblyStitchConstraint[] {
  const result: AssemblyStitchConstraint[] = [];

  for (const instance of instances) {
    for (const dart of instance.topology.darts) {
      const legA = nearestLocalVertex(instance.topology, dart.dart.legA.xMm, dart.dart.legA.yMm);
      const legB = nearestLocalVertex(instance.topology, dart.dart.legB.xMm, dart.dart.legB.yMm);
      if (legA < 0 || legB < 0 || legA === legB) continue;

      result.push({
        id: `dart/${instance.id}/${dart.dart.id}`,
        seamId: `dart:${dart.dart.id}`,
        seamGroupId: `dart:${dart.dart.id}`,
        treatment: "dart",
        distribution: "uniform",
        targetRatio: 1,
        slackMm: 0,
        a: directPoint(instance.particleStart + legA),
        b: directPoint(instance.particleStart + legB),
        restDistance: 0.001,
        stiffness: dart.dart.closed ? 0.78 : 0.62,
        instanceA: instance.id,
        instanceB: instance.id,
      });
    }
  }

  return result;
}

function prealignConnectedInstances(
  positions: Float32Array,
  instances: readonly AssemblyPanelInstance[],
  stitches: readonly AssemblyStitchConstraint[],
): void {
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const constraintsByPair = new Map<string, AssemblyStitchConstraint[]>();
  const adjacency = new Map<string, Set<string>>(
    instances.map((instance) => [instance.id, new Set<string>()]),
  );

  for (const stitch of stitches) {
    if (!stitch.instanceA || !stitch.instanceB || stitch.instanceA === stitch.instanceB) continue;
    const key = pairKey(stitch.instanceA, stitch.instanceB);
    const list = constraintsByPair.get(key) ?? [];
    list.push(stitch);
    constraintsByPair.set(key, list);
    adjacency.get(stitch.instanceA)?.add(stitch.instanceB);
    adjacency.get(stitch.instanceB)?.add(stitch.instanceA);
  }

  const visited = new Set<string>();

  for (const root of instances) {
    if (visited.has(root.id)) continue;
    visited.add(root.id);
    const queue = [root.id];

    while (queue.length > 0) {
      const fixedId = queue.shift()!;

      for (const movingId of adjacency.get(fixedId) ?? []) {
        if (visited.has(movingId)) continue;
        const fixed = instanceById.get(fixedId);
        const moving = instanceById.get(movingId);
        if (!fixed || !moving) continue;

        const constraints = constraintsByPair.get(pairKey(fixedId, movingId)) ?? [];
        const translation = averagePairTranslation(
          positions,
          constraints,
          fixedId,
          movingId,
        );
        translateInstance(positions, moving, translation.x, translation.y, translation.z);
        visited.add(movingId);
        queue.push(movingId);
      }
    }
  }
}

function averagePairTranslation(
  positions: Float32Array,
  constraints: readonly AssemblyStitchConstraint[],
  fixedId: string,
  movingId: string,
): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;

  for (const constraint of constraints) {
    const a = evaluateReference(positions, constraint.a);
    const b = evaluateReference(positions, constraint.b);

    if (constraint.instanceA === fixedId && constraint.instanceB === movingId) {
      x += a.x - b.x;
      y += a.y - b.y;
      z += a.z - b.z;
      count += 1;
    } else if (constraint.instanceB === fixedId && constraint.instanceA === movingId) {
      x += b.x - a.x;
      y += b.y - a.y;
      z += b.z - a.z;
      count += 1;
    }
  }

  if (count === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: clampSigned(x / count, 0.5),
    y: clampSigned(y / count, 0.5),
    z: clampSigned(z / count, 0.2),
  };
}

function translateInstance(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  dx: number,
  dy: number,
  dz: number,
): void {
  for (let localIndex = 0; localIndex < instance.vertexCount; localIndex += 1) {
    const offset = (instance.particleStart + localIndex) * 3;
    positions[offset] += dx;
    positions[offset + 1] += dy;
    positions[offset + 2] += dz;
  }
}

function buildComponentAnchors(
  instances: readonly AssemblyPanelInstance[],
  stitches: readonly AssemblyStitchConstraint[],
  positions: Float32Array,
): AssemblyAnchorConstraint[] {
  const adjacency = new Map<string, Set<string>>(
    instances.map((instance) => [instance.id, new Set<string>()]),
  );

  for (const stitch of stitches) {
    if (!stitch.instanceA || !stitch.instanceB || stitch.instanceA === stitch.instanceB) continue;
    adjacency.get(stitch.instanceA)?.add(stitch.instanceB);
    adjacency.get(stitch.instanceB)?.add(stitch.instanceA);
  }

  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const visited = new Set<string>();
  const result: AssemblyAnchorConstraint[] = [];

  for (const root of instances) {
    if (visited.has(root.id)) continue;
    const queue = [root.id];
    visited.add(root.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const anchorInstance = instanceById.get(root.id);
    if (!anchorInstance || anchorInstance.vertexCount === 0) continue;
    const topVertices = [...anchorInstance.topology.boundaryVertices]
      .sort((left, right) =>
        anchorInstance.topology.positions2DMm[left * 2 + 1] -
        anchorInstance.topology.positions2DMm[right * 2 + 1],
      )
      .slice(0, 2);

    topVertices.forEach((localIndex, index) => {
      const particleIndex = anchorInstance.particleStart + localIndex;
      result.push({
        particleIndex,
        targetX: positions[particleIndex * 3],
        targetY: positions[particleIndex * 3 + 1],
        targetZ: positions[particleIndex * 3 + 2],
        stiffness: index === 0 ? 0.004 : 0.002,
      });
    });
  }

  return result;
}

function applyDartDepthBias(
  positions: number[],
  instance: AssemblyPanelInstance,
): void {
  const surfaceSign = instance.placement.surface === "back" ? -1 : 1;

  for (const dart of instance.topology.darts) {
    const apex = nearestLocalVertex(instance.topology, dart.dart.apex.xMm, dart.dart.apex.yMm);
    if (apex < 0) continue;
    const globalIndex = instance.particleStart + apex;
    positions[globalIndex * 3 + 2] += surfaceSign * Math.min(
      0.025,
      Math.max(0.006, dart.dart.widthMm * 0.0004),
    );
  }
}

function pointReference(
  instance: AssemblyPanelInstance,
  path: PanelEdgePath,
  t: number,
): GlobalPointReference {
  const targetDistance = path.lengthMm * clamp01(t);
  const lastIndex = path.vertexIndices.length - 1;

  if (lastIndex <= 0 || targetDistance <= DISTANCE_EPSILON) {
    return directPoint(instance.particleStart + path.vertexIndices[0]);
  }
  if (path.lengthMm - targetDistance <= DISTANCE_EPSILON) {
    return directPoint(instance.particleStart + path.vertexIndices[lastIndex]);
  }

  let upper = 1;
  while (
    upper < path.cumulativeLengthsMm.length &&
    path.cumulativeLengthsMm[upper] < targetDistance
  ) {
    upper += 1;
  }
  upper = Math.min(upper, lastIndex);
  const lower = Math.max(0, upper - 1);
  const lowerDistance = path.cumulativeLengthsMm[lower];
  const upperDistance = path.cumulativeLengthsMm[upper];
  const segmentLength = upperDistance - lowerDistance;

  if (segmentLength <= DISTANCE_EPSILON) {
    return directPoint(instance.particleStart + path.vertexIndices[lower]);
  }

  const alpha = clamp01((targetDistance - lowerDistance) / segmentLength);
  if (alpha <= 1e-6) return directPoint(instance.particleStart + path.vertexIndices[lower]);
  if (alpha >= 1 - 1e-6) return directPoint(instance.particleStart + path.vertexIndices[upper]);

  return {
    particleIndices: [
      instance.particleStart + path.vertexIndices[lower],
      instance.particleStart + path.vertexIndices[upper],
    ],
    weights: [1 - alpha, alpha],
  };
}

function evaluateReference(
  positions: Float32Array,
  reference: GlobalPointReference,
): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;

  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const offset = reference.particleIndices[index] * 3;
    const weight = reference.weights[index];
    x += positions[offset] * weight;
    y += positions[offset + 1] * weight;
    z += positions[offset + 2] * weight;
  }

  return { x, y, z };
}

function directPoint(particleIndex: number): GlobalPointReference {
  return { particleIndices: [particleIndex], weights: [1] };
}

function pairInstances(
  first: readonly AssemblyPanelInstance[],
  second: readonly AssemblyPanelInstance[],
): Array<readonly [AssemblyPanelInstance, AssemblyPanelInstance]> {
  const sortBySide = (items: readonly AssemblyPanelInstance[]) =>
    [...items].sort(
      (left, right) => sideOrder(left.placement.bodySide) - sideOrder(right.placement.bodySide),
    );
  const sortedFirst = sortBySide(first);
  const sortedSecond = sortBySide(second);

  if (sortedFirst.length === 1) {
    return sortedSecond.map((item) => [sortedFirst[0], item] as const);
  }
  if (sortedSecond.length === 1) {
    return sortedFirst.map((item) => [item, sortedSecond[0]] as const);
  }

  const count = Math.min(sortedFirst.length, sortedSecond.length);
  return Array.from(
    { length: count },
    (_, index) => [sortedFirst[index], sortedSecond[index]] as const,
  );
}

function resolvePiecePlacements(
  piece: PatternPiece,
  garment: GarmentDraft,
): PatternPreviewPlacement[] {
  if (piece.previewPlacements?.length) {
    return piece.previewPlacements.map((placement) => ({ ...placement }));
  }

  const placements = garment.assemblyPlacements?.filter(
    (candidate) => candidate.pieceId === piece.id,
  ) ?? [];
  return placements.flatMap((resolved) => {
    const region = roleToRegion(resolved.role);
    const duplicateSides = (resolved.role === "sleeve" || resolved.role === "leg") && (piece.cutQuantity ?? 1) > 1;
    const sides = duplicateSides ? (["left", "right"] as const) : (["center"] as const);
    return sides.map((bodySide, index) => ({
      id: `assembly-${piece.id}-${bodySide}`,
      pieceId: piece.id,
      region,
      surface: resolved.outwardSide,
      bodySide,
      rotationDeg: resolved.rotationDeg[2],
      offsetXMm: resolved.positionMm[0],
      offsetYMm: resolved.positionMm[1],
      offsetZMm: resolved.positionMm[2],
      scale: 1,
      mirrorX: Boolean(resolved.flipped) !== (index === 1),
    }));
  });
}

function roleToRegion(
  role: AssemblyPlacement["role"],
): PatternPreviewPlacement["region"] {
  if (role === "sleeve") return "arm";
  if (role === "leg") return "leg";
  if (role === "waist") return "hip";
  return "torso";
}

function nearestLocalVertex(
  topology: PanelTopology,
  xMm: number,
  yMm: number,
): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < topology.positions2DMm.length / 2; index += 1) {
    const dx = topology.positions2DMm[index * 2] - xMm;
    const dy = topology.positions2DMm[index * 2 + 1] - yMm;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function edgeRangeLength(path: PanelEdgePath, range: EdgeRange): number {
  return path.lengthMm * Math.abs(clamp01(range.endT) - clamp01(range.startT));
}

function interpolateRange(range: EdgeRange, progress: number): number {
  return clamp01(range.startT) +
    (clamp01(range.endT) - clamp01(range.startT)) * clamp01(progress);
}

function seamStiffness(treatment: SeamTreatment | undefined): number {
  switch (treatment ?? "standard") {
    case "standard": return 0.96;
    case "ease": return 0.86;
    case "gather": return 0.78;
    case "stretch": return 0.72;
    case "intentional-mismatch": return 0.58;
  }
}

function pointReferenceKey(reference: GlobalPointReference): string {
  return reference.particleIndices
    .map(
      (particleIndex, index) =>
        `${particleIndex}:${reference.weights[index].toFixed(7)}`,
    )
    .join("|");
}

function rangesAreIdentical(first: EdgeRange, second: EdgeRange): boolean {
  return (
    first.pieceId === second.pieceId &&
    first.edgeId === second.edgeId &&
    Math.abs(first.startT - second.startT) <= 1e-7 &&
    Math.abs(first.endT - second.endT) <= 1e-7
  );
}

function rangeSequencesAreIdentical(first: readonly EdgeRange[], second: readonly EdgeRange[]): boolean {
  return first.length === second.length
    && first.every((range, index) => rangesAreIdentical(range, second[index]));
}

function pairKey(first: string, second: string): string {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function sideOrder(side: PatternPreviewPlacement["bodySide"]): number {
  if (side === "left") return 0;
  if (side === "center") return 1;
  return 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number, maximumAbsolute: number): number {
  return Math.min(maximumAbsolute, Math.max(-maximumAbsolute, value));
}
