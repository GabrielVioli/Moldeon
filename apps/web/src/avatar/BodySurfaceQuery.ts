import * as THREE from "three";
import type { HumanBodyMesh, HumanBodyVector3 } from "./HumanBodyModel";
import type { PanelSurfaceAttachmentV3 } from "../domain/patternDocumentV3.types";

export interface BodySurfaceFrame {
  attachment: PanelSurfaceAttachmentV3;
  position: HumanBodyVector3;
  outwardNormal: HumanBodyVector3;
  tangent: HumanBodyVector3;
  axis: HumanBodyVector3;
}

interface BodyBvhNode {
  box: THREE.Box3;
  left?: BodyBvhNode;
  right?: BodyBvhNode;
  triangles?: Uint32Array;
}

interface QueryRuntime {
  root: BodyBvhNode;
  triangleBounds: Float32Array;
  triangleCentroids: Float32Array;
}

interface SurfaceHit {
  triangleIndex: number;
  point: THREE.Vector3;
  distance: number;
}

const runtimes = new WeakMap<HumanBodyMesh, QueryRuntime>();
const windingSigns = new WeakMap<HumanBodyMesh, -1 | 0 | 1>();
const BVH_LEAF_TRIANGLES = 12;

/** Build the immutable surface accelerator before an interaction starts. */
export function prepareBodySurfaceQuery(body: HumanBodyMesh): void {
  runtimeFor(body);
  bodyWindingSign(body);
}

/**
 * Continuous ray query against the exact visual body used by the viewport.
 * The BVH is built once per HumanBodyMesh and reused for every pointer move.
 */
export function raycastBodySurface(
  body: HumanBodyMesh,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  normalOffsetMm = 12,
  maxDistanceM = Number.POSITIVE_INFINITY,
): BodySurfaceFrame | null {
  const runtime = runtimeFor(body);
  const rayDirection = new THREE.Vector3(...direction);
  if (rayDirection.lengthSq() <= 1e-16) return null;
  const ray = new THREE.Ray(new THREE.Vector3(...origin), rayDirection.normalize());
  const hit = raycastNode(body, runtime.root, ray, maxDistanceM, null);
  return hit ? frameFromHit(body, hit.triangleIndex, hit.point, normalOffsetMm) : null;
}

/** Nearest-point query used by the kinematic body barrier. */
export function closestBodySurfacePoint(
  body: HumanBodyMesh,
  point: readonly [number, number, number],
  normalOffsetMm = 0,
  maxDistanceM = Number.POSITIVE_INFINITY,
): BodySurfaceFrame | null {
  const runtime = runtimeFor(body);
  const query = new THREE.Vector3(...point);
  const nearest = closestPointNode(body, runtime.root, query, maxDistanceM * maxDistanceM, null);
  return nearest ? frameFromHit(body, nearest.triangleIndex, nearest.point, normalOffsetMm) : null;
}

export function resolveBodySurfaceAttachment(
  body: HumanBodyMesh,
  attachment: PanelSurfaceAttachmentV3,
): BodySurfaceFrame | null {
  if (attachment.topologySignature !== body.topologySignature) return null;
  if (attachment.triangleIndex < 0 || attachment.triangleIndex * 3 + 2 >= body.indices.length) return null;
  const triangle = triangleFor(body, attachment.triangleIndex);
  const [u, v, w] = attachment.barycentric;
  const surfacePoint = triangle.a.clone().multiplyScalar(u)
    .addScaledVector(triangle.b, v)
    .addScaledVector(triangle.c, w);
  const normal = orientOutwardNormal(
    body,
    attachment.triangleIndex,
    surfacePoint,
    interpolatedNormal(body, attachment.triangleIndex, attachment.barycentric),
  );
  const tangent = triangle.b.clone().sub(triangle.a);
  tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
  const safeTangent = tangent.lengthSq() > 1e-12 ? tangent : orthogonalTangent(normal);
  const axis = new THREE.Vector3().crossVectors(normal, safeTangent).normalize();
  const position = surfacePoint.clone().addScaledVector(normal, attachment.normalOffsetMm * 0.001);
  return {
    attachment: cloneAttachment(attachment),
    position: tuple(position),
    outwardNormal: tuple(normal),
    tangent: tuple(safeTangent),
    axis: tuple(axis),
  };
}

function frameFromHit(
  body: HumanBodyMesh,
  triangleIndex: number,
  point: THREE.Vector3,
  normalOffsetMm: number,
): BodySurfaceFrame | null {
  const triangle = triangleFor(body, triangleIndex);
  const barycentric = THREE.Triangle.getBarycoord(point, triangle.a, triangle.b, triangle.c, new THREE.Vector3());
  if (!barycentric) return null;
  return resolveBodySurfaceAttachment(body, {
    version: 1,
    topologySignature: body.topologySignature,
    triangleIndex,
    barycentric: [barycentric.x, barycentric.y, barycentric.z],
    normalOffsetMm,
  });
}

