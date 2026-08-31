import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { applyAuthoredArrangementToAssemblyState, arrangementVisualState, captureMeshArrangement, placeMeshCentroid, resolveArrangementTransform } from "./ArrangementWorkspace";

const placement = {
  id: "panel:1",
  pieceId: "panel",
  region: "custom" as const,
  surface: "custom" as const,
  bodySide: "center" as const,
  rotationDeg: 0,
  offsetXMm: 0,
  offsetYMm: 0,
  offsetZMm: 0,
  scale: 1,
  positionMm: [100, 1_000, -200] as [number, number, number],
  orientationDeg: [10, 20, 30] as [number, number, number],
  presentationMode: "authored" as const,
};

describe("canonical 3D arrangement workspace", () => {
  it("uses millimetres without autoscale and round-trips one rigid transform", () => {
    const avatar = {} as AvatarParametricModel;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.001));
    const transform = resolveArrangementTransform(placement, avatar);
    placeMeshCentroid(mesh, transform);
    const captured = captureMeshArrangement(placement.id, mesh);

    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(captured.positionMm[0]).toBeCloseTo(100, 5);
    expect(captured.positionMm[1]).toBeCloseTo(1_000, 5);
    expect(captured.positionMm[2]).toBeCloseTo(-200, 5);
    expect(captured.orientationDeg).toEqual(expect.arrayContaining([
      expect.closeTo(10, 5),
      expect.closeTo(20, 5),
      expect.closeTo(30, 5),
    ]));
  });

  it("derives presentation state rather than persisting simulation lifecycle", () => {
    expect(arrangementVisualState({ ...placement, presentationMode: "staging" }, false)).toBe("POSICIONAR");
    expect(arrangementVisualState(placement, false)).toBe("AJUSTADO");
    expect(arrangementVisualState(placement, true)).toBe("SIMULADO");
  });

  it("applies the authored pose to STEP 0 as a metric-preserving rigid transform", () => {
    const positions = new Float32Array([0, 0, 0, 0.1, 0, 0, 0.1, 0.2, 0, 0, 0.2, 0]);
    const state = {
      positions: new Float32Array(positions),
      initialPositions: new Float32Array(positions),
      previousPositions: new Float32Array(positions),
      instances: [{
        id: placement.id,
        particleStart: 0,
        vertexCount: 4,
        topology: { positions2DMm: new Float32Array([0, 0, 100, 0, 100, 200, 0, 200]) },
      }],
    } as unknown as GarmentAssemblyState;
    const input = {
      garmentProjection: { pieces: [{ previewPlacements: [placement] }] },
    } as unknown as ResolvedAssemblyInput;

    applyAuthoredArrangementToAssemblyState(state, input, {} as AvatarParametricModel);
    const distance = Math.hypot(
      state.positions[3] - state.positions[0],
      state.positions[4] - state.positions[1],
      state.positions[5] - state.positions[2],
    );
    const centroid = [0, 0, 0];
    for (let index = 0; index < 4; index += 1) {
      centroid[0] += state.positions[index * 3] / 4;
      centroid[1] += state.positions[index * 3 + 1] / 4;
      centroid[2] += state.positions[index * 3 + 2] / 4;
    }
    expect(distance).toBeCloseTo(0.1, 6);
    expect(centroid).toEqual(expect.arrayContaining([
      expect.closeTo(0.1, 6),
      expect.closeTo(1, 6),
      expect.closeTo(-0.2, 6),
    ]));
  });
});
