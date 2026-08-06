import { describe, expect, it } from "vitest";
import {
  createClothSimulationState,
  stepClothSimulation,
  type ClothSimulationInput,
  type DistanceConstraintBuffer,
  type InterpolatedConstraintBuffer,
} from "./clothXpbd";

function distance(edges: Array<[number, number, number]>, compliance = 1e-8): DistanceConstraintBuffer {
  return {
    a: Uint32Array.from(edges.map((edge) => edge[0])),
    b: Uint32Array.from(edges.map((edge) => edge[1])),
    restLength: Float32Array.from(edges.map((edge) => edge[2])),
    compliance: new Float32Array(edges.length).fill(compliance),
    lambda: new Float32Array(edges.length),
  };
}

function stitch(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
  restDistance = 0,
): InterpolatedConstraintBuffer {
  const pad = (value: Array<[number, number]>) => value.length === 1 ? [value[0], [value[0][0], 0] as [number, number]] : value;
  const aa = pad(a);
  const bb = pad(b);
  return {
    aIndices: Uint32Array.from(aa.map((entry) => entry[0])),
    aWeights: Float32Array.from(aa.map((entry) => entry[1])),
    bIndices: Uint32Array.from(bb.map((entry) => entry[0])),
    bWeights: Float32Array.from(bb.map((entry) => entry[1])),
    restDistance: new Float32Array([restDistance]),
    compliance: new Float32Array([1e-9]),
    lambda: new Float32Array(1),
  };
}

function input(positions: number[], edges: Array<[number, number, number]>, stitches = stitch([[0, 1]], [[0, 1]], 0)): ClothSimulationInput {
  const particles = positions.length / 3;
  const empty = distance([]);
  return {
    positions: Float32Array.from(positions),
    inverseMasses: new Float32Array(particles).fill(1),
    restPositions2D: new Float32Array(particles * 2),
    triangles: new Uint32Array(0),
    materialCoordinates: new Float32Array(particles * 2),
    constraints: {
      warp: distance(edges),
      weft: empty,
      shear: distance([]),
      bend: distance([]),
      stitches,
      anchors: {
        particle: new Uint32Array(0),
        target: new Float32Array(0),
        compliance: new Float32Array(0),
        lambda: new Float32Array(0),
      },
    },
  };
}

describe("cloth XPBD canonical scenes", () => {
  it("keeps a free panel finite under gravity", () => {
    const state = createClothSimulationState(input(
      [0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0],
      [[0, 1, 1], [0, 2, 1], [1, 3, 1], [2, 3, 1], [0, 3, Math.SQRT2]],
    ));
    for (let i = 0; i < 240; i += 1) stepClothSimulation(state);
    expect([...state.positions].every(Number.isFinite)).toBe(true);
    expect(state.positions[1]).toBeLessThan(1);
  });

  it("closes a sewn tube without collapsing all particles to one vertex", () => {
    const state = createClothSimulationState(input(
      [-1, 1, 0, -1, 0, 0, 1, 1, 0, 1, 0, 0],
      [[0, 1, 1], [2, 3, 1]],
      stitch([[0, 0.5], [1, 0.5]], [[2, 0.5], [3, 0.5]]),
    ));
    for (let i = 0; i < 180; i += 1) stepClothSimulation(state, { gravity: [0, 0, 0] });
    const midpointA = (state.positions[0] + state.positions[3]) / 2;
    const midpointB = (state.positions[6] + state.positions[9]) / 2;
    expect(Math.abs(midpointA - midpointB)).toBeLessThan(0.05);
    expect(Math.abs(state.positions[1] - state.positions[4])).toBeGreaterThan(0.5);
  });

  it("supports unequal edge sampling and deliberate ease", () => {
    const state = createClothSimulationState(input(
      [0, 0, 0, 2, 0, 0, 0.25, 0.2, 0, 0.75, 0.2, 0],
      [[0, 1, 2], [2, 3, 0.5]],
      stitch([[0, 0.25], [1, 0.75]], [[2, 0.5], [3, 0.5]], 0.12),
    ));
    for (let i = 0; i < 180; i += 1) stepClothSimulation(state, { gravity: [0, 0, 0] });
    const ax = state.positions[0] * 0.25 + state.positions[3] * 0.75;
    const bx = state.positions[6] * 0.5 + state.positions[9] * 0.5;
    expect(Math.abs(Math.abs(ax - bx) - 0.12)).toBeLessThan(0.03);
  });

  it("keeps a sleeve-sized tube stable for thousands of fixed steps", () => {
    const state = createClothSimulationState(input(
      [-0.3, 1, 0, -0.2, 0, 0, 0.3, 1, 0, 0.2, 0, 0],
      [[0, 1, 1.005], [2, 3, 1.005], [0, 2, 0.6], [1, 3, 0.4]],
      stitch([[0, 0.5], [1, 0.5]], [[2, 0.5], [3, 0.5]]),
    ));
    for (let i = 0; i < 2_000; i += 1) stepClothSimulation(state, { gravity: [0, -1.5, 0] });
    expect([...state.positions].every(Number.isFinite)).toBe(true);
    expect(state.unstable).toBe(false);
  });
});
