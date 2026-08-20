import { describe, expect, it } from "vitest";
import { getPatternEdges, type GarmentDraft, type PatternPiece, type Seam } from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import { measureXpbdDiagnostics, resetXpbdState, stepXpbd, type XpbdState } from "./xpbd";

const FIXTURES = [
  "self-seam-tube",
  "spatial-four-panel-tube",
  "dart-piece",
  "phase-a-four-panel-waistband",
] as const;

describe("Phase A zero-energy initial dress pose", () => {
  it.each(FIXTURES)("%s is assembled before XPBD and remains a rigid free-fall shape", (fixtureId) => {
    const garment = createPhaseAFixture(fixtureId);
    const assembly = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(garment));
    const initialization = buildXpbdInitialization(assembly.state, garment, `phase-a:${fixtureId}`, {
      bodyCollisionEnabled: false,
      config: { gravity: [0, 0, 0], maximumSubsteps: 1 },
    });
    const zeroGravity = createXpbdWorkerState(initialization);
    const step0 = new Float32Array(zeroGravity.positions);
    const step0Diagnostics = measureXpbdDiagnostics(zeroGravity);

    run(zeroGravity, 500);
    const zeroGravityShapeDeltaM = maximumCenteredDelta(step0, zeroGravity.positions);

    const falling = createXpbdWorkerState(buildXpbdInitialization(
      assembly.state,
      garment,
      `phase-a-fall:${fixtureId}`,
      { bodyCollisionEnabled: false, config: { gravity: [0, -9.81, 0], maximumSubsteps: 1 } },
    ));
    const fallStep0 = new Float32Array(falling.positions);
    const initialCentroid = centroid(fallStep0);
    run(falling, 500);
    const finalCentroid = centroid(falling.positions);
    const freeFallShapeDeltaM = maximumCenteredDelta(fallStep0, falling.positions);

    let deterministicTrajectory: Float32Array | null = null;
    for (let reset = 0; reset < 10; reset += 1) {
      resetXpbdState(zeroGravity);
      expect(zeroGravity.positions).toEqual(step0);
      stepXpbd(zeroGravity);
      resetXpbdState(zeroGravity);
      expect(zeroGravity.positions).toEqual(step0);

      resetXpbdState(falling);
      run(falling, 32);
      if (deterministicTrajectory === null) {
        deterministicTrajectory = new Float32Array(falling.positions);
      } else {
        expect(falling.positions).toEqual(deterministicTrajectory);
      }
    }

    if (process.env.MOLDEON_PHASE_A_REPORT === "1") {
      console.log("MOLDEON_PHASE_A_ZERO_ENERGY", JSON.stringify({
        fixtureId,
        assembly: assembly.assembly.metrics,
        selectedSeeds: assembly.assembly.components.map((component) => component.selectedSeed),
        step0SeamMeanMm: step0Diagnostics.seamErrorAverage * 1_000,
        step0SeamMaxMm: step0Diagnostics.seamErrorMaximum * 1_000,
        step0StretchMean: step0Diagnostics.structuralStretchMeanRatio,
        step0StretchMax: step0Diagnostics.structuralStretchMaxRatio,
        step0CompressionMin: step0Diagnostics.structuralCompressionMinRatio,
        step0ShearMax: step0Diagnostics.shearStrainMax,
        step0AreaMin: step0Diagnostics.triangleAreaMinRatio,
        step0AreaMax: step0Diagnostics.triangleAreaMaxRatio,
        seamGroups: initialization.seamResidualAudit.groups.map((group) => ({
          id: group.seamGroupId,
          meanMm: group.meanResidualMm,
          maxMm: group.maxResidualMm,
        })),
        zeroGravityShapeDeltaMm: zeroGravityShapeDeltaM * 1_000,
        freeFallShapeDeltaMm: freeFallShapeDeltaM * 1_000,
        fallTranslationMm: {
          x: (finalCentroid[0] - initialCentroid[0]) * 1_000,
          y: (finalCentroid[1] - initialCentroid[1]) * 1_000,
          z: (finalCentroid[2] - initialCentroid[2]) * 1_000,
        },
        invalid: zeroGravity.invalid || falling.invalid,
      }));
    }

    expect(step0Diagnostics.seamErrorMaximum).toBeLessThan(0.0005);
    expect(step0Diagnostics.structuralStretchMaxRatio).toBeLessThan(1.001);
    expect(step0Diagnostics.structuralCompressionMinRatio).toBeGreaterThan(0.999);
    expect(step0Diagnostics.shearStrainMax).toBeLessThan(0.001);
    expect(step0Diagnostics.triangleAreaMinRatio).toBeGreaterThan(0.998);
    expect(step0Diagnostics.triangleAreaMaxRatio).toBeLessThan(1.002);
    expect(zeroGravity.invalid).toBe(false);
    expect(falling.invalid).toBe(false);
    expect(zeroGravityShapeDeltaM).toBeLessThan(0.0005);
    expect(freeFallShapeDeltaM).toBeLessThan(0.0005);
    expect(finalCentroid[1]).toBeLessThan(initialCentroid[1] - 1);
  }, 45_000);
});

