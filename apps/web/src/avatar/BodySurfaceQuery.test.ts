import { describe, expect, it } from "vitest";
import type { HumanBodyMesh } from "./HumanBodyModel";
import { raycastBodySurface, resolveBodySurfaceAttachment } from "./BodySurfaceQuery";

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
    bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
    topologySignature: "planar-body",
    sourceAssetId: "canonical-female.glb",
  };
}
