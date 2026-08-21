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
import {
  measureIntrinsicDistortion,
  type GarmentAssemblyState,
} from "../garment3d/GarmentAssembly";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import { measureXpbdDiagnostics, stepXpbd, type XpbdState } from "./xpbd";

const BAND_HEIGHT_MM = 35;
const PARENT_RMS_LIMIT_MM = 0.05;
const PARENT_MAX_LIMIT_MM = 0.05;
const BAND_SEAM_LIMIT_MM = 0.5;
const BAND_INTRINSIC_LIMIT = 0.001;

const TARGETS = [
  "self-seam-tube",
  "spatial-four-panel-tube",
  "straight-skirt-standard",
] as const;

describe("Recovery 11.0.4A narrow attached bands", () => {
  it.each(TARGETS)("preserves the resolved parent shell for %s", (fixtureId) => {
    const parentGarment = createBaselineFixture(fixtureId);
    const prefix = `11.0.4a:${fixtureId}`;
    const { garment: bandedGarment, bandPieceId, joinGroupId } = addNarrowBand(parentGarment, prefix);
    const parent = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(parentGarment));
    const banded = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(bandedGarment));
    const parentPatternIds = new Set(parentGarment.pieces.map((piece) => piece.id));
    const shellDelta = rigidInvariantShellDistanceComparison(
      parent.state,
      banded.state,
      parentPatternIds,
    );
    const parentSeeds = parent.assembly.components.map((component) => component.selectedSeed);
    const bandedSeeds = banded.assembly.components.map((component) => component.selectedSeed);
    const bandInstance = banded.state.instances.find(
      (instance) => instance.sourcePatternId === bandPieceId,
    );
    expect(bandInstance).toBeDefined();
    const intrinsic = measureIntrinsicDistortion(banded.state);
    const bandIntrinsic = intrinsic.byInstance[bandInstance!.id];
    const initialization = buildXpbdInitialization(
      banded.state,
      bandedGarment,
      `11.0.4a:${fixtureId}`,
      { bodyCollisionEnabled: false, config: { gravity: [0, 0, 0], maximumSubsteps: 1 } },
    );
    const bandJoin = initialization.seamResidualAudit.groups.find(
      (group) => group.seamGroupId === joinGroupId,
    );

    console.log("MOLDEON_11_0_4A_BAND_AB", JSON.stringify({
      fixtureId,
      parentSeeds,
      bandedSeeds,
      shellRmsDeltaMm: shellDelta.rmsMm,
      shellMaxDeltaMm: shellDelta.maxMm,
      parentPointCount: shellDelta.pointCount,
      bandJoinMeanMm: bandJoin?.meanResidualMm,
      bandJoinMaxMm: bandJoin?.maxResidualMm,
      bandIntrinsic,
      assemblyMetrics: banded.assembly.metrics,
      warnings: banded.warnings,
    }));

    expect(banded.assembly.invalid).toBe(false);
    expect(parentSeeds).toEqual(bandedSeeds);
    expect(shellDelta.pointCount).toBeGreaterThan(8);
    expect(shellDelta.rmsMm).toBeLessThan(PARENT_RMS_LIMIT_MM);
    expect(shellDelta.maxMm).toBeLessThan(PARENT_MAX_LIMIT_MM);
    expect(bandJoin).toBeDefined();
    expect(bandJoin!.maxResidualMm).toBeLessThan(BAND_SEAM_LIMIT_MM);
    expect(bandIntrinsic.maxRelativeDistortion).toBeLessThan(BAND_INTRINSIC_LIMIT);
  }, 45_000);

  it("keeps a multi-panel shell plus band at zero energy with gravity disabled", () => {
    const { garment } = addNarrowBand(
      createBaselineFixture("spatial-four-panel-tube"),
      "11.0.4a:zero-g",
    );
    const assembly = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(garment));
    const state = createXpbdWorkerState(buildXpbdInitialization(
      assembly.state,
      garment,
      "11.0.4a:zero-g",
      { bodyCollisionEnabled: false, config: { gravity: [0, 0, 0], maximumSubsteps: 1 } },
    ));
    const initial = new Float32Array(state.positions);
    const step0 = measureXpbdDiagnostics(state);
    run(state, 500);
    const final = measureXpbdDiagnostics(state);
    const shapeDeltaM = maximumCenteredDelta(initial, state.positions);

    console.log("MOLDEON_11_0_4A_ZERO_G", JSON.stringify({
      step0,
      final,
      shapeDeltaMm: shapeDeltaM * 1_000,
    }));

    expectMaterialPose(step0);
    expectMaterialPose(final);
    expect(final.flippedTriangleCount).toBe(0);
    expect(shapeDeltaM).toBeLessThan(0.0005);
    expect(state.invalid).toBe(false);
  }, 20_000);

  it("falls coherently as one free body at gravity 100 with collision disabled", () => {
    const { garment } = addNarrowBand(
      createBaselineFixture("spatial-four-panel-tube"),
      "11.0.4a:g100",
    );
    const assembly = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(garment));
    const state = createXpbdWorkerState(buildXpbdInitialization(
      assembly.state,
      garment,
      "11.0.4a:g100",
      { bodyCollisionEnabled: false, config: { gravity: [0, -100, 0], maximumSubsteps: 1 } },
    ));
    const initial = new Float32Array(state.positions);
    const initialCentroid = centroid(initial);
    run(state, 500);
    const finalCentroid = centroid(state.positions);
    const final = measureXpbdDiagnostics(state);
    const shapeDeltaM = maximumCenteredDelta(initial, state.positions);

    console.log("MOLDEON_11_0_4A_GRAVITY100", JSON.stringify({
      final,
      shapeDeltaMm: shapeDeltaM * 1_000,
      translationMm: {
        x: (finalCentroid[0] - initialCentroid[0]) * 1_000,
        y: (finalCentroid[1] - initialCentroid[1]) * 1_000,
        z: (finalCentroid[2] - initialCentroid[2]) * 1_000,
      },
    }));

    expectMaterialPose(final);
    expect(final.flippedTriangleCount).toBe(0);
    expect(shapeDeltaM).toBeLessThan(0.0005);
    expect(finalCentroid[1]).toBeLessThan(initialCentroid[1] - 1);
    expect(state.invalid).toBe(false);
  }, 20_000);
});

