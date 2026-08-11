import { describe, expect, it } from "vitest";
import { createInternalPath } from "../domain/internalPaths";
import {
  applyModelingInternalPathOperation,
  finalizeBoundaryAnchors,
} from "../domain/modelingCut";
import {
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternPiece,
} from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { parseAutosaveOrThrow } from "../storage/opfs";
import { useEditorStore } from "./editorStore";

function rectangle(id: string): PatternPiece {
  return migrateLegacyPieceToSegments({
    id,
    name: "V autosave",
    seamAllowanceMm: 10,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 120, yMm: 0 },
      { id: `${id}-c`, xMm: 120, yMm: 100 },
      { id: `${id}-d`, xMm: 0, yMm: 100 },
    ],
  });
}

function garmentFor(piece: PatternPiece): GarmentDraft {
  const base = structuredClone(useEditorStore.getState().garment);
  const fabricId = base.fabrics[0]?.id;
  const normalized = { ...piece, ...(fabricId ? { fabricId } : {}) };
  return {
    ...base,
    id: "applied-v-autosave",
    templateId: "blank",
    name: "Applied V autosave",
    pieces: [normalized],
    seams: [],
    workspaceStates: [{
      pieceId: normalized.id,
      transform: { pieceId: normalized.id, xMm: 135, yMm: 72, rotationDeg: 27 },
      visible: true,
      locked: false,
    }],
    workspaceTransforms: [{ pieceId: normalized.id, xMm: 135, yMm: 72, rotationDeg: 27 }],
    assemblyPlacements: [],
    parametric: undefined,
  };
}

describe("9.5-05 applied V cut autosave", () => {
  it("round-trips both generated pieces after the blocking V cut is applied", () => {
    const source = rectangle("autosave-cut");
    const garment = garmentFor(source);
    const piece = garment.pieces[0];
    const path = finalizeBoundaryAnchors(createInternalPath(piece.id, "cut", [
      { xMm: 22, yMm: 0.4 },
      { xMm: 60, yMm: 58 },
      { xMm: 98, yMm: 0.3 },
    ]), piece);
    const prepared: GarmentDraft = {
      ...garment,
      pieces: [{ ...piece, internalLines: [path] }],
    };
    const result = applyModelingInternalPathOperation(prepared, piece.id, path.id);
    expect(result.ok).toBe(true);
    expect(result.createdPieceIds).toHaveLength(2);
    expect(result.garment.pieces).toHaveLength(2);

    const activePieceId = result.activePieceId;
    const document = garmentDraftToPatternDocumentV3(result.garment, { activePatternId: activePieceId });
    const parsed = parseAutosaveOrThrow(JSON.stringify({
      version: 3,
      document,
      activePatternId: activePieceId,
      savedAt: "2026-08-07T00:00:00.000Z",
    }));

    expect(parsed.kind).toBe("garment");
    if (parsed.kind !== "garment") throw new Error("Autosave aplicado não restaurou um garment.");
    expect(parsed.garment.pieces.map((candidate) => candidate.id)).toEqual(result.garment.pieces.map((candidate) => candidate.id));
    expect(parsed.garment.pieces.every((candidate) => candidate.contours?.[0]?.closed)).toBe(true);
    expect(parsed.garment.pieces.every((candidate) => (candidate.segments?.length ?? 0) >= 3)).toBe(true);
    expect(parsed.garment.workspaceStates?.map((state) => state.pieceId).sort()).toEqual(result.garment.workspaceStates?.map((state) => state.pieceId).sort());
  });
});
