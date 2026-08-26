import type { HumanBodyMesh } from "../avatar/HumanBodyModel";

const EPSILON = 1e-10;
const LEAF_TRIANGLE_COUNT = 8;
const RAY_DIRECTION: Vec3 = normalize([1, 0.37139067, 0.23911762]);

type Vec3 = [number, number, number];

/** Plain transferable body surface. Three.js objects never cross the Worker boundary. */
export interface PackedBodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  topologySignature: string;
}

export interface PackedBodyMeshValidation {
  vertexCount: number;
  triangleCount: number;
  finite: boolean;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  degenerateTriangleCount: number;
  signedVolumeM3: number;
  outward: boolean;
  watertight: boolean;
  valid: boolean;
}

export interface ExactBodyBvh {
  bounds: Float32Array;
  left: Int32Array;
  right: Int32Array;
  start: Uint32Array;
  count: Uint32Array;
  triangleOrder: Uint32Array;
  nodeCount: number;
  buildMs: number;
}

export interface ExactBodySurfaceRuntime {
  mesh: PackedBodyMesh;
  validation: PackedBodyMeshValidation;
  bvh: ExactBodyBvh;
  queries: number;
  bvhNodeVisits: number;
  triangleTests: number;
  insideTests: number;
  ccdTests: number;
}

export interface ClosestSurfacePoint {
  triangleIndex: number;
  point: Vec3;
  normal: Vec3;
  barycentric: Vec3;
  distanceM: number;
  signedDistanceM: number;
  inside: boolean;
}

export interface SweptSurfaceContact extends ClosestSurfacePoint {
  t: number;
  trajectoryPoint: Vec3;
}

export interface SegmentSurfaceCrossing {
  triangleIndex: number;
  t: number;
  point: Vec3;
  normal: Vec3;
}

export interface TriangleSurfaceCrossing {
  bodyTriangleIndex: number;
  point: Vec3;
  normal: Vec3;
  clothBarycentric: Vec3;
}

export function packHumanBodyMesh(mesh: HumanBodyMesh): PackedBodyMesh {
  const packed: PackedBodyMesh = {
    positions: new Float32Array(mesh.positions),
    normals: new Float32Array(mesh.normals),
    indices: new Uint32Array(mesh.indices),
    topologySignature: mesh.topologySignature,
  };
  const validation = validatePackedBodyMesh(packed);
  if (!validation.valid) {
    throw new RangeError(
      `Malha corporal inválida: boundary=${validation.boundaryEdgeCount}, nonManifold=${validation.nonManifoldEdgeCount}, degenerate=${validation.degenerateTriangleCount}, outward=${validation.outward}.`,
    );
  }
  return packed;
}

export function validatePackedBodyMesh(mesh: PackedBodyMesh): PackedBodyMeshValidation {
  if (mesh.positions.length % 3 !== 0 || mesh.normals.length !== mesh.positions.length || mesh.indices.length % 3 !== 0) {
    throw new RangeError("Buffers da malha corporal possuem stride incompatível.");
  }
  const vertexCount = mesh.positions.length / 3;
  const edgeUse = new Map<string, number>();
  let finite = true;
  let degenerateTriangleCount = 0;
  let volume6 = 0;
  for (const value of mesh.positions) finite = finite && Number.isFinite(value);
  for (const value of mesh.normals) finite = finite && Number.isFinite(value);
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const ia = mesh.indices[offset];
    const ib = mesh.indices[offset + 1];
    const ic = mesh.indices[offset + 2];
    if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) throw new RangeError("Malha corporal referencia vértice inexistente.");
    const a = pointAt(mesh.positions, ia);
    const b = pointAt(mesh.positions, ib);
    const c = pointAt(mesh.positions, ic);
    const face = cross(sub(b, a), sub(c, a));
    if (lengthSquared(face) <= EPSILON * EPSILON) degenerateTriangleCount += 1;
    volume6 += dot(a, cross(b, c));
    addEdge(edgeUse, ia, ib);
    addEdge(edgeUse, ib, ic);
    addEdge(edgeUse, ic, ia);
  }
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeUse.values()) {
    if (count === 1) boundaryEdgeCount += 1;
    else if (count !== 2) nonManifoldEdgeCount += 1;
  }
  const signedVolumeM3 = volume6 / 6;
  const outward = signedVolumeM3 > 0;
  const watertight = boundaryEdgeCount === 0 && nonManifoldEdgeCount === 0;
  return {
    vertexCount,
    triangleCount: mesh.indices.length / 3,
    finite,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount,
    signedVolumeM3,
    outward,
    watertight,
    valid: finite && watertight && degenerateTriangleCount === 0 && outward,
  };
}

