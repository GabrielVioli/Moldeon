import type { PatternPoint } from "../domain/pattern";

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
