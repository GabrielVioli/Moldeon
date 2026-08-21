import { describe, expect, it } from "vitest";
import { classifyCoarseStitch } from "./CoarseSeamConstraints";

const stitch = (treatment: string, targetRatio = 1, slackMm = 0) => ({
  treatment,
  targetRatio,
  slackMm,
  seamId: "seam:test",
  seamGroupId: "group:test",
});

describe("classifyCoarseStitch", () => {
  it("keeps local shaping out of the global shell graph", () => {
    expect(classifyCoarseStitch({ ...stitch("dart"), seamId: "dart:test" }))
      .toBe("local-shaping-closure");
  });

  it.each(["ease", "gather", "stretch", "intentional-mismatch"])(
    "classifies %s as intentional material mismatch",
    (treatment) => {
      expect(classifyCoarseStitch(stitch(treatment))).toBe("intentional-mismatch");
    },
  );

  it("uses only compatible standard seams to define the global shell", () => {
    expect(classifyCoarseStitch(stitch("standard"))).toBe("structural-alignment");
    expect(classifyCoarseStitch(stitch("standard", 1.2))).toBe("intentional-mismatch");
  });
});