export function createExactBodySurfaceRuntime(mesh: PackedBodyMesh): ExactBodySurfaceRuntime {
  const validation = validatePackedBodyMesh(mesh);
  if (!validation.valid) throw new RangeError("A superfície corporal exata precisa ser fechada, manifold, finita e orientada para fora.");
  return {
    mesh,
    validation,
    bvh: buildExactBodyBvh(mesh),
    queries: 0,
    bvhNodeVisits: 0,
    triangleTests: 0,
    insideTests: 0,
    ccdTests: 0,
  };
}

export function buildExactBodyBvh(mesh: PackedBodyMesh): ExactBodyBvh {
  const started = performance.now();
  const triangleCount = mesh.indices.length / 3;
  const triangleOrder = Uint32Array.from({ length: triangleCount }, (_, index) => index);
  const bounds: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const start: number[] = [];
  const count: number[] = [];

  const build = (first: number, length: number): number => {
    const node = left.length;
    left.push(-1); right.push(-1); start.push(first); count.push(length);
    const nodeBounds = rangeBounds(mesh, triangleOrder, first, length);
    bounds.push(...nodeBounds);
    if (length <= LEAF_TRIANGLE_COUNT) return node;
    const centroidBounds = rangeCentroidBounds(mesh, triangleOrder, first, length);
    const extents = [
      centroidBounds[3] - centroidBounds[0],
      centroidBounds[4] - centroidBounds[1],
      centroidBounds[5] - centroidBounds[2],
    ];
    const axis = extents[1] > extents[0] ? (extents[2] > extents[1] ? 2 : 1) : (extents[2] > extents[0] ? 2 : 0);
    const ordered = Array.from(triangleOrder.slice(first, first + length));
    ordered.sort((a, b) => triangleCentroidAxis(mesh, a, axis) - triangleCentroidAxis(mesh, b, axis) || a - b);
    triangleOrder.set(ordered, first);
    const leftLength = Math.floor(length / 2);
    left[node] = build(first, leftLength);
    right[node] = build(first + leftLength, length - leftLength);
    count[node] = 0;
    return node;
  };
  if (triangleCount > 0) build(0, triangleCount);
  return {
    bounds: Float32Array.from(bounds),
    left: Int32Array.from(left),
    right: Int32Array.from(right),
    start: Uint32Array.from(start),
    count: Uint32Array.from(count),
    triangleOrder,
    nodeCount: left.length,
    buildMs: performance.now() - started,
  };
}

export function closestPointOnExactBody(
  runtime: ExactBodySurfaceRuntime,
  point: readonly number[],
  robustSign = true,
): ClosestSurfacePoint {
  runtime.queries += 1;
  const best = {
    triangleIndex: -1,
    distanceSquared: Number.POSITIVE_INFINITY,
    point: [0, 0, 0] as Vec3,
    barycentric: [1, 0, 0] as Vec3,
  };
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    runtime.bvhNodeVisits += 1;
    const boundOffset = node * 6;
    if (pointAabbDistanceSquared(point, runtime.bvh.bounds, boundOffset) > best.distanceSquared) continue;
    const leafCount = runtime.bvh.count[node];
    if (leafCount > 0) {
      const first = runtime.bvh.start[node];
      for (let index = 0; index < leafCount; index += 1) {
        const triangleIndex = runtime.bvh.triangleOrder[first + index];
        runtime.triangleTests += 1;
        const candidate = closestPointOnTriangle(runtime.mesh, triangleIndex, point);
        const distanceSquared = lengthSquared(sub(point as Vec3, candidate.point));
        if (distanceSquared < best.distanceSquared) Object.assign(best, { triangleIndex, distanceSquared, ...candidate });
      }
      continue;
    }
    const left = runtime.bvh.left[node];
    const right = runtime.bvh.right[node];
    const leftDistance = pointAabbDistanceSquared(point, runtime.bvh.bounds, left * 6);
    const rightDistance = pointAabbDistanceSquared(point, runtime.bvh.bounds, right * 6);
    if (leftDistance < rightDistance) { stack.push(right, left); } else { stack.push(left, right); }
  }
  if (best.triangleIndex < 0) throw new RangeError("BVH corporal não contém triângulos.");
  const normal = pseudoNormal(runtime.mesh, best.triangleIndex, best.barycentric);
  const inside = robustSign
    ? pointInsideExactBody(runtime, point)
    : dot(sub(point as Vec3, best.point), normal) < 0;
  const distanceM = Math.sqrt(best.distanceSquared);
  return {
    triangleIndex: best.triangleIndex,
    point: best.point,
    normal,
    barycentric: best.barycentric,
    distanceM,
    signedDistanceM: inside ? -distanceM : distanceM,
    inside,
  };
}

