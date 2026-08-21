import { describe, expect, it } from "vitest";
import {
  edgeRangeSequenceLength,
  seamSideRanges,
} from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { buildResolvedAssemblyInputFromDocument } from "../garment3d/ResolvedAssemblyInput";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import {
  measureXpbdDiagnostics,
  stepXpbd,
  type XpbdStepDiagnostics,
} from "./xpbd";

const SIDE_SEAM_ID = "template-seam:skirt-side";
const QUICK_STEPS = 8;

describe("canonical straight-skirt integrity gate", () => {
  it("keeps the complete composed side seam and rejects severe early collapse", () => {
    const garment = createBaselineFixture("straight-skirt-standard");
    const document = garmentDraftToPatternDocumentV3(garment);
    const input = buildResolvedAssemblyInputFromDocument(document);
    const canonicalSide = input.seamGroups.find((group) => group.id === SIDE_SEAM_ID);
    const projectedSide = input.garmentProjection.seams?.find(
      (seam) => (seam.groupId ?? seam.id) === SIDE_SEAM_ID,
    );

    expect(canonicalSide).toBeDefined();
    expect(canonicalSide!.first).toHaveLength(2);
    expect(canonicalSide!.second).toHaveLength(2);
    expect(projectedSide).toBeDefined();

    const firstRanges = seamSideRanges(projectedSide!, "first");
    const secondRanges = seamSideRanges(projectedSide!, "second");
    const firstLengthMm = edgeRangeSequenceLength(input.garmentProjection.pieces, firstRanges);
    const secondLengthMm = edgeRangeSequenceLength(input.garmentProjection.pieces, secondRanges);

    expect(firstRanges).toHaveLength(2);
    expect(secondRanges).toHaveLength(2);
    expect(firstLengthMm).toBeGreaterThan(400);
    expect(secondLengthMm).toBeGreaterThan(400);
    expect(projectedSide!.targetRatio).toBeCloseTo(firstLengthMm / secondLengthMm, 9);

    // Exercise the same public V3 -> resolved input -> coarse assembly boundary
    // used by the viewport. A cut-on-fold front and back must materialize both
    // physical side joins, while every authored range remains represented.
    const assembly = buildCoarseIsometricAssembly(input.assemblyDocument);
    const sideStitches = assembly.state.stitchConstraints.filter(
      (stitch) => stitch.seamGroupId === SIDE_SEAM_ID,
    );
    const sidePatternIds = new Set(
      [...canonicalSide!.first, ...canonicalSide!.second].map((range) => range.pieceId),
    );
    const physicalPanels = assembly.state.instances.filter(
      (instance) => sidePatternIds.has(instance.sourcePatternId),
    );
    const physicalParticipants = new Set(
      sideStitches.flatMap((stitch) => [stitch.instanceA, stitch.instanceB])
        .filter((id): id is string => id !== undefined),
    );
    const physicalPairs = new Set(
      sideStitches.map((stitch) => [stitch.instanceA, stitch.instanceB].sort().join("|")),
    );
    const expectedMaterialRanges = new Set(
      [...canonicalSide!.first, ...canonicalSide!.second]
        .map((range) => `${range.pieceId}:${range.edgeId}`),
    );
    const sampledMaterialRanges = new Set(
      sideStitches.flatMap((stitch) => [stitch.rangeA, stitch.rangeB])
        .filter((range) => range !== undefined)
        .map((range) => `${range.pieceId}:${range.edgeId}`),
    );

    expect(physicalPanels).toHaveLength(4);
    expect(sideStitches.length).toBeGreaterThan(4);
    expect(physicalPairs.size).toBe(2);
    expect(physicalParticipants).toEqual(new Set(physicalPanels.map((instance) => instance.id)));
    expect(sampledMaterialRanges).toEqual(expectedMaterialRanges);

    const initialization = buildXpbdInitialization(
      assembly.state,
      input.garmentProjection,
      assembly.revision,
      {
        bodyCollisionEnabled: false,
        config: { gravity: [0, 0, 0], maximumSubsteps: 1 },
      },
    );
    const state = createXpbdWorkerState(initialization);
    const step0 = new Float32Array(state.positions);
    const step0Diagnostics = measureXpbdDiagnostics(state);
    const step0Volumetricity = normalizedCovarianceDeterminant(step0);
    const step0PanelSeparation = minimumPanelCentroidSeparation(assembly.state, step0);

    expect(state.invalid).toBe(false);
    expect(step0Diagnostics.seamErrorMaximum).toBeLessThan(0.005);
    expectMaterialEnvelope(step0Diagnostics, {
      stretchMax: 1.08,
      compressionMin: 0.92,
      shearMax: 0.35,
      areaMin: 0.8,
      areaMax: 1.35,
    });
    expect(step0Volumetricity).toBeGreaterThan(0.00005);
    expect(step0PanelSeparation).toBeGreaterThan(0.005);

    for (let step = 0; step < QUICK_STEPS && !state.invalid; step += 1) stepXpbd(state);

    const settledDiagnostics = measureXpbdDiagnostics(state);
    const settledVolumetricity = normalizedCovarianceDeterminant(state.positions);
    const settledPanelSeparation = minimumPanelCentroidSeparation(assembly.state, state.positions);

    expect(state.invalid).toBe(false);
    expect(settledDiagnostics.flippedTriangleCount).toBe(0);
    expect(settledDiagnostics.seamErrorMaximum).toBeLessThan(0.01);
    expectMaterialEnvelope(settledDiagnostics, {
      stretchMax: 1.15,
      compressionMin: 0.85,
      shearMax: 0.5,
      areaMin: 0.65,
      areaMax: 1.5,
    });
    expect(settledDiagnostics.garmentAabbGrowthRatio).toBeLessThan(1.35);
    expect(settledVolumetricity).toBeGreaterThan(0.00005);
    expect(settledVolumetricity).toBeGreaterThan(step0Volumetricity * 0.35);
    expect(settledPanelSeparation).toBeGreaterThan(step0PanelSeparation * 0.35);
    expect(maximumCenteredDelta(step0, state.positions)).toBeLessThan(0.05);
  }, 30_000);
});

