import { describe, expect, it } from "vitest";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { BodyMeasurements } from "../domain/pattern";
import { createBodyCollisionRuntimeState, packAvatarCollisionModel } from "./bodyCollision";
import { createXpbdState, measureXpbdDiagnostics, stepXpbd, type XpbdState } from "./xpbd";

const RUN_PERF = process.env.MOLDEON_BODY_TOTAL_PERF_BENCH === "1";
const ROWS = 70;
const COLS = 70;
const PARTICLES = ROWS * COLS; // 4900, matching the recorded ~4890-particle browser scene.
const TRIANGLE_COUNT = 7_792;
const STRETCH_COUNT = 12_678;
const BEND_COUNT = 10_698;
const SEAM_COUNT = 248;
const SPACING = 0.006;
const MEASUREMENTS: BodyMeasurements = {
  heightMm: 1720,
  bustMm: 920,
  waistMm: 760,
  hipMm: 980,
  shoulderWidthMm: 420,
  torsoLengthMm: 620,
  armLengthMm: 600,
  inseamMm: 800,
  bicepMm: 310,
  wristMm: 170,
  thighMm: 570,
  calfMm: 370,
  ankleCircumferenceMm: 225,
  kneeHeightMm: 450,
  hipHeightMm: 190,
  bustHeightMm: 250,
};

describe("Prompt 11 integrated XPBD/body performance", () => {
  it("keeps the ~4.9k-particle integrated workload finite with collision on", () => {
    const state = makeState(true);
    for (let step = 0; step < 3; step += 1) stepXpbd(state);
    const diagnostics = measureXpbdDiagnostics(state);
    expect(diagnostics.invalid).toBe(false);
    expect(diagnostics.particleCount).toBe(PARTICLES);
    expect(diagnostics.bodyColliderCount).toBe(12);
    expect(Number.isFinite(diagnostics.bodyCollisionMs)).toBe(true);
  });

  it.skipIf(!RUN_PERF)("prints total physicsStep before/after and bodyCollisionMs separately", () => {
    const off = profile(false);
    const reference = profile(true, true);
    const on = profile(true);
    const report = {
      particles: PARTICLES,
      triangles: on.counts.triangles,
      stretch: on.counts.stretch,
      shear: on.counts.shear,
      bend: on.counts.bend,
      seams: on.counts.seams,
      iterations: on.counts.iterations,
      bodyColliders: on.counts.bodyColliders,
      offMedianMs: off.totalMedianMs,
      referenceOnMedianMs: reference.totalMedianMs,
      referenceBodyCollisionMedianMs: reference.bodyMedianMs,
      referenceDeltaMedianMs: reference.totalMedianMs - off.totalMedianMs,
      onMedianMs: on.totalMedianMs,
      bodyCollisionMedianMs: on.bodyMedianMs,
      deltaMedianMs: on.totalMedianMs - off.totalMedianMs,
      overheadPercent: off.totalMedianMs > 0 ? (on.totalMedianMs / off.totalMedianMs - 1) * 100 : 0,
      bodyContactsMedian: on.contactsMedian,
      broadphaseRejectRate: on.broadphaseRejectRate,
      averageCandidatesPerParticle: on.averageCandidatesPerParticle,
    };
    console.log("MOLDEON_BODY_TOTAL_PERF " + JSON.stringify(report));
    expect(off.invalid).toBe(false);
    expect(on.invalid).toBe(false);
    expect(Number.isFinite(report.deltaMedianMs)).toBe(true);
  }, 60_000);
});

function profile(bodyEnabled: boolean, reference = false) {
  const state = makeState(bodyEnabled, reference);
  for (let warmup = 0; warmup < 4; warmup += 1) stepXpbd(state);
  const totals: number[] = [];
  const bodies: number[] = [];
  const contacts: number[] = [];
  for (let sample = 0; sample < 16; sample += 1) {
    stepXpbd(state);
    totals.push(state.profile.solverStepTotalMs);
    bodies.push(state.profile.bodyCollisionMs);
    contacts.push(state.body.bodyContactCount);
  }
  const diagnostics = measureXpbdDiagnostics(state);
  return {
    totalMedianMs: median(totals),
    bodyMedianMs: median(bodies),
    contactsMedian: median(contacts),
    invalid: diagnostics.invalid,
    broadphaseRejectRate: diagnostics.bodyBroadphaseRejectRate ?? 0,
    averageCandidatesPerParticle: diagnostics.bodyAverageCandidatesPerParticle ?? 0,
    counts: {
      triangles: diagnostics.triangleCount,
      stretch: diagnostics.stretchConstraintCount,
      shear: diagnostics.shearConstraintCount,
      bend: diagnostics.bendConstraintCount,
      seams: diagnostics.seamConstraintCount,
      iterations: diagnostics.iterations ?? 0,
      bodyColliders: diagnostics.bodyColliderCount ?? 0,
    },
  };
}

