import { describe, expect, it } from "vitest";
import type { PatternPoint } from "./pattern";
import {
  createSeamAllowanceContour,
  polygonSignedAreaMm2,
  triangulatePatternContour,
  validatePatternContour,
} from "./polygonGeometry";

describe("pattern contour geometry", () => {
  it("triangulates a convex contour with explicit indices", () => {
    const square = points([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);

    const result = triangulatePatternContour(square);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.indices).toHaveLength(6);
    expect(triangulatedArea(square, result.indices)).toBeCloseTo(10_000);
  });

  it("triangulates a concave contour in either winding order", () => {
    const contour = points([
      [0, 0],
      [100, 0],
      [100, 50],
      [50, 50],
      [50, 100],
      [0, 100],
    ]);

    for (const candidate of [contour, [...contour].reverse()]) {
      const result = triangulatePatternContour(candidate);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.indices).toHaveLength(12);
      expect(triangulatedArea(candidate, result.indices)).toBeCloseTo(7_500);
    }
  });

  it("supports redundant collinear boundary points", () => {
    const contour = points([
      [0, 0],
      [50, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    const result = triangulatePatternContour(contour);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.indices).toHaveLength(9);
    expect(triangulatedArea(contour, result.indices)).toBeCloseTo(10_000);
  });

  it("rejects self-intersections before creating a mesh", () => {
    const issues = validatePatternContour(
      points([
        [0, 0],
        [100, 100],
        [0, 100],
        [100, 0],
      ]),
    );

    expect(issues).toContain("O contorno possui uma autointerseção.");
  });

  it("rejects duplicate point identifiers and coordinates", () => {
    const contour = points([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 0],
    ]);
    contour[3].id = contour[0].id;

    expect(validatePatternContour(contour)).toEqual(
      expect.arrayContaining([
        "Existem pontos com identificadores duplicados.",
        "Existem pontos sobrepostos no contorno.",
      ]),
    );
  });

  it("creates an outward seam allowance in either winding order", () => {
    const square = points([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);

    for (const contour of [square, [...square].reverse()]) {
      const seam = createSeamAllowanceContour(contour, 10);
      expect(seam).not.toBeNull();
      expect(seam?.map(({ xMm, yMm }) => [xMm, yMm])).toEqual(
        expect.arrayContaining([
          [-10, -10],
          [110, -10],
          [110, 110],
          [-10, 110],
        ]),
      );
      expect(Math.abs(polygonSignedAreaMm2(seam ?? []))).toBeCloseTo(14_400);
    }
  });

  it("does not create a seam allowance for an invalid contour", () => {
    const crossed = points([
      [0, 0],
      [100, 100],
      [0, 100],
      [100, 0],
    ]);

    expect(createSeamAllowanceContour(crossed, 10)).toBeNull();
    expect(createSeamAllowanceContour(points([[0, 0], [100, 0], [0, 100]]), -1)).toBeNull();
  });
});

function points(coordinates: ReadonlyArray<readonly [number, number]>): PatternPoint[] {
  return coordinates.map(([xMm, yMm], index) => ({
    id: `point-${index}`,
    xMm,
    yMm,
  }));
}

function triangulatedArea(
  contour: readonly PatternPoint[],
  indices: readonly number[],
): number {
  let area = 0;

  for (let index = 0; index < indices.length; index += 3) {
    area += Math.abs(
      polygonSignedAreaMm2([
        contour[indices[index]],
        contour[indices[index + 1]],
        contour[indices[index + 2]],
      ]),
    );
  }

  return area;
}
