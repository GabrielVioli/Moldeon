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

interface QueryRuntime {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
}

const runtimes = new WeakMap<HumanBodyMesh, QueryRuntime>();

/**
 * Continuous surface query against the exact visual body used by the viewport.
 * The Three geometry is built once per bounded HumanBodyModel and reused for
 * every pointer move; no React state or body packing occurs in this hot path.
 */
export function raycastBodySurface(
  body: HumanBodyMesh,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  normalOffsetMm = 12,
  maxDistanceM = Number.POSITIVE_INFINITY,
): BodySurfaceFrame | null {
  const runtime = runtimeFor(body);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction).normalize(),
    0,
    maxDistanceM,
  );
  const hit = raycaster.intersectObject(runtime.mesh, false)[0];
  if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
  const triangle = triangleFor(body, hit.faceIndex);
  const barycentricVector = THREE.Triangle.getBarycoord(
    hit.point,
    triangle.a,
    triangle.b,
    triangle.c,
    new THREE.Vector3(),
  );
  if (!barycentricVector) return null;
  return resolveBodySurfaceAttachment(body, {
    version: 1,
    topologySignature: body.topologySignature,
    triangleIndex: hit.faceIndex,
    barycentric: [barycentricVector.x, barycentricVector.y, barycentricVector.z],
    normalOffsetMm,
  });
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
    surfacePoint,
    interpolatedNormal(body, attachment.triangleIndex, attachment.barycentric),
  );
  const tangent = triangle.b.clone().sub(triangle.a);
  tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
  const safeTangent = tangent.lengthSq() > 1e-12 ? tangent : orthogonalTangent(normal);
  const axis = new THREE.Vector3().crossVectors(normal, safeTangent).normalize();
  const position = surfacePoint.clone().addScaledVector(normal, attachment.normalOffsetMm * 0.001);
  return {
    attachment: structuredClone(attachment),
    position: tuple(position),
    outwardNormal: tuple(normal),
    tangent: tuple(safeTangent),
    axis: tuple(axis),
  };
}

function runtimeFor(body: HumanBodyMesh): QueryRuntime {
  const cached = runtimes.get(body);
  if (cached) return cached;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(body.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(body.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(body.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const runtime = { geometry, mesh };
  runtimes.set(body, runtime);
  return runtime;
}

function triangleFor(body: HumanBodyMesh, triangleIndex: number): THREE.Triangle {
  const offset = triangleIndex * 3;
  return new THREE.Triangle(
    vertex(body.positions, body.indices[offset]),
    vertex(body.positions, body.indices[offset + 1]),
    vertex(body.positions, body.indices[offset + 2]),
  );
}

function interpolatedNormal(
  body: HumanBodyMesh,
  triangleIndex: number,
  barycentric: readonly [number, number, number],
): THREE.Vector3 {
  const offset = triangleIndex * 3;
  const result = new THREE.Vector3();
  for (let corner = 0; corner < 3; corner += 1) {
    const index = body.indices[offset + corner];
    result.addScaledVector(vertex(body.normals, index), barycentric[corner]);
  }
  if (result.lengthSq() <= 1e-12) {
    return triangleFor(body, triangleIndex).getNormal(result);
  }
  return result.normalize();
}

function orientOutwardNormal(
  body: HumanBodyMesh,
  surfacePoint: THREE.Vector3,
  normalValue: THREE.Vector3,
): THREE.Vector3 {
  const normal = normalValue.clone().normalize();
  const boundsCenter = new THREE.Vector3(
    (body.bounds.min[0] + body.bounds.max[0]) * 0.5,
    (body.bounds.min[1] + body.bounds.max[1]) * 0.5,
    (body.bounds.min[2] + body.bounds.max[2]) * 0.5,
  );
  const radial = surfacePoint.clone().sub(boundsCenter);
  if (radial.lengthSq() > 1e-12 && normal.dot(radial) < 0) normal.negate();
  return normal;
}

function orthogonalTangent(normal: THREE.Vector3): THREE.Vector3 {
  const seed = Math.abs(normal.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  return seed.addScaledVector(normal, -seed.dot(normal)).normalize();
}

function vertex(values: Float32Array, index: number): THREE.Vector3 {
  return new THREE.Vector3(values[index * 3], values[index * 3 + 1], values[index * 3 + 2]);
}

function tuple(value: THREE.Vector3): HumanBodyVector3 {
  return [value.x, value.y, value.z];
}
