export type PointerKind = "mouse" | "touch" | "pen";
export type GestureDragIntent = "piece" | "point" | "handle" | "pan" | "box";
export type CanvasGestureOwner =
  | "empty"
  | "piece"
  | "point"
  | "handle"
  | "segment"
  | "internal-path"
  | "rotation"
  | "seam"
  | "dart"
  | "tool"
  | "pan"
  | "pinch"
  | "box";

export const EDITOR_GESTURE_THRESHOLDS = {
  clickMousePx: 4,
  clickPenPx: 5,
  touchTapPx: 9,
  pieceDragMousePx: 3,
  pieceDragPenPx: 4,
  pieceDragTouchPx: 9,
  pointDragMousePx: 1.5,
  pointDragPenPx: 2,
  pointDragTouchPx: 6,
  handleDragMousePx: 1.5,
  handleDragPenPx: 2,
  handleDragTouchPx: 6,
  panMousePx: 3,
  panPenPx: 4,
  panTouchPx: 7,
  boxSelectionMousePx: 6,
  boxSelectionPenPx: 7,
  boxSelectionTouchPx: 12,
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

export interface GestureOwnership {
  pointerId: number;
  owner: CanvasGestureOwner;
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
  const movedPx = movementFrom(origin, clientX, clientY);
  return {
    movedPx,
    elapsedMs: Math.max(0, finishedAt - origin.startedAt),
    isClick: movedPx < clickThreshold(origin.pointerType),
  };
}

export function shouldStartDrag(
  origin: GestureOrigin,
  clientX: number,
  clientY: number,
  intent: GestureDragIntent,
): boolean {
  return movementFrom(origin, clientX, clientY) >= dragThreshold(origin.pointerType, intent);
}

export function shouldStartBoxSelection(
  movedPx: number,
  pointerType: PointerKind = "mouse",
): boolean {
  return movedPx >= dragThreshold(pointerType, "box");
}

export function claimGesture(
  current: GestureOwnership | null,
  pointerId: number,
  owner: CanvasGestureOwner,
): GestureOwnership | null {
  if (current && current.pointerId !== pointerId) return current;
  return { pointerId, owner };
}

export function ownsGesture(
  ownership: GestureOwnership | null,
  pointerId: number,
  owner?: CanvasGestureOwner,
): boolean {
  return Boolean(
    ownership &&
      ownership.pointerId === pointerId &&
      (owner === undefined || ownership.owner === owner),
  );
}

export function isInteractiveGestureOwner(owner: CanvasGestureOwner): boolean {
  return owner !== "empty" && owner !== "pan" && owner !== "pinch" && owner !== "box";
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

function movementFrom(origin: GestureOrigin, clientX: number, clientY: number): number {
  return Math.hypot(clientX - origin.clientX, clientY - origin.clientY);
}

function clickThreshold(pointerType: PointerKind): number {
  if (pointerType === "touch") return EDITOR_GESTURE_THRESHOLDS.touchTapPx;
  if (pointerType === "pen") return EDITOR_GESTURE_THRESHOLDS.clickPenPx;
  return EDITOR_GESTURE_THRESHOLDS.clickMousePx;
}

function dragThreshold(pointerType: PointerKind, intent: GestureDragIntent): number {
  const suffix = pointerType === "touch" ? "TouchPx" : pointerType === "pen" ? "PenPx" : "MousePx";
  const prefix = intent === "box" ? "boxSelection" : `${intent}Drag`.replace("panDrag", "pan");
  const key = `${prefix}${suffix}` as keyof typeof EDITOR_GESTURE_THRESHOLDS;
  const threshold = EDITOR_GESTURE_THRESHOLDS[key];
  if (typeof threshold !== "number") throw new Error(`Limiar de gesto ausente: ${key}`);
  return threshold;
}

function normalizePointerType(pointerType: string): PointerKind {
  if (pointerType === "touch" || pointerType === "pen") return pointerType;
  return "mouse";
}
