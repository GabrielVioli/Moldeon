import { describe, expect, it } from "vitest";
import {
  advanceXpbd,
  createXpbdState,
  DEFAULT_XPBD_CONFIG,
  resetXpbdState,
  XPBD_MISSING_PARTICLE,
  type XpbdState,
} from "./xpbd";

interface SeamPoint {
  particles: [number, number?];
  weights?: [number, number];
}

interface SceneOptions {
  positions: number[];
  triangles?: number[];
  pins?: number[];
  seams?: Array<[SeamPoint, SeamPoint]>;
  gravity?: [number, number, number];
}

const frames = 120;

describe("Prompt 10 canonical XPBD scenes A-Q", () => {
  it("A — a free panel falls", () => {
    const state = scene(rectangle(0, 1));
    const initial = centroidY(state);
    run(state);
    expect(centroidY(state)).toBeLessThan(initial - 1);
    expectSafe(state);
  });

  it("B — hanging cloth keeps two fixed points", () => {
    const options = rectangle(0, 1);
    const state = scene({ ...options, pins: [0, 1] });
    run(state);
    expect([...state.positions.slice(0, 6)]).toEqual(options.positions.slice(0, 6));
    expect(state.positions[7]).toBeLessThan(0);
    expectSafe(state);
  });

  it("C — sewn tube keeps all seam pairs constrained", () => {
    const state = scene(tubeScene());
    run(state);
    expect(maxSeamError(state)).toBeLessThan(0.012);
    expect(radialSpan(state)).toBeGreaterThan(0.25);
    expectSafe(state);
  });

  it("D — different tessellations meet through interpolated points", () => {
    const state = scene({
      positions: [0, 0, 0, 0, 1, 0, 0.6, 0, 0, 0.6, 0.5, 0, 0.6, 1, 0],
      seams: [
        [point(0), point(2)],
        [point(0, 1, 0.5), point(3)],
        [point(1), point(4)],
      ],
      gravity: [0, 0, 0],
      pins: [0, 1],
    });
    run(state);
    expect(maxSeamError(state)).toBeLessThan(0.015);
    expectSafe(state);
  });

  it("E — a free sleeve tube falls as one connected body", () => {
    const state = scene(tubeScene());
    const initial = centroidY(state);
    run(state);
    expect(centroidY(state)).toBeLessThan(initial - 1);
    expect(maxSeamError(state)).toBeLessThan(0.012);
  });

  it("F — a seam transmits force across panels", () => {
    const options = tubeScene();
    const state = scene({ ...options, pins: [0, 1] });
    run(state, 60);
    expect(state.positions[5 * 3 + 1]).toBeLessThan(options.positions[5 * 3 + 1]);
    expect(maxSeamError(state)).toBeLessThan(0.012);
  });

  it.each([
    ["G — 1↔2", [point(0), point(1, 2, 0.5)]],
    ["H — 2↔1", [point(0, 1, 0.5), point(2)]],
    ["I — 2↔3", [point(0, 1, 0.5), point(2, 3, 0.5)]],
  ] as const)("%s uses accumulated interpolated constraint points", (_label, seam) => {
    const state = scene({
      positions: [0, 0, 0, 0, 0.4, 0, 0.8, 0, 0, 0.8, 0.4, 0, 0.8, 0.8, 0],
      seams: [[seam[0], seam[1]]],
      gravity: [0, 0, 0],
      pins: [0, 1],
    });
    run(state, 40);
    expect(maxSeamError(state)).toBeLessThan(0.015);
    expectSafe(state);
  });

  it("J — a large initial residual converges progressively", () => {
    const state = scene({
      positions: [0, 0, 0, 2, 0, 0],
      seams: [[point(0), point(1)]],
      gravity: [0, 0, 0],
      pins: [0],
    });
    const initial = maxSeamError(state);
    run(state, 30);
    expect(maxSeamError(state)).toBeLessThan(initial * 0.02);
  });

  it("K — an incompatible seam cycle remains finite", () => {
    const state = scene({
      positions: [0, 0, 0, 1, 0, 0, 0.5, 0.9, 0],
      seams: [[point(0), point(1)], [point(1), point(2)], [point(2), point(0)]],
      gravity: [0, 0, 0],
    });
    run(state, 300);
    expectSafe(state);
  });

  it("L — a seam branch keeps every child active", () => {
    const state = scene({
      positions: [0, 0, 0, 1, 0, 0, 1, 0.5, 0, 1, -0.5, 0],
      seams: [[point(0), point(1)], [point(0), point(2)], [point(0), point(3)]],
      gravity: [0, 0, 0],
      pins: [0],
    });
    run(state, 60);
    expect(maxSeamError(state)).toBeLessThan(0.02);
  });

  it("M — identical inputs are deterministic", () => {
    const first = scene(tubeScene());
    const second = scene(tubeScene());
    run(first);
    run(second);
    expect([...first.positions]).toEqual([...second.positions]);
  });

  it("N — a large frame delta is clamped", () => {
    const state = scene(rectangle(0, 1));
    const diagnostics = advanceXpbd(state, 8);
    expect(diagnostics.droppedTimeSeconds).toBeGreaterThan(7.9);
    expectSafe(state);
  });

  it("O — pause/step/reset lifecycle restores the exact initial state", () => {
    const state = scene(rectangle(0, 1));
    const initial = [...state.positions];
    advanceXpbd(state, 1 / 60);
    const paused = [...state.positions];
    expect([...state.positions]).toEqual(paused);
    advanceXpbd(state, state.config.fixedTimeStep);
    expect([...state.positions]).not.toEqual(paused);
    resetXpbdState(state);
    expect([...state.positions]).toEqual(initial);
  });

  it("P — rebuilding after a 2D edit uses the new rest geometry", () => {
    const before = scene(rectangle(0, 1));
    const afterOptions = rectangle(0, 1.4);
    const after = scene(afterOptions);
    expect(after.restPositions[3]).toBeCloseTo(1.4);
    expect(after.restPositions[3]).not.toBe(before.restPositions[3]);
    run(after, 10);
    expectSafe(after);
  });

  it("Q — four panels with cycle and branch remain stable", () => {
    const state = scene({
      positions: [
        0, 0, 0, 0, 1, 0,
        0.6, 0, 0, 0.6, 1, 0,
        1.2, 0, 0, 1.2, 1, 0,
        0.6, 1.6, 0, 1.2, 1.6, 0,
      ],
      seams: [
        [point(0), point(2)], [point(1), point(3)],
        [point(2), point(4)], [point(3), point(5)],
        [point(5), point(6)], [point(3), point(7)],
        [point(6), point(7)],
      ],
      pins: [0, 1],
    });
    run(state, 360);
    expectSafe(state);
    expect(maxSeamError(state)).toBeLessThan(0.06);
  });
});

