import {
  canonicalFemaleGlbBase64,
  canonicalFemaleGlbByteLength,
  canonicalFemaleGlbSha256,
} from "virtual:canonical-female-glb";

export type CanonicalVector3 = [number, number, number];

export interface CanonicalFemaleAssetAudit {
  assetId: "canonical-female.glb";
  sha256: string;
  byteLength: number;
  generator: string;
  author: string;
  license: string;
  source: string;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  animationCount: number;
  skinCount: number;
  morphTargetCount: number;
  selectedMeshName: string;
  ignoredMeshNames: string[];
  sourceVertexCount: number;
  sourceTriangleCount: number;
  sourceIndexed: boolean;
  sourceIndexComponentType: number;
  sourceHasNormals: boolean;
  sourceBounds: { min: CanonicalVector3; max: CanonicalVector3 };
  canonicalBounds: { min: CanonicalVector3; max: CanonicalVector3 };
  normalizedVertexCount: number;
  normalizedTriangleCount: number;
  weldedDuplicateVertexCount: number;
  cappedBoundaryLoopCount: number;
  normalization: {
    units: "m";
    up: "+Y";
    front: "+Z";
    right: "+X";
    origin: "ground-center-between-feet";
    assetWorldMatrix: readonly number[];
    groundOffsetM: number;
  };
}

export interface CanonicalFemaleMeshData {
  raw: {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    bounds: { min: CanonicalVector3; max: CanonicalVector3 };
  };
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  bounds: { min: CanonicalVector3; max: CanonicalVector3 };
  topologySignature: string;
  audit: CanonicalFemaleAssetAudit;
}

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
  min?: number[];
  max?: number[];
}

interface GltfBufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: unknown[];
}

interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  skin?: number;
}

interface GltfDocument {
  asset: {
    generator?: string;
    extras?: Record<string, string>;
  };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  materials?: unknown[];
  animations?: unknown[];
  skins?: unknown[];
}

interface ParsedGlb {
  json: GltfDocument;
  binary: Uint8Array;
}

const BODY_MESH_NAME = "Body__0";
const POSITION_WELD_QUANTIZATION_M = 1e-7;
let cached: CanonicalFemaleMeshData | null = null;

/**
 * Returns the immutable canonical topology decoded from the approved GLB.
 * Deformation code must copy `positions`; indices and landmark bindings are
 * intentionally stable for every measurement profile.
 */
