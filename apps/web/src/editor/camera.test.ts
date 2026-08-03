import { describe, expect, it } from "vitest";
import { cameraFromGesture, cameraToFitBounds, clampZoom, panCamera, zoomCameraAtPoint } from "./camera";

describe("camera gestures", () => {
  it("keeps the world point under the gesture center while zooming", () => {
    const camera = cameraFromGesture(
      { zoom: 1, panX: 100, panY: 50 },
      { x: 200, y: 150 },
      { x: 200, y: 150 },
      2,
    );

    expect(camera).toEqual({ zoom: 2, panX: 0, panY: -50 });
  });

  it("combines pinch zoom and pan", () => {
    const camera = cameraFromGesture(
      { zoom: 1, panX: 0, panY: 0 },
      { x: 100, y: 100 },
      { x: 130, y: 120 },
      1.5,
    );

    expect(camera).toEqual({ zoom: 1.5, panX: -20, panY: -30 });
  });

  it("limits zoom to the supported range", () => {
    expect(clampZoom(0.01)).toBe(0.15);
    expect(clampZoom(10)).toBe(3);
  });

  it("fits a tall pattern inside a compact viewport", () => {
    const camera = cameraToFitBounds(
      { minX: 50, minY: 0, maxX: 350, maxY: 1000 },
      { width: 360, height: 520 },
      40,
    );

    expect(camera.zoom).toBeCloseTo(0.44);
    expect(50 * camera.zoom + camera.panX).toBeGreaterThanOrEqual(40);
    expect(1000 * camera.zoom + camera.panY).toBeLessThanOrEqual(480);
  });

  it("zooms in and out without moving the world point under the cursor", () => {
    const camera = { zoom: 1, panX: 20, panY: 30 };
    const cursor = { x: 220, y: 130 };
    const zoomed = zoomCameraAtPoint(camera, cursor, 1.5);
    expect((cursor.x - zoomed.panX) / zoomed.zoom).toBeCloseTo(200);
    expect((cursor.y - zoomed.panY) / zoomed.zoom).toBeCloseTo(100);
    expect(zoomCameraAtPoint(zoomed, cursor, 1).panX).toBeCloseTo(20);
  });

  it("pans by the requested screen delta", () => {
    expect(panCamera({ zoom: 1, panX: 10, panY: 20 }, 15, -8)).toEqual({ zoom: 1, panX: 25, panY: 12 });
  });
});
