import type { AvatarCollisionModel, AvatarCollisionProxy } from "../avatar/AvatarCollisionModel";

export const BODY_COLLIDER_ELLIPSOID = 1;
export const BODY_COLLIDER_CAPSULE = 2;
export const BODY_COLLIDER_STRIDE = 10;
export const DEFAULT_BODY_CONTACT_SKIN_M = 0.0004;
const EPSILON = 1e-9;

export interface SimulationBodyTransform {
  translation: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export interface PackedBodyColliders {
  kinds: Uint8Array;
  data: Float32Array;
  regions: string[];
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
  contactMask: Uint8Array;
  contactRegionIndex: Int16Array;
  normalImpulseSpeed: Float32Array;
  contactSkinM: number;
  bodyContactCount: number;
  frictionContactCount: number;
  sweptContactCount: number;
  maximumBodyPenetrationM: number;
  maximumBodyCorrectionM: number;
  bodyContactsByRegion: Record<string, number>;
}

export interface BodyCollisionSolveInput {
  predictedPositions: Float32Array;
  previousPositions: Float32Array;
  inverseMasses: Float32Array;
  correctionLimits: Float32Array;
  maximumCorrectionM: number;
  fixedTimeStep: number;
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
  validatePackedBodyColliders({ kinds, data, regions });
  return { kinds, data, regions };
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
    contactMask: new Uint8Array(particleHalfThicknessM.length),
    contactRegionIndex: new Int16Array(particleHalfThicknessM.length).fill(-1),
    normalImpulseSpeed: new Float32Array(particleHalfThicknessM.length),
    contactSkinM,
    bodyContactCount: 0,
    frictionContactCount: 0,
    sweptContactCount: 0,
    maximumBodyPenetrationM: 0,
    maximumBodyCorrectionM: 0,
    bodyContactsByRegion: {},
  };
}

export function resetBodyContactStep(body: BodyCollisionRuntimeState): void {
  body.contactNormals.fill(0);
  body.contactMask.fill(0);
  body.contactRegionIndex.fill(-1);
  body.normalImpulseSpeed.fill(0);
  body.bodyContactCount = 0;
  body.frictionContactCount = 0;
  body.sweptContactCount = 0;
  body.maximumBodyPenetrationM = 0;
  body.maximumBodyCorrectionM = 0;
  body.bodyContactsByRegion = {};
}

export function solveBodyCollisions(input: BodyCollisionSolveInput): void {
  const { body } = input;
  if (!body.enabled || body.colliders.kinds.length === 0) return;
  const particleCount = input.predictedPositions.length / 3;
  if (body.particleHalfThicknessM.length !== particleCount || body.particleFriction.length !== particleCount) {
    throw new RangeError("Body collision particle buffers não correspondem ao garment state.");
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
    const radius = body.particleHalfThicknessM[particle] + body.contactSkinM;
    let contact = deepestBodyContact(point, body.colliders, radius);
    if (!contact && input.allowSwept) contact = earliestSweptBodyContact(previous, point, body.colliders, radius);
    if (!contact) continue;

    body.maximumBodyPenetrationM = Math.max(body.maximumBodyPenetrationM, contact.penetrationM);
    let correctionX = contact.surfacePoint[0] - point[0];
    let correctionY = contact.surfacePoint[1] - point[1];
    let correctionZ = contact.surfacePoint[2] - point[2];
    let correction = Math.hypot(correctionX, correctionY, correctionZ);
    if (!contact.swept) {
      const limit = Math.max(1e-6, Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM));
      if (correction > limit) {
        const scale = limit / correction;
        correctionX *= scale;
        correctionY *= scale;
        correctionZ *= scale;
        correction = limit;
      }
    } else {
      const maximumSweepCorrection = Math.max(input.maximumCorrectionM, 12 * input.fixedTimeStep);
      if (correction > maximumSweepCorrection) {
        const scale = maximumSweepCorrection / correction;
        correctionX *= scale;
        correctionY *= scale;
        correctionZ *= scale;
        correction = maximumSweepCorrection;
      }
      body.sweptContactCount += 1;
    }

    input.predictedPositions[offset] += correctionX;
    input.predictedPositions[offset + 1] += correctionY;
    input.predictedPositions[offset + 2] += correctionZ;
    body.maximumBodyCorrectionM = Math.max(body.maximumBodyCorrectionM, correction);
    body.contactMask[particle] = 1;
    body.contactRegionIndex[particle] = contact.colliderIndex;
    body.contactNormals[offset] = contact.normal[0];
    body.contactNormals[offset + 1] = contact.normal[1];
    body.contactNormals[offset + 2] = contact.normal[2];
    body.normalImpulseSpeed[particle] = Math.max(body.normalImpulseSpeed[particle], correction / Math.max(input.fixedTimeStep, EPSILON));
  }
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

export function applyBodyContactVelocities(velocities: Float32Array, body: BodyCollisionRuntimeState): void {
  body.frictionContactCount = 0;
  for (let particle = 0; particle < body.contactMask.length; particle += 1) {
    if (!body.contactMask[particle]) continue;
    const offset = particle * 3;
    const friction = body.particleFriction[particle];
    const next = applyBodyContactVelocity(
      [velocities[offset], velocities[offset + 1], velocities[offset + 2]],
      [body.contactNormals[offset], body.contactNormals[offset + 1], body.contactNormals[offset + 2]],
      friction,
      body.normalImpulseSpeed[particle],
    );
    velocities[offset] = next[0];
    velocities[offset + 1] = next[1];
    velocities[offset + 2] = next[2];
    if (friction > 0 && body.normalImpulseSpeed[particle] > 0) body.frictionContactCount += 1;
  }
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