function run(state: XpbdState, steps: number): void {
  for (let step = 0; step < steps && !state.invalid; step += 1) stepXpbd(state);
}

function createPhaseAFixture(fixtureId: (typeof FIXTURES)[number]): GarmentDraft {
  if (fixtureId === "dart-piece") {
    const garment = createBaselineFixture(fixtureId);
    return {
      ...garment,
      pieces: garment.pieces.map((piece) => ({
        ...piece,
        cutOnFold: false,
        cutQuantity: 1,
      })),
    };
  }
  if (fixtureId !== "phase-a-four-panel-waistband") {
    return createBaselineFixture(fixtureId);
  }
  const body = createBaselineFixture("spatial-four-panel-tube");
  const topRanges = body.pieces.map((piece) => ({
    pieceId: piece.id,
    edgeId: getPatternEdges(piece)[0].id,
    startT: 0,
    endT: 1,
  }));
  const circumferenceMm = body.pieces.reduce((total, piece) => {
    const edge = getPatternEdges(piece)[0];
    const start = piece.points.find((point) => point.id === edge.startPointId)!;
    const end = piece.points.find((point) => point.id === edge.endPointId)!;
    return total + Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
  }, 0);
  const band: PatternPiece = {
    id: "phase-a-waistband",
    name: "Cós estrutural",
    seamAllowanceMm: 0,
    cutQuantity: 1,
    fabricId: body.pieces[0].fabricId,
    points: [
      { id: "phase-a-waistband:tl", xMm: 0, yMm: 0 },
      { id: "phase-a-waistband:tr", xMm: circumferenceMm, yMm: 0 },
      { id: "phase-a-waistband:br", xMm: circumferenceMm, yMm: 35 },
      { id: "phase-a-waistband:bl", xMm: 0, yMm: 35 },
    ],
  };
  const bandEdges = getPatternEdges(band);
  const seams: Seam[] = [
    ...(body.seams ?? []),
    {
      id: "phase-a-waistband:loop",
      groupId: "phase-a-waistband:loop",
      name: "Fechamento do cós",
      first: { pieceId: band.id, edgeId: bandEdges[1].id, startT: 0, endT: 1 },
      second: { pieceId: band.id, edgeId: bandEdges[3].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    },
    {
      id: "phase-a-waistband:join",
      groupId: "phase-a-waistband:join",
      name: "União acumulada do cós",
      first: { pieceId: band.id, edgeId: bandEdges[2].id, startT: 0, endT: 1 },
      second: topRanges[0],
      secondRanges: topRanges,
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    },
  ];
  return {
    ...body,
    id: "phase-a-four-panel-waistband",
    name: "Phase A four-panel tube with waistband",
    pieces: [...body.pieces, band],
    seams,
  };
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
