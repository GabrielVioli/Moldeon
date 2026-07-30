export interface DistanceConstraint {
  a: number;
  b: number;
  restLength: number;
  compliance: number;
  lambda: number;
}

export interface XpbdState {
  positions: Float32Array;
  previousPositions: Float32Array;
  inverseMasses: Float32Array;
  constraints: DistanceConstraint[];
}

export function solveDistanceConstraints(state: XpbdState, deltaSeconds: number, iterations = 6) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    throw new RangeError("O passo da simulação precisa ser positivo e finito.");
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
      const compliance = constraint.compliance * alphaScale;
      const constraintValue = length - constraint.restLength;
      const effectiveMass = wA + wB + compliance;
      if (effectiveMass <= 1e-12) continue;

      const deltaLambda =
        (-constraintValue - compliance * constraint.lambda) / effectiveMass;
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