export function canonicalFemaleMesh(): CanonicalFemaleMeshData {
  if (cached !== null) return cached;
  const bytes = decodeBase64(canonicalFemaleGlbBase64);
  if (bytes.byteLength !== canonicalFemaleGlbByteLength) {
    throw new Error("canonical-female.glb foi truncado durante o empacotamento.");
  }
  const parsed = parseGlb(bytes);
  const json = parsed.json;
  const meshes = json.meshes ?? [];
  const bodyMeshIndex = meshes.findIndex((mesh) => mesh.name === BODY_MESH_NAME);
  if (bodyMeshIndex < 0) throw new Error(`Mesh canônico ausente: ${BODY_MESH_NAME}.`);
  const bodyMesh = meshes[bodyMeshIndex];
  if (bodyMesh.primitives.length !== 1) {
    throw new Error("A superfície corporal canônica precisa ter exatamente uma primitive.");
  }
  const primitive = bodyMesh.primitives[0];
  if ((primitive.mode ?? 4) !== 4 || primitive.indices === undefined) {
    throw new Error("A superfície corporal canônica precisa ser TRIANGLES indexada.");
  }
  const positionAccessorIndex = primitive.attributes.POSITION;
  if (positionAccessorIndex === undefined) {
    throw new Error("A superfície corporal canônica não possui POSITION.");
  }
  const worldMatrix = findMeshWorldMatrix(json, bodyMeshIndex);
  const sourcePositions = readVec3Accessor(parsed, positionAccessorIndex);
  const sourceIndices = readIndexAccessor(parsed, primitive.indices);
  const transformed = transformPositions(sourcePositions, worldMatrix);
  const sourceBounds = boundsOf(transformed);
  const sourceWindingIsPositive = signedVolume(transformed, sourceIndices) >= 0;
  const rawIndices = sourceWindingIsPositive
    ? Uint32Array.from(sourceIndices)
    : Uint32Array.from(flipWinding(sourceIndices));
  const raw = {
    positions: new Float32Array(transformed),
    normals: buildVertexNormals(transformed, rawIndices),
    indices: rawIndices,
    bounds: sourceBounds,
  };
  const groundOffsetM = -sourceBounds.min[1];
  for (let offset = 1; offset < transformed.length; offset += 3) {
    transformed[offset] += groundOffsetM;
  }

  const welded = weldPositions(transformed, sourceIndices);
  const capped = capBoundaryLoops(welded.positions, welded.indices);
  let normalizedIndices = capped.indices;
  if (signedVolume(capped.positions, normalizedIndices) < 0) {
    normalizedIndices = flipWinding(normalizedIndices);
  }
  const normals = buildVertexNormals(capped.positions, normalizedIndices);
  const bounds = boundsOf(capped.positions);
  const diagnostics = edgeDiagnostics(normalizedIndices);
  if (diagnostics.boundaryEdgeCount !== 0 || diagnostics.nonManifoldEdgeCount !== 0) {
    throw new Error(
      `Normalização canônica não manifold: ${diagnostics.boundaryEdgeCount} boundary / ${diagnostics.nonManifoldEdgeCount} non-manifold.`,
    );
  }

  const accessors = json.accessors ?? [];
  const sourcePositionAccessor = accessors[positionAccessorIndex];
  const sourceIndexAccessor = accessors[primitive.indices];
  const ignoredMeshNames = meshes
    .filter((_, index) => index !== bodyMeshIndex)
    .map((mesh, index) => mesh.name ?? `mesh:${index}`);
  const canonicalBounds = boundsOf(capped.positions);
  const audit: CanonicalFemaleAssetAudit = {
    assetId: "canonical-female.glb",
    sha256: canonicalFemaleGlbSha256,
    byteLength: canonicalFemaleGlbByteLength,
    generator: json.asset.generator ?? "unknown",
    author: json.asset.extras?.author ?? "unknown",
    license: json.asset.extras?.license ?? "unknown",
    source: json.asset.extras?.source ?? "unknown",
    sceneCount: json.scenes?.length ?? 0,
    nodeCount: json.nodes?.length ?? 0,
    meshCount: meshes.length,
    primitiveCount: meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
    materialCount: json.materials?.length ?? 0,
    animationCount: json.animations?.length ?? 0,
    skinCount: json.skins?.length ?? 0,
    morphTargetCount: meshes.reduce(
      (sum, mesh) => sum + mesh.primitives.reduce(
        (primitiveSum, candidate) => primitiveSum + (candidate.targets?.length ?? 0),
        0,
      ),
      0,
    ),
    selectedMeshName: BODY_MESH_NAME,
    ignoredMeshNames,
    sourceVertexCount: sourcePositionAccessor.count,
    sourceTriangleCount: sourceIndexAccessor.count / 3,
    sourceIndexed: true,
    sourceIndexComponentType: sourceIndexAccessor.componentType,
    sourceHasNormals: primitive.attributes.NORMAL !== undefined,
    sourceBounds,
    canonicalBounds,
    normalizedVertexCount: capped.positions.length / 3,
    normalizedTriangleCount: normalizedIndices.length / 3,
    weldedDuplicateVertexCount: sourcePositionAccessor.count - welded.positions.length / 3,
    cappedBoundaryLoopCount: capped.cappedLoopCount,
    normalization: {
      units: "m",
      up: "+Y",
      front: "+Z",
      right: "+X",
      origin: "ground-center-between-feet",
      assetWorldMatrix: [...worldMatrix],
      groundOffsetM,
    },
  };
  cached = {
    raw,
    positions: capped.positions,
    normals,
    indices: normalizedIndices,
    bounds,
    topologySignature: topologySignature(normalizedIndices, capped.positions.length / 3),
    audit,
  };
  return cached;
}

