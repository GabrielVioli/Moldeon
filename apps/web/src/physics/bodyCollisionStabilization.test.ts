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

interface SceneOptions {
  collision: boolean;
  gravity: 0 | 1;
  emulatePrompt11Hotfix: boolean;
}

describe("Prompt 11.0.1 lower-body collision stabilization", () => {
  it("records the current Prompt 11 straight-skirt baseline", () => {
    const scene = buildStraightSkirtScene({ collision: true, gravity: 1, emulatePrompt11Hotfix: true });
    const initial = auditInitialPenetration(scene.initialization.positions, scene.initialization.particleHalfThicknessM!, scene.colliders, scene.initialization.bodyContactSkinM ?? 0);
    console.log("P1101_BASELINE_SETUP", JSON.stringify({
      particles: scene.initialization.positions.length / 3,
      triangles: scene.initialization.triangles.length / 3,
      pins: scene.initialization.pinIndices.length,
      iterations: scene.initialization.config.iterations,
      maximumVelocity: scene.initialization.config.maximumVelocity,
      registrationResidualMeanM: scene.registration.residualMeanM,
      registrationResidualMaxM: scene.registration.residualMaxM,
      initialPenetratingParticles: initial.count,
      initialPenetrationMeanM: initial.mean,
      initialPenetrationMaxM: initial.max,
    }));

    const metrics = runFixedSteps(scene.state, 480);
    console.log("P1101_BASELINE_RUN", JSON.stringify(metrics));
    expect(metrics.invalid).toBe(false);
    expect(metrics.bodyColliderCount).toBe(scene.colliders.kinds.length);
    expect(metrics.maximumObservedContacts).toBeGreaterThan(0);
  }, 120_000);

  it("keeps collision OFF as a finite control run", () => {
    const scene = buildStraightSkirtScene({ collision: false, gravity: 1, emulatePrompt11Hotfix: true });
    const metrics = runFixedSteps(scene.state, 480);
    console.log("P1101_BASELINE_OFF", JSON.stringify(metrics));
    expect(metrics.invalid).toBe(false);
    expect(metrics.bodyContactCount).toBe(0);
  }, 120_000);
});

function buildStraightSkirtScene(options: SceneOptions) {
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
  const initialization = buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {
    bodyColliders: colliders,
    bodyCollisionEnabled: options.collision,
    pinAssemblyAnchors: options.emulatePrompt11Hotfix,
    config: {
      gravity: [0, options.gravity === 1 ? -9.81 : 0, 0],
      maximumSubsteps: 6,
      iterations: options.emulatePrompt11Hotfix ? 24 : input.assemblyDocument.simulationSettings.iterations,
      ...(options.emulatePrompt11Hotfix ? { maximumVelocity: 1 } : {}),
    },
  });
  return { state: createXpbdWorkerState(initialization), initialization, colliders, registration };
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
    invalid: latest.invalid,
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) * 0.5 : sorted[middle];
}
