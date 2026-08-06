import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import {
  DEFAULT_BODY_MEASUREMENTS,
  PATTERN_TEMPLATES,
  createGarmentFromTemplate,
} from "./templateCatalog";

describe("pattern template catalog", () => {
  it("offers the seven essential editable bases", () => {
    expect(PATTERN_TEMPLATES.map((template) => template.id)).toEqual([
      "bodice-block",
      "tshirt",
      "blouse",
      "straight-skirt",
      "mini-skirt",
      "straight-pants",
      "basic-jacket",
    ]);
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
    expect(top.pieces.find((piece) => piece.name === "Manga")?.segments?.map((segment) => segment.role)).toContain("sleeveCapFront");
    expect(top.pieces.every((piece) => piece.grainline)).toBe(true);
    expect(top.parametric?.templateVersion).toBe("tshirt@2");
    expect(top.parametric?.variables.length).toBeGreaterThan(10);

    const skirt = createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS);
    expect(skirt.pieces.every((piece) => piece.darts?.length === 1)).toBe(true);
    expect(skirt.pieces.every((piece) => piece.internalLines?.some((line) => line.id.includes("hip-line")))).toBe(true);
    const front = skirt.pieces.find((piece) => piece.name === "Frente")!;
    const back = skirt.pieces.find((piece) => piece.name === "Costas")!;
    expect(back.darts![0].widthMm).toBeGreaterThan(front.darts![0].widthMm);

    const pants = createGarmentFromTemplate("straight-pants", DEFAULT_BODY_MEASUREMENTS);
    expect(pants.pieces.every((piece) => piece.internalLines?.some((line) => line.id.includes("knee-line")))).toBe(true);
    expect(pants.pieces.find((piece) => piece.name === "Costas")?.darts).toHaveLength(1);
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
