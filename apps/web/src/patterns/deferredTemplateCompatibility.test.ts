import { describe, expect, it } from "vitest";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  serializePatternDocumentV3,
} from "../domain/patternDocumentV3";
import { useEditorStore } from "../state/editorStore";
import {
  DEFAULT_BODY_MEASUREMENTS,
  PATTERN_TEMPLATES,
  PUBLIC_PATTERN_TEMPLATES,
  createGarmentFromTemplate,
} from "./templateCatalog";

describe("deferred template compatibility", () => {
  it("loads saved geometry from a hidden template without filtering pieces", () => {
    expect(PUBLIC_PATTERN_TEMPLATES).toEqual([]);
    expect(PATTERN_TEMPLATES.find((template) => template.id === "straight-pants")).toMatchObject({
      visibility: "internal",
      releaseStatus: "deferred",
    });

    const saved = createGarmentFromTemplate("straight-pants", DEFAULT_BODY_MEASUREMENTS);
    const pieceIds = saved.pieces.map((piece) => piece.id);
    const serialized = serializePatternDocumentV3(garmentDraftToPatternDocumentV3(saved));
    const restored = patternDocumentV3ToGarmentDraft(parsePatternDocumentV3(JSON.parse(serialized)));

    useEditorStore.getState().loadGarment(restored);
    expect(useEditorStore.getState().garment.templateId).toBe("straight-pants");
    expect(useEditorStore.getState().garment.pieces.map((piece) => piece.id)).toEqual(pieceIds);
    expect(useEditorStore.getState().garment.pieces.every((piece) => piece.points.length > 3)).toBe(true);
  });
});
