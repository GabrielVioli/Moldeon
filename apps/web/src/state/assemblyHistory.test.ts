import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type GarmentDraft, type PatternPiece } from "../domain/pattern";
import { useEditorStore } from "./editorStore";

function piece(id: string): PatternPiece {
  return { id, name: id, seamAllowanceMm: 10, points: [
    { id: `${id}-a`, xMm: 0, yMm: 0 }, { id: `${id}-b`, xMm: 100, yMm: 0 },
    { id: `${id}-c`, xMm: 100, yMm: 100 }, { id: `${id}-d`, xMm: 0, yMm: 100 },
  ] };
}

function draft(): GarmentDraft {
  const fabric = createDefaultFabricSource();
  const pieces = [piece("a"), piece("b")].map((candidate) => ({ ...candidate, fabricId: fabric.id }));
  return { id: "history", templateId: "test", name: "History", description: "", bodyType: "feminine", measurements: { heightMm: 1680, bustMm: 920, waistMm: 760, hipMm: 1000, shoulderWidthMm: 400, torsoLengthMm: 440, armLengthMm: 590, inseamMm: 780 }, fabrics: [fabric], pieces };
}

describe("assembly document history", () => {
  beforeEach(() => useEditorStore.getState().loadGarment(draft()));

  it("undoes and redoes confirmed seam metadata", () => {
    const state = useEditorStore.getState();
    const first = getPatternEdges(state.garment.pieces[0])[0];
    const second = getPatternEdges(state.garment.pieces[1])[0];
    state.proposeSeam(
      { pieceId: "a", edgeId: first.id, startT: 0, endT: 1 },
      { pieceId: "b", edgeId: second.id, startT: 0, endT: 1 },
    );
    useEditorStore.getState().confirmSeamProposal({ name: "Lateral", direction: "opposite", treatment: "standard" });
    expect(useEditorStore.getState().garment.seams?.[0].name).toBe("Lateral");
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.seams).toBeUndefined();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.seams?.[0]).toMatchObject({ name: "Lateral", direction: "opposite", treatment: "standard" });
  });

  it("tracks placement, edge finish and garment ease", () => {
    const state = useEditorStore.getState();
    const edge = getPatternEdges(state.garment.pieces[0])[0];
    state.setAssemblyPlacement("a", { role: "front" });
    useEditorStore.getState().setEdgeFinish("a", edge.id, "hem");
    useEditorStore.getState().setGarmentEase("bustMm", 95);
    const updated = useEditorStore.getState().garment;
    expect(updated.assemblyPlacements?.[0]).toMatchObject({ pieceId: "a", role: "front", source: "manual" });
    expect(updated.ease).toMatchObject({ bustMm: 95 });
    expect(updated.pieces[0].edgeFinishes).toEqual({ [edge.id]: "hem" });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.ease).toBeUndefined();
  });

  it("records a cut as one undoable command", () => {
    const state = useEditorStore.getState();
    state.setCutDraft({ pieceId: "a", start: { xMm: -10, yMm: 50 }, end: { xMm: 110, yMm: 50 } });
    state.confirmCut(true);
    expect(useEditorStore.getState().garment.pieces).toHaveLength(3);
    expect(useEditorStore.getState().garment.seams).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces.map((candidate) => candidate.id)).toEqual(["a", "b"]);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(3);
  });

  it("persists a dart and respects locked pieces during group deletion", () => {
    let state = useEditorStore.getState();
    state.setDartDraft({ pieceId: "a", edgePoint: { xMm: 50, yMm: 0 }, apex: { xMm: 50, yMm: 60 } });
    state.confirmDart();
    expect(useEditorStore.getState().garment.pieces[0].darts?.[0].closed).toBe(true);
    useEditorStore.getState().setPieceLocked("a", true);
    state = useEditorStore.getState(); state.selectAllPieces(); state.deleteSelectedPieces();
    expect(useEditorStore.getState().garment.pieces.map((candidate) => candidate.id)).toEqual(["a"]);
  });
});
