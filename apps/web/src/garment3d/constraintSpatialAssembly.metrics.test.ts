import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentDraft } from "../domain/pattern";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { createGeneralGarmentShellFixture } from "../testFixtures/generalGarmentShell";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

const REPORT = process.env.MOLDEON_10_6_REPORT === "1";

describe("Prompt 10.6 before/after metrics", () => {
  it("reports representative complex garments", () => {
    const fixtures: Array<[string, GarmentDraft]> = [
      ["curved-four-panel-shell", createGeneralGarmentShellFixture()],
      ["body-plus-upper-band", createBaselineFixture("spatial-notched-tube-waistband")],
      ["straight-pants", createBaselineFixture("straight-pants-standard")],
    ];
    const rows = fixtures.map(([fixture, garment]) => {
      const input = buildResolvedAssemblyInput(garment);
      const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
      const arrangement = buildSemanticAvatarArrangement(input, avatar);
      const components = arrangement.constraintSpatialAssembly.components;
      const main = [...components].sort((left, right) => right.constraintCount - left.constraintCount)[0];
      expect(main).toBeDefined();
      expect(Number.isFinite(main.assemblySolveMs)).toBe(true);
      expect([...arrangement.state.positions].every(Number.isFinite)).toBe(true);
      return {
        fixture,
        oldSeed: "legacy-geometric-seed",
        oldMeanMm: main.beforeMeanResidualMm,
        oldMaxMm: main.beforeMaxResidualMm,
        newStrategy: main.strategy,
        newMeanMm: main.meanResidualMm,
        newMaxMm: main.maxResidualMm,
        normalizedResidual: main.normalizedResidual,
        nonPlanarityRad: main.nonPlanarityRad,
        overlap: main.coarseOverlapScore,
        intrinsicDistortion: main.intrinsicDistortion,
        cycles: main.cycleCount,
        freeBoundaries: main.freeBoundaryCount,
        assemblySolveMs: main.assemblySolveMs,
      };
    });
    if (REPORT) console.log(`MOLDEON_10_6_COMPARISON ${JSON.stringify(rows)}`);
    expect(rows.every((row) => row.newStrategy === "constraint-spatial-shell")).toBe(true);
    expect(rows.every((row) => row.intrinsicDistortion < 5e-4)).toBe(true);
    expect(rows.every((row) => row.assemblySolveMs < 500)).toBe(true);
  });
});
