import { describe, expect, it } from "vitest";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS, type PatternTemplateId } from "../patterns/templateCatalog";
import { resolveSimulationBodyRegistration } from "./BodyCollisionRegistration";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import { packAvatarCollisionModel } from "./bodyCollision";
import { measureXpbdDiagnostics, resetXpbdState, stepXpbd } from "./xpbd";

describe("Prompt 11.0.1 body collision stabilization final gate", () => {
  it("runs the lower-body scene without heuristic pins and profiles collision phases", () => {
    const scene = buildTemplateScene("straight-skirt", true, 1);
    expect(scene.initialization.pinIndices.length).toBe(0);
    expect(scene.initialization.config.iterations).toBe(scene.documentIterations);
    expect(scene.state.body.initialDressingSteps).toBeGreaterThan(0);

    const metrics = runSteps(scene.state, 480);
    console.log("P1101_FINAL_SKIRT_ON", JSON.stringify({
      registration: scene.registration,
      initialDressingSteps: scene.state.body.initialDressingSteps,
      ...metrics,
    }));

    expect(metrics.invalid).toBe(false);
    expect(metrics.maximumObservedContacts).toBeGreaterThan(0);
    expect(metrics.maximumObservedPenetrationM).toBeLessThan(0.16);
    expect(metrics.maximumObservedCorrectionM).toBeLessThanOrEqual(scene.state.config.maximumCorrection + 1e-6);
    expect(metrics.bodyBroadphaseMedianMs).toBeGreaterThanOrEqual(0);
    expect(metrics.bodyNarrowphaseMedianMs).toBeGreaterThanOrEqual(0);
    expect(metrics.bodyProjectionMedianMs).toBeGreaterThanOrEqual(0);
    expect(metrics.bodyFrictionMedianMs).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("keeps collision OFF as the finite control and performs no body phases", () => {
    const scene = buildTemplateScene("straight-skirt", false, 1);
    const metrics = runSteps(scene.state, 480);
    console.log("P1101_FINAL_SKIRT_OFF", JSON.stringify(metrics));
    expect(metrics.invalid).toBe(false);
    expect(metrics.maximumObservedContacts).toBe(0);
    expect(metrics.bodyCollisionMedianMs).toBeLessThan(0.05);
  }, 120_000);

  it("keeps the same lower-body scene finite at gravity zero", () => {
    const scene = buildTemplateScene("straight-skirt", true, 0);
    const metrics = runSteps(scene.state, 120);
    console.log("P1101_FINAL_SKIRT_GRAVITY_ZERO", JSON.stringify(metrics));
    expect(metrics.invalid).toBe(false);
    expect(metrics.maximumObservedContacts).toBeGreaterThan(0);
  }, 120_000);

  it("reset restores the body dressing state after an unstable-looking velocity field", () => {
    const scene = buildTemplateScene("straight-skirt", true, 1);
    scene.state.velocities.fill(500);
    stepXpbd(scene.state);
    resetXpbdState(scene.state);
    expect(scene.state.invalid).toBe(false);
    expect(scene.state.stepCount).toBe(0);
    expect(scene.state.velocities.every((value) => value === 0)).toBe(true);
    expect(scene.state.body.dressingStepsRemaining).toBe(scene.state.body.initialDressingSteps);
    expect(scene.state.body.initialDressingSteps).toBeGreaterThan(0);
  }, 120_000);

  it("fails safe when legacy torso registration would destroy the material metric", () => {
    const scene = buildTemplateScene("bodice-block", true, 1);
    const metrics = runSteps(scene.state, 120);
    console.log("P1101_FINAL_TORSO", JSON.stringify({ registration: scene.registration, ...metrics }));
    expect(metrics.invalid).toBe(true);
    expect(metrics.invalidReason).toBe("metric-instability");
    expect(metrics.bodyColliderCount).toBeGreaterThan(0);
    expect(metrics.maximumObservedCorrectionM).toBeLessThanOrEqual(scene.state.config.maximumCorrection + 1e-6);
  }, 120_000);
});

function buildTemplateScene(template: PatternTemplateId, collision: boolean, gravityScale: 0 | 1) {
  const garment = resolveTemplateAssemblyGarment(
    createGarmentFromTemplate(template, DEFAULT_BODY_MEASUREMENTS, "feminine"),
  );
  const input = buildResolvedAssemblyInput(garment);
  const result = buildCoarseIsometricAssembly(input.assemblyDocument);
  const avatar = buildAvatarParametricModel(input.assemblyDocument.measurements.values, input.assemblyDocument.body.type);
  const registration = resolveSimulationBodyRegistration(result.state, avatar);
  const colliders = registration.status === "registered"
    ? packAvatarCollisionModel(buildAvatarCollisionModel(avatar), registration.transform)
    : { kinds: new Uint8Array(0), data: new Float32Array(0), regions: [] };
  const documentIterations = input.assemblyDocument.simulationSettings.iterations;
  const initialization = buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {
    bodyColliders: colliders,
    bodyCollisionEnabled: collision && registration.status === "registered",
    config: {
      gravity: [0, gravityScale === 1 ? -9.81 : 0, 0],
      maximumSubsteps: input.assemblyDocument.simulationSettings.substeps,
      iterations: documentIterations,
    },
  });
  return {
    state: createXpbdWorkerState(initialization),
    initialization,
    registration,
    documentIterations,
  };
}

function runSteps(state: ReturnType<typeof createXpbdWorkerState>, steps: number) {
  const body: number[] = [];
  const broadphase: number[] = [];
  const narrowphase: number[] = [];
  const projection: number[] = [];
  const friction: number[] = [];
  const total: number[] = [];
  let latest = measureXpbdDiagnostics(state);
  let maximumObservedContacts = 0;
  let maximumObservedPenetrationM = 0;
  let maximumObservedCorrectionM = 0;
  for (let step = 0; step < steps; step += 1) {
    stepXpbd(state);
    latest = measureXpbdDiagnostics(state, 1);
    maximumObservedContacts = Math.max(maximumObservedContacts, latest.bodyContactCount ?? 0);
    maximumObservedPenetrationM = Math.max(maximumObservedPenetrationM, latest.maximumBodyPenetrationM ?? 0);
    maximumObservedCorrectionM = Math.max(maximumObservedCorrectionM, latest.maximumBodyCorrectionM ?? 0);
    if (step >= Math.max(0, steps - 100)) {
      body.push(latest.bodyCollisionMs ?? 0);
      broadphase.push(latest.bodyBroadphaseMs ?? 0);
      narrowphase.push(latest.bodyNarrowphaseMs ?? 0);
      projection.push(latest.bodyProjectionMs ?? 0);
      friction.push(latest.bodyFrictionMs ?? 0);
      total.push(latest.solverStepTotalMs ?? 0);
    }
  }
  return {
    steps,
    bodyCollisionMedianMs: median(body),
    bodyBroadphaseMedianMs: median(broadphase),
    bodyNarrowphaseMedianMs: median(narrowphase),
    bodyProjectionMedianMs: median(projection),
    bodyFrictionMedianMs: median(friction),
    solverStepMedianMs: median(total),
    bodyColliderCount: latest.bodyColliderCount ?? 0,
    finalBodyContactCount: latest.bodyContactCount ?? 0,
    finalFrictionContactCount: latest.frictionContactCount ?? 0,
    maximumObservedContacts,
    maximumObservedPenetrationM,
    maximumObservedCorrectionM,
    finalMaximumBodyPenetrationM: latest.maximumBodyPenetrationM ?? 0,
    finalMaximumBodyCorrectionM: latest.maximumBodyCorrectionM ?? 0,
    seamMeanErrorM: latest.seamErrorAverage,
    seamMaxErrorM: latest.seamErrorMaximum,
    structuralStretchMaxRatio: latest.structuralStretchMaxRatio,
    structuralCompressionMinRatio: latest.structuralCompressionMinRatio,
    triangleAreaMinRatio: latest.triangleAreaMinRatio,
    triangleAreaMaxRatio: latest.triangleAreaMaxRatio,
    flippedTriangleCount: latest.flippedTriangleCount,
    maximumVelocityMagnitude: latest.maximumVelocityMagnitude,
    dressingStepsRemaining: latest.bodyDressingStepsRemaining ?? 0,
    invalid: latest.invalid,
    invalidReason: latest.invalidReason,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}
