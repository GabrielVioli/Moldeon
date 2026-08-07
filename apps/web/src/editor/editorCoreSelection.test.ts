import { beforeEach, describe, expect, it } from "vitest";
import type { GarmentDraft, PatternPiece } from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";
import {
  clearCompleteEditorSelection,
  hasCompleteEditorSelection,
} from "./editorCoreSelection";

const piece: PatternPiece = {
  id: "selection-piece",
  name: "Seleção",
  seamAllowanceMm: 0,
  points: [
    { id: "a", xMm: 0, yMm: 0 },
    { id: "b", xMm: 100, yMm: 0 },
    { id: "c", xMm: 100, yMm: 100 },
    { id: "d", xMm: 0, yMm: 100 },
  ],
};

function garment(): GarmentDraft {
  const current = useEditorStore.getState().garment;
  return {
    ...structuredClone(current),
    id: "selection-test",
    name: "Seleção",
    pieces: [piece],
    seams: [],
    workspaceStates: [
      {
        pieceId: piece.id,
        transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
        visible: true,
        locked: false,
      },
    ],
  };
}

describe("editor core complete selection clear", () => {
  beforeEach(() => {
    useEditorStore.getState().loadGarment(garment());
    useInternalPathEditorStore.setState({
      draftPathId: null,
      selectedPathId: null,
      selectedNodeId: null,
      selectedSegmentId: null,
      analysis: null,
    });
  });

  it("reports selection across both editor stores", () => {
    expect(hasCompleteEditorSelection()).toBe(false);
    useInternalPathEditorStore.setState({ selectedPathId: "internal-path" });
    expect(hasCompleteEditorSelection()).toBe(true);
  });

  it("does not leave invisible ids after clearing", () => {
    useEditorStore.setState({
      selectedPointId: "a",
      selectedEdgeId: "edge",
      selectedSeamId: "seam",
      selectedDartId: "dart",
      selectedPieceIds: [piece.id],
      pieceSelectionActive: true,
    });
    useInternalPathEditorStore.setState({
      selectedPathId: "path",
      selectedNodeId: "node",
      selectedSegmentId: "segment",
    });
    clearCompleteEditorSelection(useEditorStore.getState().clearSelection);
    expect(hasCompleteEditorSelection()).toBe(false);
  });
});
