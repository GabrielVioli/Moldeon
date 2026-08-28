import type { AvatarCollisionModel, AvatarCollisionProxy } from "../avatar/AvatarCollisionModel";
import {
  closestPointOnExactBody,
  createExactBodySurfaceRuntime,
  pointInsideExactBody,
  segmentCrossingExactBody,
  triangleCrossingsExactBody,
  type ExactBodySurfaceRuntime,
  type PackedBodyMesh,
} from "./exactBodySurface";

export const BODY_COLLIDER_ELLIPSOID = 1;
export const BODY_COLLIDER_CAPSULE = 2;
export const BODY_COLLIDER_STRIDE = 10;
export const BODY_COLLIDER_AABB_STRIDE = 6;
export const DEFAULT_BODY_CONTACT_SKIN_M = 0.00005;
const EPSILON = 1e-9;
const BODY_BROADPHASE_BIN_COUNT = 32;
const MAX_EXACT_LOCAL_OVERLAP_M = 0.005;
const MAX_EXACT_CORRECTION_PER_PASS_M = 0.00215;
const EXACT_LOCAL_SIGN_BAND_M = 0.001;
const INITIAL_DEPENETRATION_MAX_PASSES = 8;
const INITIAL_DEPENETRATION_MAX_TOTAL_TRANSLATION_M = 0.12;
const INITIAL_DEPENETRATION_EPSILON_M = 1e-6;
const INITIAL_ISOMETRIC_TARGET_PENETRATION_M = 0.0045;
const INITIAL_ISOMETRIC_PENETRATION_TOLERANCE_M = 0.00005;
const INITIAL_ISOMETRIC_PROJECTION_SWEEPS = 32;
const INITIAL_ISOMETRIC_EDGE_RELATIVE_TOLERANCE = 0.005;
const INITIAL_ISOMETRIC_SEAM_DISTANCE_TOLERANCE_M = 0.0005;
const INITIAL_SEAM_MISSING_PARTICLE = 0xffffffff;

export interface SimulationBodyTransform {
  translation: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export interface PackedBodyColliders {
  kinds: Uint8Array;
  data: Float32Array;
  regions: string[];
  cache?: PackedBodyColliderCache;
}

export interface PackedBodyColliderCache {
  aabbs: Float64Array;
  capsuleAxes: Float64Array;
  capsuleFallbackNormals: Float64Array;
  ellipsoidInverseRadii: Float64Array;
  yMinimum: number;
  yMaximum: number;
  yBinInverseSize: number;
  yBinMasks: Uint32Array;
  allMask: number;
  usesBitMask: boolean;
}

interface BodyContactScratch {
  colliderIndex: number;
  surfaceX: number;
  surfaceY: number;
  surfaceZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  penetrationM: number;
  swept: boolean;
  t: number;
}

export interface BodyContactQuery {
  colliderIndex: number;
  region: string;
  point: readonly [number, number, number];
  surfacePoint: [number, number, number];
  normal: [number, number, number];
  penetrationM: number;
  swept: boolean;
}

export interface BodyInitialSeamConstraints {
  indices: Uint32Array;
  weights: Float32Array;
}

export interface BodyCollisionRuntimeState {
  enabled: boolean;
  colliders: PackedBodyColliders;
  exactSurface: ExactBodySurfaceRuntime | null;
  exactCandidateMask: Uint8Array;
  exactSignedDistances: Float32Array;
  exactQueryPositions: Float32Array;
  exactInsideMask: Uint8Array;
  exactSignKnownMask: Uint8Array;
  exactSignWitnessPositions: Float32Array;
  exactSignWitnessDistanceM: Float32Array;
  /** Historical STEP-0 diagnostic. Never used to suppress dynamic contact. */
  deepInitialOverlapMask: Uint8Array;
  /** Temporary only while synchronous STEP-0 depenetration is running. */
  initialOverlapGuardMask: Uint8Array;
  initialOverlapUnresolved: boolean;
  initialDepenetrationPasses: number;
  initialDepenetrationMaximumTranslationM: number;
  exactPassCount: number;
  particleHalfThicknessM: Float32Array;
  particleFriction: Float32Array;
  contactNormals: Float32Array;
  contactCorrections: Float32Array;
  contactMask: Uint8Array;
  contactRegionIndex: Int16Array;
  normalImpulseSpeed: Float32Array;
  pointCandidateMasks: Uint32Array;
  sweptCandidateMasks: Uint32Array;
  pointCandidateIndices: Uint16Array;
  pointCandidateCounts: Uint16Array;
  sweptCandidateIndices: Uint16Array;
  sweptCandidateCounts: Uint16Array;
  contactSurfacePoints: Float32Array;
  contactPenetrations: Float32Array;
  contactSwept: Uint8Array;
  contactSkinM: number;
  grossDepenetrationEnabled: boolean;
  dressingStepsRemaining: number;
  initialDressingSteps: number;
  bodyContactCount: number;
  frictionContactCount: number;
  sweptContactCount: number;
  maximumBodyPenetrationM: number;
  maximumBodyCorrectionM: number;
  bodyContactsByRegion: Record<string, number>;
  broadphaseMs: number;
  narrowphaseMs: number;
  projectionMs: number;
  frictionMs: number;
  contactScratch: BodyContactScratch;
  bestContactScratch: BodyContactScratch;
  bodyParticleQueries: number;
  bodyColliderTests: number;
  bodyCandidateColliderTests: number;
  bodyBroadphaseRejected: number;
  bodyCapsuleNarrowphaseTests: number;
  bodyEllipsoidNarrowphaseTests: number;
  bodyPointContactsFound: number;
  bodySweptTests: number;
  bodySweptContactsFound: number;
  bodyTriangleTests: number;
  bodyVertexContacts: number;
  bodyEdgeContacts: number;
  bodyTriangleContacts: number;
  residualBodyIntersections: number;
  residualBodyCrossings: number;
  maximumSignedPenetrationM: number;
  bvhBuildMs: number;
  ccdMs: number;
  invalidClothPrimitiveSkips: number;
  localInitialOverlapSkipCount: number;
  globalCollisionEarlyReturnCount: number;
  contactSkipReasons: Record<string, number>;
  structuralContactDeferred: boolean;
  assemblyContactBlocked: boolean;
  deepOverlapCount: number;
  initialIntersectionCount: number;
  residualBodyTriangleIntersections: number;
  signedPenetrationSumM: number;
  signedPenetrationSampleCount: number;
  clearanceErrorMaximumM: number;
  clearanceErrorSumM: number;
  clearanceErrorSampleCount: number;
  bvhQueryMs: number;
  contactSolveMs: number;
  intersectionAuditMs: number;
}

export interface BodyCollisionSolveInput {
  predictedPositions: Float32Array;
  previousPositions: Float32Array;
  inverseMasses: Float32Array;
  correctionLimits: Float32Array;
  maximumCorrectionM: number;
  fixedTimeStep: number;
  velocities?: Float32Array;
  body: BodyCollisionRuntimeState;
  allowSwept: boolean;
  clothTriangles?: Uint32Array;
  clothMaterialCoordinates?: Float32Array;
  finalReconciliation?: boolean;
}

export function packAvatarCollisionModel(
  model: AvatarCollisionModel,
  transform: SimulationBodyTransform = IDENTITY_BODY_TRANSFORM,
): PackedBodyColliders {
  const kinds = new Uint8Array(model.proxies.length);
  const data = new Float32Array(model.proxies.length * BODY_COLLIDER_STRIDE);
  const regions: string[] = [];
  for (let index = 0; index < model.proxies.length; index += 1) {
    const proxy = transformAvatarCollisionProxy(model.proxies[index], transform);
    regions.push(proxy.region);
    const offset = index * BODY_COLLIDER_STRIDE;
    if (proxy.kind === "ellipsoid") {
      validateRadii(proxy.radii);
      kinds[index] = BODY_COLLIDER_ELLIPSOID;
      data[offset] = proxy.center[0];
      data[offset + 1] = proxy.center[1];
      data[offset + 2] = proxy.center[2];
      data[offset + 3] = proxy.radii[0];
      data[offset + 4] = proxy.radii[1];
      data[offset + 5] = proxy.radii[2];
      continue;
    }
    if (!Number.isFinite(proxy.radius) || proxy.radius <= 0) throw new RangeError(`Collider ${proxy.id} possui raio inválido.`);
    kinds[index] = BODY_COLLIDER_CAPSULE;
    data[offset] = proxy.start[0];
    data[offset + 1] = proxy.start[1];
    data[offset + 2] = proxy.start[2];
    data[offset + 3] = proxy.end[0];
    data[offset + 4] = proxy.end[1];
    data[offset + 5] = proxy.end[2];
    data[offset + 6] = proxy.radius;
  }
  const packed: PackedBodyColliders = { kinds, data, regions };
  validatePackedBodyColliders(packed);
  packed.cache = buildPackedBodyColliderCache(packed);
  return packed;
}

export function validatePackedBodyColliders(colliders: PackedBodyColliders): void {
  if (colliders.data.length !== colliders.kinds.length * BODY_COLLIDER_STRIDE) {
    throw new RangeError("Body collider buffer possui stride inválido.");
  }
  if (colliders.regions.length !== colliders.kinds.length) {
    throw new RangeError("Body collider regions não correspondem aos colliders.");
  }
  for (let index = 0; index < colliders.kinds.length; index += 1) {
    const offset = index * BODY_COLLIDER_STRIDE;
    const kind = colliders.kinds[index];
    const used = kind === BODY_COLLIDER_ELLIPSOID ? 6 : kind === BODY_COLLIDER_CAPSULE ? 7 : 0;
    if (used === 0) throw new RangeError(`Body collider kind inválido em ${index}.`);
    for (let component = 0; component < used; component += 1) {
      if (!Number.isFinite(colliders.data[offset + component])) throw new RangeError(`Body collider ${index} contém valor não finito.`);
    }
    if (kind === BODY_COLLIDER_ELLIPSOID) {
      validateRadii([colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]]);
    } else if (colliders.data[offset + 6] <= 0) {
      throw new RangeError(`Body capsule ${index} possui raio inválido.`);
    }
  }
}

export function createBodyCollisionRuntimeState(
  colliders: PackedBodyColliders,
  particleHalfThicknessM: Float32Array,
  particleFriction: Float32Array,
  enabled = true,
  contactSkinM = DEFAULT_BODY_CONTACT_SKIN_M,
  exactBodyMesh?: PackedBodyMesh,
): BodyCollisionRuntimeState {
  validatePackedBodyColliders(colliders);
  colliders.cache ??= buildPackedBodyColliderCache(colliders);
  if (particleHalfThicknessM.length !== particleFriction.length) throw new RangeError("Body contact material buffers possuem tamanhos incompatíveis.");
  if (!Number.isFinite(contactSkinM) || contactSkinM < 0 || contactSkinM > 0.00015) throw new RangeError("Body contact skin precisa estar entre 0 e 0.15 mm.");
  const exactSurface = exactBodyMesh ? createExactBodySurfaceRuntime(exactBodyMesh) : null;
  for (let index = 0; index < particleHalfThicknessM.length; index += 1) {
    if (!Number.isFinite(particleHalfThicknessM[index]) || particleHalfThicknessM[index] < 0) throw new RangeError("Espessura de contato inválida.");
    if (!Number.isFinite(particleFriction[index]) || particleFriction[index] < 0) throw new RangeError("Atrito de contato inválido.");
  }
  return {
    enabled,
    colliders,
    exactSurface,
    exactCandidateMask: new Uint8Array(particleHalfThicknessM.length),
    exactSignedDistances: new Float32Array(particleHalfThicknessM.length).fill(Number.POSITIVE_INFINITY),
    exactQueryPositions: new Float32Array(particleHalfThicknessM.length * 3).fill(Number.NaN),
    exactInsideMask: new Uint8Array(particleHalfThicknessM.length),
    exactSignKnownMask: new Uint8Array(particleHalfThicknessM.length),
    exactSignWitnessPositions: new Float32Array(particleHalfThicknessM.length * 3).fill(Number.NaN),
    exactSignWitnessDistanceM: new Float32Array(particleHalfThicknessM.length).fill(0),
    deepInitialOverlapMask: new Uint8Array(particleHalfThicknessM.length),
    initialOverlapGuardMask: new Uint8Array(particleHalfThicknessM.length),
    initialOverlapUnresolved: false,
    initialDepenetrationPasses: 0,
    initialDepenetrationMaximumTranslationM: 0,
    exactPassCount: 0,
    particleHalfThicknessM,
    particleFriction,
    contactNormals: new Float32Array(particleHalfThicknessM.length * 3),
    contactCorrections: new Float32Array(particleHalfThicknessM.length * 3),
    contactMask: new Uint8Array(particleHalfThicknessM.length),
    contactRegionIndex: new Int16Array(particleHalfThicknessM.length).fill(-1),
    normalImpulseSpeed: new Float32Array(particleHalfThicknessM.length),
    pointCandidateMasks: new Uint32Array(particleHalfThicknessM.length),
    sweptCandidateMasks: new Uint32Array(particleHalfThicknessM.length),
    pointCandidateIndices: new Uint16Array(
      colliders.kinds.length > 32 ? particleHalfThicknessM.length * colliders.kinds.length : 0,
    ),
    pointCandidateCounts: new Uint16Array(particleHalfThicknessM.length),
    sweptCandidateIndices: new Uint16Array(
      colliders.kinds.length > 32 ? particleHalfThicknessM.length * colliders.kinds.length : 0,
    ),
    sweptCandidateCounts: new Uint16Array(particleHalfThicknessM.length),
    contactSurfacePoints: new Float32Array(particleHalfThicknessM.length * 3),
    contactPenetrations: new Float32Array(particleHalfThicknessM.length),
    contactSwept: new Uint8Array(particleHalfThicknessM.length),
    contactSkinM,
    grossDepenetrationEnabled: true,
    dressingStepsRemaining: 0,
    initialDressingSteps: 0,
    bodyContactCount: 0,
    frictionContactCount: 0,
    sweptContactCount: 0,
    maximumBodyPenetrationM: 0,
    maximumBodyCorrectionM: 0,
    bodyContactsByRegion: {},
    broadphaseMs: 0,
    narrowphaseMs: 0,
    projectionMs: 0,
    frictionMs: 0,
    contactScratch: createBodyContactScratch(),
    bestContactScratch: createBodyContactScratch(),
    bodyParticleQueries: 0,
    bodyColliderTests: 0,
    bodyCandidateColliderTests: 0,
    bodyBroadphaseRejected: 0,
    bodyCapsuleNarrowphaseTests: 0,
    bodyEllipsoidNarrowphaseTests: 0,
    bodyPointContactsFound: 0,
    bodySweptTests: 0,
    bodySweptContactsFound: 0,
    bodyTriangleTests: 0,
    bodyVertexContacts: 0,
    bodyEdgeContacts: 0,
    bodyTriangleContacts: 0,
    residualBodyIntersections: 0,
    residualBodyCrossings: 0,
    maximumSignedPenetrationM: 0,
    bvhBuildMs: exactSurface?.bvh.buildMs ?? 0,
    ccdMs: 0,
    invalidClothPrimitiveSkips: 0,
    localInitialOverlapSkipCount: 0,
    globalCollisionEarlyReturnCount: 0,
    contactSkipReasons: {},
    structuralContactDeferred: false,
    assemblyContactBlocked: false,
    deepOverlapCount: 0,
    initialIntersectionCount: 0,
    residualBodyTriangleIntersections: 0,
    signedPenetrationSumM: 0,
    signedPenetrationSampleCount: 0,
    clearanceErrorMaximumM: 0,
    clearanceErrorSumM: 0,
    clearanceErrorSampleCount: 0,
    bvhQueryMs: 0,
    contactSolveMs: 0,
    intersectionAuditMs: 0,
  };
}

