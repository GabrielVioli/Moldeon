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
import { packAvatarCollisionModel } from "./bodyCollision";
import { measureXpbdDiagnostics, stepXpbd } from "./xpbd";

describe("Prompt 11.0.1 settled contact friction audit", () => {
  it("measures normal support impulse versus tangential slip", () => {
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
    const state = createXpbdWorkerState(buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {
      bodyColliders: colliders,
      bodyCollisionEnabled: true,
      config: { gravity: [0, 0, 0], maximumSubsteps: input.assemblyDocument.simulationSettings.substeps, iterations: normalIterations },
    }));

    state.config.iterations = 24;
    state.body.grossDepenetrationEnabled = true;
    for (let step = 0; step < 8; step += 1) {
      stepXpbd(state);
      state.velocities.fill(0);
      state.previousPositions.set(state.positions);
    }
    state.body.grossDepenetrationEnabled = false;
    state.config.iterations = normalIterations;
    state.config.gravity = [0, -9.81, 0];

    const checkpoints = new Set([1, 8, 16, 32, 60, 120, 180, 240]);
    const snapshots: unknown[] = [];
    for (let step = 1; step <= 240; step += 1) {
      stepXpbd(state);
      if (!checkpoints.has(step)) continue;
      const diagnostics = measureXpbdDiagnostics(state, 1);
      snapshots.push({
        step,
        contacts: diagnostics.bodyContactCount ?? 0,
        frictionContacts: diagnostics.frictionContactCount ?? 0,
        regions: diagnostics.bodyContactsByRegion ?? {},
        contactLoad: contactLoadAudit(state),
      });
    }
    console.log("P1101_FRICTION_LOAD", JSON.stringify(snapshots));
    expect(state.invalid).toBe(false);
    expect(snapshots).toHaveLength(checkpoints.size);
  }, 120_000);
});

function contactLoadAudit(state: ReturnType<typeof createXpbdWorkerState>) {
  let count = 0;
  let impulseTotal = 0;
  let impulseMax = 0;
  let tangentTotal = 0;
  let tangentMax = 0;
  let frictionTotal = 0;
  let gravityNormalTotal = 0;
  let gravityNormalMax = 0;
  for (let particle = 0; particle < state.body.contactMask.length; particle += 1) {
    if (!state.body.contactMask[particle]) continue;
    const offset = particle * 3;
    const nx = state.body.contactNormals[offset];
    const ny = state.body.contactNormals[offset + 1];
    const nz = state.body.contactNormals[offset + 2];
    const vx = state.velocities[offset];
    const vy = state.velocities[offset + 1];
    const vz = state.velocities[offset + 2];
    const vn = vx * nx + vy * ny + vz * nz;
    const tx = vx - nx * vn;
    const ty = vy - ny * vn;
    const tz = vz - nz * vn;
    const tangent = Math.hypot(tx, ty, tz);
    const impulse = state.body.normalImpulseSpeed[particle];
    const gravityNormalSpeed = Math.max(0, -(state.config.gravity[0] * nx + state.config.gravity[1] * ny + state.config.gravity[2] * nz)) * state.config.fixedTimeStep;
    count += 1;
    impulseTotal += impulse;
    impulseMax = Math.max(impulseMax, impulse);
    tangentTotal += tangent;
    tangentMax = Math.max(tangentMax, tangent);
    frictionTotal += state.body.particleFriction[particle];
    gravityNormalTotal += gravityNormalSpeed;
    gravityNormalMax = Math.max(gravityNormalMax, gravityNormalSpeed);
  }
  return {
    count,
    meanImpulseSpeed: count > 0 ? impulseTotal / count : 0,
    maxImpulseSpeed: impulseMax,
    meanTangentSpeed: count > 0 ? tangentTotal / count : 0,
    maxTangentSpeed: tangentMax,
    meanFriction: count > 0 ? frictionTotal / count : 0,
    meanGravityNormalSpeed: count > 0 ? gravityNormalTotal / count : 0,
    maxGravityNormalSpeed: gravityNormalMax,
  };
}
