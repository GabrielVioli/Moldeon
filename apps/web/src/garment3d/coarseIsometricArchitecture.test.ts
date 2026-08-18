import { describe, expect, it } from "vitest";
import type { GarmentDraft, PatternPoint } from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { createBaselineFixture, type BaselineFixtureId } from "../testFixtures/baselineGarments";
import { buildCoarseIsometricAssembly, type CoarseAssemblyPipelineResult } from "./CoarseAssemblyPipeline";

function solve(id: BaselineFixtureId): CoarseAssemblyPipelineResult {
  return buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(createBaselineFixture(id)));
}

function expectHealthy(result: CoarseAssemblyPipelineResult, options: {
  require3D?: boolean;
  maxMetricMean?: number;
  maxStructuralMm?: number;
  maxOverlap?: number;
} = {}): void {
  expect(result.assembly.invalid).toBe(false);
  expect([...result.state.positions].every(Number.isFinite)).toBe(true);
  expect(result.coarse.coarseVertexCount).toBeGreaterThan(0);
  expect(result.coarse.coarseVertexCount).toBeLessThanOrEqual(result.coarse.fineVertexCount);
  expect(result.coarse.hingeCount).toBeGreaterThan(0);
  expect(result.assembly.metrics.metricDistortionMean).toBeLessThan(options.maxMetricMean ?? 0.08);
  expect(result.assembly.metrics.overlapScore).toBeLessThan(options.maxOverlap ?? 0.35);
  if (options.maxStructuralMm !== undefined) {
    expect(result.assembly.metrics.structuralSeamMaxMm).toBeLessThan(options.maxStructuralMm);
  }
  if (options.require3D) {
    expect(result.assembly.metrics.nonPlanarityRad).toBeGreaterThan(0.12);
  }
}

function report(label: string, result: CoarseAssemblyPipelineResult): void {
  if (process.env.MOLDEON_10_7_REPORT !== "1") return;
  console.log(`MOLDEON_10_7_${label}`, JSON.stringify({
    coarseVertexCount: result.coarse.coarseVertexCount,
    coarseTriangleCount: result.coarse.coarseTriangleCount,
    fineVertexCount: result.coarse.fineVertexCount,
    hingeCount: result.coarse.hingeCount,
    reductionRatio: result.coarse.reductionRatio,
    assemblySolveMs: result.assembly.assemblySolveMs,
    fineTransferMs: result.fineTransferMs,
    metrics: result.assembly.metrics,
    components: result.assembly.components.map((component) => ({
      ids: component.panelInstanceIds,
      constraintState: component.constraintState,
      confidence: component.assemblyConfidence,
      cycleRank: component.cycleRank,
      parallelRelationCount: component.parallelRelationCount,
      selectedSeed: component.selectedSeed,
      candidateDiagnostics: component.candidateDiagnostics,
    })),
  }));
}

