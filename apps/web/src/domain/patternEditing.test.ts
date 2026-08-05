import { describe, expect, it } from "vitest";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type PatternPiece,
  type Seam,
} from "./pattern";
import { samplePatternSegment } from "./polygonGeometry";
import {
  findNearestPatternSegment,
  insertPatternPoint,
  remapSeamsAfterSegmentSplit,
  removePatternPoint,
} from "./patternEditing";

const square: PatternPiece = {
  id: "square",
  name: "Quadrado",
  seamAllowanceMm: 10,
  points: [
    { id: "a", xMm: 0, yMm: 0 },
    { id: "b", xMm: 100, yMm: 0 },
    { id: "c", xMm: 100, yMm: 100 },
    { id: "d", xMm: 0, yMm: 100 },
  ],
};

describe("pattern point editing", () => {
  it("finds and inserts a point into the canonical segment model", () => {
    const canonical = migrateLegacyPieceToSegments(square);
    const target = findNearestPatternSegment(canonical, {
      xMm: 52,
      yMm: 4,
    });
    expect(target?.startPointId).toBe("a");
    expect(target?.t).toBeCloseTo(0.52);

    const result = insertPatternPoint(
      canonical,
      target!.startPointId,
      target!.t,
    );
    expect(result?.piece.points).toHaveLength(5);
    expect(result?.piece.nodes).toHaveLength(5);
    expect(result?.piece.segments).toHaveLength(5);
    expect(result?.piece.contours?.[0].segmentIds).toHaveLength(5);
    expect(result?.piece.points[1]).toMatchObject({
      id: "square:insert-1",
      xMm: 52,
      yMm: 0,
    });
    expect(result?.piece.segments?.[0].role).toBe("other");
    expect(result?.piece.segments?.[1].role).toBe("other");
  });

  it("splits a cubic with De Casteljau and preserves the sampled curve", () => {
    const curved = migrateLegacyPieceToSegments({
      ...square,
      points: [
        {
          id: "a",
          xMm: 0,
          yMm: 0,
          handleOut: { xMm: 30, yMm: -40 },
        },
        {
          id: "b",
          xMm: 100,
          yMm: 0,
          handleIn: { xMm: -30, yMm: -40 },
        },
        ...square.points.slice(2),
      ],
    });
    curved.segments![0].role = "waist";
    const before = samplePatternSegment(curved.points[0], curved.points[1]);
    const result = insertPatternPoint(curved, "a", 0.5)!;

    expect(result.piece.points[0].handleOut).toEqual({
      xMm: 15,
      yMm: -20,
    });
    expect(result.piece.points[1]).toMatchObject({
      xMm: 50,
      yMm: -30,
    });
    expect(result.piece.points[2].handleIn).toEqual({
      xMm: -15,
      yMm: -20,
    });
    expect(result.piece.segments?.slice(0, 2).map((segment) => segment.role)).toEqual([
      "waist",
      "waist",
    ]);

    const firstHalf = samplePatternSegment(
      result.piece.points[0],
      result.piece.points[1],
    );
    const secondHalf = samplePatternSegment(
      result.piece.points[1],
      result.piece.points[2],
    );
    const after = [...firstHalf.slice(0, -1), ...secondHalf];
    for (const sample of before) {
      const distance = Math.min(
        ...after.map((candidate) =>
          Math.hypot(candidate.xMm - sample.xMm, candidate.yMm - sample.yMm),
        ),
      );
      expect(distance).toBeLessThan(1.1);
    }
  });

  it("remaps a partial seam crossing the inserted point without losing coverage", () => {
    const canonical = migrateLegacyPieceToSegments(square);
    const sourceEdge = getPatternEdges(canonical)[0];
    const oppositeEdge = getPatternEdges(canonical)[2];
    const seam: Seam = {
      id: "seam-1",
      name: "Teste",
      first: {
        pieceId: canonical.id,
        edgeId: sourceEdge.id,
        startT: 0.2,
        endT: 0.8,
      },
      second: {
        pieceId: canonical.id,
        edgeId: oppositeEdge.id,
        startT: 0.1,
        endT: 0.7,
      },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
    };
    const insertion = insertPatternPoint(canonical, "a", 0.5)!;
    const remapped = remapSeamsAfterSegmentSplit([seam], insertion.split);

    expect(remapped).toHaveLength(2);
    expect(remapped[0].first.edgeId).toBe(insertion.split.firstEdgeId);
    expect(remapped[1].first.edgeId).toBe(insertion.split.secondEdgeId);
    expect(remapped.every((part) => part.first.endT > part.first.startT)).toBe(true);
    expect(remapped.every((part) => part.second.endT > part.second.startT)).toBe(true);
  });

  it("removes a point and protects the three-point minimum", () => {
    const removed = removePatternPoint(square, "b");
    expect(removed?.points.map((point) => point.id)).toEqual(["a", "c", "d"]);
    expect(removePatternPoint(removed!, "c")).toBeNull();
  });
});
