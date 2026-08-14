export const XPBD_MISSING_PARTICLE = 0xffffffff;

export interface XpbdDistanceConstraints {
  indices: Uint32Array;
  restLengths: Float32Array;
  compliances: Float32Array;
  lambdas: Float32Array;
  /** 0 = warp/weft stretch, 1 = bending spring. */
  kinds: Uint8Array;
}

export interface XpbdShearConstraints {
  indices: Uint32Array;
  restCosines: Float32Array;
  compliances: Float32Array;
  lambdas: Float32Array;
}

export interface XpbdSeamConstraints {
  /** Four particle slots per constraint: A0, A1, B0, B1. */
  indices: Uint32Array;
  weights: Float32Array;
  restDistances: Float32Array;
  compliances: Float32Array;
  relaxations: Float32Array;
  lambdas: Float32Array;
  seamGroupIds: string[];
}

export interface XpbdPinConstraints {
  indices: Uint32Array;
  targets: Float32Array;
}

export interface XpbdSolverConfig {
  fixedTimeStep: number;
  maximumFrameDelta: number;
  maximumSubsteps: number;
  iterations: number;
  damping: number;
  gravity: readonly [number, number, number];
  maximumCorrection: number;
  maximumVelocity: number;
  seamTolerance: number;
}

export interface XpbdState {
  positions: Float32Array;
  previousPositions: Float32Array;
  predictedPositions: Float32Array;
  velocities: Float32Array;
  inverseMasses: Float32Array;
  restPositions: Float32Array;
  materialCoordinates: Float32Array;
  triangles: Uint32Array;
  distances: XpbdDistanceConstraints;
  shears: XpbdShearConstraints;
  seams: XpbdSeamConstraints;
  pins: XpbdPinConstraints;
  /** Trust region por partícula derivado da menor aresta estrutural local. */
  correctionLimits: Float32Array;
  stablePositions: Float32Array;
  maximumCorrectionApplied: number;
  config: XpbdSolverConfig;
  accumulator: number;
  stepCount: number;
  invalid: boolean;
}

export interface XpbdStepDiagnostics {
  stepCount: number;
  substeps: number;
  particleCount: number;
  triangleCount: number;
  stretchConstraintCount: number;
  shearConstraintCount: number;
  bendConstraintCount: number;
  seamConstraintCount: number;
  seamErrorAverage: number;
  seamErrorMaximum: number;
  maximumPositionMagnitude: number;
  maximumVelocityMagnitude: number;
  maximumCorrectionApplied: number;
  invalid: boolean;
  droppedTimeSeconds: number;
}

export const DEFAULT_XPBD_CONFIG: XpbdSolverConfig = {
  fixedTimeStep: 1 / 120,
  maximumFrameDelta: 1 / 20,
  maximumSubsteps: 6,
  iterations: 8,
  damping: 0.996,
  gravity: [0, -9.81, 0],
  maximumCorrection: 0.035,
  maximumVelocity: 12,
  seamTolerance: 0.0025,
};

const EPSILON = 1e-9;

export function createXpbdState(
  input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid">,
): XpbdState {
  validateStateShape(input);
  return {
    ...input,
    correctionLimits: buildParticleCorrectionLimits(
      input.positions.length / 3,
      input.distances,
      input.config.maximumCorrection,
    ),
    stablePositions: new Float32Array(input.positions),
    maximumCorrectionApplied: 0,
    accumulator: 0,
    stepCount: 0,
    invalid: false,
  };
}

export function advanceXpbd(state: XpbdState, frameDeltaSeconds: number): XpbdStepDiagnostics {
  const finiteDelta = Number.isFinite(frameDeltaSeconds) ? Math.max(0, frameDeltaSeconds) : 0;
  const acceptedDelta = Math.min(finiteDelta, state.config.maximumFrameDelta);
  const droppedTimeSeconds = Math.max(0, finiteDelta - acceptedDelta);
  state.accumulator += acceptedDelta;
  let substeps = 0;

  while (
    state.accumulator + EPSILON >= state.config.fixedTimeStep
    && substeps < state.config.maximumSubsteps
  ) {
    stepXpbd(state);
    state.accumulator -= state.config.fixedTimeStep;
    substeps += 1;
    if (state.invalid) break;
  }

  if (substeps === state.config.maximumSubsteps && state.accumulator >= state.config.fixedTimeStep) {
    state.accumulator %= state.config.fixedTimeStep;
  }

  return measureXpbdDiagnostics(state, substeps, droppedTimeSeconds);
}

