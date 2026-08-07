import { beforeEach, describe, expect, it } from "vitest";
import type { GarmentDraft, PatternPiece } from "../domain/pattern";
import { useEditorStore } from "./editorStore";

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

describe("recovery 9.5-04 editor core store", () => {
  beforeEach(() => {
    useEditorStore.getState().loadGarment(emptyGarment());
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
    const garment = {
      ...emptyGarment(),
      pieces: [piece],
      workspaceStates: [
        {
          pieceId: piece.id,
          transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
          visible: true,
          locked: false,
        },
      ],
    };
    useEditorStore.getState().loadGarment(garment);
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
      {
        ...emptyGarment(),
        pieces: [piece],
        workspaceStates: [
          {
            pieceId: piece.id,
            transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
            visible: true,
            locked: false,
          },
        ],
      },
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

  it("clears incompatible selection ids after document replacement", () => {
    const piece = curvedPiece();
    useEditorStore.getState().restoreGarment(
      {
        ...emptyGarment(),
        pieces: [piece],
        workspaceStates: [
          {
            pieceId: piece.id,
            transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
            visible: true,
            locked: false,
          },
        ],
      },
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
