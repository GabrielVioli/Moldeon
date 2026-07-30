import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import {
  DEFAULT_BODY_MEASUREMENTS,
  PATTERN_TEMPLATES,
  createGarmentFromTemplate,
} from "./templateCatalog";

describe("pattern template catalog", () => {
  it("offers the six essential editable bases", () => {
    expect(PATTERN_TEMPLATES.map((template) => template.id)).toEqual([
      "tshirt",
      "blouse",
      "straight-skirt",
      "mini-skirt",
      "straight-pants",
      "basic-jacket",
    ]);
  });

  it.each(PATTERN_TEMPLATES)(
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
      "basic-jacket",
      DEFAULT_BODY_MEASUREMENTS,
      "masculine",
    );

    expect(garment.bodyType).toBe("masculine");
    expect(garment.measurements.shoulderWidthMm).toBeGreaterThan(0);
    expect(garment.measurements.armLengthMm).toBeGreaterThan(0);
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
