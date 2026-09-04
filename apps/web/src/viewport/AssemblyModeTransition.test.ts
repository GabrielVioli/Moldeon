import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type PatternPiece } from "../domain/pattern";
import {
  adoptGarmentAssemblyMesh,
  buildGarmentAssemblyMeshes,
} from "../garment3d/GarmentThreeBridge";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { buildResolvedGarmentAssembly } from "../garment3d/ResolvedGarmentAssembly";
import {
  applyWorkspaceAssemblySeed,
  assemblyPositionSignature,
  captureAssemblyTransitionDiagnostic,
  captureWorkspaceAssemblySeed,
} from "./AssemblyModeTransition";

describe("Montar to Provar assembly transition", () => {
  it("uses the visible STEP-0 world geometry as the untouched simulation initial state", () => {
    const input = rectangleTubeInput(1020, 300);
    const workspace = buildResolvedGarmentAssembly(input);
    const meshes = buildGarmentAssemblyMeshes(workspace, input.garmentProjection, {
      castShadow: false,
      receiveShadow: false,
    });
    const instance = workspace.instances[0];
    const mesh = meshes[0].mesh;
    const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const radiusM = 1.02 / (2 * Math.PI);
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const uMm = instance.topology.positions2DMm[local * 2];
      const vMm = instance.topology.positions2DMm[local * 2 + 1];
      const angle = uMm / 1_020 * Math.PI * 2;
      position.setXYZ(
        local,
        Math.sin(angle) * radiusM,
        (150 - vMm) * 0.001,
        Math.cos(angle) * radiusM,
      );
    }
    position.needsUpdate = true;
    mesh.position.set(0.03, 1.02, -0.04);
    mesh.rotation.y = 0.17;
    mesh.updateMatrixWorld(true);

    const capture = captureWorkspaceAssemblySeed(workspace, meshes, input, "workspace");
    expect(capture).not.toBeNull();
    expect(capture!.diagnostic.seamResiduals.maxResidualMm).toBeLessThan(2);

    // Represents the independent simulation worker solve that previously won
    // the transition and could place the closed cycle above the avatar.
    const simulation = buildResolvedGarmentAssembly(input);
    for (let offset = 1; offset < simulation.positions.length; offset += 3) {
      simulation.positions[offset] += 2.4;
      simulation.initialPositions[offset] += 2.4;
      simulation.previousPositions[offset] += 2.4;
    }
    const workerSignature = assemblyPositionSignature(simulation.positions);
    const transfer = applyWorkspaceAssemblySeed(simulation, capture!.seed, input);
    const transferred = captureAssemblyTransitionDiagnostic(
      simulation,
      input,
      "workspace-seed-transfer",
      input.simulationRevision,
      "workspace-seed-transfer",
    );

    expect(transfer).toEqual({
      applied: true,
      reason: "applied",
      transferredInstanceIds: [instance.id],
    });
    expect(transferred.positionSignature).toBe(capture!.diagnostic.positionSignature);
    expect(transferred.positionSignature).not.toBe(workerSignature);
    expect(transferred.garmentCentroid).toEqual(capture!.diagnostic.garmentCentroid);
    expect(transferred.garmentBoundingBox).toEqual(capture!.diagnostic.garmentBoundingBox);
    expect(transferred.seamResiduals).toEqual(capture!.diagnostic.seamResiduals);
    expect(transferred.garmentBoundingBox.max[1]).toBeLessThan(1.3);
    expect(transferred.garmentBoundingBox.min[1]).toBeGreaterThan(0.8);
    expect(Array.from(simulation.initialPositions)).toEqual(Array.from(simulation.positions));
    expect(Array.from(simulation.previousPositions)).toEqual(Array.from(simulation.positions));
  });

  it("does not retain the workspace transform over world-space fitting geometry", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const workspaceMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    workspaceMesh.position.set(0, 1.1, 0);
    workspaceMesh.rotation.y = 0.4;

    const fittingGeometry = geometry.clone();
    const fittingMesh = new THREE.Mesh(fittingGeometry, new THREE.MeshBasicMaterial());
    fittingMesh.position.set(0, 0, 0);
    fittingMesh.quaternion.identity();
    fittingMesh.scale.set(1, 1, 1);

    adoptGarmentAssemblyMesh(workspaceMesh, fittingMesh);

    expect(workspaceMesh.position.toArray()).toEqual([0, 0, 0]);
    expect(workspaceMesh.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(workspaceMesh.scale.toArray()).toEqual([1, 1, 1]);
  });
});

function rectangleTubeInput(widthMm: number, heightMm: number) {
  const piece: PatternPiece = {
    id: "transition-rectangle",
    name: "transition-rectangle",
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points: [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: widthMm, yMm: 0 },
      { id: "c", xMm: widthMm, yMm: heightMm },
      { id: "d", xMm: 0, yMm: heightMm },
    ],
  };
  const edges = getPatternEdges(piece);
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  return buildResolvedAssemblyInput({
    ...blank,
    fabrics: [fabric],
    pieces: [{ ...piece, fabricId: fabric.id }],
    seams: [{
      id: "transition-tube-seam",
      name: "transition-tube-seam",
      first: { pieceId: piece.id, edgeId: edges[1].id, startT: 0, endT: 1 },
      second: { pieceId: piece.id, edgeId: edges[3].id, startT: 0, endT: 1 },
      direction: "opposite" as const,
      easeRatio: 0,
      type: "standard",
      active: true,
    }],
  });
}
