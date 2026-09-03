import { describe, expect, it } from "vitest";
import {
  edgeRangeSequenceLength,
  getPatternEdges,
  resolveEdgeRangeSequenceProgress,
  type PatternPiece,
} from "./pattern";

function square(): PatternPiece {
  return {
    id: "piece",
    name: "Quadrado",
    seamAllowanceMm: 10,
    points: [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 100, yMm: 0 },
      { id: "c", xMm: 100, yMm: 100 },
      { id: "d", xMm: 0, yMm: 100 },
    ],
  };
}

describe("11.0.8 sewing arc-length authoring", () => {
  it("measures only the authored partial range", () => {
    const piece = square();
    const edge = getPatternEdges(piece)[0];
    expect(edgeRangeSequenceLength([piece], [{
      pieceId: piece.id,
      edgeId: edge.id,
      startT: 0.25,
      endT: 0.75,
    }])).toBeCloseTo(50, 5);
  });

  it("resolves progress over the accumulated material length of an ordered chain", () => {
    const piece = square();
    const edges = getPatternEdges(piece);
    const ranges = [
      { pieceId: piece.id, edgeId: edges[0].id, startT: 0.25, endT: 0.75 },
      { pieceId: piece.id, edgeId: edges[1].id, startT: 0, endT: 1 },
    ];
    expect(edgeRangeSequenceLength([piece], ranges)).toBeCloseTo(150, 5);
    const inFirst = resolveEdgeRangeSequenceProgress([piece], ranges, 1 / 6);
    expect(inFirst?.rangeIndex).toBe(0);
    expect(inFirst?.t).toBeCloseTo(0.5, 5);
    const inSecond = resolveEdgeRangeSequenceProgress([piece], ranges, 2 / 3);
    expect(inSecond?.rangeIndex).toBe(1);
    expect(inSecond?.t).toBeCloseTo(0.5, 5);
  });

  it("maps same and opposite correspondence from the same global progress", () => {
    const piece = square();
    const edge = getPatternEdges(piece)[0];
    const ranges = [{ pieceId: piece.id, edgeId: edge.id, startT: 0.1, endT: 0.9 }];
    const progress = 0.25;
    const same = resolveEdgeRangeSequenceProgress([piece], ranges, progress);
    const opposite = resolveEdgeRangeSequenceProgress([piece], ranges, 1 - progress);
    expect(same?.t).toBeCloseTo(0.3, 5);
    expect(opposite?.t).toBeCloseTo(0.7, 5);
  });
});
