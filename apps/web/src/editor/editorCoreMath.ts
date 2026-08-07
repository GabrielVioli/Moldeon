import type { PatternVector } from "../domain/pattern";

export interface HandlePolar {
  lengthMm: number;
  angleDeg: number;
}

export function screenToleranceMm(
  tolerancePx: number,
  zoom: number,
): number {
  if (!Number.isFinite(tolerancePx) || tolerancePx < 0) {
    throw new TypeError("A tolerância em pixels precisa ser finita e não negativa.");
  }
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new TypeError("O zoom precisa ser finito e maior que zero.");
  }
  return tolerancePx / zoom;
}

export function handleVectorToPolar(vector: PatternVector): HandlePolar {
  const lengthMm = Math.hypot(vector.xMm, vector.yMm);
  const angleDeg =
    lengthMm === 0
      ? 0
      : normalizeAngle((Math.atan2(vector.yMm, vector.xMm) * 180) / Math.PI);
  return {
    lengthMm: round(lengthMm),
    angleDeg: round(angleDeg),
  };
}

export function handleVectorFromPolar(
  lengthMm: number,
  angleDeg: number,
): PatternVector {
  if (!Number.isFinite(lengthMm) || lengthMm < 0) {
    throw new TypeError("O comprimento do handle precisa ser finito e não negativo.");
  }
  if (!Number.isFinite(angleDeg)) {
    throw new TypeError("O ângulo do handle precisa ser finito.");
  }
  const radians = (angleDeg * Math.PI) / 180;
  return {
    xMm: round(Math.cos(radians) * lengthMm),
    yMm: round(Math.sin(radians) * lengthMm),
  };
}

export type CoreHitKind =
  | "handle"
  | "point"
  | "marker"
  | "segment"
  | "internal"
  | "piece"
  | "background";

const HIT_PRIORITY: Record<CoreHitKind, number> = {
  handle: 0,
  point: 1,
  marker: 2,
  segment: 3,
  internal: 4,
  piece: 5,
  background: 6,
};

export function chooseHighestPriorityHit<T extends { kind: CoreHitKind; distancePx?: number }>(
  hits: readonly T[],
): T | null {
  if (hits.length === 0) return null;
  return [...hits].sort((left, right) => {
    const priority = HIT_PRIORITY[left.kind] - HIT_PRIORITY[right.kind];
    if (priority !== 0) return priority;
    return (left.distancePx ?? Number.POSITIVE_INFINITY)
      - (right.distancePx ?? Number.POSITIVE_INFINITY);
  })[0];
}

export function filterDocumentIds(
  documentIds: readonly string[],
  candidateIds: readonly string[],
): string[] {
  const valid = new Set(documentIds);
  return [...new Set(candidateIds)].filter((id) => valid.has(id));
}

function normalizeAngle(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