export function stepXpbd(state: XpbdState): void {
  const dt = state.config.fixedTimeStep;
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("O passo da simula\u00e7\u00e3o precisa ser positivo e finito.");

  state.previousPositions.set(state.positions);
  state.maximumCorrectionApplied = 0;
  resetLambdas(state);
  integrate(state, dt);

  for (let iteration = 0; iteration < state.config.iterations; iteration += 1) {
    solveDistanceSet(state, dt, 0);
    solveShearSet(state, dt);
    solveDistanceSet(state, dt, 1);
    solveSeamSet(state, dt);
    enforcePins(state);
  }

  updateVelocitiesAndPositions(state, dt);
  state.stepCount += 1;

  if (!positionsAreSafe(state.positions)) {
    state.positions.set(state.stablePositions);
    state.previousPositions.set(state.stablePositions);
    state.predictedPositions.set(state.stablePositions);
    state.velocities.fill(0);
    state.invalid = true;
    return;
  }

  state.stablePositions.set(state.positions);
  state.invalid = false;
}

export function resetXpbdState(state: XpbdState): void {
  state.positions.set(state.restPositions);
  state.previousPositions.set(state.restPositions);
  state.predictedPositions.set(state.restPositions);
  state.stablePositions.set(state.restPositions);
  state.velocities.fill(0);
  state.accumulator = 0;
  state.stepCount = 0;
  state.maximumCorrectionApplied = 0;
  state.invalid = false;
  resetLambdas(state);
  enforcePinsOn(state.positions, state.pins);
  enforcePinsOn(state.previousPositions, state.pins);
  enforcePinsOn(state.predictedPositions, state.pins);
  state.stablePositions.set(state.positions);
}

export function measureXpbdDiagnostics(
  state: XpbdState,
  substeps = 0,
  droppedTimeSeconds = 0,
): XpbdStepDiagnostics {
  let seamErrorSum = 0;
  let seamErrorMaximum = 0;
  const seamCount = state.seams.restDistances.length;
  for (let index = 0; index < seamCount; index += 1) {
    const distance = seamDistance(state.positions, state.seams, index);
    const error = Math.abs(distance - state.seams.restDistances[index]);
    seamErrorSum += error;
    seamErrorMaximum = Math.max(seamErrorMaximum, error);
  }
  let bendConstraintCount = 0;
  for (const kind of state.distances.kinds) if (kind === 1) bendConstraintCount += 1;
  let maximumPositionMagnitude = 0;
  let maximumVelocityMagnitude = 0;
  for (let particle = 0; particle < state.inverseMasses.length; particle += 1) {
    const offset = particle * 3;
    maximumPositionMagnitude = Math.max(maximumPositionMagnitude, Math.hypot(
      state.positions[offset],
      state.positions[offset + 1],
      state.positions[offset + 2],
    ));
    maximumVelocityMagnitude = Math.max(maximumVelocityMagnitude, Math.hypot(
      state.velocities[offset],
      state.velocities[offset + 1],
      state.velocities[offset + 2],
    ));
  }
  return {
    stepCount: state.stepCount,
    substeps,
    particleCount: state.positions.length / 3,
    triangleCount: state.triangles.length / 3,
    stretchConstraintCount: state.distances.restLengths.length - bendConstraintCount,
    shearConstraintCount: state.shears.restCosines.length,
    bendConstraintCount,
    seamConstraintCount: seamCount,
    seamErrorAverage: seamCount > 0 ? seamErrorSum / seamCount : 0,
    seamErrorMaximum,
    maximumPositionMagnitude,
    maximumVelocityMagnitude,
    maximumCorrectionApplied: state.maximumCorrectionApplied,
    invalid: state.invalid,
    droppedTimeSeconds,
  };
}

