import { describe, expect, it } from "vitest";
import {
  advanceXpbd,
  createXpbdState,
  DEFAULT_XPBD_CONFIG,
  solveDistanceConstraints,
  type LegacyXpbdState,
  type XpbdState,
} from "./xpbd";

describe("XPBD distance constraint", () => {
  it("moves two free particles toward the rest length", () => {
    const state: LegacyXpbdState = {
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
    const state: LegacyXpbdState = {
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
    const state: LegacyXpbdState = {
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

describe("XPBD dynamic core", () => {
  it("applies gravity to a free panel with a fixed timestep", () => {
    const state = dynamicState([0, 1, 0, 1, 1, 0, 0, 0, 0]);
    const initialY = state.positions[1];

    for (let frame = 0; frame < 60; frame += 1) advanceXpbd(state, 1 / 60);

    expect(state.positions[1]).toBeLessThan(initialY - 0.5);
    expect(state.stepCount).toBe(120);
    expect(state.invalid).toBe(false);
  });

  it("keeps a pinned point fixed while the remaining cloth falls", () => {
    const state = dynamicState([0, 1, 0, 1, 1, 0, 0, 0, 0], [0]);

    for (let frame = 0; frame < 30; frame += 1) advanceXpbd(state, 1 / 60);

    expect([...state.positions.slice(0, 3)]).toEqual([0, 1, 0]);
    expect(state.positions[4]).toBeLessThan(1);
  });

  it("is deterministic for identical buffers and deltas", () => {
    const first = dynamicState([0, 1, 0, 1, 1, 0, 0, 0, 0], [0]);
    const second = dynamicState([0, 1, 0, 1, 1, 0, 0, 0, 0], [0]);
    for (let frame = 0; frame < 90; frame += 1) {
      advanceXpbd(first, 1 / 60);
      advanceXpbd(second, 1 / 60);
    }
    expect([...first.positions]).toEqual([...second.positions]);
  });

  it("clamps a large frame delta and remains finite", () => {
    const state = dynamicState([0, 1, 0, 1, 1, 0, 0, 0, 0]);
    const diagnostics = advanceXpbd(state, 4);
    expect(diagnostics.substeps).toBeLessThanOrEqual(state.config.maximumSubsteps);
    expect(diagnostics.droppedTimeSeconds).toBeGreaterThan(3.9);
    expect([...state.positions].every(Number.isFinite)).toBe(true);
  });

  it("restores stretch length with XPBD compliance", () => {
    const state = dynamicState([0, 0, 0, 2, 0, 0], [], {
      gravity: [0, 0, 0],
      distanceIndices: [0, 1],
      distanceRestLengths: [1],
      distanceCompliances: [0],
      distanceKinds: [0],
    });
    advanceXpbd(state, 1 / 60);
    expect(Math.abs(state.positions[3] - state.positions[0])).toBeCloseTo(1, 5);
  });

  it("resolves shear independently from edge stretch", () => {
    const state = dynamicState([0, 0, 0, 1, 0, 0, 0.65, 1, 0], [0], {
      gravity: [0, 0, 0],
      shearIndices: [0, 1, 2],
      shearRestCosines: [0],
      shearCompliances: [0],
    });
    for (let frame = 0; frame < 10; frame += 1) advanceXpbd(state, 1 / 60);
    const e1 = [state.positions[3] - state.positions[0], state.positions[4] - state.positions[1]];
    const e2 = [state.positions[6] - state.positions[0], state.positions[7] - state.positions[1]];
    const cosine = (e1[0] * e2[0] + e1[1] * e2[1]) / (Math.hypot(...e1) * Math.hypot(...e2));
    expect(Math.abs(cosine)).toBeLessThan(0.02);
  });

  it("uses a stable bend spring across adjacent triangles", () => {
    const state = dynamicState([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1], [0, 1, 2], {
      gravity: [0, 0, 0],
      distanceIndices: [0, 3],
      distanceRestLengths: [Math.SQRT2],
      distanceCompliances: [0.00001],
      distanceKinds: [1],
    });
    const initial = Math.hypot(
      state.positions[9] - state.positions[0],
      state.positions[10] - state.positions[1],
      state.positions[11] - state.positions[2],
    );
    for (let frame = 0; frame < 20; frame += 1) advanceXpbd(state, 1 / 60);
    const final = Math.hypot(
      state.positions[9] - state.positions[0],
      state.positions[10] - state.positions[1],
      state.positions[11] - state.positions[2],
    );
    expect(Math.abs(final - Math.SQRT2)).toBeLessThan(Math.abs(initial - Math.SQRT2));
    expect([...state.positions].every(Number.isFinite)).toBe(true);
  });

  it("closes an interpolated seam from a spatial residual", () => {
    const state = dynamicState([0, 0, 0, 0.8, -0.2, 0, 0.8, 0.2, 0], [0], {
      gravity: [0, 0, 0],
      seamIndices: [0, 0xffffffff, 1, 2],
      seamWeights: [1, 0, 0.5, 0.5],
      seamRestDistances: [0.001],
      seamCompliances: [0],
    });
    const initialMidpointX = (state.positions[3] + state.positions[6]) / 2;
    for (let frame = 0; frame < 12; frame += 1) advanceXpbd(state, 1 / 60);
    const finalMidpointX = (state.positions[3] + state.positions[6]) / 2;
    expect(finalMidpointX).toBeLessThan(initialMidpointX * 0.05);
    expect(Math.abs(state.positions[4] + state.positions[7])).toBeLessThan(1e-5);
  });

  it("transmits seam force to particles on both sides", () => {
    const state = dynamicState([0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0], [], {
      gravity: [0, 0, 0],
      seamIndices: [0, 1, 2, 3],
      seamWeights: [0.5, 0.5, 0.5, 0.5],
      seamRestDistances: [0],
      seamCompliances: [0],
    });
    advanceXpbd(state, 1 / 60);
    expect(state.positions[0]).toBeGreaterThan(0);
    expect(state.positions[3]).toBeGreaterThan(0);
    expect(state.positions[6]).toBeLessThan(1);
    expect(state.positions[9]).toBeLessThan(1);
  });

  it("keeps a cycle of seam constraints finite and deterministic", () => {
    const overrides: DynamicOverrides = {
      gravity: [0, 0, 0],
      seamIndices: [
        0, 0xffffffff, 1, 0xffffffff,
        1, 0xffffffff, 2, 0xffffffff,
        2, 0xffffffff, 0, 0xffffffff,
      ],
      seamWeights: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      seamRestDistances: [0.4, 0.4, 0.4],
      seamCompliances: [0.000001, 0.000001, 0.000001],
    };
    const first = dynamicState([0, 0, 0, 1, 0, 0, 0.5, 0.9, 0], [], overrides);
    const second = dynamicState([0, 0, 0, 1, 0, 0, 0.5, 0.9, 0], [], overrides);
    for (let frame = 0; frame < 120; frame += 1) {
      advanceXpbd(first, 1 / 60);
      advanceXpbd(second, 1 / 60);
    }
    expect([...first.positions]).toEqual([...second.positions]);
    expect([...first.positions].every(Number.isFinite)).toBe(true);
  });
});

interface DynamicOverrides {
  gravity?: [number, number, number];
  distanceIndices?: number[];
  distanceRestLengths?: number[];
  distanceCompliances?: number[];
  distanceKinds?: number[];
  shearIndices?: number[];
  shearRestCosines?: number[];
  shearCompliances?: number[];
  seamIndices?: number[];
  seamWeights?: number[];
  seamRestDistances?: number[];
  seamCompliances?: number[];
}

function dynamicState(values: number[], pins: number[] = [], overrides: DynamicOverrides = {}): XpbdState {
  const positions = Float32Array.from(values);
  const particleCount = positions.length / 3;
  const pinTargets = Float32Array.from(pins.flatMap((particle) => [
    positions[particle * 3], positions[particle * 3 + 1], positions[particle * 3 + 2],
  ]));
  const inverseMasses = new Float32Array(positions.length / 3).fill(1);
  for (const particle of pins) inverseMasses[particle] = 0;
  return createXpbdState({
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses,
    restPositions: new Float32Array(positions),
    materialCoordinates: Float32Array.from(Array.from({ length: particleCount }, (_, particle) => [
      positions[particle * 3], positions[particle * 3 + 1],
    ]).flat()),
    triangles: particleCount >= 3 ? new Uint32Array([0, 1, 2]) : new Uint32Array(),
    distances: {
      indices: Uint32Array.from(overrides.distanceIndices ?? []),
      restLengths: Float32Array.from(overrides.distanceRestLengths ?? []),
      compliances: Float32Array.from(overrides.distanceCompliances ?? []),
      lambdas: new Float32Array(overrides.distanceRestLengths?.length ?? 0),
      kinds: Uint8Array.from(overrides.distanceKinds ?? []),
    },
    shears: {
      indices: Uint32Array.from(overrides.shearIndices ?? []),
      restCosines: Float32Array.from(overrides.shearRestCosines ?? []),
      compliances: Float32Array.from(overrides.shearCompliances ?? []),
      lambdas: new Float32Array(overrides.shearRestCosines?.length ?? 0),
    },
    seams: {
      indices: Uint32Array.from(overrides.seamIndices ?? []),
      weights: Float32Array.from(overrides.seamWeights ?? []),
      restDistances: Float32Array.from(overrides.seamRestDistances ?? []),
      compliances: Float32Array.from(overrides.seamCompliances ?? []),
      relaxations: new Float32Array(overrides.seamRestDistances?.length ?? 0).fill(1),
      lambdas: new Float32Array(overrides.seamRestDistances?.length ?? 0),
      seamGroupIds: Array.from({ length: overrides.seamRestDistances?.length ?? 0 }, (_, index) => `seam-${index}`),
    },
    pins: { indices: Uint32Array.from(pins), targets: pinTargets },
    config: { ...DEFAULT_XPBD_CONFIG, gravity: overrides.gravity ?? DEFAULT_XPBD_CONFIG.gravity },
  });
}