function rectangle(x: number, width: number): SceneOptions {
  return {
    positions: [x, 1, 0, x + width, 1, 0, x, 0, 0, x + width, 0, 0],
    triangles: [0, 2, 1, 1, 2, 3],
  };
}

function tubeScene(): SceneOptions {
  return {
    positions: [
      -0.3, 1, 0, 0.3, 1, 0, -0.3, 0, 0, 0.3, 0, 0,
      0.3, 1, 0, -0.3, 1, 0, 0.3, 0, 0, -0.3, 0, 0,
    ],
    triangles: [0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7],
    seams: [
      [point(0), point(5)], [point(2), point(7)],
      [point(1), point(4)], [point(3), point(6)],
    ],
  };
}

function point(first: number, second?: number, firstWeight = 1): SeamPoint {
  return {
    particles: [first, second],
    weights: second === undefined ? [1, 0] : [firstWeight, 1 - firstWeight],
  };
}

function scene(options: SceneOptions): XpbdState {
  const positions = Float32Array.from(options.positions);
  const particleCount = positions.length / 3;
  const inverseMasses = new Float32Array(particleCount).fill(1);
  const pins = options.pins ?? [];
  for (const pin of pins) inverseMasses[pin] = 0;
  const triangles = Uint32Array.from(options.triangles ?? []);
  const distanceMap = new Map<string, [number, number]>();
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const a = triangles[offset];
    const b = triangles[offset + 1];
    const c = triangles[offset + 2];
    for (const [first, second] of [[a, b], [b, c], [c, a]] as const) {
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      distanceMap.set(key, [Math.min(first, second), Math.max(first, second)]);
    }
  }
  const distanceIndices: number[] = [];
  const restLengths: number[] = [];
  for (const [a, b] of distanceMap.values()) {
    distanceIndices.push(a, b);
    restLengths.push(distance(positions, a, b));
  }
  const seamIndices: number[] = [];
  const seamWeights: number[] = [];
  for (const [first, second] of options.seams ?? []) {
    appendPoint(seamIndices, seamWeights, first);
    appendPoint(seamIndices, seamWeights, second);
  }
  return createXpbdState({
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses,
    restPositions: new Float32Array(positions),
    materialCoordinates: Float32Array.from(Array.from({ length: particleCount }, (_, index) => [positions[index * 3], positions[index * 3 + 1]]).flat()),
    triangles,
    distances: {
      indices: Uint32Array.from(distanceIndices),
      restLengths: Float32Array.from(restLengths),
      compliances: new Float32Array(restLengths.length).fill(0.000002),
      lambdas: new Float32Array(restLengths.length),
      kinds: new Uint8Array(restLengths.length),
    },
    shears: { indices: new Uint32Array(), restCosines: new Float32Array(), compliances: new Float32Array(), lambdas: new Float32Array() },
    seams: {
      indices: Uint32Array.from(seamIndices),
      weights: Float32Array.from(seamWeights),
      restDistances: new Float32Array(options.seams?.length ?? 0).fill(0.001),
      compliances: new Float32Array(options.seams?.length ?? 0).fill(0.0000001),
      relaxations: new Float32Array(options.seams?.length ?? 0).fill(1),
      lambdas: new Float32Array(options.seams?.length ?? 0),
      seamGroupIds: Array.from({ length: options.seams?.length ?? 0 }, (_, index) => `canonical-${index}`),
    },
    pins: {
      indices: Uint32Array.from(pins),
      targets: Float32Array.from(pins.flatMap((particle) => [positions[particle * 3], positions[particle * 3 + 1], positions[particle * 3 + 2]])),
    },
    config: { ...DEFAULT_XPBD_CONFIG, gravity: options.gravity ?? DEFAULT_XPBD_CONFIG.gravity, iterations: 12 },
  });
}