describe("Prompt 10.7 G1-G24 coarse isometric architecture", () => {
  it("G1 self-seam tube bends one physical panel without metric stretch", () => {
    const result = solve("self-seam-tube");
    report("G1_SELF_TUBE", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.035, maxStructuralMm: 90 });
    expect(result.coarse.meshes).toHaveLength(1);
  });

  it("G2/G14 two panels preserve parallel material relations instead of collapsing by pair", () => {
    const result = solve("spatial-two-panel-tube");
    report("G2_TWO_PANEL", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.06, maxStructuralMm: 180 });
    const component = result.assembly.components[0];
    expect(component.parallelRelationCount + component.cycleRank).toBeGreaterThan(0);
    expect(new Set(result.seamResolution.structural.map((seam) => seam.seamGroupId)).size).toBeGreaterThanOrEqual(2);
  });

  it("G3/G15 four-panel shell is 3D while authored free boundaries remain unconstrained", () => {
    const result = solve("spatial-four-panel-tube");
    report("G3_FOUR_PANEL", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.06, maxStructuralMm: 200 });
    expect(result.assembly.components[0].freeBoundaryEstimate).toBeGreaterThan(0);
  });

  it("G5/G6 torso shell keeps neckline/armholes free while structural seams build a shell", () => {
    const result = solve("tshirt-standard");
    report("G5_TORSO", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.1, maxStructuralMm: 260, maxOverlap: 0.5 });
    expect(result.state.instances.length).toBeGreaterThanOrEqual(4);
  }, 20_000);

  it("G7 torso+sleeve uses the same graph/surface engine and keeps a 3D branch", () => {
    const result = solve("tshirt-standard");
    report("G7_SLEEVE", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.1, maxStructuralMm: 280, maxOverlap: 0.5 });
    expect(result.assembly.strategy).toBe("coarse-isometric-surface");
    const sleeveGroups = new Set(result.seamResolution.constraints.map((seam) => seam.seamGroupId));
    expect([...sleeveGroups].some((group) => group.includes("armhole"))).toBe(true);
  }, 20_000);

  it("G8/G22 trousers resolve paired physical crotch copies on the generic surface solver", () => {
    const result = solve("straight-pants-standard");
    report("G8_PANTS", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.12, maxStructuralMm: 320, maxOverlap: 0.55 });
    expect(result.state.instances).toHaveLength(4);
    const groups = new Set(result.seamResolution.constraints.map((seam) => seam.seamGroupId));
    expect(groups.has("template-seam:trouser-front-rise")).toBe(true);
    expect(groups.has("template-seam:trouser-back-rise")).toBe(true);
  }, 20_000);

  it("G9 shorts preserve the trouser material graph without a shorts solver branch", () => {
    const source = createBaselineFixture("straight-pants-standard");
    const result = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(shortenTrouser(source)));
    report("G9_SHORTS", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.12, maxStructuralMm: 320, maxOverlap: 0.55 });
    expect(result.assembly.strategy).toBe("coarse-isometric-surface");
  }, 20_000);

  it("G10 dart remains shaping and does not become a global structural closure", () => {
    const result = solve("dart-piece");
    report("G10_DART", result);
    expectHealthy(result, { maxMetricMean: 0.06 });
    expect(result.seamResolution.shaping.length).toBeGreaterThan(0);
  });

  it("G11 N↔M composite sampling remains material-space and finite", () => {
    const result = solve("xpbd-four-panel-composite");
    report("G11_NM", result);
    expectHealthy(result, { maxMetricMean: 0.1, maxStructuralMm: 300 });
    expect(result.seamResolution.constraints.length).toBeGreaterThan(4);
    expect(result.seamResolution.constraints.every((seam) =>
      Number.isFinite(seam.a.materialXMm)
      && Number.isFinite(seam.a.materialYMm)
      && Number.isFinite(seam.b.materialXMm)
      && Number.isFinite(seam.b.materialYMm),
    )).toBe(true);
  });

  it("G12 open chain reports ambiguity instead of manufacturing a fake unique garment", () => {
    const result = solve("spatial-open-chain");
    report("G12_OPEN", result);
    expectHealthy(result, { maxMetricMean: 0.08, maxStructuralMm: 260 });
    expect(result.assembly.components.some((component) => component.constraintState === "ambiguous")).toBe(true);
    expect(result.assembly.components.every((component) => component.assemblyConfidence >= 0 && component.assemblyConfidence <= 1)).toBe(true);
  });

  it("G13 asymmetric notched shell does not require symmetry", () => {
    const result = solve("spatial-notched-tube");
    report("G13_ASYMMETRIC", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.09, maxStructuralMm: 260 });
  });

  it("G16 intentional mismatch remains residual for XPBD rather than geometric stretching", () => {
    const result = solve("length-mismatch-seam");
    report("G16_MISMATCH", result);
    expectHealthy(result, { maxMetricMean: 0.05 });
    expect(result.seamResolution.intentional.length).toBeGreaterThan(0);
  });

  it("G17 body+band cannot let a small closed loop replace the global shell", () => {
    const result = solve("spatial-notched-tube-waistband");
    report("G17_BODY_BAND", result);
    expectHealthy(result, { require3D: true, maxMetricMean: 0.08, maxStructuralMm: 320, maxOverlap: 0.45 });
    expect(result.assembly.components[0].panelInstanceIds.length).toBeGreaterThanOrEqual(3);
  });

  it("G19 distant incompatible relation stays a best-fit geometric problem", () => {
    const result = solve("length-mismatch-seam");
    expect(result.assembly.metrics.metricDistortionMean).toBeLessThan(0.05);
    expect(result.seamResolution.intentional.length).toBeGreaterThan(0);
  });

  it("G20/G21 is invariant to PanelDefinition and Seam insertion order within metric tolerance", () => {
    const source = createBaselineFixture("spatial-four-panel-tube");
    const shuffled: GarmentDraft = {
      ...source,
      pieces: [...source.pieces].reverse(),
      seams: [...(source.seams ?? [])].reverse(),
    };
    const first = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(source));
    const second = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(shuffled));
    expect(Math.abs(first.assembly.metrics.metricDistortionMean - second.assembly.metrics.metricDistortionMean)).toBeLessThan(0.01);
    expect(Math.abs(first.assembly.metrics.structuralSeamMeanMm - second.assembly.metrics.structuralSeamMeanMm)).toBeLessThan(10);
    expect(Math.abs(first.assembly.metrics.overlapScore - second.assembly.metrics.overlapScore)).toBeLessThan(0.04);
  });

  it("G23 unclassified/manual path is a structural citizen, not a semantic fallback", () => {
    const result = solve("free-simple-piece");
    expect(result.state.instances).toHaveLength(1);
    expect(result.assembly.strategy).toBe("coarse-isometric-surface");
    expect(result.assembly.components[0].constraintState).toBe("ambiguous");
  });

  it("G24 template/manual documents use the same coarse engine even when semantic hints differ", () => {
    const template = solve("straight-skirt-standard");
    const manual = solve("spatial-four-panel-tube");
    expect(template.assembly.strategy).toBe("coarse-isometric-surface");
    expect(manual.assembly.strategy).toBe("coarse-isometric-surface");
    expect(template.coarse.meshes.every((mesh) => mesh.panelInstanceId.length > 0 && mesh.sourcePatternId.length > 0)).toBe(true);
    expect(manual.coarse.meshes.every((mesh) => mesh.panelInstanceId.length > 0 && mesh.sourcePatternId.length > 0)).toBe(true);
  });
});

function shortenTrouser(garment: GarmentDraft): GarmentDraft {
  return {
    ...garment,
    id: `${garment.id}:10.7-shorts`,
    name: "generic shortened lower-body topology",
    pieces: garment.pieces.map((piece) => {
      const top = Math.min(...piece.points.map((point) => point.yMm));
      return {
        ...piece,
        points: piece.points.map((point) => scalePointY(point, top, 0.58)),
      };
    }),
  };
}

function scalePointY(point: PatternPoint, originY: number, factor: number): PatternPoint {
  const scaleY = (value: number) => originY + (value - originY) * factor;
  return {
    ...point,
    yMm: scaleY(point.yMm),
    ...(point.handleIn ? { handleIn: { ...point.handleIn, yMm: scaleY(point.handleIn.yMm) } } : {}),
    ...(point.handleOut ? { handleOut: { ...point.handleOut, yMm: scaleY(point.handleOut.yMm) } } : {}),
  };
}
