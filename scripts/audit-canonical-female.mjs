import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

if (typeof globalThis.ProgressEvent === "undefined") {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
}

const assetPath = new URL(
  "../apps/web/public/models/human/canonical-female.glb",
  import.meta.url,
);
const bytes = await readFile(assetPath);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new GLTFLoader().parseAsync(buffer, "");
gltf.scene.updateMatrixWorld(true);

const meshes = [];
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  const geometry = object.geometry;
  geometry.computeBoundingBox();
  const worldBounds = new THREE.Box3().setFromObject(object);
  const topology = inspectTopology(geometry, object.matrixWorld);
  meshes.push({
    name: object.name,
    primitiveCount: 1,
    vertexCount: geometry.getAttribute("position")?.count ?? 0,
    triangleCount: (geometry.index?.count ?? 0) / 3,
    indexed: geometry.index !== null,
    indexType: geometry.index?.array.constructor.name ?? null,
    hasNormals: geometry.getAttribute("normal") !== undefined,
    morphTargetCount: Object.keys(object.morphTargetDictionary ?? {}).length,
    skinned: object instanceof THREE.SkinnedMesh,
    materialNames: (Array.isArray(object.material) ? object.material : [object.material])
      .map((material) => material.name),
    localBounds: boxToJSON(geometry.boundingBox),
    worldBounds: boxToJSON(worldBounds),
    worldMatrix: object.matrixWorld.elements,
    topology,
  });
});

console.log(JSON.stringify({
  assetPath: assetPath.pathname,
  byteLength: bytes.byteLength,
  sceneName: gltf.scene.name,
  nodeCount: countNodes(gltf.scene),
  meshCount: meshes.length,
  materialCount: new Set(meshes.flatMap((mesh) => mesh.materialNames)).size,
  animationCount: gltf.animations.length,
  meshes,
}, null, 2));

function countNodes(root) {
  let count = 0;
  root.traverse(() => { count += 1; });
  return count;
}

function boxToJSON(box) {
  return box === null
    ? null
    : { min: box.min.toArray(), max: box.max.toArray() };
}

function inspectTopology(geometry, worldMatrix) {
  const position = geometry.getAttribute("position");
  const sourceIndices = geometry.index?.array;
  if (position === undefined || sourceIndices === undefined) return null;
  const transformed = new Float64Array(position.count * 3);
  const point = new THREE.Vector3();
  const canonicalVertex = new Uint32Array(position.count);
  const canonicalByPosition = new Map();
  const canonicalPositions = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex).applyMatrix4(worldMatrix);
    transformed[vertex * 3] = point.x;
    transformed[vertex * 3 + 1] = point.y;
    transformed[vertex * 3 + 2] = point.z;
    const key = `${Math.round(point.x * 1e6)}:${Math.round(point.y * 1e6)}:${Math.round(point.z * 1e6)}`;
    let canonical = canonicalByPosition.get(key);
    if (canonical === undefined) {
      canonical = canonicalByPosition.size;
      canonicalByPosition.set(key, canonical);
      canonicalPositions.push([point.x, point.y, point.z]);
    }
    canonicalVertex[vertex] = canonical;
  }
  const raw = edgeDiagnostics(sourceIndices, (vertex) => vertex);
  const welded = edgeDiagnostics(
    sourceIndices,
    (vertex) => canonicalVertex[vertex],
    canonicalPositions,
  );
  let signedVolumeM3 = 0;
  let degenerateTriangleCount = 0;
  for (let offset = 0; offset < sourceIndices.length; offset += 3) {
    const a = sourceIndices[offset] * 3;
    const b = sourceIndices[offset + 1] * 3;
    const c = sourceIndices[offset + 2] * 3;
    const ax = transformed[a]; const ay = transformed[a + 1]; const az = transformed[a + 2];
    const bx = transformed[b]; const by = transformed[b + 1]; const bz = transformed[b + 2];
    const cx = transformed[c]; const cy = transformed[c + 1]; const cz = transformed[c + 2];
    const abx = bx - ax; const aby = by - ay; const abz = bz - az;
    const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (Math.hypot(nx, ny, nz) <= 1e-12) degenerateTriangleCount += 1;
    signedVolumeM3 += ax * (by * cz - bz * cy)
      + ay * (bz * cx - bx * cz)
      + az * (bx * cy - by * cx);
  }
  return {
    uniqueSpatialVertexCount: canonicalByPosition.size,
    duplicatePositionVertexCount: position.count - canonicalByPosition.size,
    raw,
    welded,
    degenerateTriangleCount,
    signedVolumeM3: signedVolumeM3 / 6,
  };
}

function edgeDiagnostics(indices, vertexKey, positions = undefined) {
  const edges = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [
      vertexKey(indices[offset]),
      vertexKey(indices[offset + 1]),
      vertexKey(indices[offset + 2]),
    ];
    for (const [first, second] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      const a = Math.min(first, second);
      const b = Math.max(first, second);
      const key = `${a}:${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const boundary = [...edges.entries()]
    .filter(([, count]) => count === 1)
    .map(([key]) => key.split(":").map(Number));
  return {
    boundaryEdgeCount: boundary.length,
    nonManifoldEdgeCount: [...edges.values()].filter((count) => count > 2).length,
    boundaryLoops: boundaryComponents(boundary, positions),
  };
}

function boundaryComponents(boundary, positions) {
  const adjacency = new Map();
  for (const [a, b] of boundary) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  const components = [];
  const visited = new Set();
  for (const root of adjacency.keys()) {
    if (visited.has(root)) continue;
    const queue = [root];
    const vertices = [];
    visited.add(root);
    while (queue.length > 0) {
      const vertex = queue.shift();
      vertices.push(vertex);
      for (const neighbor of adjacency.get(vertex) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    const points = positions === undefined ? [] : vertices.map((vertex) => positions[vertex]);
    components.push({
      vertexCount: vertices.length,
      ...(points.length === 0 ? {} : {
        bounds: {
          min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
          max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
        },
      }),
    });
  }
  return components.sort((a, b) => b.vertexCount - a.vertexCount);
}
