import { describe, expect, it } from "vitest";
import type { PatternPiece } from "./pattern";
import {
  findNearestPatternSegment,
  insertPatternPoint,
  removePatternPoint,
} from "./patternEditing";

const square: PatternPiece = {
  id: "square",
  name: "Quadrado",
  seamAllowanceMm: 10,
  points: [
    { id: "a", xMm: 0, yMm: 0 },
    { id: "b", xMm: 100, yMm: 0 },
    { id: "c", xMm: 100, yMm: 100 },
    { id: "d", xMm: 0, yMm: 100 },
  ],
};

describe("pattern point editing", () => {
  it("finds and inserts a point on the nearest segment", () => {
    const target = findNearestPatternSegment(square.points, {
      xMm: 52,
      yMm: 4,
    });
    expect(target?.startPointId).toBe("a");
    expect(target?.t).toBeCloseTo(0.52);

    const result = insertPatternPoint(
      square,
      target!.startPointId,
      target!.t,
    );
    expect(result?.piece.points).toHaveLength(5);
    expect(result?.piece.points[1]).toMatchObject({
      id: "square:insert-1",
      xMm: 52,
      yMm: 0,
    });
  });

  it("splits a bezier without changing its shape", () => {
    const curved: PatternPiece = {
      ...square,
      points: [
        {
          id: "a",
          xMm: 0,
          yMm: 0,
          handleOut: { xMm: 30, yMm: -40 },
        },
        {
          id: "b",
          xMm: 100,
          yMm: 0,
          handleIn: { xMm: -30, yMm: -40 },
        },
        ...square.points.slice(2),
      ],
    };
    const result = insertPatternPoint(curved, "a", 0.5);

    expect(result?.piece.points[0].handleOut).toEqual({
      xMm: 15,
      yMm: -20,
    });
    expect(result?.piece.points[1]).toMatchObject({
      xMm: 50,
      yMm: -30,
    });
    expect(result?.piece.points[2].handleIn).toEqual({
      xMm: -15,
      yMm: -20,
    });
  });

  it("removes a point and protects the three-point minimum", () => {
    const removed = removePatternPoint(square, "b");
    expect(removed?.points.map((point) => point.id)).toEqual(["a", "c", "d"]);
    expect(removePatternPoint(removed!, "c")).toBeNull();
  });
});
