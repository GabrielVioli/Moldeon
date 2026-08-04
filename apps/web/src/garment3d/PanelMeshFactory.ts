import * as THREE from "three";
import type { GarmentDraft, PatternPiece, PatternPreviewPlacement } from "../domain/pattern";
import type { FabricSource } from "../domain/fabric";
import {
  buildPanelTopology,
  getEdgeVertexRange,
  resampleEdgeVertices,
  type PanelTopology,
} from "./PanelTopology";
import { buildSelfSeamConstraints } from "./StitchConstraintBuilder";
import { initializePanelSimulation, simulatePanel, type PanelSimulationState } from "./PanelSimulation";
import { buildMeshFromSimulation } from "./ThreeGeometryBridge";

export interface PanelMeshResult {
  mesh: THREE.Mesh;
  topology: PanelTopology;
  simulation?: PanelSimulationState;
}

export function buildPanelMeshForPiece(
  piece: PatternPiece,
  garment: GarmentDraft,
  placement: PatternPreviewPlacement,
  fabric: FabricSource,
): PanelMeshResult {
  const topology = buildPanelTopology(piece);
  const selfConstraints = buildSelfSeamConstraints(garment);
  if (selfConstraints.length > 0) {
    const state = initializePanelSimulation(topology, selfConstraints);
    simulatePanel(state);
    const mesh = buildMeshFromSimulation(state);
    positionMesh(mesh, placement);
    return { mesh, topology, simulation: state };
  }

  const mesh = buildFallbackMesh(piece, placement, fabric, topology);
  return { mesh, topology };
}

function positionMesh(mesh: THREE.Mesh, placement: PatternPreviewPlacement) {
  const rotation = THREE.MathUtils.degToRad(placement.rotationDeg);
  mesh.rotation.set(0, rotation, 0);
  if (placement.mirrorX) {
    mesh.scale.x = -1;
  }
  mesh.position.set(
    placement.offsetXMm * 0.001,
    placement.offsetYMm * 0.001,
    placement.offsetZMm * 0.001,
  );
}

function buildFallbackMesh(
  piece: PatternPiece,
  placement: PatternPreviewPlacement,
  fabric: FabricSource,
  topology: PanelTopology,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(topology.positions2D, 2),
  );
  geometry.setIndex(Array.from(topology.triangles));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(fabric.color),
    roughness: THREE.MathUtils.clamp(
      0.48 + fabric.physics.friction * 0.45,
      0.48,
      0.95,
    ),
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  positionMesh(mesh, placement);
  return mesh;
}
