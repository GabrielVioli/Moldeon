import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";
import {
  measureCurrentSewingStep0Residual,
  solvePlacementAnchoredSewingStep0,
  type SewingStep0Target,
} from "./SewingStep0";

function quadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -0.05, -0.1, 0,
     0.05, -0.1, 0,
     0.05,  0.1, 0,
    -0.05,  0.1, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function meshData(key: string, x: number, z: number): GarmentAssemblyMeshData {
  const mesh = new THREE.Mesh(quadGeometry(), new THREE.MeshBasicMaterial());
  mesh.position.set(x, 1, z);
  mesh.updateMatrixWorld(true);
  return {
    key,
    mesh,
    flat: new Float32Array(mesh.geometry.getAttribute("position").array as Float32Array),
    dressed: new Float32Array(mesh.geometry.getAttribute("position").array as Float32Array),
  } as unknown as GarmentAssemblyMeshData;
}

function state(): GarmentAssemblyState {
  const structural = [
    [0, 1, 0.1], [1, 2, 0.2], [2, 3, 0.1], [3, 0, 0.2], [0, 2, Math.hypot(0.1, 0.2)],
    [4, 5, 0.1], [5, 6, 0.2], [6, 7, 0.1], [7, 4, 0.2], [4, 6, Math.hypot(0.1, 0.2)],
  ].map(([a, b, restLength]) => ({ a, b, restLength, stiffness: 1 }));
  const seam = (id: string, a: number, b: number) => ({
    id,
    seamId: "side",
    seamGroupId: "side",
    treatment: "plain",
    distribution: "uniform" as const,
    targetRatio: 1,
    slackMm: 0,
    a: { particleIndices: [a], weights: [1] },
    b: { particleIndices: [b], weights: [1] },
    restDistance: 0,
    physicalRestDistance: 0,
    stiffness: 1,
    instanceA: "front",
    instanceB: "back",
  });
  return {
    positions: new Float32Array(8 * 3),
    initialPositions: new Float32Array(8 * 3),
    previousPositions: new Float32Array(8 * 3),
    inverseMasses: new Float32Array(8),
    instances: [
      { id: "front", particleStart: 0, vertexCount: 4, topology: {} },
      { id: "back", particleStart: 4, vertexCount: 4, topology: {} },
    ] as GarmentAssemblyState["instances"],
    structuralConstraints: structural,
    stitchConstraints: [seam("low", 1, 4), seam("high", 2, 7)],
    anchorConstraints: [],
    warnings: [],
    invalid: false,
  };
}

const target: SewingStep0Target = { rootInstanceId: "front", instanceIds: ["front", "back"] };

describe("placement-anchored STEP-0", () => {
  it("improves sewn boundaries without replacing either manually authored transform", () => {
    const assembly = state();
    const front = meshData("front", -0.07, 0.11);
    const back = meshData("back", 0.07, -0.11);
    const meshes = [front, back];
    const frontPosition = front.mesh.position.clone();
    const backPosition = back.mesh.position.clone();
    const before = measureCurrentSewingStep0Residual(assembly, meshes, target)!;
    const proposal = solvePlacementAnchoredSewingStep0(assembly, meshes, target, {
      iterations: 72,
      maximumVertexDisplacementM: 0.065,
      maximumCentroidDisplacementM: 0.018,
    });

    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.meanM).toBeLessThan(before.meanM);
    expect(proposal!.maximumCentroidDisplacementM).toBeLessThanOrEqual(0.018001);
    expect(proposal!.maximumVertexDisplacementM).toBeLessThanOrEqual(0.065001);
    expect(proposal!.metricDistortionMax).toBeLessThan(0.025);
    expect(front.mesh.position.toArray()).toEqual(frontPosition.toArray());
    expect(back.mesh.position.toArray()).toEqual(backPosition.toArray());
    expect(front.mesh.position.z).toBeGreaterThan(0);
    expect(back.mesh.position.z).toBeLessThan(0);
  });

  it("closes a same-panel relation locally instead of requiring a second placement system", () => {
    const assembly = state();
    assembly.instances = [assembly.instances[0]];
    assembly.structuralConstraints = assembly.structuralConstraints.slice(0, 5);
    assembly.stitchConstraints = [{
      ...assembly.stitchConstraints[0],
      seamId: "strap-loop",
      seamGroupId: "strap-loop",
      instanceA: "front",
      instanceB: "front",
      a: { particleIndices: [0], weights: [1] },
      b: { particleIndices: [1], weights: [1] },
    }];
    const front = meshData("front", 0, 0.12);
    const selfTarget: SewingStep0Target = { rootInstanceId: "front", instanceIds: ["front"] };
    const before = measureCurrentSewingStep0Residual(assembly, [front], selfTarget)!;
    const proposal = solvePlacementAnchoredSewingStep0(assembly, [front], selfTarget, { iterations: 72 });
    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.meanM).toBeLessThan(before.meanM);
    expect(front.mesh.position.z).toBeCloseTo(0.12, 8);
  });
});
