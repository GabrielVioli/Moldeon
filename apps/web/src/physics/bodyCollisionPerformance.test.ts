import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import type { BodyMeasurements } from "../domain/pattern";
import {
  applyBodyContactVelocities,
  createBodyCollisionRuntimeState,
  finalizeBodyContactDiagnostics,
  packAvatarCollisionModel,
  resetBodyContactStep,
  solveBodyCollisions,
} from "./bodyCollision";

const RUN_PERF = process.env.MOLDEON_BODY_PERF_BENCH === "1";
const PARTICLE_COUNTS = [2_500, 4_900, 6_400] as const;
const ITERATIONS = 8;
const PROXY_COUNT = 12;
type ContactScenario = "low" | "medium" | "stress";
const SCENARIOS: ContactScenario[] = ["low", "medium", "stress"];
const MEASUREMENTS: BodyMeasurements = {
  heightMm: 1720, bustMm: 920, waistMm: 760, hipMm: 980,
  shoulderWidthMm: 420, torsoLengthMm: 620, armLengthMm: 600, inseamMm: 800,
  bicepMm: 310, wristMm: 170, thighMm: 570, calfMm: 370, ankleCircumferenceMm: 225,
  kneeHeightMm: 450, hipHeightMm: 190, bustHeightMm: 250,
};

describe("Prompt 11.0.2 body collision performance", () => {
  it("keeps all required particle/contact workloads finite without reducing proxies or iterations", () => {
    for (const particles of PARTICLE_COUNTS) {
      for (const scenario of SCENARIOS) {
        const fixture = makeFixture(particles, scenario, false);
        runWorkload(fixture);
        expect(fixture.predicted.every(Number.isFinite)).toBe(true);
        expect(fixture.body.colliders.kinds.length).toBe(PROXY_COUNT);
        expect(fixture.predicted.length / 3).toBe(particles);
      }
    }
  });

  it("is numerically equivalent to the allocation-heavy 11.0.1 reference path", () => {
    for (const scenario of SCENARIOS) {
      const optimized = makeFixture(640, scenario, false);
      const reference = makeFixture(640, scenario, true);
      runWorkload(optimized);
      runWorkload(reference);
      const positionDeviation = deviation(reference.predicted, optimized.predicted);
      const velocityDeviation = deviation(reference.velocities, optimized.velocities);
      if (RUN_PERF) console.log("MOLDEON_BODY_EQUIVALENCE " + JSON.stringify({
        scenario,
        positionDeviation,
        velocityDeviation,
        referenceContacts: reference.body.bodyContactCount,
        optimizedContacts: optimized.body.bodyContactCount,
        referenceSwept: reference.body.sweptContactCount,
        optimizedSwept: optimized.body.sweptContactCount,
        referencePenetration: reference.body.maximumBodyPenetrationM,
        optimizedPenetration: optimized.body.maximumBodyPenetrationM,
      }));
      expect(positionDeviation.rms).toBeLessThan(2e-7);
      expect(positionDeviation.maximum).toBeLessThan(2e-6);
      expect(velocityDeviation.rms).toBeLessThan(2e-6);
      expect(velocityDeviation.maximum).toBeLessThan(2e-5);
      expect(optimized.body.bodyContactCount).toBe(reference.body.bodyContactCount);
      expect(optimized.body.sweptContactCount).toBe(reference.body.sweptContactCount);
      expect(Math.abs(optimized.body.maximumBodyPenetrationM - reference.body.maximumBodyPenetrationM)).toBeLessThan(2e-6);
      expect(Math.abs(optimized.body.maximumBodyCorrectionM - reference.body.maximumBodyCorrectionM)).toBeLessThan(2e-6);
    }
  });

  it("keeps the 12-proxy hot path cache stable and avoids per-particle candidate arrays", () => {
    const fixture = makeFixture(2_500, "medium", false);
    const cache = fixture.body.colliders.cache;
    expect(cache?.usesBitMask).toBe(true);
    expect(fixture.body.pointCandidateIndices.length).toBe(0);
    expect(fixture.body.sweptCandidateIndices.length).toBe(0);
    runWorkload(fixture);
    resetBodyContactStep(fixture.body);
    expect(fixture.body.colliders.cache).toBe(cache);
  });

  it.skipIf(!RUN_PERF)("prints the required 2500/4900/6400 x low/medium/stress A/B matrix", () => {
    const reports = [];
    for (const particles of PARTICLE_COUNTS) {
      for (const scenario of SCENARIOS) {
        const reference = profile(particles, scenario, true);
        const optimized = profile(particles, scenario, false);
        reports.push({
          particles,
          scenario,
          proxies: PROXY_COUNT,
          iterations: ITERATIONS,
          referenceMedianMs: reference.medianMs,
          referenceP95Ms: reference.p95Ms,
          referenceBroadphaseMedianMs: reference.broadphaseMedianMs,
          referenceNarrowphaseMedianMs: reference.narrowphaseMedianMs,
          referenceProjectionMedianMs: reference.projectionMedianMs,
          referenceFrictionMedianMs: reference.frictionMedianMs,
          optimizedMedianMs: optimized.medianMs,
          optimizedP95Ms: optimized.p95Ms,
          optimizedBroadphaseMedianMs: optimized.broadphaseMedianMs,
          optimizedNarrowphaseMedianMs: optimized.narrowphaseMedianMs,
          optimizedProjectionMedianMs: optimized.projectionMedianMs,
          optimizedFrictionMedianMs: optimized.frictionMedianMs,
          speedup: reference.medianMs / optimized.medianMs,
          referenceColliderTests: reference.colliderTests,
          referenceCandidateTests: reference.candidateTests,
          referenceNarrowPhaseTests: reference.narrowPhaseTests,
          colliderTests: optimized.colliderTests,
          candidateTests: optimized.candidateTests,
          broadphaseRejected: optimized.broadphaseRejected,
          broadphaseRejectRate: optimized.colliderTests > 0
            ? optimized.broadphaseRejected / optimized.colliderTests
            : 0,
          narrowPhaseTests: optimized.narrowPhaseTests,
          pointContactsFound: optimized.pointContactsFound,
          sweptTests: optimized.sweptTests,
          sweptContactsFound: optimized.sweptContactsFound,
          finalContacts: optimized.finalContacts,
          positionRms: optimized.positionRmsAgainstReference,
          positionMaximum: optimized.positionMaximumAgainstReference,
        });
      }
    }
    console.log("MOLDEON_BODY_COLLISION_MATRIX " + JSON.stringify(reports));
    expect(reports.every((report) => Number.isFinite(report.optimizedMedianMs))).toBe(true);
    expect(reports.every((report) => report.colliderTests > report.candidateTests)).toBe(true);
  }, 120_000);
});