export function pointInsideExactBody(runtime: ExactBodySurfaceRuntime, point: readonly number[]): boolean {
  runtime.insideTests += 1;
  let intersections = 0;
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    runtime.bvhNodeVisits += 1;
    const offset = node * 6;
    if (!rayIntersectsAabb(point, RAY_DIRECTION, runtime.bvh.bounds, offset)) continue;
    const leafCount = runtime.bvh.count[node];
    if (leafCount > 0) {
      const first = runtime.bvh.start[node];
      for (let index = 0; index < leafCount; index += 1) {
        const triangleIndex = runtime.bvh.triangleOrder[first + index];
        runtime.triangleTests += 1;
        if (rayTriangleDistance(runtime.mesh, triangleIndex, point, RAY_DIRECTION) > EPSILON) intersections += 1;
      }
    } else {
      stack.push(runtime.bvh.left[node], runtime.bvh.right[node]);
    }
  }
  return intersections % 2 === 1;
}

/** Conservative particle-trajectory CCD against the exact closed surface. */
export function sweptPointAgainstExactBody(
  runtime: ExactBodySurfaceRuntime,
  from: readonly number[],
  to: readonly number[],
  clearanceM: number,
): SweptSurfaceContact | null {
  runtime.ccdTests += 1;
  const movement = sub(to as Vec3, from as Vec3);
  const travel = Math.sqrt(lengthSquared(movement));
  if (travel <= EPSILON) return null;
  const first = closestPointOnExactBody(runtime, from, false);
  if (first.signedDistanceM <= clearanceM) return { ...first, t: 0, trajectoryPoint: [...from] as Vec3 };
  let previousT = 0;
  let t = 0;
  for (let iteration = 0; iteration < 32 && t < 1; iteration += 1) {
    const query = closestPointOnExactBody(runtime, addScaled(from as Vec3, movement, t), false);
    const gap = query.signedDistanceM - clearanceM;
    if (gap <= 1e-7) {
      let low = previousT;
      let high = t;
      for (let refine = 0; refine < 16; refine += 1) {
        const middle = (low + high) * 0.5;
        const middleQuery = closestPointOnExactBody(runtime, addScaled(from as Vec3, movement, middle), false);
        if (middleQuery.signedDistanceM <= clearanceM) high = middle; else low = middle;
      }
      const hitT = high;
      const trajectoryPoint = addScaled(from as Vec3, movement, hitT);
      const hit = closestPointOnExactBody(runtime, trajectoryPoint, false);
      return { ...hit, t: hitT, trajectoryPoint };
    }
    previousT = t;
    t = Math.min(1, t + Math.max(1e-5, gap * 0.8) / travel);
    if (t === previousT) break;
  }
  const last = closestPointOnExactBody(runtime, to, false);
  return last.signedDistanceM <= clearanceM ? { ...last, t: 1, trajectoryPoint: [...to] as Vec3 } : null;
}

