export type ClothConstraintKind = "warp" | "weft" | "shear" | "bend";

export interface DistanceConstraintBuffer {
  a: Uint32Array;
  b: Uint32Array;
  restLength: Float32Array;
  compliance: Float32Array;
  lambda: Float32Array;
}

export interface InterpolatedConstraintBuffer {
  aIndices: Uint32Array;
  aWeights: Float32Array;
  bIndices: Uint32Array;
  bWeights: Float32Array;
  restDistance: Float32Array;
  compliance: Float32Array;
  lambda: Float32Array;
}

export interface AnchorConstraintBuffer {
  particle: Uint32Array;
  target: Float32Array;
  compliance: Float32Array;
  lambda: Float32Array;
}

export interface ClothConstraintBuffers {
  warp: DistanceConstraintBuffer;
  weft: DistanceConstraintBuffer;
  shear: DistanceConstraintBuffer;
  bend: DistanceConstraintBuffer;
  stitches: InterpolatedConstraintBuffer;
  anchors: AnchorConstraintBuffer;
}

export interface ClothSimulationInput {
  positions: Float32Array;
  inverseMasses: Float32Array;
  restPositions2D: Float32Array;
  triangles: Uint32Array;
  materialCoordinates: Float32Array;
  constraints: ClothConstraintBuffers;
}

export interface ClothSimulationOptions {
  fixedDeltaSeconds: number;
  maximumFrameDeltaSeconds: number;
  maximumSubsteps: number;
  iterations: number;
  gravity: readonly [number, number, number];
  damping: number;
  maximumVelocity: number;
  maximumCorrection: number;
  instabilityThreshold: number;
}

export interface ClothSimulationState {
  positions: Float32Array;
  previousPositions: Float32Array;
  predictedPositions: Float32Array;
  velocities: Float32Array;
  inverseMasses: Float32Array;
  restPositions2D: Float32Array;
  triangles: Uint32Array;
  materialCoordinates: Float32Array;
  constraints: ClothConstraintBuffers;
  initialPositions: Float32Array;
  stablePositions: Float32Array;
  accumulatorSeconds: number;
  elapsedSeconds: number;
  frame: number;
  paused: boolean;
  disposed: boolean;
  unstable: boolean;
}

export interface ClothStepReport {
  simulatedSteps: number;
  elapsedSeconds: number;
  maximumSpeed: number;
  maximumCorrection: number;
  unstable: boolean;
  rolledBack: boolean;
}

export const DEFAULT_CLOTH_SIMULATION_OPTIONS: ClothSimulationOptions = {
  fixedDeltaSeconds: 1 / 120,
  maximumFrameDeltaSeconds: 1 / 20,
  maximumSubsteps: 8,
  iterations: 8,
  gravity: [0, -9.81, 0],
  damping: 0.018,
  maximumVelocity: 18,
  maximumCorrection: 0.04,
  instabilityThreshold: 1e4,
};

const EPSILON = 1e-8;
const MAX_REFERENCE_PARTICLES = 2;

export function createClothSimulationState(input: ClothSimulationInput): ClothSimulationState {
  validateInput(input);
  const positions = new Float32Array(input.positions);
  return {
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses: new Float32Array(input.inverseMasses),
    restPositions2D: new Float32Array(input.restPositions2D),
    triangles: new Uint32Array(input.triangles),
    materialCoordinates: new Float32Array(input.materialCoordinates),
    constraints: cloneConstraints(input.constraints),
    initialPositions: new Float32Array(positions),
    stablePositions: new Float32Array(positions),
    accumulatorSeconds: 0,
    elapsedSeconds: 0,
    frame: 0,
    paused: true,
    disposed: false,
    unstable: false,
  };
}

export function startClothSimulation(state: ClothSimulationState): void {
  assertUsable(state);
  state.paused = false;
}

export function pauseClothSimulation(state: ClothSimulationState): void {
  assertUsable(state);
  state.paused = true;
}

