import { beforeEach, describe, expect, it } from "vitest";
import type { GarmentDraft, PatternPiece } from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";
import {
  clearEditorSelection,
  hasEditorSelection,
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

describe("editor core authoritative selection clear", () => {
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

  it("reports selection across primary and auxiliary editor state", () => {
    expect(hasEditorSelection()).toBe(false);
    useInternalPathEditorStore.setState({ selectedPathId: "internal-path" });
    expect(hasEditorSelection()).toBe(true);
    useInternalPathEditorStore.getState().selectPath(null);
    useEditorStore.setState({
      seamFirstEdge: {
        pieceId: piece.id,
        edgeId: "edge-a",
        startT: 0,
        endT: 1,
      },
    });
    expect(hasEditorSelection()).toBe(true);
  });

  it("clears every persistent selection id and derived flag through one action", () => {
    const edge = {
      pieceId: piece.id,
      edgeId: "edge-a",
      startT: 0,
      endT: 1,
    };
    useEditorStore.setState({
      selectedPointId: "a",
      selectedEdgeId: "edge-a",
      selectedSeamId: "seam-a",
      selectedDartId: "dart-a",
      selectedPieceIds: [piece.id],
      pieceSelectionActive: true,
      seamFirstEdge: edge,
      seamProposal: {
        first: edge,
        second: { ...edge, edgeId: "edge-b" },
        compatibility: {
          compatible: true,
          firstLengthMm: 100,
          secondLengthMm: 100,
          differenceMm: 0,
          differencePercent: 0,
          recommendedTreatment: "standard",
          recommendedDirection: "opposite",
          message: "Compatível",
        },
      },
      nearbySeamSuggestion: {
        first: edge,
        second: { ...edge, edgeId: "edge-b" },
      },
    });
    useInternalPathEditorStore.setState({
      selectedPathId: "path-a",
      selectedNodeId: "node-a",
      selectedSegmentId: "segment-a",
    });

    clearEditorSelection();

    const editor = useEditorStore.getState();
    const internal = useInternalPathEditorStore.getState();
    expect(editor.activePieceId).toBe("");
    expect(editor.selectedPointId).toBeNull();
    expect(editor.selectedEdgeId).toBeNull();
    expect(editor.selectedSeamId).toBeNull();
    expect(editor.selectedDartId).toBeNull();
    expect(editor.selectedPieceIds).toEqual([]);
    expect(editor.pieceSelectionActive).toBe(false);
    expect(editor.seamFirstEdge).toBeNull();
    expect(editor.seamProposal).toBeNull();
    expect(editor.nearbySeamSuggestion).toBeNull();
    expect(internal.selectedPathId).toBeNull();
    expect(internal.selectedNodeId).toBeNull();
    expect(internal.selectedSegmentId).toBeNull();
    expect(hasEditorSelection()).toBe(false);

    useEditorStore.getState().selectPiece(piece.id);
    expect(useEditorStore.getState().activePieceId).toBe(piece.id);
    expect(useEditorStore.getState().pieceSelectionActive).toBe(true);
  });

  it("can clear element details while preserving the piece selection for a modeling intent", () => {
    useEditorStore.getState().selectPiece(piece.id);
    useEditorStore.setState({ selectedPointId: "a", selectedEdgeId: "edge-a" });
    useInternalPathEditorStore.setState({ selectedPathId: "path-a", selectedNodeId: "node-a" });

    clearEditorSelection({ preservePieces: true });

    const editor = useEditorStore.getState();
    expect(editor.activePieceId).toBe(piece.id);
    expect(editor.selectedPieceIds).toEqual([piece.id]);
    expect(editor.pieceSelectionActive).toBe(true);
    expect(editor.selectedPointId).toBeNull();
    expect(editor.selectedEdgeId).toBeNull();
    expect(useInternalPathEditorStore.getState().selectedPathId).toBeNull();
  });
});