function makeFixture(particles: number, scenario: ContactScenario, reference: boolean) {
  const avatar = buildAvatarParametricModel(MEASUREMENTS, "feminine");
  const colliders = packAvatarCollisionModel(buildAvatarCollisionModel(avatar));
  const predicted = new Float32Array(particles * 3);
  const previous = new Float32Array(particles * 3);
  const velocities = new Float32Array(particles * 3);
  for (let particle = 0; particle < particles; particle += 1) {
    const offset = particle * 3;
    const angle = (particle % 257) / 257 * Math.PI * 2;
    const y = 0.08 + (particle / Math.max(1, particles - 1)) * 1.56;
    const radialBand = (particle % 7) * 0.004;
    const radius = scenario === "low" ? 0.42 + radialBand : scenario === "medium" ? 0.19 + radialBand : 0.035 + radialBand;
    predicted[offset] = Math.cos(angle) * radius + (scenario === "low" ? 0.75 : 0);
    predicted[offset + 1] = y;
    predicted[offset + 2] = Math.sin(angle) * radius;
    previous[offset] = predicted[offset];
    previous[offset + 1] = predicted[offset + 1];
    previous[offset + 2] = predicted[offset + 2];
    velocities[offset] = Math.sin(angle * 3) * 0.08;
    velocities[offset + 1] = -0.03;
    velocities[offset + 2] = Math.cos(angle * 2) * 0.08;
  }
  for (let particle = 0; particle < particles; particle += 97) previous[particle * 3] -= 0.55;
  const body = createBodyCollisionRuntimeState(
    colliders,
    new Float32Array(particles).fill(0.00025),
    new Float32Array(particles).fill(0.5),
    true,
  );
  if (reference) {
    body.colliders.cache!.usesBitMask = false;
    body.pointCandidateIndices = new Uint16Array(particles * PROXY_COUNT);
    body.sweptCandidateIndices = new Uint16Array(particles * PROXY_COUNT);
  }
  return {
    predicted,
    previous,
    velocities,
    inverseMasses: new Float32Array(particles).fill(1),
    correctionLimits: new Float32Array(particles).fill(0.02),
    body,
  };
}

