import { applyBodyContactVelocities, createBodyCollisionRuntimeState, finalizeBodyContactDiagnostics, initializeBodyDressing, resetBodyContactStep, solveBodyCollisions, type BodyCollisionRuntimeState } from "./bodyCollision";

export const XPBD_MISSING_PARTICLE = 0xffffffff;

export interface XpbdDistanceConstraints {
  indices: Uint32Array;
  restLengths: Float32Array;
  compliances: Float32Array;
  lambdas: Float32Array;
  /** Kept for protocol compatibility. Material constraints use kind 0. */
  kinds: Uint8Array;
  panelIds?: string[];
  fabricIds?: string[];
}

export interface XpbdShearConstraints {
  indices: Uint32Array;
  restCosines: Float32Array;
  compliances: Float32Array;
  lambdas: Float32Array;
}

export interface XpbdBendConstraints {
  /** Per hinge: opposite A, opposite B, shared-edge start, shared-edge end. */
  indices: Uint32Array;
  restAngles: Float32Array;
  compliances: Float32Array;
  lambdas: Float32Array;
}

export interface XpbdTriangleMaterialReference {
  restAreas: Float32Array;
  orientations: Int8Array;
  initialNormals: Float32Array;
  initialAabbDiagonal: number;
  meaningfulRestArea: number;
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
  metricGuardEnabled?: boolean;
  floorCollisionEnabled?: boolean;
  floorY?: number;
  floorContactSkinM?: number;
}

export interface XpbdProfileTimings {
  integrationMs: number;
  stretchMs: number;
  shearMs: number;
  bendMs: number;
  seamMs: number;
  velocityUpdateMs: number;
  validationMs: number;
  solverStepTotalMs: number;
  bodyCollisionMs: number;
  floorCollisionMs: number;
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
  triangleMaterial: XpbdTriangleMaterialReference;
  distances: XpbdDistanceConstraints;
  shears: XpbdShearConstraints;
  bends: XpbdBendConstraints;
  seams: XpbdSeamConstraints;
  pins: XpbdPinConstraints;
  body: BodyCollisionRuntimeState;
  /** Trust region por partícula derivado da menor aresta estrutural local. */
  correctionLimits: Float32Array;
  stablePositions: Float32Array;
  /** Normals from the last metric-safe step, used for rigid-motion-invariant flip detection. */
  triangleReferenceNormals: Float32Array;
  lastFlippedTriangleCount: number;
  meaningfulStructuralRestLength: number;
  maximumCorrectionApplied: number;
  /** Active while an assembled equilibrium undergoes uniform free flight. */
  zeroEnergyFreeFlightActive: boolean;
  zeroEnergyFreeFlightOffset: [number, number, number];
  zeroEnergyFreeFlightVelocity: [number, number, number];
  floorContactMask: Uint8Array;
  floorNormalImpulseSpeeds: Float32Array;
  floorContactCount: number;
  floorCcdContactCount: number;
  floorFrictionContactCount: number;
  maximumFloorPenetrationM: number;
  meanFloorPenetrationM: number;
  config: XpbdSolverConfig;
  accumulator: number;
  stepCount: number;
  invalid: boolean;
  invalidReason: "non-finite" | "metric-instability" | null;
  profile: XpbdProfileTimings;
}

export interface XpbdMaterialGroupDiagnostic {
  constraintCount: number;
  structuralStretchMeanRatio: number;
  structuralStretchMaxRatio: number;
  structuralCompressionMinRatio: number;
}

export interface XpbdSeamGroupErrorDiagnostic {
  constraintCount: number;
  meanError: number;
  maxError: number;
  worstConstraintIndex: number;
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
  seamErrorsByGroup: Record<string, XpbdSeamGroupErrorDiagnostic>;
  maximumPositionMagnitude: number;
  maximumVelocityMagnitude: number;
  structuralStretchMeanRatio: number;
  structuralStretchMaxRatio: number;
  structuralCompressionMinRatio: number;
  shearStrainMean: number;
  shearStrainMax: number;
  triangleAreaMeanRatio: number;
  triangleAreaMinRatio: number;
  triangleAreaMaxRatio: number;
  flippedTriangleCount: number;
  garmentAabbGrowthRatio: number;
  materialMetricsByPanel: Record<string, XpbdMaterialGroupDiagnostic>;
  materialMetricsByFabric: Record<string, XpbdMaterialGroupDiagnostic>;
  explicitPinCount: number;
  temporarySupportCount: number;
  maximumCorrectionApplied: number;
  bodyColliderCount?: number;
  bodyContactCount?: number;
  bodyContactsByRegion?: Record<string, number>;
  maximumBodyPenetrationM?: number;
  maximumBodyCorrectionM?: number;
  frictionContactCount?: number;
  sweptContactCount?: number;
  bodyCollisionEnabled?: boolean;
  bodyCollisionMode?: "disabled" | "exact-human-surface" | "legacy-proxy";
  bodyMeshVertices?: number;
  bodyMeshTriangles?: number;
  bodyBvhNodes?: number;
  bodyVisualCollisionMaxDeltaMm?: number;
  floorCollisionEnabled?: boolean;
  floorContactCount?: number;
  floorCcdContactCount?: number;
  floorFrictionContactCount?: number;
  maximumFloorPenetrationM?: number;
  meanFloorPenetrationM?: number;
  floorCollisionMs?: number;
  invalid: boolean;
  invalidReason: "non-finite" | "metric-instability" | null;
  droppedTimeSeconds: number;
  integrationMs?: number;
  stretchMs?: number;
  shearMs?: number;
  bendMs?: number;
  seamMs?: number;
  velocityUpdateMs?: number;
  validationMs?: number;
  solverStepTotalMs?: number;
  bodyCollisionMs?: number;
  bodyBroadphaseMs?: number;
  bodyNarrowphaseMs?: number;
  bodyProjectionMs?: number;
  bodyFrictionMs?: number;
  bodyParticleQueries?: number;
  bodyColliderTests?: number;
  bodyCandidateColliderTests?: number;
  bodyBroadphaseRejected?: number;
  bodyBroadphaseRejectRate?: number;
  bodyAverageCandidatesPerParticle?: number;
  bodyCapsuleNarrowphaseTests?: number;
  bodyEllipsoidNarrowphaseTests?: number;
  bodyPointContactsFound?: number;
  bodySweptTests?: number;
  bodySweptContactsFound?: number;
  bodyExactSurface?: boolean;
  bodyBvhBuildMs?: number;
  bodyBvhNodeVisits?: number;
  bodyTriangleTests?: number;
  bodyInsideTests?: number;
  bodyCcdTests?: number;
  bodyCcdHits?: number;
  bodyCcdMs?: number;
  bodyVertexContacts?: number;
  bodyEdgeContacts?: number;
  bodyTriangleContacts?: number;
  bodyResidualIntersections?: number;
  bodyResidualCrossings?: number;
  bodyTriangleIntersectionCount?: number;
  bodyCompleteCrossings?: number;
  maximumSignedBodyPenetrationM?: number;
  bodySignedPenetrationMaxMm?: number;
  bodySignedPenetrationMeanMm?: number;
  bodyClearanceErrorMaxMm?: number;
  bodyClearanceErrorMeanMm?: number;
  bodyCandidatesPerQuery?: number;
  bodyBvhQueryMs?: number;
  bodyContactSolveMs?: number;
  bodyIntersectionAuditMs?: number;
  bodyInvalidClothPrimitiveSkips?: number;
  bodyLocalInitialOverlapSkipCount?: number;
  bodyGlobalCollisionEarlyReturnCount?: number;
  bodyContactSkipReasons?: Record<string, number>;
  bodyStructuralContactDeferred?: boolean;
  bodyAssemblyContactBlocked?: boolean;
  bodyDeepOverlapCount?: number;
  bodyInitialIntersectionCount?: number;
  bodyDressingStepsRemaining?: number;
  bodyInitialDressingSteps?: number;
  initialOverlapRecoveryStatus?: "not-needed" | "recovering" | "recovered" | "initial-overlap-too-deep";
  initialOverlapRecoverySteps?: number;
  iterations?: number;
  maximumSubsteps?: number;
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
  metricGuardEnabled: true,
  floorCollisionEnabled: false,
  floorY: 0,
  floorContactSkinM: 0.0002,
};

const EPSILON = 1e-9;

type XpbdStateInput = Omit<
  XpbdState,
  "body" | "triangleMaterial" | "bends" | "correctionLimits" | "stablePositions" |
  "triangleReferenceNormals" | "lastFlippedTriangleCount" | "meaningfulStructuralRestLength" |
  "maximumCorrectionApplied" | "zeroEnergyFreeFlightActive" | "zeroEnergyFreeFlightOffset" | "zeroEnergyFreeFlightVelocity" |
  "floorContactMask" | "floorNormalImpulseSpeeds" | "floorContactCount" | "floorCcdContactCount" |
  "floorFrictionContactCount" | "maximumFloorPenetrationM" | "meanFloorPenetrationM" |
  "accumulator" | "stepCount" | "invalid" | "invalidReason" | "profile"
> & {
  body?: BodyCollisionRuntimeState;
  triangleMaterial?: XpbdTriangleMaterialReference;
  bends?: XpbdBendConstraints;
};