export function initializeBodyDressing(
  body: BodyCollisionRuntimeState,
  positions: Float32Array,
  maximumCorrectionM: number,
  clothTriangles?: Uint32Array,
  inverseMasses?: Float32Array,
  clothSeams?: BodyInitialSeamConstraints,
): void {
  body.dressingStepsRemaining = 0;
  body.initialDressingSteps = 0;
  body.grossDepenetrationEnabled = false;
  body.assemblyContactBlocked = false;
  body.structuralContactDeferred = false;
  body.exactPassCount = 0;
  body.deepOverlapCount = 0;
  body.initialIntersectionCount = 0;
  body.deepInitialOverlapMask.fill(0);
  body.initialOverlapGuardMask.fill(0);
  body.initialOverlapUnresolved = false;
  body.initialDepenetrationPasses = 0;
  body.initialDepenetrationMaximumTranslationM = 0;
  resetExactContactCache(body);
  if (!body.enabled || (!body.exactSurface && body.colliders.kinds.length === 0) || !Number.isFinite(maximumCorrectionM) || maximumCorrectionM <= 0) return;

  let maximumPenetrationM = 0;
  const particleCount = positions.length / 3;
  if (body.exactSurface) {
    const initial = primeExactInitialContacts(body, positions, true);
    body.deepOverlapCount = initial.deepOverlapCount;
    body.initialIntersectionCount = initial.intersectionCount;
    if (initial.deepOverlapCount > 0) {
      const recovered = clothTriangles && clothSeams && clothSeams.indices.length >= 4 && clothSeams.weights.length >= 4
        ? recoverSewnInitialExactOverlap(body, positions, maximumCorrectionM, clothTriangles, inverseMasses, clothSeams)
        : recoverDeepInitialExactOverlap(body, positions, maximumCorrectionM, clothTriangles, inverseMasses);
      resetExactContactCache(body);
      primeExactInitialContacts(body, positions, false);
      if (!recovered) {
        body.structuralContactDeferred = true;
        return;
      }
    }
    return;
  }

  for (let particle = 0; particle < particleCount; particle += 1) {
    const offset = particle * 3;
    const point: [number, number, number] = [positions[offset], positions[offset + 1], positions[offset + 2]];
    const clearance = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const contact = deepestBodyContact(point, body.colliders, clearance);
    if (contact) maximumPenetrationM = Math.max(maximumPenetrationM, contact.penetrationM);
  }
  if (maximumPenetrationM <= EPSILON) return;
  const minimumGrossPasses = Math.ceil(maximumPenetrationM / maximumCorrectionM);
  body.initialDressingSteps = Math.max(1, minimumGrossPasses * 2);
  body.dressingStepsRemaining = body.initialDressingSteps;
  body.grossDepenetrationEnabled = true;
}

export function resetBodyContactStep(body: BodyCollisionRuntimeState): void {
  body.contactNormals.fill(0);
  body.contactCorrections.fill(0);
  body.contactMask.fill(0);
  body.contactRegionIndex.fill(-1);
  body.normalImpulseSpeed.fill(0);
  body.pointCandidateMasks.fill(0);
  body.sweptCandidateMasks.fill(0);
  body.pointCandidateCounts.fill(0);
  body.sweptCandidateCounts.fill(0);
  body.contactPenetrations.fill(0);
  body.contactSwept.fill(0);
  body.bodyContactCount = 0;
  body.frictionContactCount = 0;
  body.sweptContactCount = 0;
  body.maximumBodyPenetrationM = 0;
  body.maximumBodyCorrectionM = 0;
  body.bodyContactsByRegion = {};
  body.broadphaseMs = 0;
  body.narrowphaseMs = 0;
  body.projectionMs = 0;
  body.frictionMs = 0;
  body.bodyParticleQueries = 0;
  body.bodyColliderTests = 0;
  body.bodyCandidateColliderTests = 0;
  body.bodyBroadphaseRejected = 0;
  body.bodyCapsuleNarrowphaseTests = 0;
  body.bodyEllipsoidNarrowphaseTests = 0;
  body.bodyPointContactsFound = 0;
  body.bodySweptTests = 0;
  body.bodySweptContactsFound = 0;
  body.bodyTriangleTests = 0;
  body.bodyVertexContacts = 0;
  body.bodyEdgeContacts = 0;
  body.bodyTriangleContacts = 0;
  body.residualBodyIntersections = 0;
  body.residualBodyCrossings = 0;
  body.residualBodyTriangleIntersections = 0;
  body.exactPassCount = 0;
  body.maximumSignedPenetrationM = 0;
  body.ccdMs = 0;
  body.invalidClothPrimitiveSkips = 0;
  body.localInitialOverlapSkipCount = 0;
  body.globalCollisionEarlyReturnCount = 0;
  body.contactSkipReasons = {};
  body.structuralContactDeferred = false;
  body.signedPenetrationSumM = 0;
  body.signedPenetrationSampleCount = 0;
  body.clearanceErrorMaximumM = 0;
  body.clearanceErrorSumM = 0;
  body.clearanceErrorSampleCount = 0;
  body.bvhQueryMs = 0;
  body.contactSolveMs = 0;
  body.intersectionAuditMs = 0;
  if (body.exactSurface) {
    body.exactSurface.queries = 0;
    body.exactSurface.bvhNodeVisits = 0;
    body.exactSurface.triangleTests = 0;
    body.exactSurface.insideTests = 0;
    body.exactSurface.ccdTests = 0;
  }
}

export function solveBodyCollisions(input: BodyCollisionSolveInput): void {
  const { body } = input;
  if (!body.enabled) return;
  if (body.exactSurface) {
    solveExactBodySurfaceCollisions(input);
    return;
  }
  if (body.colliders.kinds.length === 0) return;
  const particleCount = input.predictedPositions.length / 3;
  const colliderCount = body.colliders.kinds.length;
  if (body.particleHalfThicknessM.length !== particleCount || body.particleFriction.length !== particleCount) {
    throw new RangeError("Body collision particle buffers não correspondem ao garment state.");
  }
  if (input.velocities && input.velocities.length !== input.predictedPositions.length) {
    throw new RangeError("Body collision velocity buffer não corresponde ao garment state.");
  }
  if (body.colliders.cache?.usesBitMask) {
    solveBodyCollisionsBitmask(input, particleCount, colliderCount);
    return;
  }
  if (body.pointCandidateIndices.length < particleCount * colliderCount || body.sweptCandidateIndices.length < particleCount * colliderCount) {
    throw new RangeError("Body collision broadphase buffers não correspondem ao collider set.");
  }

  let phaseStarted = performance.now();
  for (let particle = 0; particle < particleCount; particle += 1) {
    body.pointCandidateCounts[particle] = 0;
    body.sweptCandidateCounts[particle] = 0;
    if (input.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const point: [number, number, number] = [
      input.predictedPositions[offset],
      input.predictedPositions[offset + 1],
      input.predictedPositions[offset + 2],
    ];
    const previous: [number, number, number] = [
      input.previousPositions[offset],
      input.previousPositions[offset + 1],
      input.previousPositions[offset + 2],
    ];
    const radius = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const base = particle * colliderCount;
    let pointCount = 0;
    let sweptCount = 0;
    body.bodyParticleQueries += 1;
    body.bodyColliderTests += colliderCount;
    if (input.allowSwept) {
      body.bodyParticleQueries += 1;
      body.bodyColliderTests += colliderCount;
    }
    for (let collider = 0; collider < colliderCount; collider += 1) {
      if (pointOverlapsPackedColliderAabb(point, body.colliders, collider, radius)) {
        body.pointCandidateIndices[base + pointCount] = collider;
        pointCount += 1;
      }
      if (input.allowSwept && segmentOverlapsPackedColliderAabb(previous, point, body.colliders, collider, radius)) {
        body.sweptCandidateIndices[base + sweptCount] = collider;
        sweptCount += 1;
      }
    }
    body.pointCandidateCounts[particle] = pointCount;
    body.sweptCandidateCounts[particle] = sweptCount;
    body.bodyCandidateColliderTests += pointCount + sweptCount;
    body.bodyBroadphaseRejected += colliderCount - pointCount;
    if (input.allowSwept) body.bodyBroadphaseRejected += colliderCount - sweptCount;
  }
  body.broadphaseMs = performance.now() - phaseStarted;

  phaseStarted = performance.now();
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (input.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const point: [number, number, number] = [
      input.predictedPositions[offset],
      input.predictedPositions[offset + 1],
      input.predictedPositions[offset + 2],
    ];
    const previous: [number, number, number] = [
      input.previousPositions[offset],
      input.previousPositions[offset + 1],
      input.previousPositions[offset + 2],
    ];
    const radius = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const base = particle * colliderCount;
    let contact: BodyContactQuery | null = null;
    for (let candidate = 0; candidate < body.pointCandidateCounts[particle]; candidate += 1) {
      const colliderIndex = body.pointCandidateIndices[base + candidate];
      if (body.colliders.kinds[colliderIndex] === BODY_COLLIDER_CAPSULE) body.bodyCapsuleNarrowphaseTests += 1;
      else body.bodyEllipsoidNarrowphaseTests += 1;
      const queried = queryPackedColliderNarrowphase(point, body.colliders, colliderIndex, radius);
      if (queried) {
        body.bodyPointContactsFound += 1;
        if (!contact || queried.penetrationM > contact.penetrationM) contact = queried;
      }
    }
    if (!contact && input.allowSwept) {
      let earliest: (BodyContactQuery & { t: number }) | null = null;
      for (let candidate = 0; candidate < body.sweptCandidateCounts[particle]; candidate += 1) {
        const colliderIndex = body.sweptCandidateIndices[base + candidate];
        body.bodySweptTests += 1;
        if (body.colliders.kinds[colliderIndex] === BODY_COLLIDER_CAPSULE) body.bodyCapsuleNarrowphaseTests += 1;
        else body.bodyEllipsoidNarrowphaseTests += 1;
        const queried = sweptPackedCollider(previous, point, body.colliders, colliderIndex, radius);
        if (queried) {
          body.bodySweptContactsFound += 1;
          if (!earliest || queried.t < earliest.t) earliest = queried;
        }
      }
      if (earliest) {
        const { t: _t, ...sweptContact } = earliest;
        contact = sweptContact;
      }
    }
    if (!contact) continue;
    body.contactMask[particle] = 1;
    body.contactRegionIndex[particle] = contact.colliderIndex;
    body.contactNormals[offset] = contact.normal[0];
    body.contactNormals[offset + 1] = contact.normal[1];
    body.contactNormals[offset + 2] = contact.normal[2];
    body.contactSurfacePoints[offset] = contact.surfacePoint[0];
    body.contactSurfacePoints[offset + 1] = contact.surfacePoint[1];
    body.contactSurfacePoints[offset + 2] = contact.surfacePoint[2];
    body.contactPenetrations[particle] = contact.penetrationM;
    body.contactSwept[particle] = contact.swept ? 1 : 0;
  }
  body.narrowphaseMs = performance.now() - phaseStarted;

  phaseStarted = performance.now();
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (!body.contactMask[particle]) continue;
    const offset = particle * 3;
    const pointX = input.predictedPositions[offset];
    const pointY = input.predictedPositions[offset + 1];
    const pointZ = input.predictedPositions[offset + 2];
    const previousX = input.previousPositions[offset];
    const previousY = input.previousPositions[offset + 1];
    const previousZ = input.previousPositions[offset + 2];
    const penetrationM = body.contactPenetrations[particle];
    const swept = body.contactSwept[particle] === 1;
    body.maximumBodyPenetrationM = Math.max(body.maximumBodyPenetrationM, penetrationM);

    let correctionX = body.contactSurfacePoints[offset] - pointX;
    let correctionY = body.contactSurfacePoints[offset + 1] - pointY;
    let correctionZ = body.contactSurfacePoints[offset + 2] - pointZ;
    let correction = Math.hypot(correctionX, correctionY, correctionZ);
    const localLimit = Math.max(
      1e-6,
      Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM),
    );
    const grossPenetration = body.grossDepenetrationEnabled && !swept && penetrationM > localLimit;
    const limit = swept
      ? body.grossDepenetrationEnabled ? input.maximumCorrectionM : localLimit
      : grossPenetration ? input.maximumCorrectionM : localLimit;
    if (correction > limit) {
      const scale = limit / correction;
      correctionX *= scale;
      correctionY *= scale;
      correctionZ *= scale;
      correction = limit;
    }
    if (swept) body.sweptContactCount += 1;

    const vx = input.velocities
      ? input.velocities[offset]
      : (pointX - previousX) / Math.max(input.fixedTimeStep, EPSILON);
    const vy = input.velocities
      ? input.velocities[offset + 1]
      : (pointY - previousY) / Math.max(input.fixedTimeStep, EPSILON);
    const vz = input.velocities
      ? input.velocities[offset + 2]
      : (pointZ - previousZ) / Math.max(input.fixedTimeStep, EPSILON);
    const nx = body.contactNormals[offset];
    const ny = body.contactNormals[offset + 1];
    const nz = body.contactNormals[offset + 2];
    const inwardSpeed = Math.max(0, -(vx * nx + vy * ny + vz * nz));

    input.predictedPositions[offset] += correctionX;
    input.predictedPositions[offset + 1] += correctionY;
    input.predictedPositions[offset + 2] += correctionZ;
    body.contactCorrections[offset] += correctionX;
    body.contactCorrections[offset + 1] += correctionY;
    body.contactCorrections[offset + 2] += correctionZ;
    body.maximumBodyCorrectionM = Math.max(body.maximumBodyCorrectionM, correction);
    const settledContactImpulseSpeed = !swept && !grossPenetration
      ? correction / Math.max(input.fixedTimeStep, EPSILON)
      : 0;
    body.normalImpulseSpeed[particle] = Math.max(
      body.normalImpulseSpeed[particle],
      inwardSpeed,
      settledContactImpulseSpeed,
    );
  }
  body.projectionMs = performance.now() - phaseStarted;
}

function solveExactBodySurfaceCollisions(input: BodyCollisionSolveInput): void {
  const { body } = input;
  const runtime = body.exactSurface!;
  const particleCount = input.predictedPositions.length / 3;
  const firstPass = body.exactPassCount === 0;
  body.exactPassCount += 1;
  if (body.particleHalfThicknessM.length !== particleCount || body.particleFriction.length !== particleCount) {
    throw new RangeError("Body contact material buffers não correspondem ao garment state.");
  }
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (input.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const point: [number, number, number] = [
      input.predictedPositions[offset],
      input.predictedPositions[offset + 1],
      input.predictedPositions[offset + 2],
    ];
    const previous: [number, number, number] = [
      input.previousPositions[offset],
      input.previousPositions[offset + 1],
      input.previousPositions[offset + 2],
    ];
    const clearance = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const travelledSinceQuery = Math.hypot(
      point[0] - body.exactQueryPositions[offset],
      point[1] - body.exactQueryPositions[offset + 1],
      point[2] - body.exactQueryPositions[offset + 2],
    );
    if (!firstPass && body.exactCandidateMask[particle] === 0) continue;
    if (firstPass && body.exactCandidateMask[particle] === 0) {
      const cachedDistance = body.exactSignedDistances[particle];
      if (Number.isFinite(cachedDistance) && Number.isFinite(travelledSinceQuery)
        && cachedDistance - clearance > travelledSinceQuery + 0.01) continue;
    }
    let phaseStarted = performance.now();
    const query = closestPointOnExactBody(runtime, point, false);
    // In the immediate contact band the oriented pseudo-normal is the correct
    // local side test, including thin/self-near anatomical joints. Once a
    // particle is farther from the surface, parity is required to distinguish
    // a genuine deep interior point from the exterior of a concavity.
    const inside = query.distanceM <= EXACT_LOCAL_SIGN_BAND_M
      ? query.inside
      : exactInsideFromWitness(body, runtime, particle, point, query.distanceM);
    query.inside = inside;
    query.signedDistanceM = inside ? -query.distanceM : query.distanceM;
    body.bvhQueryMs += performance.now() - phaseStarted;
    body.exactSignedDistances[particle] = query.signedDistanceM;
    body.exactQueryPositions[offset] = point[0];
    body.exactQueryPositions[offset + 1] = point[1];
    body.exactQueryPositions[offset + 2] = point[2];
    body.narrowphaseMs += performance.now() - phaseStarted;
    body.bodyParticleQueries += 1;
    body.bodyCandidateColliderTests += 1;
    body.bodyTriangleTests = runtime.triangleTests;
    let target: [number, number, number] | null = null;
    let normal = query.normal;
    let swept = false;
    let penetrationM = clearance - query.signedDistanceM;
    const movementSquared = (point[0] - previous[0]) ** 2 + (point[1] - previous[1]) ** 2 + (point[2] - previous[2]) ** 2;
    const movementLength = Math.sqrt(movementSquared);
    const sweptCanReachSurface = movementLength + clearance >= query.distanceM;
    phaseStarted = performance.now();
    const hit = input.allowSwept && movementSquared > 1e-10 && sweptCanReachSurface
      ? segmentCrossingExactBody(runtime, previous, point)
      : null;
    body.bvhQueryMs += performance.now() - phaseStarted;
    body.ccdMs += performance.now() - phaseStarted;
    if (input.allowSwept && movementSquared > 1e-10 && sweptCanReachSurface) {
      body.bodySweptTests += 1;
      runtime.ccdTests += 1;
    }
    body.exactCandidateMask[particle] = query.signedDistanceM <= clearance + 0.01 || hit ? 1 : 0;
    if (hit && hit.t < 1) {
      target = [
        hit.point[0] + hit.normal[0] * clearance,
        hit.point[1] + hit.normal[1] * clearance,
        hit.point[2] + hit.normal[2] * clearance,
      ];
      normal = hit.normal;
      penetrationM = Math.max(clearance, -query.signedDistanceM);
      swept = true;
      body.bodySweptContactsFound += 1;
    } else if (penetrationM > 0) {
      target = [
        query.point[0] + normal[0] * clearance,
        query.point[1] + normal[1] * clearance,
        query.point[2] + normal[2] * clearance,
      ];
      body.bodyPointContactsFound += 1;
    }
    if (!target) continue;
    phaseStarted = performance.now();
    registerExactParticleContact(input, particle, target, normal, penetrationM, swept);
    const solveElapsed = performance.now() - phaseStarted;
    body.projectionMs += solveElapsed;
    body.contactSolveMs += solveElapsed;
    body.bodyVertexContacts += 1;
  }

  if (input.finalReconciliation && input.clothTriangles && input.clothTriangles.length > 0) {
    const reconciliationStarted = performance.now();
    const integrity = inspectClothContactMetric(input, input.clothTriangles);
    body.structuralContactDeferred ||= !integrity.valid;
    const maximumReconciliations = body.assemblyContactBlocked ? 1 : 4;
    for (let reconciliation = 0; reconciliation < maximumReconciliations; reconciliation += 1) {
      const contactsBefore = body.bodyEdgeContacts + body.bodyTriangleContacts;
      solveExactClothEdgeAndTriangleContacts(input, input.clothTriangles);
      if (body.bodyEdgeContacts + body.bodyTriangleContacts === contactsBefore) break;
    }
    auditExactBodyResiduals(input, input.clothTriangles);
    body.narrowphaseMs += performance.now() - reconciliationStarted;
  }
  body.bodyTriangleTests = runtime.triangleTests;
}

