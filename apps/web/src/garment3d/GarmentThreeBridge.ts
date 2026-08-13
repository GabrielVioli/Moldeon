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
  applyInstanceNormals(meshData.mesh.geometry, instance, dressed);
  meshData.mesh.geometry.computeBoundingBox();
  meshData.mesh.geometry.computeBoundingSphere();
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
): void {
  const arrangement = instance.arrangement;
  const center = arrangement?.tubeCenter;
  if (arrangement?.mapping !== "seam-derived-tube" || !center) {
    geometry.computeVertexNormals();
    return;
  }

  const [axisX, axisY, axisZ] = normalizeVector(arrangement.axis);
  const normals = new Float32Array(positions.length);

  for (let offset = 0; offset < positions.length; offset += 3) {
    const fromCenterX = positions[offset] - center[0];
    const fromCenterY = positions[offset + 1] - center[1];
    const fromCenterZ = positions[offset + 2] - center[2];
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
