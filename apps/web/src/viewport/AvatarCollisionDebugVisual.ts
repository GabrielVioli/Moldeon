import * as THREE from "three";
import type { PackedBodyMesh } from "../physics/exactBodySurface";

export function createAvatarCollisionDebugVisual(
  surface: PackedBodyMesh,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "avatar:exact-collision-ghost";
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(surface.positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(surface.normals), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(surface.indices), 1));
  const material = new THREE.MeshBasicMaterial({
    color: 0x00d9ff,
    wireframe: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "body-collider:exact-human-surface";
  mesh.renderOrder = 100;
  mesh.userData.topologySignature = surface.topologySignature;
  group.add(mesh);
  return group;
}
