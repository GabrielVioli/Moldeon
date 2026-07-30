import { describe, expect, it } from "vitest";
import type { PatternSnapshot } from "../domain/pattern";
import { createGarmentSvg, createPatternSvg } from "./svg";

const SNAPSHOT: PatternSnapshot = {
  piece: {
    id: "square",
    name: "Molde & teste",
    seamAllowanceMm: 10,
    points: [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 100, yMm: 0 },
      { id: "c", xMm: 100, yMm: 100 },
      { id: "d", xMm: 0, yMm: 100 },
    ],
  },
  areaMm2: 10_000,
  perimeterMm: 400,
  issues: [],
};

describe("SVG export", () => {
  it("exports cutting and stitching lines with the seam allowance in bounds", () => {
    const svg = createPatternSvg(SNAPSHOT);

    expect(svg).toContain('width="160mm"');
    expect(svg).toContain('height="160mm"');
    expect(svg).toContain('id="cutting-line"');
    expect(svg).toContain('id="stitching-line"');
    expect(svg).toContain("Margem de costura: 10 mm");
    expect(svg).toContain("<title>Molde &amp; teste</title>");
  });

  it("uses the pattern itself as the cutting line without an allowance", () => {
    const svg = createPatternSvg({
      ...SNAPSHOT,
      piece: { ...SNAPSHOT.piece, seamAllowanceMm: 0 },
    });

    expect(svg).toContain('width="140mm"');
    expect(svg).not.toContain('id="stitching-line"');
  });

  it("preserves cubic commands on the stitching line", () => {
    const curved: PatternSnapshot = {
      ...SNAPSHOT,
      piece: {
        ...SNAPSHOT.piece,
        points: SNAPSHOT.piece.points.map((point) => ({ ...point })),
      },
    };
    curved.piece.points[0].handleOut = { xMm: 30, yMm: -25 };
    curved.piece.points[1].handleIn = { xMm: -30, yMm: -25 };

    const svg = createPatternSvg(curved);
    expect(svg).toMatch(/id="stitching-line" d="M [^"]+ C /);
  });

  it("lays out multiple editable pieces in one physical-size SVG", () => {
    const second: PatternSnapshot = {
      ...SNAPSHOT,
      piece: {
        ...SNAPSHOT.piece,
        id: "second",
        name: "Costas",
        cutQuantity: 1,
        cutOnFold: true,
      },
    };
    const svg = createGarmentSvg([SNAPSHOT, second], "Camiseta base");

    expect(svg).toContain("<title>Camiseta base</title>");
    expect(svg).toContain('id="piece-1"');
    expect(svg).toContain('id="piece-2"');
    expect(svg).toContain("Costas · cortar 1× · na dobra");
    expect(svg).toContain("escala vetorial 1:1");
  });
});
