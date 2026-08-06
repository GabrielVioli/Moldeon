import { describe, expect, it } from "vitest";
import type { ClothSimulationInput } from "./clothXpbd";
import { clothInputTransferables, stitchTransferables } from "./ClothWorkerProtocol";

function distance(count: number) {
  return {
    a: new Uint32Array(count),
    b: new Uint32Array(count),
    restLength: new Float32Array(count),
    compliance: new Float32Array(count),
    lambda: new Float32Array(count),
  };
}

function stitches(count: number) {
  return {
    aIndices: new Uint32Array(count * 2),
    aWeights: new Float32Array(count * 2),
    bIndices: new Uint32Array(count * 2),
    bWeights: new Float32Array(count * 2),
    restDistance: new Float32Array(count),
    compliance: new Float32Array(count),
    lambda: new Float32Array(count),
  };
}

describe("ClothWorkerProtocol", () => {
  it("collects every typed buffer exactly once for zero-copy transfer", () => {
    const stitchBuffer = stitches(2);
    const input: ClothSimulationInput = {
      positions: new Float32Array(12),
      inverseMasses: new Float32Array(4),
      restPositions2D: new Float32Array(8),
      triangles: new Uint32Array([0, 1, 2, 1, 3, 2]),
      materialCoordinates: new Float32Array(8),
      constraints: {
        warp: distance(1),
        weft: distance(1),
        shear: distance(1),
        bend: distance(1),
        stitches: stitchBuffer,
        anchors: {
          particle: new Uint32Array([0]),
          target: new Float32Array([0, 0, 0]),
          compliance: new Float32Array([0]),
          lambda: new Float32Array([0]),
        },
      },
    };

    const transferables = clothInputTransferables(input);
    expect(transferables.length).toBe(new Set(transferables).size);
    expect(transferables).toContain(input.positions.buffer);
    expect(transferables).toContain(input.triangles.buffer);
    expect(transferables).toContain(stitchBuffer.aIndices.buffer);
    expect(transferables).toContain(input.constraints.anchors.target.buffer);
    expect(stitchTransferables(stitchBuffer)).toHaveLength(7);
  });

  it("rejects SharedArrayBuffer views in the transferable fallback", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const stitchBuffer = stitches(0);
    stitchBuffer.aIndices = new Uint32Array(new SharedArrayBuffer(0)) as unknown as Uint32Array<ArrayBuffer>;
    expect(() => stitchTransferables(stitchBuffer)).toThrow(/ArrayBuffer próprios/i);
  });
});