function runWorkload(fixture: ReturnType<typeof makeFixture>) {
  resetBodyContactStep(fixture.body);
  let broadphaseMs = 0;
  let narrowphaseMs = 0;
  let projectionMs = 0;
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    solveBodyCollisions({
      predictedPositions: fixture.predicted,
      previousPositions: fixture.previous,
      velocities: fixture.velocities,
      inverseMasses: fixture.inverseMasses,
      correctionLimits: fixture.correctionLimits,
      maximumCorrectionM: 0.035,
      fixedTimeStep: 1 / 120,
      body: fixture.body,
      allowSwept: true,
    });
    broadphaseMs += fixture.body.broadphaseMs;
    narrowphaseMs += fixture.body.narrowphaseMs;
    projectionMs += fixture.body.projectionMs;
  }
  finalizeBodyContactDiagnostics(fixture.body);
  applyBodyContactVelocities(fixture.velocities, fixture.body, 1 / 120);
  return { broadphaseMs, narrowphaseMs, projectionMs, frictionMs: fixture.body.frictionMs };
}

function profile(particles: number, scenario: ContactScenario, reference: boolean) {
  for (let warmup = 0; warmup < 4; warmup += 1) runWorkload(makeFixture(particles, scenario, reference));
  const samples: number[] = [];
  const broadphaseSamples: number[] = [];
  const narrowphaseSamples: number[] = [];
  const projectionSamples: number[] = [];
  const frictionSamples: number[] = [];
  let finalFixture = makeFixture(particles, scenario, reference);
  for (let sample = 0; sample < 16; sample += 1) {
    const fixture = makeFixture(particles, scenario, reference);
    const started = performance.now();
    const phases = runWorkload(fixture);
    samples.push(performance.now() - started);
    broadphaseSamples.push(phases.broadphaseMs);
    narrowphaseSamples.push(phases.narrowphaseMs);
    projectionSamples.push(phases.projectionMs);
    frictionSamples.push(phases.frictionMs);
    finalFixture = fixture;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  let positionRmsAgainstReference = 0;
  let positionMaximumAgainstReference = 0;
  if (!reference) {
    const referenceFixture = makeFixture(particles, scenario, true);
    runWorkload(referenceFixture);
    const positionDeviation = deviation(referenceFixture.predicted, finalFixture.predicted);
    positionRmsAgainstReference = positionDeviation.rms;
    positionMaximumAgainstReference = positionDeviation.maximum;
  }
  return {
    medianMs: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    broadphaseMedianMs: median(broadphaseSamples),
    narrowphaseMedianMs: median(narrowphaseSamples),
    projectionMedianMs: median(projectionSamples),
    frictionMedianMs: median(frictionSamples),
    colliderTests: finalFixture.body.bodyColliderTests,
    candidateTests: finalFixture.body.bodyCandidateColliderTests,
    broadphaseRejected: finalFixture.body.bodyBroadphaseRejected,
    narrowPhaseTests: finalFixture.body.bodyCapsuleNarrowphaseTests + finalFixture.body.bodyEllipsoidNarrowphaseTests,
    pointContactsFound: finalFixture.body.bodyPointContactsFound,
    sweptTests: finalFixture.body.bodySweptTests,
    sweptContactsFound: finalFixture.body.bodySweptContactsFound,
    finalContacts: finalFixture.body.bodyContactCount,
    positionRmsAgainstReference,
    positionMaximumAgainstReference,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length * 0.5)];
}

function deviation(reference: Float32Array, optimized: Float32Array) {
  let squaredSum = 0;
  let maximum = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const delta = Math.abs(reference[index] - optimized[index]);
    squaredSum += delta * delta;
    maximum = Math.max(maximum, delta);
  }
  return { rms: Math.sqrt(squaredSum / Math.max(1, reference.length)), maximum };
}