function integrate(state: XpbdState, dt: number): void {
  const [gx, gy, gz] = state.config.gravity;
  const dtSquared = dt * dt;
  for (let particle = 0; particle < state.inverseMasses.length; particle += 1) {
    const offset = particle * 3;
    if (state.inverseMasses[particle] <= 0) {
      state.predictedPositions[offset] = state.positions[offset];
      state.predictedPositions[offset + 1] = state.positions[offset + 1];
      state.predictedPositions[offset + 2] = state.positions[offset + 2];
      state.velocities[offset] = 0;
      state.velocities[offset + 1] = 0;
      state.velocities[offset + 2] = 0;
      continue;
    }
    state.predictedPositions[offset] = state.positions[offset] + state.velocities[offset] * dt + gx * dtSquared;
    state.predictedPositions[offset + 1] = state.positions[offset + 1] + state.velocities[offset + 1] * dt + gy * dtSquared;
    state.predictedPositions[offset + 2] = state.positions[offset + 2] + state.velocities[offset + 2] * dt + gz * dtSquared;
  }
  enforcePins(state);
}

function solveDistanceSet(state: XpbdState, dt: number, kind: 0 | 1): void {
  const set = state.distances;
  for (let index = 0; index < set.restLengths.length; index += 1) {
    if (set.kinds[index] !== kind) continue;
    const a = set.indices[index * 2];
    const b = set.indices[index * 2 + 1];
    solvePairDistance(
      state,
      a,
      b,
      set.restLengths[index],
      set.compliances[index],
      set.lambdas,
      index,
      dt,
    );
  }
}

function solvePairDistance(
  state: XpbdState,
  a: number,
  b: number,
  restLength: number,
  compliance: number,
  lambdas: Float32Array,
  lambdaIndex: number,
  dt: number,
): void {
  const positions = state.predictedPositions;
  const aOffset = a * 3;
  const bOffset = b * 3;
  const dx = positions[bOffset] - positions[aOffset];
  const dy = positions[bOffset + 1] - positions[aOffset + 1];
  const dz = positions[bOffset + 2] - positions[aOffset + 2];
  const length = Math.hypot(dx, dy, dz);
  if (length <= EPSILON) return;
  const wA = state.inverseMasses[a];
  const wB = state.inverseMasses[b];
  const alpha = Math.max(0, compliance) / (dt * dt);
  const denominator = wA + wB + alpha;
  if (denominator <= EPSILON) return;
  const constraint = length - restLength;
  const rawDeltaLambda = (-constraint - alpha * lambdas[lambdaIndex]) / denominator;
  const deltaLambda = clampMultiplierByPositionCorrection(
    rawDeltaLambda,
    maximumMultiplierForParticleCorrections(state, [
      [a, 1],
      [b, 1],
    ]),
  );
  lambdas[lambdaIndex] += deltaLambda;
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;
  positions[aOffset] -= nx * deltaLambda * wA;
  positions[aOffset + 1] -= ny * deltaLambda * wA;
  positions[aOffset + 2] -= nz * deltaLambda * wA;
  positions[bOffset] += nx * deltaLambda * wB;
  positions[bOffset + 1] += ny * deltaLambda * wB;
  positions[bOffset + 2] += nz * deltaLambda * wB;
  state.maximumCorrectionApplied = Math.max(
    state.maximumCorrectionApplied,
    Math.abs(deltaLambda) * Math.max(wA, wB),
  );
}

