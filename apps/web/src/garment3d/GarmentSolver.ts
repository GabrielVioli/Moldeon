import type {
  AssemblyAnchorConstraint,
  AssemblyDistanceConstraint,
  AssemblyStitchConstraint,
  GarmentAssemblyState,
  GlobalPointReference,
} from "./GarmentAssembly";

export interface GarmentSolverOptions {
  iterations: number;
  structuralPasses: number;
  stitchPasses: number;
  anchorPasses: number;
  maximumCorrection: number;
  convergenceTolerance: number;
}

export interface GarmentSolveReport {
  iterations: number;
  maximumError: number;
  converged: boolean;
  invalid: boolean;
}

export const DEFAULT_GARMENT_SOLVER_OPTIONS: GarmentSolverOptions = {
  iterations: 90,
  structuralPasses: 2,
  stitchPasses: 3,
  anchorPasses: 1,
  maximumCorrection: 0.04,
  convergenceTolerance: 0.0008,
};

const LENGTH_EPSILON = 1e-9;

export function solveGarmentAssembly(
  state: GarmentAssemblyState,
  partialOptions: Partial<GarmentSolverOptions> = {},
): GarmentSolveReport {
  const options = normalizeOptions(partialOptions);

  if (state.positions.length === 0) {
    return {
      iterations: 0,
      maximumError: 0,
      converged: true,
      invalid: false,
    };
  }

  resetConstraintState(state);

  let maximumError = Number.POSITIVE_INFINITY;
  let completedIterations = 0;

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    maximumError = 0;
    const progress = (iteration + 1) / options.iterations;
    const stitchRamp = smoothstep(Math.min(1, progress * 2.4));

    for (let pass = 0; pass < options.structuralPasses; pass += 1) {
      for (const constraint of state.structuralConstraints) {
        maximumError = Math.max(
          maximumError,
          solveDistanceConstraint(state, constraint, options.maximumCorrection),
        );
      }
    }

    for (let pass = 0; pass < options.stitchPasses; pass += 1) {
      for (const constraint of state.stitchConstraints) {
        maximumError = Math.max(
          maximumError,
          solveStitchConstraint(
            state,
            constraint,
            stitchRamp,
            options.maximumCorrection,
          ),
        );
      }
    }

    for (let pass = 0; pass < options.anchorPasses; pass += 1) {
      for (const constraint of state.anchorConstraints) {
        maximumError = Math.max(
          maximumError,
          solveAnchorConstraint(state, constraint, options.maximumCorrection),
        );
      }
    }

    completedIterations = iteration + 1;

    if (!positionsAreFinite(state.positions)) {
      state.invalid = true;
      restoreInitialPositions(state);
      return {
        iterations: completedIterations,
        maximumError,
        converged: false,
        invalid: true,
      };
    }

    if (
      iteration >= 12 &&
      maximumError <= options.convergenceTolerance
    ) {
      break;
    }
  }

  state.previousPositions.set(state.positions);
  state.invalid = false;

  return {
    iterations: completedIterations,
    maximumError,
    converged: maximumError <= options.convergenceTolerance,
    invalid: false,
  };
}

export function resetGarmentAssembly(state: GarmentAssemblyState): void {
  restoreInitialPositions(state);
  state.invalid = false;
}

function solveDistanceConstraint(
  state: GarmentAssemblyState,
  constraint: AssemblyDistanceConstraint,
  maximumCorrection: number,
): number {
  const aOffset = constraint.a * 3;
  const bOffset = constraint.b * 3;
  const dx = state.positions[bOffset] - state.positions[aOffset];
  const dy = state.positions[bOffset + 1] - state.positions[aOffset + 1];
  const dz = state.positions[bOffset + 2] - state.positions[aOffset + 2];
  const length = Math.hypot(dx, dy, dz);

  if (length <= LENGTH_EPSILON) {
    return Math.abs(constraint.restLength);
  }

  const error = length - constraint.restLength;
  const inverseMassA = state.inverseMasses[constraint.a];
  const inverseMassB = state.inverseMasses[constraint.b];
  const inverseMassTotal = inverseMassA + inverseMassB;

  if (inverseMassTotal <= LENGTH_EPSILON) {
    return Math.abs(error);
  }

  const correctionMagnitude = clampSigned(
    (error * constraint.stiffness) / inverseMassTotal,
    maximumCorrection,
  );
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;

  state.positions[aOffset] += nx * correctionMagnitude * inverseMassA;
  state.positions[aOffset + 1] += ny * correctionMagnitude * inverseMassA;
  state.positions[aOffset + 2] += nz * correctionMagnitude * inverseMassA;
  state.positions[bOffset] -= nx * correctionMagnitude * inverseMassB;
  state.positions[bOffset + 1] -= ny * correctionMagnitude * inverseMassB;
  state.positions[bOffset + 2] -= nz * correctionMagnitude * inverseMassB;

  return Math.abs(error);
}

