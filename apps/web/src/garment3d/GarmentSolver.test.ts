import { describe, expect, it } from "vitest";
import type { GarmentAssemblyState } from "./GarmentAssembly";
import { solveGarmentAssembly } from "./GarmentSolver";

function createState(): GarmentAssemblyState {
  const initialPositions = new Float32Array([
    -0.2, 0, 0.1,
    -0.2, -0.4, 0.1,
    0.2, 0, -0.1,
    0.2, -0.4, -0.1,
  ]);

  return {
    positions: new Float32Array(initialPositions),
    initialPositions,
    previousPositions: new Float32Array(initialPositions),
    inverseMasses: new Float32Array([1, 1, 1, 1]),
    instances: [],
    structuralConstraints: [
      {
        a: 0,
        b: 1,
        restLength: 0.4,
        stiffness: 1,
      },
      {
        a: 2,
        b: 3,
        restLength: 0.4,
        stiffness: 1,
      },
    ],
    stitchConstraints: [
      {
        id: "top",
        seamId: "side",
        a: { particleIndices: [0], weights: [1] },
        b: { particleIndices: [2], weights: [1] },
        restDistance: 0.001,
        stiffness: 0.9,
      },
      {
        id: "bottom",
        seamId: "side",
        a: { particleIndices: [1], weights: [1] },
        b: { particleIndices: [3], weights: [1] },
        restDistance: 0.001,
        stiffness: 0.9,
      },
    ],
    anchorConstraints: [],
    warnings: [],
    invalid: false,
  };
}

describe("GarmentSolver", () => {
  it("aproxima as duas bordas sem produzir valores inválidos", () => {
    const state = createState();
    const before = Math.hypot(
      state.positions[6] - state.positions[0],
      state.positions[7] - state.positions[1],
      state.positions[8] - state.positions[2],
    );

    const report = solveGarmentAssembly(state, {
      iterations: 80,
      structuralPasses: 2,
      stitchPasses: 3,
    });

    const after = Math.hypot(
      state.positions[6] - state.positions[0],
      state.positions[7] - state.positions[1],
      state.positions[8] - state.positions[2],
    );

    expect(report.invalid).toBe(false);
    expect(after).toBeLessThan(before);
    expect(Array.from(state.positions).every(Number.isFinite)).toBe(true);
  });

  it("resolve referências interpoladas", () => {
    const state = createState();
    state.stitchConstraints = [
      {
        id: "interpolated",
        seamId: "interpolated",
        a: {
          particleIndices: [0, 1],
          weights: [0.5, 0.5],
        },
        b: {
          particleIndices: [2, 3],
          weights: [0.5, 0.5],
        },
        restDistance: 0.001,
        stiffness: 0.9,
      },
    ];

    const report = solveGarmentAssembly(state, {
      iterations: 60,
    });

    expect(report.invalid).toBe(false);
    expect(Array.from(state.positions).every(Number.isFinite)).toBe(true);
  });
});
