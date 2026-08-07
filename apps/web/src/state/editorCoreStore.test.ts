import { beforeEach, describe, expect, it } from "vitest";
import type { GarmentDraft, PatternPiece } from "../domain/pattern";
import {
  localBoundsFromPoints,
  rotateWorkspaceTransformAroundPivot,
} from "../editor/editorCoreMath";
import { clearEditorSelection } from "../editor/editorCoreSelection";
import { useEditorStore } from "./editorStore";
import { useInternalPathEditorStore } from "./internalPathEditorStore";

function emptyGarment(): GarmentDraft {
  const current = useEditorStore.getState().garment;
  return {
    ...structuredClone(current),
    id: "editor-core-empty",
    templateId: "blank",
    name: "Editor core",
    pieces: [],
    seams: [],
    workspaceTransforms: [],
    workspaceStates: [],
    assemblyPlacements: [],
    parametric: undefined,
  };
}

function curvedPiece(): PatternPiece {
  return {
    id: "curve-piece",
    name: "Curva",
    seamAllowanceMm: 10,
    points: [
      {
        id: "a",
        xMm: 0,
        yMm: 0,
        handleOut: { xMm: 30, yMm: -40 },
      },
      {
        id: "b",
        xMm: 100,
        yMm: 0,
        handleIn: { xMm: -30, yMm: -40 },
      },
      { id: "c", xMm: 100, yMm: 100 },
      { id: "d", xMm: 0, yMm: 100 },
    ],
  };
}

function garmentWithPiece(piece = curvedPiece()): GarmentDraft {
  return {
    ...emptyGarment(),
    pieces: [piece],
    workspaceStates: [
      {
        pieceId: piece.id,
        transform: { pieceId: piece.id, xMm: 35, yMm: -20, rotationDeg: 0 },
        visible: true,
        locked: false,
      },
    ],
  };
}

