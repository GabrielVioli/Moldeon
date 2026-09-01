import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import { adjustMeshToBodySurface, captureMeshArrangement } from "./ArrangementWorkspace";

describe("Adjust-to-body placement invariants", () => {
  it("keeps the authored arrangement pivot and orientation exactly while conforming", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const reference = new Float32Array(
      (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array,
    );

    mesh.position.set(0.25, 0.1, 0.02);
    mesh.rotation.set(0, 0, 0.35);
    mesh.updateMatrixWorld(true);

    const before = captureMeshArrangement("panel", mesh);
    const beforePosition = mesh.position.clone();
    const beforeOrientation = mesh.quaternion.clone();

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference);
    const after = captureMeshArrangement("panel", mesh, result.surfaceAttachment);

    expect(result.conformed).toBe(true);
    expect(result.anchorTangentialDisplacementMm).toBeLessThan(1e-4);
    expect(Math.abs(result.anchorNormalDisplacementMm)).toBeLessThan(1e-4);
    expect(mesh.position.distanceTo(beforePosition)).toBeLessThan(1e-10);
    expect(mesh.quaternion.angleTo(beforeOrientation)).toBeLessThan(1e-7);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(after.positionMm[axis]).toBeCloseTo(before.positionMm[axis], 6);
      expect(after.orientationDeg[axis]).toBeCloseTo(before.orientationDeg[axis], 6);
    }
  });

  it("refuses to relocate a panel whose authored pivot is already inside the body", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const beforeGeometry = Array.from(
      (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array,
    );

    mesh.position.set(0.2, 0.1, -0.01);
    mesh.rotation.set(0.05, -0.1, 0.2);
    mesh.updateMatrixWorld(true);

    const beforePosition = mesh.position.clone();
    const beforeOrientation = mesh.quaternion.clone();
    const before = captureMeshArrangement("panel", mesh);

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, new Float32Array(beforeGeometry));
    const after = captureMeshArrangement("panel", mesh);

    expect(result.conformed).toBe(false);
    expect(result.reason).toBe("clearance");
    expect(Array.from((geometry.getAttribute("position") as THREE.BufferAttribute).array)).toEqual(beforeGeometry);
    expect(mesh.position.distanceTo(beforePosition)).toBeLessThan(1e-10);
    expect(mesh.quaternion.angleTo(beforeOrientation)).toBeLessThan(1e-7);
    expect(after.positionMm).toEqual(before.positionMm);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(after.orientationDeg[axis]).toBeCloseTo(before.orientationDeg[axis], 6);
    }
  });
});

function planarBody(): HumanBodyMesh {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    regionIds: ["chest-front", "chest-front", "chest-front"],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    topologySignature: "body",
    sourceAssetId: "canonical-female.glb",
  };
}
