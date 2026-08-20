import { describe, expect, it } from "vitest";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { resolveSimulationBodyRegistration } from "./BodyCollisionRegistration";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import { deepestBodyContact, packAvatarCollisionModel, type PackedBodyColliders } from "./bodyCollision";
import { measureXpbdDiagnostics, stepXpbd } from "./xpbd";

describe("Prompt 11.0.1 stabilized body collision candidate", () => {
  it("settles the canonical straight skirt with document solver settings and no support pins", () => {
    const scene = buildStraightSkirtScene(true, 1);
    const initial = auditInitialPenetration(scene.initialization.positions, scene.initialization.particleHalfThicknessM!, scene.colliders, scene.initialization.bodyContactSkinM ?? 0);
    const metrics = runFixedSteps(scene.state, 480);
    console.log("P1101_CANDIDATE_ON", JSON.stringify({
      registrationSource: scene.registration.source,
      registrationResidualMeanM: scene.registration.residualMeanM,
      registrationResidualMaxM: scene.registration.residualMaxM,
      particles: scene.initialization.positions.length / 3,
      pins: scene.initialization.pinIndices.length,
      iterations: scene.initialization.config.iterations,
      initial,
      ...metrics,
    }));
    expect(scene.initialization.pinIndices.length).toBe(0);
    expect(scene.initialization.config.iterations).toBe(scene.iterations);
    expect(metrics.invalid).toBe(false);
    expect(metrics.maximumObservedContacts).toBeGreaterThan(0);
  }, 120_000);

  it("keeps the same skirt finite with body collision off", () => {
    const scene = buildStraightSkirtScene(false, 1);
    const metrics = runFixedSteps(scene.state, 480);
    console.log("P1101_CANDIDATE_OFF", JSON.stringify(metrics));
    expect(metrics.invalid).toBe(false);
    expect(metrics.bodyContactCount).toBe(0);
  }, 120_000);
});

function buildStraightSkirtScene(collision: boolean, gravityScale: 0 | 1) {
  const garment = {
    ...resolveTemplateAssemblyGarment(createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS, "feminine")),
    dressing: { region: "lower" as const },
  };
  const input = buildResolvedAssemblyInput(garment);
  const result = buildCoarseIsometricAssembly(input.assemblyDocument);
  const avatar = buildAvatarParametricModel(input.assemblyDocument.measurements.values, input.assemblyDocument.body.type);
  const registration = resolveSimulationBodyRegistration(result.state, avatar);
  if (registration.status !== "registered") throw new Error("straight-skirt should have confirmed body placement");
  const colliders = packAvatarCollisionModel(buildAvatarCollisionModel(avatar), registration.transform);
  const iterations = input.assemblyDocument.simulationSettings.iterations;
  const initialization = buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {
    bodyColliders: colliders,
    bodyCollisionEnabled: collision,
    config: {
      gravity: [0, gravityScale === 1 ? -9.81 : 0, 0],
      maximumSubsteps: input.assemblyDocument.simulationSettings.substeps,
      iterations,
    },
  });
  return { state: createXpbdWorkerState(initialization), initialization, colliders, registration, iterations };
}

function auditInitialPenetration(
  positions: Float32Array,
  halfThickness: Float32Array,
  colliders: PackedBodyColliders,
  skin: number,
): { count: number; mean: number; max: number } {
  let count = 0;
  let total = 0;
  let max = 0;
  for (let particle = 0; particle < positions.length / 3; particle += 1) {
    const offset = particle * 3;
    const contact = deepestBodyContact(
      [positions[offset], positions[offset + 1], positions[offset + 2]],
      colliders,
      halfThickness[particle] + skin,
    );
    if (!contact) continue;
    count += 1;
    total += contact.penetrationM;
    max = Math.max(max, contact.penetrationM);
  }
  return { count, mean: count > 0 ? total / count : 0, max };
}

function runFixedSteps(state: ReturnType<typeof createXpbdWorkerState>, steps: number) {
  const bodySamples: number[] = [];
  const totalSamples: number[] = [];
  let latest = measureXpbdDiagnostics(state);
  let maximumObservedContacts = 0;
  for (let step = 0; step < steps; step += 1) {
    stepXpbd(state);
    latest = measureXpbdDiagnostics(state, 1);
    maximumObservedContacts = Math.max(maximumObservedContacts, latest.bodyContactCount ?? 0);
    if (step >= Math.max(0, steps - 100)) {
      bodySamples.push(latest.bodyCollisionMs ?? 0);
      totalSamples.push(latest.solverStepTotalMs ?? 0);
    }
  }
  return {
    steps,
    bodyCollisionMedianMs: median(bodySamples),
    solverStepMedianMs: median(totalSamples),
    bodyColliderCount: latest.bodyColliderCount ?? 0,
    bodyContactCount: latest.bodyContactCount ?? 0,
    maximumObservedContacts,
    frictionContactCount: latest.frictionContactCount ?? 0,
    maximumBodyPenetrationM: latest.maximumBodyPenetrationM ?? 0,
    maximumBodyCorrectionM: latest.maximumBodyCorrectionM ?? 0,
    seamMeanErrorM: latest.seamErrorAverage,
    seamMaxErrorM: latest.seamErrorMaximum,
    maximumVelocityMagnitude: latest.maximumVelocityMagnitude,
    invalid: latest.invalid,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) * 0.5 : sorted[middle];
}
