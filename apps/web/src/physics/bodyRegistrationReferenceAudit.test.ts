import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel, resolveAvatarAnchor } from "../avatar/AvatarParametricModel";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { resolveSimulationBodyRegistration } from "./BodyCollisionRegistration";

describe("Prompt 11.0.1 body registration reference audit", () => {
  it("prints centroid/top-band references for the canonical straight skirt", () => {
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
        topY,
        topCount: topLocals.length,
        anchor: anchor ? { id: anchor.id, position: anchor.position, normal: anchor.outwardNormal, axis: anchor.axis, tangent: anchor.tangent, margin: anchor.initialMarginM } : null,
      };
    });
    console.log("P1101_REGISTRATION_REFERENCES", JSON.stringify({ transform: registration.transform, residualMeanM: registration.residualMeanM, residualMaxM: registration.residualMaxM, waistY: avatar.landmarks.waistY, hipY: avatar.landmarks.hipY, instances }));
    expect(registration.status).toBe("registered");
  }, 120_000);
});

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