function solveShearSet(state: XpbdState, dt: number): void {
  const set = state.shears;
  const positions = state.predictedPositions;
  for (let index = 0; index < set.restCosines.length; index += 1) {
    const p0 = set.indices[index * 3];
    const p1 = set.indices[index * 3 + 1];
    const p2 = set.indices[index * 3 + 2];
    const o0 = p0 * 3;
    const o1 = p1 * 3;
    const o2 = p2 * 3;
    const e1x = positions[o1] - positions[o0];
    const e1y = positions[o1 + 1] - positions[o0 + 1];
    const e1z = positions[o1 + 2] - positions[o0 + 2];
    const e2x = positions[o2] - positions[o0];
    const e2y = positions[o2 + 1] - positions[o0 + 1];
    const e2z = positions[o2 + 2] - positions[o0 + 2];
    const l1 = Math.hypot(e1x, e1y, e1z);
    const l2 = Math.hypot(e2x, e2y, e2z);
    if (l1 <= EPSILON || l2 <= EPSILON) continue;
    const u = [e1x / l1, e1y / l1, e1z / l1] as const;
    const v = [e2x / l2, e2y / l2, e2z / l2] as const;
    const cosine = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const g1 = [(v[0] - cosine * u[0]) / l1, (v[1] - cosine * u[1]) / l1, (v[2] - cosine * u[2]) / l1] as const;
    const g2 = [(u[0] - cosine * v[0]) / l2, (u[1] - cosine * v[1]) / l2, (u[2] - cosine * v[2]) / l2] as const;
    const g0 = [-(g1[0] + g2[0]), -(g1[1] + g2[1]), -(g1[2] + g2[2])] as const;
    const w0 = state.inverseMasses[p0];
    const w1 = state.inverseMasses[p1];
    const w2 = state.inverseMasses[p2];
    const alpha = Math.max(0, set.compliances[index]) / (dt * dt);
    const denominator = w0 * lengthSquared(g0) + w1 * lengthSquared(g1) + w2 * lengthSquared(g2) + alpha;
    if (denominator <= EPSILON) continue;
    const rawDeltaLambda = (-(cosine - set.restCosines[index]) - alpha * set.lambdas[index]) / denominator;
    const deltaLambda = clampMultiplierByPositionCorrection(
      rawDeltaLambda,
      maximumMultiplierForParticleCorrections(state, [
        [p0, Math.sqrt(lengthSquared(g0))],
        [p1, Math.sqrt(lengthSquared(g1))],
        [p2, Math.sqrt(lengthSquared(g2))],
      ]),
    );
    set.lambdas[index] += deltaLambda;
    applyGradient(positions, o0, g0, deltaLambda * w0);
    applyGradient(positions, o1, g1, deltaLambda * w1);
    applyGradient(positions, o2, g2, deltaLambda * w2);
    state.maximumCorrectionApplied = Math.max(
      state.maximumCorrectionApplied,
      Math.abs(deltaLambda) * Math.max(
        w0 * Math.sqrt(lengthSquared(g0)),
        w1 * Math.sqrt(lengthSquared(g1)),
        w2 * Math.sqrt(lengthSquared(g2)),
      ),
    );
  }
}

function solveSeamSet(state: XpbdState, dt: number): void {
  const seams = state.seams;
  const positions = state.predictedPositions;
  for (let index = 0; index < seams.restDistances.length; index += 1) {
    const base = index * 4;
    const a = interpolatedPoint(positions, seams.indices, seams.weights, base);
    const b = interpolatedPoint(positions, seams.indices, seams.weights, base + 2);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length <= EPSILON) continue;
    const gradientEntries = seamGradientEntries(seams, base);
    let effectiveMass = 0;
    for (const [particle, coefficient] of gradientEntries) {
      effectiveMass += state.inverseMasses[particle] * coefficient * coefficient;
    }
    const alpha = Math.max(0, seams.compliances[index]) / (dt * dt);
    const denominator = effectiveMass + alpha;
    if (denominator <= EPSILON) continue;
    const rawDeltaLambda = (-(length - seams.restDistances[index]) - alpha * seams.lambdas[index]) / denominator;
    const deltaLambda = clampMultiplierByPositionCorrection(
      rawDeltaLambda,
      maximumMultiplierForParticleCorrections(
        state,
        gradientEntries.map(([particle, coefficient]) => [particle, Math.abs(coefficient)]),
        seams.relaxations[index],
      ),
    );
    seams.lambdas[index] += deltaLambda;
    const normal = [dx / length, dy / length, dz / length] as const;
    for (const [particle, coefficient] of gradientEntries) {
      const scale = deltaLambda * coefficient * state.inverseMasses[particle];
      const offset = particle * 3;
      state.predictedPositions[offset] += normal[0] * scale;
      state.predictedPositions[offset + 1] += normal[1] * scale;
      state.predictedPositions[offset + 2] += normal[2] * scale;
      state.maximumCorrectionApplied = Math.max(state.maximumCorrectionApplied, Math.abs(scale));
    }
  }
}