function addNarrowBand(
  garment: GarmentDraft,
  prefix: string,
): { garment: GarmentDraft; bandPieceId: string; joinGroupId: string } {
  const openingRanges: EdgeRange[] = garment.pieces.flatMap((piece) =>
    getPatternEdges(piece)
      .filter((edge) => edge.role === "waist")
      .map((edge) => ({ pieceId: piece.id, edgeId: edge.id, startT: 0, endT: 1 })),
  );
  if (openingRanges.length === 0) {
    throw new Error(`${garment.id}: missing semantic upper opening`);
  }
  const openingLengthMm = edgeRangeSequenceLength(garment.pieces, openingRanges);
  if (!Number.isFinite(openingLengthMm) || openingLengthMm <= 1) {
    throw new Error(`${garment.id}: invalid upper opening length ${openingLengthMm}`);
  }

  const bandPieceId = `${prefix}:piece`;
  const band: PatternPiece = {
    id: bandPieceId,
    name: "11.0.4A attached narrow strip fixture",
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
  const edges = getPatternEdges(band);
  const loop: Seam = {
    id: `${prefix}:loop`,
    groupId: `${prefix}:loop`,
    name: "11.0.4A strip loop",
    first: { pieceId: band.id, edgeId: edges[1].id, startT: 0, endT: 1 },
    second: { pieceId: band.id, edgeId: edges[3].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  const joinGroupId = `${prefix}:join`;
  const join: Seam = {
    id: joinGroupId,
    groupId: joinGroupId,
    name: "11.0.4A attached opening join",
    first: openingRanges[0],
    firstRanges: openingRanges,
    second: { pieceId: band.id, edgeId: edges[2].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };

  return {
    bandPieceId,
    joinGroupId,
    garment: {
      ...garment,
      id: `${garment.id}:11.0.4a-band`,
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
    },
  };
}

function expectMaterialPose(diagnostics: ReturnType<typeof measureXpbdDiagnostics>): void {
  expect(diagnostics.seamErrorMaximum).toBeLessThan(0.0005);
  expect(diagnostics.structuralStretchMaxRatio).toBeLessThan(1.001);
  expect(diagnostics.structuralCompressionMinRatio).toBeGreaterThan(0.999);
  expect(diagnostics.shearStrainMax).toBeLessThan(0.001);
  expect(diagnostics.triangleAreaMinRatio).toBeGreaterThan(0.998);
  expect(diagnostics.triangleAreaMaxRatio).toBeLessThan(1.002);
}

function run(state: XpbdState, steps: number): void {
  for (let step = 0; step < steps && !state.invalid; step += 1) stepXpbd(state);
}

function rigidInvariantShellDistanceComparison(
  base: GarmentAssemblyState,
  banded: GarmentAssemblyState,
  patternIds: ReadonlySet<string>,
): { rmsMm: number; maxMm: number; pointCount: number } {
  const bandedById = new Map(banded.instances.map((instance) => [instance.id, instance]));
  const pairs: Array<{ baseOffset: number; bandedOffset: number }> = [];
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
      const after = pointDistance(banded.positions, sample[first].bandedOffset, sample[second].bandedOffset);
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

function centroid(positions: Float32Array): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  const count = positions.length / 3;
  for (let offset = 0; offset < positions.length; offset += 3) {
    x += positions[offset];
    y += positions[offset + 1];
    z += positions[offset + 2];
  }
  return [x / count, y / count, z / count];
}

function maximumCenteredDelta(before: Float32Array, after: Float32Array): number {
  const beforeCentroid = centroid(before);
  const afterCentroid = centroid(after);
  let maximum = 0;
  for (let offset = 0; offset < before.length; offset += 3) {
    maximum = Math.max(maximum, Math.hypot(
      (after[offset] - afterCentroid[0]) - (before[offset] - beforeCentroid[0]),
      (after[offset + 1] - afterCentroid[1]) - (before[offset + 1] - beforeCentroid[1]),
      (after[offset + 2] - afterCentroid[2]) - (before[offset + 2] - beforeCentroid[2]),
    ));
  }
  return maximum;
}
