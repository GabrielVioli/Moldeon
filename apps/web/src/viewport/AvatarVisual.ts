import * as THREE from "three";
import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";

export interface AvatarVisualOptions {
  radialSegments: number;
  castShadow: boolean;
  receiveShadow: boolean;
  hiddenPartNames?: ReadonlySet<string>;
}

/**
 * Renders the canonical HumanBodyModel visual LOD directly. The visible body
 * is no longer assembled from independent ellipsoids/capsules; every frame is
 * a single continuous anatomical surface derived from the same implicit body
 * definition used by the fitting/collision LOD.
 */
export function createAvatarVisual(
  model: AvatarParametricModel,
  options: AvatarVisualOptions,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "avatar:visual";

  const source = model.humanBody.visualMesh;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(source.positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(source.normals), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(source.indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0xc9c7c2,
    roughness: 0.74,
    metalness: 0,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "avatar:human-body";
  mesh.castShadow = options.castShadow;
  mesh.receiveShadow = options.receiveShadow;
  mesh.userData.humanBodyVersion = model.humanBody.version;
  mesh.userData.canonicalSurface = true;
  mesh.userData.hiddenPartNamesIgnored = options.hiddenPartNames ? [...options.hiddenPartNames] : [];
  group.add(mesh);

  return group;
}
