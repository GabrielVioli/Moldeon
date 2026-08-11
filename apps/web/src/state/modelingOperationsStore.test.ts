import { beforeEach, describe, expect, it } from "vitest";
import { createInternalPath } from "../domain/internalPaths";
import {
  applyModelingInternalPathOperation,
  finalizeBoundaryAnchors,
} from "../domain/modelingCut";
import { createSimplePleat } from "../domain/modelingOperations";
import {
  isInternalPath,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternPiece,
} from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { parseAutosaveOrThrow } from "../storage/opfs";
import { useEditorStore } from "./editorStore";
import { useInternalPathEditorStore } from "./internalPathEditorStore";
import { useModelingOperationsStore } from "./modelingOperationsStore";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { buildPanelTopology } from "../garment3d/PanelTopology";

function rectangle(id: string): PatternPiece {
  return migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 10,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 100, yMm: 0 },
      { id: `${id}-c`, xMm: 100, yMm: 80 },
      { id: `${id}-d`, xMm: 0, yMm: 80 },
    ],
  });
}

function testGarment(
  pieces: PatternPiece[],
  positions: Array<{ xMm: number; yMm: number; rotationDeg?: number }> = [],
): GarmentDraft {
  const base = structuredClone(useEditorStore.getState().garment);
  const fabricId = base.fabrics[0]?.id;
  const normalizedPieces = pieces.map((piece) => ({
    ...piece,
    ...(fabricId ? { fabricId } : {}),
  }));
  const workspaceStates = normalizedPieces.map((piece, index) => ({
    pieceId: piece.id,
    transform: {
      pieceId: piece.id,
      xMm: positions[index]?.xMm ?? 0,
      yMm: positions[index]?.yMm ?? 0,
      rotationDeg: positions[index]?.rotationDeg ?? 0,
    },
    visible: true,
    locked: false,
  }));
  return {
    ...base,
    id: "recovery-9-5-05-test",
    templateId: "blank",
    name: "Recovery 9.5-05",
    pieces: normalizedPieces,
    seams: [],
    workspaceStates,
    workspaceTransforms: workspaceStates.map((state) => ({ ...state.transform })),
    assemblyPlacements: [],
    parametric: undefined,
  };
}

function resetWith(
  pieces: PatternPiece[],
  positions: Array<{ xMm: number; yMm: number; rotationDeg?: number }> = [],
) {
  useEditorStore.getState().loadGarment(testGarment(pieces, positions));
  useInternalPathEditorStore.setState({
    draftPathId: null,
    selectedPathId: null,
    selectedNodeId: null,
    selectedSegmentId: null,
    analysis: null,
  });
  useModelingOperationsStore.getState().clearDiagnostics();
}

function canonicalWorkspaceStates(states: GarmentDraft["workspaceStates"]) {
  return structuredClone(states ?? []).sort((left, right) => left.pieceId.localeCompare(right.pieceId));
}

