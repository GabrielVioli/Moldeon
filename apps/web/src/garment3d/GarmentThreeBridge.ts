import * as THREE from "three";
import type { GarmentDraft } from "../domain/pattern";
import type { FabricSource } from "../domain/fabric";
import type {
  AssemblyPanelInstance,
  GarmentAssemblyState,
} from "./GarmentAssembly";
import type { PanelVertexSourceMapping } from "./types";

export interface GarmentAssemblyMeshData {
  key: string;
  pieceId: string;
  sourcePatternId: string;
  placementId: string;
  geometrySignature: string;
  vertexSources: Array<PanelVertexSourceMapping & {
    panelInstanceId: string;
    meshVertexIndex: number;
  }>;
  mesh: THREE.Mesh;
  flat: Float32Array;
  dressed: Float32Array;
}

export interface GarmentThreeBridgeOptions {
  castShadow: boolean;
  receiveShadow: boolean;
  visibleInstanceIds?: ReadonlySet<string>;
}

export interface GarmentMeshDiagnostic {
  id: string;
  vertexCount: number;
  triangleCount: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  centroid: [number, number, number];
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    matrixWorld: number[];
  };
  geometrySignature: string;
  geometryRevision: string;
  meshCount: number;
  meanNormal: [number, number, number];
  meanTriangleNormal: [number, number, number];
  materialSide: number | "multiple";
}

export function buildGarmentAssemblyMeshes(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  options: GarmentThreeBridgeOptions,
): GarmentAssemblyMeshData[] {
  const fabricById = new Map(
    garment.fabrics.map((fabric) => [fabric.id, fabric]),
  );
  const pieceById = new Map(
    garment.pieces.map((piece) => [piece.id, piece]),
  );
  const fallbackFabric = garment.fabrics[0];
  const meshes: GarmentAssemblyMeshData[] = [];

  for (const instance of state.instances) {
    if (options.visibleInstanceIds && !options.visibleInstanceIds.has(instance.id)) continue;
    const piece = pieceById.get(instance.pieceId);
    const fabric = fabricById.get(piece?.fabricId ?? "") ?? fallbackFabric;
    if (!fabric) continue;

    const flat = sliceInstancePositions(state.initialPositions, instance);
    const dressed = sliceInstancePositions(state.positions, instance);
    const geometry = buildInstanceGeometry(instance, dressed);
    const material = createFabricMaterial(fabric);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `garment:${instance.id}`;
    mesh.castShadow = options.castShadow;
    mesh.receiveShadow = options.receiveShadow;
    mesh.frustumCulled = true;

    meshes.push({
      key: instance.id,
      pieceId: instance.pieceId,
      sourcePatternId: instance.sourcePatternId,
      placementId: instance.placement.id,
      geometrySignature: instance.geometrySignature,
      vertexSources: instance.vertexSources.map((source) => ({ ...source })),
      mesh,
      flat,
      dressed,
    });
  }

  return meshes;
}

export function refreshMeshFromAssembly(
  meshData: GarmentAssemblyMeshData,
  state: GarmentAssemblyState,
): void {
  const instance = state.instances.find(
    (candidate) => candidate.id === meshData.key,
  );
  if (!instance) return;

  const dressed = sliceInstancePositions(state.positions, instance);
  meshData.dressed.set(dressed);
  const attribute = meshData.mesh.geometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;
  const target = attribute.array as Float32Array;
  target.set(dressed);
  attribute.needsUpdate = true;
  applyInstanceNormals(meshData.mesh.geometry, instance, dressed, meshData.flat);
  meshData.mesh.geometry.computeBoundingBox();
  meshData.mesh.geometry.computeBoundingSphere();
}

export function canReuseGarmentAssemblyMesh(
  previous: GarmentAssemblyMeshData,
  next: GarmentAssemblyMeshData,
): boolean {
  const previousPositions = previous.mesh.geometry.getAttribute("position");
  const nextPositions = next.mesh.geometry.getAttribute("position");
  return previous.geometrySignature === next.geometrySignature
    && previousPositions.count === nextPositions.count
    && sameGeometryIndex(previous.mesh.geometry, next.mesh.geometry);
}

