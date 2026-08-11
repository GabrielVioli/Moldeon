import { describe, expect, it } from "vitest";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  serializePatternDocumentV3,
} from "./patternDocumentV3";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";

describe("PatternDocumentV3 paramétrico", () => {
  it("preserves an older V3 document without requiring parametric extensions", () => {
    const legacyV3 = garmentDraftToPatternDocumentV3(createBaselineFixture("free-simple-piece"));
    const plain = structuredClone(legacyV3) as unknown as Record<string, unknown>;
    const measurements = plain.measurements as Record<string, unknown>;
    delete measurements.profile;
    delete measurements.suppliedKeys;
    delete measurements.derivedKeys;
    delete measurements.formulaSetVersion;
    const definitions = plain.patternDefinitions as Array<Record<string, unknown>>;
    definitions.forEach((definition) => delete definition.generation);
    const parsed = parsePatternDocumentV3(plain);
    expect(parsed.formatVersion).toBe(3);
    expect(parsed.measurements.profile).toBeUndefined();
  });

  it("round trips formula versions and generation snapshots", () => {
    const garment = createGarmentFromTemplate("tshirt", DEFAULT_BODY_MEASUREMENTS, "feminine");
    const document = garmentDraftToPatternDocumentV3(garment);
    expect(document.metadata.sourceTemplateVersion).toBe("tshirt@4");
    expect(document.measurements.profile?.schemaVersion).toBe(1);
    expect(document.patternDefinitions.every((definition) => definition.generation?.templateVersion === "tshirt@4")).toBe(true);
    expect(document.patternDefinitions.every((definition) => definition.generation?.methodology?.id === "freesewing-brian-teagan-moldeon-adaptation")).toBe(true);

    const serialized = serializePatternDocumentV3(document);
    const parsed = parsePatternDocumentV3(JSON.parse(serialized));
    const restored = patternDocumentV3ToGarmentDraft(parsed);
    const regenerated = garmentDraftToPatternDocumentV3(restored);
    expect(regenerated.metadata.sourceTemplateVersion).toBe(document.metadata.sourceTemplateVersion);
    expect(regenerated.measurements.profile).toEqual(document.measurements.profile);
    expect(regenerated.patternDefinitions.map((definition) => definition.generation)).toEqual(
      document.patternDefinitions.map((definition) => definition.generation),
    );
    expect(restored.templateId).toBe("tshirt");
    expect(restored.pieces.map(pieceGeometry)).toEqual(garment.pieces.map(pieceGeometry));
  });
});

function pieceGeometry(piece: { id: string; points: Array<{ id: string; xMm: number; yMm: number }> }) {
  return {
    id: piece.id,
    points: piece.points.map((point) => ({
      id: point.id,
      xMm: Number(point.xMm.toFixed(6)),
      yMm: Number(point.yMm.toFixed(6)),
    })),
  };
}