/** Exact zero-radius segment/triangle crossing used by cloth edge contacts. */
export function segmentCrossingExactBody(
  runtime: ExactBodySurfaceRuntime,
  from: readonly number[],
  to: readonly number[],
): SegmentSurfaceCrossing | null {
  const direction = sub(to as Vec3, from as Vec3);
  if (lengthSquared(direction) <= EPSILON * EPSILON) return null;
  let bestT = Number.POSITIVE_INFINITY;
  let bestTriangle = -1;
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    runtime.bvhNodeVisits += 1;
    if (!segmentIntersectsAabb(from, to, runtime.bvh.bounds, node * 6)) continue;
    const leafCount = runtime.bvh.count[node];
    if (leafCount > 0) {
      const first = runtime.bvh.start[node];
      for (let index = 0; index < leafCount; index += 1) {
        const triangleIndex = runtime.bvh.triangleOrder[first + index];
        runtime.triangleTests += 1;
        const t = rayTriangleDistance(runtime.mesh, triangleIndex, from, direction);
        if (t > 1e-7 && t < 1 - 1e-7 && t < bestT) {
          bestT = t;
          bestTriangle = triangleIndex;
        }
      }
    } else {
      stack.push(runtime.bvh.left[node], runtime.bvh.right[node]);
    }
  }
  if (bestTriangle < 0) return null;
  const point = addScaled(from as Vec3, direction, bestT);
  const closest = closestPointOnExactBody(runtime, point, false);
  return { triangleIndex: bestTriangle, t: bestT, point, normal: closest.normal };
}

/** Body-triangle edges piercing a cloth face, including its barycentric location. */
export function triangleCrossingsExactBody(
  runtime: ExactBodySurfaceRuntime,
  clothA: readonly number[],
  clothB: readonly number[],
  clothC: readonly number[],
  maximumContacts = 4,
): TriangleSurfaceCrossing[] {
  const clothBounds: [number, number, number, number, number, number] = [
    Math.min(clothA[0], clothB[0], clothC[0]), Math.min(clothA[1], clothB[1], clothC[1]), Math.min(clothA[2], clothB[2], clothC[2]),
    Math.max(clothA[0], clothB[0], clothC[0]), Math.max(clothA[1], clothB[1], clothC[1]), Math.max(clothA[2], clothB[2], clothC[2]),
  ];
  const contacts: TriangleSurfaceCrossing[] = [];
  const stack = [0];
  while (stack.length > 0 && contacts.length < maximumContacts) {
    const node = stack.pop()!;
    runtime.bvhNodeVisits += 1;
    if (!aabbsOverlap(clothBounds, runtime.bvh.bounds, node * 6)) continue;
    const leafCount = runtime.bvh.count[node];
    if (leafCount === 0) {
      stack.push(runtime.bvh.left[node], runtime.bvh.right[node]);
      continue;
    }
    const first = runtime.bvh.start[node];
    for (let index = 0; index < leafCount && contacts.length < maximumContacts; index += 1) {
      const triangleIndex = runtime.bvh.triangleOrder[first + index];
      runtime.triangleTests += 1;
      const offset = triangleIndex * 3;
      const bodyA = pointAt(runtime.mesh.positions, runtime.mesh.indices[offset]);
      const bodyB = pointAt(runtime.mesh.positions, runtime.mesh.indices[offset + 1]);
      const bodyC = pointAt(runtime.mesh.positions, runtime.mesh.indices[offset + 2]);
      const normal = normalize(cross(sub(bodyB, bodyA), sub(bodyC, bodyA)));
      for (const [from, to] of [[bodyA, bodyB], [bodyB, bodyC], [bodyC, bodyA]] as const) {
        const hit = segmentTriangleBarycentric(from, to, clothA, clothB, clothC);
        if (!hit) continue;
        contacts.push({
          bodyTriangleIndex: triangleIndex,
          point: addScaled(from, sub(to, from), hit.t),
          normal,
          clothBarycentric: [1 - hit.u - hit.v, hit.u, hit.v],
        });
        break;
      }
    }
  }
  return contacts;
}

export function exactBodyMeshTransferables(mesh: PackedBodyMesh): Transferable[] {
  return [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer];
}