function decodeBase64(value: string): Uint8Array {
  const decoded = globalThis.atob(value);
  const result = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    result[index] = decoded.charCodeAt(index);
  }
  return result;
}

function parseGlb(bytes: Uint8Array): ParsedGlb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("canonical-female.glb não é um GLB 2.0 válido.");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error("O comprimento declarado do GLB não corresponde ao asset.");
  }
  let cursor = 12;
  let json: GltfDocument | null = null;
  let binary: Uint8Array | null = null;
  while (cursor + 8 <= bytes.byteLength) {
    const length = view.getUint32(cursor, true);
    const type = view.getUint32(cursor + 4, true);
    const payload = bytes.subarray(cursor + 8, cursor + 8 + length);
    if (type === 0x4e4f534a) {
      const text = new TextDecoder().decode(payload).replace(/\u0000+$/u, "").trimEnd();
      json = JSON.parse(text) as GltfDocument;
    } else if (type === 0x004e4942) {
      binary = payload;
    }
    cursor += 8 + length;
  }
  if (json === null || binary === null) {
    throw new Error("canonical-female.glb não contém JSON e BIN embutidos.");
  }
  return { json, binary };
}

function findMeshWorldMatrix(json: GltfDocument, meshIndex: number): number[] {
  const nodes = json.nodes ?? [];
  const scene = json.scenes?.[json.scene ?? 0];
  let found: number[] | null = null;
  const visit = (nodeIndex: number, parent: readonly number[]): void => {
    const node = nodes[nodeIndex];
    if (!node) return;
    const world = multiplyMatrix4(parent, localMatrix(node));
    if (node.mesh === meshIndex) {
      if (found !== null) throw new Error("A superfície corporal aparece mais de uma vez na cena.");
      found = world;
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of scene?.nodes ?? []) visit(root, identityMatrix4());
  if (found === null) throw new Error("O node da superfície corporal não está na cena ativa.");
  return found;
}

function localMatrix(node: GltfNode): number[] {
  if (node.matrix?.length === 16) return [...node.matrix];
  const translation = node.translation ?? [0, 0, 0];
  const scale = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  return [
    (1 - (yy + zz)) * scale[0], (xy + wz) * scale[0], (xz - wy) * scale[0], 0,
    (xy - wz) * scale[1], (1 - (xx + zz)) * scale[1], (yz + wx) * scale[1], 0,
    (xz + wy) * scale[2], (yz - wx) * scale[2], (1 - (xx + yy)) * scale[2], 0,
    translation[0], translation[1], translation[2], 1,
  ];
}

function identityMatrix4(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrix4(left: readonly number[], right: readonly number[]): number[] {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}

function readVec3Accessor(parsed: ParsedGlb, accessorIndex: number): Float32Array {
  const accessor = parsed.json.accessors?.[accessorIndex];
  if (!accessor || accessor.type !== "VEC3" || accessor.componentType !== 5126) {
    throw new Error(`Accessor VEC3/FLOAT inválido: ${accessorIndex}.`);
  }
  const bufferView = parsed.json.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`BufferView ausente: ${accessor.bufferView}.`);
  const stride = bufferView.byteStride ?? 12;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(parsed.binary.buffer, parsed.binary.byteOffset, parsed.binary.byteLength);
  const result = new Float32Array(accessor.count * 3);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < 3; component += 1) {
      result[item * 3 + component] = view.getFloat32(start + item * stride + component * 4, true);
    }
  }
  return result;
}

