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

  it("keeps fully fixed constraints finite", () => {
    const state: XpbdState = {
      positions: new Float32Array([0, 0, 0, 2, 0, 0]),
      previousPositions: new Float32Array([0, 0, 0, 2, 0, 0]),
      inverseMasses: new Float32Array([0, 0]),
      constraints: [
        { a: 0, b: 1, restLength: 1, compliance: 0, lambda: 0 },
      ],
    };

    solveDistanceConstraints(state, 1 / 60);

    expect([...state.positions]).toEqual([0, 0, 0, 2, 0, 0]);
    expect(state.constraints[0].lambda).toBe(0);
  });

  it("rejects an invalid simulation step", () => {
    const state: XpbdState = {
      positions: new Float32Array(),
      previousPositions: new Float32Array(),
      inverseMasses: new Float32Array(),
      constraints: [],
    };

    expect(() => solveDistanceConstraints(state, 0)).toThrow(
      "O passo da simulação precisa ser positivo e finito.",
    );
  });
});
