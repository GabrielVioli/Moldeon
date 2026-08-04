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
  iterations: 140,
  structuralPasses: 2,
  stitchPasses: 5,
  anchorPasses: 1,
  maximumCorrection: 0.025,
  convergenceTolerance: 0.0015,
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

  state.previousPositions.set(state.positions);
  let completedIterations = 0;

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const progress = (iteration + 1) / options.iterations;
    const stitchRamp = smoothstep(Math.min(1, progress * 3));
    const anchorRamp = 0.35 + smoothstep(progress) * 0.65;

    for (let pass = 0; pass < options.structuralPasses; pass += 1) {
      for (const constraint of state.structuralConstraints) {
        solveDistanceConstraint(state, constraint, options.maximumCorrection);
      }
    }

    for (let pass = 0; pass < options.stitchPasses; pass += 1) {
      for (const constraint of state.stitchConstraints) {
        solveStitchConstraint(
          state,
          constraint,
          stitchRamp,
          options.maximumCorrection,
        );
      }
    }

    /*
     * A primeira passada estrutural impede colapso. Esta segunda passada
     * recupera o comprimento do tecido depois que as costuras se movem.
     */
    for (const constraint of state.structuralConstraints) {
      solveDistanceConstraint(
        state,
        constraint,
        options.maximumCorrection * 0.65,
      );
    }

    /*
     * A última operação geométrica da iteração precisa ser a costura.
     * Assim as restrições estruturais não deixam uma abertura residual
     * grande entre as bordas.
     */
    for (let pass = 0; pass < Math.max(1, Math.floor(options.stitchPasses / 2)); pass += 1) {
      for (const constraint of state.stitchConstraints) {
        solveStitchConstraint(
          state,
          constraint,
          stitchRamp,
          options.maximumCorrection * 0.75,
        );
      }
    }

    for (let pass = 0; pass < options.anchorPasses; pass += 1) {
      for (const constraint of state.anchorConstraints) {
        solveAnchorConstraint(
          state,
          constraint,
          options.maximumCorrection,
          anchorRamp,
        );
      }
    }

    completedIterations = iteration + 1;

    if (!positionsAreFinite(state.positions)) {
      state.invalid = true;
      restoreInitialPositions(state);
      return {
        iterations: completedIterations,
        maximumError: Number.POSITIVE_INFINITY,
        converged: false,
        invalid: true,
      };
    }

    if (iteration >= 20 && iteration % 5 === 0) {
      const currentError = measureRelevantResidual(state);
      if (currentError <= options.convergenceTolerance) break;
    }
  }

  state.previousPositions.set(state.positions);
  state.invalid = false;

  const maximumError = measureRelevantResidual(state);

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
): void {
  const aOffset = constraint.a * 3;
  const bOffset = constraint.b * 3;
  const dx = state.positions[bOffset] - state.positions[aOffset];
  const dy = state.positions[bOffset + 1] - state.positions[aOffset + 1];
  const dz = state.positions[bOffset + 2] - state.positions[aOffset + 2];
  const length = Math.hypot(dx, dy, dz);

  if (length <= LENGTH_EPSILON) return;

  const inverseMassA = state.inverseMasses[constraint.a];
  const inverseMassB = state.inverseMasses[constraint.b];
  const inverseMassTotal = inverseMassA + inverseMassB;
  if (inverseMassTotal <= LENGTH_EPSILON) return;

  const error = length - constraint.restLength;
  const correctionMagnitude = clampSigned(
    error * constraint.stiffness / inverseMassTotal,
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
}

function solveStitchConstraint(
  state: GarmentAssemblyState,
  constraint: AssemblyStitchConstraint,
  ramp: number,
  maximumCorrection: number,
): void {
  const pointA = evaluatePoint(state, constraint.a);
  const pointB = evaluatePoint(state, constraint.b);
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const dz = pointB.z - pointA.z;
  const length = Math.hypot(dx, dy, dz);

  if (length <= LENGTH_EPSILON) return;

  const effectiveMassA = pointEffectiveInverseMass(state, constraint.a);
  const effectiveMassB = pointEffectiveInverseMass(state, constraint.b);
  const effectiveMass = effectiveMassA + effectiveMassB;
  if (effectiveMass <= LENGTH_EPSILON) return;

  const error = length - constraint.restDistance;
  const correctionMagnitude = clampSigned(
    error * constraint.stiffness * ramp / effectiveMass,
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
}

function solveAnchorConstraint(
  state: GarmentAssemblyState,
  constraint: AssemblyAnchorConstraint,
  maximumCorrection: number,
  ramp: number,
): void {
  const offset = constraint.particleIndex * 3;
  const dx = constraint.targetX - state.positions[offset];
  const dy = constraint.targetY - state.positions[offset + 1];
  const dz = constraint.targetZ - state.positions[offset + 2];
  const distance = Math.hypot(dx, dy, dz);

  if (distance <= LENGTH_EPSILON) return;
  if (state.inverseMasses[constraint.particleIndex] <= LENGTH_EPSILON) return;

  const magnitude = Math.min(
    maximumCorrection,
    distance * constraint.stiffness * ramp,
  );
  const scale = magnitude / distance;

  state.positions[offset] += dx * scale;
  state.positions[offset + 1] += dy * scale;
  state.positions[offset + 2] += dz * scale;
}

function measureRelevantResidual(state: GarmentAssemblyState): number {
  if (state.stitchConstraints.length > 0) {
    let maximum = 0;

    for (const constraint of state.stitchConstraints) {
      const pointA = evaluatePoint(state, constraint.a);
      const pointB = evaluatePoint(state, constraint.b);
      const distance = Math.hypot(
        pointB.x - pointA.x,
        pointB.y - pointA.y,
        pointB.z - pointA.z,
      );
      maximum = Math.max(
        maximum,
        Math.abs(distance - constraint.restDistance),
      );
    }

    return maximum;
  }

  let maximum = 0;

  for (const constraint of state.structuralConstraints) {
    const aOffset = constraint.a * 3;
    const bOffset = constraint.b * 3;
    const distance = Math.hypot(
      state.positions[bOffset] - state.positions[aOffset],
      state.positions[bOffset + 1] - state.positions[aOffset + 1],
      state.positions[bOffset + 2] - state.positions[aOffset + 2],
    );
    maximum = Math.max(maximum, Math.abs(distance - constraint.restLength));
  }

  return maximum;
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
      500,
    ),
    structuralPasses: clampInteger(
      options.structuralPasses ?? DEFAULT_GARMENT_SOLVER_OPTIONS.structuralPasses,
      1,
      8,
    ),
    stitchPasses: clampInteger(
      options.stitchPasses ?? DEFAULT_GARMENT_SOLVER_OPTIONS.stitchPasses,
      1,
      16,
    ),
    anchorPasses: clampInteger(
      options.anchorPasses ?? DEFAULT_GARMENT_SOLVER_OPTIONS.anchorPasses,
      0,
      6,
    ),
    maximumCorrection: clampFinite(
      options.maximumCorrection ?? DEFAULT_GARMENT_SOLVER_OPTIONS.maximumCorrection,
      0.001,
      0.15,
    ),
    convergenceTolerance: clampFinite(
      options.convergenceTolerance ?? DEFAULT_GARMENT_SOLVER_OPTIONS.convergenceTolerance,
      0.00001,
      0.03,
    ),
  };
}

function restoreInitialPositions(state: GarmentAssemblyState): void {
  state.positions.set(state.initialPositions);
  state.previousPositions.set(state.initialPositions);
}

function positionsAreFinite(positions: Float32Array): boolean {
  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index])) return false;
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
