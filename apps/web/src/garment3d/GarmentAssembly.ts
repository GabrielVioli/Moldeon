import type {
  AssemblyPlacement,
  EdgeRange,
  GarmentDraft,
  PatternPiece,
  PatternPreviewPlacement,
  PatternSnapshot,
  Seam,
  SeamTreatment,
} from "../domain/pattern";
import {
  buildPanelTopology,
  type PanelTopology,
} from "./PanelTopology";
import type { PanelEdgePath } from "./types";

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
  a: GlobalPointReference;
  b: GlobalPointReference;
  restDistance: number;
  stiffness: number;
}

export interface AssemblyAnchorConstraint {
  particleIndex: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  stiffness: number;
}

export interface AssemblyPanelInstance {
  id: string;
  pieceId: string;
  placement: PatternPreviewPlacement;
  topology: PanelTopology;
  particleStart: number;
  vertexCount: number;
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

const METERS_PER_MM = 0.001;
const SEAM_SAMPLE_SPACING_MM = 18;
const MAX_SEAM_SAMPLES = 180;
const DISTANCE_EPSILON = 1e-8;

export function buildGarmentAssembly(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
): GarmentAssemblyState {
  const warnings: string[] = [];
  const instances: AssemblyPanelInstance[] = [];
  const positionValues: number[] = [];
  const selfSeamedPieceIds = new Set(
    (garment.seams ?? [])
      .filter(
        (seam) =>
          seam.first.pieceId === seam.second.pieceId &&
          !rangesAreIdentical(seam.first, seam.second),
      )
      .map((seam) => seam.first.pieceId),
  );

  for (const snapshot of snapshots) {
    let topology: PanelTopology;

    try {
      topology = buildPanelTopology(snapshot.piece);
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

    for (const placement of placements) {
      const particleStart = positionValues.length / 3;
      const instance: AssemblyPanelInstance = {
        id: `${snapshot.piece.id}/${placement.id}`,
        pieceId: snapshot.piece.id,
        placement,
        topology,
        particleStart,
        vertexCount: topology.positions2DMm.length / 2,
      };

      appendInitialPositions(
        positionValues,
        instance,
        selfSeamedPieceIds.has(snapshot.piece.id),
      );
      applyDartDepthBias(positionValues, instance);
      instances.push(instance);
    }
  }

  const initialPositions = new Float32Array(positionValues);
  const positions = new Float32Array(initialPositions);
  const previousPositions = new Float32Array(initialPositions);
  const inverseMasses = new Float32Array(positions.length / 3).fill(1);
  const structuralConstraints = buildStructuralConstraints(instances);
  const stitchConstraints = buildGlobalStitchConstraints(
    instances,
    garment.seams ?? [],
    warnings,
  );
  stitchConstraints.push(...buildDartConstraints(instances));
  const anchorConstraints = buildSoftAnchors(instances, initialPositions);

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
  wrapAsTube: boolean,
): void {
  const { topology, placement } = instance;
  const centerX = (topology.boundsMm.minX + topology.boundsMm.maxX) / 2;
  const topY = topology.boundsMm.minY;
  const widthMm = Math.max(topology.boundsMm.width, 1);
  const scale = Number.isFinite(placement.scale) && placement.scale > 0
    ? placement.scale
    : 1;
  const rotation = placement.rotationDeg * Math.PI / 180;
  const base = placementBasePosition(placement);
  const radius = Math.max(widthMm * METERS_PER_MM * scale / (2 * Math.PI), 0.025);

  for (let vertexIndex = 0; vertexIndex < instance.vertexCount; vertexIndex += 1) {
    const xMm = topology.positions2DMm[vertexIndex * 2];
    const yMm = topology.positions2DMm[vertexIndex * 2 + 1];
    const rawX = (xMm - centerX) * METERS_PER_MM;
    const rawY = -(yMm - topY) * METERS_PER_MM;
    const mirroredX = placement.mirrorX ? -rawX : rawX;
    const scaledX = mirroredX * scale;
    const scaledY = rawY * scale;
    const rotatedX = scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation);
    const rotatedY = scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation);

    if (wrapAsTube) {
      const normalized = (xMm - topology.boundsMm.minX) / widthMm;
      const direction = placement.mirrorX ? -1 : 1;
      const angle = direction * normalized * Math.PI * 2;
      target.push(
        base.x + Math.sin(angle) * radius,
        base.y + rotatedY,
        base.z + Math.cos(angle) * radius,
      );
      continue;
    }

    target.push(
      base.x + rotatedX,
      base.y + rotatedY,
      base.z,
    );
  }
}

