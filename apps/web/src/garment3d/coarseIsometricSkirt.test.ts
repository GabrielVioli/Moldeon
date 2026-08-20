import { describe, expect, it } from "vitest";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type GarmentDraft, type PatternPiece, type Seam } from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly, type CoarseAssemblyPipelineResult } from "./CoarseAssemblyPipeline";

const PANEL_IDS = ["manual-p0", "manual-p1", "manual-p2", "manual-p3"] as const;

describe("Prompt 10.7 P0 manual skirt foundation", () => {
  it("forms a non-degenerate curved shell from a manual/unclassified four-panel skirt", () => {
    const result = solveManualSkirt(false);
    const component = result.assembly.components.find((item) => item.panelInstanceIds.some((id) => id.startsWith("manual-p0")))!;
    if (process.env.MOLDEON_10_7_REPORT === "1") {
      console.log("MOLDEON_10_7_SKIRT", JSON.stringify(report(result)));
    }
    expect(result.state.instances).toHaveLength(4);
    expect(result.coarse.coarseVertexCount).toBeLessThan(result.coarse.fineVertexCount);
    expect(result.coarse.reductionRatio).toBeLessThan(0.8);
    expect(result.coarse.hingeCount).toBeGreaterThan(0);
    expect(component.nonPlanarityRad).toBeGreaterThan(0.25);
    expect(component.metricDistortionMean).toBeLessThan(0.12);
    expect(component.metricDistortionMax).toBeLessThan(0.35);
    expect(component.overlapScore).toBeLessThan(0.25);
    expect(component.structuralSeamMaxMm).toBeLessThan(180);
    expect(result.assembly.invalid).toBe(false);
    expect([...result.state.positions].every(Number.isFinite)).toBe(true);
  });

  it("adding a waistband keeps the main skirt shell continuous instead of becoming a radial fan", () => {
    const withoutBand = solveManualSkirt(false);
    const withBand = solveManualSkirt(true);
    const beforeDistances = pairwiseMainPanelCentroidDistances(withoutBand);
    const afterDistances = pairwiseMainPanelCentroidDistances(withBand);
    const drift = normalizedDistanceMatrixDrift(beforeDistances, afterDistances);
    const mainComponent = withBand.assembly.components.find((item) => item.panelInstanceIds.some((id) => id.startsWith("manual-p0")))!;
    if (process.env.MOLDEON_10_7_REPORT === "1") {
      console.log("MOLDEON_10_7_SKIRT_BAND", JSON.stringify({ ...report(withBand), mainShellDistanceDrift: drift }));
    }
    expect(withBand.state.instances).toHaveLength(5);
    expect(mainComponent.nonPlanarityRad).toBeGreaterThan(0.25);
    expect(mainComponent.overlapScore).toBeLessThan(0.28);
    expect(mainComponent.metricDistortionMean).toBeLessThan(0.035);
    expect(drift).toBeLessThan(0.25);
    expect(mainComponent.metricDistortionMax).toBeLessThan(0.35);
    expect(withBand.assembly.invalid).toBe(false);
  }, 15_000);

  it("is invariant to manual display names and piece/seam insertion order within tolerance", () => {
    const base = manualSkirtGarment(true);
    const reversed: GarmentDraft = {
      ...base,
      pieces: [...base.pieces].reverse().map((piece, index) => ({ ...piece, name: `Nome aleatório ${index}` })),
      seams: [...(base.seams ?? [])].reverse(),
    };
    const first = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(base));
    const second = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(reversed));
    expect(normalizedDistanceMatrixDrift(
      pairwiseMainPanelCentroidDistances(first),
      pairwiseMainPanelCentroidDistances(second),
    )).toBeLessThan(0.08);
    expect(Math.abs(first.assembly.metrics.metricDistortionMean - second.assembly.metrics.metricDistortionMean)).toBeLessThan(0.02);
    expect(Math.abs(first.assembly.metrics.structuralSeamMeanMm - second.assembly.metrics.structuralSeamMeanMm)).toBeLessThan(8);
  }, 15_000);
});

