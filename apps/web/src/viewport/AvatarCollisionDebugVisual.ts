import * as THREE from "three";
import type { AvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import { transformAvatarCollisionProxy, type SimulationBodyTransform } from "../physics/bodyCollision";

export function createAvatarCollisionDebugVisual(
  model: AvatarCollisionModel,
  transform: SimulationBodyTransform,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "avatar:collision-debug";
  const material = new THREE.MeshBasicMaterial({
    wireframe: true,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  for (const original of model.proxies) {
    const proxy = transformAvatarCollisionProxy(original, transform);
    if (proxy.kind === "ellipsoid") {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), material.clone());
      mesh.name = `body-collider:${proxy.id}`;
      mesh.position.set(...proxy.center);
      mesh.scale.set(...proxy.radii);
      group.add(mesh);
      continue;
    }
    const start = new THREE.Vector3(...proxy.start);
    const end = new THREE.Vector3(...proxy.end);
    const axis = end.clone().sub(start);
    const length = axis.length();
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(proxy.radius, length, 8, 16),
      material.clone(),
    );
    mesh.name = `body-collider:${proxy.id}`;
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    if (length > 1e-8) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    group.add(mesh);
  }
  material.dispose();
  return group;
}