export function createXpbdState(input: XpbdStateInput): XpbdState {
  const body = input.body ?? createBodyCollisionRuntimeState({ kinds: new Uint8Array(0), data: new Float32Array(0), regions: [] }, new Float32Array(input.positions.length / 3), new Float32Array(input.positions.length / 3), false);
  const bends = input.bends ?? {
    indices: new Uint32Array(0),
    restAngles: new Float32Array(0),
    compliances: new Float32Array(0),
    lambdas: new Float32Array(0),
  };
  const triangleMaterial = input.triangleMaterial ?? buildTriangleMaterialReference(
    input.materialCoordinates,
    input.triangles,
    input.positions,
  );
  const normalizedInput = { ...input, body, bends, triangleMaterial };
  validateStateShape(normalizedInput);
  if (!Number.isFinite(input.config.floorY ?? 0)) {
    throw new RangeError("A altura do piso precisa ser finita.");
  }
  const floorSkin = input.config.floorContactSkinM ?? 0.0002;
  if (!Number.isFinite(floorSkin) || floorSkin < 0 || floorSkin > 0.01) {
    throw new RangeError("A margem de contato do piso precisa ser finita e pequena.");
  }
  const correctionLimits = buildParticleCorrectionLimits(
    input.positions.length / 3,
    input.distances,
    input.config.maximumCorrection,
  );
  const state: XpbdState = {
    ...normalizedInput,
    body,
    correctionLimits,
    stablePositions: new Float32Array(input.positions),
    triangleReferenceNormals: new Float32Array(triangleMaterial.initialNormals),
    lastFlippedTriangleCount: 0,
    meaningfulStructuralRestLength: meaningfulStructuralRestLength(input.distances),
    maximumCorrectionApplied: 0,
    zeroEnergyFreeFlightActive: false,
    zeroEnergyFreeFlightOffset: [0, 0, 0],
    zeroEnergyFreeFlightVelocity: [0, 0, 0],
    floorContactMask: new Uint8Array(input.positions.length / 3),
    floorNormalImpulseSpeeds: new Float32Array(input.positions.length / 3),
    floorContactCount: 0,
    floorCcdContactCount: 0,
    floorFrictionContactCount: 0,
    maximumFloorPenetrationM: 0,
    meanFloorPenetrationM: 0,
    accumulator: 0,
    stepCount: 0,
    invalid: false,
    invalidReason: null,
    profile: { integrationMs: 0, stretchMs: 0, shearMs: 0, bendMs: 0, seamMs: 0, velocityUpdateMs: 0, validationMs: 0, solverStepTotalMs: 0, bodyCollisionMs: 0, floorCollisionMs: 0 },
  };
  initializeBodyDressing(body, state.positions, state.config.maximumCorrection, state.triangles);
  return state;
}

export function advanceXpbd(state: XpbdState, frameDeltaSeconds: number): XpbdStepDiagnostics {
  if (state.invalid) return measureXpbdDiagnostics(state, 0, 0);
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
  const stepStarted = performance.now();
  const profile = state.profile;
  profile.integrationMs = 0; profile.stretchMs = 0; profile.shearMs = 0; profile.bendMs = 0; profile.seamMs = 0; profile.velocityUpdateMs = 0; profile.validationMs = 0; profile.bodyCollisionMs = 0; profile.floorCollisionMs = 0;
  // Metric rollback is an auto-pause, not a one-frame warning.  Advancing the
  // restored snapshot on the next scheduler tick used to clear `invalid` and
  // hide the catastrophe from both diagnostics and the UI.  Only an explicit
  // reset/rebuild may resume a failed state.
  if (state.invalid) {
    profile.solverStepTotalMs = performance.now() - stepStarted;
    return;
  }
  resetBodyContactStep(state.body);
  resetFloorContactStep(state);
  const dt = state.config.fixedTimeStep;
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("O passo da simula\u00e7\u00e3o precisa ser positivo e finito.");

  state.previousPositions.set(state.positions);
  state.maximumCorrectionApplied = 0;
  resetLambdas(state);
  const dressingActive = state.body.enabled && state.body.dressingStepsRemaining > 0;
  const effectiveIterations = dressingActive
    ? Math.max(state.config.iterations, state.config.iterations * 2)
    : state.config.iterations;
  let phaseStarted = performance.now();
  const zeroEnergyFreeFlight = !dressingActive && canAdvanceAsZeroEnergyFreeFlight(state);

  // A free garment in uniform gravity has no relative acceleration. When the
  // current state is the assembled rest pose plus one rigid translation and
  // all authored constraints are already satisfied, constraint projection can
  // only add floating-point noise and artificial angular momentum. Advance the
  // common translation analytically and keep the material shape bit-stable.
  if (zeroEnergyFreeFlight) {
    state.zeroEnergyFreeFlightActive = true;
    advanceZeroEnergyFreeFlight(state, dt);
    profile.integrationMs = performance.now() - phaseStarted;
    state.stepCount += 1;
    state.stablePositions.set(state.positions);
    state.invalid = false;
    state.invalidReason = null;
    profile.solverStepTotalMs = performance.now() - stepStarted;
    return;
  }
  state.zeroEnergyFreeFlightActive = false;
  integrate(state, dt, dressingActive ? [0, 0, 0] : state.config.gravity);
  profile.integrationMs = performance.now() - phaseStarted;

  for (let iteration = 0; iteration < effectiveIterations; iteration += 1) {
    // Alternate the seam/material order so neither family systematically owns
    // the final state of every solver iteration. The last regular iteration is
    // seam-first, leaving the immutable 2D metric as its closing projection.
    const seamFirst = iteration % 2 === 1;
    if (seamFirst) {
      phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;
    }
    phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;
    phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;
    phaseStarted = performance.now();
    solveDistanceSet(state, dt, 1);
    // Dihedral hinges are considerably more expensive than distance/shear.
    // A deterministic multi-rate cadence keeps every hinge active at least
    // twice per step while stretch, shear and seams retain every XPBD iteration.
    if (iteration === 0 || iteration === effectiveIterations - 1 || iteration % 4 === 0) {
      solveBendSet(state, dt);
    }
    profile.bendMs += performance.now() - phaseStarted;
    if (!seamFirst) {
      phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;
    }
    enforcePins(state);
    if (state.body.exactSurface && (
      iteration === 0
      || iteration === Math.floor(effectiveIterations / 2)
      || iteration === effectiveIterations - 1
    )) {
      phaseStarted = performance.now();
      solveBodyCollisions({
        predictedPositions: state.predictedPositions,
        previousPositions: state.previousPositions,
        velocities: state.velocities,
        inverseMasses: state.inverseMasses,
        correctionLimits: state.correctionLimits,
        maximumCorrectionM: state.config.maximumCorrection,
        fixedTimeStep: dt,
        body: state.body,
        allowSwept: iteration === 0,
        clothMaterialCoordinates: state.materialCoordinates,
      });
      profile.bodyCollisionMs += performance.now() - phaseStarted;
    }
  }

  // Constraint order must not let the final seam sweep purchase closure by
  // leaving the material bars/shear violated at the end of every step. One
  // symmetric material reconciliation makes the immutable 2D metric the last
  // hard boundary of the solve. Compatible seams remain closed; incompatible
  // ease/dart residual stays explicit instead of accumulating into the severe
  // first-frame stretch seen on the canonical skirt.
  phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;
  phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;
  enforcePins(state);

  phaseStarted = performance.now();
  solveBodyCollisions({ predictedPositions: state.predictedPositions, previousPositions: state.previousPositions, velocities: state.velocities, inverseMasses: state.inverseMasses, correctionLimits: state.correctionLimits, maximumCorrectionM: state.config.maximumCorrection, fixedTimeStep: dt, body: state.body, allowSwept: true, clothTriangles: state.triangles, clothMaterialCoordinates: state.materialCoordinates, finalReconciliation: true });
  profile.bodyCollisionMs += performance.now() - phaseStarted;
  phaseStarted = performance.now();
  solveFloorCollisions(state);
  profile.floorCollisionMs = performance.now() - phaseStarted;
  enforcePins(state);
  finalizeBodyContactDiagnostics(state.body);
  phaseStarted = performance.now();
  updateVelocitiesAndPositions(state, dt);
  applyBodyContactVelocities(state.velocities, state.body, dt);
  applyFloorContactVelocities(state);
  if (dressingActive) {
    state.velocities.fill(0);
    state.previousPositions.set(state.positions);
    state.body.dressingStepsRemaining = Math.max(0, state.body.dressingStepsRemaining - 1);
    if (state.body.dressingStepsRemaining === 0) state.body.grossDepenetrationEnabled = false;
  }
  profile.velocityUpdateMs = performance.now() - phaseStarted;
  state.stepCount += 1;

  phaseStarted = performance.now();
  const invalidReason = materialInstabilityReason(state, dressingActive);
  if (invalidReason) {
    state.positions.set(state.stablePositions);
    state.previousPositions.set(state.stablePositions);
    state.predictedPositions.set(state.stablePositions);
    state.velocities.fill(0);
    captureTriangleReferenceNormals(state);
    state.invalid = true;
    state.invalidReason = invalidReason;
    profile.validationMs = performance.now() - phaseStarted;
    profile.solverStepTotalMs = performance.now() - stepStarted;
    return;
  }

  state.stablePositions.set(state.positions);
  state.invalid = false;
  state.invalidReason = null;
  profile.validationMs = performance.now() - phaseStarted;
  profile.solverStepTotalMs = performance.now() - stepStarted;
}

