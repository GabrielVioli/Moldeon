import * as THREE from "three";
import type { PanelSimulationState } from "./PanelSimulation";

export function buildMeshFromSimulation(state: PanelSimulationState): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(state.positions, 3),
  );
  geometry.setIndex(Array.from(state.topology.triangles));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x9b6a42),
      side: THREE.DoubleSide,
    }),
  );
}