describe("recovery 9.5-04 editor core store", () => {
  beforeEach(() => {
    useEditorStore.getState().loadGarment(emptyGarment());
    useInternalPathEditorStore.setState({
      draftPathId: null,
      selectedPathId: null,
      selectedNodeId: null,
      selectedSegmentId: null,
      analysis: null,
    });
  });

  it("creates the first closed piece and makes it immediately active", () => {
    const state = useEditorStore.getState();
    state.startDraft("Primeira");
    state.addDraftPoint(20, 30);
    state.addDraftPoint(160, 30);
    state.addDraftPoint(160, 180);
    state.addDraftPoint(20, 180);
    state.closeDraft();

    const next = useEditorStore.getState();
    expect(next.garment.pieces).toHaveLength(1);
    expect(next.activePieceId).toBe(next.garment.pieces[0].id);
    expect(next.pieceSelectionActive).toBe(true);
    next.selectPoint(next.garment.pieces[0].points[0].id);
    expect(useEditorStore.getState().selectedPointId).toBe(
      next.garment.pieces[0].points[0].id,
    );
  });

  it("groups a continuous point drag into one undo transaction", () => {
    const piece = curvedPiece();
    useEditorStore.getState().loadGarment(garmentWithPiece(piece));
    const original = useEditorStore.getState().garment.pieces[0].points[0];

    const state = useEditorStore.getState();
    state.beginEdit("Mover ponto");
    state.movePoint("a", 10, 5);
    state.movePoint("a", 20, 10);
    state.movePoint("a", 25, 15);
    state.commitEdit();

    expect(useEditorStore.getState().garment.pieces[0].points[0]).toMatchObject({
      xMm: 25,
      yMm: 15,
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces[0].points[0]).toMatchObject({
      xMm: original.xMm,
      yMm: original.yMm,
    });
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces[0].points[0]).toMatchObject({
      xMm: 25,
      yMm: 15,
    });
  });

  it("keeps handle numeric edits inside one undo transaction", () => {
    const piece = curvedPiece();
    useEditorStore.getState().restoreGarment(
      garmentWithPiece(piece),
      piece.id,
      "typescript",
    );

    const state = useEditorStore.getState();
    state.beginEdit("Editar handle numericamente");
    state.moveHandle("a", "out", 35, -20);
    state.moveHandle("a", "out", 40, -10);
    state.commitEdit();

    expect(
      useEditorStore.getState().garment.pieces[0].points[0].handleOut,
    ).toEqual({ xMm: 40, yMm: -10 });
    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().garment.pieces[0].points[0].handleOut,
    ).toEqual({ xMm: 30, yMm: -40 });
  });

  it("clears piece, point, edge, seam, dart and internal-path ids together", () => {
    const piece = curvedPiece();
    useEditorStore.getState().loadGarment(garmentWithPiece(piece));
    useEditorStore.setState({
      selectedPointId: "a",
      selectedEdgeId: "edge-ghost",
      selectedSeamId: "seam-ghost",
      selectedDartId: "dart-ghost",
      selectedPieceIds: [piece.id],
      pieceSelectionActive: true,
    });
    useInternalPathEditorStore.setState({
      selectedPathId: "path-ghost",
      selectedNodeId: "node-ghost",
      selectedSegmentId: "segment-ghost",
    });

    clearEditorSelection();

    const state = useEditorStore.getState();
    const internal = useInternalPathEditorStore.getState();
    expect(state.selectedPointId).toBeNull();
    expect(state.selectedEdgeId).toBeNull();
    expect(state.selectedSeamId).toBeNull();
    expect(state.selectedDartId).toBeNull();
    expect(state.selectedPieceIds).toEqual([]);
    expect(state.pieceSelectionActive).toBe(false);
    expect(internal.selectedPathId).toBeNull();
    expect(internal.selectedNodeId).toBeNull();
    expect(internal.selectedSegmentId).toBeNull();
  });

  it("rotates one piece around its center in one undo/redo transaction", () => {
    const piece = curvedPiece();
    useEditorStore.getState().loadGarment(garmentWithPiece(piece));
    const initial = useEditorStore.getState().garment.workspaceStates![0].transform;
    const bounds = localBoundsFromPoints(piece.points);
    const pivot = {
      xMm: (bounds.minX + bounds.maxX) / 2,
      yMm: (bounds.minY + bounds.maxY) / 2,
    };
    const state = useEditorStore.getState();
    state.beginEdit("Rotacionar peça");
    state.setPieceWorkspaceTransform(
      piece.id,
      rotateWorkspaceTransformAroundPivot(initial, pivot, 28),
    );
    state.setPieceWorkspaceTransform(
      piece.id,
      rotateWorkspaceTransformAroundPivot(initial, pivot, 73),
    );
    state.commitEdit();

    expect(
      useEditorStore.getState().garment.workspaceStates![0].transform.rotationDeg,
    ).toBe(73);
    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().garment.workspaceStates![0].transform,
    ).toEqual(initial);
    useEditorStore.getState().redo();
    expect(
      useEditorStore.getState().garment.workspaceStates![0].transform.rotationDeg,
    ).toBe(73);
  });

  it("cancels an in-progress rotation and restores the prior transform", () => {
    const piece = curvedPiece();
    useEditorStore.getState().loadGarment(garmentWithPiece(piece));
    const initial = structuredClone(
      useEditorStore.getState().garment.workspaceStates![0].transform,
    );
    const bounds = localBoundsFromPoints(piece.points);
    const pivot = {
      xMm: (bounds.minX + bounds.maxX) / 2,
      yMm: (bounds.minY + bounds.maxY) / 2,
    };
    const state = useEditorStore.getState();
    state.beginEdit("Rotacionar peça");
    state.setPieceWorkspaceTransform(
      piece.id,
      rotateWorkspaceTransformAroundPivot(initial, pivot, -95),
    );
    state.cancelEdit();
    expect(
      useEditorStore.getState().garment.workspaceStates![0].transform,
    ).toEqual(initial);
  });

  it("clears incompatible selection ids after document replacement", () => {
    const piece = curvedPiece();
    useEditorStore.getState().restoreGarment(
      garmentWithPiece(piece),
      piece.id,
      "typescript",
    );
    useEditorStore.getState().selectPoint("a");
    useEditorStore.getState().selectEdge("missing-edge");
    useEditorStore.getState().loadGarment(emptyGarment());

    const state = useEditorStore.getState();
    expect(state.activePieceId).toBe("");
    expect(state.selectedPointId).toBeNull();
    expect(state.selectedEdgeId).toBeNull();
    expect(state.selectedPieceIds).toEqual([]);
  });
});
