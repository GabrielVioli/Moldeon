import * as THREE from "three";

interface RenderableObject extends THREE.Object3D {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

function disposeMaterialTextures(
  material: THREE.Material,
  disposedTextures: Set<THREE.Texture>,
) {
  for (const value of Object.values(material)) {
    if (!(value instanceof THREE.Texture) || disposedTextures.has(value)) continue;
    disposedTextures.add(value);
    value.dispose();
  }
}

export function disposeObjectTree(root: THREE.Object3D) {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const renderable = object as RenderableObject;
    const geometry = renderable.geometry;

    if (geometry && !disposedGeometries.has(geometry)) {
      disposedGeometries.add(geometry);
      geometry.dispose();
    }

    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];

    for (const material of materials) {
      if (disposedMaterials.has(material)) continue;
      disposedMaterials.add(material);
      disposeMaterialTextures(material, disposedTextures);
      material.dispose();
    }
  });
}
