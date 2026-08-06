import { describe, expect, it } from "vitest";
import {
  advanceClothSimulation,
  createClothSimulationState,
  disposeClothSimulation,
  pauseClothSimulation,
  resetClothSimulation,
  startClothSimulation,
  stepClothSimulation,
  type AnchorConstraintBuffer,
  type ClothConstraintBuffers,
  type ClothSimulationInput,
  type DistanceConstraintBuffer,
  type InterpolatedConstraintBuffer,
} from "./clothXpbd";

function distanceBuffer(
  constraints: Array<{ a: number; b: number; restLength: number; compliance?: number }> = [],
): DistanceConstraintBuffer {
  return {
    a: Uint32Array.from(constraints.map((item) => item.a)),
    b: Uint32Array.from(constraints.map((item) => item.b)),
    restLength: Float32Array.from(constraints.map((item) => item.restLength)),
    compliance: Float32Array.from(constraints.map((item) => item.compliance ?? 0)),
    lambda: new Float32Array(constraints.length),
  };
}

function stitchBuffer(
  constraints: Array<{
    a: Array<[number, number]>;
    b: Array<[number, number]>;
    restDistance?: number;
    compliance?: number;
  }> = [],
): InterpolatedConstraintBuffer {
  const aIndices = new Uint32Array(constraints.length * 2);
  const aWeights = new Float32Array(constraints.length * 2);
  const bIndices = new Uint32Array(constraints.length * 2);
  const bWeights = new Float32Array(constraints.length * 2);
  constraints.forEach((constraint, index) => {
    for (let slot = 0; slot < 2; slot += 1) {
      aIndices[index * 2 + slot] = constraint.a[slot]?.[0] ?? constraint.a[0][0];
      aWeights[index * 2 + slot] = constraint.a[slot]?.[1] ?? 0;
      bIndices[index * 2 + slot] = constraint.b[slot]?.[0] ?? constraint.b[0][0];
      bWeights[index * 2 + slot] = constraint.b[slot]?.[1] ?? 0;
    }
  });
  return {
    aIndices,
    aWeights,
    bIndices,
    bWeights,
    restDistance: Float32Array.from(constraints.map((item) => item.restDistance ?? 0)),
    compliance: Float32Array.from(constraints.map((item) => item.compliance ?? 0)),
    lambda: new Float32Array(constraints.length),
  };
}

function anchorBuffer(
  anchors: Array<{ particle: number; target: [number, number, number]; compliance?: number }> = [],
): AnchorConstraintBuffer {
  return {
    particle: Uint32Array.from(anchors.map((item) => item.particle)),
    target: Float32Array.from(anchors.flatMap((item) => item.target)),
    compliance: Float32Array.from(anchors.map((item) => item.compliance ?? 0)),
    lambda: new Float32Array(anchors.length),
  };
}

function input(
  positions: number[],
  overrides: Partial<ClothConstraintBuffers> = {},
  inverseMasses?: number[],
): ClothSimulationInput {
  const particleCount = positions.length / 3;
  const empty = distanceBuffer();
  return {
    positions: Float32Array.from(positions),
    inverseMasses: Float32Array.from(inverseMasses ?? Array(particleCount).fill(1)),
    restPositions2D: new Float32Array(particleCount * 2),
    materialCoordinates: new Float32Array(particleCount * 2),
    triangles: particleCount >= 3 ? Uint32Array.from([0, 1, 2]) : new Uint32Array(),
    constraints: {
      warp: overrides.warp ?? empty,
      weft: overrides.weft ?? distanceBuffer(),
      shear: overrides.shear ?? distanceBuffer(),
      bend: overrides.bend ?? distanceBuffer(),
      stitches: overrides.stitches ?? stitchBuffer(),
      anchors: overrides.anchors ?? anchorBuffer(),
    },
  };
}

function runDeterministicScene(): Float32Array {
  const state = createClothSimulationState(input(
    [0, 1, 0, 1, 1, 0, 0, 0, 0],
    {
      warp: distanceBuffer([
        { a: 0, b: 1, restLength: 1 },
        { a: 0, b: 2, restLength: 1 },
        { a: 1, b: 2, restLength: Math.SQRT2 },
      ]),
      anchors: anchorBuffer([{ particle: 0, target: [0, 1, 0] }]),
    },
  ));
  startClothSimulation(state);
  for (let frame = 0; frame < 600; frame += 1) {
    advanceClothSimulation(state, 1 / 60);
  }
  return state.positions;
}