function closestPointOnTriangle(mesh: PackedBodyMesh, triangleIndex: number, point: readonly number[]) {
  const offset = triangleIndex * 3;
  const a = pointAt(mesh.positions, mesh.indices[offset]);
  const b = pointAt(mesh.positions, mesh.indices[offset + 1]);
  const c = pointAt(mesh.positions, mesh.indices[offset + 2]);
  const ab = sub(b, a); const ac = sub(c, a); const ap = sub(point as Vec3, a);
  const d1 = dot(ab, ap); const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: a, barycentric: [1, 0, 0] as Vec3 };
  const bp = sub(point as Vec3, b); const d3 = dot(ab, bp); const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { point: b, barycentric: [0, 1, 0] as Vec3 };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return { point: addScaled(a, ab, v), barycentric: [1 - v, v, 0] as Vec3 }; }
  const cp = sub(point as Vec3, c); const d5 = dot(ab, cp); const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { point: c, barycentric: [0, 0, 1] as Vec3 };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return { point: addScaled(a, ac, w), barycentric: [1 - w, 0, w] as Vec3 }; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { point: addScaled(b, sub(c, b), w), barycentric: [0, 1 - w, w] as Vec3 };
  }
  const inverse = 1 / (va + vb + vc);
  const v = vb * inverse; const w = vc * inverse;
  return { point: add(addScaled(a, ab, v), scale(ac, w)), barycentric: [1 - v - w, v, w] as Vec3 };
}

function pseudoNormal(mesh: PackedBodyMesh, triangleIndex: number, barycentric: Vec3): Vec3 {
  const offset = triangleIndex * 3;
  const ia = mesh.indices[offset]; const ib = mesh.indices[offset + 1]; const ic = mesh.indices[offset + 2];
  const interpolated: Vec3 = [
    mesh.normals[ia * 3] * barycentric[0] + mesh.normals[ib * 3] * barycentric[1] + mesh.normals[ic * 3] * barycentric[2],
    mesh.normals[ia * 3 + 1] * barycentric[0] + mesh.normals[ib * 3 + 1] * barycentric[1] + mesh.normals[ic * 3 + 1] * barycentric[2],
    mesh.normals[ia * 3 + 2] * barycentric[0] + mesh.normals[ib * 3 + 2] * barycentric[1] + mesh.normals[ic * 3 + 2] * barycentric[2],
  ];
  if (lengthSquared(interpolated) > EPSILON * EPSILON) return normalize(interpolated);
  const a = pointAt(mesh.positions, ia); const b = pointAt(mesh.positions, ib); const c = pointAt(mesh.positions, ic);
  return normalize(cross(sub(b, a), sub(c, a)));
}

function rayTriangleDistance(mesh: PackedBodyMesh, triangleIndex: number, origin: readonly number[], direction: Vec3): number {
  const offset = triangleIndex * 3;
  const a = pointAt(mesh.positions, mesh.indices[offset]);
  const b = pointAt(mesh.positions, mesh.indices[offset + 1]);
  const c = pointAt(mesh.positions, mesh.indices[offset + 2]);
  const edge1 = sub(b, a); const edge2 = sub(c, a);
  const h = cross(direction, edge2); const determinant = dot(edge1, h);
  if (Math.abs(determinant) <= EPSILON) return -1;
  const inverse = 1 / determinant; const s = sub(origin as Vec3, a);
  const u = inverse * dot(s, h); if (u < -EPSILON || u > 1 + EPSILON) return -1;
  const q = cross(s, edge1); const v = inverse * dot(direction, q);
  if (v < -EPSILON || u + v > 1 + EPSILON) return -1;
  return inverse * dot(edge2, q);
}

function rayIntersectsAabb(origin: readonly number[], direction: Vec3, bounds: Float32Array, offset: number): boolean {
  let minimum = 0;
  let maximum = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const inverse = 1 / direction[axis];
    let first = (bounds[offset + axis] - origin[axis]) * inverse;
    let second = (bounds[offset + axis + 3] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    minimum = Math.max(minimum, first);
    maximum = Math.min(maximum, second);
    if (maximum < minimum) return false;
  }
  return maximum > EPSILON;
}

function segmentIntersectsAabb(from: readonly number[], to: readonly number[], bounds: Float32Array, offset: number): boolean {
  let minimum = 0;
  let maximum = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) <= EPSILON) {
      if (from[axis] < bounds[offset + axis] || from[axis] > bounds[offset + axis + 3]) return false;
      continue;
    }
    const inverse = 1 / delta;
    let first = (bounds[offset + axis] - from[axis]) * inverse;
    let second = (bounds[offset + axis + 3] - from[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    minimum = Math.max(minimum, first);
    maximum = Math.min(maximum, second);
    if (maximum < minimum) return false;
  }
  return true;
}