function updateVelocitiesAndPositions(state: XpbdState, dt: number): void {
  const maximumVelocity = state.config.maximumVelocity;
  for (let particle = 0; particle < state.inverseMasses.length; particle += 1) {
    const offset = particle * 3;
    if (state.inverseMasses[particle] <= 0) {
      state.velocities[offset] = 0;
      state.velocities[offset + 1] = 0;
      state.velocities[offset + 2] = 0;
      state.positions[offset] = state.predictedPositions[offset];
      state.positions[offset + 1] = state.predictedPositions[offset + 1];
      state.positions[offset + 2] = state.predictedPositions[offset + 2];
      continue;
    }
    let vx = (state.predictedPositions[offset] - state.positions[offset]) / dt * state.config.damping;
    let vy = (state.predictedPositions[offset + 1] - state.positions[offset + 1]) / dt * state.config.damping;
    let vz = (state.predictedPositions[offset + 2] - state.positions[offset + 2]) / dt * state.config.damping;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > maximumVelocity) {
      const scale = maximumVelocity / speed;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }
    state.velocities[offset] = vx;
    state.velocities[offset + 1] = vy;
    state.velocities[offset + 2] = vz;
    state.positions[offset] = state.predictedPositions[offset];
    state.positions[offset + 1] = state.predictedPositions[offset + 1];
    state.positions[offset + 2] = state.predictedPositions[offset + 2];
  }
}

function enforcePins(state: XpbdState): void {
  enforcePinsOn(state.predictedPositions, state.pins);
}

function enforcePinsOn(positions: Float32Array, pins: XpbdPinConstraints): void {
  for (let index = 0; index < pins.indices.length; index += 1) {
    const offset = pins.indices[index] * 3;
    positions[offset] = pins.targets[index * 3];
    positions[offset + 1] = pins.targets[index * 3 + 1];
    positions[offset + 2] = pins.targets[index * 3 + 2];
  }
}

function resetLambdas(state: XpbdState): void {
  state.distances.lambdas.fill(0);
  state.shears.lambdas.fill(0);
  state.seams.lambdas.fill(0);
}

function seamDistance(positions: Float32Array, seams: XpbdSeamConstraints, index: number): number {
  const base = index * 4;
  const a = interpolatedPoint(positions, seams.indices, seams.weights, base);
  const b = interpolatedPoint(positions, seams.indices, seams.weights, base + 2);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function interpolatedPoint(
  positions: Float32Array,
  indices: Uint32Array,
  weights: Float32Array,
  base: number,
): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let slot = 0; slot < 2; slot += 1) {
    const particle = indices[base + slot];
    if (particle === XPBD_MISSING_PARTICLE) continue;
    const weight = weights[base + slot];
    const offset = particle * 3;
    result[0] += positions[offset] * weight;
    result[1] += positions[offset + 1] * weight;
    result[2] += positions[offset + 2] * weight;
  }
  return result;
}

