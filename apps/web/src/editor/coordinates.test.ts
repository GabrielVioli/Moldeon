import { describe, expect, it } from "vitest";
import {
  pieceLocalToScreen,
  pieceLocalToWorld,
  pieceWorldToLocal,
  screenToPieceLocal,
} from "./coordinates";

describe("piece workspace coordinates", () => {
  const transform = { pieceId: "piece", xMm: 340, yMm: -80, rotationDeg: 37 };
  const camera = { zoom: 1.75, panX: 118, panY: 64 };
  const local = { xMm: 83.25, yMm: -21.5 };

  it("round-trips local to world to local", () => {
    const restored = pieceWorldToLocal(pieceLocalToWorld(local, transform), transform);
    expect(restored.xMm).toBeCloseTo(local.xMm, 10);
    expect(restored.yMm).toBeCloseTo(local.yMm, 10);
  });

  it("round-trips local to screen to local", () => {
    const restored = screenToPieceLocal(
      pieceLocalToScreen(local, transform, camera),
      transform,
      camera,
    );
    expect(restored.xMm).toBeCloseTo(local.xMm, 10);
    expect(restored.yMm).toBeCloseTo(local.yMm, 10);
  });
});
