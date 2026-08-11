import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createParametricBodyFixture } from "../testFixtures/parametricBodyFixtures";
import { createGarmentFromTemplate, type PatternTemplateId } from "./templateCatalog";
import { renderPatternEvidenceBoard } from "./trouserVisualEvidence";

const TEMPLATES: readonly PatternTemplateId[] = [
  "bodice-block",
  "tshirt",
  "blouse",
  "straight-skirt",
  "mini-skirt",
];

describe("pattern library visual evidence", () => {
  it("renders labeled and blind clean boards from authoritative 2D geometry", () => {
    const fixture = createParametricBodyFixture("medium");
    const output = process.env.PATTERN_EVIDENCE_DIR
      ? resolve(process.env.PATTERN_EVIDENCE_DIR)
      : null;
    if (output) mkdirSync(output, { recursive: true });

    for (const templateId of TEMPLATES) {
      const garment = createGarmentFromTemplate(
        templateId,
        fixture.supplied,
        fixture.bodyType,
        fixture.profile,
      );
      const version = garment.parametric?.templateVersion ?? templateId;
      const labeled = renderPatternEvidenceBoard(templateId, `${version} · geometria 2D`, garment.pieces);
      const blind = renderPatternEvidenceBoard("Teste cego", "Sem nomes de peça ou template", garment.pieces, true);
      for (const svg of [labeled, blind]) {
        expect(svg).toContain("<svg");
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      }
      if (output) {
        writeFileSync(resolve(output, `${templateId}-labeled.svg`), labeled, "utf8");
        writeFileSync(resolve(output, `${templateId}-blind.svg`), blind, "utf8");
      }
    }
  });
});