function validateStateShape(input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid">): void {
  const particleCount = input.positions.length / 3;
  if (!Number.isInteger(particleCount)
    || input.previousPositions.length !== input.positions.length
    || input.predictedPositions.length !== input.positions.length
    || input.velocities.length !== input.positions.length
    || input.restPositions.length !== input.positions.length
    || input.materialCoordinates.length !== particleCount * 2
    || input.inverseMasses.length !== particleCount
    || input.triangles.length % 3 !== 0) {
    throw new RangeError("Os buffers SoA da simula\u00e7\u00e3o possuem dimens\u00f5es incompat\u00edveis.");
  }
  if (input.distances.indices.length !== input.distances.restLengths.length * 2
    || input.distances.compliances.length !== input.distances.restLengths.length
    || input.distances.lambdas.length !== input.distances.restLengths.length
    || input.distances.kinds.length !== input.distances.restLengths.length
    || input.shears.indices.length !== input.shears.restCosines.length * 3
    || input.shears.compliances.length !== input.shears.restCosines.length
    || input.shears.lambdas.length !== input.shears.restCosines.length
    || input.seams.indices.length !== input.seams.restDistances.length * 4
    || input.seams.weights.length !== input.seams.restDistances.length * 4
    || input.seams.compliances.length !== input.seams.restDistances.length
    || input.seams.relaxations.length !== input.seams.restDistances.length
    || input.seams.lambdas.length !== input.seams.restDistances.length
    || input.seams.seamGroupIds.length !== input.seams.restDistances.length
    || input.pins.targets.length !== input.pins.indices.length * 3) {
    throw new RangeError("As constraints XPBD possuem buffers incompat\u00edveis.");
  }
  assertParticleIndices(input.triangles, particleCount, false, "tri\u00e2ngulos");
  assertParticleIndices(input.distances.indices, particleCount, false, "stretch/bend");
  assertParticleIndices(input.shears.indices, particleCount, false, "shear");
  assertParticleIndices(input.seams.indices, particleCount, true, "seams");
  assertParticleIndices(input.pins.indices, particleCount, false, "pins");
  for (const values of [
    input.positions,
    input.previousPositions,
    input.predictedPositions,
    input.velocities,
    input.inverseMasses,
    input.restPositions,
    input.materialCoordinates,
    input.distances.restLengths,
    input.distances.compliances,
    input.shears.restCosines,
    input.shears.compliances,
    input.seams.weights,
    input.seams.restDistances,
    input.seams.compliances,
    input.seams.relaxations,
    input.pins.targets,
  ]) {
    for (const value of values) {
      if (!Number.isFinite(value)) throw new RangeError("A topologia XPBD cont\u00e9m NaN ou Infinity.");
    }
  }
}

function assertParticleIndices(
  indices: Uint32Array,
  particleCount: number,
  allowMissing: boolean,
  label: string,
): void {
  for (const particle of indices) {
    if (allowMissing && particle === XPBD_MISSING_PARTICLE) continue;
    if (particle >= particleCount) {
      throw new RangeError(`A constraint ${label} referencia a part\u00edcula ${particle}, mas existem ${particleCount}.`);
    }
  }
}

function positionsAreSafe(positions: Float32Array): boolean {
  for (const value of positions) {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000) return false;
  }
  return true;
}

function applyGradient(
  positions: Float32Array,
  offset: number,
  gradient: readonly [number, number, number],
  scale: number,
): void {
  positions[offset] += gradient[0] * scale;
  positions[offset + 1] += gradient[1] * scale;
  positions[offset + 2] += gradient[2] * scale;
}

function lengthSquared(vector: readonly [number, number, number]): number {
  return vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2];
}

function clampSigned(value: number, maximumAbsolute: number): number {
  return Math.min(maximumAbsolute, Math.max(-maximumAbsolute, value));
}

/**
 * XPBD resolve um multiplicador de Lagrange, mas o limite de segurança é
 * expresso em metros. A correção aplicada a uma partícula é
 * `inverseMass * gradient * deltaLambda`; limitar `deltaLambda` diretamente
 * mistura unidades e permite saltos gigantes em tecidos leves.
 */
function clampMultiplierByPositionCorrection(
  deltaLambda: number,
  maximumMultiplier: number,
): number {
  if (!Number.isFinite(deltaLambda) || maximumMultiplier <= EPSILON) return 0;
  return clampSigned(deltaLambda, maximumMultiplier);
}

function maximumMultiplierForParticleCorrections(
  state: XpbdState,
  entries: ReadonlyArray<readonly [particle: number, gradientMagnitude: number]>,
  correctionScale = 1,
): number {
  let maximumMultiplier = Number.POSITIVE_INFINITY;
  for (const [particle, gradientMagnitude] of entries) {
    const weightedGradient = state.inverseMasses[particle] * gradientMagnitude;
    if (weightedGradient <= EPSILON) continue;
    maximumMultiplier = Math.min(
      maximumMultiplier,
      state.correctionLimits[particle] * correctionScale / weightedGradient,
    );
  }
  return Number.isFinite(maximumMultiplier) ? maximumMultiplier : 0;
}