export function resetXpbdState(state: XpbdState): void {
  state.positions.set(state.restPositions);
  state.previousPositions.set(state.restPositions);
  state.predictedPositions.set(state.restPositions);
  state.stablePositions.set(state.restPositions);
  state.triangleReferenceNormals.set(state.triangleMaterial.initialNormals);
  state.lastFlippedTriangleCount = 0;
  state.velocities.fill(0);
  state.accumulator = 0;
  state.stepCount = 0;
  state.maximumCorrectionApplied = 0;
  state.zeroEnergyFreeFlightActive = false;
  state.zeroEnergyFreeFlightOffset = [0, 0, 0];
  state.zeroEnergyFreeFlightVelocity = [0, 0, 0];
  state.invalid = false;
  state.invalidReason = null;
  resetBodyContactStep(state.body);
  resetFloorContactStep(state);
  initializeBodyDressing(state.body, state.positions, state.config.maximumCorrection, state.triangles);
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
  const seamErrorsByGroup: Record<string, XpbdSeamGroupErrorDiagnostic> = {};
  const seamCount = state.seams.restDistances.length;
  for (let index = 0; index < seamCount; index += 1) {
    const distance = seamDistance(state.positions, state.seams, index);
    const error = Math.abs(distance - state.seams.restDistances[index]);
    seamErrorSum += error;
    seamErrorMaximum = Math.max(seamErrorMaximum, error);
    const groupId = state.seams.seamGroupIds[index] ?? `ungrouped:${index}`;
    const group = seamErrorsByGroup[groupId] ?? {
      constraintCount: 0,
      meanError: 0,
      maxError: 0,
      worstConstraintIndex: index,
    };
    group.constraintCount += 1;
    group.meanError += error;
    if (error > group.maxError) {
      group.maxError = error;
      group.worstConstraintIndex = index;
    }
    seamErrorsByGroup[groupId] = group;
  }
  for (const group of Object.values(seamErrorsByGroup)) {
    group.meanError /= Math.max(1, group.constraintCount);
  }
  const materialMetrics = measureMaterialMetrics(state);
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
    stretchConstraintCount: state.distances.restLengths.length - legacyBendConstraintCount(state.distances.kinds),
    shearConstraintCount: state.shears.restCosines.length,
    bendConstraintCount: state.bends.restAngles.length + legacyBendConstraintCount(state.distances.kinds),
    seamConstraintCount: seamCount,
    seamErrorAverage: seamCount > 0 ? seamErrorSum / seamCount : 0,
    seamErrorMaximum,
    seamErrorsByGroup,
    maximumPositionMagnitude,
    maximumVelocityMagnitude,
    structuralStretchMeanRatio: materialMetrics.structuralStretchMeanRatio,
    structuralStretchMaxRatio: materialMetrics.structuralStretchMaxRatio,
    structuralCompressionMinRatio: materialMetrics.structuralCompressionMinRatio,
    shearStrainMean: materialMetrics.shearStrainMean,
    shearStrainMax: materialMetrics.shearStrainMax,
    triangleAreaMeanRatio: materialMetrics.triangleAreaMeanRatio,
    triangleAreaMinRatio: materialMetrics.triangleAreaMinRatio,
    triangleAreaMaxRatio: materialMetrics.triangleAreaMaxRatio,
    flippedTriangleCount: materialMetrics.flippedTriangleCount,
    garmentAabbGrowthRatio: materialMetrics.garmentAabbGrowthRatio,
    materialMetricsByPanel: materialMetrics.materialMetricsByPanel,
    materialMetricsByFabric: materialMetrics.materialMetricsByFabric,
    explicitPinCount: state.pins.indices.length,
    temporarySupportCount: 0,
    maximumCorrectionApplied: state.maximumCorrectionApplied,
    bodyColliderCount: state.body.exactSurface?.validation.triangleCount ?? state.body.colliders.kinds.length,
    bodyContactCount: state.body.bodyContactCount,
    bodyContactsByRegion: { ...state.body.bodyContactsByRegion },
    maximumBodyPenetrationM: state.body.maximumBodyPenetrationM,
    maximumBodyCorrectionM: state.body.maximumBodyCorrectionM,
    frictionContactCount: state.body.frictionContactCount,
    sweptContactCount: state.body.sweptContactCount,
    bodyCollisionEnabled: state.body.enabled,
    bodyCollisionMode: !state.body.enabled
      ? "disabled"
      : state.body.exactSurface
        ? "exact-human-surface"
        : "legacy-proxy",
    bodyMeshVertices: state.body.exactSurface?.validation.vertexCount ?? 0,
    bodyMeshTriangles: state.body.exactSurface?.validation.triangleCount ?? 0,
    bodyBvhNodes: state.body.exactSurface?.bvh.nodeCount ?? 0,
    bodyVisualCollisionMaxDeltaMm: state.body.exactSurface ? 0 : undefined,
    floorCollisionEnabled: state.config.floorCollisionEnabled !== false,
    floorContactCount: state.floorContactCount,
    floorCcdContactCount: state.floorCcdContactCount,
    floorFrictionContactCount: state.floorFrictionContactCount,
    maximumFloorPenetrationM: state.maximumFloorPenetrationM,
    meanFloorPenetrationM: state.meanFloorPenetrationM,
    invalid: state.invalid,
    invalidReason: state.invalidReason,
    droppedTimeSeconds,
    integrationMs: state.profile.integrationMs,
    stretchMs: state.profile.stretchMs,
    shearMs: state.profile.shearMs,
    bendMs: state.profile.bendMs,
    seamMs: state.profile.seamMs,
    velocityUpdateMs: state.profile.velocityUpdateMs,
    validationMs: state.profile.validationMs,
    solverStepTotalMs: state.profile.solverStepTotalMs,
    bodyCollisionMs: state.profile.bodyCollisionMs,
    floorCollisionMs: state.profile.floorCollisionMs,
    bodyBroadphaseMs: state.body.broadphaseMs,
    bodyNarrowphaseMs: state.body.narrowphaseMs,
    bodyProjectionMs: state.body.projectionMs,
    bodyFrictionMs: state.body.frictionMs,
    bodyParticleQueries: state.body.bodyParticleQueries,
    bodyColliderTests: state.body.bodyColliderTests,
    bodyCandidateColliderTests: state.body.bodyCandidateColliderTests,
    bodyBroadphaseRejected: state.body.bodyBroadphaseRejected,
    bodyBroadphaseRejectRate: state.body.bodyColliderTests > 0
      ? state.body.bodyBroadphaseRejected / state.body.bodyColliderTests
      : 0,
    bodyAverageCandidatesPerParticle: state.body.bodyParticleQueries > 0
      ? state.body.bodyCandidateColliderTests / state.body.bodyParticleQueries
      : 0,
    bodyCapsuleNarrowphaseTests: state.body.bodyCapsuleNarrowphaseTests,
    bodyEllipsoidNarrowphaseTests: state.body.bodyEllipsoidNarrowphaseTests,
    bodyPointContactsFound: state.body.bodyPointContactsFound,
    bodySweptTests: state.body.bodySweptTests,
    bodySweptContactsFound: state.body.bodySweptContactsFound,
    bodyExactSurface: state.body.exactSurface !== null,
    bodyBvhBuildMs: state.body.bvhBuildMs,
    bodyBvhNodeVisits: state.body.exactSurface?.bvhNodeVisits ?? 0,
    bodyTriangleTests: state.body.exactSurface?.triangleTests ?? state.body.bodyTriangleTests,
    bodyInsideTests: state.body.exactSurface?.insideTests ?? 0,
    bodyCcdTests: state.body.exactSurface?.ccdTests ?? 0,
    bodyCcdHits: state.body.bodySweptContactsFound,
    bodyCcdMs: state.body.ccdMs,
    bodyVertexContacts: state.body.bodyVertexContacts,
    bodyEdgeContacts: state.body.bodyEdgeContacts,
    bodyTriangleContacts: state.body.bodyTriangleContacts,
    bodyResidualIntersections: state.body.residualBodyIntersections,
    bodyResidualCrossings: state.body.residualBodyCrossings,
    bodyTriangleIntersectionCount: state.body.residualBodyTriangleIntersections + state.body.residualBodyCrossings,
    bodyCompleteCrossings: state.body.residualBodyCrossings,
    maximumSignedBodyPenetrationM: state.body.maximumSignedPenetrationM,
    bodySignedPenetrationMaxMm: state.body.maximumSignedPenetrationM * 1000,
    bodySignedPenetrationMeanMm: state.body.signedPenetrationSampleCount > 0
      ? state.body.signedPenetrationSumM / state.body.signedPenetrationSampleCount * 1000
      : 0,
    bodyClearanceErrorMaxMm: state.body.clearanceErrorMaximumM * 1000,
    bodyClearanceErrorMeanMm: state.body.clearanceErrorSampleCount > 0
      ? state.body.clearanceErrorSumM / state.body.clearanceErrorSampleCount * 1000
      : 0,
    bodyCandidatesPerQuery: state.body.exactSurface && state.body.exactSurface.queries > 0
      ? state.body.exactSurface.triangleTests / state.body.exactSurface.queries
      : 0,
    bodyBvhQueryMs: state.body.bvhQueryMs,
    bodyContactSolveMs: state.body.contactSolveMs,
    bodyIntersectionAuditMs: state.body.intersectionAuditMs,
    bodyInvalidClothPrimitiveSkips: state.body.invalidClothPrimitiveSkips,
    bodyLocalInitialOverlapSkipCount: state.body.localInitialOverlapSkipCount,
    bodyGlobalCollisionEarlyReturnCount: state.body.globalCollisionEarlyReturnCount,
    bodyContactSkipReasons: { ...state.body.contactSkipReasons },
    bodyStructuralContactDeferred: state.body.structuralContactDeferred,
    bodyAssemblyContactBlocked: state.body.assemblyContactBlocked,
    bodyDeepOverlapCount: state.body.deepOverlapCount,
    bodyInitialIntersectionCount: state.body.initialIntersectionCount,
    bodyDressingStepsRemaining: state.body.dressingStepsRemaining,
    bodyInitialDressingSteps: state.body.initialDressingSteps,
    initialOverlapRecoveryStatus: state.body.assemblyContactBlocked
      ? "initial-overlap-too-deep"
      : state.body.dressingStepsRemaining > 0
        ? "recovering"
        : state.body.initialDressingSteps > 0
          ? "recovered"
          : "not-needed",
    initialOverlapRecoverySteps: state.body.initialDressingSteps - state.body.dressingStepsRemaining,
    iterations: state.config.iterations,
    maximumSubsteps: state.config.maximumSubsteps,
  };
}

