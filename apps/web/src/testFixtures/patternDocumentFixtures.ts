import type { GarmentDraft } from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import type {
  PatternDocumentV3,
  PatternProjectV2,
} from "../domain/patternDocumentV3.types";
import { createBaselineFixture } from "./baselineGarments";

export interface LegacyProjectFixture {
  id: "legacy-project-fixture";
  garment: GarmentDraft;
}

export function createLegacyProjectFixture(): LegacyProjectFixture {
  return {
    id: "legacy-project-fixture",
    garment: structuredClone(createBaselineFixture("legacy-valid")),
  };
}

export function createPatternProjectV2Fixture(): PatternProjectV2 {
  const garment = structuredClone(createBaselineFixture("bezier-piece"));
  return {
    formatVersion: 2,
    garment,
    activePieceId: garment.pieces[0].id,
  };
}

export function createPatternDocumentV3Fixture(): PatternDocumentV3 {
  const garment = structuredClone(createBaselineFixture("multiple-fabrics"));
  return garmentDraftToPatternDocumentV3(garment, {
    activePatternId: garment.pieces[0].id,
  });
}
