import type { Camera2D, ScreenPoint } from "./camera";
import { zoomCameraAtPoint } from "./camera";

export type WheelNavigationMode = "pan" | "zoom";

export interface WheelNavigationInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  viewportHeight: number;
}

export interface NormalizedWheelNavigation {
  mode: WheelNavigationMode;
  deltaX: number;
  deltaY: number;
}

const LINE_HEIGHT_PX = 16;
const MAX_WHEEL_DELTA_PX = 180;
const TRACKPAD_PIXEL_DELTA_PX = 40;

export function normalizeWheelNavigation(
  input: WheelNavigationInput,
): NormalizedWheelNavigation {
  const scale = input.deltaMode === 1
    ? LINE_HEIGHT_PX
    : input.deltaMode === 2
      ? Math.max(1, input.viewportHeight)
      : 1;
  let deltaX = clamp(input.deltaX * scale, -MAX_WHEEL_DELTA_PX, MAX_WHEEL_DELTA_PX);
  let deltaY = clamp(input.deltaY * scale, -MAX_WHEEL_DELTA_PX, MAX_WHEEL_DELTA_PX);

  if (input.shiftKey && Math.abs(deltaX) < 0.01) {
    deltaX = deltaY;
    deltaY = 0;
  }

  const hasZoomModifier = input.ctrlKey || input.metaKey;
  const isDiscreteWheel = input.deltaMode !== 0;
  const hasDiagonalMotion = Math.abs(deltaX) > 0.01;
  const isSmallPixelGesture = Math.max(Math.abs(deltaX), Math.abs(deltaY)) < TRACKPAD_PIXEL_DELTA_PX;
  const mode: WheelNavigationMode = hasZoomModifier || isDiscreteWheel || (!hasDiagonalMotion && !isSmallPixelGesture)
    ? "zoom"
    : "pan";

  return { mode, deltaX, deltaY };
}

export function applyWheelNavigation(
  camera: Camera2D,
  navigation: NormalizedWheelNavigation,
  cursor: ScreenPoint,
): Camera2D {
  if (navigation.mode === "pan") {
    return {
      ...camera,
      panX: camera.panX - navigation.deltaX,
      panY: camera.panY - navigation.deltaY,
    };
  }

  const factor = clamp(Math.exp(-navigation.deltaY * 0.0022), 0.72, 1.38);
  return zoomCameraAtPoint(camera, cursor, camera.zoom * factor);
}

export function mergeWheelNavigation(
  current: NormalizedWheelNavigation | null,
  next: NormalizedWheelNavigation,
): NormalizedWheelNavigation {
  if (!current || current.mode !== next.mode) return next;
  return {
    mode: current.mode,
    deltaX: clamp(current.deltaX + next.deltaX, -MAX_WHEEL_DELTA_PX, MAX_WHEEL_DELTA_PX),
    deltaY: clamp(current.deltaY + next.deltaY, -MAX_WHEEL_DELTA_PX, MAX_WHEEL_DELTA_PX),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
