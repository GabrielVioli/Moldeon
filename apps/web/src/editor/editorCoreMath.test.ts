import { describe, expect, it } from "vitest";
import {
  chooseHighestPriorityHit,
  filterDocumentIds,
  handleVectorFromPolar,
  handleVectorToPolar,
  screenToleranceMm,
} from "./editorCoreMath";

describe("editor core interaction math", () => {
  it("keeps hit testing tolerance stable in screen pixels across zoom", () => {
    expect(screenToleranceMm(12, 0.5)).toBe(24);
    expect(screenToleranceMm(12, 1)).toBe(12);
    expect(screenToleranceMm(12, 2)).toBe(6);
  });

  it("uses the required hit testing priority before distance", () => {
    const hit = chooseHighestPriorityHit([
      { kind: "piece" as const, distancePx: 0 },
      { kind: "internal" as const, distancePx: 1 },
      { kind: "segment" as const, distancePx: 2 },
      { kind: "marker" as const, distancePx: 3 },
      { kind: "point" as const, distancePx: 4 },
      { kind: "handle" as const, distancePx: 11 },
    ]);
    expect(hit?.kind).toBe("handle");
  });

  it("keeps only ids that still exist in the document", () => {
    expect(filterDocumentIds(["a", "b"], ["ghost", "a", "b", "a"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("round-trips handle coordinates through length and angle", () => {
    const polar = handleVectorToPolar({ xMm: 30, yMm: 40 });
    expect(polar.lengthMm).toBe(50);
    expect(polar.angleDeg).toBeCloseTo(53.130102, 5);
    const vector = handleVectorFromPolar(polar.lengthMm, polar.angleDeg);
    expect(vector.xMm).toBeCloseTo(30, 5);
    expect(vector.yMm).toBeCloseTo(40, 5);
  });

  it("rejects invalid numeric handle values", () => {
    expect(() => handleVectorFromPolar(-1, 0)).toThrow(
      "comprimento do handle",
    );
    expect(() => screenToleranceMm(12, 0)).toThrow("zoom");
  });
});
