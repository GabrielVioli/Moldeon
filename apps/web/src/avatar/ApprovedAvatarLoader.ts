import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ApprovedAvatarAssetDescriptor } from "./ApprovedAvatarAsset";
import { disposeObjectTree } from "../viewport/disposeObjectTree";

export interface LoadedApprovedAvatar {
  descriptor: ApprovedAvatarAssetDescriptor;
  root: THREE.Group;
  inspection: {
    nodeNames: string[];
    skinCount: number;
    boneNames: string[];
    morphTargetCount: number;
    materialCount: number;
    textureCount: number;
    boundsM: { min: [number, number, number]; max: [number, number, number] };
  };
}

export async function loadApprovedAvatar(
  descriptor: ApprovedAvatarAssetDescriptor,
  signal: AbortSignal,
): Promise<LoadedApprovedAvatar> {
  validateDescriptor(descriptor);
  const response = await fetch(descriptor.sourceUrl, { signal });
  if (!response.ok) throw new Error(`O asset aprovado respondeu HTTP ${response.status}.`);
  const buffer = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException("Carregamento do manequim cancelado.", "AbortError");

  const loader = new GLTFLoader();
  const basePath = new URL(".", new URL(descriptor.sourceUrl, window.location.href)).toString();
  const gltf = await loader.parseAsync(buffer, basePath);
  const root = new THREE.Group();
  root.name = `approved-avatar:${descriptor.assetId}`;
  root.add(gltf.scene);
  calibrateRoot(root, descriptor);
  root.updateMatrixWorld(true);

  if (signal.aborted) {
    disposeObjectTree(root);
    root.clear();
    throw new DOMException("Carregamento do manequim cancelado.", "AbortError");
  }

  return { descriptor, root, inspection: inspectAvatar(root) };
}

function validateDescriptor(descriptor: ApprovedAvatarAssetDescriptor): void {
  if (!descriptor.assetId || !descriptor.sourceUrl || !descriptor.version) {
    throw new TypeError("O descritor do manequim aprovado está incompleto.");
  }
  if (!Number.isFinite(descriptor.scaleToMeters) || descriptor.scaleToMeters <= 0) {
    throw new RangeError("A escala física do manequim aprovado precisa ser positiva.");
  }
  if (!descriptor.license || !descriptor.authorAttribution) {
    throw new TypeError("Licença e atribuição do manequim aprovado são obrigatórias.");
  }
}

function calibrateRoot(root: THREE.Group, descriptor: ApprovedAvatarAssetDescriptor): void {
  root.scale.setScalar(descriptor.scaleToMeters);
  root.position.set(...descriptor.rootTransform.positionM);
  root.position.y += descriptor.groundOffsetM;
  root.rotation.set(
    THREE.MathUtils.degToRad(descriptor.rootTransform.rotationDeg[0]),
    THREE.MathUtils.degToRad(descriptor.rootTransform.rotationDeg[1]),
    THREE.MathUtils.degToRad(descriptor.rootTransform.rotationDeg[2]),
  );
  root.userData.avatarCalibration = {
    sourceUnit: descriptor.sourceUnit,
    upAxis: descriptor.upAxis,
    forwardAxis: descriptor.forwardAxis,
    scaleToMeters: descriptor.scaleToMeters,
  };
}

function inspectAvatar(root: THREE.Object3D): LoadedApprovedAvatar["inspection"] {
  const nodeNames: string[] = [];
  const boneNames: string[] = [];
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let skinCount = 0;
  let morphTargetCount = 0;
  root.traverse((object) => {
    if (object.name) nodeNames.push(object.name);
    if (object instanceof THREE.Bone) boneNames.push(object.name);
    if (object instanceof THREE.SkinnedMesh) skinCount += 1;
    if (!(object instanceof THREE.Mesh)) return;
    morphTargetCount += Object.keys(object.morphTargetDictionary ?? {}).length;
    const entries = Array.isArray(object.material) ? object.material : [object.material];
    entries.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });
  const box = new THREE.Box3().setFromObject(root);
  const tuple = (value: THREE.Vector3): [number, number, number] => [value.x, value.y, value.z];
  return {
    nodeNames,
    skinCount,
    boneNames,
    morphTargetCount,
    materialCount: materials.size,
    textureCount: textures.size,
    boundsM: { min: tuple(box.min), max: tuple(box.max) },
  };
}
