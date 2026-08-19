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

describe("Prompt 11.0.1 staged body dressing audit", () => {
  it("compares local-trust-region dressing windows before free release", () => {
    const results = [0, 32, 48, 64].map((dressingSteps) => runScenario(dressingSteps));
    console.log("P1101_STAGED_DRESSING_LOCAL", JSON.stringify(results));
    expect(results.every((entry) => entry.invalid === false)).toBe(true);
  }, 180_000);
});

function runScenario(dressingSteps: number) {
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
    bodyCollisionEnabled: true,
    config: {
      gravity: [0, 0, 0],
      maximumSubsteps: input.assemblyDocument.simulationSettings.substeps,
      iterations: input.assemblyDocument.simulationSettings.iterations,
    },
  });
  const state = createXpbdWorkerState(initialization);
  const initialPenetration = auditPenetration(state.positions, initialization.particleHalfThicknessM!, colliders, initialization.bodyContactSkinM ?? 0);

  for (let step = 0; step < dressingSteps; step += 1) {
    stepXpbd(state);
    state.velocities.fill(0);
    state.previousPositions.set(state.positions);
  }
  const dressed = measureXpbdDiagnostics(state);
  const dressedPenetration = auditPenetration(state.positions, initialization.particleHalfThicknessM!, colliders, initialization.bodyContactSkinM ?? 0);

  state.config.gravity = [0, -9.81, 0];
  let latest = dressed;
  let maximumContacts = dressed.bodyContactCount ?? 0;
  for (let step = 0; step < 480; step += 1) {
    stepXpbd(state);
    latest = measureXpbdDiagnostics(state, 1);
    maximumContacts = Math.max(maximumContacts, latest.bodyContactCount ?? 0);
  }

  return {
    dressingSteps,
    registrationSource: registration.source,
    registrationResidualMeanM: registration.residualMeanM,
    initialPenetration,
    dressedPenetration,
    dressedContacts: dressed.bodyContactCount ?? 0,
    maximumContacts,
    finalContacts: latest.bodyContactCount ?? 0,
    finalFrictionContacts: latest.frictionContactCount ?? 0,
    finalMaximumPenetrationM: latest.maximumBodyPenetrationM ?? 0,
    finalMaximumCorrectionM: latest.maximumBodyCorrectionM ?? 0,
    finalSeamMeanErrorM: latest.seamErrorAverage,
    finalSeamMaxErrorM: latest.seamErrorMaximum,
    finalBounds: yBounds(state.positions),
    invalid: latest.invalid,
  };
}

function auditPenetration(
  positions: Float32Array,
  halfThickness: Float32Array,
  colliders: PackedBodyColliders,
  skin: number,
) {
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

function yBounds(positions: Float32Array) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let offset = 1; offset < positions.length; offset += 3) {
    min = Math.min(min, positions[offset]);
    max = Math.max(max, positions[offset]);
  }
  return { min, max, center: (min + max) * 0.5 };
}