function canAdvanceAsZeroEnergyFreeFlight(state: XpbdState): boolean {
  if (state.body.enabled || state.config.floorCollisionEnabled !== false || state.pins.indices.length > 0 || state.positions.length === 0) return false;
  const particleCount = state.positions.length / 3;
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (state.inverseMasses[particle] <= 0) return false;
  }

  if (state.zeroEnergyFreeFlightActive) {
    const vx = state.velocities[0];
    const vy = state.velocities[1];
    const vz = state.velocities[2];
    for (let offset = 3; offset < state.velocities.length; offset += 3) {
      if (
        Math.abs(state.velocities[offset] - vx) > 1e-4
        || Math.abs(state.velocities[offset + 1] - vy) > 1e-4
        || Math.abs(state.velocities[offset + 2] - vz) > 1e-4
      ) return false;
    }
    return true;
  }

  const translation: readonly [number, number, number] = [
    state.positions[0] - state.restPositions[0],
    state.positions[1] - state.restPositions[1],
    state.positions[2] - state.restPositions[2],
  ];
  const velocity: readonly [number, number, number] = [
    state.velocities[0],
    state.velocities[1],
    state.velocities[2],
  ];
  for (let offset = 0; offset < state.positions.length; offset += 3) {
    if (
      Math.abs((state.positions[offset] - state.restPositions[offset]) - translation[0]) > 5e-5
      || Math.abs((state.positions[offset + 1] - state.restPositions[offset + 1]) - translation[1]) > 5e-5
      || Math.abs((state.positions[offset + 2] - state.restPositions[offset + 2]) - translation[2]) > 5e-5
      || Math.abs(state.velocities[offset] - velocity[0]) > 1e-5
      || Math.abs(state.velocities[offset + 1] - velocity[1]) > 1e-5
      || Math.abs(state.velocities[offset + 2] - velocity[2]) > 1e-5
    ) return false;
  }

  for (let index = 0; index < state.distances.restLengths.length; index += 1) {
    if (state.distances.kinds[index] !== 0) continue;
    const a = state.distances.indices[index * 2] * 3;
    const b = state.distances.indices[index * 2 + 1] * 3;
    const current = Math.hypot(
      state.positions[b] - state.positions[a],
      state.positions[b + 1] - state.positions[a + 1],
      state.positions[b + 2] - state.positions[a + 2],
    );
    const rest = state.distances.restLengths[index];
    if (Math.abs(current - rest) > Math.max(2e-6, rest * 5e-5)) return false;
  }
  for (let index = 0; index < state.shears.restCosines.length; index += 1) {
    const base = index * 3;
    const p0 = state.shears.indices[base] * 3;
    const p1 = state.shears.indices[base + 1] * 3;
    const p2 = state.shears.indices[base + 2] * 3;
    const e1x = state.positions[p1] - state.positions[p0];
    const e1y = state.positions[p1 + 1] - state.positions[p0 + 1];
    const e1z = state.positions[p1 + 2] - state.positions[p0 + 2];
    const e2x = state.positions[p2] - state.positions[p0];
    const e2y = state.positions[p2 + 1] - state.positions[p0 + 1];
    const e2z = state.positions[p2 + 2] - state.positions[p0 + 2];
    const denominator = Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z);
    if (denominator <= EPSILON) return false;
    const cosine = (e1x * e2x + e1y * e2y + e1z * e2z) / denominator;
    // Float32 assembly of a folded developable dart can differ from its
    // material cosine by roughly 1e-4 even when all edge lengths are within
    // the STEP-0 metric gate. Treat 1.25e-4 as numeric zero; it is not ease.
    if (Math.abs(cosine - state.shears.restCosines[index]) > 1.25e-4) return false;
  }
  const seamTolerance = Math.min(5e-5, Math.max(1e-6, state.config.seamTolerance));
  for (let index = 0; index < state.seams.restDistances.length; index += 1) {
    if (Math.abs(seamDistance(state.positions, state.seams, index) - state.seams.restDistances[index]) > seamTolerance) {
      return false;
    }
  }
  return true;
}

function advanceZeroEnergyFreeFlight(state: XpbdState, dt: number): void {
  if (state.stepCount === 0 || state.zeroEnergyFreeFlightOffset.every((value) => value === 0)) {
    state.zeroEnergyFreeFlightOffset = [
      state.positions[0] - state.restPositions[0],
      state.positions[1] - state.restPositions[1],
      state.positions[2] - state.restPositions[2],
    ];
    state.zeroEnergyFreeFlightVelocity = [
      state.velocities[0],
      state.velocities[1],
      state.velocities[2],
    ];
  }
  const displacement: [number, number, number] = [
    state.zeroEnergyFreeFlightVelocity[0] * dt + state.config.gravity[0] * dt * dt,
    state.zeroEnergyFreeFlightVelocity[1] * dt + state.config.gravity[1] * dt * dt,
    state.zeroEnergyFreeFlightVelocity[2] * dt + state.config.gravity[2] * dt * dt,
  ];
  for (let axis = 0; axis < 3; axis += 1) {
    state.zeroEnergyFreeFlightOffset[axis] += displacement[axis];
    state.zeroEnergyFreeFlightVelocity[axis] = displacement[axis] / dt * state.config.damping;
  }
  const speed = Math.hypot(...state.zeroEnergyFreeFlightVelocity);
  if (speed > state.config.maximumVelocity) {
    const scale = state.config.maximumVelocity / speed;
    for (let axis = 0; axis < 3; axis += 1) state.zeroEnergyFreeFlightVelocity[axis] *= scale;
  }
  for (let offset = 0; offset < state.positions.length; offset += 3) {
    state.predictedPositions[offset] = state.restPositions[offset] + state.zeroEnergyFreeFlightOffset[0];
    state.predictedPositions[offset + 1] = state.restPositions[offset + 1] + state.zeroEnergyFreeFlightOffset[1];
    state.predictedPositions[offset + 2] = state.restPositions[offset + 2] + state.zeroEnergyFreeFlightOffset[2];
    state.positions[offset] = state.predictedPositions[offset];
    state.positions[offset + 1] = state.predictedPositions[offset + 1];
    state.positions[offset + 2] = state.predictedPositions[offset + 2];
    state.velocities[offset] = state.zeroEnergyFreeFlightVelocity[0];
    state.velocities[offset + 1] = state.zeroEnergyFreeFlightVelocity[1];
    state.velocities[offset + 2] = state.zeroEnergyFreeFlightVelocity[2];
  }
}

interface MaterialMetricsSnapshot {
  structuralStretchMeanRatio: number;
  structuralStretchMaxRatio: number;
  structuralCompressionMinRatio: number;
  shearStrainMean: number;
  shearStrainMax: number;
  triangleAreaMeanRatio: number;
  triangleAreaMinRatio: number;
  triangleAreaMaxRatio: number;
  flippedTriangleCount: number;
  garmentAabbGrowthRatio: number;
  materialMetricsByPanel: Record<string, XpbdMaterialGroupDiagnostic>;
  materialMetricsByFabric: Record<string, XpbdMaterialGroupDiagnostic>;
  guardStretchConstraintCount: number;
  guardStretchRunawayCount: number;
  guardCompressionRunawayCount: number;
  guardTriangleCount: number;
  guardAreaCollapseCount: number;
  guardAreaExplosionCount: number;
}