function registerExactParticleContact(
  input: BodyCollisionSolveInput,
  particle: number,
  target: readonly [number, number, number],
  normal: readonly [number, number, number],
  penetrationM: number,
  swept: boolean,
): void {
  const { body } = input;
  const offset = particle * 3;
  const pointX = input.predictedPositions[offset];
  const pointY = input.predictedPositions[offset + 1];
  const pointZ = input.predictedPositions[offset + 2];
  let correctionX = target[0] - pointX;
  let correctionY = target[1] - pointY;
  let correctionZ = target[2] - pointZ;
  let correction = Math.hypot(correctionX, correctionY, correctionZ);
  const localLimit = Math.max(1e-6, Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM));
  const localExactLimit = Math.min(localLimit, MAX_EXACT_CORRECTION_PER_PASS_M);
  const limit = swept
    ? Math.min(input.maximumCorrectionM, localLimit)
    : input.finalReconciliation
      ? Math.min(input.maximumCorrectionM, localExactLimit * 2)
      : localExactLimit;
  if (correction > limit) {
    const factor = limit / correction;
    correctionX *= factor;
    correctionY *= factor;
    correctionZ *= factor;
    correction = limit;
  }
  const velocityX = input.velocities ? input.velocities[offset] : (pointX - input.previousPositions[offset]) / Math.max(input.fixedTimeStep, EPSILON);
  const velocityY = input.velocities ? input.velocities[offset + 1] : (pointY - input.previousPositions[offset + 1]) / Math.max(input.fixedTimeStep, EPSILON);
  const velocityZ = input.velocities ? input.velocities[offset + 2] : (pointZ - input.previousPositions[offset + 2]) / Math.max(input.fixedTimeStep, EPSILON);
  const inwardSpeed = Math.max(0, -(velocityX * normal[0] + velocityY * normal[1] + velocityZ * normal[2]));
  input.predictedPositions[offset] += correctionX;
  input.predictedPositions[offset + 1] += correctionY;
  input.predictedPositions[offset + 2] += correctionZ;
  body.contactMask[particle] = 1;
  body.contactRegionIndex[particle] = -1;
  body.contactNormals[offset] = normal[0];
  body.contactNormals[offset + 1] = normal[1];
  body.contactNormals[offset + 2] = normal[2];
  body.contactSurfacePoints[offset] = target[0];
  body.contactSurfacePoints[offset + 1] = target[1];
  body.contactSurfacePoints[offset + 2] = target[2];
  body.contactPenetrations[particle] = Math.max(body.contactPenetrations[particle], penetrationM);
  body.contactSwept[particle] = swept ? 1 : body.contactSwept[particle];
  body.contactCorrections[offset] += correctionX;
  body.contactCorrections[offset + 1] += correctionY;
  body.contactCorrections[offset + 2] += correctionZ;
  body.normalImpulseSpeed[particle] = Math.max(body.normalImpulseSpeed[particle], inwardSpeed, correction / Math.max(input.fixedTimeStep, EPSILON));
  body.maximumBodyPenetrationM = Math.max(body.maximumBodyPenetrationM, penetrationM);
  body.maximumSignedPenetrationM = Math.max(body.maximumSignedPenetrationM, penetrationM);
  body.maximumBodyCorrectionM = Math.max(body.maximumBodyCorrectionM, correction);
  if (swept) body.sweptContactCount += 1;
}

function solveExactClothEdgeAndTriangleContacts(input: BodyCollisionSolveInput, triangles: Uint32Array): void {
  const runtime = input.body.exactSurface!;
  const uniqueEdges = new Set<string>();
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const indices = [triangles[offset], triangles[offset + 1], triangles[offset + 2]] as const;
    for (let edge = 0; edge < 3; edge += 1) {
      const a = indices[edge]; const b = indices[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (uniqueEdges.has(key)) continue;
      uniqueEdges.add(key);
      if (!clothEdgeMetricIsUsable(input, a, b)) {
        recordLocalContactSkip(input.body, "material-metric-invalid");
        continue;
      }
      const start = particlePoint(input.predictedPositions, a);
      const end = particlePoint(input.predictedPositions, b);
      const edgeLength = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
      const clearance = Math.max(input.body.particleHalfThicknessM[a], input.body.particleHalfThicknessM[b]) + input.body.contactSkinM;
      if (edgeIsProvablyOutside(input.body, a, b, edgeLength, clearance)) continue;
      const queryStarted = performance.now();
      const hit = segmentCrossingExactBody(runtime, start, end);
      input.body.bvhQueryMs += performance.now() - queryStarted;
      if (!hit || hit.t <= 1e-4 || hit.t >= 1 - 1e-4) continue;
      const midpoint: [number, number, number] = [
        (start[0] + end[0]) * 0.5,
        (start[1] + end[1]) * 0.5,
        (start[2] + end[2]) * 0.5,
      ];
      const midpointQueryStarted = performance.now();
      const midpointQuery = closestPointOnExactBody(runtime, midpoint, false);
      input.body.bvhQueryMs += performance.now() - midpointQueryStarted;
      const requiredCorrection = Math.max(clearance, clearance - midpointQuery.signedDistanceM, 1e-5);
      const correctionMagnitude = Math.min(input.maximumCorrectionM, MAX_EXACT_CORRECTION_PER_PASS_M, requiredCorrection);
      applyWeightedExactCorrection(input, [a, b], [1 - hit.t, hit.t], hit.normal, correctionMagnitude);
      input.body.bodyEdgeContacts += 1;
    }

    const a = particlePoint(input.predictedPositions, indices[0]);
    const b = particlePoint(input.predictedPositions, indices[1]);
    const c = particlePoint(input.predictedPositions, indices[2]);
    if (!clothEdgeMetricIsUsable(input, indices[0], indices[1])
      || !clothEdgeMetricIsUsable(input, indices[1], indices[2])
      || !clothEdgeMetricIsUsable(input, indices[2], indices[0])) {
      recordLocalContactSkip(input.body, "material-metric-invalid");
      continue;
    }
    const centroid: [number, number, number] = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ];
    const clearance = Math.max(
      input.body.particleHalfThicknessM[indices[0]],
      input.body.particleHalfThicknessM[indices[1]],
      input.body.particleHalfThicknessM[indices[2]],
    ) + input.body.contactSkinM;
    if (triangleIsProvablyOutside(input.body, indices, a, b, c, clearance)) continue;
    let queryStarted = performance.now();
    const query = closestPointOnExactBody(runtime, centroid, false);
    input.body.bvhQueryMs += performance.now() - queryStarted;
    const penetration = clearance - query.signedDistanceM;
    queryStarted = performance.now();
    const triangleCrossings = triangleCrossingsExactBody(runtime, a, b, c, 1);
    input.body.bvhQueryMs += performance.now() - queryStarted;
    const requiredCorrection = Math.max(clearance, penetration, 1e-5);
    for (const crossing of triangleCrossings) {
      applyWeightedExactCorrection(
        input,
        [...indices],
        crossing.clothBarycentric,
        crossing.normal,
        Math.min(input.maximumCorrectionM, MAX_EXACT_CORRECTION_PER_PASS_M, requiredCorrection),
      );
      input.body.bodyTriangleContacts += 1;
    }
    if (penetration > 0) {
      applyWeightedExactCorrection(input, [...indices], [1 / 3, 1 / 3, 1 / 3], query.normal, Math.min(input.maximumCorrectionM, MAX_EXACT_CORRECTION_PER_PASS_M, penetration));
      input.body.bodyTriangleContacts += 1;
    }
  }
}

function applyWeightedExactCorrection(
  input: BodyCollisionSolveInput,
  particles: readonly number[],
  weights: readonly number[],
  normal: readonly [number, number, number],
  magnitude: number,
): void {
  const solveStarted = performance.now();
  let denominator = 0;
  for (let index = 0; index < particles.length; index += 1) denominator += input.inverseMasses[particles[index]] * weights[index] * weights[index];
  if (denominator <= EPSILON) return;
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    if (input.inverseMasses[particle] <= 0) continue;
    const factor = magnitude * input.inverseMasses[particle] * weights[index] / denominator;
    const offset = particle * 3;
    input.predictedPositions[offset] += normal[0] * factor;
    input.predictedPositions[offset + 1] += normal[1] * factor;
    input.predictedPositions[offset + 2] += normal[2] * factor;
    input.body.contactMask[particle] = 1;
    input.body.exactCandidateMask[particle] = 1;
    input.body.contactNormals[offset] = normal[0];
    input.body.contactNormals[offset + 1] = normal[1];
    input.body.contactNormals[offset + 2] = normal[2];
    input.body.contactCorrections[offset] += normal[0] * factor;
    input.body.contactCorrections[offset + 1] += normal[1] * factor;
    input.body.contactCorrections[offset + 2] += normal[2] * factor;
    input.body.maximumBodyCorrectionM = Math.max(input.body.maximumBodyCorrectionM, Math.abs(factor));
  }
  input.body.contactSolveMs += performance.now() - solveStarted;
}

function recordLocalContactSkip(body: BodyCollisionRuntimeState, reason: "material-metric-invalid"): void {
  body.invalidClothPrimitiveSkips += 1;
  body.contactSkipReasons[reason] = (body.contactSkipReasons[reason] ?? 0) + 1;
  body.structuralContactDeferred = true;
}

function auditExactBodyResiduals(input: BodyCollisionSolveInput, triangles: Uint32Array): void {
  const auditStarted = performance.now();
  const runtime = input.body.exactSurface!;
  let intersections = 0;
  for (let particle = 0; particle < input.predictedPositions.length / 3; particle += 1) {
    if (input.body.exactCandidateMask[particle] === 0) continue;
    const point = particlePoint(input.predictedPositions, particle);
    const queryStarted = performance.now();
    const query = closestPointOnExactBody(runtime, point, false);
    const inside = exactInsideFromWitness(input.body, runtime, particle, point, query.distanceM);
    query.signedDistanceM = inside ? -query.distanceM : query.distanceM;
    input.body.bvhQueryMs += performance.now() - queryStarted;
    const clearance = input.body.particleHalfThicknessM[particle] + input.body.contactSkinM;
    const clearanceError = Math.max(0, clearance - query.signedDistanceM);
    input.body.clearanceErrorMaximumM = Math.max(input.body.clearanceErrorMaximumM, clearanceError);
    input.body.clearanceErrorSumM += clearanceError;
    input.body.clearanceErrorSampleCount += 1;
    if (query.signedDistanceM < -1e-7) {
      const penetration = -query.signedDistanceM;
      intersections += 1;
      input.body.maximumSignedPenetrationM = Math.max(input.body.maximumSignedPenetrationM, penetration);
      input.body.signedPenetrationSumM += penetration;
      input.body.signedPenetrationSampleCount += 1;
    }
  }
  let crossings = 0;
  const edges = new Set<string>();
  for (let offset = 0; offset < triangles.length; offset += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangles[offset + edge]; const b = triangles[offset + ((edge + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) continue;
      edges.add(key);
      if (!clothEdgeMetricIsUsable(input, a, b)) continue;
      const start = particlePoint(input.predictedPositions, a);
      const end = particlePoint(input.predictedPositions, b);
      const edgeLength = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
      const clearance = Math.max(input.body.particleHalfThicknessM[a], input.body.particleHalfThicknessM[b]) + input.body.contactSkinM;
      if (edgeIsProvablyOutside(input.body, a, b, edgeLength, clearance)) continue;
      const queryStarted = performance.now();
      const hit = segmentCrossingExactBody(runtime, start, end);
      input.body.bvhQueryMs += performance.now() - queryStarted;
      if (hit && hit.t > 1e-4 && hit.t < 1 - 1e-4) crossings += 1;
    }
  }
  let triangleIntersections = 0;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const indices = [triangles[offset], triangles[offset + 1], triangles[offset + 2]] as const;
    const a = particlePoint(input.predictedPositions, indices[0]);
    const b = particlePoint(input.predictedPositions, indices[1]);
    const c = particlePoint(input.predictedPositions, indices[2]);
    const clearance = Math.max(
      input.body.particleHalfThicknessM[indices[0]],
      input.body.particleHalfThicknessM[indices[1]],
      input.body.particleHalfThicknessM[indices[2]],
    ) + input.body.contactSkinM;
    if (triangleIsProvablyOutside(input.body, indices, a, b, c, clearance)) continue;
    const queryStarted = performance.now();
    const contacts = triangleCrossingsExactBody(runtime, a, b, c, 1);
    input.body.bvhQueryMs += performance.now() - queryStarted;
    if (contacts.length > 0) triangleIntersections += 1;
  }
  input.body.residualBodyIntersections = intersections;
  input.body.residualBodyCrossings = crossings;
  input.body.residualBodyTriangleIntersections = triangleIntersections;
  input.body.intersectionAuditMs += performance.now() - auditStarted;
}

function exactInsideFromWitness(
  body: BodyCollisionRuntimeState,
  runtime: ExactBodySurfaceRuntime,
  particle: number,
  point: readonly [number, number, number],
  distanceM: number,
): boolean {
  const offset = particle * 3;
  const travelled = Math.hypot(
    point[0] - body.exactSignWitnessPositions[offset],
    point[1] - body.exactSignWitnessPositions[offset + 1],
    point[2] - body.exactSignWitnessPositions[offset + 2],
  );
  if (body.exactSignKnownMask[particle] !== 0
    && body.exactSignWitnessDistanceM[particle] > travelled + 1e-7) {
    return body.exactInsideMask[particle] !== 0;
  }
  const inside = pointInsideExactBody(runtime, point);
  body.exactInsideMask[particle] = inside ? 1 : 0;
  body.exactSignKnownMask[particle] = 1;
  body.exactSignWitnessPositions[offset] = point[0];
  body.exactSignWitnessPositions[offset + 1] = point[1];
  body.exactSignWitnessPositions[offset + 2] = point[2];
  body.exactSignWitnessDistanceM[particle] = distanceM;
  return inside;
}

