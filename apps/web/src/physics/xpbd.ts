import { applyBodyContactVelocities, createBodyCollisionRuntimeState, finalizeBodyContactDiagnostics, resetBodyContactStep, solveBodyCollisions, type BodyCollisionRuntimeState } from "./bodyCollision";

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
  body: BodyCollisionRuntimeState;
  /** Trust region por partícula derivado da menor aresta estrutural local. */
  correctionLimits: Float32Array;
  stablePositions: Float32Array;
  maximumCorrectionApplied: number;
  config: XpbdSolverConfig;
  accumulator: number;
  stepCount: number;
  invalid: boolean;
  profile: XpbdProfileTimings;
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
  maximumCorrectionApplied: number;
  bodyColliderCount?: number;
  bodyContactCount?: number;
  bodyContactsByRegion?: Record<string, number>;
  maximumBodyPenetrationM?: number;
  maximumBodyCorrectionM?: number;
  frictionContactCount?: number;
  sweptContactCount?: number;
  bodyCollisionEnabled?: boolean;
  invalid: boolean;
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
};

const EPSILON = 1e-9;

export function createXpbdState(
  input: Omit<XpbdState, "body" | "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid" | "profile"> & { body?: BodyCollisionRuntimeState },
): XpbdState {
  const body = input.body ?? createBodyCollisionRuntimeState({ kinds: new Uint8Array(0), data: new Float32Array(0), regions: [] }, new Float32Array(input.positions.length / 3), new Float32Array(input.positions.length / 3), false);
  validateStateShape({ ...input, body });
  return {
    ...input,
    body,
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
    profile: { integrationMs: 0, stretchMs: 0, shearMs: 0, bendMs: 0, seamMs: 0, velocityUpdateMs: 0, validationMs: 0, solverStepTotalMs: 0, bodyCollisionMs: 0 },
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
  const stepStarted = performance.now();
  const profile = state.profile;
  profile.integrationMs = 0; profile.stretchMs = 0; profile.shearMs = 0; profile.bendMs = 0; profile.seamMs = 0; profile.velocityUpdateMs = 0; profile.validationMs = 0; profile.bodyCollisionMs = 0;
  resetBodyContactStep(state.body);
  const dt = state.config.fixedTimeStep;
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError("O passo da simula\u00e7\u00e3o precisa ser positivo e finito.");

  state.previousPositions.set(state.positions);
  state.maximumCorrectionApplied = 0;
  resetLambdas(state);
  let phaseStarted = performance.now();
  integrate(state, dt);
  profile.integrationMs = performance.now() - phaseStarted;

  for (let iteration = 0; iteration < state.config.iterations; iteration += 1) {
    phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;
    phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;
    phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;
    phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;
    phaseStarted = performance.now();
    solveBodyCollisions({ predictedPositions: state.predictedPositions, previousPositions: state.previousPositions, inverseMasses: state.inverseMasses, correctionLimits: state.correctionLimits, maximumCorrectionM: state.config.maximumCorrection, fixedTimeStep: dt, body: state.body, allowSwept: iteration === 0 });
    profile.bodyCollisionMs += performance.now() - phaseStarted;
    enforcePins(state);
  }

  finalizeBodyContactDiagnostics(state.body);
  phaseStarted = performance.now();
  updateVelocitiesAndPositions(state, dt);
  applyBodyContactVelocities(state.velocities, state.body);
  profile.velocityUpdateMs = performance.now() - phaseStarted;
  state.stepCount += 1;

  phaseStarted = performance.now();
  if (!positionsAreSafe(state.positions)) {
    state.positions.set(state.stablePositions);
    state.previousPositions.set(state.stablePositions);
    state.predictedPositions.set(state.stablePositions);
    state.velocities.fill(0);
    state.invalid = true;
    profile.validationMs = performance.now() - phaseStarted;
    profile.solverStepTotalMs = performance.now() - stepStarted;
    return;
  }

  state.stablePositions.set(state.positions);
  state.invalid = false;
  profile.validationMs = performance.now() - phaseStarted;
  profile.solverStepTotalMs = performance.now() - stepStarted;
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
  resetBodyContactStep(state.body);
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
    seamErrorsByGroup,
    maximumPositionMagnitude,
    maximumVelocityMagnitude,
    maximumCorrectionApplied: state.maximumCorrectionApplied,
    bodyColliderCount: state.body.colliders.kinds.length,
    bodyContactCount: state.body.bodyContactCount,
    bodyContactsByRegion: { ...state.body.bodyContactsByRegion },
    maximumBodyPenetrationM: state.body.maximumBodyPenetrationM,
    maximumBodyCorrectionM: state.body.maximumBodyCorrectionM,
    frictionContactCount: state.body.frictionContactCount,
    sweptContactCount: state.body.sweptContactCount,
    bodyCollisionEnabled: state.body.enabled,
    invalid: state.invalid,
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
    iterations: state.config.iterations,
    maximumSubsteps: state.config.maximumSubsteps,
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

function validateStateShape(input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid" | "profile">): void {
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