function measureMaterialMetrics(state: XpbdState, captureReferenceNormals = false): MaterialMetricsSnapshot {
  let stretchSum = 0;
  let stretchMaximum = 0;
  let compressionMinimum = Number.POSITIVE_INFINITY;
  let stretchCount = 0;
  const meaningfulRestLength = state.meaningfulStructuralRestLength;
  let guardStretchConstraintCount = 0;
  let guardStretchRunawayCount = 0;
  let guardCompressionRunawayCount = 0;
  const panelMetrics: Record<string, XpbdMaterialGroupDiagnostic> = {};
  const fabricMetrics: Record<string, XpbdMaterialGroupDiagnostic> = {};
  for (let index = 0; index < state.distances.restLengths.length; index += 1) {
    if (state.distances.kinds[index] !== 0) continue;
    const rest = state.distances.restLengths[index];
    if (rest <= EPSILON) continue;
    const a = state.distances.indices[index * 2] * 3;
    const b = state.distances.indices[index * 2 + 1] * 3;
    const ratio = Math.hypot(
      state.positions[b] - state.positions[a],
      state.positions[b + 1] - state.positions[a + 1],
      state.positions[b + 2] - state.positions[a + 2],
    ) / rest;
    stretchSum += ratio;
    stretchMaximum = Math.max(stretchMaximum, ratio);
    compressionMinimum = Math.min(compressionMinimum, ratio);
    stretchCount += 1;
    if (rest >= meaningfulRestLength) {
      guardStretchConstraintCount += 1;
      if (ratio > 20) guardStretchRunawayCount += 1;
      if (ratio < 0.01) guardCompressionRunawayCount += 1;
    }
    accumulateMaterialGroup(panelMetrics, state.distances.panelIds?.[index] ?? "unassigned-panel", ratio);
    accumulateMaterialGroup(fabricMetrics, state.distances.fabricIds?.[index] ?? "unassigned-fabric", ratio);
  }
  finalizeMaterialGroups(panelMetrics);
  finalizeMaterialGroups(fabricMetrics);

  let shearSum = 0;
  let shearMaximum = 0;
  for (let index = 0; index < state.shears.restCosines.length; index += 1) {
    const base = index * 3;
    const a = state.shears.indices[base] * 3;
    const b = state.shears.indices[base + 1] * 3;
    const c = state.shears.indices[base + 2] * 3;
    const e1x = state.positions[b] - state.positions[a];
    const e1y = state.positions[b + 1] - state.positions[a + 1];
    const e1z = state.positions[b + 2] - state.positions[a + 2];
    const e2x = state.positions[c] - state.positions[a];
    const e2y = state.positions[c + 1] - state.positions[a + 1];
    const e2z = state.positions[c + 2] - state.positions[a + 2];
    const denominator = Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z);
    const strain = denominator > EPSILON
      ? Math.abs((e1x * e2x + e1y * e2y + e1z * e2z) / denominator - state.shears.restCosines[index])
      : 1;
    shearSum += strain;
    shearMaximum = Math.max(shearMaximum, strain);
  }

  let areaSum = 0;
  let areaMinimum = Number.POSITIVE_INFINITY;
  let areaMaximum = 0;
  let flippedTriangleCount = 0;
  const triangleCount = state.triangles.length / 3;
  const meaningfulRestArea = state.triangleMaterial.meaningfulRestArea;
  let guardTriangleCount = 0;
  let guardAreaCollapseCount = 0;
  let guardAreaExplosionCount = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 3;
    const a = state.triangles[base] * 3;
    const b = state.triangles[base + 1] * 3;
    const c = state.triangles[base + 2] * 3;
    const abx = state.positions[b] - state.positions[a];
    const aby = state.positions[b + 1] - state.positions[a + 1];
    const abz = state.positions[b + 2] - state.positions[a + 2];
    const acx = state.positions[c] - state.positions[a];
    const acy = state.positions[c + 1] - state.positions[a + 1];
    const acz = state.positions[c + 2] - state.positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const doubleArea = Math.hypot(nx, ny, nz);
    const restArea = state.triangleMaterial.restAreas[triangle];
    const ratio = restArea > EPSILON ? doubleArea * 0.5 / restArea : 1;
    areaSum += ratio;
    areaMinimum = Math.min(areaMinimum, ratio);
    areaMaximum = Math.max(areaMaximum, ratio);
    if (restArea >= meaningfulRestArea) {
      guardTriangleCount += 1;
      if (ratio < 0.001) guardAreaCollapseCount += 1;
      if (ratio > 250) guardAreaExplosionCount += 1;
    }
    const referenceOffset = triangle * 3;
    const rx = state.triangleReferenceNormals[referenceOffset];
    const ry = state.triangleReferenceNormals[referenceOffset + 1];
    const rz = state.triangleReferenceNormals[referenceOffset + 2];
    const referenceLength = Math.hypot(rx, ry, rz);
    if (doubleArea > EPSILON && referenceLength > EPSILON
      && (nx * rx + ny * ry + nz * rz) / (doubleArea * referenceLength) < 0) {
      flippedTriangleCount += 1;
    }
    if (captureReferenceNormals && doubleArea > EPSILON) {
      state.triangleReferenceNormals[referenceOffset] = nx / doubleArea;
      state.triangleReferenceNormals[referenceOffset + 1] = ny / doubleArea;
      state.triangleReferenceNormals[referenceOffset + 2] = nz / doubleArea;
    }
  }
  if (captureReferenceNormals) state.lastFlippedTriangleCount = flippedTriangleCount;
  else flippedTriangleCount = state.lastFlippedTriangleCount;
  const currentAabbDiagonal = aabbDiagonal(state.positions);
  const initialAabbDiagonal = state.triangleMaterial.initialAabbDiagonal;
  return {
    structuralStretchMeanRatio: stretchCount > 0 ? stretchSum / stretchCount : 1,
    structuralStretchMaxRatio: stretchCount > 0 ? stretchMaximum : 1,
    structuralCompressionMinRatio: stretchCount > 0 ? compressionMinimum : 1,
    shearStrainMean: state.shears.restCosines.length > 0 ? shearSum / state.shears.restCosines.length : 0,
    shearStrainMax: shearMaximum,
    triangleAreaMeanRatio: triangleCount > 0 ? areaSum / triangleCount : 1,
    triangleAreaMinRatio: triangleCount > 0 ? areaMinimum : 1,
    triangleAreaMaxRatio: triangleCount > 0 ? areaMaximum : 1,
    flippedTriangleCount,
    garmentAabbGrowthRatio: initialAabbDiagonal > EPSILON ? currentAabbDiagonal / initialAabbDiagonal : 1,
    materialMetricsByPanel: panelMetrics,
    materialMetricsByFabric: fabricMetrics,
    guardStretchConstraintCount,
    guardStretchRunawayCount,
    guardCompressionRunawayCount,
    guardTriangleCount,
    guardAreaCollapseCount,
    guardAreaExplosionCount,
  };
}

function accumulateMaterialGroup(
  groups: Record<string, XpbdMaterialGroupDiagnostic>,
  key: string,
  ratio: number,
): void {
  const group = groups[key] ?? {
    constraintCount: 0,
    structuralStretchMeanRatio: 0,
    structuralStretchMaxRatio: 0,
    structuralCompressionMinRatio: Number.POSITIVE_INFINITY,
  };
  group.constraintCount += 1;
  group.structuralStretchMeanRatio += ratio;
  group.structuralStretchMaxRatio = Math.max(group.structuralStretchMaxRatio, ratio);
  group.structuralCompressionMinRatio = Math.min(group.structuralCompressionMinRatio, ratio);
  groups[key] = group;
}

function finalizeMaterialGroups(groups: Record<string, XpbdMaterialGroupDiagnostic>): void {
  for (const group of Object.values(groups)) {
    group.structuralStretchMeanRatio /= Math.max(1, group.constraintCount);
    if (!Number.isFinite(group.structuralCompressionMinRatio)) group.structuralCompressionMinRatio = 1;
  }
}

function legacyBendConstraintCount(kinds: Uint8Array): number {
  let count = 0;
  for (const kind of kinds) if (kind === 1) count += 1;
  return count;
}

function meaningfulStructuralRestLength(distances: XpbdDistanceConstraints): number {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < distances.restLengths.length; index += 1) {
    if (distances.kinds[index] !== 0 || distances.restLengths[index] <= EPSILON) continue;
    sum += distances.restLengths[index];
    count += 1;
  }
  return count > 0 ? Math.max(EPSILON, sum / count * 1e-4) : EPSILON;
}

function materialInstabilityReason(
  state: XpbdState,
  bodyDressingActive = false,
): XpbdState["invalidReason"] {
  if (!positionsAreSafe(state.positions)) return "non-finite";
  // Gross body depenetration is a bounded setup phase, not a material state.
  // Velocities are zeroed during it, so accept it as the next rollback point and
  // start metric catastrophe detection once the normal solver takes ownership.
  if (state.config.metricGuardEnabled === false || bodyDressingActive) {
    state.lastFlippedTriangleCount = 0;
    captureTriangleReferenceNormals(state);
    return null;
  }
  const metrics = measureMaterialMetrics(state, true);
  const catastrophicFlipCount = Math.max(12, Math.ceil(state.triangles.length / 6));
  const runawayStretchLimit = guardFailureCount(metrics.guardStretchConstraintCount);
  const runawayAreaLimit = guardFailureCount(metrics.guardTriangleCount, 0.02);
  if (metrics.guardStretchRunawayCount >= runawayStretchLimit
    || metrics.guardCompressionRunawayCount >= runawayStretchLimit
    || metrics.guardAreaCollapseCount >= runawayAreaLimit
    || metrics.guardAreaExplosionCount >= runawayAreaLimit
    || metrics.triangleAreaMaxRatio > 1_000_000
    || metrics.garmentAabbGrowthRatio > 10
    || (metrics.flippedTriangleCount >= catastrophicFlipCount && metrics.triangleAreaMinRatio < 0.05)) {
    return "metric-instability";
  }
  return null;
}

