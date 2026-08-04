import type { GarmentDraft, PatternPoint, PatternVector } from "../domain/pattern";
import { pieceWorldToLocal } from "./coordinates";

export interface EditablePointHit {
  pieceId: string;
  point: PatternPoint;
}

export function findEditablePatternPoint(
  garment: GarmentDraft,
  world: PatternVector,
  maxDistanceMm: number,
): EditablePointHit | null {
  for (let index = garment.pieces.length - 1; index >= 0; index -= 1) {
    const piece = garment.pieces[index];
    const workspace = garment.workspaceStates?.find((state) => state.pieceId === piece.id);
    if (workspace?.visible === false || workspace?.locked === true) continue;
    const transform = workspace?.transform
      ?? garment.workspaceTransforms?.find((candidate) => candidate.pieceId === piece.id)
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const local = pieceWorldToLocal(world, transform);
    const point = piece.points.find(
      (candidate) => Math.hypot(candidate.xMm - local.xMm, candidate.yMm - local.yMm) <= maxDistanceMm,
    );
    if (point) return { pieceId: piece.id, point };
  }
  return null;
}

export function normalizeRotation(rotationDeg: number): number {
  const normalized = ((rotationDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function rotationFromPointer(
  startRotationDeg: number,
  startPointerAngleRad: number,
  pointerAngleRad: number,
  snap: boolean,
): number {
  const raw = startRotationDeg + ((pointerAngleRad - startPointerAngleRad) * 180) / Math.PI;
  return normalizeRotation(snap ? Math.round(raw / 15) * 15 : raw);
}

export function parsePositiveLength(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resizeStraightSegment(
  start: Pick<PatternPoint, "xMm" | "yMm">,
  end: Pick<PatternPoint, "xMm" | "yMm">,
  desiredLength: number,
): { xMm: number; yMm: number } | null {
  if (!Number.isFinite(desiredLength) || desiredLength <= 0) return null;
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return { xMm: start.xMm + (dx / length) * desiredLength, yMm: start.yMm + (dy / length) * desiredLength };
}

export function pointInScreenRect(
  point: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}