function segmentTriangleBarycentric(
  from: Vec3,
  to: Vec3,
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): { t: number; u: number; v: number } | null {
  const direction = sub(to, from);
  const edge1 = sub(b as Vec3, a as Vec3);
  const edge2 = sub(c as Vec3, a as Vec3);
  const h = cross(direction, edge2);
  const determinant = dot(edge1, h);
  if (Math.abs(determinant) <= EPSILON) return null;
  const inverse = 1 / determinant;
  const s = sub(from, a as Vec3);
  const u = inverse * dot(s, h);
  if (u < -EPSILON || u > 1 + EPSILON) return null;
  const q = cross(s, edge1);
  const v = inverse * dot(direction, q);
  if (v < -EPSILON || u + v > 1 + EPSILON) return null;
  const t = inverse * dot(edge2, q);
  return t > 1e-7 && t < 1 - 1e-7 ? { t, u, v } : null;
}

function aabbsOverlap(first: readonly number[], second: Float32Array, offset: number): boolean {
  return first[0] <= second[offset + 3] && first[3] >= second[offset]
    && first[1] <= second[offset + 4] && first[4] >= second[offset + 1]
    && first[2] <= second[offset + 5] && first[5] >= second[offset + 2];
}

function pointAabbDistanceSquared(point: readonly number[], bounds: Float32Array, offset: number): number {
  let result = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = point[axis] < bounds[offset + axis]
      ? bounds[offset + axis] - point[axis]
      : point[axis] > bounds[offset + axis + 3] ? point[axis] - bounds[offset + axis + 3] : 0;
    result += delta * delta;
  }
  return result;
}

function rangeBounds(mesh: PackedBodyMesh, order: Uint32Array, first: number, count: number): [number, number, number, number, number, number] {
  const result: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let index = first; index < first + count; index += 1) {
    const triangleOffset = order[index] * 3;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexOffset = mesh.indices[triangleOffset + corner] * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = mesh.positions[vertexOffset + axis];
        result[axis] = Math.min(result[axis], value);
        result[axis + 3] = Math.max(result[axis + 3], value);
      }
    }
  }
  return result;
}

function rangeCentroidBounds(mesh: PackedBodyMesh, order: Uint32Array, first: number, count: number): [number, number, number, number, number, number] {
  const result: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let index = first; index < first + count; index += 1) {
    const triangle = order[index];
    for (let axis = 0; axis < 3; axis += 1) {
      const value = triangleCentroidAxis(mesh, triangle, axis);
      result[axis] = Math.min(result[axis], value);
      result[axis + 3] = Math.max(result[axis + 3], value);
    }
  }
  return result;
}

function triangleCentroidAxis(mesh: PackedBodyMesh, triangle: number, axis: number): number {
  const offset = triangle * 3;
  return (
    mesh.positions[mesh.indices[offset] * 3 + axis]
    + mesh.positions[mesh.indices[offset + 1] * 3 + axis]
    + mesh.positions[mesh.indices[offset + 2] * 3 + axis]
  ) / 3;
}

function addEdge(edges: Map<string, number>, a: number, b: number): void {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  edges.set(key, (edges.get(key) ?? 0) + 1);
}

function pointAt(values: Float32Array, index: number): Vec3 { return [values[index * 3], values[index * 3 + 1], values[index * 3 + 2]]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: Vec3, value: number): Vec3 { return [a[0] * value, a[1] * value, a[2] * value]; }
function addScaled(a: Vec3, b: Vec3, value: number): Vec3 { return [a[0] + b[0] * value, a[1] + b[1] * value, a[2] + b[2] * value]; }
function dot(a: readonly number[], b: readonly number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function lengthSquared(value: readonly number[]): number { return dot(value, value); }
function normalize(value: Vec3): Vec3 { const length = Math.sqrt(lengthSquared(value)); return length > EPSILON ? scale(value, 1 / length) : [0, 1, 0]; }
