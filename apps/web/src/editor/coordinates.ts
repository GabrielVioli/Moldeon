import type { PatternPoint, PieceWorkspaceTransform } from "../domain/pattern";
import type { Camera2D, ScreenPoint } from "./camera";

export interface WorldPoint {
  xMm: number;
  yMm: number;
}

const IDENTITY_TRANSFORM: PieceWorkspaceTransform = {
  pieceId: "identity",
  xMm: 0,
  yMm: 0,
  rotationDeg: 0,
};

export function pieceLocalToWorld(
  point: Pick<PatternPoint, "xMm" | "yMm">,
  transform: PieceWorkspaceTransform = IDENTITY_TRANSFORM,
): WorldPoint {
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    xMm: point.xMm * cosine - point.yMm * sine + transform.xMm,
    yMm: point.xMm * sine + point.yMm * cosine + transform.yMm,
  };
}

export function pieceWorldToLocal(
  point: WorldPoint,
  transform: PieceWorkspaceTransform = IDENTITY_TRANSFORM,
): WorldPoint {
  const translatedX = point.xMm - transform.xMm;
  const translatedY = point.yMm - transform.yMm;
  const radians = (-transform.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    xMm: translatedX * cosine - translatedY * sine,
    yMm: translatedX * sine + translatedY * cosine,
  };
}

export function worldToScreen(point: WorldPoint, camera: Camera2D): ScreenPoint {
  return {
    x: point.xMm * camera.zoom + camera.panX,
    y: point.yMm * camera.zoom + camera.panY,
  };
}

export function screenToWorld(point: ScreenPoint, camera: Camera2D): WorldPoint {
  return {
    xMm: (point.x - camera.panX) / camera.zoom,
    yMm: (point.y - camera.panY) / camera.zoom,
  };
}

export function pieceLocalToScreen(
  point: Pick<PatternPoint, "xMm" | "yMm">,
  transform: PieceWorkspaceTransform,
  camera: Camera2D,
): ScreenPoint {
  return worldToScreen(pieceLocalToWorld(point, transform), camera);
}

export function screenToPieceLocal(
  point: ScreenPoint,
  transform: PieceWorkspaceTransform,
  camera: Camera2D,
): WorldPoint {
  return pieceWorldToLocal(screenToWorld(point, camera), transform);
}
