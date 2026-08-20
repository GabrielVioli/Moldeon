import type { AvatarCollisionModel, AvatarCollisionProxy } from "../avatar/AvatarCollisionModel";

export const BODY_COLLIDER_ELLIPSOID = 1;
export const BODY_COLLIDER_CAPSULE = 2;
export const BODY_COLLIDER_STRIDE = 10;
export const BODY_COLLIDER_AABB_STRIDE = 6;
export const DEFAULT_BODY_CONTACT_SKIN_M = 0.0004;
const EPSILON = 1e-9;
const BODY_BROADPHASE_BIN_COUNT = 32;

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

export interface BodyCollisionRuntimeState {
  enabled: boolean;
  colliders: PackedBodyColliders;
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
): BodyCollisionRuntimeState {
  validatePackedBodyColliders(colliders);
  colliders.cache ??= buildPackedBodyColliderCache(colliders);
  if (particleHalfThicknessM.length !== particleFriction.length) throw new RangeError("Body contact material buffers possuem tamanhos incompatíveis.");
  if (!Number.isFinite(contactSkinM) || contactSkinM < 0 || contactSkinM > 0.01) throw new RangeError("Body contact skin precisa ser finita e pequena.");
  for (let index = 0; index < particleHalfThicknessM.length; index += 1) {
    if (!Number.isFinite(particleHalfThicknessM[index]) || particleHalfThicknessM[index] < 0) throw new RangeError("Espessura de contato inválida.");
    if (!Number.isFinite(particleFriction[index]) || particleFriction[index] < 0) throw new RangeError("Atrito de contato inválido.");
  }
  return {
    enabled,
    colliders,
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
  };
}

export function initializeBodyDressing(
  body: BodyCollisionRuntimeState,
  positions: Float32Array,
  maximumCorrectionM: number,
): void {
  body.dressingStepsRemaining = 0;
  body.initialDressingSteps = 0;
  body.grossDepenetrationEnabled = false;
  if (!body.enabled || body.colliders.kinds.length === 0 || !Number.isFinite(maximumCorrectionM) || maximumCorrectionM <= 0) return;

  let maximumPenetrationM = 0;
  const particleCount = positions.length / 3;
  for (let particle = 0; particle < particleCount; particle += 1) {
    const offset = particle * 3;
    const contact = deepestBodyContact(
      [positions[offset], positions[offset + 1], positions[offset + 2]],
      body.colliders,
      body.particleHalfThicknessM[particle] + body.contactSkinM,
    );
    if (contact) maximumPenetrationM = Math.max(maximumPenetrationM, contact.penetrationM);
  }
  if (maximumPenetrationM <= EPSILON) return;

  // Each gross projection is capped by maximumCorrectionM. Two passes per
  // theoretical minimum leave room for structural constraints to relax between
  // depenetrations without a garment-specific staging duration.
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
}

export function solveBodyCollisions(input: BodyCollisionSolveInput): void {
  const { body } = input;
  if (!body.enabled || body.colliders.kinds.length === 0) return;
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
    const region = colliderIndex >= 0 ? body.colliders.regions[colliderIndex] ?? "unknown" : "unknown";
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