export function resetClothSimulation(state: ClothSimulationState): void {
  assertUsable(state);
  state.positions.set(state.initialPositions);
  state.previousPositions.set(state.initialPositions);
  state.predictedPositions.set(state.initialPositions);
  state.stablePositions.set(state.initialPositions);
  state.velocities.fill(0);
  resetLambdas(state.constraints);
  state.accumulatorSeconds = 0;
  state.elapsedSeconds = 0;
  state.frame = 0;
  state.unstable = false;
}

export function disposeClothSimulation(state: ClothSimulationState): void {
  if (state.disposed) return;
  state.paused = true;
  state.disposed = true;
  state.accumulatorSeconds = 0;
}

export function advanceClothSimulation(
  state: ClothSimulationState,
  deltaSeconds: number,
  partialOptions: Partial<ClothSimulationOptions> = {},
): ClothStepReport {
  assertUsable(state);
  const options = normalizeOptions(partialOptions);
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError("O delta da simulação precisa ser finito e não negativo.");
  }
  if (state.paused || deltaSeconds === 0) return emptyReport(state);

  state.accumulatorSeconds += Math.min(deltaSeconds, options.maximumFrameDeltaSeconds);
  let simulatedSteps = 0;
  let maximumSpeed = 0;
  let maximumCorrection = 0;
  let rolledBack = false;

  while (
    state.accumulatorSeconds + EPSILON >= options.fixedDeltaSeconds &&
    simulatedSteps < options.maximumSubsteps
  ) {
    const report = simulateFixedStep(state, options);
    simulatedSteps += 1;
    maximumSpeed = Math.max(maximumSpeed, report.maximumSpeed);
    maximumCorrection = Math.max(maximumCorrection, report.maximumCorrection);
    state.accumulatorSeconds = Math.max(0, state.accumulatorSeconds - options.fixedDeltaSeconds);
    if (report.rolledBack) {
      rolledBack = true;
      state.accumulatorSeconds = 0;
      break;
    }
  }

  return {
    simulatedSteps,
    elapsedSeconds: state.elapsedSeconds,
    maximumSpeed,
    maximumCorrection,
    unstable: state.unstable,
    rolledBack,
  };
}

export function stepClothSimulation(
  state: ClothSimulationState,
  partialOptions: Partial<ClothSimulationOptions> = {},
): ClothStepReport {
  assertUsable(state);
  const options = normalizeOptions(partialOptions);
  return simulateFixedStep(state, options);
}

function simulateFixedStep(
  state: ClothSimulationState,
  options: ClothSimulationOptions,
): ClothStepReport {
  const dt = options.fixedDeltaSeconds;
  state.previousPositions.set(state.positions);
  integrate(state, dt, options);
  resetLambdas(state.constraints);

  let maximumCorrection = 0;
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    maximumCorrection = Math.max(
      maximumCorrection,
      solveDistanceBuffer(state, state.constraints.warp, dt, options.maximumCorrection),
      solveDistanceBuffer(state, state.constraints.weft, dt, options.maximumCorrection),
      solveDistanceBuffer(state, state.constraints.shear, dt, options.maximumCorrection),
      solveDistanceBuffer(state, state.constraints.bend, dt, options.maximumCorrection),
      solveInterpolatedPasses(state, state.constraints.stitches, dt, options.maximumCorrection, 4),
      solveAnchorBuffer(state, state.constraints.anchors, dt, options.maximumCorrection),
    );
  }

  state.positions.set(state.predictedPositions);
  const maximumSpeed = updateVelocities(state, dt, options);
  const finite = arraysAreFinite(state.positions) && arraysAreFinite(state.velocities);
  const bounded = maximumSpeed <= options.instabilityThreshold && maximumCorrection <= options.instabilityThreshold;

  if (!finite || !bounded) {
    state.positions.set(state.stablePositions);
    state.previousPositions.set(state.stablePositions);
    state.predictedPositions.set(state.stablePositions);
    state.velocities.fill(0);
    state.unstable = true;
    return {
      simulatedSteps: 1,
      elapsedSeconds: state.elapsedSeconds,
      maximumSpeed,
      maximumCorrection,
      unstable: true,
      rolledBack: true,
    };
  }

  state.stablePositions.set(state.positions);
  state.unstable = false;
  state.elapsedSeconds += dt;
  state.frame += 1;
  return {
    simulatedSteps: 1,
    elapsedSeconds: state.elapsedSeconds,
    maximumSpeed,
    maximumCorrection,
    unstable: false,
    rolledBack: false,
  };
}