function runtimeFor(body: HumanBodyMesh): QueryRuntime {
  const cached = runtimes.get(body);
  if (cached) return cached;
  const triangleCount = Math.floor(body.indices.length / 3);
  const triangleBounds = new Float32Array(triangleCount * 6);
  const triangleCentroids = new Float32Array(triangleCount * 3);
  const triangleIds = Array.from({ length: triangleCount }, (_, index) => index);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    readTriangle(body, triangleIndex, a, b, c);
    const offset = triangleIndex * 6;
    triangleBounds[offset] = Math.min(a.x, b.x, c.x);
    triangleBounds[offset + 1] = Math.min(a.y, b.y, c.y);
    triangleBounds[offset + 2] = Math.min(a.z, b.z, c.z);
    triangleBounds[offset + 3] = Math.max(a.x, b.x, c.x);
    triangleBounds[offset + 4] = Math.max(a.y, b.y, c.y);
    triangleBounds[offset + 5] = Math.max(a.z, b.z, c.z);
    const centroidOffset = triangleIndex * 3;
    triangleCentroids[centroidOffset] = (a.x + b.x + c.x) / 3;
    triangleCentroids[centroidOffset + 1] = (a.y + b.y + c.y) / 3;
    triangleCentroids[centroidOffset + 2] = (a.z + b.z + c.z) / 3;
  }

  const runtime = {
    root: buildBvhNode(triangleIds, triangleBounds, triangleCentroids),
    triangleBounds,
    triangleCentroids,
  };
  runtimes.set(body, runtime);
  return runtime;
}

function buildBvhNode(
  ids: number[],
  triangleBounds: Float32Array,
  triangleCentroids: Float32Array,
): BodyBvhNode {
  const box = new THREE.Box3();
  box.makeEmpty();
  const centroidMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const centroidMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const id of ids) {
    const offset = id * 6;
    box.min.x = Math.min(box.min.x, triangleBounds[offset]);
    box.min.y = Math.min(box.min.y, triangleBounds[offset + 1]);
    box.min.z = Math.min(box.min.z, triangleBounds[offset + 2]);
    box.max.x = Math.max(box.max.x, triangleBounds[offset + 3]);
    box.max.y = Math.max(box.max.y, triangleBounds[offset + 4]);
    box.max.z = Math.max(box.max.z, triangleBounds[offset + 5]);
    const centroidOffset = id * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = triangleCentroids[centroidOffset + axis];
      centroidMin[axis] = Math.min(centroidMin[axis], value);
      centroidMax[axis] = Math.max(centroidMax[axis], value);
    }
  }
  if (ids.length <= BVH_LEAF_TRIANGLES) return { box, triangles: Uint32Array.from(ids) };

  let splitAxis = 0;
  let splitExtent = centroidMax[0] - centroidMin[0];
  for (let axis = 1; axis < 3; axis += 1) {
    const extent = centroidMax[axis] - centroidMin[axis];
    if (extent > splitExtent) {
      splitExtent = extent;
      splitAxis = axis;
    }
  }
  if (splitExtent <= 1e-10) return { box, triangles: Uint32Array.from(ids) };
  ids.sort((left, right) => triangleCentroids[left * 3 + splitAxis] - triangleCentroids[right * 3 + splitAxis]);
  const midpoint = Math.floor(ids.length / 2);
  return {
    box,
    left: buildBvhNode(ids.slice(0, midpoint), triangleBounds, triangleCentroids),
    right: buildBvhNode(ids.slice(midpoint), triangleBounds, triangleCentroids),
  };
}

function raycastNode(
  body: HumanBodyMesh,
  node: BodyBvhNode,
  ray: THREE.Ray,
  maxDistanceM: number,
  best: SurfaceHit | null,
): SurfaceHit | null {
  const entryDistance = boxEntryDistance(ray, node.box);
  const limit = Math.min(maxDistanceM, best?.distance ?? Number.POSITIVE_INFINITY);
  if (entryDistance === null || entryDistance > limit) return best;

  if (node.triangles) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const hitPoint = new THREE.Vector3();
    let current = best;
    for (const triangleIndex of node.triangles) {
      readTriangle(body, triangleIndex, a, b, c);
      const hit = ray.intersectTriangle(a, b, c, false, hitPoint);
      if (!hit) continue;
      const distance = hit.distanceTo(ray.origin);
      if (distance > maxDistanceM || (current && distance >= current.distance)) continue;
      current = { triangleIndex, point: hit.clone(), distance };
    }
    return current;
  }

  const children = [node.left, node.right].filter((child): child is BodyBvhNode => Boolean(child));
  children.sort((left, right) => (boxEntryDistance(ray, left.box) ?? Number.POSITIVE_INFINITY)
    - (boxEntryDistance(ray, right.box) ?? Number.POSITIVE_INFINITY));
  let current = best;
  for (const child of children) current = raycastNode(body, child, ray, maxDistanceM, current);
  return current;
}

