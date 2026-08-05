import { describe, expect, it } from "vitest";
import { createPatternSnapshot } from "../core/fallbackPatternEngine";
import { parseGarmentDraft } from "../domain/pattern";
import {
  BASELINE_FIXTURE_IDS,
  createAllBaselineFixtures,
  createBaselineFixture,
} from "./baselineGarments";

describe("baseline garment fixtures", () => {
  it("provides every scene required by phase 0", () => {
    expect(BASELINE_FIXTURE_IDS).toEqual([
      "tshirt-standard",
      "blouse-standard",
      "straight-skirt-standard",
      "mini-skirt-standard",
      "straight-pants-standard",
      "free-simple-piece",
      "bezier-piece",
      "inserted-point-piece",
      "dart-piece",
      "equal-length-seam",
      "length-mismatch-seam",
      "self-seam-tube",
      "sleeve-with-body",
      "multiple-fabrics",
      "legacy-valid",
      "intentionally-invalid",
    ]);
    expect(Object.keys(createAllBaselineFixtures())).toHaveLength(16);
  });

  it.each(BASELINE_FIXTURE_IDS)("creates %s deterministically", (id) => {
    expect(createBaselineFixture(id)).toEqual(createBaselineFixture(id));
  });

  it.each(
    BASELINE_FIXTURE_IDS.filter((id) => id !== "intentionally-invalid"),
  )("round-trips the valid fixture %s through the parser", (id) => {
    const fixture = createBaselineFixture(id);
    const restored = parseGarmentDraft(JSON.parse(JSON.stringify(fixture)));

    expect(restored.id).toBe(fixture.id);
    expect(restored.pieces).toHaveLength(fixture.pieces.length);
    expect(restored.fabrics.length).toBeGreaterThan(0);
    expect(
      restored.pieces.every((piece) =>
        restored.fabrics.some((fabric) => fabric.id === piece.fabricId),
      ),
    ).toBe(true);
  });

  it("keeps the invalid fixture intentionally non-triangulatable", () => {
    const fixture = createBaselineFixture("intentionally-invalid");
    const snapshot = createPatternSnapshot(fixture.pieces[0]);

    expect(snapshot.issues.length).toBeGreaterThan(0);
  });

  it("models the tube with a self seam and the multi-fabric scene with two sources", () => {
    const tube = createBaselineFixture("self-seam-tube");
    expect(tube.seams).toHaveLength(1);
    expect(tube.seams?.[0].first.pieceId).toBe(tube.seams?.[0].second.pieceId);

    const multiple = createBaselineFixture("multiple-fabrics");
    expect(multiple.fabrics).toHaveLength(2);
    expect(new Set(multiple.pieces.map((piece) => piece.fabricId)).size).toBe(2);
  });
});