function makeState(bodyEnabled: boolean, reference = false): XpbdState {
  const positions = new Float32Array(PARTICLES * 3);
  const material = new Float32Array(PARTICLES * 2);
  const inverseMasses = new Float32Array(PARTICLES).fill(1);
  const width = (COLS - 1) * SPACING;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const particle = row * COLS + col;
      const offset = particle * 3;
      positions[offset] = col * SPACING - width * 0.5;
      positions[offset + 1] = 1.52 - row * SPACING;
      positions[offset + 2] = ((col + row) % 3 - 1) * 0.0001;
      material[particle * 2] = col * SPACING;
      material[particle * 2 + 1] = row * SPACING;
    }
  }

  const triangles: number[] = [];
  const structuralPairs: Array<[number, number]> = [];
  const shearTriples: Array<[number, number, number]> = [];
  for (let row = 0; row < ROWS - 1; row += 1) {
    for (let col = 0; col < COLS - 1; col += 1) {
      const a = row * COLS + col;
      const b = a + 1;
      const d = a + COLS;
      const e = d + 1;
      triangles.push(a, d, b, b, d, e);
      shearTriples.push([a, b, d], [e, d, b]);
    }
  }
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const a = row * COLS + col;
      if (col + 1 < COLS) structuralPairs.push([a, a + 1]);
      if (row + 1 < ROWS) structuralPairs.push([a, a + COLS]);
      if (row + 1 < ROWS && col + 1 < COLS) structuralPairs.push([a, a + COLS + 1]);
    }
  }
  triangles.length = TRIANGLE_COUNT * 3;
  shearTriples.length = TRIANGLE_COUNT;
  structuralPairs.length = STRETCH_COUNT;

  const allPairs = structuralPairs;
  const distanceIndices = new Uint32Array(allPairs.length * 2);
  const distanceRestLengths = new Float32Array(allPairs.length);
  const distanceCompliances = new Float32Array(allPairs.length).fill(1e-7);
  const distanceKinds = new Uint8Array(allPairs.length);
  for (let index = 0; index < allPairs.length; index += 1) {
    const [a, b] = allPairs[index];
    distanceIndices[index * 2] = a;
    distanceIndices[index * 2 + 1] = b;
    distanceKinds[index] = 0;
    distanceRestLengths[index] = distance3(positions, a, b);
  }

  const bendValues = buildGridHinges(triangles).slice(0, BEND_COUNT * 4);
  const bendIndices = Uint32Array.from(bendValues);
  const bendRestAngles = new Float32Array(bendIndices.length / 4);
  const bendCompliances = new Float32Array(bendRestAngles.length).fill(100_000);

  const shearIndices = new Uint32Array(shearTriples.length * 3);
  const shearRestCosines = new Float32Array(shearTriples.length);
  for (let index = 0; index < shearTriples.length; index += 1) {
    const [p0, p1, p2] = shearTriples[index];
    shearIndices.set([p0, p1, p2], index * 3);
    shearRestCosines[index] = restCosine(positions, p0, p1, p2);
  }

  const seamIndices = new Uint32Array(SEAM_COUNT * 4).fill(0xffffffff);
  const seamWeights = new Float32Array(SEAM_COUNT * 4);
  const seamRestDistances = new Float32Array(SEAM_COUNT);
  const seamGroupIds: string[] = [];
  for (let index = 0; index < SEAM_COUNT; index += 1) {
    const row = index % ROWS;
    const a = row * COLS;
    const b = a + COLS - 1;
    seamIndices[index * 4] = a;
    seamIndices[index * 4 + 2] = b;
    seamWeights[index * 4] = 1;
    seamWeights[index * 4 + 2] = 1;
    seamRestDistances[index] = distance3(positions, a, b);
    seamGroupIds.push(`perf-seam-${index % 7}`);
  }

  const avatar = buildAvatarParametricModel(MEASUREMENTS, "feminine");
  const packed = packAvatarCollisionModel(buildAvatarCollisionModel(avatar));
  const body = createBodyCollisionRuntimeState(
    packed,
    new Float32Array(PARTICLES).fill(0.00025),
    new Float32Array(PARTICLES).fill(0.5),
    bodyEnabled,
  );
  if (reference) {
    body.colliders.cache!.usesBitMask = false;
    body.pointCandidateIndices = new Uint16Array(PARTICLES * body.colliders.kinds.length);
    body.sweptCandidateIndices = new Uint16Array(PARTICLES * body.colliders.kinds.length);
  }

  return createXpbdState({
    positions: new Float32Array(positions),
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(PARTICLES * 3),
    inverseMasses,
    restPositions: new Float32Array(positions),
    materialCoordinates: material,
    triangles: new Uint32Array(triangles),
    distances: {
      indices: distanceIndices,
      restLengths: distanceRestLengths,
      compliances: distanceCompliances,
      lambdas: new Float32Array(distanceRestLengths.length),
      kinds: distanceKinds,
    },
    shears: {
      indices: shearIndices,
      restCosines: shearRestCosines,
      compliances: new Float32Array(shearRestCosines.length).fill(1e-7),
      lambdas: new Float32Array(shearRestCosines.length),
    },
    bends: {
      indices: bendIndices,
      restAngles: bendRestAngles,
      compliances: bendCompliances,
      lambdas: new Float32Array(bendRestAngles.length),
    },
    seams: {
      indices: seamIndices,
      weights: seamWeights,
      restDistances: seamRestDistances,
      compliances: new Float32Array(SEAM_COUNT).fill(1e-8),
      relaxations: new Float32Array(SEAM_COUNT).fill(1),
      lambdas: new Float32Array(SEAM_COUNT),
      seamGroupIds,
    },
    pins: { indices: new Uint32Array(0), targets: new Float32Array(0) },
    body,
    config: {
      fixedTimeStep: 1 / 120,
      maximumFrameDelta: 1 / 20,
      maximumSubsteps: 6,
      iterations: 8,
      damping: 0.996,
      gravity: [0, -9.81, 0],
      maximumCorrection: 0.035,
      maximumVelocity: 12,
      seamTolerance: 0.0025,
      metricGuardEnabled: false,
    },
  });
}

