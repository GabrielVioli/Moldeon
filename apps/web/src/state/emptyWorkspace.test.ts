import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import type { GarmentDraft, PatternPiece } from "../domain/pattern";
import { useEditorStore } from "./editorStore";

function makePiece(id: string): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 10,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 120, yMm: 0 },
      { id: `${id}-c`, xMm: 80, yMm: 100 },
      { id: `${id}-d`, xMm: 0, yMm: 90 },
    ],
  };
}

function garment(pieces: PatternPiece[]): GarmentDraft {
  const fabric = createDefaultFabricSource();
  return {
    id: "empty-workspace-test",
    templateId: "blank",
    name: "Projeto vazio",
    description: "Teste da bancada vazia",
    bodyType: "feminine",
    measurements: {
      heightMm: 1680,
      bustMm: 920,
      waistMm: 760,
      hipMm: 1000,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    },
    fabrics: [fabric],
    pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })),
    seams: [],
    workspaceStates: pieces.map((piece) => ({
      pieceId: piece.id,
      transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
      visible: true,
      locked: false,
    })),
  };
}

describe("empty workspace recovery", () => {
  beforeEach(() => useEditorStore.getState().loadGarment(garment([])));

  it("loads and keeps a project with zero pieces", () => {
    const state = useEditorStore.getState();
    expect(state.garment.pieces).toEqual([]);
    expect(state.activePieceId).toBe("");
    expect(state.selectedPieceIds).toEqual([]);
    expect(state.pieceSelectionActive).toBe(false);
    state.selectAllPieces();
    expect(useEditorStore.getState().pieceSelectionActive).toBe(false);
  });

  it("deletes the last piece and supports undo and redo", () => {
    useEditorStore.getState().loadGarment(garment([makePiece("only")]));
    useEditorStore.getState().selectPiece("only");
    useEditorStore.getState().deletePiece("only");
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    expect(useEditorStore.getState().activePieceId).toBe("");
    expect(useEditorStore.getState().selectedPieceIds).toEqual([]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces.map((piece) => piece.id)).toEqual(["only"]);
    expect(useEditorStore.getState().activePieceId).toBe("only");

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    expect(useEditorStore.getState().activePieceId).toBe("");
  });

  it("creates the first drawn piece as one reversible command", () => {
    const state = useEditorStore.getState();
    state.startDraft("Primeira peça");
    state.addDraftPoint(10, 10);
    state.addDraftPoint(160, 10);
    state.addDraftPoint(110, 130);
    state.addDraftPoint(10, 100);
    state.closeDraft();

    expect(useEditorStore.getState().garment.pieces).toHaveLength(1);
    expect(useEditorStore.getState().garment.pieces[0].name).toBe("Primeira peça");

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(1);
  });

  it("removes every selected piece and their seams without leaving invalid references", () => {
    const first = makePiece("first");
    const second = makePiece("second");
    const project = garment([first, second]);
    project.assemblyPlacements = [
      { pieceId: "first", role: "front", outwardSide: "front", positionMm: [0, 0, 0], rotationDeg: [0, 0, 0], flipped: false, source: "manual" },
      { pieceId: "second", role: "back", outwardSide: "back", positionMm: [0, 0, 0], rotationDeg: [0, 0, 0], flipped: false, source: "manual" },
    ];
    project.seams = [{
      id: "join",
      first: { pieceId: "first", edgeId: "first:edge:first-a->first-b", startT: 0, endT: 1 },
      second: { pieceId: "second", edgeId: "second:edge:second-a->second-b", startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
    }];
    useEditorStore.getState().loadGarment(project);
    useEditorStore.getState().selectAllPieces();
    useEditorStore.getState().deleteSelectedPieces();
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    expect(useEditorStore.getState().garment.seams ?? []).toEqual([]);
    expect(useEditorStore.getState().garment.workspaceStates ?? []).toEqual([]);
    expect(useEditorStore.getState().garment.assemblyPlacements ?? []).toEqual([]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(2);
    expect(useEditorStore.getState().garment.seams).toHaveLength(1);
  });
});
