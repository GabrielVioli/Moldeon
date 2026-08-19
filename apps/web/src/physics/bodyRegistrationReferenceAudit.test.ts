import { describe, expect, it } from "vitest";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import { buildAvatarParametricModel, resolveAvatarAnchor } from "../avatar/AvatarParametricModel";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { resolveSimulationBodyRegistration } from "./BodyCollisionRegistration";
import { deepestBodyContact, packAvatarCollisionModel, type SimulationBodyTransform } from "./bodyCollision";

describe("Prompt 11.0.1 body registration reference audit", () => {
  it("compares centroid, hip-top and waist-top registrations for the canonical straight skirt", () => {
    const garment = resolveTemplateAssemblyGarment(createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS, "feminine"));
    const input = buildResolvedAssemblyInput(garment);
    const result = buildCoarseIsometricAssembly(input.assemblyDocument);
    const avatar = buildAvatarParametricModel(input.assemblyDocument.measurements.values, input.assemblyDocument.body.type);
    const registration = resolveSimulationBodyRegistration(result.state, avatar);
    const instances = result.state.instances.map((instance) => {
      const anchor = resolveAvatarAnchor(avatar, instance.placement);
      const materialY = Array.from({ length: instance.vertexCount }, (_, local) => instance.topology.positions2DMm[local * 2 + 1]);
      const topY = Math.min(...materialY);
      const tolerance = Math.max(1, instance.topology.boundsMm.height * 0.015);
      const topLocals = materialY.map((value, local) => ({ value, local })).filter((entry) => entry.value <= topY + tolerance).map((entry) => entry.local);
      return {
        id: instance.id,
        placement: instance.placement,
        centroid: centroid(result.state.positions, instance.particleStart, Array.from({ length: instance.vertexCount }, (_, i) => i)),
        topBand: centroid(result.state.positions, instance.particleStart, topLocals),
        topLocals,
        topY,
        topCount: topLocals.length,
        anchor: anchor ? { id: anchor.id, position: anchor.position, normal: anchor.outwardNormal, axis: anchor.axis, tangent: anchor.tangent, margin: anchor.initialMarginM } : null,
      };
    });
    const allTopParticles = instances.flatMap((item, index) => item.topLocals.map((local) => ({ instance: result.state.instances[index], local })));
    const topCenter = centroidGlobal(result.state.positions, allTopParticles);
    const hipTransform: SimulationBodyTransform = { translation: [topCenter[0], topCenter[1] - avatar.landmarks.hipY, topCenter[2]], rotation: [0, 0, 0, 1] };
    const waistTransform: SimulationBodyTransform = { translation: [topCenter[0], topCenter[1] - avatar.landmarks.waistY, topCenter[2]], rotation: [0, 0, 0, 1] };
    const collisionModel = buildAvatarCollisionModel(avatar);
    const candidates = {
      centroid: penetrationAudit(result.state.positions, packAvatarCollisionModel(collisionModel, registration.transform)),
      hipTop: penetrationAudit(result.state.positions, packAvatarCollisionModel(collisionModel, hipTransform)),
      waistTop: penetrationAudit(result.state.positions, packAvatarCollisionModel(collisionModel, waistTransform)),
    };
    console.log("P1101_REGISTRATION_REFERENCES", JSON.stringify({
      transform: registration.transform,
      residualMeanM: registration.residualMeanM,
      residualMaxM: registration.residualMaxM,
      waistY: avatar.landmarks.waistY,
      hipY: avatar.landmarks.hipY,
      topCenter,
      hipTransform,
      waistTransform,
      candidates,
      instances: instances.map(({ topLocals: _topLocals, ...item }) => item),
    }));
    expect(registration.status).toBe("registered");
    expect(candidates.waistTop.max).toBeLessThan(candidates.centroid.max);
  }, 120_000);
});

function penetrationAudit(positions: Float32Array, colliders: ReturnType<typeof packAvatarCollisionModel>) {
  let count = 0;
  let total = 0;
  let max = 0;
  for (let particle = 0; particle < positions.length / 3; particle += 1) {
    const offset = particle * 3;
    const contact = deepestBodyContact([positions[offset], positions[offset + 1], positions[offset + 2]], colliders);
    if (!contact) continue;
    count += 1;
    total += contact.penetrationM;
    max = Math.max(max, contact.penetrationM);
  }
  return { count, mean: count > 0 ? total / count : 0, max };
}

function centroidGlobal(
  positions: Float32Array,
  points: readonly { instance: { particleStart: number }; local: number }[],
): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  const count = Math.max(1, points.length);
  for (const point of points) {
    const offset = (point.instance.particleStart + point.local) * 3;
    result[0] += positions[offset];
    result[1] += positions[offset + 1];
    result[2] += positions[offset + 2];
  }
  return [result[0] / count, result[1] / count, result[2] / count];
}

function centroid(positions: Float32Array, start: number, locals: readonly number[]): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  const count = Math.max(1, locals.length);
  for (const local of locals) {
    const offset = (start + local) * 3;
    result[0] += positions[offset];
    result[1] += positions[offset + 1];
    result[2] += positions[offset + 2];
  }
  return [result[0] / count, result[1] / count, result[2] / count];
}
