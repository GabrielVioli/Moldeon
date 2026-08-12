import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type GarmentDraft, type PatternPiece } from "../domain/pattern";
import { useEditorStore } from "./editorStore";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";

const torsoFrontPlacement = {
  version: 1 as const,
  status: "confirmed" as const,
  includeIn3D: true,
  role: "custom" as const,
  region: "torso" as const,
  surface: "front" as const,
  bodySide: "center" as const,
  anchorId: "torso-front" as const,
  outwardFace: "normal" as const,
  offsetXMm: 0,
  offsetYMm: 0,
  offsetZMm: 25,
  rotationXDeg: 0,
  rotationYDeg: 0,
  rotationZDeg: 0,
  source: "manual" as const,
};

function piece(id: string): PatternPiece {
  return { id, name: id, seamAllowanceMm: 10, points: [
    { id: `${id}-a`, xMm: 0, yMm: 0 }, { id: `${id}-b`, xMm: 100, yMm: 0 },
    { id: `${id}-c`, xMm: 100, yMm: 100 }, { id: `${id}-d`, xMm: 0, yMm: 100 },
  ] };
}

function draft(): GarmentDraft {
  const fabric = createDefaultFabricSource();
  const pieces = [piece("a"), piece("b")].map((candidate) => ({ ...candidate, fabricId: fabric.id }));
  return { id: "history", templateId: "test", name: "History", description: "Teste de histórico", bodyType: "feminine", measurements: { heightMm: 1680, bustMm: 920, waistMm: 760, hipMm: 1000, shoulderWidthMm: 400, torsoLengthMm: 440, armLengthMm: 590, inseamMm: 780 }, fabrics: [fabric], pieces };
}

function createSeam(name = "Lateral") {
  const state = useEditorStore.getState();
  const first = getPatternEdges(state.garment.pieces[0])[0];
  const second = getPatternEdges(state.garment.pieces[1])[0];
  state.proposeSeam(
    { pieceId: "a", edgeId: first.id, startT: 0, endT: 1 },
    { pieceId: "b", edgeId: second.id, startT: 0, endT: 1 },
  );
  useEditorStore.getState().confirmSeamProposal({
    name,
    direction: "opposite",
    treatment: "standard",
  });
  return useEditorStore.getState().garment.seams![0].id;
}

