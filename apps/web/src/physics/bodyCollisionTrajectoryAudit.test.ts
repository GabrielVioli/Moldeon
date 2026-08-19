import { describe, expect, it } from "vitest";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import { buildAvatarParametricModel, sampleTorsoAxes } from "../avatar/AvatarParametricModel";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { resolveSimulationBodyRegistration } from "./BodyCollisionRegistration";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import { packAvatarCollisionModel } from "./bodyCollision";
import { measureXpbdDiagnostics, stepXpbd } from "./xpbd";

describe("Prompt 11.0.1 body collision trajectory audit", () => {
  it("traces upper band geometry and body regions during the fall", () => {
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
        gravity: [0, -9.81, 0],
        maximumSubsteps: input.assemblyDocument.simulationSettings.substeps,
        iterations: input.assemblyDocument.simulationSettings.iterations,
      },
    });
    const state = createXpbdWorkerState(initialization);
    const upperBand = selectUpperBand(initialization.positions);
    const targets = new Set([0, 1, 2, 4, 8, 16, 32, 60, 120, 240, 480]);
    const snapshots: unknown[] = [];
    const waist = sampleTorsoAxes(avatar, avatar.landmarks.waistY);
    const hip = sampleTorsoAxes(avatar, avatar.landmarks.hipY);

    for (let step = 0; step <= 480; step += 1) {
      if (targets.has(step)) {
        const diagnostics = measureXpbdDiagnostics(state, step === 0 ? 0 : 1);
        snapshots.push({
          step,
          contacts: diagnostics.bodyContactCount ?? 0,
          frictionContacts: diagnostics.frictionContactCount ?? 0,
          regions: diagnostics.bodyContactsByRegion ?? {},
          maxPenetrationM: diagnostics.maximumBodyPenetrationM ?? 0,
          maxCorrectionM: diagnostics.maximumBodyCorrectionM ?? 0,
          maxVelocity: diagnostics.maximumVelocityMagnitude,
          seamMeanM: diagnostics.seamErrorAverage,
          seamMaxM: diagnostics.seamErrorMaximum,
          garment: bounds(state.positions),
          upperBand: bandBounds(state.positions, upperBand),
        });
      }
      if (step < 480) stepXpbd(state);
    }

    console.log("P1101_TRAJECTORY", JSON.stringify({
      registration,
      body: {
        waistY: avatar.landmarks.waistY + registration.transform.translation[1],
        hipY: avatar.landmarks.hipY + registration.transform.translation[1],
        crotchY: avatar.landmarks.crotchY + registration.transform.translation[1],
        waistHalfWidth: waist.halfWidth,
        waistHalfDepth: waist.halfDepth,
        hipHalfWidth: hip.halfWidth,
        hipHalfDepth: hip.halfDepth,
      },
      upperBandParticleCount: upperBand.length,
      snapshots,
    }));
    expect(snapshots).toHaveLength(targets.size);
    expect(state.invalid).toBe(false);
  }, 120_000);
});

function selectUpperBand(positions: Float32Array): number[] {
  let maxY = Number.NEGATIVE_INFINITY;
  for (let offset = 1; offset < positions.length; offset += 3) maxY = Math.max(maxY, positions[offset]);
  const threshold = maxY - 0.015;
  const result: number[] = [];
  for (let particle = 0; particle < positions.length / 3; particle += 1) {
    if (positions[particle * 3 + 1] >= threshold) result.push(particle);
  }
  return result;
}

function bounds(positions: Float32Array) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let offset = 0; offset < positions.length; offset += 3) {
    minX = Math.min(minX, positions[offset]); maxX = Math.max(maxX, positions[offset]);
    minY = Math.min(minY, positions[offset + 1]); maxY = Math.max(maxY, positions[offset + 1]);
    minZ = Math.min(minZ, positions[offset + 2]); maxZ = Math.max(maxZ, positions[offset + 2]);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, centerY: (minY + maxY) * 0.5 };
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
    minX, maxX, minY, maxY, minZ, maxZ,
    halfWidth: (maxX - minX) * 0.5,
    halfDepth: (maxZ - minZ) * 0.5,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
  };
}