function particlePoint(positions: Float32Array, particle: number): [number, number, number] {
  const offset = particle * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function edgeIsProvablyOutside(
  body: BodyCollisionRuntimeState,
  a: number,
  b: number,
  edgeLength: number,
  clearance: number,
): boolean {
  if (body.exactCandidateMask[a] !== 0 || body.exactCandidateMask[b] !== 0) return false;
  return body.exactSignedDistances[a] - clearance > edgeLength
    || body.exactSignedDistances[b] - clearance > edgeLength;
}

function triangleIsProvablyOutside(
  body: BodyCollisionRuntimeState,
  indices: readonly [number, number, number],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  clearance: number,
): boolean {
  if (indices.some((particle) => body.exactCandidateMask[particle] !== 0)) return false;
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  return body.exactSignedDistances[indices[0]] - clearance > Math.max(ab, ca)
    || body.exactSignedDistances[indices[1]] - clearance > Math.max(ab, bc)
    || body.exactSignedDistances[indices[2]] - clearance > Math.max(bc, ca);
}

function clothEdgeMetricIsUsable(input: BodyCollisionSolveInput, a: number, b: number): boolean {
  const material = input.clothMaterialCoordinates;
  if (!material) return true;
  const materialOffsetA = a * 2;
  const materialOffsetB = b * 2;
  const rest = Math.hypot(
    material[materialOffsetB] - material[materialOffsetA],
    material[materialOffsetB + 1] - material[materialOffsetA + 1],
  );
  if (!Number.isFinite(rest) || rest <= EPSILON) return false;
  const spatialA = particlePoint(input.predictedPositions, a);
  const spatialB = particlePoint(input.predictedPositions, b);
  const current = Math.hypot(
    spatialB[0] - spatialA[0],
    spatialB[1] - spatialA[1],
    spatialB[2] - spatialA[2],
  );
  const ratio = current / rest;
  return Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 2;
}

function inspectClothContactMetric(input: BodyCollisionSolveInput, triangles: Uint32Array): { valid: boolean; invalidEdgeCount: number } {
  if (!input.clothMaterialCoordinates) return { valid: true, invalidEdgeCount: 0 };
  const edges = new Set<string>();
  let invalidEdgeCount = 0;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangles[offset + edge];
      const b = triangles[offset + ((edge + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) continue;
      edges.add(key);
      if (!clothEdgeMetricIsUsable(input, a, b)) invalidEdgeCount += 1;
    }
  }
  return {
    valid: invalidEdgeCount === 0,
    invalidEdgeCount,
  };
}

function resetExactContactCache(body: BodyCollisionRuntimeState): void {
  body.exactCandidateMask.fill(0);
  body.exactSignedDistances.fill(Number.POSITIVE_INFINITY);
  body.exactQueryPositions.fill(Number.NaN);
  body.exactInsideMask.fill(0);
  body.exactSignKnownMask.fill(0);
  body.exactSignWitnessPositions.fill(Number.NaN);
  body.exactSignWitnessDistanceM.fill(0);
}

function primeExactInitialContacts(
  body: BodyCollisionRuntimeState,
  positions: Float32Array,
  markInitialDeepOverlap: boolean,
): { maximumPenetrationM: number; deepOverlapCount: number; intersectionCount: number } {
  const runtime = body.exactSurface!;
  let maximumPenetrationM = 0;
  let deepOverlapCount = 0;
  let intersectionCount = 0;
  for (let particle = 0; particle < positions.length / 3; particle += 1) {
    const offset = particle * 3;
    const point = particlePoint(positions, particle);
    const query = closestPointOnExactBody(runtime, point, false);
    const inside = pointInsideExactBody(runtime, point);
    const signedDistanceM = inside ? -query.distanceM : query.distanceM;
    const clearance = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const penetrationM = clearance - signedDistanceM;
    body.exactSignedDistances[particle] = signedDistanceM;
    body.exactQueryPositions[offset] = point[0];
    body.exactQueryPositions[offset + 1] = point[1];
    body.exactQueryPositions[offset + 2] = point[2];
    body.exactInsideMask[particle] = inside ? 1 : 0;
    body.exactSignKnownMask[particle] = 1;
    body.exactSignWitnessPositions[offset] = point[0];
    body.exactSignWitnessPositions[offset + 1] = point[1];
    body.exactSignWitnessPositions[offset + 2] = point[2];
    body.exactSignWitnessDistanceM[particle] = query.distanceM;
    if (signedDistanceM <= clearance + 0.01) body.exactCandidateMask[particle] = 1;
    if (signedDistanceM < 0) intersectionCount += 1;
    maximumPenetrationM = Math.max(maximumPenetrationM, penetrationM);
    if (markInitialDeepOverlap && penetrationM > MAX_EXACT_LOCAL_OVERLAP_M) {
      body.deepInitialOverlapMask[particle] = 1;
      deepOverlapCount += 1;
    }
  }
  return { maximumPenetrationM, deepOverlapCount, intersectionCount };
}

function recoverSewnInitialExactOverlap(
  body: BodyCollisionRuntimeState,
  positions: Float32Array,
  maximumCorrectionM: number,
  clothTriangles: Uint32Array,
  inverseMasses: Float32Array | undefined,
  clothSeams: BodyInitialSeamConstraints,
): boolean {
  const original = new Float32Array(positions);
  const edges = buildInitialEdgeConstraints(original, clothTriangles);
  const rigidPanels = buildInitialRigidPanels(positions.length / 3, clothTriangles);
  const panelByParticle = buildInitialPanelIndex(positions.length / 3, rigidPanels);
  const seamTargets = captureInitialSeamDistances(original, clothSeams);
  const correctionLimit = Math.max(INITIAL_DEPENETRATION_EPSILON_M, Math.min(
    maximumCorrectionM,
    INITIAL_DEPENETRATION_MAX_TOTAL_TRANSLATION_M / INITIAL_DEPENETRATION_MAX_PASSES,
  ));
  let maximumDisplacementM = 0;
  let resolved = false;
  let passes = 0;
  body.initialOverlapGuardMask.set(body.deepInitialOverlapMask);
  if (inverseMasses && rigidPanels.some((panel) =>
    panel.some((particle) => body.deepInitialOverlapMask[particle] !== 0)
      && panel.some((particle) => inverseMasses[particle] <= 0))) {
    body.initialOverlapGuardMask.fill(0);
    body.initialOverlapUnresolved = true;
    return false;
  }
  const sweepCorrectionLimit = Math.max(
    INITIAL_DEPENETRATION_EPSILON_M,
    correctionLimit / 8,
  );
  for (let pass = 0; pass < INITIAL_DEPENETRATION_MAX_PASSES; pass += 1) {
    for (let sweep = 0; sweep < INITIAL_ISOMETRIC_PROJECTION_SWEEPS; sweep += 1) {
      projectInitialExactClearance(body, positions, inverseMasses, sweepCorrectionLimit);
      projectInitialRigidPanels(original, positions, rigidPanels);
      projectInitialPanelSeams(positions, clothSeams, seamTargets, rigidPanels, panelByParticle, sweepCorrectionLimit);
      projectInitialRigidPanels(original, positions, rigidPanels);
    }
    passes += 1;
    const displacementM = maximumInitialParticleDisplacement(original, positions);
    if (!Number.isFinite(displacementM) || displacementM > INITIAL_DEPENETRATION_MAX_TOTAL_TRANSLATION_M + INITIAL_DEPENETRATION_EPSILON_M) break;
    maximumDisplacementM = Math.max(maximumDisplacementM, displacementM);
    const penetrationM = maximumInitialExactPenetration(body, positions);
    const edgeError = maximumInitialEdgeRelativeError(positions, edges);
    const seamErrorM = maximumInitialSeamDistanceError(positions, clothSeams, seamTargets);
    console.log("P1105_BALANCED_RIGID_PASS", JSON.stringify({ pass: pass + 1, penetrationMm: penetrationM * 1000, edgeRelativeError: edgeError, seamErrorMm: seamErrorM * 1000, displacementMm: displacementM * 1000 }));
    if (Number.isFinite(penetrationM)
      && penetrationM <= INITIAL_ISOMETRIC_TARGET_PENETRATION_M + INITIAL_ISOMETRIC_PENETRATION_TOLERANCE_M
      && edgeError <= INITIAL_ISOMETRIC_EDGE_RELATIVE_TOLERANCE
      && seamErrorM <= INITIAL_ISOMETRIC_SEAM_DISTANCE_TOLERANCE_M) {
      resolved = true;
      break;
    }
  }
  if (!resolved) positions.set(original);
  body.initialOverlapGuardMask.fill(0);
  body.initialOverlapUnresolved = !resolved;
  body.initialDepenetrationPasses = passes;
  body.initialDepenetrationMaximumTranslationM = maximumDisplacementM;
  return resolved;
}

interface InitialEdgeConstraint { a: number; b: number; restLengthM: number }

function buildInitialEdgeConstraints(positions: Float32Array, triangles: Uint32Array): InitialEdgeConstraint[] {
  const edges: InitialEdgeConstraint[] = [];
  const seen = new Set<string>();
  const particleCount = positions.length / 3;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const t = [triangles[offset], triangles[offset + 1], triangles[offset + 2]] as const;
    if (t.some((p) => p >= particleCount)) continue;
    for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as const) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ao = a * 3, bo = b * 3;
      edges.push({ a, b, restLengthM: Math.hypot(positions[bo] - positions[ao], positions[bo + 1] - positions[ao + 1], positions[bo + 2] - positions[ao + 2]) });
    }
  }
  return edges;
}

function initialSeamAnchors(positions: Float32Array, seams: BodyInitialSeamConstraints, seam: number): { a: [number, number, number]; b: [number, number, number] } {
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  const base = seam * 4;
  const particleCount = positions.length / 3;
  for (let slot = 0; slot < 4; slot += 1) {
    const particle = seams.indices[base + slot];
    if (particle === INITIAL_SEAM_MISSING_PARTICLE || particle >= particleCount) continue;
    const target = slot < 2 ? a : b;
    const weight = seams.weights[base + slot];
    const o = particle * 3;
    target[0] += positions[o] * weight; target[1] += positions[o + 1] * weight; target[2] += positions[o + 2] * weight;
  }
  return { a, b };
}

function captureInitialSeamDistances(positions: Float32Array, seams: BodyInitialSeamConstraints): Float64Array {
  const count = Math.floor(Math.min(seams.indices.length, seams.weights.length) / 4);
  const out = new Float64Array(count);
  for (let seam = 0; seam < count; seam += 1) {
    const p = initialSeamAnchors(positions, seams, seam);
    out[seam] = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
  }
  return out;
}

function projectInitialExactClearance(body: BodyCollisionRuntimeState, positions: Float32Array, inverseMasses: Float32Array | undefined, limit: number): void {
  const runtime = body.exactSurface!;
  for (let particle = 0; particle < positions.length / 3; particle += 1) {
    if (inverseMasses && inverseMasses[particle] <= 0) continue;
    const point = particlePoint(positions, particle);
    const query = closestPointOnExactBody(runtime, point, false);
    const signed = pointInsideExactBody(runtime, point) ? -query.distanceM : query.distanceM;
    const penetration = body.particleHalfThicknessM[particle] + body.contactSkinM - signed;
    if (penetration <= INITIAL_ISOMETRIC_TARGET_PENETRATION_M + INITIAL_DEPENETRATION_EPSILON_M) continue;
    const correction = Math.min(limit, penetration - INITIAL_ISOMETRIC_TARGET_PENETRATION_M + INITIAL_DEPENETRATION_EPSILON_M);
    const o = particle * 3;
    positions[o] += query.normal[0] * correction; positions[o + 1] += query.normal[1] * correction; positions[o + 2] += query.normal[2] * correction;
  }
}

function buildInitialRigidPanels(particleCount: number, triangles: Uint32Array): number[][] {
  const used = new Uint8Array(particleCount);
  for (const particle of triangles) if (particle < particleCount) used[particle] = 1;
  return buildClothConnectedComponents(particleCount, triangles)
    .filter((component) => component.some((particle) => used[particle] !== 0));
}

function projectInitialRigidPanels(
  original: Float32Array,
  positions: Float32Array,
  panels: readonly (readonly number[])[],
): void {
  for (const panel of panels) projectInitialRigidPanel(original, positions, panel);
}

function projectInitialRigidPanel(
  original: Float32Array,
  positions: Float32Array,
  particles: readonly number[],
): void {
  if (particles.length === 0) return;
  let sourceX = 0, sourceY = 0, sourceZ = 0;
  let targetX = 0, targetY = 0, targetZ = 0;
  for (const particle of particles) {
    const offset = particle * 3;
    sourceX += original[offset]; sourceY += original[offset + 1]; sourceZ += original[offset + 2];
    targetX += positions[offset]; targetY += positions[offset + 1]; targetZ += positions[offset + 2];
  }
  const inverseCount = 1 / particles.length;
  sourceX *= inverseCount; sourceY *= inverseCount; sourceZ *= inverseCount;
  targetX *= inverseCount; targetY *= inverseCount; targetZ *= inverseCount;
  if (particles.length === 1) {
    const offset = particles[0] * 3;
    positions[offset] = targetX; positions[offset + 1] = targetY; positions[offset + 2] = targetZ;
    return;
  }

  let sxx = 0, sxy = 0, sxz = 0;
  let syx = 0, syy = 0, syz = 0;
  let szx = 0, szy = 0, szz = 0;
  for (const particle of particles) {
    const offset = particle * 3;
    const ax = original[offset] - sourceX;
    const ay = original[offset + 1] - sourceY;
    const az = original[offset + 2] - sourceZ;
    const bx = positions[offset] - targetX;
    const by = positions[offset + 1] - targetY;
    const bz = positions[offset + 2] - targetZ;
    sxx += ax * bx; sxy += ax * by; sxz += ax * bz;
    syx += ay * bx; syy += ay * by; syz += ay * bz;
    szx += az * bx; szy += az * by; szz += az * bz;
  }
  const horn = [
    sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
    syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
    szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
    sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
  ];
  let shift = 0;
  for (let row = 0; row < 4; row += 1) {
    let rowMagnitude = 0;
    for (let column = 0; column < 4; column += 1) rowMagnitude += Math.abs(horn[row * 4 + column]);
    shift = Math.max(shift, rowMagnitude);
  }
  shift += 1e-12;
  let qw = 1, qx = 0, qy = 0, qz = 0;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const q = [qw, qx, qy, qz];
    const next = [0, 0, 0, 0];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        next[row] += (horn[row * 4 + column] + (row === column ? shift : 0)) * q[column];
      }
    }
    const length = Math.hypot(next[0], next[1], next[2], next[3]);
    if (length <= EPSILON) break;
    qw = next[0] / length; qx = next[1] / length; qy = next[2] / length; qz = next[3] / length;
    if (qw < 0) { qw = -qw; qx = -qx; qy = -qy; qz = -qz; }
  }
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wz), r02 = 2 * (xz + wy);
  const r10 = 2 * (xy + wz), r11 = 1 - 2 * (xx + zz), r12 = 2 * (yz - wx);
  const r20 = 2 * (xz - wy), r21 = 2 * (yz + wx), r22 = 1 - 2 * (xx + yy);
  for (const particle of particles) {
    const offset = particle * 3;
    const x = original[offset] - sourceX;
    const y = original[offset + 1] - sourceY;
    const z = original[offset + 2] - sourceZ;
    positions[offset] = targetX + r00 * x + r01 * y + r02 * z;
    positions[offset + 1] = targetY + r10 * x + r11 * y + r12 * z;
    positions[offset + 2] = targetZ + r20 * x + r21 * y + r22 * z;
  }
}

function projectInitialTriangleEdges(positions: Float32Array, edges: readonly InitialEdgeConstraint[], inverseMasses: Float32Array | undefined, limit: number): void {
  for (const edge of edges) {
    const ao = edge.a * 3, bo = edge.b * 3;
    const dx = positions[bo] - positions[ao], dy = positions[bo + 1] - positions[ao + 1], dz = positions[bo + 2] - positions[ao + 2];
    const length = Math.hypot(dx, dy, dz); if (length <= EPSILON) continue;
    const wa = inverseMasses ? Math.max(0, inverseMasses[edge.a]) : 1;
    const wb = inverseMasses ? Math.max(0, inverseMasses[edge.b]) : 1;
    const denominator = wa + wb; if (denominator <= EPSILON) continue;
    let multiplier = (length - edge.restLengthM) / denominator;
    const maxApplied = Math.max(Math.abs(multiplier * wa), Math.abs(multiplier * wb));
    if (maxApplied > limit) multiplier *= limit / maxApplied;
    const nx = dx / length, ny = dy / length, nz = dz / length;
    const ca = multiplier * wa, cb = multiplier * wb;
    positions[ao] += nx * ca; positions[ao + 1] += ny * ca; positions[ao + 2] += nz * ca;
    positions[bo] -= nx * cb; positions[bo + 1] -= ny * cb; positions[bo + 2] -= nz * cb;
  }
}

