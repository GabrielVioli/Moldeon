import { describe, expect, it } from "vitest";
import type { PatternVector } from "../domain/pattern";
import {
  createMeasurementProfile,
  measurementProfileToBodyMeasurements,
} from "../domain/parametricMeasurements";
import { draftBasePattern } from "./basePatternDrafting";
import { DEFAULT_BODY_MEASUREMENTS } from "./templateCatalog";

describe("canonical skirt dart geometry", () => {
  it("drafts equal material legs around the waist-edge mouth", () => {
    const measurements = measurementProfileToBodyMeasurements(
      createMeasurementProfile(DEFAULT_BODY_MEASUREMENTS, "feminine"),
    );
    const draft = draftBasePattern("straight-skirt", measurements);
    const darts = draft.pieces.flatMap((piece) => piece.darts ?? []);

    expect(darts).toHaveLength(2);
    for (const dart of darts) {
      const legALengthMm = distance(dart.apex, dart.legA);
      const legBLengthMm = distance(dart.apex, dart.legB);
      const mouth = midpoint(dart.legA, dart.legB);

      expect(legALengthMm).toBeGreaterThan(dart.lengthMm);
      expect(legBLengthMm).toBeGreaterThan(dart.lengthMm);
      expect(Math.abs(legALengthMm - legBLengthMm)).toBeLessThan(1e-9);
      expect(distance(mouth, dart.centerLine.start)).toBeLessThan(1e-9);
      expect(distance(dart.centerLine.start, dart.apex)).toBeCloseTo(dart.lengthMm, 9);
    }
  });
});

function distance(first: PatternVector, second: PatternVector): number {
  return Math.hypot(first.xMm - second.xMm, first.yMm - second.yMm);
}

function midpoint(first: PatternVector, second: PatternVector): PatternVector {
  return {
    xMm: (first.xMm + second.xMm) * 0.5,
    yMm: (first.yMm + second.yMm) * 0.5,
  };
}
