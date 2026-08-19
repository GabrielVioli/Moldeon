import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel, sampleTorsoAxes } from "../avatar/AvatarParametricModel";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";

describe("Prompt 11.0.1 lower-shell fit audit", () => {
  it("compares the assembled upper opening against avatar waist/hip cross-sections", () => {
    const garment = resolveTemplateAssemblyGarment(createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS, "feminine"));
    const input = buildResolvedAssemblyInput(garment);
    const result = buildCoarseIsometricAssembly(input.assemblyDocument);
    const avatar = buildAvatarParametricModel(input.assemblyDocument.measurements.values, input.assemblyDocument.body.type);
    const waist = sampleTorsoAxes(avatar, avatar.landmarks.waistY);
    const hip = sampleTorsoAxes(avatar, avatar.landmarks.hipY);

    const worldTop = maxWorldY(result.state.positions);
    const shellHeight = worldTop - minWorldY(result.state.positions);
    const bandTolerance = Math.max(0.004, shellHeight * 0.025);
    const points: Array<[number, number]> = [];
    for (let particle = 0; particle < result.state.positions.length / 3; particle += 1) {
      const offset = particle * 3;
      if (result.state.positions[offset + 1] < worldTop - bandTolerance) continue;
      points.push([result.state.positions[offset], result.state.positions[offset + 2]]);
    }
    const centerX = points.reduce((sum, point) => sum + point[0], 0) / Math.max(1, points.length);
    const centerZ = points.reduce((sum, point) => sum + point[1], 0) / Math.max(1, points.length);
    let minRadial = Infinity;
    let maxRadial = 0;
    let sumRadial = 0;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const point of points) {
      const radial = Math.hypot(point[0] - centerX, point[1] - centerZ);
      minRadial = Math.min(minRadial, radial);
      maxRadial = Math.max(maxRadial, radial);
      sumRadial += radial;
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
      minZ = Math.min(minZ, point[1]); maxZ = Math.max(maxZ, point[1]);
    }
    const opening = {
      count: points.length,
      centerX,
      centerZ,
      worldTop,
      bandTolerance,
      halfWidth: (maxX - minX) * 0.5,
      halfDepth: (maxZ - minZ) * 0.5,
      minRadial: Number.isFinite(minRadial) ? minRadial : 0,
      meanRadial: points.length > 0 ? sumRadial / points.length : 0,
      maxRadial,
    };
    console.log("P1101_LOWER_SHELL_FIT", JSON.stringify({ opening, waist, hip, waistMm: input.assemblyDocument.measurements.values.waistMm, hipMm: input.assemblyDocument.measurements.values.hipMm }));
    expect(points.length).toBeGreaterThan(0);
  }, 120_000);
});

function maxWorldY(positions: Float32Array): number {
  let value = -Infinity;
  for (let offset = 1; offset < positions.length; offset += 3) value = Math.max(value, positions[offset]);
  return value;
}
function minWorldY(positions: Float32Array): number {
  let value = Infinity;
  for (let offset = 1; offset < positions.length; offset += 3) value = Math.min(value, positions[offset]);
  return value;
}
