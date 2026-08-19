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
  it("switches from gross dressing correction to local free-simulation correction", () => {
    const scenarios = [
      { dressingSteps: 6, dressingIterations: 12 },
      { dressingSteps: 8, dressingIterations: 12 },
      { dressingSteps: 6, dressingIterations: 24 },
      { dressingSteps: 8, dressingIterations: 24 },
    ];
    const results = scenarios.map((scenario) => runScenario(scenario.dressingSteps, scenario.dressingIterations));
    console.log("P1101_STAGED_PHASE_SWITCH", JSON.stringify(results));
    expect(results.every((entry) => entry.invalid === false)).toBe(true);
  }, 180_000);
});

function runScenario(dressingSteps: number, dressingIterations: number) {
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
  const normalIterations = input.assemblyDocument.simulationSettings.iterations;
  const initialization = buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {
    bodyColliders: colliders,
    bodyCollisionEnabled: true,
    config: {
      gravity: [0, 0, 0],
      maximumSubsteps: input.assemblyDocument.simulationSettings.substeps,
      iterations: normalIterations,
    },
  });
  const state = createXpbdWorkerState(initialization);
  const upperBand = selectUpperBand(state.positions);
  const initialPenetration = auditPenetration(state.positions, initialization.particleHalfThicknessM!, colliders, initialization.bodyContactSkinM ?? 0);
  const initialBand = bandBounds(state.positions, upperBand);

  state.config.iterations = dressingIterations;
  state.body.grossDepenetrationEnabled = true;
  for (let step = 0; step < dressingSteps; step += 1) {
    stepXpbd(state);
    state.velocities.fill(0);
    state.previousPositions.set(state.positions);
  }
  const dressed = measureXpbdDiagnostics(state);
  const dressedPenetration = auditPenetration(state.positions, initialization.particleHalfThicknessM!, colliders, initialization.bodyContactSkinM ?? 0);
  const dressedBand = bandBounds(state.positions, upperBand);

  state.body.grossDepenetrationEnabled = false;
  state.config.iterations = normalIterations;
  state.config.gravity = [0, -9.81, 0];
  let latest = dressed;
  let maximumContacts = dressed.bodyContactCount ?? 0;
  const checkpoints: Array<{ step: number; contacts: number; maxCorrectionM: number; band: ReturnType<typeof bandBounds> }> = [];
  for (let step = 1; step <= 480; step += 1) {
    stepXpbd(state);
    latest = measureXpbdDiagnostics(state, 1);
    maximumContacts = Math.max(maximumContacts, latest.bodyContactCount ?? 0);
    if ([1, 8, 16, 32, 60, 120, 240, 480].includes(step)) {
      checkpoints.push({
        step,
        contacts: latest.bodyContactCount ?? 0,
        maxCorrectionM: latest.maximumBodyCorrectionM ?? 0,
        band: bandBounds(state.positions, upperBand),
      });
    }
  }

  return {
    dressingSteps,
    dressingIterations,
    normalIterations,
    registrationSource: registration.source,
    registrationResidualMeanM: registration.residualMeanM,
    initialPenetration,
    dressedPenetration,
    initialBand,
    dressedBand,
    dressedContacts: dressed.bodyContactCount ?? 0,
    maximumContacts,
    finalContacts: latest.bodyContactCount ?? 0,
    finalFrictionContacts: latest.frictionContactCount ?? 0,
    finalMaximumPenetrationM: latest.maximumBodyPenetrationM ?? 0,
    finalMaximumCorrectionM: latest.maximumBodyCorrectionM ?? 0,
    finalSeamMeanErrorM: latest.seamErrorAverage,
    finalSeamMaxErrorM: latest.seamErrorMaximum,
    finalBounds: yBounds(state.positions),
    finalBand: bandBounds(state.positions, upperBand),
    checkpoints,
    invalid: latest.invalid,
  };
}

function selectUpperBand(positions: Float32Array): number[] {
  let maxY = Number.NEGATIVE_INFINITY;
  for (let offset = 1; offset < positions.length; offset += 3) maxY = Math.max(maxY, positions[offset]);
  const threshold = maxY - 0.015;
  const particles: number[] = [];
  for (let particle = 0; particle < positions.length / 3; particle += 1) {
    if (positions[particle * 3 + 1] >= threshold) particles.push(particle);
  }
  return particles;
}

function bandBounds(positions: Float32Array, particles: readonly number[]) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const particle of particles) {
    const offset = particle * 3;
    minX = Math.min(minX, positions[offset]); maxX = Math.max(maxX, positions[offset]);
    minY = Math.min(minY, positions[offset + 1]); maxY = Math.max(maxY, positions[offset + 1]);
    minZ = Math.min(minZ, positions[offset + 2]); maxZ = Math.max(maxZ, positions[offset + 2]);
  }
  return {
    halfWidth: (maxX - minX) * 0.5,
    halfDepth: (maxZ - minZ) * 0.5,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
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