describe("cloth XPBD", () => {
  it("integrates gravity with a fixed semi-step independent of render delta", () => {
    const a = createClothSimulationState(input([0, 1, 0]));
    const b = createClothSimulationState(input([0, 1, 0]));
    startClothSimulation(a);
    startClothSimulation(b);
    for (let frame = 0; frame < 60; frame += 1) advanceClothSimulation(a, 1 / 60);
    for (let frame = 0; frame < 30; frame += 1) advanceClothSimulation(b, 1 / 30);
    expect(a.positions[1]).toBeLessThan(1);
    expect(b.positions[1]).toBeCloseTo(a.positions[1], 5);
    expect([...a.positions].every(Number.isFinite)).toBe(true);
  });

  it("keeps an anchored point fixed while the remaining cloth falls", () => {
    const state = createClothSimulationState(input(
      [0, 1, 0, 0, 0, 0],
      {
        warp: distanceBuffer([{ a: 0, b: 1, restLength: 1 }]),
        anchors: anchorBuffer([{ particle: 0, target: [0, 1, 0] }]),
      },
    ));
    startClothSimulation(state);
    for (let frame = 0; frame < 120; frame += 1) advanceClothSimulation(state, 1 / 60);
    expect(state.positions[1]).toBeCloseTo(1, 4);
    expect(state.positions[4]).toBeLessThan(0.1);
    expect(Math.hypot(
      state.positions[3] - state.positions[0],
      state.positions[4] - state.positions[1],
      state.positions[5] - state.positions[2],
    )).toBeCloseTo(1, 2);
  });

  it("solves interpolated stitches rather than collapsing to representative vertices", () => {
    const state = createClothSimulationState(input(
      [0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0],
      {
        stitches: stitchBuffer([{
          a: [[0, 0.5], [1, 0.5]],
          b: [[2, 0.25], [3, 0.75]],
          restDistance: 0,
        }]),
      },
    ));
    stepClothSimulation(state, { gravity: [0, 0, 0], iterations: 16 });
    const midpointA = (state.positions[0] + state.positions[3]) / 2;
    const pointB = state.positions[6] * 0.25 + state.positions[9] * 0.75;
    expect(Math.abs(midpointA - pointB)).toBeLessThan(0.05);
  });

  it("is deterministic across thousands of fixed steps", () => {
    const a = runDeterministicScene();
    const b = runDeterministicScene();
    expect([...a]).toEqual([...b]);
    expect([...a].every(Number.isFinite)).toBe(true);
  });

  it("supports pause, single step, resume, reset and dispose", () => {
    const state = createClothSimulationState(input([0, 1, 0]));
    const paused = advanceClothSimulation(state, 1);
    expect(paused.simulatedSteps).toBe(0);
    const stepped = stepClothSimulation(state);
    expect(stepped.simulatedSteps).toBe(1);
    const afterStep = state.positions[1];
    startClothSimulation(state);
    advanceClothSimulation(state, 1 / 60);
    expect(state.positions[1]).toBeLessThan(afterStep);
    pauseClothSimulation(state);
    const pausedY = state.positions[1];
    advanceClothSimulation(state, 1);
    expect(state.positions[1]).toBe(pausedY);
    resetClothSimulation(state);
    expect(state.positions[1]).toBe(1);
    disposeClothSimulation(state);
    expect(() => stepClothSimulation(state)).toThrow("descartada");
  });

  it("rolls back instead of publishing a corrupted mesh", () => {
    const state = createClothSimulationState(input([0, 1, 0]));
    state.velocities[0] = Number.NaN;
    const report = stepClothSimulation(state);
    expect(report.unstable).toBe(true);
    expect(report.rolledBack).toBe(true);
    expect([...state.positions]).toEqual([0, 1, 0]);
    expect([...state.positions].every(Number.isFinite)).toBe(true);
  });
});
