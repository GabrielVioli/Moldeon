export type PointerKind = "mouse" | "touch" | "pen";

export const EDITOR_GESTURE_THRESHOLDS = {
  clickPx: 5,
  touchTapPx: 9,
  boxSelectionPx: 5,
  seamHitPx: 10,
  segmentHitPx: 12,
  pointHitPx: 12,
} as const;

export interface GestureOrigin {
  pointerId: number;
  pointerType: PointerKind;
  clientX: number;
  clientY: number;
  startedAt: number;
}

export interface GestureFinish {
  movedPx: number;
  elapsedMs: number;
  isClick: boolean;
}

export function createGestureOrigin(
  pointerId: number,
  pointerType: string,
  clientX: number,
  clientY: number,
  startedAt = performance.now(),
): GestureOrigin {
  return {
    pointerId,
    pointerType: normalizePointerType(pointerType),
    clientX,
    clientY,
    startedAt,
  };
}

export function finishGesture(
  origin: GestureOrigin,
  clientX: number,
  clientY: number,
  finishedAt = performance.now(),
): GestureFinish {
  const movedPx = Math.hypot(clientX - origin.clientX, clientY - origin.clientY);
  const threshold =
    origin.pointerType === "touch"
      ? EDITOR_GESTURE_THRESHOLDS.touchTapPx
      : EDITOR_GESTURE_THRESHOLDS.clickPx;
  return {
    movedPx,
    elapsedMs: Math.max(0, finishedAt - origin.startedAt),
    isClick: movedPx < threshold,
  };
}

export function shouldStartBoxSelection(movedPx: number): boolean {
  return movedPx >= EDITOR_GESTURE_THRESHOLDS.boxSelectionPx;
}

export function shouldInsertPointFromTap(
  origin: GestureOrigin,
  finish: GestureFinish,
  activePointerCount: number,
): boolean {
  if (!finish.isClick || activePointerCount > 1) return false;
  if (origin.pointerType === "touch") {
    return finish.elapsedMs <= 650;
  }
  return true;
}

function normalizePointerType(pointerType: string): PointerKind {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return "mouse";
}
