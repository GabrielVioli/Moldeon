import { describe, expect, it } from "vitest";
import {
  getPatternEdges,
  type GarmentDraft,
  type PatternPiece,
  type Seam,
} from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { findNearestSeamHit } from "./canvasHitTesting";

function sewnGarment() {
  const piece: PatternPiece = {
    id: "sewn-piece",
    name: "Peça costurada",
    seamAllowanceMm: 0,
    points: [
      { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 10, yMm: 0 } },
      { id: "b", xMm: 100, yMm: 0 },
      { id: "c", xMm: 100, yMm: 100 },
      { id: "d", xMm: 0, yMm: 100 },
    ],
  };
  const edges = getPatternEdges(piece);
  const seam: Seam = {
    id: "seam-a",
    name: "Costura A",
    first: { pieceId: piece.id, edgeId: edges[0].id, startT: 0, endT: 1 },
    second: { pieceId: piece.id, edgeId: edges[2].id, startT: 0, endT: 1 },
    direction: "same",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  const current = useEditorStore.getState().garment;
  const garment: GarmentDraft = {
    ...structuredClone(current),
    id: "sewn-hit-test",
    name: "Seam hit priority",
    pieces: [piece],
    seams: [seam],
    workspaceTransforms: [],
    workspaceStates: [
      {
        pieceId: piece.id,
        transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
        visible: true,
        locked: false,
      },
    ],
  };
  return { garment, seam };
}

describe("canvas seam hit priority", () => {
  it("does not let a seam steal a point hit on its own edge", () => {
    const { garment } = sewnGarment();
    expect(findNearestSeamHit(garment, { xMm: 0, yMm: 0 }, 12)).toBeNull();
  });

  it("does not let a seam steal a Bezier handle hit", () => {
    const { garment } = sewnGarment();
    expect(findNearestSeamHit(garment, { xMm: 10, yMm: 0 }, 12)).toBeNull();
  });

  it("keeps the seam selectable away from editable controls", () => {
    const { garment, seam } = sewnGarment();
    expect(findNearestSeamHit(garment, { xMm: 55, yMm: 0 }, 8)?.seam.id).toBe(
      seam.id,
    );
  });
});
