import { describe, expect, it } from "vitest";
import { solveDistanceConstraints, XpbdState } from "./xpbd";

describe("XPBD distance constraint", () => {
  it("moves two free particles toward the rest length", () => {
    const state: XpbdState = {
      positions: new Float32Array([0, 0, 0, 2, 0, 0]),
      previousPositions: new Float32Array([0, 0, 0, 2, 0, 0]),
      inverseMasses: new Float32Array([1, 1]),
      constraints: [{ a: 0, b: 1, restLength: 1, compliance: 0, lambda: 0 }],
    };

    solveDistanceConstraints(state, 1 / 60, 1);
    const distance = state.positions[3] - state.positions[0];
    expect(distance).toBeCloseTo(1, 5);
  });
});
