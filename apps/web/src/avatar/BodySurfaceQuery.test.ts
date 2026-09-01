import { describe, expect, it } from "vitest";
import type { HumanBodyMesh } from "./HumanBodyModel";
import { closestBodySurfacePoint, prepareBodySurfaceQuery, raycastBodySurface, resolveBodySurfaceAttachment } from "./BodySurfaceQuery";

describe("canonical body surface query", () => {
  it("persists and reconstructs the same continuous visual-mesh hit", () => {
    const body = planarBody();
    const hit = raycastBodySurface(body, [0, 0, 2], [0, 0, -1], 12);
    expect(hit).not.toBeNull();
    const reconstructed = resolveBodySurfaceAttachment(body, hit!.attachment);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.position).toEqual(hit!.position);
    expect(hit!.attachment.barycentric.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
    expect(Math.hypot(...hit!.outwardNormal)).toBeCloseTo(1, 6);
  });

  it("keeps positive clearance outside even when source vertex normals point inward", () => {
    const body = inwardPlanarBody();
    const hit = raycastBodySurface(body, [0, 0, 2], [0, 0, -1], 12);
    expect(hit).not.toBeNull();
    expect(hit!.outwardNormal[2]).toBeGreaterThan(0.99);
    expect(hit!.position[2]).toBeCloseTo(1.012, 6);

    const flippedFaceAttachment = { ...hit!.attachment, normalOffsetMm: 20 };
    const reconstructed = resolveBodySurfaceAttachment(body, flippedFaceAttachment);
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.outwardNormal[2]).toBeGreaterThan(0.99);
    expect(reconstructed!.position[2]).toBeCloseTo(1.02, 6);
  });

  it("honors a bounded ray distance for interaction queries", () => {
    const body = planarBody();
    expect(raycastBodySurface(body, [0, 0, 2], [0, 0, -1], 12, 0.5)).toBeNull();
    expect(raycastBodySurface(body, [0, 0, 0.25], [0, 0, -1], 12, 0.5)).not.toBeNull();
  });

  it("prewarms and reuses the accelerated nearest-point query", () => {
    const body = planarBody();
    prepareBodySurfaceQuery(body);
    const nearest = closestBodySurfacePoint(body, [0.1, 0.1, 0.2], 0, 0.5);
    expect(nearest).not.toBeNull();
    expect(nearest!.position[2]).toBeCloseTo(0, 6);
    expect(nearest!.outwardNormal[2]).toBeGreaterThan(0.99);
    for (let index = 0; index < 20; index += 1) {
      expect(raycastBodySurface(body, [0, 0, 0.25], [0, 0, -1], 8, 0.5)).not.toBeNull();
    }
  });

  it("rejects an attachment from another topology", () => {
    const body = planarBody();
    expect(resolveBodySurfaceAttachment(body, {
      version: 1,
      topologySignature: "another-topology",
      triangleIndex: 0,
      barycentric: [1, 0, 0],
      normalOffsetMm: 0,
    })).toBeNull();
  });
});

function planarBody(): HumanBodyMesh {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    regionIds: ["chest-front", "chest-front", "chest-front"],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    topologySignature: "planar-body",
    sourceAssetId: "canonical-female.glb",
  };
}

function inwardPlanarBody(): HumanBodyMesh {
  return {
    positions: new Float32Array([-1, -1, 1, 1, -1, 1, 0, 1, 1]),
    normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1]),
    indices: new Uint32Array([0, 1, 2]),
    regionIds: ["chest-front", "chest-front", "chest-front"],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    topologySignature: "inward-planar-body",
    sourceAssetId: "canonical-female.glb",
  };
}
