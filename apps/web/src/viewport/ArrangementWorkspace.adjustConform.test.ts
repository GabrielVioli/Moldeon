import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import { adjustMeshToBodySurface, captureMeshArrangement } from "./ArrangementWorkspace";

describe("Adjust-to-body placement invariants", () => {
  it("preserves tangential placement and orientation while moving only along the body normal", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const reference = new Float32Array(
      (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array,
    );

    mesh.position.set(0.25, 0.1, 0.08);
    mesh.rotation.set(0, 0, 0.35);
    mesh.updateMatrixWorld(true);
    const before = captureMeshArrangement("panel", mesh);
    const beforeOrientation = mesh.quaternion.clone();

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference, { captureDistanceMm: 240 });
    const after = captureMeshArrangement("panel", mesh, result.surfaceAttachment);

    expect(result.conformed).toBe(true);
    expect(result.anchorTangentialDisplacementMm).toBeLessThan(0.05);
    expect(result.anchorNormalDisplacementMm).toBeCloseTo(-68, 3);
    expect(mesh.quaternion.angleTo(beforeOrientation)).toBeLessThan(1e-7);
    expect(after.positionMm[0]).toBeCloseTo(before.positionMm[0], 5);
    expect(after.positionMm[1]).toBeCloseTo(before.positionMm[1], 5);
    expect(after.positionMm[2]).toBeCloseTo(12, 3);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(after.orientationDeg[axis]).toBeCloseTo(before.orientationDeg[axis], 6);
    }
  });

  it("brings an inside pivot outward along the normal without tangential teleport", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const reference = new Float32Array(
      (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array,
    );

    mesh.position.set(0.2, 0.1, -0.01);
    mesh.rotation.set(0, 0, 0.2);
    mesh.updateMatrixWorld(true);
    const before = captureMeshArrangement("panel", mesh);
    const beforeOrientation = mesh.quaternion.clone();

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference, { captureDistanceMm: 240 });
    const after = captureMeshArrangement("panel", mesh, result.surfaceAttachment);

    expect(result.conformed).toBe(true);
    expect(result.anchorTangentialDisplacementMm).toBeLessThan(0.05);
    expect(result.anchorNormalDisplacementMm).toBeCloseTo(22, 3);
    expect(after.positionMm[0]).toBeCloseTo(before.positionMm[0], 5);
    expect(after.positionMm[1]).toBeCloseTo(before.positionMm[1], 5);
    expect(after.positionMm[2]).toBeCloseTo(12, 3);
    expect(mesh.quaternion.angleTo(beforeOrientation)).toBeLessThan(1e-7);
  });

  it("still refuses a genuinely distant panel without changing it", () => {
    const body = planarBody();
    const geometry = new THREE.PlaneGeometry(0.1, 0.1, 1, 1);
    const mesh = new THREE.Mesh(geometry);
    const reference = new Float32Array(
      (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array,
    );
    mesh.position.set(0.1, 0.1, 0.4);
    mesh.rotation.set(0.1, 0.2, 0.3);
    mesh.updateMatrixWorld(true);
    const before = captureMeshArrangement("panel", mesh);
    const beforeQuaternion = mesh.quaternion.clone();

    const result = adjustMeshToBodySurface(mesh, body, {
      version: 1,
      topologySignature: body.topologySignature,
      triangleIndex: 0,
      barycentric: [0.25, 0.25, 0.5],
      normalOffsetMm: 12,
    }, reference, { captureDistanceMm: 240 });
    const after = captureMeshArrangement("panel", mesh);

    expect(result.conformed).toBe(false);
    expect(result.reason).toBe("too-far");
    expect(after.positionMm).toEqual(before.positionMm);
    expect(mesh.quaternion.angleTo(beforeQuaternion)).toBeLessThan(1e-7);
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
