import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import type { BodyMeasurements } from "../domain/pattern";
import {
  createBodyCollisionRuntimeState,
  packAvatarCollisionModel,
  resetBodyContactStep,
  solveBodyCollisions,
} from "./bodyCollision";

const RUN_PERF = process.env.MOLDEON_BODY_PERF_BENCH === "1";
const PARTICLES = 6408;
const ITERATIONS = 8;
const MEASUREMENTS: BodyMeasurements = {
  heightMm: 1720, bustMm: 920, waistMm: 760, hipMm: 980,
  shoulderWidthMm: 420, torsoLengthMm: 620, armLengthMm: 600, inseamMm: 800,
  bicepMm: 310, wristMm: 170, thighMm: 570, calfMm: 370, ankleCircumferenceMm: 225,
  kneeHeightMm: 450, hipHeightMm: 190, bustHeightMm: 250,
};

describe("Prompt 11 body collision performance", () => {
  it("keeps the ~6.4k particle / 12 proxy workload finite", () => {
    const fixture = makeFixture();
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) solve(fixture, iteration === 0);
    expect(fixture.predicted.every(Number.isFinite)).toBe(true);
    expect(fixture.body.colliders.kinds.length).toBe(12);
    expect(fixture.predicted.length / 3).toBe(PARTICLES);
  });

  it.skipIf(!RUN_PERF)("prints isolated analytical body-collision cost", () => {
    const samples: number[] = [];
    for (let warmup = 0; warmup < 5; warmup += 1) {
      const fixture = makeFixture();
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) solve(fixture, iteration === 0);
    }
    for (let sample = 0; sample < 24; sample += 1) {
      const fixture = makeFixture();
      const started = performance.now();
      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) solve(fixture, iteration === 0);
      samples.push(performance.now() - started);
    }
    const sorted = [...samples].sort((a,b)=>a-b);
    const medianMs = sorted[Math.floor(sorted.length * 0.5)];
    const p95Ms = sorted[Math.floor(sorted.length * 0.95)];
    console.log("MOLDEON_BODY_COLLISION_PERF "+JSON.stringify({ particles: PARTICLES, proxies: 12, iterations: ITERATIONS, medianMs, p95Ms }));
    expect(Number.isFinite(medianMs)).toBe(true);
  }, 60_000);
});

function makeFixture() {
  const avatar = buildAvatarParametricModel(MEASUREMENTS, "feminine");
  const colliders = packAvatarCollisionModel(buildAvatarCollisionModel(avatar));
  const predicted = new Float32Array(PARTICLES * 3);
  const previous = new Float32Array(PARTICLES * 3);
  for (let i=0;i<PARTICLES;i+=1) {
    const angle = (i % 256) / 256 * Math.PI * 2;
    const ring = i % 5;
    const y = (i / PARTICLES) * 1.7;
    const radius = 0.18 + ring * 0.035;
    predicted[i*3]=Math.cos(angle)*radius;
    predicted[i*3+1]=y;
    predicted[i*3+2]=Math.sin(angle)*radius;
  }
  previous.set(predicted);
  const body = createBodyCollisionRuntimeState(colliders,new Float32Array(PARTICLES).fill(0.00025),new Float32Array(PARTICLES).fill(0.5),true);
  return { predicted, previous, inverseMasses:new Float32Array(PARTICLES).fill(1), correctionLimits:new Float32Array(PARTICLES).fill(0.02), body };
}
function solve(fixture:ReturnType<typeof makeFixture>,allowSwept:boolean){
  if (allowSwept) resetBodyContactStep(fixture.body);
  solveBodyCollisions({ predictedPositions:fixture.predicted, previousPositions:fixture.previous, inverseMasses:fixture.inverseMasses, correctionLimits:fixture.correctionLimits, maximumCorrectionM:0.035, fixedTimeStep:1/120, body:fixture.body, allowSwept });
}