interface MaterialEnvelope {
  stretchMax: number;
  compressionMin: number;
  shearMax: number;
  areaMin: number;
  areaMax: number;
}

function expectMaterialEnvelope(
  diagnostics: XpbdStepDiagnostics,
  envelope: MaterialEnvelope,
): void {
  expect(diagnostics.flippedTriangleCount).toBe(0);
  expect(diagnostics.structuralStretchMaxRatio).toBeLessThan(envelope.stretchMax);
  expect(diagnostics.structuralCompressionMinRatio).toBeGreaterThan(envelope.compressionMin);
  expect(diagnostics.shearStrainMax).toBeLessThan(envelope.shearMax);
  expect(diagnostics.triangleAreaMinRatio).toBeGreaterThan(envelope.areaMin);
  expect(diagnostics.triangleAreaMaxRatio).toBeLessThan(envelope.areaMax);
}

/** Rotation/translation-invariant proxy: zero means the cloud is planar. */
function normalizedCovarianceDeterminant(positions: Float32Array): number {
  const center = centroid(positions);
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  const count = positions.length / 3;
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset] - center[0];
    const y = positions[offset + 1] - center[1];
    const z = positions[offset + 2] - center[2];
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  xx /= count;
  xy /= count;
  xz /= count;
  yy /= count;
  yz /= count;
  zz /= count;
  const trace = xx + yy + zz;
  if (trace <= 1e-12) return 0;
  const determinant = xx * (yy * zz - yz * yz)
    - xy * (xy * zz - yz * xz)
    + xz * (xy * yz - yy * xz);
  return Math.max(0, determinant) / (trace * trace * trace);
}

function minimumPanelCentroidSeparation(
  assembly: Pick<GarmentAssemblyState, "instances">,
  positions: Float32Array,
): number {
  const centers = assembly.instances.map((instance) => {
    const values = positions.subarray(
      instance.particleStart * 3,
      (instance.particleStart + instance.vertexCount) * 3,
    );
    return centroid(values);
  });
  let minimum = Number.POSITIVE_INFINITY;
  for (let first = 0; first < centers.length; first += 1) {
    for (let second = first + 1; second < centers.length; second += 1) {
      minimum = Math.min(minimum, Math.hypot(
        centers[first][0] - centers[second][0],
        centers[first][1] - centers[second][1],
        centers[first][2] - centers[second][2],
      ));
    }
  }
  return minimum;
}

function maximumCenteredDelta(initial: Float32Array, current: Float32Array): number {
  const initialCenter = centroid(initial);
  const currentCenter = centroid(current);
  let maximum = 0;
  for (let offset = 0; offset < initial.length; offset += 3) {
    maximum = Math.max(maximum, Math.hypot(
      initial[offset] - initialCenter[0] - (current[offset] - currentCenter[0]),
      initial[offset + 1] - initialCenter[1] - (current[offset + 1] - currentCenter[1]),
      initial[offset + 2] - initialCenter[2] - (current[offset + 2] - currentCenter[2]),
    ));
  }
  return maximum;
}

function centroid(positions: Float32Array): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  const count = positions.length / 3;
  for (let offset = 0; offset < positions.length; offset += 3) {
    result[0] += positions[offset];
    result[1] += positions[offset + 1];
    result[2] += positions[offset + 2];
  }
  result[0] /= count;
  result[1] /= count;
  result[2] /= count;
  return result;
}
