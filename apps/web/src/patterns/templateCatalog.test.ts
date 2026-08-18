import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { analyzeSleeveCompatibility, createDefaultSleeveSettings, isSleevePiece } from "../domain/sleeveSystem";
import {
  DEFAULT_BODY_MEASUREMENTS,
  PATTERN_TEMPLATES,
  PUBLIC_PATTERN_TEMPLATES,
  createGarmentFromTemplate,
} from "./templateCatalog";

describe("pattern template catalog", () => {
  it("keeps the seven deferred generators in the internal catalog", () => {
    expect(PATTERN_TEMPLATES.map((template) => template.id)).toEqual([
      "bodice-block",
      "tshirt",
      "blouse",
      "straight-skirt",
      "mini-skirt",
      "straight-pants",
      "basic-jacket",
    ]);
    expect(PATTERN_TEMPLATES.every((template) => template.visibility === "internal")).toBe(true);
    expect(PATTERN_TEMPLATES.every((template) => template.releaseStatus === "deferred")).toBe(true);
  });

  it("does not expose an automatic template in the public library", () => {
    expect(PUBLIC_PATTERN_TEMPLATES).toEqual([]);
  });

  it("documents an id, version, confidence state and methodology for every library entry", () => {
    for (const template of PATTERN_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.formulaVersion).toMatch(/@\d+$/);
      expect(["experimental", "geometrically-validated", "manually-reviewed"]).toContain(template.validationStatus);
      expect(template.methodology.id).toBeTruthy();
      expect(template.methodology.version).toBeTruthy();
      expect(template.methodology.documentationPath).toBe("docs/PATTERN_LIBRARY.md");
      if (template.status === "available") {
        expect(template.methodology.sourceType).toBe("documented-adaptation");
        expect(template.methodology.references.length).toBeGreaterThan(0);
      }
    }
  });

  it.each(PATTERN_TEMPLATES.filter((template) => template.status === "available"))(
    "generates valid pieces for $name",
    ({ id }) => {
      const garment = createGarmentFromTemplate(id, DEFAULT_BODY_MEASUREMENTS);
      const engine = new FallbackPatternEngine();
      expect(garment.pieces.length).toBeGreaterThanOrEqual(2);
      expect(garment.fabrics).toHaveLength(1);

      for (const piece of garment.pieces) {
        const snapshot = engine.restorePiece(piece);
        expect(snapshot.issues, piece.name).toEqual([]);
        expect(piece.previewPlacements?.length, piece.name).toBeGreaterThan(0);
        expect(piece.cutQuantity, piece.name).toBeGreaterThan(0);
        expect(piece.fabricId).toBe(garment.fabrics[0].id);
      }
    },
  );

  it("regenerates dimensions from explicit body measurements", () => {
    const smaller = createGarmentFromTemplate("tshirt", {
      ...DEFAULT_BODY_MEASUREMENTS,
      bustMm: 800,
    });
    const larger = createGarmentFromTemplate("tshirt", {
      ...DEFAULT_BODY_MEASUREMENTS,
      bustMm: 1200,
    });
    const smallerWidth = Math.max(
      ...smaller.pieces[0].points.map((point) => point.xMm),
    );
    const largerWidth = Math.max(
      ...larger.pieces[0].points.map((point) => point.xMm),
    );

    expect(largerWidth).toBeGreaterThan(smallerWidth);
    expect(larger.measurements.bustMm).toBe(1200);
  });

  it("stores the selected body type with all avatar measurements", () => {
    const garment = createGarmentFromTemplate(
      "blouse",
      DEFAULT_BODY_MEASUREMENTS,
      "masculine",
    );

    expect(garment.bodyType).toBe("masculine");
    expect(garment.measurements.shoulderWidthMm).toBeGreaterThan(0);
    expect(garment.measurements.armLengthMm).toBeGreaterThan(0);
  });

  it("keeps the jacket unavailable until its own block is validated", () => {
    expect(PATTERN_TEMPLATES.find((template) => template.id === "basic-jacket")?.status).toBe("development");
    expect(() => createGarmentFromTemplate("basic-jacket", DEFAULT_BODY_MEASUREMENTS)).toThrow(/desenvolvimento/i);
  });

  it("generates drafting semantics, construction marks and real skirt darts", () => {
    const top = createGarmentFromTemplate("tshirt", DEFAULT_BODY_MEASUREMENTS);
    expect(top.pieces.flatMap((piece) => piece.segments ?? []).some((segment) => segment.role === "frontArmhole")).toBe(true);
    const sleeve = top.pieces.find(isSleevePiece)!;
    expect(sleeve.segments?.map((segment) => segment.role)).toContain("sleeveCapFront");
    expect(top.pieces.every((piece) => piece.grainline)).toBe(true);
    expect(top.parametric?.templateVersion).toBe("tshirt@4");
    expect(top.parametric?.variables.length).toBeGreaterThan(10);
    expect(top.parametric?.generations.every((generation) => generation.methodology?.id === "freesewing-brian-teagan-moldeon-adaptation")).toBe(true);

    const topFront = top.pieces.find((piece) => piece.segments?.some((segment) => segment.role === "frontArmhole"))!;
    const topBack = top.pieces.find((piece) => piece.segments?.some((segment) => segment.role === "backArmhole"))!;
    const settings = createDefaultSleeveSettings(top, topFront.id, topBack.id, "short");
    expect(analyzeSleeveCompatibility(top, topFront.id, topBack.id, settings).status).not.toBe("error");

    const document = garmentDraftToPatternDocumentV3(top);
    const sleeveDefinition = document.patternDefinitions.find((definition) => definition.semanticRole === "sleeve")!;
    expect(sleeveDefinition.cutQuantity).toBe(2);
    expect(sleeveDefinition.cutOnFold).toBe(false);
    expect(sleeveDefinition.mirrorRule).toBe("paired");
    expect(document.panelInstances.filter((instance) => instance.sourcePatternId === sleeveDefinition.id).map((instance) => instance.mirrored)).toEqual([false, true]);

    const skirt = createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS);
    expect(skirt.pieces.every((piece) => piece.darts?.length === 1)).toBe(true);
    expect(skirt.pieces.every((piece) => piece.internalLines?.some((line) => line.id.includes("hip-line")))).toBe(true);
    const front = skirt.pieces.find((piece) => piece.name === "Frente")!;
    const back = skirt.pieces.find((piece) => piece.name === "Costas")!;
    expect(back.darts![0].widthMm).toBeGreaterThan(front.darts![0].widthMm);

    const pants = createGarmentFromTemplate("straight-pants", DEFAULT_BODY_MEASUREMENTS);
    expect(pants.pieces.every((piece) => piece.internalLines?.some((line) => line.id.includes("knee-line")))).toBe(true);
    expect(pants.pieces.every((piece) => piece.darts?.length === 1)).toBe(true);
    expect(pants.parametric?.templateVersion).toBe("straight-pants@3");
    expect(PATTERN_TEMPLATES.find((template) => template.id === "straight-pants")?.instanceExpansion).toHaveLength(2);
  });

  it("rejects measurements outside the supported drafting range", () => {
    expect(() =>
      createGarmentFromTemplate("straight-pants", {
        ...DEFAULT_BODY_MEASUREMENTS,
        hipMm: 300,
      }),
    ).toThrow(/quadril|hipMm/i);
  });
});
