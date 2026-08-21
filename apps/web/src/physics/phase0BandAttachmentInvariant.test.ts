import { describe, expect, it } from "vitest";
import {
  edgeRangeSequenceLength,
  getPatternEdges,
  type EdgeRange,
  type GarmentDraft,
  type PatternPiece,
  type Seam,
} from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { createBaselineFixture } from "../testFixtures/baselineGarments";

const BAND_HEIGHT_MM = 35;
const SHELL_RMS_LIMIT_MM = 1;

interface BandCase {
  id: "straight-skirt-standard" | "straight-pants-standard" | "spatial-four-panel-tube";
  timeoutMs: number;
}

const CASES: readonly BandCase[] = [
  { id: "spatial-four-panel-tube", timeoutMs: 15_000 },
  { id: "straight-skirt-standard", timeoutMs: 45_000 },
  { id: "straight-pants-standard", timeoutMs: 45_000 },
];

describe("Phase 0 local-band attachment invariance", () => {
  for (const fixture of CASES) {
    it(`adding one narrow upper band does not re-embed ${fixture.id}`, () => {
      const baseGarment = createBaselineFixture(fixture.id);
      const bandedGarment = addNarrowUpperBand(baseGarment, `phase0-band:${fixture.id}`);
      const base = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(baseGarment));
      const banded = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(bandedGarment));
      const mainPatternIds = new Set(baseGarment.pieces.map((piece) => piece.id));
      const comparison = rigidInvariantShellDistanceComparison(
        base.state,
        banded.state,
        mainPatternIds,
      );
      const joinGroup = `phase0-band:${fixture.id}:join`;
      const joinStitches = banded.state.stitchConstraints.filter(
        (stitch) => stitch.seamGroupId === joinGroup,
      );

      console.log("MOLDEON_PHASE0_BAND_AB", JSON.stringify({
        fixtureId: fixture.id,
        baseSelectedSeeds: base.assembly.components.map((component) => component.selectedSeed),
        bandSelectedSeeds: banded.assembly.components.map((component) => component.selectedSeed),
        baseCycleRank: base.assembly.components.map((component) => component.cycleRank),
        bandCycleRank: banded.assembly.components.map((component) => component.cycleRank),
        baseMetrics: base.assembly.metrics,
        bandMetrics: banded.assembly.metrics,
        bandJoinStitchCount: joinStitches.length,
        shellRmsPairDistanceDeltaMm: comparison.rmsMm,
        shellMaxPairDistanceDeltaMm: comparison.maxMm,
        comparedPointCount: comparison.pointCount,
        warnings: banded.warnings,
      }));

      expect(banded.assembly.invalid).toBe(false);
      expect(joinStitches.length).toBeGreaterThan(4);
      expect(comparison.pointCount).toBeGreaterThan(8);
      expect(comparison.rmsMm).toBeLessThan(SHELL_RMS_LIMIT_MM);
    }, fixture.timeoutMs);
  }
});

function addNarrowUpperBand(garment: GarmentDraft, prefix: string): GarmentDraft {
  const openingRanges: EdgeRange[] = garment.pieces.flatMap((piece) =>
    getPatternEdges(piece)
      .filter((edge) => edge.role === "waist")
      .map((edge) => ({ pieceId: piece.id, edgeId: edge.id, startT: 0, endT: 1 })),
  );
  if (openingRanges.length === 0) {
    throw new Error(`${garment.id}: no semantic waist opening available for Phase 0 band gate`);
  }
  const openingLengthMm = edgeRangeSequenceLength(garment.pieces, openingRanges);
  if (!Number.isFinite(openingLengthMm) || openingLengthMm <= 1) {
    throw new Error(`${garment.id}: invalid waist opening length ${openingLengthMm}`);
  }

  const band: PatternPiece = {
    id: `${prefix}:piece`,
    name: "Phase 0 local attachment strip",
    seamAllowanceMm: 0,
    cutQuantity: 1,
    fabricId: garment.pieces[0]?.fabricId ?? garment.fabrics[0]?.id,
    points: [
      { id: `${prefix}:tl`, xMm: 0, yMm: 0 },
      { id: `${prefix}:tr`, xMm: openingLengthMm, yMm: 0 },
      { id: `${prefix}:br`, xMm: openingLengthMm, yMm: BAND_HEIGHT_MM },
      { id: `${prefix}:bl`, xMm: 0, yMm: BAND_HEIGHT_MM },
    ],
  };
  const bandEdges = getPatternEdges(band);
  const loop: Seam = {
    id: `${prefix}:loop`,
    groupId: `${prefix}:loop`,
    name: "Phase 0 local strip closure",
    first: { pieceId: band.id, edgeId: bandEdges[1].id, startT: 0, endT: 1 },
    second: { pieceId: band.id, edgeId: bandEdges[3].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  const join: Seam = {
    id: `${prefix}:join`,
    groupId: `${prefix}:join`,
    name: "Phase 0 local strip attachment",
    first: openingRanges[0],
    firstRanges: openingRanges,
    second: { pieceId: band.id, edgeId: bandEdges[2].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  return {
    ...garment,
    id: `${garment.id}:with-local-band`,
    name: `${garment.name} + local band`,
    pieces: [...garment.pieces, band],
    seams: [...(garment.seams ?? []), loop, join],
    assemblyPlacements: [
      ...(garment.assemblyPlacements ?? []),
      {
        pieceId: band.id,
        role: "waist",
        outwardSide: "front",
        positionMm: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        flipped: false,
        source: "manual",
      },
    ],
  };
}

function rigidInvariantShellDistanceComparison(
  base: GarmentAssemblyState,
  banded: GarmentAssemblyState,
  patternIds: ReadonlySet<string>,
): { rmsMm: number; maxMm: number; pointCount: number } {
  const bandedById = new Map(banded.instances.map((instance) => [instance.id, instance]));
  const pairs: Array<{
    baseOffset: number;
    bandedOffset: number;
  }> = [];
  for (const instance of base.instances) {
    if (!patternIds.has(instance.sourcePatternId)) continue;
    const counterpart = bandedById.get(instance.id);
    if (!counterpart || counterpart.vertexCount !== instance.vertexCount) continue;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      pairs.push({
        baseOffset: (instance.particleStart + local) * 3,
        bandedOffset: (counterpart.particleStart + local) * 3,
      });
    }
  }
  if (pairs.length < 2) return { rmsMm: Number.POSITIVE_INFINITY, maxMm: Number.POSITIVE_INFINITY, pointCount: pairs.length };

  const sampleCount = Math.min(96, pairs.length);
  const sample = Array.from({ length: sampleCount }, (_, index) =>
    pairs[Math.min(pairs.length - 1, Math.floor(index * (pairs.length - 1) / Math.max(1, sampleCount - 1)))],
  );
  let squaredSum = 0;
  let count = 0;
  let maximum = 0;
  for (let first = 0; first < sample.length; first += 1) {
    for (let second = first + 1; second < sample.length; second += 1) {
      const before = pointDistance(base.positions, sample[first].baseOffset, sample[second].baseOffset);
      const after = pointDistance(banded.positions, sample[first].bandedOffset, sample[second].bandedOffset);
      const delta = Math.abs(after - before) * 1_000;
      squaredSum += delta * delta;
      maximum = Math.max(maximum, delta);
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