function closestPointNode(
  body: HumanBodyMesh,
  node: BodyBvhNode,
  point: THREE.Vector3,
  maxDistanceSq: number,
  best: SurfaceHit | null,
): SurfaceHit | null {
  const boxDistance = node.box.distanceToPoint(point);
  const limitSq = Math.min(maxDistanceSq, best ? best.distance * best.distance : Number.POSITIVE_INFINITY);
  if (boxDistance * boxDistance > limitSq) return best;

  if (node.triangles) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const triangle = new THREE.Triangle();
    const nearestPoint = new THREE.Vector3();
    let current = best;
    for (const triangleIndex of node.triangles) {
      readTriangle(body, triangleIndex, a, b, c);
      triangle.set(a, b, c).closestPointToPoint(point, nearestPoint);
      const distanceSq = nearestPoint.distanceToSquared(point);
      if (distanceSq > maxDistanceSq || (current && distanceSq >= current.distance * current.distance)) continue;
      current = { triangleIndex, point: nearestPoint.clone(), distance: Math.sqrt(distanceSq) };
    }
    return current;
  }

  const children = [node.left, node.right].filter((child): child is BodyBvhNode => Boolean(child));
  children.sort((left, right) => left.box.distanceToPoint(point) - right.box.distanceToPoint(point));
  let current = best;
  for (const child of children) current = closestPointNode(body, child, point, maxDistanceSq, current);
  return current;
}

function boxEntryDistance(ray: THREE.Ray, box: THREE.Box3): number | null {
  if (box.containsPoint(ray.origin)) return 0;
  const hit = ray.intersectBox(box, new THREE.Vector3());
  return hit ? hit.distanceTo(ray.origin) : null;
}

function triangleFor(body: HumanBodyMesh, triangleIndex: number): THREE.Triangle {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  readTriangle(body, triangleIndex, a, b, c);
  return new THREE.Triangle(a, b, c);
}

function readTriangle(
  body: HumanBodyMesh,
  triangleIndex: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): void {
  const offset = triangleIndex * 3;
  readVertex(body.positions, body.indices[offset], a);
  readVertex(body.positions, body.indices[offset + 1], b);
  readVertex(body.positions, body.indices[offset + 2], c);
}

function interpolatedNormal(
  body: HumanBodyMesh,
  triangleIndex: number,
  barycentric: readonly [number, number, number],
): THREE.Vector3 {
  const offset = triangleIndex * 3;
  const result = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let corner = 0; corner < 3; corner += 1) {
    const index = body.indices[offset + corner];
    readVertex(body.normals, index, normal);
    result.addScaledVector(normal, barycentric[corner]);
  }
  if (result.lengthSq() <= 1e-12) return triangleFor(body, triangleIndex).getNormal(result);
  return result.normalize();
}

function orientOutwardNormal(
  body: HumanBodyMesh,
  triangleIndex: number,
  surfacePoint: THREE.Vector3,
  normalValue: THREE.Vector3,
): THREE.Vector3 {
  const normal = normalValue.clone().normalize();
  const windingSign = bodyWindingSign(body);
  if (windingSign !== 0) {
    const outwardFace = triangleFor(body, triangleIndex).getNormal(new THREE.Vector3());
    if (windingSign < 0) outwardFace.negate();
    if (normal.dot(outwardFace) < 0) normal.negate();
    return normal;
  }

  const boundsCenter = new THREE.Vector3(
    (body.bounds.min[0] + body.bounds.max[0]) * 0.5,
    (body.bounds.min[1] + body.bounds.max[1]) * 0.5,
    (body.bounds.min[2] + body.bounds.max[2]) * 0.5,
  );
  const radial = surfacePoint.clone().sub(boundsCenter);
  if (radial.lengthSq() > 1e-12 && normal.dot(radial) < 0) normal.negate();
  return normal;
}

function bodyWindingSign(body: HumanBodyMesh): -1 | 0 | 1 {
  const cached = windingSigns.get(body);
  if (cached !== undefined) return cached;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let sixVolume = 0;
  for (let offset = 0; offset + 2 < body.indices.length; offset += 3) {
    readVertex(body.positions, body.indices[offset], a);
    readVertex(body.positions, body.indices[offset + 1], b);
    readVertex(body.positions, body.indices[offset + 2], c);
    cross.crossVectors(b, c);
    sixVolume += a.dot(cross);
  }
  const sign: -1 | 0 | 1 = Math.abs(sixVolume) <= 1e-8 ? 0 : sixVolume > 0 ? 1 : -1;
  windingSigns.set(body, sign);
  return sign;
}

function orthogonalTangent(normal: THREE.Vector3): THREE.Vector3 {
  const seed = Math.abs(normal.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  return seed.addScaledVector(normal, -seed.dot(normal)).normalize();
}

function readVertex(values: Float32Array, index: number, target: THREE.Vector3): THREE.Vector3 {
  return target.set(values[index * 3], values[index * 3 + 1], values[index * 3 + 2]);
}

function cloneAttachment(attachment: PanelSurfaceAttachmentV3): PanelSurfaceAttachmentV3 {
  return {
    ...attachment,
    barycentric: [...attachment.barycentric] as [number, number, number],
  };
}

function tuple(value: THREE.Vector3): HumanBodyVector3 {
  return [value.x, value.y, value.z];
}