function integrate(
  state: ClothSimulationState,
  dt: number,
  options: ClothSimulationOptions,
): void {
  const [gx, gy, gz] = options.gravity;
  const dampingScale = Math.max(0, 1 - options.damping);
  const maxVelocity = options.maximumVelocity;

  for (let particle = 0; particle < state.inverseMasses.length; particle += 1) {
    const offset = particle * 3;
    if (state.inverseMasses[particle] <= EPSILON) {
      state.predictedPositions[offset] = state.positions[offset];
      state.predictedPositions[offset + 1] = state.positions[offset + 1];
      state.predictedPositions[offset + 2] = state.positions[offset + 2];
      state.velocities[offset] = 0;
      state.velocities[offset + 1] = 0;
      state.velocities[offset + 2] = 0;
      continue;
    }

    let vx = (state.velocities[offset] + gx * dt) * dampingScale;
    let vy = (state.velocities[offset + 1] + gy * dt) * dampingScale;
    let vz = (state.velocities[offset + 2] + gz * dt) * dampingScale;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > maxVelocity) {
      const scale = maxVelocity / speed;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }
    state.velocities[offset] = vx;
    state.velocities[offset + 1] = vy;
    state.velocities[offset + 2] = vz;
    state.predictedPositions[offset] = state.positions[offset] + vx * dt;
    state.predictedPositions[offset + 1] = state.positions[offset + 1] + vy * dt;
    state.predictedPositions[offset + 2] = state.positions[offset + 2] + vz * dt;
  }
}

function solveDistanceBuffer(
  state: ClothSimulationState,
  buffer: DistanceConstraintBuffer,
  dt: number,
  maximumCorrection: number,
): number {
  let largest = 0;
  const alphaScale = 1 / (dt * dt);
  for (let index = 0; index < buffer.a.length; index += 1) {
    const a = buffer.a[index];
    const b = buffer.b[index];
    const aOffset = a * 3;
    const bOffset = b * 3;
    const dx = state.predictedPositions[bOffset] - state.predictedPositions[aOffset];
    const dy = state.predictedPositions[bOffset + 1] - state.predictedPositions[aOffset + 1];
    const dz = state.predictedPositions[bOffset + 2] - state.predictedPositions[aOffset + 2];
    const length = Math.hypot(dx, dy, dz);
    if (length <= EPSILON) continue;
    const wA = state.inverseMasses[a];
    const wB = state.inverseMasses[b];
    const alpha = buffer.compliance[index] * alphaScale;
    const denominator = wA + wB + alpha;
    if (denominator <= EPSILON) continue;
    const constraintValue = length - buffer.restLength[index];
    const deltaLambda = clampSigned(
      (-constraintValue - alpha * buffer.lambda[index]) / denominator,
      maximumCorrection,
    );
    buffer.lambda[index] += deltaLambda;
    largest = Math.max(largest, Math.abs(deltaLambda));
    const nx = dx / length;
    const ny = dy / length;
    const nz = dz / length;
    state.predictedPositions[aOffset] -= nx * deltaLambda * wA;
    state.predictedPositions[aOffset + 1] -= ny * deltaLambda * wA;
    state.predictedPositions[aOffset + 2] -= nz * deltaLambda * wA;
    state.predictedPositions[bOffset] += nx * deltaLambda * wB;
    state.predictedPositions[bOffset + 1] += ny * deltaLambda * wB;
    state.predictedPositions[bOffset + 2] += nz * deltaLambda * wB;
  }
  return largest;
}

function solveInterpolatedPasses(
  state: ClothSimulationState,
  buffer: InterpolatedConstraintBuffer,
  dt: number,
  maximumCorrection: number,
  passes: number,
): number {
  let largest = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    largest = Math.max(largest, solveInterpolatedBuffer(state, buffer, dt, maximumCorrection));
  }
  return largest;
}