/** Mantém a identidade da mesh sem perder winding ou as normais do embedding. */
export function copyGarmentAssemblyGeometry(
  target: THREE.BufferGeometry,
  source: THREE.BufferGeometry,
): void {
  copyFloatAttribute(target, source, "position");
  copyFloatAttribute(target, source, "normal");
  target.computeBoundingBox();
  target.computeBoundingSphere();
}

export function captureGarmentMeshDiagnostics(
  meshes: readonly GarmentAssemblyMeshData[],
): GarmentMeshDiagnostic[] {
  const countById = new Map<string, number>();
  for (const item of meshes) countById.set(item.key, (countById.get(item.key) ?? 0) + 1);

  return meshes.map((item) => {
    const mesh = item.mesh;
    mesh.updateMatrixWorld(true);
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const worldBox = new THREE.Box3().setFromObject(mesh);
    const centroid = new THREE.Vector3();
    const point = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const meanNormal = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
      centroid.add(point);
      if (normals) {
        point.fromBufferAttribute(normals, index).applyNormalMatrix(normalMatrix);
        meanNormal.add(point);
      }
    }
    if (positions.count > 0) centroid.multiplyScalar(1 / positions.count);
    if (meanNormal.lengthSq() > 1e-12) meanNormal.normalize();

    const materialEntries = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const sides = new Set(materialEntries.map((material) => material.side));
    return {
      id: item.key,
      vertexCount: positions.count,
      triangleCount: geometry.index ? geometry.index.count / 3 : positions.count / 3,
      boundingBox: {
        min: vectorTuple(worldBox.min),
        max: vectorTuple(worldBox.max),
      },
      centroid: vectorTuple(centroid),
      transform: {
        position: vectorTuple(mesh.position),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: vectorTuple(mesh.scale),
        matrixWorld: mesh.matrixWorld.toArray(),
      },
      geometrySignature: item.geometrySignature,
      geometryRevision: `${geometry.uuid}:${attributeRevision(positions)}:${attributeRevision(normals)}`,
      meshCount: countById.get(item.key) ?? 0,
      meanNormal: vectorTuple(meanNormal),
      meanTriangleNormal: meanIndexedTriangleNormal(geometry, mesh.matrixWorld),
      materialSide: sides.size === 1 ? [...sides][0] : "multiple",
    };
  });
}