function placementBasePosition(
  placement: PatternPreviewPlacement,
): { x: number; y: number; z: number } {
  let x = 0;
  let y = 1.62;
  let z = 0;

  switch (placement.region) {
    case "torso":
      y = 1.66;
      break;
    case "waist":
      y = 1.31;
      break;
    case "hip":
      y = 1.18;
      break;
    case "arm":
      y = 1.58;
      break;
    case "leg":
      y = 1.08;
      break;
  }

  if (placement.bodySide === "left") {
    x -= placement.region === "arm" ? 0.58 : placement.region === "leg" ? 0.23 : 0.12;
  } else if (placement.bodySide === "right") {
    x += placement.region === "arm" ? 0.58 : placement.region === "leg" ? 0.23 : 0.12;
  }

  if (placement.surface === "front") z = 0.13;
  else if (placement.surface === "back") z = -0.13;

  x += placement.offsetXMm * METERS_PER_MM;
  y -= placement.offsetYMm * METERS_PER_MM;
  z += placement.offsetZMm * METERS_PER_MM;

  return { x, y, z };
}

function buildStructuralConstraints(
  instances: readonly AssemblyPanelInstance[],
): AssemblyDistanceConstraint[] {
  const result: AssemblyDistanceConstraint[] = [];

  for (const instance of instances) {
    const seen = new Set<string>();
    const triangles = instance.topology.triangles;

    for (let index = 0; index < triangles.length; index += 3) {
      addStructuralEdge(instance, triangles[index], triangles[index + 1], seen, result);
      addStructuralEdge(instance, triangles[index + 1], triangles[index + 2], seen, result);
      addStructuralEdge(instance, triangles[index + 2], triangles[index], seen, result);
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
  const low = Math.min(localA, localB);
  const high = Math.max(localA, localB);
  const key = `${low}:${high}`;
  if (seen.has(key)) return;
  seen.add(key);

  const positions = instance.topology.positions2DMm;
  const dx = (positions[localB * 2] - positions[localA * 2]) * METERS_PER_MM;
  const dy = (positions[localB * 2 + 1] - positions[localA * 2 + 1]) * METERS_PER_MM;
  const scale = Number.isFinite(instance.placement.scale) && instance.placement.scale > 0
    ? instance.placement.scale
    : 1;

  target.push({
    a: instance.particleStart + localA,
    b: instance.particleStart + localB,
    restLength: Math.hypot(dx, dy) * scale,
    stiffness: 0.92,
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
    if (rangesAreIdentical(seam.first, seam.second)) {
      warnings.push(`${seam.name ?? seam.id}: a mesma faixa não pode ser costurada sobre ela mesma.`);
      continue;
    }

    const firstInstances = byPiece.get(seam.first.pieceId) ?? [];
    const secondInstances = byPiece.get(seam.second.pieceId) ?? [];

    if (firstInstances.length === 0 || secondInstances.length === 0) {
      warnings.push(`${seam.name ?? seam.id}: uma das peças da costura não está no preview 3D.`);
      continue;
    }

    const pairs = seam.first.pieceId === seam.second.pieceId
      ? firstInstances.map((instance) => [instance, instance] as const)
      : pairInstances(firstInstances, secondInstances);

    for (const [firstInstance, secondInstance] of pairs) {
      const firstPath = firstInstance.topology.edges.get(seam.first.edgeId);
      const secondPath = secondInstance.topology.edges.get(seam.second.edgeId);

      if (!firstPath || !secondPath) {
        warnings.push(`${seam.name ?? seam.id}: uma borda da costura não existe na topologia.`);
        continue;
      }

      const firstLength = edgeRangeLength(firstPath, seam.first);
      const secondLength = edgeRangeLength(secondPath, seam.second);
      if (firstLength <= DISTANCE_EPSILON || secondLength <= DISTANCE_EPSILON) continue;

      const sampleCount = Math.min(
        MAX_SEAM_SAMPLES,
        Math.max(2, Math.ceil(Math.max(firstLength, secondLength) / SEAM_SAMPLE_SPACING_MM) + 1),
      );
      const stiffness = seamStiffness(seam.treatment);

      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const progress = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
        const firstT = interpolateRange(seam.first, progress);
        const secondProgress = seam.direction === "opposite" ? 1 - progress : progress;
        const secondT = interpolateRange(seam.second, secondProgress);
        const a = pointReference(firstInstance, firstPath, firstT);
        const b = pointReference(secondInstance, secondPath, secondT);

        if (pointReferenceKey(a) === pointReferenceKey(b)) continue;

        result.push({
          id: `${seam.id}/${firstInstance.id}/${secondInstance.id}/${sampleIndex}`,
          seamId: seam.id,
          a,
          b,
          restDistance: 0.0015,
          stiffness,
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
        a: directPoint(instance.particleStart + legA),
        b: directPoint(instance.particleStart + legB),
        restDistance: 0.001,
        stiffness: dart.dart.closed ? 0.78 : 0.62,
      });
    }
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
    positions[globalIndex * 3 + 2] += surfaceSign * Math.min(0.025, Math.max(0.006, dart.dart.widthMm * 0.0004));
  }
}

function buildSoftAnchors(
  instances: readonly AssemblyPanelInstance[],
  positions: Float32Array,
): AssemblyAnchorConstraint[] {
  const result: AssemblyAnchorConstraint[] = [];

  for (const instance of instances) {
    if (instance.vertexCount === 0) continue;
    const candidates = [...instance.topology.boundaryVertices].sort((left, right) => {
      const leftY = instance.topology.positions2DMm[left * 2 + 1];
      const rightY = instance.topology.positions2DMm[right * 2 + 1];
      return leftY - rightY;
    });
    const first = candidates[0] ?? 0;
    const second = candidates.find((candidate) => candidate !== first) ?? first;

    for (const [localIndex, stiffness] of [[first, 0.025], [second, 0.012]] as const) {
      const particleIndex = instance.particleStart + localIndex;
      result.push({
        particleIndex,
        targetX: positions[particleIndex * 3],
        targetY: positions[particleIndex * 3 + 1],
        targetZ: positions[particleIndex * 3 + 2],
        stiffness,
      });
    }
  }

  return result;
}

function pointReference(
  instance: AssemblyPanelInstance,
  path: PanelEdgePath,
  t: number,
): GlobalPointReference {
  const normalized = clamp01(t);
  const targetDistance = path.lengthMm * normalized;
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
  return Array.from({ length: count }, (_, index) => [sortedFirst[index], sortedSecond[index]] as const);
}

function resolvePiecePlacements(
  piece: PatternPiece,
  garment: GarmentDraft,
): PatternPreviewPlacement[] {
  if (piece.previewPlacements?.length) {
    return piece.previewPlacements.map((placement) => ({ ...placement }));
  }

  const assembly = garment.assemblyPlacements?.find((candidate) => candidate.pieceId === piece.id);
  const resolved = assembly ?? inferPlacement(piece);
  const region = roleToRegion(resolved.role);
  const duplicateSides = resolved.role === "sleeve" || resolved.role === "leg";
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
}

function inferPlacement(piece: PatternPiece): AssemblyPlacement {
  const name = piece.name.toLocaleLowerCase("pt-BR");
  const roles = new Set(piece.segments?.map((segment) => segment.role) ?? []);
  const role = name.includes("costas") || roles.has("backArmhole")
    ? "back"
    : name.includes("manga") || roles.has("sleeveCapFront") || roles.has("sleeveCapBack")
      ? "sleeve"
      : name.includes("perna") || name.includes("calça") || roles.has("inseam") || roles.has("outseam")
        ? "leg"
        : name.includes("saia") || name.includes("cós") || name.includes("cintura")
          ? "waist"
          : name.includes("gola")
            ? "collar"
            : "front";

  return {
    pieceId: piece.id,
    role,
    outwardSide: role === "back" ? "back" : "front",
    positionMm: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    flipped: false,
    source: "inferred",
  };
}

function roleToRegion(role: AssemblyPlacement["role"]): PatternPreviewPlacement["region"] {
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
  return clamp01(range.startT) + (clamp01(range.endT) - clamp01(range.startT)) * clamp01(progress);
}

function seamStiffness(treatment: SeamTreatment | undefined): number {
  switch (treatment ?? "standard") {
    case "standard": return 0.92;
    case "ease": return 0.82;
    case "gather": return 0.74;
    case "stretch": return 0.68;
    case "intentional-mismatch": return 0.55;
  }
}

function pointReferenceKey(reference: GlobalPointReference): string {
  return reference.particleIndices
    .map((particleIndex, index) => `${particleIndex}:${reference.weights[index].toFixed(7)}`)
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

function sideOrder(side: PatternPreviewPlacement["bodySide"]): number {
  if (side === "left") return 0;
  if (side === "center") return 1;
  return 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
