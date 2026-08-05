import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import {
  garmentDraftToPatternDocumentV3,
} from "../domain/patternDocumentV3";
import {
  isInternalPath,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
} from "../domain/pattern";
import { useEditorStore } from "./editorStore";
import { useInternalPathEditorStore } from "./internalPathEditorStore";

function draft(): GarmentDraft {
  const fabric = createDefaultFabricSource();
  const piece = migrateLegacyPieceToSegments({
    id: "panel",
    name: "Painel",
    seamAllowanceMm: 10,
    fabricId: fabric.id,
    cutQuantity: 1,
    points: [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 220, yMm: 0 },
      { id: "c", xMm: 220, yMm: 200 },
      { id: "d", xMm: 0, yMm: 200 },
    ],
    grainline: {
      start: { xMm: 110, yMm: 20 },
      end: { xMm: 110, yMm: 180 },
    },
    annotations: [{ id: "note", label: "Centro", xMm: 110, yMm: 100 }],
  });
  return {
    id: "internal-path-history",
    templateId: "custom",
    name: "Internal Path History",
    description: "Fixture de histórico para caminhos internos.",
    bodyType: "feminine",
    measurements: {
      heightMm: 1700,
      bustMm: 900,
      waistMm: 720,
      hipMm: 980,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    },
    fabrics: [fabric],
    pieces: [piece],
    workspaceStates: [{
      pieceId: piece.id,
      transform: { pieceId: piece.id, xMm: 45, yMm: 60, rotationDeg: 9 },
      visible: true,
      locked: false,
    }],
  };
}

function canonicalPaths() {
  return useEditorStore.getState().garment.pieces
    .flatMap((piece) => piece.internalLines ?? [])
    .filter(isInternalPath);
}

describe("internal path editor transactions", () => {
  beforeEach(() => {
    useEditorStore.getState().loadGarment(draft());
    useInternalPathEditorStore.getState().reset();
  });

  it("draws a multi-node path as one reversible transaction", () => {
    const editor = useInternalPathEditorStore.getState();
    editor.startPath("panel", "reference", { xMm: -20, yMm: 80 });
    editor.appendDraftPoint({ xMm: 105, yMm: 130 });
    editor.appendDraftPoint({ xMm: 240, yMm: 90 });

    expect(editor.confirmDraft()).toBe(true);
    expect(canonicalPaths()).toHaveLength(1);
    expect(canonicalPaths()[0]).toMatchObject({ purpose: "reference" });
    expect(canonicalPaths()[0].nodes).toHaveLength(3);

    useEditorStore.getState().undo();
    expect(canonicalPaths()).toHaveLength(0);
    useEditorStore.getState().redo();
    expect(canonicalPaths()).toHaveLength(1);
    expect(canonicalPaths()[0].nodes).toHaveLength(3);
  });

  it("converts purpose and segment geometry without redrawing", () => {
    let editor = useInternalPathEditorStore.getState();
    editor.startPath("panel", "reference", { xMm: -20, yMm: 75 });
    editor.appendDraftPoint({ xMm: 110, yMm: 135 });
    editor.appendDraftPoint({ xMm: 240, yMm: 85 });
    expect(editor.confirmDraft()).toBe(true);

    editor = useInternalPathEditorStore.getState();
    editor.setPurpose("cut-and-sew");
    editor.setSelectedSegmentKind("cubic");
    const changed = canonicalPaths()[0];
    expect(changed.purpose).toBe("cut-and-sew");
    expect(changed.segments.some((segment) => segment.kind === "cubic")).toBe(true);

    useEditorStore.getState().undo();
    expect(canonicalPaths()[0].segments.every((segment) => segment.kind === "line")).toBe(true);
    useEditorStore.getState().undo();
    expect(canonicalPaths()[0].purpose).toBe("reference");
    useEditorStore.getState().redo();
    useEditorStore.getState().redo();
    expect(canonicalPaths()[0]).toMatchObject({ purpose: "cut-and-sew" });
  });

  it("applies a curved cut-and-sew and restores the exact previous document", () => {
    const original = structuredClone(useEditorStore.getState().garment);
    let editor = useInternalPathEditorStore.getState();
    editor.startPath("panel", "cut-and-sew", { xMm: -20, yMm: 70 });
    editor.appendDraftPoint({ xMm: 110, yMm: 145 });
    editor.appendDraftPoint({ xMm: 240, yMm: 82 });
    expect(editor.confirmDraft()).toBe(true);
    editor = useInternalPathEditorStore.getState();
    editor.setSelectedSegmentKind("cubic");

    const beforeApply = structuredClone(useEditorStore.getState().garment);
    expect(editor.applySelectedPath(true)).toBe(true);
    const applied = useEditorStore.getState().garment;
    expect(applied.pieces).toHaveLength(2);
    const groupIds = new Set((applied.seams ?? []).map((seam) => seam.groupId).filter(Boolean));
    expect(groupIds.size).toBe(1);
    expect(garmentDraftToPatternDocumentV3(applied).seamGroups).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment).toEqual(beforeApply);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(2);

    useEditorStore.getState().undo();
    useEditorStore.getState().undo();
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment).toEqual(original);
  });

  it("closes a structural dart and preserves its topology through undo and redo", () => {
    let editor = useInternalPathEditorStore.getState();
    editor.startPath("panel", "dart", { xMm: 110, yMm: 0 });
    editor.appendDraftPoint({ xMm: 110, yMm: 90 });
    expect(editor.confirmDraft()).toBe(true);
    const beforeApply = structuredClone(useEditorStore.getState().garment);

    editor = useInternalPathEditorStore.getState();
    expect(editor.applySelectedPath(false)).toBe(true);
    let dart = useEditorStore.getState().garment.pieces[0].darts?.at(-1);
    expect(dart).toMatchObject({
      closed: true,
      closure: { kind: "paired-legs", state: "closed", targetDistanceMm: 0 },
    });
    expect(dart?.legSegmentIds).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment).toEqual(beforeApply);
    useEditorStore.getState().redo();
    dart = useEditorStore.getState().garment.pieces[0].darts?.at(-1);
    expect(dart?.closed).toBe(true);
    expect(dart?.legSegmentIds).toHaveLength(2);
  });

  it("cancels an unfinished path without leaving document debris", () => {
    const original = structuredClone(useEditorStore.getState().garment);
    const editor = useInternalPathEditorStore.getState();
    editor.startPath("panel", "cut", { xMm: -20, yMm: 70 });
    editor.appendDraftPoint({ xMm: 110, yMm: 130 });
    expect(canonicalPaths()).toHaveLength(1);
    editor.cancelDraft();
    expect(useEditorStore.getState().garment).toEqual(original);
    expect(canonicalPaths()).toHaveLength(0);
  });
});
