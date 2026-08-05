import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM } from "./camera";
import {
  applyWheelNavigation,
  mergeWheelNavigation,
  normalizeWheelNavigation,
} from "./canvasWheelNavigation";

const viewportHeight = 800;

describe("canvas wheel navigation", () => {
  it("normalizes pixel, line and page deltaMode", () => {
    expect(normalizeWheelNavigation({ deltaX: 2, deltaY: 3, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, viewportHeight }))
      .toEqual({ mode: "pan", deltaX: 2, deltaY: 3 });
    expect(normalizeWheelNavigation({ deltaX: 0, deltaY: 2, deltaMode: 1, ctrlKey: false, metaKey: false, shiftKey: false, viewportHeight }))
      .toEqual({ mode: "zoom", deltaX: 0, deltaY: 32 });
    expect(normalizeWheelNavigation({ deltaX: 0, deltaY: 1, deltaMode: 2, ctrlKey: false, metaKey: false, shiftKey: false, viewportHeight }))
      .toEqual({ mode: "zoom", deltaX: 0, deltaY: 180 });
  });

  it("treats small and diagonal pixel deltas as smooth trackpad pan", () => {
    const navigation = normalizeWheelNavigation({ deltaX: 5.5, deltaY: -3.25, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, viewportHeight });
    expect(navigation.mode).toBe("pan");
    expect(applyWheelNavigation({ zoom: 1, panX: 100, panY: 80 }, navigation, { x: 50, y: 50 }))
      .toEqual({ zoom: 1, panX: 94.5, panY: 83.25 });
  });

  it("clamps large deltas and zooms around the pointer", () => {
    const navigation = normalizeWheelNavigation({ deltaX: 0, deltaY: -1000, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, viewportHeight });
    expect(navigation).toEqual({ mode: "zoom", deltaX: 0, deltaY: -180 });
    const cursor = { x: 250, y: 180 };
    const before = { zoom: 1, panX: 40, panY: 30 };
    const worldBefore = { x: (cursor.x - before.panX) / before.zoom, y: (cursor.y - before.panY) / before.zoom };
    const after = applyWheelNavigation(before, navigation, cursor);
    expect((cursor.x - after.panX) / after.zoom).toBeCloseTo(worldBefore.x, 8);
    expect((cursor.y - after.panY) / after.zoom).toBeCloseTo(worldBefore.y, 8);
  });

  it("uses ctrl or meta pixel wheel as pinch zoom", () => {
    expect(normalizeWheelNavigation({ deltaX: 3, deltaY: 4, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false, viewportHeight }).mode).toBe("zoom");
    expect(normalizeWheelNavigation({ deltaX: 3, deltaY: 4, deltaMode: 0, ctrlKey: false, metaKey: true, shiftKey: false, viewportHeight }).mode).toBe("zoom");
  });

  it("respects camera zoom limits", () => {
    const cursor = { x: 100, y: 100 };
    const zoomIn = applyWheelNavigation({ zoom: MAX_ZOOM, panX: 0, panY: 0 }, { mode: "zoom", deltaX: 0, deltaY: -180 }, cursor);
    const zoomOut = applyWheelNavigation({ zoom: MIN_ZOOM, panX: 0, panY: 0 }, { mode: "zoom", deltaX: 0, deltaY: 180 }, cursor);
    expect(zoomIn.zoom).toBe(MAX_ZOOM);
    expect(zoomOut.zoom).toBe(MIN_ZOOM);
  });

  it("merges high-frequency wheel input without exceeding a frame budget", () => {
    const merged = mergeWheelNavigation(
      { mode: "pan", deltaX: 130, deltaY: 120 },
      { mode: "pan", deltaX: 130, deltaY: 120 },
    );
    expect(merged).toEqual({ mode: "pan", deltaX: 180, deltaY: 180 });
  });
});