function solveInterpolatedBuffer(
  state: ClothSimulationState,
  buffer: InterpolatedConstraintBuffer,
  dt: number,
  maximumCorrection: number,
): number {
  let largest = 0;
  const alphaScale = 1 / (dt * dt);
  for (let constraint = 0; constraint < buffer.restDistance.length; constraint += 1) {
    const a = evaluateReference(state.predictedPositions, buffer.aIndices, buffer.aWeights, constraint);
    const b = evaluateReference(state.predictedPositions, buffer.bIndices, buffer.bWeights, constraint);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length <= EPSILON) continue;
    const wA = referenceInverseMass(state.inverseMasses, buffer.aIndices, buffer.aWeights, constraint);
    const wB = referenceInverseMass(state.inverseMasses, buffer.bIndices, buffer.bWeights, constraint);
    const alpha = buffer.compliance[constraint] * alphaScale;
    const denominator = wA + wB + alpha;
    if (denominator <= EPSILON) continue;
    const value = length - buffer.restDistance[constraint];
    const deltaLambda = clampSigned(
      (-value - alpha * buffer.lambda[constraint]) / denominator,
      maximumCorrection,
    );
    buffer.lambda[constraint] += deltaLambda;
    largest = Math.max(largest, Math.abs(deltaLambda));
    const nx = dx / length;
    const ny = dy / length;
    const nz = dz / length;
    applyReferenceCorrection(
      state.predictedPositions,
      state.inverseMasses,
      buffer.aIndices,
      buffer.aWeights,
      constraint,
      -nx * deltaLambda,
      -ny * deltaLambda,
      -nz * deltaLambda,
    );
    applyReferenceCorrection(
      state.predictedPositions,
      state.inverseMasses,
      buffer.bIndices,
      buffer.bWeights,
      constraint,
      nx * deltaLambda,
      ny * deltaLambda,
      nz * deltaLambda,
    );
  }
  return largest;
}

function solveAnchorBuffer(
  state: ClothSimulationState,
  buffer: AnchorConstraintBuffer,
  dt: number,
  maximumCorrection: number,
): number {
  let largest = 0;
  const alphaScale = 1 / (dt * dt);
  for (let index = 0; index < buffer.particle.length; index += 1) {
    const particle = buffer.particle[index];
    const offset = particle * 3;
    const targetOffset = index * 3;
    const dx = state.predictedPositions[offset] - buffer.target[targetOffset];
    const dy = state.predictedPositions[offset + 1] - buffer.target[targetOffset + 1];
    const dz = state.predictedPositions[offset + 2] - buffer.target[targetOffset + 2];
    const length = Math.hypot(dx, dy, dz);
    if (length <= EPSILON) continue;
    const weight = state.inverseMasses[particle];
    const alpha = buffer.compliance[index] * alphaScale;
    const denominator = weight + alpha;
    if (denominator <= EPSILON) continue;
    const deltaLambda = clampSigned(
      (-length - alpha * buffer.lambda[index]) / denominator,
      maximumCorrection,
    );
    buffer.lambda[index] += deltaLambda;
    largest = Math.max(largest, Math.abs(deltaLambda));
    const scale = deltaLambda * weight / length;
    state.predictedPositions[offset] += dx * scale;
    state.predictedPositions[offset + 1] += dy * scale;
    state.predictedPositions[offset + 2] += dz * scale;
  }
  return largest;
}

function updateVelocities(
  state: ClothSimulationState,
  dt: number,
  options: ClothSimulationOptions,
): number {
  let maximum = 0;
  for (let particle = 0; particle < state.inverseMasses.length; particle += 1) {
    const offset = particle * 3;
    let vx = (state.positions[offset] - state.previousPositions[offset]) / dt;
    let vy = (state.positions[offset + 1] - state.previousPositions[offset + 1]) / dt;
    let vz = (state.positions[offset + 2] - state.previousPositions[offset + 2]) / dt;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > options.maximumVelocity) {
      const scale = options.maximumVelocity / speed;
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }
    state.velocities[offset] = vx;
    state.velocities[offset + 1] = vy;
    state.velocities[offset + 2] = vz;
    maximum = Math.max(maximum, Math.hypot(vx, vy, vz));
  }
  return maximum;
}