function buildInitialPanelIndex(
  particleCount: number,
  panels: readonly (readonly number[])[],
): Int32Array {
  const panelByParticle = new Int32Array(particleCount);
  panelByParticle.fill(-1);
  for (let panel = 0; panel < panels.length; panel += 1) {
    for (const particle of panels[panel]) {
      if (particle < particleCount) panelByParticle[particle] = panel;
    }
  }
  return panelByParticle;
}

function initialSeamSidePanel(
  seams: BodyInitialSeamConstraints,
  seam: number,
  side: 0 | 1,
  panelByParticle: Int32Array,
): number {
  const base = seam * 4 + side * 2;
  let panel = -1;
  for (let slot = 0; slot < 2; slot += 1) {
    const particle = seams.indices[base + slot];
    if (particle === INITIAL_SEAM_MISSING_PARTICLE || particle >= panelByParticle.length) continue;
    const candidate = panelByParticle[particle];
    if (candidate < 0) continue;
    if (panel < 0) panel = candidate;
    else if (panel !== candidate) return -1;
  }
  return panel;
}

function projectInitialPanelSeams(
  positions: Float32Array,
  seams: BodyInitialSeamConstraints,
  targets: Float64Array,
  panels: readonly (readonly number[])[],
  panelByParticle: Int32Array,
  limit: number,
): void {
  const corrections = new Float64Array(panels.length * 3);
  const correctionWeights = new Float64Array(panels.length);
  for (let seam = 0; seam < targets.length; seam += 1) {
    const panelA = initialSeamSidePanel(seams, seam, 0, panelByParticle);
    const panelB = initialSeamSidePanel(seams, seam, 1, panelByParticle);
    if (panelA < 0 || panelB < 0 || panelA === panelB) continue;
    const anchors = initialSeamAnchors(positions, seams, seam);
    const dx = anchors.b[0] - anchors.a[0];
    const dy = anchors.b[1] - anchors.a[1];
    const dz = anchors.b[2] - anchors.a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length <= EPSILON) continue;
    const error = length - targets[seam];
    if (Math.abs(error) <= INITIAL_DEPENETRATION_EPSILON_M) continue;
    const correctionM = Math.min(limit * 2, Math.abs(error)) * 0.5 * Math.sign(error);
    const nx = dx / length;
    const ny = dy / length;
    const nz = dz / length;
    const a = panelA * 3;
    const b = panelB * 3;
    corrections[a] += nx * correctionM;
    corrections[a + 1] += ny * correctionM;
    corrections[a + 2] += nz * correctionM;
    corrections[b] -= nx * correctionM;
    corrections[b + 1] -= ny * correctionM;
    corrections[b + 2] -= nz * correctionM;
    correctionWeights[panelA] += 1;
    correctionWeights[panelB] += 1;
  }
  for (let panel = 0; panel < panels.length; panel += 1) {
    const weight = correctionWeights[panel];
    if (weight <= 0) continue;
    const base = panel * 3;
    let dx = corrections[base] / weight;
    let dy = corrections[base + 1] / weight;
    let dz = corrections[base + 2] / weight;
    const magnitude = Math.hypot(dx, dy, dz);
    if (magnitude <= INITIAL_DEPENETRATION_EPSILON_M) continue;
    if (magnitude > limit) {
      const scale = limit / magnitude;
      dx *= scale; dy *= scale; dz *= scale;
    }
    for (const particle of panels[panel]) {
      const offset = particle * 3;
      positions[offset] += dx;
      positions[offset + 1] += dy;
      positions[offset + 2] += dz;
    }
  }
}

function projectInitialSeams(positions: Float32Array, seams: BodyInitialSeamConstraints, targets: Float64Array, inverseMasses: Float32Array | undefined, limit: number): void {
  const particleCount = positions.length / 3;
  for (let seam = 0; seam < targets.length; seam += 1) {
    const base = seam * 4;
    const anchors = initialSeamAnchors(positions, seams, seam);
    const dx = anchors.b[0] - anchors.a[0], dy = anchors.b[1] - anchors.a[1], dz = anchors.b[2] - anchors.a[2];
    const length = Math.hypot(dx, dy, dz); if (length <= EPSILON) continue;
    const particles: number[] = [], coefficients: number[] = [];
    for (let slot = 0; slot < 4; slot += 1) {
      const particle = seams.indices[base + slot];
      if (particle === INITIAL_SEAM_MISSING_PARTICLE || particle >= particleCount) continue;
      const coefficient = (slot < 2 ? -1 : 1) * seams.weights[base + slot];
      if (Math.abs(coefficient) <= EPSILON) continue;
      const existing = particles.indexOf(particle);
      if (existing >= 0) coefficients[existing] += coefficient; else { particles.push(particle); coefficients.push(coefficient); }
    }
    let denominator = 0;
    for (let i = 0; i < particles.length; i += 1) {
      const inv = inverseMasses ? Math.max(0, inverseMasses[particles[i]]) : 1;
      denominator += inv * coefficients[i] * coefficients[i];
    }
    if (denominator <= EPSILON) continue;
    let multiplier = -(length - targets[seam]) / denominator;
    let maxApplied = 0;
    for (let i = 0; i < particles.length; i += 1) {
      const inv = inverseMasses ? Math.max(0, inverseMasses[particles[i]]) : 1;
      maxApplied = Math.max(maxApplied, Math.abs(multiplier * coefficients[i] * inv));
    }
    if (maxApplied > limit) multiplier *= limit / maxApplied;
    const nx = dx / length, ny = dy / length, nz = dz / length;
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i]; const inv = inverseMasses ? Math.max(0, inverseMasses[particle]) : 1;
      const c = multiplier * coefficients[i] * inv; const o = particle * 3;
      positions[o] += nx * c; positions[o + 1] += ny * c; positions[o + 2] += nz * c;
    }
  }
}

function maximumInitialExactPenetration(body: BodyCollisionRuntimeState, positions: Float32Array): number {
  const runtime = body.exactSurface!; let maximum = 0;
  for (let particle = 0; particle < positions.length / 3; particle += 1) {
    const point = particlePoint(positions, particle); const query = closestPointOnExactBody(runtime, point, false);
    const signed = pointInsideExactBody(runtime, point) ? -query.distanceM : query.distanceM;
    maximum = Math.max(maximum, body.particleHalfThicknessM[particle] + body.contactSkinM - signed);
  }
  return maximum;
}

function maximumInitialEdgeRelativeError(positions: Float32Array, edges: readonly InitialEdgeConstraint[]): number {
  let maximum = 0;
  for (const edge of edges) { if (edge.restLengthM <= EPSILON) continue; const ao = edge.a * 3, bo = edge.b * 3;
    const length = Math.hypot(positions[bo] - positions[ao], positions[bo + 1] - positions[ao + 1], positions[bo + 2] - positions[ao + 2]);
    maximum = Math.max(maximum, Math.abs(length - edge.restLengthM) / edge.restLengthM); }
  return maximum;
}

function maximumInitialSeamDistanceError(positions: Float32Array, seams: BodyInitialSeamConstraints, targets: Float64Array): number {
  let maximum = 0;
  for (let seam = 0; seam < targets.length; seam += 1) { const p = initialSeamAnchors(positions, seams, seam);
    maximum = Math.max(maximum, Math.abs(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) - targets[seam])); }
  return maximum;
}

function clampInitialRecoveryDisplacements(original: Float32Array, positions: Float32Array, limit: number): void {
  for (let particle = 0; particle < positions.length / 3; particle += 1) { const o = particle * 3;
    const dx = positions[o] - original[o], dy = positions[o + 1] - original[o + 1], dz = positions[o + 2] - original[o + 2]; const d = Math.hypot(dx, dy, dz);
    if (d <= limit || d <= EPSILON) continue; const scale = limit / d;
    positions[o] = original[o] + dx * scale; positions[o + 1] = original[o + 1] + dy * scale; positions[o + 2] = original[o + 2] + dz * scale; }
}

function maximumInitialParticleDisplacement(original: Float32Array, positions: Float32Array): number {
  let maximum = 0;
  for (let particle = 0; particle < positions.length / 3; particle += 1) { const o = particle * 3;
    maximum = Math.max(maximum, Math.hypot(positions[o] - original[o], positions[o + 1] - original[o + 1], positions[o + 2] - original[o + 2])); }
  return maximum;
}

function recoverDeepInitialExactOverlap(
  body: BodyCollisionRuntimeState,
  positions: Float32Array,
  maximumCorrectionM: number,
  clothTriangles: Uint32Array | undefined,
  inverseMasses: Float32Array | undefined,
): boolean {
  const components = buildClothConnectedComponents(positions.length / 3, clothTriangles);
  const originalPositions = new Float32Array(positions);
  const perPassLimit = Math.max(INITIAL_DEPENETRATION_EPSILON_M, maximumCorrectionM);
  const totalLimit = Math.max(perPassLimit, Math.min(
    INITIAL_DEPENETRATION_MAX_TOTAL_TRANSLATION_M,
    perPassLimit * INITIAL_DEPENETRATION_MAX_PASSES,
  ));
  let resolved = true;
  let totalPasses = 0;
  let maximumComponentTranslationM = 0;

  for (const component of components) {
    if (!component.some((particle) => body.deepInitialOverlapMask[particle] !== 0)) continue;
    // The guard exists only inside this synchronous setup transaction. It is
    // deliberately cleared before any XPBD contact solve is allowed to run.
    for (const particle of component) body.initialOverlapGuardMask[particle] = 1;
    if (inverseMasses && component.some((particle) => inverseMasses[particle] <= 0)) {
      resolved = false;
      continue;
    }

    let componentResolved = false;
    let componentTranslationM = 0;
    for (let pass = 0; pass < INITIAL_DEPENETRATION_MAX_PASSES; pass += 1) {
      const probe = probeInitialDepenetrationComponent(body, positions, component);
      if (probe.maximumPenetrationM <= MAX_EXACT_LOCAL_OVERLAP_M + INITIAL_DEPENETRATION_EPSILON_M) {
        componentResolved = true;
        break;
      }
      const remainingTranslationM = totalLimit - componentTranslationM;
      if (remainingTranslationM <= INITIAL_DEPENETRATION_EPSILON_M) break;
      const requestedTranslationM = Math.max(
        INITIAL_DEPENETRATION_EPSILON_M,
        probe.maximumPenetrationM - MAX_EXACT_LOCAL_OVERLAP_M + INITIAL_DEPENETRATION_EPSILON_M,
      );
      const translationM = Math.min(perPassLimit, remainingTranslationM, requestedTranslationM);
      if (translationM <= 0) break;
      translateClothComponent(positions, component, probe.direction, translationM);
      componentTranslationM += translationM;
      totalPasses += 1;
    }
    if (!componentResolved) {
      componentResolved = probeInitialDepenetrationComponent(body, positions, component).maximumPenetrationM
        <= MAX_EXACT_LOCAL_OVERLAP_M + INITIAL_DEPENETRATION_EPSILON_M;
    }
    resolved &&= componentResolved;
    maximumComponentTranslationM = Math.max(maximumComponentTranslationM, componentTranslationM);
  }

  // A failed bounded recovery is a diagnostic, not a half-applied placement.
  // Restore the exact STEP-0 geometry and let the caller mark the state failed.
  if (!resolved) positions.set(originalPositions);
  body.initialOverlapGuardMask.fill(0);
  body.initialOverlapUnresolved = !resolved;
  body.initialDepenetrationPasses = totalPasses;
  body.initialDepenetrationMaximumTranslationM = maximumComponentTranslationM;
  return resolved;
}

function probeInitialDepenetrationComponent(
  body: BodyCollisionRuntimeState,
  positions: Float32Array,
  component: readonly number[],
): { maximumPenetrationM: number; direction: [number, number, number] } {
  const runtime = body.exactSurface!;
  let maximumPenetrationM = 0;
  let seedParticle = -1;
  let seedNormal: [number, number, number] = [1, 0, 0];
  for (const particle of component) {
    const point = particlePoint(positions, particle);
    const query = closestPointOnExactBody(runtime, point, false);
    const inside = pointInsideExactBody(runtime, point);
    const signedDistanceM = inside ? -query.distanceM : query.distanceM;
    const penetrationM = body.particleHalfThicknessM[particle] + body.contactSkinM - signedDistanceM;
    if (penetrationM > maximumPenetrationM + INITIAL_DEPENETRATION_EPSILON_M
      || (Math.abs(penetrationM - maximumPenetrationM) <= INITIAL_DEPENETRATION_EPSILON_M
        && penetrationM > 0 && (seedParticle < 0 || particle < seedParticle))) {
      maximumPenetrationM = penetrationM;
      seedParticle = particle;
      seedNormal = query.normal;
    }
  }

  if (maximumPenetrationM <= MAX_EXACT_LOCAL_OVERLAP_M + INITIAL_DEPENETRATION_EPSILON_M) {
    return { maximumPenetrationM, direction: seedNormal };
  }
  const accumulated: [number, number, number] = [0, 0, 0];
  for (const particle of component) {
    const point = particlePoint(positions, particle);
    const query = closestPointOnExactBody(runtime, point, false);
    const inside = pointInsideExactBody(runtime, point);
    const signedDistanceM = inside ? -query.distanceM : query.distanceM;
    const penetrationM = body.particleHalfThicknessM[particle] + body.contactSkinM - signedDistanceM;
    if (penetrationM <= MAX_EXACT_LOCAL_OVERLAP_M + INITIAL_DEPENETRATION_EPSILON_M) continue;
    if (dot3(query.normal, seedNormal) < 0) continue;
    accumulated[0] += query.normal[0] * penetrationM;
    accumulated[1] += query.normal[1] * penetrationM;
    accumulated[2] += query.normal[2] * penetrationM;
  }
  return { maximumPenetrationM, direction: normalize3(accumulated, seedNormal) };
}