function buildParticleCorrectionLimits(
  particleCount: number,
  distances: XpbdDistanceConstraints,
  configuredMaximum: number,
): Float32Array {
  const safeMaximum = Number.isFinite(configuredMaximum) && configuredMaximum > 0
    ? configuredMaximum
    : DEFAULT_XPBD_CONFIG.maximumCorrection;
  const limits = new Float32Array(particleCount).fill(safeMaximum);
  for (let index = 0; index < distances.restLengths.length; index += 1) {
    if (distances.kinds[index] !== 0) continue;
    const restLength = distances.restLengths[index];
    if (!Number.isFinite(restLength) || restLength <= EPSILON) continue;
    const localLimit = Math.min(safeMaximum, restLength * 0.1);
    const a = distances.indices[index * 2];
    const b = distances.indices[index * 2 + 1];
    limits[a] = Math.min(limits[a], localLimit);
    limits[b] = Math.min(limits[b], localLimit);
  }
  return limits;
}

function seamGradientEntries(
  seams: XpbdSeamConstraints,
  base: number,
): Array<readonly [particle: number, coefficient: number]> {
  const byParticle = new Map<number, number>();
  for (let slot = 0; slot < 4; slot += 1) {
    const particle = seams.indices[base + slot];
    if (particle === XPBD_MISSING_PARTICLE) continue;
    const sideSign = slot < 2 ? -1 : 1;
    byParticle.set(
      particle,
      (byParticle.get(particle) ?? 0) + sideSign * seams.weights[base + slot],
    );
  }
  return [...byParticle]
    .filter(([, coefficient]) => Math.abs(coefficient) > EPSILON)
    .map(([particle, coefficient]) => [particle, coefficient] as const);
}

// Compatibilidade tempor\u00e1ria com testes e consumidores da demonstra\u00e7\u00e3o antiga.
export interface DistanceConstraint {
  a: number;
  b: number;
  restLength: number;
  compliance: number;
  lambda: number;
}

export interface LegacyXpbdState {
  positions: Float32Array;
  previousPositions: Float32Array;
  inverseMasses: Float32Array;
  constraints: DistanceConstraint[];
}

export function solveDistanceConstraints(state: LegacyXpbdState, deltaSeconds: number, iterations = 6): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    throw new RangeError("O passo da simula\u00e7\u00e3o precisa ser positivo e finito.");
  }
  const alphaScale = 1 / (deltaSeconds * deltaSeconds);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const constraint of state.constraints) {
      const aOffset = constraint.a * 3;
      const bOffset = constraint.b * 3;
      const dx = state.positions[bOffset] - state.positions[aOffset];
      const dy = state.positions[bOffset + 1] - state.positions[aOffset + 1];
      const dz = state.positions[bOffset + 2] - state.positions[aOffset + 2];
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-7) continue;
      const wA = state.inverseMasses[constraint.a];
      const wB = state.inverseMasses[constraint.b];
      const alpha = constraint.compliance * alphaScale;
      const denominator = wA + wB + alpha;
      if (denominator <= EPSILON) continue;
      const deltaLambda = (-(length - constraint.restLength) - alpha * constraint.lambda) / denominator;
      constraint.lambda += deltaLambda;
      const nx = dx / length;
      const ny = dy / length;
      const nz = dz / length;
      state.positions[aOffset] -= nx * deltaLambda * wA;
      state.positions[aOffset + 1] -= ny * deltaLambda * wA;
      state.positions[aOffset + 2] -= nz * deltaLambda * wA;
      state.positions[bOffset] += nx * deltaLambda * wB;
      state.positions[bOffset + 1] += ny * deltaLambda * wB;
      state.positions[bOffset + 2] += nz * deltaLambda * wB;
    }
  }
}

/** @deprecated Use XpbdState. */
export type XpbdDistanceDemoState = LegacyXpbdState;
