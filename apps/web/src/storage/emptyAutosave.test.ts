import { describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import type { GarmentDraft } from "../domain/pattern";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
} from "../domain/patternDocumentV3";
import { parseAutosaveOrThrow } from "./opfs";

function emptyGarment(): GarmentDraft {
  return {
    id: "empty-autosave",
    templateId: "blank",
    name: "Projeto vazio",
    description: "Bancada sem peças",
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
    fabrics: [createDefaultFabricSource()],
    pieces: [],
    seams: [],
    workspaceStates: [],
  };
}

describe("empty workspace persistence", () => {
  it("round-trips a V3 document with no pattern definitions", () => {
    const document = garmentDraftToPatternDocumentV3(emptyGarment());
    expect(document.patternDefinitions).toEqual([]);
    expect(document.workspace.activePatternId).toBeUndefined();
    const parsed = parsePatternDocumentV3(JSON.parse(JSON.stringify(document)));
    expect(patternDocumentV3ToGarmentDraft(parsed).pieces).toEqual([]);
  });

  it("restores a V3 autosave without an active pattern", () => {
    const document = garmentDraftToPatternDocumentV3(emptyGarment());
    const restored = parseAutosaveOrThrow(JSON.stringify({
      version: 3,
      document,
      savedAt: "2026-08-06T12:00:00.000Z",
    }));
    expect(restored.kind).toBe("garment");
    if (restored.kind !== "garment") throw new Error("Autosave inesperado");
    expect(restored.activePieceId).toBe("");
    expect(restored.garment.pieces).toEqual([]);
  });
});