function buildClothConnectedComponents(particleCount: number, triangles: Uint32Array | undefined): number[][] {
  const parent = Int32Array.from({ length: particleCount }, (_, particle) => particle);
  const find = (particle: number): number => {
    let root = particle;
    while (parent[root] !== root) root = parent[root];
    while (parent[particle] !== particle) {
      const next = parent[particle];
      parent[particle] = root;
      particle = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    if (rootA < rootB) parent[rootB] = rootA;
    else parent[rootA] = rootB;
  };
  if (triangles) {
    for (let offset = 0; offset < triangles.length; offset += 3) {
      const a = triangles[offset];
      const b = triangles[offset + 1];
      const c = triangles[offset + 2];
      if (a >= particleCount || b >= particleCount || c >= particleCount) continue;
      union(a, b);
      union(b, c);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let particle = 0; particle < particleCount; particle += 1) {
    const root = find(particle);
    const component = byRoot.get(root);
    if (component) component.push(particle);
    else byRoot.set(root, [particle]);
  }
  return [...byRoot.values()];
}

function translateClothComponent(
  positions: Float32Array,
  component: readonly number[],
  direction: readonly [number, number, number],
  translationM: number,
): void {
  for (const particle of component) {
    const offset = particle * 3;
    positions[offset] += direction[0] * translationM;
    positions[offset + 1] += direction[1] * translationM;
    positions[offset + 2] += direction[2] * translationM;
  }
}

function solveBodyCollisionsBitmask(
  input: BodyCollisionSolveInput,
  particleCount: number,
  colliderCount: number,
): void {
  const body = input.body;
  const predicted = input.predictedPositions;
  const previous = input.previousPositions;
  const cache = body.colliders.cache!;
  let phaseStarted = performance.now();

  for (let particle = 0; particle < particleCount; particle += 1) {
    body.pointCandidateMasks[particle] = 0;
    body.sweptCandidateMasks[particle] = 0;
    if (input.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const pointX = predicted[offset];
    const pointY = predicted[offset + 1];
    const pointZ = predicted[offset + 2];
    const radius = body.particleHalfThicknessM[particle] + body.contactSkinM;

    body.bodyParticleQueries += 1;
    body.bodyColliderTests += colliderCount;
    const pointMask = refinePointCandidateMask(
      cache,
      pointCandidateMask(cache, colliderCount, pointY, radius),
      pointX,
      pointY,
      pointZ,
      radius,
    );
    const pointCandidates = countBits(pointMask);
    body.bodyCandidateColliderTests += pointCandidates;
    body.bodyBroadphaseRejected += colliderCount - pointCandidates;
    body.pointCandidateMasks[particle] = pointMask;

    if (!input.allowSwept) continue;
    const previousX = previous[offset];
    const previousY = previous[offset + 1];
    const previousZ = previous[offset + 2];
    const movementX = pointX - previousX;
    const movementY = pointY - previousY;
    const movementZ = pointZ - previousZ;
    if (movementX * movementX + movementY * movementY + movementZ * movementZ <= EPSILON * EPSILON) continue;
    body.bodyParticleQueries += 1;
    body.bodyColliderTests += colliderCount;
    const sweptMask = refineSegmentCandidateMask(
      cache,
      segmentCandidateMask(cache, colliderCount, previousY, pointY, radius),
      previousX,
      previousY,
      previousZ,
      pointX,
      pointY,
      pointZ,
      radius,
    );
    const sweptCandidates = countBits(sweptMask);
    body.bodyCandidateColliderTests += sweptCandidates;
    body.bodyBroadphaseRejected += colliderCount - sweptCandidates;
    body.sweptCandidateMasks[particle] = sweptMask;
  }
  body.broadphaseMs = performance.now() - phaseStarted;

  phaseStarted = performance.now();
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (input.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const pointX = predicted[offset];
    const pointY = predicted[offset + 1];
    const pointZ = predicted[offset + 2];
    const previousX = previous[offset];
    const previousY = previous[offset + 1];
    const previousZ = previous[offset + 2];
    const radius = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const scratch = body.contactScratch;
    const best = body.bestContactScratch;
    let bestPenetration = -1;
    let hasContact = false;
    let remaining = body.pointCandidateMasks[particle];
    while (remaining !== 0) {
      const bit = remaining & -remaining;
      const colliderIndex = 31 - Math.clz32(bit);
      remaining = (remaining ^ bit) >>> 0;
      if (body.colliders.kinds[colliderIndex] === BODY_COLLIDER_CAPSULE) {
        body.bodyCapsuleNarrowphaseTests += 1;
        if (!pointCapsuleContactScalar(scratch, body.colliders.data, cache, colliderIndex, pointX, pointY, pointZ, radius)) continue;
      } else {
        body.bodyEllipsoidNarrowphaseTests += 1;
        if (!pointEllipsoidContactScalar(scratch, body.colliders.data, colliderIndex, pointX, pointY, pointZ, radius)) continue;
      }
      body.bodyPointContactsFound += 1;
      if (scratch.penetrationM > bestPenetration) {
        bestPenetration = scratch.penetrationM;
        copyScratchContact(best, scratch);
        hasContact = true;
      }
    }

    if (!hasContact && input.allowSwept) {
      let earliestTime = Number.POSITIVE_INFINITY;
      remaining = body.sweptCandidateMasks[particle];
      while (remaining !== 0) {
        const bit = remaining & -remaining;
        const colliderIndex = 31 - Math.clz32(bit);
        remaining = (remaining ^ bit) >>> 0;
        body.bodySweptTests += 1;
        let found: boolean;
        if (body.colliders.kinds[colliderIndex] === BODY_COLLIDER_ELLIPSOID) {
          body.bodyEllipsoidNarrowphaseTests += 1;
          found = sweptEllipsoidContactScalar(scratch, body.colliders.data, colliderIndex, previousX, previousY, previousZ, pointX, pointY, pointZ, radius);
        } else {
          body.bodyCapsuleNarrowphaseTests += 1;
          found = sweptCapsuleContactScalar(scratch, body.colliders.data, cache, colliderIndex, previousX, previousY, previousZ, pointX, pointY, pointZ, radius);
        }
        if (!found) continue;
        body.bodySweptContactsFound += 1;
        if (scratch.t < earliestTime) {
          earliestTime = scratch.t;
          copyScratchContact(best, scratch);
          hasContact = true;
        }
      }
    }
    if (!hasContact) continue;
    body.contactMask[particle] = 1;
    body.contactRegionIndex[particle] = best.colliderIndex;
    body.contactNormals[offset] = best.normalX;
    body.contactNormals[offset + 1] = best.normalY;
    body.contactNormals[offset + 2] = best.normalZ;
    body.contactSurfacePoints[offset] = best.surfaceX;
    body.contactSurfacePoints[offset + 1] = best.surfaceY;
    body.contactSurfacePoints[offset + 2] = best.surfaceZ;
    body.contactPenetrations[particle] = best.penetrationM;
    body.contactSwept[particle] = best.swept ? 1 : 0;
  }
  body.narrowphaseMs = performance.now() - phaseStarted;

  phaseStarted = performance.now();
  const inverseDt = 1 / Math.max(input.fixedTimeStep, EPSILON);
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (!body.contactMask[particle]) continue;
    const offset = particle * 3;
    const pointX = predicted[offset];
    const pointY = predicted[offset + 1];
    const pointZ = predicted[offset + 2];
    const previousX = previous[offset];
    const previousY = previous[offset + 1];
    const previousZ = previous[offset + 2];
    const penetrationM = body.contactPenetrations[particle];
    const swept = body.contactSwept[particle] === 1;
    if (penetrationM > body.maximumBodyPenetrationM) body.maximumBodyPenetrationM = penetrationM;
    let correctionX = body.contactSurfacePoints[offset] - pointX;
    let correctionY = body.contactSurfacePoints[offset + 1] - pointY;
    let correctionZ = body.contactSurfacePoints[offset + 2] - pointZ;
    let correction = Math.sqrt(correctionX * correctionX + correctionY * correctionY + correctionZ * correctionZ);
    const localLimit = Math.max(1e-6, Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM));
    const grossPenetration = body.grossDepenetrationEnabled && !swept && penetrationM > localLimit;
    const limit = swept
      ? body.grossDepenetrationEnabled ? input.maximumCorrectionM : localLimit
      : grossPenetration ? input.maximumCorrectionM : localLimit;
    if (correction > limit) {
      const scale = limit / correction;
      correctionX *= scale;
      correctionY *= scale;
      correctionZ *= scale;
      correction = limit;
    }
    if (swept) body.sweptContactCount += 1;
    const velocityX = input.velocities ? input.velocities[offset] : (pointX - previousX) * inverseDt;
    const velocityY = input.velocities ? input.velocities[offset + 1] : (pointY - previousY) * inverseDt;
    const velocityZ = input.velocities ? input.velocities[offset + 2] : (pointZ - previousZ) * inverseDt;
    const normalX = body.contactNormals[offset];
    const normalY = body.contactNormals[offset + 1];
    const normalZ = body.contactNormals[offset + 2];
    const inwardSpeed = Math.max(0, -(velocityX * normalX + velocityY * normalY + velocityZ * normalZ));
    predicted[offset] = pointX + correctionX;
    predicted[offset + 1] = pointY + correctionY;
    predicted[offset + 2] = pointZ + correctionZ;
    body.contactCorrections[offset] += correctionX;
    body.contactCorrections[offset + 1] += correctionY;
    body.contactCorrections[offset + 2] += correctionZ;
    if (correction > body.maximumBodyCorrectionM) body.maximumBodyCorrectionM = correction;
    const settledContactImpulseSpeed = !swept && !grossPenetration ? correction * inverseDt : 0;
    body.normalImpulseSpeed[particle] = Math.max(
      body.normalImpulseSpeed[particle],
      inwardSpeed,
      settledContactImpulseSpeed,
    );
  }
  body.projectionMs = performance.now() - phaseStarted;
}

export function finalizeBodyContactDiagnostics(body: BodyCollisionRuntimeState): void {
  body.bodyContactCount = 0;
  body.bodyContactsByRegion = {};
  for (let particle = 0; particle < body.contactMask.length; particle += 1) {
    if (!body.contactMask[particle]) continue;
    body.bodyContactCount += 1;
    const colliderIndex = body.contactRegionIndex[particle];
    const region = body.exactSurface
      ? "exact-human-surface"
      : colliderIndex >= 0 ? body.colliders.regions[colliderIndex] ?? "unknown" : "unknown";
    body.bodyContactsByRegion[region] = (body.bodyContactsByRegion[region] ?? 0) + 1;
  }
}

export function applyBodyContactVelocity(
  velocity: readonly [number, number, number],
  normal: readonly [number, number, number],
  friction: number,
  normalImpulseSpeed: number,
): [number, number, number] {
  const n = normalize3(normal, [1, 0, 0]);
  const signedNormalSpeed = dot3(velocity, n);
  const outwardNormalSpeed = Math.max(0, signedNormalSpeed);
  const tx = velocity[0] - n[0] * signedNormalSpeed;
  const ty = velocity[1] - n[1] * signedNormalSpeed;
  const tz = velocity[2] - n[2] * signedNormalSpeed;
  const tangentSpeed = Math.hypot(tx, ty, tz);
  const frictionBudget = Math.max(0, friction) * Math.max(0, normalImpulseSpeed);
  const tangentScale = tangentSpeed > EPSILON ? Math.max(0, 1 - frictionBudget / tangentSpeed) : 0;
  return [
    n[0] * outwardNormalSpeed + tx * tangentScale,
    n[1] * outwardNormalSpeed + ty * tangentScale,
    n[2] * outwardNormalSpeed + tz * tangentScale,
  ];
}

export function applyBodyContactVelocities(
  velocities: Float32Array,
  body: BodyCollisionRuntimeState,
  fixedTimeStep = 1,
): void {
  const phaseStarted = performance.now();
  body.frictionContactCount = 0;
  const inverseDt = 1 / Math.max(fixedTimeStep, EPSILON);
  for (let particle = 0; particle < body.contactMask.length; particle += 1) {
    if (!body.contactMask[particle]) continue;
    const offset = particle * 3;
    const friction = body.particleFriction[particle];
    const velocityX = velocities[offset] - body.contactCorrections[offset] * inverseDt;
    const velocityY = velocities[offset + 1] - body.contactCorrections[offset + 1] * inverseDt;
    const velocityZ = velocities[offset + 2] - body.contactCorrections[offset + 2] * inverseDt;
    let normalX = body.contactNormals[offset];
    let normalY = body.contactNormals[offset + 1];
    let normalZ = body.contactNormals[offset + 2];
    const normalLength = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
    if (normalLength > EPSILON && Number.isFinite(normalLength)) {
      const inverseNormalLength = 1 / normalLength;
      normalX *= inverseNormalLength;
      normalY *= inverseNormalLength;
      normalZ *= inverseNormalLength;
    } else {
      normalX = 1;
      normalY = 0;
      normalZ = 0;
    }
    const signedNormalSpeed = velocityX * normalX + velocityY * normalY + velocityZ * normalZ;
    const outwardNormalSpeed = Math.max(0, signedNormalSpeed);
    const tangentX = velocityX - normalX * signedNormalSpeed;
    const tangentY = velocityY - normalY * signedNormalSpeed;
    const tangentZ = velocityZ - normalZ * signedNormalSpeed;
    const tangentSpeed = Math.sqrt(tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ);
    const frictionBudget = Math.max(0, friction) * Math.max(0, body.normalImpulseSpeed[particle]);
    const tangentScale = tangentSpeed > EPSILON ? Math.max(0, 1 - frictionBudget / tangentSpeed) : 0;
    velocities[offset] = normalX * outwardNormalSpeed + tangentX * tangentScale;
    velocities[offset + 1] = normalY * outwardNormalSpeed + tangentY * tangentScale;
    velocities[offset + 2] = normalZ * outwardNormalSpeed + tangentZ * tangentScale;
    if (friction > 0 && body.normalImpulseSpeed[particle] > 0) body.frictionContactCount += 1;
  }
  body.frictionMs = performance.now() - phaseStarted;
}

export function deepestBodyContact(
  point: readonly [number, number, number],
  colliders: PackedBodyColliders,
  particleRadiusM = 0,
): BodyContactQuery | null {
  let best: BodyContactQuery | null = null;
  for (let index = 0; index < colliders.kinds.length; index += 1) {
    const contact = queryPackedCollider(point, colliders, index, particleRadiusM);
    if (contact && (!best || contact.penetrationM > best.penetrationM)) best = contact;
  }
  return best;
}

function queryPackedColliderNarrowphase(
  point: readonly [number, number, number],
  colliders: PackedBodyColliders,
  colliderIndex: number,
  particleRadiusM = 0,
): BodyContactQuery | null {
  const offset = colliderIndex * BODY_COLLIDER_STRIDE;
  const region = colliders.regions[colliderIndex] ?? "unknown";
  const kind = colliders.kinds[colliderIndex];
  if (kind === BODY_COLLIDER_ELLIPSOID) {
    return pointEllipsoidContact(
      point,
      [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]],
      [colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]],
      particleRadiusM,
      colliderIndex,
      region,
    );
  }
  if (kind === BODY_COLLIDER_CAPSULE) {
    return pointCapsuleContact(
      point,
      [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]],
      [colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]],
      colliders.data[offset + 6] + particleRadiusM,
      colliderIndex,
      region,
    );
  }
  return null;
}

export function queryPackedCollider(
  point: readonly [number, number, number],
  colliders: PackedBodyColliders,
  colliderIndex: number,
  particleRadiusM = 0,
): BodyContactQuery | null {
  const offset = colliderIndex * BODY_COLLIDER_STRIDE;
  const region = colliders.regions[colliderIndex] ?? "unknown";
  const kind = colliders.kinds[colliderIndex];
  if (!pointOverlapsPackedColliderAabb(point, colliders, colliderIndex, particleRadiusM)) return null;
  if (kind === BODY_COLLIDER_ELLIPSOID) {
    return pointEllipsoidContact(
      point,
      [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]],
      [colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]],
      particleRadiusM,
      colliderIndex,
      region,
    );
  }
  if (kind === BODY_COLLIDER_CAPSULE) {
    return pointCapsuleContact(
      point,
      [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]],
      [colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]],
      colliders.data[offset + 6] + particleRadiusM,
      colliderIndex,
      region,
    );
  }
  return null;
}

export function pointCapsuleContact(
  point: readonly [number, number, number],
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  radius: number,
  colliderIndex = 0,
  region = "capsule",
): BodyContactQuery | null {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError("Capsule radius inválido.");
  const ab: [number, number, number] = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const length2 = dot3(ab, ab);
  const ap: [number, number, number] = [point[0] - start[0], point[1] - start[1], point[2] - start[2]];
  const t = length2 > EPSILON ? clamp(dot3(ap, ab) / length2, 0, 1) : 0;
  const center: [number, number, number] = [start[0] + ab[0] * t, start[1] + ab[1] * t, start[2] + ab[2] * t];
  const delta: [number, number, number] = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
  const distance = Math.hypot(...delta);
  if (distance >= radius) return null;
  const normal = distance > EPSILON ? scale3(delta, 1 / distance) : deterministicPerpendicular(ab);
  const surfacePoint: [number, number, number] = [center[0] + normal[0] * radius, center[1] + normal[1] * radius, center[2] + normal[2] * radius];
  return { colliderIndex, region, point, surfacePoint, normal, penetrationM: radius - distance, swept: false };
}

export function pointEllipsoidContact(
  point: readonly [number, number, number],
  center: readonly [number, number, number],
  radii: readonly [number, number, number],
  inflationM = 0,
  colliderIndex = 0,
  region = "ellipsoid",
): BodyContactQuery | null {
  validateRadii(radii);
  const inflated: [number, number, number] = [radii[0] + inflationM, radii[1] + inflationM, radii[2] + inflationM];
  validateRadii(inflated);
  const delta: [number, number, number] = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
  const q: [number, number, number] = [delta[0] / inflated[0], delta[1] / inflated[1], delta[2] / inflated[2]];
  const normalizedRadius = Math.hypot(...q);
  if (normalizedRadius >= 1) return null;
  if (normalizedRadius <= EPSILON) {
    const axis = smallestRadiusAxis(inflated);
    const normal: [number, number, number] = axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
    const surfacePoint: [number, number, number] = [...center] as [number, number, number];
    surfacePoint[axis] += inflated[axis];
    return { colliderIndex, region, point, surfacePoint, normal, penetrationM: inflated[axis], swept: false };
  }
  const surfacePoint: [number, number, number] = [
    center[0] + delta[0] / normalizedRadius,
    center[1] + delta[1] / normalizedRadius,
    center[2] + delta[2] / normalizedRadius,
  ];
  const normal = normalize3([
    (surfacePoint[0] - center[0]) / (inflated[0] * inflated[0]),
    (surfacePoint[1] - center[1]) / (inflated[1] * inflated[1]),
    (surfacePoint[2] - center[2]) / (inflated[2] * inflated[2]),
  ], [1, 0, 0]);
  return {
    colliderIndex,
    region,
    point,
    surfacePoint,
    normal,
    penetrationM: Math.hypot(surfacePoint[0] - point[0], surfacePoint[1] - point[1], surfacePoint[2] - point[2]),
    swept: false,
  };
}