describe("assembly document history", () => {
  beforeEach(() => useEditorStore.getState().loadGarment(draft()));

  it("undoes and redoes confirmed seam metadata", () => {
    createSeam();
    expect(useEditorStore.getState().garment.seams?.[0].name).toBe("Lateral");
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.seams).toBeUndefined();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.seams?.[0]).toMatchObject({ name: "Lateral", direction: "opposite", treatment: "standard" });
  });

  it("removes, disables, reactivates and reverses a selected seam with undo and redo", () => {
    const seamId = createSeam("Costura lateral");
    let state = useEditorStore.getState();
    state.selectSeam(seamId);
    expect(useEditorStore.getState().selectedSeamId).toBe(seamId);

    state.toggleSeamActive(seamId);
    expect(useEditorStore.getState().garment.seams?.[0].active).toBe(false);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.seams?.[0].active).not.toBe(false);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.seams?.[0].active).toBe(false);

    state = useEditorStore.getState();
    state.toggleSeamActive(seamId);
    expect(useEditorStore.getState().garment.seams?.[0].active).toBe(true);
    state.toggleSeamDirection(seamId);
    expect(useEditorStore.getState().garment.seams?.[0].direction).toBe("same");

    useEditorStore.getState().removeSeam(seamId);
    expect(useEditorStore.getState().garment.seams).toEqual([]);
    expect(useEditorStore.getState().selectedSeamId).toBeNull();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.seams?.[0]).toMatchObject({
      id: seamId,
      name: "Costura lateral",
      active: true,
      direction: "same",
    });
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.seams).toEqual([]);
  });

  it("records canonical point insertion as one undoable command", () => {
    const initial = useEditorStore.getState().snapshot.piece;
    const firstEdge = getPatternEdges(initial)[0];
    expect(initial.points).toHaveLength(4);

    useEditorStore.getState().insertPoint(firstEdge.startPointId, 0.5);
    let state = useEditorStore.getState();
    expect(state.snapshot.piece.points).toHaveLength(5);
    expect(state.snapshot.piece.nodes).toHaveLength(5);
    expect(state.snapshot.piece.segments).toHaveLength(5);

    state.undo();
    expect(useEditorStore.getState().snapshot.piece.points).toHaveLength(4);
    state = useEditorStore.getState();
    state.redo();
    expect(useEditorStore.getState().snapshot.piece.points).toHaveLength(5);
  });

  it("groups continuous measurement input into one transaction", () => {
    const state = useEditorStore.getState();
    state.beginEdit("Alterar medidas", "measurement");
    state.setBodyMeasurement("waistMm", 770);
    state.setBodyMeasurement("waistMm", 780);
    state.setBodyMeasurement("waistMm", 790);
    state.commitEdit();
    expect(useEditorStore.getState().garment.measurements.waistMm).toBe(790);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.measurements.waistMm).toBe(760);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.measurements.waistMm).toBe(790);
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

  it("undoes and redoes explicit body classification", () => {
    useEditorStore.getState().setBodyPlacement("a", torsoFrontPlacement);
    expect(useEditorStore.getState().garment.pieces[0].bodyPlacement).toMatchObject({
      status: "confirmed",
      anchorId: "torso-front",
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces[0].bodyPlacement?.status).toBe("unclassified");
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces[0].bodyPlacement?.status).toBe("confirmed");
  });

  it("undoes and redoes the garment-level dressing setup", () => {
    createSeam();
    useEditorStore.getState().setGarmentDressing({
      region: "upper",
      frontReferencePieceId: "a",
    });
    expect(useEditorStore.getState().garment.dressing).toEqual({
      region: "upper",
      frontReferencePieceId: "a",
    });
    expect(buildResolvedAssemblyInput(useEditorStore.getState().garment).panelInstances).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.dressing).toBeUndefined();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.dressing?.region).toBe("upper");
  });

  it("invalidates canonical geometry on point edit and restores it through undo/redo", () => {
    useEditorStore.getState().setBodyPlacement("a", torsoFrontPlacement);
    const before = buildResolvedAssemblyInput(useEditorStore.getState().garment).signature;
    const point = useEditorStore.getState().snapshot.piece.points[0];
    useEditorStore.getState().movePoint(point.id, point.xMm + 250, point.yMm);
    const changed = buildResolvedAssemblyInput(useEditorStore.getState().garment).signature;
    expect(changed).not.toBe(before);
    useEditorStore.getState().undo();
    expect(buildResolvedAssemblyInput(useEditorStore.getState().garment).signature).toBe(before);
    useEditorStore.getState().redo();
    expect(buildResolvedAssemblyInput(useEditorStore.getState().garment).signature).toBe(changed);
  });

  it("keeps workspace transforms out of body placement and canonical assembly signatures", () => {
    useEditorStore.getState().setBodyPlacement("a", torsoFrontPlacement);
    const before = buildResolvedAssemblyInput(useEditorStore.getState().garment).signature;
    useEditorStore.getState().setPieceWorkspaceTransform("a", {
      pieceId: "a",
      xMm: 500,
      yMm: -320,
      rotationDeg: 90,
    });
    const after = buildResolvedAssemblyInput(useEditorStore.getState().garment);
    expect(after.signature).toBe(before);
    expect(after.panelInstances[0].arrangementAnchor).toMatchObject({
      bodyAnchorId: "torso-front",
      offsetXMm: 0,
      offsetYMm: 0,
    });
  });

  it("records a cut as one undoable command", () => {
    const state = useEditorStore.getState();
    state.setCutDraft({ pieceId: "a", start: { xMm: -10, yMm: 50 }, end: { xMm: 110, yMm: 50 } });
    expect(useEditorStore.getState().cutDraft?.phase).toBe("placing");
    state.freezeCutDraft();
    expect(useEditorStore.getState().cutDraft?.phase).toBe("ready");
    useEditorStore.getState().confirmCut(true);
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
    expect(useEditorStore.getState().dartDraft?.phase).toBe("placing");
    state.freezeDartDraft();
    useEditorStore.getState().confirmDart();
    expect(useEditorStore.getState().garment.pieces[0].darts?.[0].closed).toBe(true);
    useEditorStore.getState().setPieceLocked("a", true);
    state = useEditorStore.getState(); state.selectAllPieces(); state.deleteSelectedPieces();
    expect(useEditorStore.getState().garment.pieces.map((candidate) => candidate.id)).toEqual(["a"]);
  });
});