function guardFailureCount(sampleCount: number, fraction = 0.01): number {
  if (sampleCount < 100) return 1;
  return Math.max(2, Math.ceil(sampleCount * fraction));
}

function integrate(
  state: XpbdState,
  dt: number,
  gravity: readonly [number, number, number] = state.config.gravity,
): void {
  const [gx, gy, gz] = gravity;
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
  const set=state.distances,pos=state.predictedPositions,inv=state.inverseMasses,limits=state.correctionLimits,alphaScale=1/(dt*dt); let maxApplied=state.maximumCorrectionApplied;
  for(let i=0;i<set.restLengths.length;i+=1){
    if(set.kinds[i]!==kind)continue; const k=i*2,a=set.indices[k],b=set.indices[k+1],oa=a*3,ob=b*3;
    const dx=pos[ob]-pos[oa],dy=pos[ob+1]-pos[oa+1],dz=pos[ob+2]-pos[oa+2],ls=dx*dx+dy*dy+dz*dz; if(ls<=EPSILON*EPSILON)continue;
    const len=Math.sqrt(ls),wa=inv[a],wb=inv[b],c=set.compliances[i],alpha=(c>0?c:0)*alphaScale,den=wa+wb+alpha; if(den<=EPSILON)continue;
    const raw=(-(len-set.restLengths[i])-alpha*set.lambdas[i])/den; let mm=Number.POSITIVE_INFINITY;
    if(wa>EPSILON)mm=limits[a]/wa; if(wb>EPSILON){const q=limits[b]/wb;if(q<mm)mm=q;} if(!Number.isFinite(mm))mm=0;
    const dl=clampMultiplierByPositionCorrection(raw,mm); set.lambdas[i]+=dl; const il=1/len,nx=dx*il,ny=dy*il,nz=dz*il,sa=dl*wa,sb=dl*wb;
    pos[oa]-=nx*sa;pos[oa+1]-=ny*sa;pos[oa+2]-=nz*sa;pos[ob]+=nx*sb;pos[ob+1]+=ny*sb;pos[ob+2]+=nz*sb;
    const applied=Math.abs(dl)*(wa>wb?wa:wb);if(applied>maxApplied)maxApplied=applied;
  } state.maximumCorrectionApplied=maxApplied;
}

function solveShearSet(state: XpbdState, dt: number): void {
 const set=state.shears,pos=state.predictedPositions,inv=state.inverseMasses,limits=state.correctionLimits,alphaScale=1/(dt*dt);let maxApplied=state.maximumCorrectionApplied;
 for(let i=0;i<set.restCosines.length;i+=1){
  const k=i*3,p0=set.indices[k],p1=set.indices[k+1],p2=set.indices[k+2],o0=p0*3,o1=p1*3,o2=p2*3;
  const e1x=pos[o1]-pos[o0],e1y=pos[o1+1]-pos[o0+1],e1z=pos[o1+2]-pos[o0+2],e2x=pos[o2]-pos[o0],e2y=pos[o2+1]-pos[o0+1],e2z=pos[o2+2]-pos[o0+2];
  const l1s=e1x*e1x+e1y*e1y+e1z*e1z,l2s=e2x*e2x+e2y*e2y+e2z*e2z;if(l1s<=EPSILON*EPSILON||l2s<=EPSILON*EPSILON)continue;
  const l1=Math.sqrt(l1s),l2=Math.sqrt(l2s),i1=1/l1,i2=1/l2,ux=e1x*i1,uy=e1y*i1,uz=e1z*i1,vx=e2x*i2,vy=e2y*i2,vz=e2z*i2,cos=ux*vx+uy*vy+uz*vz;
  const g1x=(vx-cos*ux)*i1,g1y=(vy-cos*uy)*i1,g1z=(vz-cos*uz)*i1,g2x=(ux-cos*vx)*i2,g2y=(uy-cos*vy)*i2,g2z=(uz-cos*vz)*i2,g0x=-(g1x+g2x),g0y=-(g1y+g2y),g0z=-(g1z+g2z);
  const q0=g0x*g0x+g0y*g0y+g0z*g0z,q1=g1x*g1x+g1y*g1y+g1z*g1z,q2=g2x*g2x+g2y*g2y+g2z*g2z,w0=inv[p0],w1=inv[p1],w2=inv[p2],c=set.compliances[i],alpha=(c>0?c:0)*alphaScale,den=w0*q0+w1*q1+w2*q2+alpha;if(den<=EPSILON)continue;
  const raw=(-(cos-set.restCosines[i])-alpha*set.lambdas[i])/den,m0=Math.sqrt(q0),m1=Math.sqrt(q1),m2=Math.sqrt(q2);let mm=Number.POSITIVE_INFINITY,wg=w0*m0;
  if(wg>EPSILON)mm=limits[p0]/wg;wg=w1*m1;if(wg>EPSILON){const q=limits[p1]/wg;if(q<mm)mm=q;}wg=w2*m2;if(wg>EPSILON){const q=limits[p2]/wg;if(q<mm)mm=q;}if(!Number.isFinite(mm))mm=0;
  const dl=clampMultiplierByPositionCorrection(raw,mm);set.lambdas[i]+=dl;const s0=dl*w0,s1=dl*w1,s2=dl*w2;
  pos[o0]+=g0x*s0;pos[o0+1]+=g0y*s0;pos[o0+2]+=g0z*s0;pos[o1]+=g1x*s1;pos[o1+1]+=g1y*s1;pos[o1+2]+=g1z*s1;pos[o2]+=g2x*s2;pos[o2+1]+=g2y*s2;pos[o2+2]+=g2z*s2;
  const applied=Math.abs(dl)*Math.max(w0*m0,w1*m1,w2*m2);if(applied>maxApplied)maxApplied=applied;
 }state.maximumCorrectionApplied=maxApplied;
}

