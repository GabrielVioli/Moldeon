import { describe, expect, it } from "vitest";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { buildTemplateAssemblySeams } from "./templateAssemblySeams";
import {
  garmentDraftToPatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  validatePatternDocumentV3,
} from "./patternDocumentV3";

describe("paired physical-copy SeamGroups", () => {
  it("round-trips trouser front/back rise closures through PatternDocumentV3", () => {
    const base = createGarmentFromTemplate("straight-pants", DEFAULT_BODY_MEASUREMENTS);
    const garment = { ...base, seams: buildTemplateAssemblySeams(base) };
    const document = garmentDraftToPatternDocumentV3(garment);
    const paired = document.seamGroups.filter((group) => (group.physicalBindings?.length ?? 0) > 0
      && group.first[0]?.pieceId === group.second[0]?.pieceId);
    expect(paired.map((group) => group.id).sort()).toEqual([
      "template-seam:trouser-back-rise",
      "template-seam:trouser-front-rise",
    ]);
    expect(validatePatternDocumentV3(document).filter((issue) => issue.severity === "error")).toEqual([]);
    const projected = patternDocumentV3ToGarmentDraft(document);
    const projectedPaired = (projected.seams ?? []).filter((seam) => (seam.physicalBindings?.length ?? 0) > 0
      && seam.first.pieceId === seam.second.pieceId);
    expect(projectedPaired).toHaveLength(2);
    expect(projectedPaired.every((seam) => seam.first.pieceId === seam.second.pieceId)).toBe(true);
  });

  it("requires at least two physical copies for a paired-copy relation", () => {
    const base = createGarmentFromTemplate("straight-pants", DEFAULT_BODY_MEASUREMENTS);
    const garment = { ...base, seams: buildTemplateAssemblySeams(base) };
    const document = garmentDraftToPatternDocumentV3(garment);
    const frontId = document.seamGroups.find((group) => group.id === "template-seam:trouser-front-rise")!.first[0].pieceId;
    const invalid = {
      ...document,
      panelInstances: document.panelInstances.filter((instance) => instance.sourcePatternId !== frontId || instance.copyIndex === 0),
    };
    expect(validatePatternDocumentV3(invalid).some((issue) => issue.code === "invalid-physical-binding" && issue.entityId === "template-seam:trouser-front-rise")).toBe(true);
  });
});
