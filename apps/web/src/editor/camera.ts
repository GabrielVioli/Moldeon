export interface Camera2D {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function cameraFromGesture(
  startCamera: Camera2D,
  startCenter: ScreenPoint,
  currentCenter: ScreenPoint,
  scale: number,
): Camera2D {
  const nextZoom = clampZoom(startCamera.zoom * scale);
  const worldX = (startCenter.x - startCamera.panX) / startCamera.zoom;
  const worldY = (startCenter.y - startCamera.panY) / startCamera.zoom;

  return {
    zoom: nextZoom,
    panX: currentCenter.x - worldX * nextZoom,
    panY: currentCenter.y - worldY * nextZoom,
  };
}