function solveBendSet(state: XpbdState, dt: number): void {
  const set = state.bends;
  const pos = state.predictedPositions;
  const inv = state.inverseMasses;
  const limits = state.correctionLimits;
  const alphaScale = 1 / (dt * dt);
  let maxApplied = state.maximumCorrectionApplied;
  for (let index = 0; index < set.restAngles.length; index += 1) {
    const base = index * 4;
    const p0 = set.indices[base];
    const p1 = set.indices[base + 1];
    const p2 = set.indices[base + 2];
    const p3 = set.indices[base + 3];
    const o0 = p0 * 3;
    const o1 = p1 * 3;
    const o2 = p2 * 3;
    const o3 = p3 * 3;
    const ex = pos[o3] - pos[o2];
    const ey = pos[o3 + 1] - pos[o2 + 1];
    const ez = pos[o3 + 2] - pos[o2 + 2];
    const edgeLengthSquared = ex * ex + ey * ey + ez * ez;
    if (edgeLengthSquared <= EPSILON * EPSILON) continue;
    const edgeLength = Math.sqrt(edgeLengthSquared);
    const inverseEdgeLength = 1 / edgeLength;

    const a1x = pos[o2] - pos[o0];
    const a1y = pos[o2 + 1] - pos[o0 + 1];
    const a1z = pos[o2 + 2] - pos[o0 + 2];
    const b1x = pos[o3] - pos[o0];
    const b1y = pos[o3 + 1] - pos[o0 + 1];
    const b1z = pos[o3 + 2] - pos[o0 + 2];
    let n1x = a1y * b1z - a1z * b1y;
    let n1y = a1z * b1x - a1x * b1z;
    let n1z = a1x * b1y - a1y * b1x;
    const n1Squared = n1x * n1x + n1y * n1y + n1z * n1z;

    const a2x = pos[o3] - pos[o1];
    const a2y = pos[o3 + 1] - pos[o1 + 1];
    const a2z = pos[o3 + 2] - pos[o1 + 2];
    const b2x = pos[o2] - pos[o1];
    const b2y = pos[o2 + 1] - pos[o1 + 1];
    const b2z = pos[o2 + 2] - pos[o1 + 2];
    let n2x = a2y * b2z - a2z * b2y;
    let n2y = a2z * b2x - a2x * b2z;
    let n2z = a2x * b2y - a2y * b2x;
    const n2Squared = n2x * n2x + n2y * n2y + n2z * n2z;
    if (n1Squared <= EPSILON * EPSILON || n2Squared <= EPSILON * EPSILON) continue;

    n1x /= n1Squared; n1y /= n1Squared; n1z /= n1Squared;
    n2x /= n2Squared; n2y /= n2Squared; n2z /= n2Squared;
    const d0x = edgeLength * n1x;
    const d0y = edgeLength * n1y;
    const d0z = edgeLength * n1z;
    const d1x = edgeLength * n2x;
    const d1y = edgeLength * n2y;
    const d1z = edgeLength * n2z;
    const p0p3DotEdge = (pos[o0] - pos[o3]) * ex + (pos[o0 + 1] - pos[o3 + 1]) * ey + (pos[o0 + 2] - pos[o3 + 2]) * ez;
    const p1p3DotEdge = (pos[o1] - pos[o3]) * ex + (pos[o1 + 1] - pos[o3 + 1]) * ey + (pos[o1 + 2] - pos[o3 + 2]) * ez;
    const p2p0DotEdge = (pos[o2] - pos[o0]) * ex + (pos[o2 + 1] - pos[o0 + 1]) * ey + (pos[o2 + 2] - pos[o0 + 2]) * ez;
    const p2p1DotEdge = (pos[o2] - pos[o1]) * ex + (pos[o2 + 1] - pos[o1 + 1]) * ey + (pos[o2 + 2] - pos[o1 + 2]) * ez;
    const d2x = p0p3DotEdge * inverseEdgeLength * n1x + p1p3DotEdge * inverseEdgeLength * n2x;
    const d2y = p0p3DotEdge * inverseEdgeLength * n1y + p1p3DotEdge * inverseEdgeLength * n2y;
    const d2z = p0p3DotEdge * inverseEdgeLength * n1z + p1p3DotEdge * inverseEdgeLength * n2z;
    const d3x = p2p0DotEdge * inverseEdgeLength * n1x + p2p1DotEdge * inverseEdgeLength * n2x;
    const d3y = p2p0DotEdge * inverseEdgeLength * n1y + p2p1DotEdge * inverseEdgeLength * n2y;
    const d3z = p2p0DotEdge * inverseEdgeLength * n1z + p2p1DotEdge * inverseEdgeLength * n2z;

    const inverseN1Length = Math.sqrt(n1Squared);
    const inverseN2Length = Math.sqrt(n2Squared);
    const u1x = n1x * inverseN1Length;
    const u1y = n1y * inverseN1Length;
    const u1z = n1z * inverseN1Length;
    const u2x = n2x * inverseN2Length;
    const u2y = n2y * inverseN2Length;
    const u2z = n2z * inverseN2Length;
    const cosine = Math.min(1, Math.max(-1, u1x * u2x + u1y * u2y + u1z * u2z));
    const angle = (-0.6981317 * cosine * cosine - 0.8726646) * cosine + 1.570796;
    const orientation = ((u1y * u2z - u1z * u2y) * ex
      + (u1z * u2x - u1x * u2z) * ey
      + (u1x * u2y - u1y * u2x) * ez) > 0 ? -1 : 1;
    const constraint = (angle - set.restAngles[index]) * orientation;
    const g0 = d0x * d0x + d0y * d0y + d0z * d0z;
    const g1 = d1x * d1x + d1y * d1y + d1z * d1z;
    const g2 = d2x * d2x + d2y * d2y + d2z * d2z;
    const g3 = d3x * d3x + d3y * d3y + d3z * d3z;
    const alpha = Math.max(0, set.compliances[index]) * alphaScale;
    const denominator = inv[p0] * g0 + inv[p1] * g1 + inv[p2] * g2 + inv[p3] * g3 + alpha;
    if (denominator <= EPSILON) continue;
    const rawDelta = (-constraint - alpha * set.lambdas[index]) / denominator;
    let maximumMultiplier = Number.POSITIVE_INFINITY;
    let weightedGradient = inv[p0] * Math.sqrt(g0);
    if (weightedGradient > EPSILON) maximumMultiplier = limits[p0] / weightedGradient;
    weightedGradient = inv[p1] * Math.sqrt(g1);
    if (weightedGradient > EPSILON) maximumMultiplier = Math.min(maximumMultiplier, limits[p1] / weightedGradient);
    weightedGradient = inv[p2] * Math.sqrt(g2);
    if (weightedGradient > EPSILON) maximumMultiplier = Math.min(maximumMultiplier, limits[p2] / weightedGradient);
    weightedGradient = inv[p3] * Math.sqrt(g3);
    if (weightedGradient > EPSILON) maximumMultiplier = Math.min(maximumMultiplier, limits[p3] / weightedGradient);
    if (!Number.isFinite(maximumMultiplier)) maximumMultiplier = 0;
    const delta = clampMultiplierByPositionCorrection(rawDelta, maximumMultiplier);
    set.lambdas[index] += delta;
    const scale0 = delta * inv[p0];
    const scale1 = delta * inv[p1];
    const scale2 = delta * inv[p2];
    const scale3 = delta * inv[p3];
    pos[o0] += d0x * scale0; pos[o0 + 1] += d0y * scale0; pos[o0 + 2] += d0z * scale0;
    pos[o1] += d1x * scale1; pos[o1 + 1] += d1y * scale1; pos[o1 + 2] += d1z * scale1;
    pos[o2] += d2x * scale2; pos[o2 + 1] += d2y * scale2; pos[o2 + 2] += d2z * scale2;
    pos[o3] += d3x * scale3; pos[o3 + 1] += d3y * scale3; pos[o3 + 2] += d3z * scale3;
    const applied0 = Math.abs(scale0) * Math.sqrt(g0);
    const applied1 = Math.abs(scale1) * Math.sqrt(g1);
    const applied2 = Math.abs(scale2) * Math.sqrt(g2);
    const applied3 = Math.abs(scale3) * Math.sqrt(g3);
    maxApplied = Math.max(maxApplied, applied0, applied1, applied2, applied3);
  }
  state.maximumCorrectionApplied = maxApplied;
}

function solveSeamSet(state: XpbdState, dt: number): void {
 const seams=state.seams,pos=state.predictedPositions,inv=state.inverseMasses,limits=state.correctionLimits,alphaScale=1/(dt*dt);let maxApplied=state.maximumCorrectionApplied;
 for(let i=0;i<seams.restDistances.length;i+=1){const b=i*4,p0=seams.indices[b],p1=seams.indices[b+1],p2=seams.indices[b+2],p3=seams.indices[b+3],w0=seams.weights[b],w1=seams.weights[b+1],w2=seams.weights[b+2],w3=seams.weights[b+3];
  let ax=0,ay=0,az=0,bx=0,by=0,bz=0;if(p0!==XPBD_MISSING_PARTICLE){const o=p0*3;ax+=pos[o]*w0;ay+=pos[o+1]*w0;az+=pos[o+2]*w0;}if(p1!==XPBD_MISSING_PARTICLE){const o=p1*3;ax+=pos[o]*w1;ay+=pos[o+1]*w1;az+=pos[o+2]*w1;}if(p2!==XPBD_MISSING_PARTICLE){const o=p2*3;bx+=pos[o]*w2;by+=pos[o+1]*w2;bz+=pos[o+2]*w2;}if(p3!==XPBD_MISSING_PARTICLE){const o=p3*3;bx+=pos[o]*w3;by+=pos[o+1]*w3;bz+=pos[o+2]*w3;}
  const dx=bx-ax,dy=by-ay,dz=bz-az,ls=dx*dx+dy*dy+dz*dz;if(ls<=EPSILON*EPSILON)continue;const len=Math.sqrt(ls);let c0=p0===XPBD_MISSING_PARTICLE?0:-w0,c1=p1===XPBD_MISSING_PARTICLE?0:-w1,c2=p2===XPBD_MISSING_PARTICLE?0:w2,c3=p3===XPBD_MISSING_PARTICLE?0:w3;
  if(c1&&p1===p0){c0+=c1;c1=0;}if(c2){if(p2===p0){c0+=c2;c2=0;}else if(c1&&p2===p1){c1+=c2;c2=0;}}if(c3){if(p3===p0){c0+=c3;c3=0;}else if(c1&&p3===p1){c1+=c3;c3=0;}else if(c2&&p3===p2){c2+=c3;c3=0;}}
  let mass=0,mm=Number.POSITIVE_INFINITY;const relax=seams.relaxations[i];const add=(p:number,c:number)=>{if(Math.abs(c)<=EPSILON)return;mass+=inv[p]*c*c;const wg=inv[p]*Math.abs(c);if(wg>EPSILON){const q=limits[p]*relax/wg;if(q<mm)mm=q;}};add(p0,c0);add(p1,c1);add(p2,c2);add(p3,c3);
  const cp=seams.compliances[i],alpha=(cp>0?cp:0)*alphaScale,den=mass+alpha;if(den<=EPSILON)continue;const raw=(-(len-seams.restDistances[i])-alpha*seams.lambdas[i])/den;if(!Number.isFinite(mm))mm=0;const dl=clampMultiplierByPositionCorrection(raw,mm);seams.lambdas[i]+=dl;const il=1/len,nx=dx*il,ny=dy*il,nz=dz*il;
  const apply=(p:number,c:number)=>{if(Math.abs(c)<=EPSILON)return;const sc=dl*c*inv[p],o=p*3;pos[o]+=nx*sc;pos[o+1]+=ny*sc;pos[o+2]+=nz*sc;const a=Math.abs(sc);if(a>maxApplied)maxApplied=a;};apply(p0,c0);apply(p1,c1);apply(p2,c2);apply(p3,c3);
 }state.maximumCorrectionApplied=maxApplied;
}

function resetFloorContactStep(state: XpbdState): void {
  state.floorContactMask.fill(0);
  state.floorNormalImpulseSpeeds.fill(0);
  state.floorContactCount = 0;
  state.floorCcdContactCount = 0;
  state.floorFrictionContactCount = 0;
  state.maximumFloorPenetrationM = 0;
  state.meanFloorPenetrationM = 0;
}

/**
 * Infinite horizontal unilateral contact plane in canonical body space.
 * It is deliberately independent from the avatar collider toggle.  The CCD
 * branch records a previous->predicted crossing; both crossing and resting
 * contacts finish at the same thickness-aware surface without restitution.
 */