function solveStitchConstraint(
  state: GarmentAssemblyState,
  constraint: AssemblyStitchConstraint,
  ramp: number,
  maximumCorrection: number,
): number {
  const pointA = evaluatePoint(state, constraint.a);
  const pointB = evaluatePoint(state, constraint.b);
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const dz = pointB.z - pointA.z;
  const length = Math.hypot(dx, dy, dz);

  if (length <= LENGTH_EPSILON) {
    return Math.abs(constraint.restDistance);
  }

  const error = length - constraint.restDistance;
  const effectiveMassA = pointEffectiveInverseMass(state, constraint.a);
  const effectiveMassB = pointEffectiveInverseMass(state, constraint.b);
  const effectiveMass = effectiveMassA + effectiveMassB;

  if (effectiveMass <= LENGTH_EPSILON) {
    return Math.abs(error);
  }

  const stiffness = constraint.stiffness * ramp;
  const correctionMagnitude = clampSigned(
    (error * stiffness) / effectiveMass,
    maximumCorrection,
  );
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;

  applyPointCorrection(
    state,
    constraint.a,
    nx * correctionMagnitude,
    ny * correctionMagnitude,
    nz * correctionMagnitude,
  );
  applyPointCorrection(
    state,
    constraint.b,
    -nx * correctionMagnitude,
    -ny * correctionMagnitude,
    -nz * correctionMagnitude,
  );

  return Math.abs(error);
}

function solveAnchorConstraint(
  state: GarmentAssemblyState,
  constraint: AssemblyAnchorConstraint,
  maximumCorrection: number,
): number {
  const offset = constraint.particleIndex * 3;
  const dx = constraint.targetX - state.positions[offset];
  const dy = constraint.targetY - state.positions[offset + 1];
  const dz = constraint.targetZ - state.positions[offset + 2];
  const distance = Math.hypot(dx, dy, dz);

  if (distance <= LENGTH_EPSILON) {
    return 0;
  }

  const inverseMass = state.inverseMasses[constraint.particleIndex];
  if (inverseMass <= LENGTH_EPSILON) {
    return distance;
  }

  const magnitude = Math.min(
    maximumCorrection,
    distance * constraint.stiffness,
  );
  const scale = magnitude / distance;

  state.positions[offset] += dx * scale;
  state.positions[offset + 1] += dy * scale;
  state.positions[offset + 2] += dz * scale;

  return distance;
}

function evaluatePoint(
  state: GarmentAssemblyState,
  reference: GlobalPointReference,
): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;

  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const particleIndex = reference.particleIndices[index];
    const weight = reference.weights[index];
    const offset = particleIndex * 3;
    x += state.positions[offset] * weight;
    y += state.positions[offset + 1] * weight;
    z += state.positions[offset + 2] * weight;
  }

  return { x, y, z };
}

function pointEffectiveInverseMass(
  state: GarmentAssemblyState,
  reference: GlobalPointReference,
): number {
  let value = 0;

  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const particleIndex = reference.particleIndices[index];
    const weight = reference.weights[index];
    value += state.inverseMasses[particleIndex] * weight * weight;
  }

  return value;
}

function applyPointCorrection(
  state: GarmentAssemblyState,
  reference: GlobalPointReference,
  correctionX: number,
  correctionY: number,
  correctionZ: number,
): void {
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const particleIndex = reference.particleIndices[index];
    const weight = reference.weights[index];
    const inverseMass = state.inverseMasses[particleIndex];
    const offset = particleIndex * 3;
    const scale = inverseMass * weight;

    state.positions[offset] += correctionX * scale;
    state.positions[offset + 1] += correctionY * scale;
    state.positions[offset + 2] += correctionZ * scale;
  }
}

function normalizeOptions(
  options: Partial<GarmentSolverOptions>,
): GarmentSolverOptions {
  return {
    iterations: clampInteger(
      options.iterations ?? DEFAULT_GARMENT_SOLVER_OPTIONS.iterations,
      1,
      400,
    ),
    structuralPasses: clampInteger(
      options.structuralPasses ?? DEFAULT_GARMENT_SOLVER_OPTIONS.structuralPasses,
      1,
      8,
    ),
    stitchPasses: clampInteger(
      options.stitchPasses ?? DEFAULT_GARMENT_SOLVER_OPTIONS.stitchPasses,
      1,
      12,
    ),
    anchorPasses: clampInteger(
      options.anchorPasses ?? DEFAULT_GARMENT_SOLVER_OPTIONS.anchorPasses,
      0,
      6,
    ),
    maximumCorrection: clampFinite(
      options.maximumCorrection ?? DEFAULT_GARMENT_SOLVER_OPTIONS.maximumCorrection,
      0.001,
      0.2,
    ),
    convergenceTolerance: clampFinite(
      options.convergenceTolerance ?? DEFAULT_GARMENT_SOLVER_OPTIONS.convergenceTolerance,
      0.00001,
      0.02,
    ),
  };
}

function resetConstraintState(state: GarmentAssemblyState): void {
  state.previousPositions.set(state.positions);
}

function restoreInitialPositions(state: GarmentAssemblyState): void {
  state.positions.set(state.initialPositions);
  state.previousPositions.set(state.initialPositions);
}

function positionsAreFinite(positions: Float32Array): boolean {
  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index])) {
      return false;
    }
  }
  return true;
}

function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function clampSigned(value: number, maximumAbsolute: number): number {
  return Math.min(maximumAbsolute, Math.max(-maximumAbsolute, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
