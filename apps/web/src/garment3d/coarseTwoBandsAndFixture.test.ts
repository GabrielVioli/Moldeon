import { describe, expect, it } from "vitest";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type GarmentDraft, type PatternPiece, type Seam } from "../domain/pattern";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  serializePatternDocumentV3,
} from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "./CoarseAssemblyPipeline";

const BODY_IDS = ["g18-body-a", "g18-body-b", "g18-body-c", "g18-body-d"];

describe("Prompt 10.7 remaining architecture gates", () => {
  it("G18 body + band + second band keeps the main shell dominant", () => {
    const oneBand = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(buildGarment(1)));
    const twoBands = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(buildGarment(2)));
    const before = bodyDistances(oneBand.state.positions, oneBand.state.instances);
    const after = bodyDistances(twoBands.state.positions, twoBands.state.instances);
    const scale = Math.max(1e-6, before.reduce((sum, value) => sum + value, 0) / before.length);
    const drift = before.reduce((sum, value, index) => sum + Math.abs(value - after[index]), 0) / before.length / scale;
    expect(twoBands.assembly.invalid).toBe(false);
    expect(twoBands.state.instances).toHaveLength(6);
    expect(twoBands.assembly.metrics.nonPlanarityRad).toBeGreaterThan(0.25);
    expect(twoBands.assembly.metrics.metricDistortionMean).toBeLessThan(0.06);
    expect(twoBands.assembly.metrics.overlapScore).toBeLessThan(0.35);
    expect(drift).toBeLessThan(0.28);
  });

  it("D1/D4 exported V3 JSON re-enters exactly the canonical assembly path", () => {
    const original = garmentDraftToPatternDocumentV3(buildGarment(1));
    const serialized = serializePatternDocumentV3(original);
    const reparsed = parsePatternDocumentV3(JSON.parse(serialized));
    expect(serializePatternDocumentV3(reparsed)).toBe(serialized);
    const first = buildCoarseIsometricAssembly(original);
    const second = buildCoarseIsometricAssembly(reparsed);
    expect(second.revision).toBe(first.revision);
    expect(second.coarse.coarseVertexCount).toBe(first.coarse.coarseVertexCount);
    expect(second.coarse.coarseTriangleCount).toBe(first.coarse.coarseTriangleCount);
    expect(second.assembly.strategy).toBe("coarse-isometric-surface");
    expect(Math.abs(second.assembly.metrics.metricDistortionMean - first.assembly.metrics.metricDistortionMean)).toBeLessThan(1e-7);
    expect(Math.abs(second.assembly.metrics.structuralSeamMeanMm - first.assembly.metrics.structuralSeamMeanMm)).toBeLessThan(1e-4);
  });
});

function buildGarment(bandCount: 1 | 2): GarmentDraft {
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  const body = BODY_IDS.map((id, index) => rectangle(id, 102 + index * 2, 390));
  const pieces: PatternPiece[] = [...body];
  const seams: Seam[] = [];
  for (let index = 0; index < body.length; index += 1) {
    seams.push(standard(`g18-side-${index}`, range(body[index], 1), range(body[(index + 1) % body.length], 3)));
  }
  let previousTopRanges = body.map((piece) => range(piece, 0));
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const band = rectangle(`g18-band-${bandIndex + 1}`, body.reduce((sum, piece) => sum + width(piece), 0), 38);
    pieces.push(band);
    seams.push(standard(`g18-band-loop-${bandIndex + 1}`, range(band, 1), range(band, 3)));
    seams.push({
      ...standard(`g18-band-join-${bandIndex + 1}`, previousTopRanges[0], range(band, 2)),
      firstRanges: previousTopRanges,
    });
    previousTopRanges = [range(band, 0)];
  }
  return {
    ...blank,
    id: `g18-${bandCount}`,
    name: `generic shell with ${bandCount} closed branches`,
    fabrics: [fabric],
    pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })),
    seams,
  };
}

function standard(id: string, first: ReturnType<typeof range>, second: ReturnType<typeof range>): Seam {
  return { id, first, second, direction: "opposite", easeRatio: 0, type: "standard", treatment: "standard", active: true };
}

function rectangle(id: string, widthMm: number, heightMm: number): PatternPiece {
  return {
    id, name: id, seamAllowanceMm: 0, cutQuantity: 1,
    points: [
      { id: `${id}:tl`, xMm: 0, yMm: 0 },
      { id: `${id}:tr`, xMm: widthMm, yMm: 0 },
      { id: `${id}:br`, xMm: widthMm, yMm: heightMm },
      { id: `${id}:bl`, xMm: 0, yMm: heightMm },
    ],
  };
}

function range(piece: PatternPiece, edge: number) {
  return { pieceId: piece.id, edgeId: getPatternEdges(piece)[edge].id, startT: 0, endT: 1 };
}

function width(piece: PatternPiece): number {
  const xs = piece.points.map((point) => point.xMm);
  return Math.max(...xs) - Math.min(...xs);
}

function bodyDistances(positions: Float32Array, instances: Array<{ sourcePatternId: string; particleStart: number; vertexCount: number }>): number[] {
  const centers = BODY_IDS.map((id) => {
    const instance = instances.find((item) => item.sourcePatternId === id)!;
    let x = 0; let y = 0; let z = 0;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const offset = (instance.particleStart + local) * 3;
      x += positions[offset]; y += positions[offset + 1]; z += positions[offset + 2];
    }
    return [x / instance.vertexCount, y / instance.vertexCount, z / instance.vertexCount] as const;
  });
  const result: number[] = [];
  for (let a = 0; a < centers.length; a += 1) {
    for (let b = a + 1; b < centers.length; b += 1) result.push(Math.hypot(centers[a][0] - centers[b][0], centers[a][1] - centers[b][1], centers[a][2] - centers[b][2]));
  }
  return result;
}