export function earliestSweptBodyContact(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  colliders: PackedBodyColliders,
  particleRadiusM = 0,
): BodyContactQuery | null {
  const motionX = end[0] - start[0];
  const motionY = end[1] - start[1];
  const motionZ = end[2] - start[2];
  if (motionX * motionX + motionY * motionY + motionZ * motionZ <= EPSILON * EPSILON) return null;
  let best: (BodyContactQuery & { t: number }) | null = null;
  for (let index = 0; index < colliders.kinds.length; index += 1) {
    if (!segmentOverlapsPackedColliderAabb(start, end, colliders, index, particleRadiusM)) continue;
    const candidate = sweptPackedCollider(start, end, colliders, index, particleRadiusM);
    if (candidate && (!best || candidate.t < best.t)) best = candidate;
  }
  if (!best) return null;
  const { t: _t, ...contact } = best;
  return contact;
}

function sweptPackedCollider(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  colliders: PackedBodyColliders,
  colliderIndex: number,
  particleRadiusM: number,
): (BodyContactQuery & { t: number }) | null {
  const offset = colliderIndex * BODY_COLLIDER_STRIDE;
  const region = colliders.regions[colliderIndex] ?? "unknown";
  if (colliders.kinds[colliderIndex] === BODY_COLLIDER_ELLIPSOID) {
    const center: [number, number, number] = [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]];
    const radii: [number, number, number] = [colliders.data[offset + 3] + particleRadiusM, colliders.data[offset + 4] + particleRadiusM, colliders.data[offset + 5] + particleRadiusM];
    const d: [number, number, number] = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const s: [number, number, number] = [(start[0] - center[0]) / radii[0], (start[1] - center[1]) / radii[1], (start[2] - center[2]) / radii[2]];
    const v: [number, number, number] = [d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]];
    const a = dot3(v, v);
    const b = 2 * dot3(s, v);
    const c = dot3(s, s) - 1;
    if (a <= EPSILON || c <= 0) return null;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > 1) return null;
    const hit: [number, number, number] = [start[0] + d[0] * t, start[1] + d[1] * t, start[2] + d[2] * t];
    const normal = normalize3([(hit[0] - center[0]) / (radii[0] * radii[0]), (hit[1] - center[1]) / (radii[1] * radii[1]), (hit[2] - center[2]) / (radii[2] * radii[2])], [1, 0, 0]);
    const surfacePoint = add3(hit, scale3(normal, 1e-6));
    return { colliderIndex, region, point: end, surfacePoint, normal, penetrationM: 0, swept: true, t };
  }
  if (colliders.kinds[colliderIndex] === BODY_COLLIDER_CAPSULE) {
    const capsuleStart: [number, number, number] = [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]];
    const capsuleEnd: [number, number, number] = [colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]];
    const radius = colliders.data[offset + 6] + particleRadiusM;
    const closest = closestSegmentParameters(start, end, capsuleStart, capsuleEnd);
    if (closest.distanceM > radius) return null;
    const motion: [number, number, number] = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const axis: [number, number, number] = [capsuleEnd[0] - capsuleStart[0], capsuleEnd[1] - capsuleStart[1], capsuleEnd[2] - capsuleStart[2]];
    const hit: [number, number, number] = [start[0] + motion[0] * closest.a, start[1] + motion[1] * closest.a, start[2] + motion[2] * closest.a];
    const axisPoint: [number, number, number] = [capsuleStart[0] + axis[0] * closest.b, capsuleStart[1] + axis[1] * closest.b, capsuleStart[2] + axis[2] * closest.b];
    const normal = normalize3([hit[0] - axisPoint[0], hit[1] - axisPoint[1], hit[2] - axisPoint[2]], deterministicPerpendicular(axis));
    const surfacePoint: [number, number, number] = [axisPoint[0] + normal[0] * (radius + 1e-6), axisPoint[1] + normal[1] * (radius + 1e-6), axisPoint[2] + normal[2] * (radius + 1e-6)];
    return { colliderIndex, region, point: end, surfacePoint, normal, penetrationM: 0, swept: true, t: closest.a };
  }
  return null;
}

function pointOverlapsPackedColliderAabb(
  point: readonly [number, number, number],
  colliders: PackedBodyColliders,
  colliderIndex: number,
  inflationM: number,
): boolean {
  const offset = colliderIndex * BODY_COLLIDER_STRIDE;
  const data = colliders.data;
  const kind = colliders.kinds[colliderIndex];
  if (kind === BODY_COLLIDER_ELLIPSOID) {
    const rx = data[offset + 3] + inflationM;
    const ry = data[offset + 4] + inflationM;
    const rz = data[offset + 5] + inflationM;
    return Math.abs(point[0] - data[offset]) < rx
      && Math.abs(point[1] - data[offset + 1]) < ry
      && Math.abs(point[2] - data[offset + 2]) < rz;
  }
  if (kind === BODY_COLLIDER_CAPSULE) {
    const radius = data[offset + 6] + inflationM;
    const minX = Math.min(data[offset], data[offset + 3]) - radius;
    const maxX = Math.max(data[offset], data[offset + 3]) + radius;
    const minY = Math.min(data[offset + 1], data[offset + 4]) - radius;
    const maxY = Math.max(data[offset + 1], data[offset + 4]) + radius;
    const minZ = Math.min(data[offset + 2], data[offset + 5]) - radius;
    const maxZ = Math.max(data[offset + 2], data[offset + 5]) + radius;
    return point[0] > minX && point[0] < maxX
      && point[1] > minY && point[1] < maxY
      && point[2] > minZ && point[2] < maxZ;
  }
  return false;
}

function segmentOverlapsPackedColliderAabb(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  colliders: PackedBodyColliders,
  colliderIndex: number,
  inflationM: number,
): boolean {
  const offset = colliderIndex * BODY_COLLIDER_STRIDE;
  const data = colliders.data;
  const kind = colliders.kinds[colliderIndex];
  let minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number;
  if (kind === BODY_COLLIDER_ELLIPSOID) {
    const rx = data[offset + 3] + inflationM;
    const ry = data[offset + 4] + inflationM;
    const rz = data[offset + 5] + inflationM;
    minX = data[offset] - rx; maxX = data[offset] + rx;
    minY = data[offset + 1] - ry; maxY = data[offset + 1] + ry;
    minZ = data[offset + 2] - rz; maxZ = data[offset + 2] + rz;
  } else if (kind === BODY_COLLIDER_CAPSULE) {
    const radius = data[offset + 6] + inflationM;
    minX = Math.min(data[offset], data[offset + 3]) - radius;
    maxX = Math.max(data[offset], data[offset + 3]) + radius;
    minY = Math.min(data[offset + 1], data[offset + 4]) - radius;
    maxY = Math.max(data[offset + 1], data[offset + 4]) + radius;
    minZ = Math.min(data[offset + 2], data[offset + 5]) - radius;
    maxZ = Math.max(data[offset + 2], data[offset + 5]) + radius;
  } else {
    return false;
  }
  return Math.max(start[0], end[0]) >= minX && Math.min(start[0], end[0]) <= maxX
    && Math.max(start[1], end[1]) >= minY && Math.min(start[1], end[1]) <= maxY
    && Math.max(start[2], end[2]) >= minZ && Math.min(start[2], end[2]) <= maxZ;
}

function buildPackedBodyColliderCache(colliders: PackedBodyColliders): PackedBodyColliderCache {
  const colliderCount = colliders.kinds.length;
  // Float64 preserves the exact arithmetic of the 11.0.1 reference path even
  // though the canonical collider source remains packed as Float32.
  const aabbs = new Float64Array(colliderCount * BODY_COLLIDER_AABB_STRIDE);
  const capsuleAxes = new Float64Array(colliderCount * 4);
  const capsuleFallbackNormals = new Float64Array(colliderCount * 3);
  const ellipsoidInverseRadii = new Float64Array(colliderCount * 3);
  let yMinimum = Number.POSITIVE_INFINITY;
  let yMaximum = Number.NEGATIVE_INFINITY;

  for (let collider = 0; collider < colliderCount; collider += 1) {
    const dataOffset = collider * BODY_COLLIDER_STRIDE;
    const aabbOffset = collider * BODY_COLLIDER_AABB_STRIDE;
    if (colliders.kinds[collider] === BODY_COLLIDER_ELLIPSOID) {
      const centerX = colliders.data[dataOffset];
      const centerY = colliders.data[dataOffset + 1];
      const centerZ = colliders.data[dataOffset + 2];
      const radiusX = colliders.data[dataOffset + 3];
      const radiusY = colliders.data[dataOffset + 4];
      const radiusZ = colliders.data[dataOffset + 5];
      aabbs[aabbOffset] = centerX - radiusX;
      aabbs[aabbOffset + 1] = centerX + radiusX;
      aabbs[aabbOffset + 2] = centerY - radiusY;
      aabbs[aabbOffset + 3] = centerY + radiusY;
      aabbs[aabbOffset + 4] = centerZ - radiusZ;
      aabbs[aabbOffset + 5] = centerZ + radiusZ;
      const inverseOffset = collider * 3;
      ellipsoidInverseRadii[inverseOffset] = 1 / radiusX;
      ellipsoidInverseRadii[inverseOffset + 1] = 1 / radiusY;
      ellipsoidInverseRadii[inverseOffset + 2] = 1 / radiusZ;
    } else {
      const startX = colliders.data[dataOffset];
      const startY = colliders.data[dataOffset + 1];
      const startZ = colliders.data[dataOffset + 2];
      const endX = colliders.data[dataOffset + 3];
      const endY = colliders.data[dataOffset + 4];
      const endZ = colliders.data[dataOffset + 5];
      const radius = colliders.data[dataOffset + 6];
      aabbs[aabbOffset] = Math.min(startX, endX) - radius;
      aabbs[aabbOffset + 1] = Math.max(startX, endX) + radius;
      aabbs[aabbOffset + 2] = Math.min(startY, endY) - radius;
      aabbs[aabbOffset + 3] = Math.max(startY, endY) + radius;
      aabbs[aabbOffset + 4] = Math.min(startZ, endZ) - radius;
      aabbs[aabbOffset + 5] = Math.max(startZ, endZ) + radius;
      const axisX = endX - startX;
      const axisY = endY - startY;
      const axisZ = endZ - startZ;
      const axisLengthSquared = axisX * axisX + axisY * axisY + axisZ * axisZ;
      const axisOffset = collider * 4;
      capsuleAxes[axisOffset] = axisX;
      capsuleAxes[axisOffset + 1] = axisY;
      capsuleAxes[axisOffset + 2] = axisZ;
      capsuleAxes[axisOffset + 3] = axisLengthSquared > EPSILON ? 1 / axisLengthSquared : 0;
      const fallback = deterministicPerpendicular([axisX, axisY, axisZ]);
      const fallbackOffset = collider * 3;
      capsuleFallbackNormals[fallbackOffset] = fallback[0];
      capsuleFallbackNormals[fallbackOffset + 1] = fallback[1];
      capsuleFallbackNormals[fallbackOffset + 2] = fallback[2];
    }
    yMinimum = Math.min(yMinimum, aabbs[aabbOffset + 2]);
    yMaximum = Math.max(yMaximum, aabbs[aabbOffset + 3]);
  }

  if (colliderCount === 0) {
    yMinimum = 0;
    yMaximum = 1;
  }
  const ySpan = Math.max(yMaximum - yMinimum, EPSILON);
  const yBinInverseSize = BODY_BROADPHASE_BIN_COUNT / ySpan;
  const yBinMasks = new Uint32Array(BODY_BROADPHASE_BIN_COUNT);
  const usesBitMask = colliderCount <= 32;
  if (usesBitMask) {
    for (let collider = 0; collider < colliderCount; collider += 1) {
      const aabbOffset = collider * BODY_COLLIDER_AABB_STRIDE;
      const firstBin = broadphaseBin(aabbs[aabbOffset + 2], yMinimum, yBinInverseSize);
      const lastBin = broadphaseBin(aabbs[aabbOffset + 3], yMinimum, yBinInverseSize);
      const colliderBit = (1 << collider) >>> 0;
      for (let bin = firstBin; bin <= lastBin; bin += 1) yBinMasks[bin] = (yBinMasks[bin] | colliderBit) >>> 0;
    }
  }
  const allMask = colliderCount === 32 ? 0xffffffff : colliderCount === 0 ? 0 : ((1 << colliderCount) - 1) >>> 0;
  return {
    aabbs,
    capsuleAxes,
    capsuleFallbackNormals,
    ellipsoidInverseRadii,
    yMinimum,
    yMaximum,
    yBinInverseSize,
    yBinMasks,
    allMask,
    usesBitMask,
  };
}

function createBodyContactScratch(): BodyContactScratch {
  return {
    colliderIndex: -1,
    surfaceX: 0,
    surfaceY: 0,
    surfaceZ: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
    penetrationM: 0,
    swept: false,
    t: 0,
  };
}

function broadphaseBin(y: number, minimum: number, inverseSize: number): number {
  return Math.max(0, Math.min(BODY_BROADPHASE_BIN_COUNT - 1, Math.floor((y - minimum) * inverseSize)));
}

function pointCandidateMask(cache: PackedBodyColliderCache, colliderCount: number, y: number, inflationM: number): number {
  if (colliderCount === 0) return 0;
  const firstBin = broadphaseBin(y - inflationM, cache.yMinimum, cache.yBinInverseSize);
  const lastBin = broadphaseBin(y + inflationM, cache.yMinimum, cache.yBinInverseSize);
  let mask = 0;
  for (let bin = firstBin; bin <= lastBin; bin += 1) mask = (mask | cache.yBinMasks[bin]) >>> 0;
  return mask;
}

function segmentCandidateMask(
  cache: PackedBodyColliderCache,
  colliderCount: number,
  startY: number,
  endY: number,
  inflationM: number,
): number {
  if (colliderCount === 0) return 0;
  const firstBin = broadphaseBin(Math.min(startY, endY) - inflationM, cache.yMinimum, cache.yBinInverseSize);
  const lastBin = broadphaseBin(Math.max(startY, endY) + inflationM, cache.yMinimum, cache.yBinInverseSize);
  let mask = 0;
  for (let bin = firstBin; bin <= lastBin; bin += 1) mask = (mask | cache.yBinMasks[bin]) >>> 0;
  return mask;
}

function refinePointCandidateMask(
  cache: PackedBodyColliderCache,
  initialMask: number,
  x: number,
  y: number,
  z: number,
  inflationM: number,
): number {
  let result = 0;
  let remaining = initialMask >>> 0;
  while (remaining !== 0) {
    const bit = remaining & -remaining;
    const collider = 31 - Math.clz32(bit);
    remaining = (remaining ^ bit) >>> 0;
    const offset = collider * BODY_COLLIDER_AABB_STRIDE;
    if (x > cache.aabbs[offset] - inflationM && x < cache.aabbs[offset + 1] + inflationM
      && y > cache.aabbs[offset + 2] - inflationM && y < cache.aabbs[offset + 3] + inflationM
      && z > cache.aabbs[offset + 4] - inflationM && z < cache.aabbs[offset + 5] + inflationM) {
      result = (result | bit) >>> 0;
    }
  }
  return result;
}