function solveManualSkirt(withBand: boolean): CoarseAssemblyPipelineResult {
  return buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(manualSkirtGarment(withBand)));
}

function manualSkirtGarment(withBand: boolean): GarmentDraft {
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  const panels = PANEL_IDS.map((id, index) => rectangle(id, 102 + index * 3, 420));
  const pieces: PatternPiece[] = [...panels];
  const seams: Seam[] = [];
  for (let index = 0; index < panels.length; index += 1) {
    const current = panels[index];
    const next = panels[(index + 1) % panels.length];
    seams.push({
      id: `manual-side-${index}`,
      first: range(current, 1),
      second: range(next, 3),
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    });
  }
  if (withBand) {
    const band = rectangle("manual-band", panels.reduce((sum, panel) => sum + width(panel), 0), 42);
    pieces.push(band);
    seams.push({
      id: "manual-band-loop",
      first: range(band, 1),
      second: range(band, 3),
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    });
    seams.push({
      id: "manual-waist-join",
      first: range(panels[0], 0),
      firstRanges: panels.map((panel) => range(panel, 0)),
      second: range(band, 2),
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    });
  }
  return {
    ...blank,
    name: withBand ? "Manual skirt with band" : "Manual skirt",
    fabrics: [fabric],
    pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })),
    seams,
  };
}

function rectangle(id: string, widthMm: number, heightMm: number): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points: [
      { id: `${id}:tl`, xMm: 0, yMm: 0 },
      { id: `${id}:tr`, xMm: widthMm, yMm: 0 },
      { id: `${id}:br`, xMm: widthMm, yMm: heightMm },
      { id: `${id}:bl`, xMm: 0, yMm: heightMm },
    ],
  };
}

function range(piece: PatternPiece, edgeIndex: number) {
  return { pieceId: piece.id, edgeId: getPatternEdges(piece)[edgeIndex].id, startT: 0, endT: 1 };
}

function width(piece: PatternPiece): number {
  const xs = piece.points.map((point) => point.xMm);
  return Math.max(...xs) - Math.min(...xs);
}

function pairwiseMainPanelCentroidDistances(result: CoarseAssemblyPipelineResult): number[] {
  const centers = PANEL_IDS.map((sourceId) => {
    const instance = result.state.instances.find((item) => item.sourcePatternId === sourceId)!;
    let x = 0; let y = 0; let z = 0;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const offset = (instance.particleStart + local) * 3;
      x += result.state.positions[offset];
      y += result.state.positions[offset + 1];
      z += result.state.positions[offset + 2];
    }
    return [x / instance.vertexCount, y / instance.vertexCount, z / instance.vertexCount] as const;
  });
  const distances: number[] = [];
  for (let i = 0; i < centers.length; i += 1) {
    for (let j = i + 1; j < centers.length; j += 1) {
      distances.push(Math.hypot(
        centers[i][0] - centers[j][0],
        centers[i][1] - centers[j][1],
        centers[i][2] - centers[j][2],
      ));
    }
  }
  return distances;
}

function normalizedDistanceMatrixDrift(a: number[], b: number[]): number {
  const scale = Math.max(1e-6, a.reduce((sum, value) => sum + value, 0) / Math.max(1, a.length));
  return a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? value)), 0) / Math.max(1, a.length) / scale;
}

function report(result: CoarseAssemblyPipelineResult) {
  return {
    coarseVertexCount: result.coarse.coarseVertexCount,
    coarseTriangleCount: result.coarse.coarseTriangleCount,
    fineVertexCount: result.coarse.fineVertexCount,
    reductionRatio: result.coarse.reductionRatio,
    hingeCount: result.coarse.hingeCount,
    assemblySolveMs: result.assembly.assemblySolveMs,
    fineTransferMs: result.fineTransferMs,
    metrics: result.assembly.metrics,
    components: result.assembly.components,
  };
}