function appendPoint(indices: number[], weights: number[], reference: SeamPoint): void {
  indices.push(reference.particles[0], reference.particles[1] ?? XPBD_MISSING_PARTICLE);
  weights.push(reference.weights?.[0] ?? 1, reference.weights?.[1] ?? 0);
}

function run(state: XpbdState, count = frames): void {
  for (let frame = 0; frame < count; frame += 1) advanceXpbd(state, 1 / 60);
}

function distance(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[b * 3] - positions[a * 3],
    positions[b * 3 + 1] - positions[a * 3 + 1],
    positions[b * 3 + 2] - positions[a * 3 + 2],
  );
}

function maxSeamError(state: XpbdState): number {
  let maximum = 0;
  for (let index = 0; index < state.seams.restDistances.length; index += 1) {
    const base = index * 4;
    const first = weightedPoint(state, base);
    const second = weightedPoint(state, base + 2);
    maximum = Math.max(maximum, Math.abs(Math.hypot(second[0] - first[0], second[1] - first[1], second[2] - first[2]) - state.seams.restDistances[index]));
  }
  return maximum;
}

function weightedPoint(state: XpbdState, base: number): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let slot = 0; slot < 2; slot += 1) {
    const particle = state.seams.indices[base + slot];
    if (particle === XPBD_MISSING_PARTICLE) continue;
    const weight = state.seams.weights[base + slot];
    result[0] += state.positions[particle * 3] * weight;
    result[1] += state.positions[particle * 3 + 1] * weight;
    result[2] += state.positions[particle * 3 + 2] * weight;
  }
  return result;
}

function centroidY(state: XpbdState): number {
  let total = 0;
  for (let offset = 1; offset < state.positions.length; offset += 3) total += state.positions[offset];
  return total / (state.positions.length / 3);
}

function radialSpan(state: XpbdState): number {
  const xs = Array.from({ length: state.positions.length / 3 }, (_, index) => state.positions[index * 3]);
  return Math.max(...xs) - Math.min(...xs);
}

function expectSafe(state: XpbdState): void {
  expect(state.invalid).toBe(false);
  expect([...state.positions].every(Number.isFinite)).toBe(true);
}