function evaluateReference(
  positions: Float32Array,
  indices: Uint32Array,
  weights: Float32Array,
  constraint: number,
): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  const start = constraint * MAX_REFERENCE_PARTICLES;
  for (let slot = 0; slot < MAX_REFERENCE_PARTICLES; slot += 1) {
    const weight = weights[start + slot];
    if (weight === 0) continue;
    const offset = indices[start + slot] * 3;
    x += positions[offset] * weight;
    y += positions[offset + 1] * weight;
    z += positions[offset + 2] * weight;
  }
  return [x, y, z];
}

function referenceInverseMass(
  inverseMasses: Float32Array,
  indices: Uint32Array,
  weights: Float32Array,
  constraint: number,
): number {
  let result = 0;
  const start = constraint * MAX_REFERENCE_PARTICLES;
  for (let slot = 0; slot < MAX_REFERENCE_PARTICLES; slot += 1) {
    const weight = weights[start + slot];
    result += inverseMasses[indices[start + slot]] * weight * weight;
  }
  return result;
}

function applyReferenceCorrection(
  positions: Float32Array,
  inverseMasses: Float32Array,
  indices: Uint32Array,
  weights: Float32Array,
  constraint: number,
  x: number,
  y: number,
  z: number,
): void {
  const start = constraint * MAX_REFERENCE_PARTICLES;
  for (let slot = 0; slot < MAX_REFERENCE_PARTICLES; slot += 1) {
    const particle = indices[start + slot];
    const weight = weights[start + slot];
    const scale = inverseMasses[particle] * weight;
    const offset = particle * 3;
    positions[offset] += x * scale;
    positions[offset + 1] += y * scale;
    positions[offset + 2] += z * scale;
  }
}

function validateInput(input: ClothSimulationInput): void {
  if (input.positions.length % 3 !== 0) throw new RangeError("positions precisa conter vetores 3D.");
  const particles = input.positions.length / 3;
  if (input.inverseMasses.length !== particles) throw new RangeError("inverseMasses não corresponde às partículas.");
  if (input.restPositions2D.length !== particles * 2) throw new RangeError("restPositions2D não corresponde às partículas.");
  if (input.materialCoordinates.length !== particles * 2) throw new RangeError("materialCoordinates não corresponde às partículas.");
  if (input.triangles.length % 3 !== 0) throw new RangeError("triangles precisa conter trios de índices.");
  validateDistanceBuffer(input.constraints.warp, particles);
  validateDistanceBuffer(input.constraints.weft, particles);
  validateDistanceBuffer(input.constraints.shear, particles);
  validateDistanceBuffer(input.constraints.bend, particles);
  validateInterpolatedBuffer(input.constraints.stitches, particles);
  validateAnchorBuffer(input.constraints.anchors, particles);
}

function validateDistanceBuffer(buffer: DistanceConstraintBuffer, particles: number): void {
  const length = buffer.a.length;
  if (
    buffer.b.length !== length ||
    buffer.restLength.length !== length ||
    buffer.compliance.length !== length ||
    buffer.lambda.length !== length
  ) throw new RangeError("Buffer de distância inconsistente.");
  for (let index = 0; index < length; index += 1) {
    if (buffer.a[index] >= particles || buffer.b[index] >= particles) throw new RangeError("Restrição usa partícula inexistente.");
  }
}

function validateInterpolatedBuffer(buffer: InterpolatedConstraintBuffer, particles: number): void {
  const count = buffer.restDistance.length;
  if (
    buffer.aIndices.length !== count * MAX_REFERENCE_PARTICLES ||
    buffer.aWeights.length !== count * MAX_REFERENCE_PARTICLES ||
    buffer.bIndices.length !== count * MAX_REFERENCE_PARTICLES ||
    buffer.bWeights.length !== count * MAX_REFERENCE_PARTICLES ||
    buffer.compliance.length !== count ||
    buffer.lambda.length !== count
  ) throw new RangeError("Buffer de costura interpolada inconsistente.");
  for (const index of buffer.aIndices) if (index >= particles) throw new RangeError("Costura usa partícula inexistente.");
  for (const index of buffer.bIndices) if (index >= particles) throw new RangeError("Costura usa partícula inexistente.");
}