describe("recovery 9.5-05 modeling transactions", () => {
  beforeEach(() => resetWith([rectangle("piece-a")]));

  it("duplicates and mirrors through reversible document transactions", () => {
    useEditorStore.getState().selectPiece("piece-a");
    expect(useModelingOperationsStore.getState().duplicate("horizontal")).toBe(true);
    const mirroredId = useEditorStore.getState().activePieceId;
    expect(useEditorStore.getState().garment.pieces).toHaveLength(2);
    expect(mirroredId).not.toBe("piece-a");

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces.map((piece) => piece.id)).toEqual(["piece-a"]);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(2);
    expect(useEditorStore.getState().garment.pieces.some((piece) => piece.id === mirroredId)).toBe(true);
  });

  it("aligns and distributes selected pieces transactionally", () => {
    const pieces = [rectangle("a"), rectangle("b"), rectangle("c")];
    resetWith(pieces, [
      { xMm: 0, yMm: 20 },
      { xMm: 145, yMm: 130 },
      { xMm: 410, yMm: 250 },
    ]);
    useEditorStore.getState().setPieceSelection(pieces.map((piece) => piece.id));
    const initial = canonicalWorkspaceStates(useEditorStore.getState().garment.workspaceStates);

    expect(useModelingOperationsStore.getState().align("top")).toBe(true);
    const aligned = useEditorStore.getState().garment.workspaceStates!.map((state) => state.transform.yMm);
    expect(new Set(aligned.map((value) => value.toFixed(5))).size).toBe(1);
    useEditorStore.getState().undo();
    expect(canonicalWorkspaceStates(useEditorStore.getState().garment.workspaceStates)).toEqual(initial);
    useEditorStore.getState().redo();
    expect(new Set(useEditorStore.getState().garment.workspaceStates!.map((state) => state.transform.yMm.toFixed(5))).size).toBe(1);

    expect(useModelingOperationsStore.getState().distribute("horizontal")).toBe(true);
    const afterDistribution = canonicalWorkspaceStates(useEditorStore.getState().garment.workspaceStates);
    useEditorStore.getState().undo();
    expect(canonicalWorkspaceStates(useEditorStore.getState().garment.workspaceStates)).not.toEqual(afterDistribution);
    useEditorStore.getState().redo();
    expect(canonicalWorkspaceStates(useEditorStore.getState().garment.workspaceStates)).toEqual(afterDistribution);
  });

  it("joins compatible pieces in one undo/redo transaction", () => {
    const first = rectangle("left");
    const second = rectangle("right");
    resetWith([first, second], [
      { xMm: 0, yMm: 0 },
      { xMm: 200, yMm: 80, rotationDeg: 180 },
    ]);
    useEditorStore.getState().setPieceSelection([first.id, second.id]);
    expect(useModelingOperationsStore.getState().join()).toBe(true);
    const joinedId = useEditorStore.getState().activePieceId;
    expect(useEditorStore.getState().garment.pieces).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(2);
    expect(useEditorStore.getState().garment.pieces.map((piece) => piece.id).sort()).toEqual([first.id, second.id].sort());
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(1);
    expect(useEditorStore.getState().garment.pieces[0].id).toBe(joinedId);
  });

  it("creates a pleat in one reversible transaction", () => {
    useEditorStore.getState().selectPiece("piece-a");
    expect(useModelingOperationsStore.getState().createPleat({
      depthMm: 24,
      directionDeg: 90,
      sense: "inward",
    })).toBe(true);
    const foldsAfter = (useEditorStore.getState().garment.pieces[0].internalLines ?? [])
      .filter(isInternalPath)
      .filter((path) => path.metadata.pleatId);
    expect(foldsAfter).toHaveLength(2);

    useEditorStore.getState().undo();
    expect((useEditorStore.getState().garment.pieces[0].internalLines ?? []).filter(isInternalPath).filter((path) => path.metadata.pleatId)).toHaveLength(0);
    useEditorStore.getState().redo();
    expect((useEditorStore.getState().garment.pieces[0].internalLines ?? []).filter(isInternalPath).filter((path) => path.metadata.pleatId)).toHaveLength(2);
  });

  it("applies the blocking V cut transactionally and undo/redo restores complete topology", () => {
    const piece = rectangle("cut-piece");
    resetWith([piece]);
    useEditorStore.getState().selectPiece(piece.id);
    const paths = useInternalPathEditorStore.getState();
    paths.startPath(piece.id, "cut", { xMm: 20, yMm: 0.3 });
    paths.appendDraftPoint({ xMm: 50, yMm: 48 });
    paths.appendDraftPoint({ xMm: 80, yMm: 0.4 });
    expect(paths.confirmDraft()).toBe(true);
    const pathId = useInternalPathEditorStore.getState().selectedPathId;
    expect(pathId).toBeTruthy();
    expect(useInternalPathEditorStore.getState().analysis?.valid).toBe(true);

    expect(useInternalPathEditorStore.getState().applySelectedPath(false)).toBe(true);
    const cutPieceIds = useEditorStore.getState().garment.pieces.map((candidate) => candidate.id);
    expect(cutPieceIds).toHaveLength(2);
    expect(useEditorStore.getState().garment.pieces.every((candidate) => candidate.bodyPlacement?.status === "unclassified")).toBe(true);
    expect(buildResolvedAssemblyInput(useEditorStore.getState().garment).panelInstances).toEqual([]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(1);
    expect((useEditorStore.getState().garment.pieces[0].internalLines ?? []).some((line) => line.id === pathId)).toBe(true);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces.map((candidate) => candidate.id)).toEqual(cutPieceIds);
  });

  it("applies a cross-piece cut as one undo/redo transaction", () => {
    const front = rectangle("multi-front");
    const back = rectangle("multi-back");
    resetWith([front, back], [{ xMm: 0, yMm: 0 }, { xMm: 140, yMm: 0 }]);
    useEditorStore.getState().setPieceSelection([front.id, back.id]);

    const paths = useInternalPathEditorStore.getState();
    paths.startPath(front.id, "cut", { xMm: -20, yMm: 40 });
    paths.appendDraftPoint({ xMm: 120, yMm: 40 });
    paths.appendDraftPoint({ xMm: 260, yMm: 40 });
    expect(paths.confirmDraft()).toBe(true);
    expect(useInternalPathEditorStore.getState().multiCutAnalysis).toMatchObject({
      valid: true,
      targetPieceIds: [front.id, back.id],
    });

    expect(useInternalPathEditorStore.getState().applySelectedPath(false)).toBe(true);
    const cutPieceIds = useEditorStore.getState().garment.pieces.map((piece) => piece.id);
    expect(cutPieceIds).toHaveLength(4);
    expect(useEditorStore.getState().selectedPieceIds).toHaveLength(4);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces.map((piece) => piece.id)).toEqual([front.id, back.id]);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces.map((piece) => piece.id)).toEqual(cutPieceIds);
  });

  it("closes a dart as paired structural legs instead of a decorative straight line", () => {
    const source = rectangle("dart-piece");
    const dartPath = createInternalPath(source.id, "dart", [
      { xMm: 50, yMm: 0 },
      { xMm: 50, yMm: 48 },
    ]);
    const pieceWithPath = { ...source, internalLines: [dartPath] };
    const result = applyModelingInternalPathOperation(testGarment([pieceWithPath]), source.id, dartPath.id);
    expect(result.ok).toBe(true);
    const updated = result.garment.pieces.find((piece) => piece.id === source.id)!;
    const dart = updated.darts?.[0];
    const structuralLine = (updated.internalLines ?? []).find((line) => line.id === dartPath.id);
    expect(structuralLine && isInternalPath(structuralLine)).toBe(true);
    if (!structuralLine || !isInternalPath(structuralLine)) throw new Error("Pence estrutural não manteve um InternalPath válido.");
    expect(dart).toMatchObject({
      pieceId: source.id,
      pathId: dartPath.id,
      closed: true,
      closure: {
        kind: "paired-legs",
        targetDistanceMm: 0,
        state: "closed",
        topologyVersion: 1,
      },
    });
    expect(dart?.widthMm).toBeGreaterThan(0);
    expect(dart?.lengthMm).toBeGreaterThan(0);
    expect(Number.isFinite(dart?.directionDeg)).toBe(true);
    expect(dart?.legSegmentIds).toHaveLength(2);
    expect(structuralLine.segments).toHaveLength(3);
    expect(structuralLine.nodes).toHaveLength(4);
    const topology = buildPanelTopology(updated);
    expect(topology.darts[0]?.dart.closure).toMatchObject({
      state: "closed",
      targetDistanceMm: 0,
    });
  });

  it("round-trips anchored cuts and pleat metadata through the real V3 autosave parser", () => {
    const source = rectangle("persist-piece");
    const fabricId = useEditorStore.getState().garment.fabrics[0]?.id;
    const normalized = { ...source, ...(fabricId ? { fabricId } : {}) };
    const cut = finalizeBoundaryAnchors(createInternalPath(normalized.id, "cut", [
      { xMm: 18, yMm: 0.3 },
      { xMm: 50, yMm: 42 },
      { xMm: 82, yMm: 0.3 },
    ]), normalized);
    let garment = testGarment([{ ...normalized, internalLines: [cut] }]);
    const pleat = createSimplePleat(garment, normalized.id, {
      depthMm: 22,
      directionDeg: 90,
      sense: "outward",
    });
    expect(pleat.ok).toBe(true);
    garment = pleat.garment;

    const document = garmentDraftToPatternDocumentV3(garment, { activePatternId: normalized.id });
    const parsed = parseAutosaveOrThrow(JSON.stringify({
      version: 3,
      document,
      activePatternId: normalized.id,
      savedAt: "2026-08-07T00:00:00.000Z",
    }));
    expect(parsed.kind).toBe("garment");
    if (parsed.kind !== "garment") throw new Error("Autosave V3 não restaurou um garment.");
    const restored = parsed.garment.pieces.find((piece) => piece.id === normalized.id)!;
    const restoredPaths = (restored.internalLines ?? []).filter(isInternalPath);
    const restoredCut = restoredPaths.find((path) => path.id === cut.id)!;
    expect(typeof restoredCut.metadata.cutStartEdgeId).toBe("string");
    expect(typeof restoredCut.metadata.cutStartT).toBe("number");
    expect(typeof restoredCut.metadata.cutEndEdgeId).toBe("string");
    expect(typeof restoredCut.metadata.cutEndT).toBe("number");
    const restoredPleat = restoredPaths.filter((path) => path.metadata.pleatId);
    expect(restoredPleat).toHaveLength(2);
    expect(restoredPleat.every((path) => path.metadata.pleatDepthMm === 22)).toBe(true);
    expect(restoredPleat.every((path) => path.metadata.pleatConsumptionMm === 44)).toBe(true);
    expect(restoredPleat.every((path) => path.metadata.pleatSense === "outward")).toBe(true);
  });
});
