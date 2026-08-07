import type {
  PatternVector,
  PieceWorkspaceTransform,
} from "../domain/pattern";
import type { Camera2D, ScreenPoint } from "./camera";
import { pieceLocalToWorld, worldToScreen } from "./coordinates";

export interface HandlePolar {
  lengthMm: number;
  angleDeg: number;
}

export interface LocalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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

export function localBoundsFromPoints(
  points: readonly Pick<PatternVector, "xMm" | "yMm">[],
): LocalBounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return points.reduce<LocalBounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.xMm),
      minY: Math.min(bounds.minY, point.yMm),
      maxX: Math.max(bounds.maxX, point.xMm),
      maxY: Math.max(bounds.maxY, point.yMm),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

/**
 * Returns the UI-only rotation control position. The offset is expressed in
 * screen pixels and converted by zoom, so the control remains the same visual
 * distance from the top-right corner regardless of camera scale.
 */
export function rotationHandleScreenPosition(
  bounds: LocalBounds,
  transform: PieceWorkspaceTransform,
  camera: Camera2D,
  offsetPx = 24,
): ScreenPoint {
  const handleLocal = {
    xMm: bounds.maxX + screenToleranceMm(offsetPx, camera.zoom),
    yMm: bounds.minY - screenToleranceMm(offsetPx, camera.zoom),
  };
  return worldToScreen(pieceLocalToWorld(handleLocal, transform), camera);
}

export function rotationHandleHitTest(
  pointer: ScreenPoint,
  handle: ScreenPoint,
  pointerType: "mouse" | "pen" | "touch" = "mouse",
): boolean {
  const radiusPx = pointerType === "touch" ? 24 : pointerType === "pen" ? 18 : 16;
  return Math.hypot(pointer.x - handle.x, pointer.y - handle.y) <= radiusPx;
}

/**
 * Rotates a workspace transform while keeping the chosen local pivot fixed in
 * world space. This avoids the legacy behavior where changing rotation alone
 * could make the visual center orbit around the piece origin.
 */
export function rotateWorkspaceTransformAroundPivot(
  transform: PieceWorkspaceTransform,
  pivotLocal: PatternVector,
  rotationDeg: number,
): PieceWorkspaceTransform {
  if (!Number.isFinite(rotationDeg)) {
    throw new TypeError("A rotação precisa ser um número finito.");
  }
  const pivotWorld = pieceLocalToWorld(pivotLocal, transform);
  const radians = (rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotatedPivotX = pivotLocal.xMm * cosine - pivotLocal.yMm * sine;
  const rotatedPivotY = pivotLocal.xMm * sine + pivotLocal.yMm * cosine;
  return {
    ...transform,
    xMm: pivotWorld.xMm - rotatedPivotX,
    yMm: pivotWorld.yMm - rotatedPivotY,
    rotationDeg,
  };
}

export type CoreHitKind =
  | "handle"
  | "point"
  | "marker"
  | "rotation"
  | "segment"
  | "internal"
  | "piece"
  | "background";

const HIT_PRIORITY: Record<CoreHitKind, number> = {
  handle: 0,
  point: 1,
  marker: 2,
  rotation: 3,
  segment: 4,
  internal: 5,
  piece: 6,
  background: 7,
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
