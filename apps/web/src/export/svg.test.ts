import { describe, expect, it } from "vitest";
import type { PatternSnapshot } from "../domain/pattern";
import { createPatternSvg } from "./svg";

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
});
