import { describe, expect, it } from "vitest";
import type { FabricPhysics } from "../domain/fabric";
import type { GarmentDraft } from "../domain/pattern";
import type { GarmentAssemblyState } from "./GarmentAssembly";
import { buildClothSimulationInput } from "./ClothSimulationInput";

const cotton: FabricPhysics = {
  weightGsm: 165,
  thicknessMm: 0.42,
  stretchWarpPercent: 2,
  stretchWeftPercent: 5,
  bending: 0.46,
  friction: 0.5,
};

describe("buildClothSimulationInput", () => {
  it("converts semantic assembly data into transferable SoA buffers without mutating the source", () => {
    const positions = new Float32Array([
      0, 1, 0,
      1, 1, 0,
      0, 0, 0,
      1, 0, 0,
    ]);
    const state = {
      positions,
      initialPositions: new Float32Array(positions),
      previousPositions: new Float32Array(positions),
      inverseMasses: new Float32Array([1, 1, 1, 1]),
      instances: [{
        id: "front/copy-1",
        pieceId: "front",
        placement: { id: "copy-1" },
        particleStart: 0,
        vertexCount: 4,
        topology: {
          positions2DMm: new Float32Array([0, 0, 1000, 0, 0, 1000, 1000, 1000]),
          triangles: new Uint32Array([0, 1, 2, 1, 3, 2]),
        },
      }],
      structuralConstraints: [
        { a: 0, b: 1, restLength: 1, stiffness: 1 },
        { a: 0, b: 2, restLength: 1, stiffness: 1 },
        { a: 0, b: 3, restLength: Math.SQRT2, stiffness: 1 },
      ],
      stitchConstraints: [{
        id: "stitch-1",
        seamId: "side",
        a: { particleIndices: [0, 1], weights: [0.25, 0.75] },
        b: { particleIndices: [2], weights: [1] },
        restDistance: 0.01,
        stiffness: 0.95,
      }],
      anchorConstraints: [{
        particleIndex: 0,
        targetX: 0,
        targetY: 1,
        targetZ: 0,
        stiffness: 1,
      }],
      warnings: [],
      invalid: false,
    } as unknown as GarmentAssemblyState;
    const garment = {
      pieces: [{ id: "front", fabricId: "cotton" }],
      fabrics: [{ id: "cotton", name: "Algodão", color: "#ffffff", physics: cotton }],
    } as unknown as GarmentDraft;

    const input = buildClothSimulationInput(state, garment);

    expect(input.positions).not.toBe(state.positions);
    expect(input.positions).toEqual(state.positions);
    expect(input.restPositions2D).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
    expect(input.triangles).toEqual(new Uint32Array([0, 1, 2, 1, 3, 2]));
    expect(input.constraints.weft.a.length).toBe(1);
    expect(input.constraints.warp.a.length).toBe(1);
    expect(input.constraints.shear.a.length).toBe(1);
    expect(input.constraints.bend.a.length).toBe(1);
    expect(input.constraints.stitches.aWeights).toEqual(new Float32Array([0.25, 0.75]));
    expect(input.constraints.stitches.bWeights).toEqual(new Float32Array([1, 0]));
    expect(input.constraints.anchors.particle).toEqual(new Uint32Array([0]));
    expect(state.positions).toEqual(positions);
  });

  it("rejects non-normalized interpolated seam references", () => {
    const state = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0]),
      initialPositions: new Float32Array([0, 0, 0, 1, 0, 0]),
      previousPositions: new Float32Array([0, 0, 0, 1, 0, 0]),
      inverseMasses: new Float32Array([1, 1]),
      instances: [],
      structuralConstraints: [],
      stitchConstraints: [{
        id: "bad",
        seamId: "bad",
        a: { particleIndices: [0, 1], weights: [0.25, 0.25] },
        b: { particleIndices: [1], weights: [1] },
        restDistance: 0,
        stiffness: 1,
      }],
      anchorConstraints: [],
      warnings: [],
      invalid: false,
    } as unknown as GarmentAssemblyState;
    const garment = { pieces: [], fabrics: [] } as unknown as GarmentDraft;

    expect(() => buildClothSimulationInput(state, garment)).toThrow(/somar um/i);
  });
});