function buildGridHinges(triangles: number[]): number[] {
  const firstByEdge = new Map<string, { edgeStart: number; edgeEnd: number; opposite: number }>();
  const result: number[] = [];
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const vertices = [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const edgeStart = vertices[edge];
      const edgeEnd = vertices[(edge + 1) % 3];
      const opposite = vertices[(edge + 2) % 3];
      const key = edgeStart < edgeEnd ? `${edgeStart}:${edgeEnd}` : `${edgeEnd}:${edgeStart}`;
      const first = firstByEdge.get(key);
      if (first === undefined) {
        firstByEdge.set(key, { edgeStart, edgeEnd, opposite });
      } else {
        result.push(first.opposite, opposite, first.edgeStart, first.edgeEnd);
      }
    }
  }
  return result;
}

function distance3(positions: Float32Array, a: number, b: number): number {
  const ao = a * 3;
  const bo = b * 3;
  return Math.hypot(
    positions[bo] - positions[ao],
    positions[bo + 1] - positions[ao + 1],
    positions[bo + 2] - positions[ao + 2],
  );
}

function restCosine(positions: Float32Array, p0: number, p1: number, p2: number): number {
  const o0 = p0 * 3;
  const o1 = p1 * 3;
  const o2 = p2 * 3;
  const ax = positions[o1] - positions[o0];
  const ay = positions[o1 + 1] - positions[o0 + 1];
  const az = positions[o1 + 2] - positions[o0 + 2];
  const bx = positions[o2] - positions[o0];
  const by = positions[o2 + 1] - positions[o0 + 1];
  const bz = positions[o2 + 2] - positions[o0 + 2];
  return (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.5)];
}