function buildInstanceGeometry(
  instance: AssemblyPanelInstance,
  positions: Float32Array,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const indices = Array.from(instance.topology.triangles);
  if (instance.arrangement?.flipWinding) {
    for (let index = 0; index < indices.length; index += 3) {
      const second = indices[index + 1];
      indices[index + 1] = indices[index + 2];
      indices[index + 2] = second;
    }
  }
  geometry.setIndex(indices);
  applyInstanceNormals(geometry, instance, positions);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Um tubo derivado das costuras possui uma normal radial exata. Usá-la evita
 * que a média ponderada dos triângulos em leque apareça como falsas rugas no
 * material. Os demais mapeamentos continuam usando as normais da topologia.
 */
function applyInstanceNormals(
  geometry: THREE.BufferGeometry,
  instance: AssemblyPanelInstance,
  positions: Float32Array,
  basePositions?: Float32Array,
): void {
  const arrangement = instance.arrangement;
  const center = arrangement?.tubeCenter;
  if (arrangement?.mapping !== "seam-derived-tube" || !center) {
    geometry.computeVertexNormals();
    return;
  }

  const [axisX, axisY, axisZ] = normalizeVector(arrangement.axis);
  const translation = averagePositionDelta(positions, basePositions);
  const movedCenter: [number, number, number] = [
    center[0] + translation[0],
    center[1] + translation[1],
    center[2] + translation[2],
  ];
  const normals = new Float32Array(positions.length);

  for (let offset = 0; offset < positions.length; offset += 3) {
    const fromCenterX = positions[offset] - movedCenter[0];
    const fromCenterY = positions[offset + 1] - movedCenter[1];
    const fromCenterZ = positions[offset + 2] - movedCenter[2];
    const alongAxis =
      fromCenterX * axisX
      + fromCenterY * axisY
      + fromCenterZ * axisZ;
    const radialX = fromCenterX - axisX * alongAxis;
    const radialY = fromCenterY - axisY * alongAxis;
    const radialZ = fromCenterZ - axisZ * alongAxis;
    const [normalX, normalY, normalZ] = normalizeVector([
      radialX,
      radialY,
      radialZ,
    ]);

    normals[offset] = normalX;
    normals[offset + 1] = normalY;
    normals[offset + 2] = normalZ;
  }

  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
}

function normalizeVector(
  vector: readonly [number, number, number],
): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= 1e-9) return [0, 0, 1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function averagePositionDelta(
  positions: Float32Array,
  basePositions: Float32Array | undefined,
): [number, number, number] {
  if (!basePositions || basePositions.length !== positions.length || positions.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  const count = positions.length / 3;
  for (let offset = 0; offset < positions.length; offset += 3) {
    x += positions[offset] - basePositions[offset];
    y += positions[offset + 1] - basePositions[offset + 1];
    z += positions[offset + 2] - basePositions[offset + 2];
  }
  return [x / count, y / count, z / count];
}

function copyFloatAttribute(
  target: THREE.BufferGeometry,
  source: THREE.BufferGeometry,
  name: "position" | "normal",
): void {
  const sourceAttribute = source.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (!sourceAttribute) {
    target.deleteAttribute(name);
    return;
  }
  const targetAttribute = target.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (targetAttribute && targetAttribute.count === sourceAttribute.count) {
    (targetAttribute.array as Float32Array).set(sourceAttribute.array as ArrayLike<number>);
    targetAttribute.needsUpdate = true;
    return;
  }
  target.setAttribute(name, sourceAttribute.clone());
}

function sameGeometryIndex(first: THREE.BufferGeometry, second: THREE.BufferGeometry): boolean {
  if (!first.index || !second.index) return first.index === second.index;
  if (first.index.count !== second.index.count) return false;
  for (let index = 0; index < first.index.count; index += 1) {
    if (first.index.getX(index) !== second.index.getX(index)) return false;
  }
  return true;
}

function meanIndexedTriangleNormal(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
): [number, number, number] {
  const positions = geometry.getAttribute("position");
  const index = geometry.index;
  const result = new THREE.Vector3();
  const first = new THREE.Vector3();
  const second = new THREE.Vector3();
  const third = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const triangleCount = index ? index.count / 3 : positions.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = index ? index.getX(triangle * 3) : triangle * 3;
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    first.fromBufferAttribute(positions, a).applyMatrix4(matrixWorld);
    second.fromBufferAttribute(positions, b).applyMatrix4(matrixWorld);
    third.fromBufferAttribute(positions, c).applyMatrix4(matrixWorld);
    edgeA.subVectors(second, first);
    edgeB.subVectors(third, first);
    result.add(edgeA.cross(edgeB));
  }
  if (result.lengthSq() > 1e-12) result.normalize();
  return vectorTuple(result);
}

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function attributeRevision(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): number {
  if (!attribute) return -1;
  return "version" in attribute ? attribute.version : attribute.data.version;
}

function sliceInstancePositions(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): Float32Array {
  const start = instance.particleStart * 3;
  const end = start + instance.vertexCount * 3;
  return new Float32Array(positions.slice(start, end));
}

function createFabricMaterial(
  fabric: FabricSource,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(fabric.color),
    roughness: THREE.MathUtils.clamp(
      0.48 + fabric.physics.friction * 0.45,
      0.48,
      0.95,
    ),
    metalness: 0,
    side: THREE.DoubleSide,
  });
}