function solveFloorCollisions(state: XpbdState): void {
  if (state.config.floorCollisionEnabled === false) return;
  const floorY = Number.isFinite(state.config.floorY) ? (state.config.floorY ?? 0) : 0;
  const skin = Math.max(0, state.config.floorContactSkinM ?? 0.0002);
  for (let particle = 0; particle < state.inverseMasses.length; particle += 1) {
    if (state.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const contactY = floorY + Math.max(0, state.body.particleHalfThicknessM[particle] ?? 0) + skin;
    const previousY = state.previousPositions[offset + 1];
    const predictedY = state.predictedPositions[offset + 1];
    if (predictedY >= contactY) continue;
    const penetration = contactY - predictedY;
    const incomingNormalSpeed = Math.max(0, (previousY - predictedY) / Math.max(EPSILON, state.config.fixedTimeStep));
    const supportImpulseSpeed = Math.max(0, -state.config.gravity[1]) * state.config.fixedTimeStep;
    state.floorContactMask[particle] = 1;
    // Coulomb friction consumes a velocity-equivalent normal impulse.  It is
    // derived from incoming normal momentum plus the gravity support load,
    // never from the number of millimetres used by positional projection.
    state.floorNormalImpulseSpeeds[particle] = incomingNormalSpeed + supportImpulseSpeed;
    state.floorContactCount += 1;
    if (previousY >= contactY && predictedY < contactY) state.floorCcdContactCount += 1;
    state.predictedPositions[offset + 1] = contactY;
  }
  // Telemetry reports the residual penetration after the unilateral solve,
  // not the swept travel distance corrected by CCD.  The latter is retained
  // separately as a physical normal-impulse estimate for load/friction.
  state.maximumFloorPenetrationM = 0;
  state.meanFloorPenetrationM = 0;
}

function applyFloorContactVelocities(state: XpbdState): void {
  if (state.config.floorCollisionEnabled === false) return;
  for (let particle = 0; particle < state.inverseMasses.length; particle += 1) {
    if (state.floorContactMask[particle] === 0) continue;
    const offset = particle * 3;
    // The normal component is unilateral and non-bouncy: only velocity into
    // the plane is removed, never a legitimate upward separating velocity.
    if (state.velocities[offset + 1] < 0) state.velocities[offset + 1] = 0;
    const vx = state.velocities[offset];
    const vz = state.velocities[offset + 2];
    const tangentSpeed = Math.hypot(vx, vz);
    if (tangentSpeed <= EPSILON) continue;
    const friction = Math.max(0, state.body.particleFriction[particle] ?? 0);
    const normalLoadSpeed = state.floorNormalImpulseSpeeds[particle];
    const removedSpeed = Math.min(tangentSpeed, friction * normalLoadSpeed);
    if (removedSpeed <= 0) continue;
    const scale = (tangentSpeed - removedSpeed) / tangentSpeed;
    state.velocities[offset] *= scale;
    state.velocities[offset + 2] *= scale;
    state.floorFrictionContactCount += 1;
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
    // An absolute velocity cap must be identical for every particle. Deriving
    // it from the local tessellation makes uniform gravity non-uniform: fine
    // panels stop before coarse panels and seams are pulled apart even during
    // rigid translation. Local edge scales remain valid for projection trust
    // regions, but not for world-space velocity.
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
  state.bends.lambdas.fill(0);
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

function validateStateShape(input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "triangleReferenceNormals" | "lastFlippedTriangleCount" | "meaningfulStructuralRestLength" | "maximumCorrectionApplied" | "zeroEnergyFreeFlightActive" | "zeroEnergyFreeFlightOffset" | "zeroEnergyFreeFlightVelocity" | "floorContactMask" | "floorNormalImpulseSpeeds" | "floorContactCount" | "floorCcdContactCount" | "floorFrictionContactCount" | "maximumFloorPenetrationM" | "meanFloorPenetrationM" | "accumulator" | "stepCount" | "invalid" | "invalidReason" | "profile">): void {
  const particleCount = input.positions.length / 3;
  if (!Number.isInteger(particleCount)
    || input.previousPositions.length !== input.positions.length
    || input.predictedPositions.length !== input.positions.length
    || input.velocities.length !== input.positions.length
    || input.restPositions.length !== input.positions.length
    || input.materialCoordinates.length !== particleCount * 2
    || input.inverseMasses.length !== particleCount
    || input.triangles.length % 3 !== 0
    || input.triangleMaterial.restAreas.length !== input.triangles.length / 3
    || input.triangleMaterial.orientations.length !== input.triangles.length / 3
    || input.triangleMaterial.initialNormals.length !== input.triangles.length) {
    throw new RangeError("Os buffers SoA da simula\u00e7\u00e3o possuem dimens\u00f5es incompat\u00edveis.");
  }
  if (input.distances.indices.length !== input.distances.restLengths.length * 2
    || input.distances.compliances.length !== input.distances.restLengths.length
    || input.distances.lambdas.length !== input.distances.restLengths.length
    || input.distances.kinds.length !== input.distances.restLengths.length
    || input.shears.indices.length !== input.shears.restCosines.length * 3
    || input.shears.compliances.length !== input.shears.restCosines.length
    || input.shears.lambdas.length !== input.shears.restCosines.length
    || input.bends.indices.length !== input.bends.restAngles.length * 4
    || input.bends.compliances.length !== input.bends.restAngles.length
    || input.bends.lambdas.length !== input.bends.restAngles.length
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
  assertParticleIndices(input.bends.indices, particleCount, false, "bends");
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
    input.triangleMaterial.restAreas,
    input.triangleMaterial.initialNormals,
    input.distances.restLengths,
    input.distances.compliances,
    input.shears.restCosines,
    input.shears.compliances,
    input.bends.restAngles,
    input.bends.compliances,
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

export function buildTriangleMaterialReference(
  materialCoordinates: Float32Array,
  triangles: Uint32Array,
  initialPositions: Float32Array,
): XpbdTriangleMaterialReference {
  const triangleCount = triangles.length / 3;
  const restAreas = new Float32Array(triangleCount);
  const orientations = new Int8Array(triangleCount);
  const initialNormals = new Float32Array(triangles.length);
  let restAreaSum = 0;
  let restAreaCount = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 3;
    const ia = triangles[base];
    const ib = triangles[base + 1];
    const ic = triangles[base + 2];
    const abx2 = materialCoordinates[ib * 2] - materialCoordinates[ia * 2];
    const aby2 = materialCoordinates[ib * 2 + 1] - materialCoordinates[ia * 2 + 1];
    const acx2 = materialCoordinates[ic * 2] - materialCoordinates[ia * 2];
    const acy2 = materialCoordinates[ic * 2 + 1] - materialCoordinates[ia * 2 + 1];
    const signedDoubleArea = abx2 * acy2 - aby2 * acx2;
    restAreas[triangle] = Math.abs(signedDoubleArea) * 0.5;
    if (restAreas[triangle] > EPSILON) {
      restAreaSum += restAreas[triangle];
      restAreaCount += 1;
    }
    orientations[triangle] = signedDoubleArea < 0 ? -1 : 1;

    const a = ia * 3;
    const b = ib * 3;
    const c = ic * 3;
    const abx = initialPositions[b] - initialPositions[a];
    const aby = initialPositions[b + 1] - initialPositions[a + 1];
    const abz = initialPositions[b + 2] - initialPositions[a + 2];
    const acx = initialPositions[c] - initialPositions[a];
    const acy = initialPositions[c + 1] - initialPositions[a + 1];
    const acz = initialPositions[c + 2] - initialPositions[a + 2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (length > EPSILON) {
      nx /= length; ny /= length; nz /= length;
    }
    initialNormals[base] = nx;
    initialNormals[base + 1] = ny;
    initialNormals[base + 2] = nz;
  }
  return {
    restAreas,
    orientations,
    initialNormals,
    initialAabbDiagonal: aabbDiagonal(initialPositions),
    meaningfulRestArea: restAreaCount > 0
      ? Math.max(EPSILON, restAreaSum / restAreaCount * 1e-5)
      : EPSILON,
  };
}

function captureTriangleReferenceNormals(state: XpbdState): void {
  for (let triangle = 0; triangle < state.triangles.length / 3; triangle += 1) {
    const base = triangle * 3;
    const a = state.triangles[base] * 3;
    const b = state.triangles[base + 1] * 3;
    const c = state.triangles[base + 2] * 3;
    const abx = state.positions[b] - state.positions[a];
    const aby = state.positions[b + 1] - state.positions[a + 1];
    const abz = state.positions[b + 2] - state.positions[a + 2];
    const acx = state.positions[c] - state.positions[a];
    const acy = state.positions[c + 1] - state.positions[a + 1];
    const acz = state.positions[c + 2] - state.positions[a + 2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (length > EPSILON) {
      nx /= length;
      ny /= length;
      nz /= length;
      state.triangleReferenceNormals[base] = nx;
      state.triangleReferenceNormals[base + 1] = ny;
      state.triangleReferenceNormals[base + 2] = nz;
    }
  }
}

function aabbDiagonal(positions: Float32Array): number {
  if (positions.length === 0) return 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset < positions.length; offset += 3) {
    minX = Math.min(minX, positions[offset]);
    minY = Math.min(minY, positions[offset + 1]);
    minZ = Math.min(minZ, positions[offset + 2]);
    maxX = Math.max(maxX, positions[offset]);
    maxY = Math.max(maxY, positions[offset + 1]);
    maxZ = Math.max(maxZ, positions[offset + 2]);
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
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
