export interface Camera2D {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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

export function cameraToFitBounds(
  bounds: WorldBounds,
  viewport: { width: number; height: number },
  padding = 48,
): Camera2D {
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clampZoom(
    Math.min(usableWidth / worldWidth, usableHeight / worldHeight),
  );
  const worldCenterX = (bounds.minX + bounds.maxX) / 2;
  const worldCenterY = (bounds.minY + bounds.maxY) / 2;

  return {
    zoom,
    panX: viewport.width / 2 - worldCenterX * zoom,
    panY: viewport.height / 2 - worldCenterY * zoom,
  };
}