function validateAnchorBuffer(buffer: AnchorConstraintBuffer, particles: number): void {
  const count = buffer.particle.length;
  if (buffer.target.length !== count * 3 || buffer.compliance.length !== count || buffer.lambda.length !== count) {
    throw new RangeError("Buffer de anchor inconsistente.");
  }
  for (const particle of buffer.particle) if (particle >= particles) throw new RangeError("Anchor usa partícula inexistente.");
}

function cloneConstraints(source: ClothConstraintBuffers): ClothConstraintBuffers {
  return {
    warp: cloneDistanceBuffer(source.warp),
    weft: cloneDistanceBuffer(source.weft),
    shear: cloneDistanceBuffer(source.shear),
    bend: cloneDistanceBuffer(source.bend),
    stitches: {
      aIndices: new Uint32Array(source.stitches.aIndices),
      aWeights: new Float32Array(source.stitches.aWeights),
      bIndices: new Uint32Array(source.stitches.bIndices),
      bWeights: new Float32Array(source.stitches.bWeights),
      restDistance: new Float32Array(source.stitches.restDistance),
      compliance: new Float32Array(source.stitches.compliance),
      lambda: new Float32Array(source.stitches.lambda),
    },
    anchors: {
      particle: new Uint32Array(source.anchors.particle),
      target: new Float32Array(source.anchors.target),
      compliance: new Float32Array(source.anchors.compliance),
      lambda: new Float32Array(source.anchors.lambda),
    },
  };
}

function cloneDistanceBuffer(source: DistanceConstraintBuffer): DistanceConstraintBuffer {
  return {
    a: new Uint32Array(source.a),
    b: new Uint32Array(source.b),
    restLength: new Float32Array(source.restLength),
    compliance: new Float32Array(source.compliance),
    lambda: new Float32Array(source.lambda),
  };
}

function resetLambdas(constraints: ClothConstraintBuffers): void {
  constraints.warp.lambda.fill(0);
  constraints.weft.lambda.fill(0);
  constraints.shear.lambda.fill(0);
  constraints.bend.lambda.fill(0);
  constraints.stitches.lambda.fill(0);
  constraints.anchors.lambda.fill(0);
}

function normalizeOptions(partial: Partial<ClothSimulationOptions>): ClothSimulationOptions {
  const options = { ...DEFAULT_CLOTH_SIMULATION_OPTIONS, ...partial };
  return {
    fixedDeltaSeconds: finiteRange(options.fixedDeltaSeconds, 1 / 1000, 1 / 15),
    maximumFrameDeltaSeconds: finiteRange(options.maximumFrameDeltaSeconds, options.fixedDeltaSeconds, 0.25),
    maximumSubsteps: integerRange(options.maximumSubsteps, 1, 32),
    iterations: integerRange(options.iterations, 1, 40),
    gravity: [
      finiteRange(options.gravity[0], -100, 100),
      finiteRange(options.gravity[1], -100, 100),
      finiteRange(options.gravity[2], -100, 100),
    ],
    damping: finiteRange(options.damping, 0, 0.5),
    maximumVelocity: finiteRange(options.maximumVelocity, 0.1, 100),
    maximumCorrection: finiteRange(options.maximumCorrection, 0.0001, 0.5),
    instabilityThreshold: finiteRange(options.instabilityThreshold, 1, 1e8),
  };
}

function emptyReport(state: ClothSimulationState): ClothStepReport {
  return {
    simulatedSteps: 0,
    elapsedSeconds: state.elapsedSeconds,
    maximumSpeed: 0,
    maximumCorrection: 0,
    unstable: state.unstable,
    rolledBack: false,
  };
}

function assertUsable(state: ClothSimulationState): void {
  if (state.disposed) throw new Error("A simulação já foi descartada.");
}

function arraysAreFinite(values: Float32Array): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return false;
  }
  return true;
}

function clampSigned(value: number, maximumAbsolute: number): number {
  return Math.max(-maximumAbsolute, Math.min(maximumAbsolute, value));
}

function finiteRange(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function integerRange(value: number, minimum: number, maximum: number): number {
  return Math.floor(finiteRange(value, minimum, maximum));
}
