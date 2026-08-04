import { describe, expect, it } from "vitest";
import { createPreviewPlacement, type PatternPiece } from "../domain/pattern";
import { createDefaultFabricSource } from "../domain/fabric";
import { dressedPosition, patternPanelContour, resolvePreviewPlacements } from "./ThreeViewport";

describe("garment panel projection", () => {
  it("wraps torso panels over the mannequin instead of keeping them planar", () => {
    const metrics = { heightScale: 1, floorY: 0, hipY: 0.9, waistY: 1.1, shoulderY: 1.5, headY: 1.8, chestRadius: 0.25, waistRadius: 0.2, hipRadius: 0.27, depthScale: 0.8, shoulderHalf: 0.3, armRadius: 0.08, armCenterY: 1.2, armLength: 0.6, legRadius: 0.1, legCenterX: 0.12, legCenterY: 0.5, legLength: 0.8 };
    const placement = createPreviewPlacement("piece", { region: "torso", rotationDeg: 25, offsetZMm: 12, scale: 1.2 });
    const points = [[-0.2, 0], [0.2, 0], [0.2, -0.4], [-0.2, -0.4]].map(([x, y]) => dressedPosition(x, y, placement, metrics, createDefaultFabricSource()));
    expect(new Set(points.map((point) => point.z.toFixed(8))).size).toBeGreaterThan(1);
    expect(points.every((point) => Number.isFinite(point.x + point.y + point.z))).toBe(true);
  });

  it("preserves semantic duplicate placements instead of replacing them with one assembly entry", () => {
    const left = createPreviewPlacement("sleeve", { region: "arm", bodySide: "left" });
    const right = createPreviewPlacement("sleeve", { region: "arm", bodySide: "right", mirrorX: true });
    const piece = { id: "sleeve", previewPlacements: [left, right] } as PatternPiece;
    const placements = resolvePreviewPlacements(piece, { assemblyPlacements: [{ pieceId: "sleeve", role: "sleeve", outwardSide: "front", positionMm: [180, 120, 90], rotationDeg: [0, 0, 0], flipped: false, source: "template" }] });
    expect(placements).toHaveLength(2);
    expect(placements.map((placement) => placement.bodySide)).toEqual(["left", "right"]);
    expect(placements.map((placement) => placement.offsetXMm)).toEqual([0, 0]);
  });

  it("unfolds pieces cut on the fold before triangulating the 3D panel", () => {
    const piece = { id: "front", name: "Front", seamAllowanceMm: 10, cutOnFold: true, points: [
      { id: "top-fold", xMm: 0, yMm: 0 },
      { id: "outer-top", xMm: 200, yMm: 0 },
      { id: "outer-bottom", xMm: 240, yMm: 500 },
      { id: "bottom-fold", xMm: 0, yMm: 500 },
    ] } as PatternPiece;
    const contour = patternPanelContour(piece);
    expect(Math.min(...contour.map((point) => point.xMm))).toBe(-240);
    expect(Math.max(...contour.map((point) => point.xMm))).toBe(240);
  });
});
