import { describe, expect, it } from "vitest";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { createBaselineFixture } from "../testFixtures/baselineGarments";

const RMS_LIMIT_MM = 0.05;
const MAX_LIMIT_MM = 0.05;

describe("Recovery 11.0.4A attachment regressions", () => {
  it("a sewn local flap does not re-embed the already resolved tube", () => {
    const baseGarment = createBaselineFixture("self-seam-tube");
    const flapGarment = createBaselineFixture("xpbd-tube-with-flap");
    const base = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(baseGarment));
    const withFlap = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(flapGarment));
    const parentPatternIds = new Set(baseGarment.pieces.map((piece) => piece.id));
    const delta = rigidInvariantShellDistanceComparison(
      base.state,
      withFlap.state,
      parentPatternIds,
    );

    console.log("MOLDEON_11_0_4A_FLAP_REGRESSION", JSON.stringify({
      baseSeeds: base.assembly.components.map((component) => component.selectedSeed),
      flapSeeds: withFlap.assembly.components.map((component) => component.selectedSeed),
      shellRmsDeltaMm: delta.rmsMm,
      shellMaxDeltaMm: delta.maxMm,
      comparedPointCount: delta.pointCount,
      invalid: withFlap.assembly.invalid,
      warnings: withFlap.warnings,
    }));

    expect(withFlap.assembly.invalid).toBe(false);
    expect(delta.pointCount).toBeGreaterThan(8);
    expect(delta.rmsMm).toBeLessThan(RMS_LIMIT_MM);
    expect(delta.maxMm).toBeLessThan(MAX_LIMIT_MM);
  }, 20_000);
});

function rigidInvariantShellDistanceComparison(
  base: GarmentAssemblyState,
  attached: GarmentAssemblyState,
  patternIds: ReadonlySet<string>,
): { rmsMm: number; maxMm: number; pointCount: number } {
  const attachedById = new Map(attached.instances.map((instance) => [instance.id, instance]));
  const pairs: Array<{ baseOffset: number; attachedOffset: number }> = [];
  for (const instance of base.instances) {
    if (!patternIds.has(instance.sourcePatternId)) continue;
    const counterpart = attachedById.get(instance.id);
    if (!counterpart || counterpart.vertexCount !== instance.vertexCount) continue;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      pairs.push({
        baseOffset: (instance.particleStart + local) * 3,
        attachedOffset: (counterpart.particleStart + local) * 3,
      });
    }
  }
  if (pairs.length < 2) {
    return { rmsMm: Number.POSITIVE_INFINITY, maxMm: Number.POSITIVE_INFINITY, pointCount: pairs.length };
  }

  const sampleCount = Math.min(96, pairs.length);
  const sample = Array.from({ length: sampleCount }, (_, index) =>
    pairs[Math.min(pairs.length - 1, Math.floor(index * (pairs.length - 1) / Math.max(1, sampleCount - 1)))],
  );
  let squaredSum = 0;
  let maximum = 0;
  let count = 0;
  for (let first = 0; first < sample.length; first += 1) {
    for (let second = first + 1; second < sample.length; second += 1) {
      const before = pointDistance(base.positions, sample[first].baseOffset, sample[second].baseOffset);
      const after = pointDistance(attached.positions, sample[first].attachedOffset, sample[second].attachedOffset);
      const deltaMm = Math.abs(after - before) * 1_000;
      squaredSum += deltaMm * deltaMm;
      maximum = Math.max(maximum, deltaMm);
      count += 1;
    }
  }
  return {
    rmsMm: count > 0 ? Math.sqrt(squaredSum / count) : 0,
    maxMm: maximum,
    pointCount: pairs.length,
  };
}

function pointDistance(positions: Float32Array, firstOffset: number, secondOffset: number): number {
  return Math.hypot(
    positions[firstOffset] - positions[secondOffset],
    positions[firstOffset + 1] - positions[secondOffset + 1],
    positions[firstOffset + 2] - positions[secondOffset + 2],
  );
}