function readIndexAccessor(parsed: ParsedGlb, accessorIndex: number): Uint32Array {
  const accessor = parsed.json.accessors?.[accessorIndex];
  if (!accessor || accessor.type !== "SCALAR") {
    throw new Error(`Accessor de índice inválido: ${accessorIndex}.`);
  }
  const bufferView = parsed.json.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`BufferView ausente: ${accessor.bufferView}.`);
  const componentBytes = accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : 4;
  if (![5121, 5123, 5125].includes(accessor.componentType)) {
    throw new Error(`Tipo de índice não suportado: ${accessor.componentType}.`);
  }
  const stride = bufferView.byteStride ?? componentBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(parsed.binary.buffer, parsed.binary.byteOffset, parsed.binary.byteLength);
  const result = new Uint32Array(accessor.count);
  for (let item = 0; item < accessor.count; item += 1) {
    const offset = start + item * stride;
    result[item] = accessor.componentType === 5121
      ? view.getUint8(offset)
      : accessor.componentType === 5123
        ? view.getUint16(offset, true)
        : view.getUint32(offset, true);
  }
  return result;
}

function transformPositions(source: Float32Array, matrix: readonly number[]): Float32Array {
  const result = new Float32Array(source.length);
  for (let offset = 0; offset < source.length; offset += 3) {
    const x = source[offset]; const y = source[offset + 1]; const z = source[offset + 2];
    result[offset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    result[offset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    result[offset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  return result;
}

function weldPositions(
  sourcePositions: Float32Array,
  sourceIndices: Uint32Array,
): { positions: Float32Array; indices: Uint32Array } {
  const remap = new Uint32Array(sourcePositions.length / 3);
  const byPosition = new Map<string, number>();
  const positions: number[] = [];
  for (let vertex = 0; vertex < sourcePositions.length / 3; vertex += 1) {
    const x = sourcePositions[vertex * 3];
    const y = sourcePositions[vertex * 3 + 1];
    const z = sourcePositions[vertex * 3 + 2];
    const key = [x, y, z]
      .map((value) => Math.round(value / POSITION_WELD_QUANTIZATION_M))
      .join(":");
    let normalized = byPosition.get(key);
    if (normalized === undefined) {
      normalized = positions.length / 3;
      byPosition.set(key, normalized);
      positions.push(x, y, z);
    }
    remap[vertex] = normalized;
  }
  const indices: number[] = [];
  for (let offset = 0; offset < sourceIndices.length; offset += 3) {
    const a = remap[sourceIndices[offset]];
    const b = remap[sourceIndices[offset + 1]];
    const c = remap[sourceIndices[offset + 2]];
    if (a === b || b === c || c === a) continue;
    indices.push(a, b, c);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

function capBoundaryLoops(
  sourcePositions: Float32Array,
  sourceIndices: Uint32Array,
): { positions: Float32Array; indices: Uint32Array; cappedLoopCount: number } {
  const records = directedEdgeRecords(sourceIndices);
  const boundary = [...records.values()].filter((record) => record.count === 1);
  if (boundary.length === 0) {
    return { positions: sourcePositions, indices: sourceIndices, cappedLoopCount: 0 };
  }
  const adjacency = new Map<number, Set<number>>();
  for (const edge of boundary) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, new Set());
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, new Set());
    adjacency.get(edge.a)!.add(edge.b);
    adjacency.get(edge.b)!.add(edge.a);
  }
  const componentByVertex = new Map<number, number>();
  const components: number[][] = [];
  for (const root of [...adjacency.keys()].sort((a, b) => a - b)) {
    if (componentByVertex.has(root)) continue;
    const componentIndex = components.length;
    const vertices: number[] = [];
    const queue = [root];
    componentByVertex.set(root, componentIndex);
    while (queue.length > 0) {
      const vertex = queue.shift()!;
      vertices.push(vertex);
      const neighbors = adjacency.get(vertex) ?? new Set();
      if (neighbors.size !== 2) {
        throw new Error("Abertura canônica não forma um loop simples.");
      }
      for (const neighbor of neighbors) {
        if (componentByVertex.has(neighbor)) continue;
        componentByVertex.set(neighbor, componentIndex);
        queue.push(neighbor);
      }
    }
    components.push(vertices);
  }
  const positions = [...sourcePositions];
  const indices = [...sourceIndices];
  const centerByComponent = components.map((vertices) => {
    const center: CanonicalVector3 = [0, 0, 0];
    for (const vertex of vertices) {
      center[0] += sourcePositions[vertex * 3];
      center[1] += sourcePositions[vertex * 3 + 1];
      center[2] += sourcePositions[vertex * 3 + 2];
    }
    center[0] /= vertices.length;
    center[1] /= vertices.length;
    center[2] /= vertices.length;
    const index = positions.length / 3;
    positions.push(...center);
    return index;
  });
  for (const edge of boundary) {
    const component = componentByVertex.get(edge.a);
    if (component === undefined || component !== componentByVertex.get(edge.b)) {
      throw new Error("Edge de abertura canônica não pertence a um único loop.");
    }
    // The existing surface owns a->b; the cap must own b->a.
    indices.push(centerByComponent[component], edge.b, edge.a);
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    cappedLoopCount: components.length,
  };
}

function directedEdgeRecords(indices: Uint32Array): Map<string, { a: number; b: number; count: number }> {
  const result = new Map<string, { a: number; b: number; count: number }>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (const [a, b] of [
      [indices[offset], indices[offset + 1]],
      [indices[offset + 1], indices[offset + 2]],
      [indices[offset + 2], indices[offset]],
    ] as const) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const record = result.get(key);
      if (record) record.count += 1;
      else result.set(key, { a, b, count: 1 });
    }
  }
  return result;
}

function edgeDiagnostics(indices: Uint32Array): { boundaryEdgeCount: number; nonManifoldEdgeCount: number } {
  const counts = directedEdgeRecords(indices);
  return {
    boundaryEdgeCount: [...counts.values()].filter((record) => record.count === 1).length,
    nonManifoldEdgeCount: [...counts.values()].filter((record) => record.count > 2).length,
  };
}

function flipWinding(source: Uint32Array): Uint32Array {
  const result = new Uint32Array(source);
  for (let offset = 0; offset < result.length; offset += 3) {
    const temporary = result[offset + 1];
    result[offset + 1] = result[offset + 2];
    result[offset + 2] = temporary;
  }
  return result;
}

function buildVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const result = new Float64Array(positions.length);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3;
    const b = indices[offset + 1] * 3;
    const c = indices[offset + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vertex of [a, b, c]) {
      result[vertex] += nx;
      result[vertex + 1] += ny;
      result[vertex + 2] += nz;
    }
  }
  const normals = new Float32Array(result.length);
  for (let offset = 0; offset < result.length; offset += 3) {
    const length = Math.hypot(result[offset], result[offset + 1], result[offset + 2]);
    if (length <= 1e-12) continue;
    normals[offset] = result[offset] / length;
    normals[offset + 1] = result[offset + 1] / length;
    normals[offset + 2] = result[offset + 2] / length;
  }
  return normals;
}

function boundsOf(positions: Float32Array): { min: CanonicalVector3; max: CanonicalVector3 } {
  const min: CanonicalVector3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: CanonicalVector3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis]);
      max[axis] = Math.max(max[axis], positions[offset + axis]);
    }
  }
  return { min, max };
}

function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let volume = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3;
    const b = indices[offset + 1] * 3;
    const c = indices[offset + 2] * 3;
    volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      + positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return volume / 6;
}

function topologySignature(indices: Uint32Array, vertexCount: number): string {
  let hash = 2166136261;
  hash ^= vertexCount;
  hash = Math.imul(hash, 16777619);
  for (const index of indices) {
    hash ^= index;
    hash = Math.imul(hash, 16777619);
  }
  return `canonical-female:${vertexCount}:${indices.length / 3}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
