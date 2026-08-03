import { describe, expect, it } from "vitest";
import { createPreviewPlacement } from "../domain/pattern";
import { createDefaultFabricSource } from "../domain/fabric";
import { dressedPosition } from "./ThreeViewport";

describe("safe panel placement", () => {
  it("keeps a panel planar after rotation, offsets and scale", () => {
    const metrics = { heightScale: 1, floorY: 0, hipY: 0.9, waistY: 1.1, shoulderY: 1.5, headY: 1.8, chestRadius: 0.25, waistRadius: 0.2, hipRadius: 0.27, depthScale: 0.8, shoulderHalf: 0.3, armRadius: 0.08, armCenterY: 1.2, armLength: 0.6, legRadius: 0.1, legCenterX: 0.12, legCenterY: 0.5, legLength: 0.8 };
    const placement = createPreviewPlacement("piece", { region: "torso", rotationDeg: 25, offsetZMm: 12, scale: 1.2 });
    const points = [[-0.2, 0], [0.2, 0], [0.2, -0.4], [-0.2, -0.4]].map(([x, y]) => dressedPosition(x, y, placement, metrics, createDefaultFabricSource()));
    expect(new Set(points.map((point) => point.z.toFixed(8))).size).toBe(1);
    expect(points.every((point) => Number.isFinite(point.x + point.y + point.z))).toBe(true);
  });
});