function refineSegmentCandidateMask(
  cache: PackedBodyColliderCache,
  initialMask: number,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
  inflationM: number,
): number {
  let result = 0;
  let remaining = initialMask >>> 0;
  const segmentMinimumX = Math.min(startX, endX);
  const segmentMaximumX = Math.max(startX, endX);
  const segmentMinimumY = Math.min(startY, endY);
  const segmentMaximumY = Math.max(startY, endY);
  const segmentMinimumZ = Math.min(startZ, endZ);
  const segmentMaximumZ = Math.max(startZ, endZ);
  while (remaining !== 0) {
    const bit = remaining & -remaining;
    const collider = 31 - Math.clz32(bit);
    remaining = (remaining ^ bit) >>> 0;
    const offset = collider * BODY_COLLIDER_AABB_STRIDE;
    if (segmentMaximumX >= cache.aabbs[offset] - inflationM && segmentMinimumX <= cache.aabbs[offset + 1] + inflationM
      && segmentMaximumY >= cache.aabbs[offset + 2] - inflationM && segmentMinimumY <= cache.aabbs[offset + 3] + inflationM
      && segmentMaximumZ >= cache.aabbs[offset + 4] - inflationM && segmentMinimumZ <= cache.aabbs[offset + 5] + inflationM) {
      result = (result | bit) >>> 0;
    }
  }
  return result;
}

function countBits(value: number): number {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function copyScratchContact(target: BodyContactScratch, source: BodyContactScratch): void {
  target.colliderIndex = source.colliderIndex;
  target.surfaceX = source.surfaceX;
  target.surfaceY = source.surfaceY;
  target.surfaceZ = source.surfaceZ;
  target.normalX = source.normalX;
  target.normalY = source.normalY;
  target.normalZ = source.normalZ;
  target.penetrationM = source.penetrationM;
  target.swept = source.swept;
  target.t = source.t;
}

function pointCapsuleContactScalar(
  output: BodyContactScratch,
  data: Float32Array,
  cache: PackedBodyColliderCache,
  collider: number,
  pointX: number,
  pointY: number,
  pointZ: number,
  inflationM: number,
): boolean {
  const dataOffset = collider * BODY_COLLIDER_STRIDE;
  const axisOffset = collider * 4;
  const axisX = cache.capsuleAxes[axisOffset];
  const axisY = cache.capsuleAxes[axisOffset + 1];
  const axisZ = cache.capsuleAxes[axisOffset + 2];
  const parameter = cache.capsuleAxes[axisOffset + 3] > 0
    ? clamp(
      ((pointX - data[dataOffset]) * axisX
        + (pointY - data[dataOffset + 1]) * axisY
        + (pointZ - data[dataOffset + 2]) * axisZ) * cache.capsuleAxes[axisOffset + 3],
      0,
      1,
    )
    : 0;
  const centerX = data[dataOffset] + axisX * parameter;
  const centerY = data[dataOffset + 1] + axisY * parameter;
  const centerZ = data[dataOffset + 2] + axisZ * parameter;
  const deltaX = pointX - centerX;
  const deltaY = pointY - centerY;
  const deltaZ = pointZ - centerZ;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
  const radius = data[dataOffset + 6] + inflationM;
  if (distanceSquared >= radius * radius) return false;
  const distance = Math.sqrt(distanceSquared);
  let normalX: number;
  let normalY: number;
  let normalZ: number;
  if (distance > EPSILON) {
    const inverseDistance = 1 / distance;
    normalX = deltaX * inverseDistance;
    normalY = deltaY * inverseDistance;
    normalZ = deltaZ * inverseDistance;
  } else {
    const fallbackOffset = collider * 3;
    normalX = cache.capsuleFallbackNormals[fallbackOffset];
    normalY = cache.capsuleFallbackNormals[fallbackOffset + 1];
    normalZ = cache.capsuleFallbackNormals[fallbackOffset + 2];
  }
  output.colliderIndex = collider;
  output.surfaceX = centerX + normalX * radius;
  output.surfaceY = centerY + normalY * radius;
  output.surfaceZ = centerZ + normalZ * radius;
  output.normalX = normalX;
  output.normalY = normalY;
  output.normalZ = normalZ;
  output.penetrationM = radius - distance;
  output.swept = false;
  output.t = 0;
  return true;
}

function pointEllipsoidContactScalar(
  output: BodyContactScratch,
  data: Float32Array,
  collider: number,
  pointX: number,
  pointY: number,
  pointZ: number,
  inflationM: number,
): boolean {
  const offset = collider * BODY_COLLIDER_STRIDE;
  const centerX = data[offset];
  const centerY = data[offset + 1];
  const centerZ = data[offset + 2];
  const radiusX = data[offset + 3] + inflationM;
  const radiusY = data[offset + 4] + inflationM;
  const radiusZ = data[offset + 5] + inflationM;
  const deltaX = pointX - centerX;
  const deltaY = pointY - centerY;
  const deltaZ = pointZ - centerZ;
  const normalizedX = deltaX / radiusX;
  const normalizedY = deltaY / radiusY;
  const normalizedZ = deltaZ / radiusZ;
  const normalizedRadiusSquared = normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ;
  if (normalizedRadiusSquared >= 1) return false;

  let surfaceX: number;
  let surfaceY: number;
  let surfaceZ: number;
  let normalX: number;
  let normalY: number;
  let normalZ: number;
  if (normalizedRadiusSquared <= EPSILON * EPSILON) {
    const axis = radiusX <= radiusY && radiusX <= radiusZ ? 0 : radiusY <= radiusZ ? 1 : 2;
    surfaceX = centerX + (axis === 0 ? radiusX : 0);
    surfaceY = centerY + (axis === 1 ? radiusY : 0);
    surfaceZ = centerZ + (axis === 2 ? radiusZ : 0);
    normalX = axis === 0 ? 1 : 0;
    normalY = axis === 1 ? 1 : 0;
    normalZ = axis === 2 ? 1 : 0;
  } else {
    const inverseNormalizedRadius = 1 / Math.sqrt(normalizedRadiusSquared);
    surfaceX = centerX + deltaX * inverseNormalizedRadius;
    surfaceY = centerY + deltaY * inverseNormalizedRadius;
    surfaceZ = centerZ + deltaZ * inverseNormalizedRadius;
    let gradientX = (surfaceX - centerX) / (radiusX * radiusX);
    let gradientY = (surfaceY - centerY) / (radiusY * radiusY);
    let gradientZ = (surfaceZ - centerZ) / (radiusZ * radiusZ);
    const gradientLength = Math.sqrt(gradientX * gradientX + gradientY * gradientY + gradientZ * gradientZ);
    if (gradientLength > EPSILON && Number.isFinite(gradientLength)) {
      const inverseGradientLength = 1 / gradientLength;
      gradientX *= inverseGradientLength;
      gradientY *= inverseGradientLength;
      gradientZ *= inverseGradientLength;
    } else {
      gradientX = 1;
      gradientY = 0;
      gradientZ = 0;
    }
    normalX = gradientX;
    normalY = gradientY;
    normalZ = gradientZ;
  }
  const correctionX = surfaceX - pointX;
  const correctionY = surfaceY - pointY;
  const correctionZ = surfaceZ - pointZ;
  output.colliderIndex = collider;
  output.surfaceX = surfaceX;
  output.surfaceY = surfaceY;
  output.surfaceZ = surfaceZ;
  output.normalX = normalX;
  output.normalY = normalY;
  output.normalZ = normalZ;
  output.penetrationM = Math.sqrt(correctionX * correctionX + correctionY * correctionY + correctionZ * correctionZ);
  output.swept = false;
  output.t = 0;
  return true;
}

function sweptEllipsoidContactScalar(
  output: BodyContactScratch,
  data: Float32Array,
  collider: number,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
  inflationM: number,
): boolean {
  const offset = collider * BODY_COLLIDER_STRIDE;
  const centerX = data[offset];
  const centerY = data[offset + 1];
  const centerZ = data[offset + 2];
  const radiusX = data[offset + 3] + inflationM;
  const radiusY = data[offset + 4] + inflationM;
  const radiusZ = data[offset + 5] + inflationM;
  const motionX = endX - startX;
  const motionY = endY - startY;
  const motionZ = endZ - startZ;
  const scaledStartX = (startX - centerX) / radiusX;
  const scaledStartY = (startY - centerY) / radiusY;
  const scaledStartZ = (startZ - centerZ) / radiusZ;
  const scaledMotionX = motionX / radiusX;
  const scaledMotionY = motionY / radiusY;
  const scaledMotionZ = motionZ / radiusZ;
  const a = scaledMotionX * scaledMotionX + scaledMotionY * scaledMotionY + scaledMotionZ * scaledMotionZ;
  const b = 2 * (scaledStartX * scaledMotionX + scaledStartY * scaledMotionY + scaledStartZ * scaledMotionZ);
  const c = scaledStartX * scaledStartX + scaledStartY * scaledStartY + scaledStartZ * scaledStartZ - 1;
  if (a <= EPSILON || c <= 0) return false;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (t < 0 || t > 1) return false;
  const hitX = startX + motionX * t;
  const hitY = startY + motionY * t;
  const hitZ = startZ + motionZ * t;
  let normalX = (hitX - centerX) / (radiusX * radiusX);
  let normalY = (hitY - centerY) / (radiusY * radiusY);
  let normalZ = (hitZ - centerZ) / (radiusZ * radiusZ);
  const normalLength = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
  if (normalLength > EPSILON && Number.isFinite(normalLength)) {
    const inverseNormalLength = 1 / normalLength;
    normalX *= inverseNormalLength;
    normalY *= inverseNormalLength;
    normalZ *= inverseNormalLength;
  } else {
    normalX = 1;
    normalY = 0;
    normalZ = 0;
  }
  output.colliderIndex = collider;
  output.surfaceX = hitX + normalX * 1e-6;
  output.surfaceY = hitY + normalY * 1e-6;
  output.surfaceZ = hitZ + normalZ * 1e-6;
  output.normalX = normalX;
  output.normalY = normalY;
  output.normalZ = normalZ;
  output.penetrationM = 0;
  output.swept = true;
  output.t = t;
  return true;
}

function sweptCapsuleContactScalar(
  output: BodyContactScratch,
  data: Float32Array,
  cache: PackedBodyColliderCache,
  collider: number,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
  inflationM: number,
): boolean {
  const offset = collider * BODY_COLLIDER_STRIDE;
  const axisOffset = collider * 4;
  const motionX = endX - startX;
  const motionY = endY - startY;
  const motionZ = endZ - startZ;
  const axisX = cache.capsuleAxes[axisOffset];
  const axisY = cache.capsuleAxes[axisOffset + 1];
  const axisZ = cache.capsuleAxes[axisOffset + 2];
  const relativeX = startX - data[offset];
  const relativeY = startY - data[offset + 1];
  const relativeZ = startZ - data[offset + 2];
  const aa = motionX * motionX + motionY * motionY + motionZ * motionZ;
  const bb = motionX * axisX + motionY * axisY + motionZ * axisZ;
  const cc = axisX * axisX + axisY * axisY + axisZ * axisZ;
  const dd = motionX * relativeX + motionY * relativeY + motionZ * relativeZ;
  const ee = axisX * relativeX + axisY * relativeY + axisZ * relativeZ;
  const denominator = aa * cc - bb * bb;
  let motionParameter = denominator > EPSILON ? clamp((bb * ee - cc * dd) / denominator, 0, 1) : 0;
  let axisParameter = cc > EPSILON ? clamp((bb * motionParameter + ee) / cc, 0, 1) : 0;
  if (aa > EPSILON) motionParameter = clamp((bb * axisParameter - dd) / aa, 0, 1);
  if (cc > EPSILON) axisParameter = clamp((bb * motionParameter + ee) / cc, 0, 1);
  const hitX = startX + motionX * motionParameter;
  const hitY = startY + motionY * motionParameter;
  const hitZ = startZ + motionZ * motionParameter;
  const axisPointX = data[offset] + axisX * axisParameter;
  const axisPointY = data[offset + 1] + axisY * axisParameter;
  const axisPointZ = data[offset + 2] + axisZ * axisParameter;
  const deltaX = hitX - axisPointX;
  const deltaY = hitY - axisPointY;
  const deltaZ = hitZ - axisPointZ;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
  const radius = data[offset + 6] + inflationM;
  if (distanceSquared > radius * radius) return false;
  const distance = Math.sqrt(distanceSquared);
  let normalX: number;
  let normalY: number;
  let normalZ: number;
  if (distance > EPSILON) {
    const inverseDistance = 1 / distance;
    normalX = deltaX * inverseDistance;
    normalY = deltaY * inverseDistance;
    normalZ = deltaZ * inverseDistance;
  } else {
    const fallbackOffset = collider * 3;
    normalX = cache.capsuleFallbackNormals[fallbackOffset];
    normalY = cache.capsuleFallbackNormals[fallbackOffset + 1];
    normalZ = cache.capsuleFallbackNormals[fallbackOffset + 2];
  }
  output.colliderIndex = collider;
  output.surfaceX = axisPointX + normalX * (radius + 1e-6);
  output.surfaceY = axisPointY + normalY * (radius + 1e-6);
  output.surfaceZ = axisPointZ + normalZ * (radius + 1e-6);
  output.normalX = normalX;
  output.normalY = normalY;
  output.normalZ = normalZ;
  output.penetrationM = 0;
  output.swept = true;
  output.t = motionParameter;
  return true;
}

export const IDENTITY_BODY_TRANSFORM: SimulationBodyTransform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
};

export function transformAvatarCollisionProxy(proxy: AvatarCollisionProxy, transform: SimulationBodyTransform): AvatarCollisionProxy {
  if (proxy.kind === "ellipsoid") return { ...proxy, center: transformPoint(proxy.center, transform) };
  return { ...proxy, start: transformPoint(proxy.start, transform), end: transformPoint(proxy.end, transform) };
}

export function transformPoint(point: readonly [number, number, number], transform: SimulationBodyTransform): [number, number, number] {
  const rotated = rotateByQuaternion(point, transform.rotation);
  return [rotated[0] + transform.translation[0], rotated[1] + transform.translation[1], rotated[2] + transform.translation[2]];
}

function rotateByQuaternion(point: readonly [number, number, number], q: readonly [number, number, number, number]): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const ix = qw * point[0] + qy * point[2] - qz * point[1];
  const iy = qw * point[1] + qz * point[0] - qx * point[2];
  const iz = qw * point[2] + qx * point[1] - qy * point[0];
  const iw = -qx * point[0] - qy * point[1] - qz * point[2];
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

function closestSegmentParameters(a0: readonly number[], a1: readonly number[], b0: readonly number[], b1: readonly number[]) {
  const u = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
  const v = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]];
  const w = [a0[0] - b0[0], a0[1] - b0[1], a0[2] - b0[2]];
  const aa = dot3(u, u), bb = dot3(u, v), cc = dot3(v, v), dd = dot3(u, w), ee = dot3(v, w);
  const denom = aa * cc - bb * bb;
  let s = denom > EPSILON ? clamp((bb * ee - cc * dd) / denom, 0, 1) : 0;
  let t = cc > EPSILON ? clamp((bb * s + ee) / cc, 0, 1) : 0;
  if (aa > EPSILON) s = clamp((bb * t - dd) / aa, 0, 1);
  if (cc > EPSILON) t = clamp((bb * s + ee) / cc, 0, 1);
  const pa = [a0[0] + u[0] * s, a0[1] + u[1] * s, a0[2] + u[2] * s];
  const pb = [b0[0] + v[0] * t, b0[1] + v[1] * t, b0[2] + v[2] * t];
  return { a: s, b: t, distanceM: Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) };
}

function deterministicPerpendicular(axis: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(...axis);
  if (length <= EPSILON) return [1, 0, 0];
  const normalized = scale3(axis, 1 / length);
  const reference: [number, number, number] = Math.abs(normalized[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  return normalize3([
    normalized[1] * reference[2] - normalized[2] * reference[1],
    normalized[2] * reference[0] - normalized[0] * reference[2],
    normalized[0] * reference[1] - normalized[1] * reference[0],
  ], [0, 0, 1]);
}

function validateRadii(radii: readonly number[]): void {
  if (radii.length !== 3 || radii.some((radius) => !Number.isFinite(radius) || radius <= 0)) throw new RangeError("Ellipsoid radii inválidos.");
}
function smallestRadiusAxis(radii: readonly number[]): number { return radii[0] <= radii[1] && radii[0] <= radii[2] ? 0 : radii[1] <= radii[2] ? 1 : 2; }
function dot3(a: readonly number[], b: readonly number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function scale3(a: readonly [number, number, number], scale: number): [number, number, number] { return [a[0] * scale, a[1] * scale, a[2] * scale]; }
function add3(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function normalize3(a: readonly [number, number, number], fallback: readonly [number, number, number]): [number, number, number] { const length = Math.hypot(...a); return length > EPSILON && Number.isFinite(length) ? [a[0] / length, a[1] / length, a[2] / length] : [...fallback] as [number, number, number]; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
