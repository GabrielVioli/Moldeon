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
import { XPBD_MISSING_PARTICLE, measureXpbdDiagnostics, stepXpbd, type XpbdState } from "./xpbd";

describe("Prompt 11.0.1 seam projection clamp audit", () => {
  it("measures requested versus allowed corrections for the worst hard seams", () => {
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

    const snapshots: unknown[] = [];
    for (let step = 1; step <= 32; step += 1) {
      stepXpbd(state);
      if (![1, 8, 16, 24, 32].includes(step)) continue;
      const diagnostics = measureXpbdDiagnostics(state, 1);
      snapshots.push({
        step,
        bodyContacts: diagnostics.bodyContactCount ?? 0,
        bodyCorrectionM: diagnostics.maximumBodyCorrectionM ?? 0,
        side: worstInGroup(state, "template-seam:skirt-side"),
        dart: worstMatching(state, (groupId) => groupId.startsWith("dart:")),
      });
    }

    console.log("P1101_SEAM_CLAMP", JSON.stringify({ normalIterations, snapshots }));
    expect(state.invalid).toBe(false);
    expect(snapshots).toHaveLength(5);
  }, 120_000);
});

function worstInGroup(state: XpbdState, groupId: string) {
  return worstMatching(state, (candidate) => candidate === groupId);
}

function worstMatching(state: XpbdState, predicate: (groupId: string) => boolean) {
  let best: ReturnType<typeof inspectConstraint> | null = null;
  for (let index = 0; index < state.seams.restDistances.length; index += 1) {
    if (!predicate(state.seams.seamGroupIds[index] ?? "")) continue;
    const inspected = inspectConstraint(state, index);
    if (!best || inspected.errorM > best.errorM) best = inspected;
  }
  return best;
}

function inspectConstraint(state: XpbdState, index: number) {
  const base = index * 4;
  const particles = [
    state.seams.indices[base],
    state.seams.indices[base + 1],
    state.seams.indices[base + 2],
    state.seams.indices[base + 3],
  ];
  const weights = [
    state.seams.weights[base],
    state.seams.weights[base + 1],
    state.seams.weights[base + 2],
    state.seams.weights[base + 3],
  ];
  const a = interpolatedPoint(state.positions, particles, weights, 0);
  const b = interpolatedPoint(state.positions, particles, weights, 2);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const distanceM = Math.hypot(dx, dy, dz);
  const restM = state.seams.restDistances[index];
  const coefficients = [-weights[0], -weights[1], weights[2], weights[3]];
  mergeDuplicateCoefficients(particles, coefficients);

  let mass = 0;
  let maximumMultiplier = Number.POSITIVE_INFINITY;
  const relaxation = state.seams.relaxations[index];
  const slots = particles.map((particle, slot) => {
    const coefficient = coefficients[slot];
    if (particle === XPBD_MISSING_PARTICLE || Math.abs(coefficient) <= 1e-9) {
      return { particle, coefficient, inverseMass: 0, correctionLimitM: 0, multiplierLimit: null };
    }
    const inverseMass = state.inverseMasses[particle];
    mass += inverseMass * coefficient * coefficient;
    const weightedGradient = inverseMass * Math.abs(coefficient);
    const correctionLimitM = state.correctionLimits[particle];
    const multiplierLimit = weightedGradient > 1e-9
      ? correctionLimitM * relaxation / weightedGradient
      : Number.POSITIVE_INFINITY;
    maximumMultiplier = Math.min(maximumMultiplier, multiplierLimit);
    return { particle, coefficient, inverseMass, correctionLimitM, multiplierLimit };
  });

  const dt = state.config.fixedTimeStep;
  const compliance = state.seams.compliances[index];
  const alpha = Math.max(0, compliance) / (dt * dt);
  const lambda = state.seams.lambdas[index];
  const denominator = mass + alpha;
  const rawDeltaLambda = denominator > 1e-9
    ? (-(distanceM - restM) - alpha * lambda) / denominator
    : 0;
  const finiteMaximum = Number.isFinite(maximumMultiplier) ? maximumMultiplier : 0;
  const clampedDeltaLambda = clampSigned(rawDeltaLambda, finiteMaximum);
  const requestedMaximumParticleCorrectionM = maximumParticleCorrection(slots, rawDeltaLambda);
  const allowedMaximumParticleCorrectionM = maximumParticleCorrection(slots, clampedDeltaLambda);

  return {
    index,
    groupId: state.seams.seamGroupIds[index],
    distanceM,
    restM,
    errorM: Math.abs(distanceM - restM),
    compliance,
    relaxation,
    lambda,
    mass,
    alpha,
    rawDeltaLambda,
    maximumMultiplier: finiteMaximum,
    clampedDeltaLambda,
    clampRatio: Math.abs(rawDeltaLambda) > 1e-12 ? Math.abs(clampedDeltaLambda / rawDeltaLambda) : 1,
    requestedMaximumParticleCorrectionM,
    allowedMaximumParticleCorrectionM,
    slots,
  };
}

function interpolatedPoint(
  positions: Float32Array,
  particles: readonly number[],
  weights: readonly number[],
  start: 0 | 2,
): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let slot = start; slot < start + 2; slot += 1) {
    const particle = particles[slot];
    if (particle === XPBD_MISSING_PARTICLE) continue;
    const offset = particle * 3;
    result[0] += positions[offset] * weights[slot];
    result[1] += positions[offset + 1] * weights[slot];
    result[2] += positions[offset + 2] * weights[slot];
  }
  return result;
}

function mergeDuplicateCoefficients(particles: readonly number[], coefficients: number[]): void {
  for (let slot = 1; slot < particles.length; slot += 1) {
    const particle = particles[slot];
    if (particle === XPBD_MISSING_PARTICLE || Math.abs(coefficients[slot]) <= 1e-9) continue;
    for (let previous = 0; previous < slot; previous += 1) {
      if (particles[previous] !== particle || Math.abs(coefficients[previous]) <= 1e-9) continue;
      coefficients[previous] += coefficients[slot];
      coefficients[slot] = 0;
      break;
    }
  }
}

function maximumParticleCorrection(
  slots: readonly { inverseMass: number; coefficient: number }[],
  deltaLambda: number,
): number {
  let maximum = 0;
  for (const slot of slots) {
    maximum = Math.max(maximum, Math.abs(deltaLambda * slot.inverseMass * slot.coefficient));
  }
  return maximum;
}

function clampSigned(value: number, maximumAbsolute: number): number {
  return Math.min(maximumAbsolute, Math.max(-maximumAbsolute, value));
}
