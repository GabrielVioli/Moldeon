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

describe("Prompt 11.0.1 waistband constraint strain audit", () => {
  it("localizes expansion to material stretch or seam opening", () => {
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
    const upperBand = new Set(selectUpperBand(state.positions));

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

    const checkpoints = new Set([0, 1, 4, 8, 12, 16, 24, 32, 40, 60]);
    const snapshots: unknown[] = [];
    for (let step = 0; step <= 60; step += 1) {
      if (checkpoints.has(step)) {
        const diagnostics = measureXpbdDiagnostics(state, step === 0 ? 0 : 1);
        snapshots.push({
          step,
          bodyContacts: diagnostics.bodyContactCount ?? 0,
          bodyRegions: diagnostics.bodyContactsByRegion ?? {},
          maximumBodyCorrectionM: diagnostics.maximumBodyCorrectionM ?? 0,
          band: bandBounds(state.positions, [...upperBand]),
          stretch: upperBandStretchAudit(state, upperBand),
          seams: seamAudit(state),
        });
      }
      if (step < 60) stepXpbd(state);
    }

    console.log("P1101_WAIST_CONSTRAINT_STRAIN", JSON.stringify({
      normalIterations,
      upperBandParticles: upperBand.size,
      snapshots,
    }));
    expect(state.invalid).toBe(false);
    expect(snapshots).toHaveLength(checkpoints.size);
  }, 120_000);
});

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
  let minX = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxZ = -Infinity;
  for (const particle of particles) {
    const offset = particle * 3;
    minX = Math.min(minX, positions[offset]); maxX = Math.max(maxX, positions[offset]);
    minZ = Math.min(minZ, positions[offset + 2]); maxZ = Math.max(maxZ, positions[offset + 2]);
  }
  return {
    halfWidth: (maxX - minX) * 0.5,
    halfDepth: (maxZ - minZ) * 0.5,
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
  };
}

function upperBandStretchAudit(
  state: ReturnType<typeof createXpbdWorkerState>,
  upperBand: ReadonlySet<number>,
) {
  let count = 0;
  let meanAbsoluteStrain = 0;
  let maximumAbsoluteStrain = 0;
  let maximumExtensionM = 0;
  const worst: Array<{ index: number; a: number; b: number; restM: number; currentM: number; strain: number }> = [];
  for (let index = 0; index < state.distances.restLengths.length; index += 1) {
    if (state.distances.kinds[index] !== 0) continue;
    const a = state.distances.indices[index * 2];
    const b = state.distances.indices[index * 2 + 1];
    if (!upperBand.has(a) && !upperBand.has(b)) continue;
    const currentM = particleDistance(state.positions, a, b);
    const restM = state.distances.restLengths[index];
    const strain = restM > 1e-9 ? (currentM - restM) / restM : 0;
    const absolute = Math.abs(strain);
    count += 1;
    meanAbsoluteStrain += absolute;
    maximumAbsoluteStrain = Math.max(maximumAbsoluteStrain, absolute);
    maximumExtensionM = Math.max(maximumExtensionM, currentM - restM);
    worst.push({ index, a, b, restM, currentM, strain });
  }
  worst.sort((left, right) => Math.abs(right.strain) - Math.abs(left.strain));
  return {
    count,
    meanAbsoluteStrain: count > 0 ? meanAbsoluteStrain / count : 0,
    maximumAbsoluteStrain,
    maximumExtensionM,
    worst: worst.slice(0, 8),
  };
}

function seamAudit(state: ReturnType<typeof createXpbdWorkerState>) {
  const byGroup: Record<string, { count: number; meanErrorM: number; maxErrorM: number; worstConstraintIndex: number }> = {};
  for (let index = 0; index < state.seams.restDistances.length; index += 1) {
    const currentM = seamDistance(state, index);
    const errorM = Math.abs(currentM - state.seams.restDistances[index]);
    const groupId = state.seams.seamGroupIds[index] ?? `ungrouped:${index}`;
    const group = byGroup[groupId] ?? { count: 0, meanErrorM: 0, maxErrorM: 0, worstConstraintIndex: index };
    group.count += 1;
    group.meanErrorM += errorM;
    if (errorM > group.maxErrorM) {
      group.maxErrorM = errorM;
      group.worstConstraintIndex = index;
    }
    byGroup[groupId] = group;
  }
  for (const group of Object.values(byGroup)) group.meanErrorM /= Math.max(1, group.count);
  const sorted = Object.entries(byGroup)
    .sort((left, right) => right[1].maxErrorM - left[1].maxErrorM)
    .map(([groupId, value]) => ({ groupId, ...value }));
  return {
    darts: sorted.filter((entry) => entry.groupId.startsWith("dart:")).slice(0, 8),
    nonDarts: sorted.filter((entry) => !entry.groupId.startsWith("dart:")).slice(0, 8),
  };
}

function seamDistance(state: ReturnType<typeof createXpbdWorkerState>, index: number): number {
  const base = index * 4;
  const a0 = state.seams.indices[base];
  const a1 = state.seams.indices[base + 1];
  const b0 = state.seams.indices[base + 2];
  const b1 = state.seams.indices[base + 3];
  const wa0 = state.seams.weights[base];
  const wa1 = state.seams.weights[base + 1];
  const wb0 = state.seams.weights[base + 2];
  const wb1 = state.seams.weights[base + 3];
  const ax = weighted(state.positions, a0, wa0, a1, wa1, 0);
  const ay = weighted(state.positions, a0, wa0, a1, wa1, 1);
  const az = weighted(state.positions, a0, wa0, a1, wa1, 2);
  const bx = weighted(state.positions, b0, wb0, b1, wb1, 0);
  const by = weighted(state.positions, b0, wb0, b1, wb1, 1);
  const bz = weighted(state.positions, b0, wb0, b1, wb1, 2);
  return Math.hypot(bx - ax, by - ay, bz - az);
}

function weighted(
  positions: Float32Array,
  first: number,
  firstWeight: number,
  second: number,
  secondWeight: number,
  component: number,
): number {
  const firstValue = first === 0xffffffff ? 0 : positions[first * 3 + component] * firstWeight;
  const secondValue = second === 0xffffffff ? 0 : positions[second * 3 + component] * secondWeight;
  return firstValue + secondValue;
}

function particleDistance(positions: Float32Array, a: number, b: number): number {
  const oa = a * 3;
  const ob = b * 3;
  return Math.hypot(
    positions[ob] - positions[oa],
    positions[ob + 1] - positions[oa + 1],
    positions[ob + 2] - positions[oa + 2],
  );
}
