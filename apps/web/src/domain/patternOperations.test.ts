import { describe, expect, it } from "vitest";
import { makeEdgeId, parsePatternPiece, type GarmentDraft, type PatternPiece } from "./pattern";
import { calculateCurvedSeamLength, classifyCutIntersections, closeDart, createDart, createPatternPiecesFromSplit, findNearbySeamCandidates, shapeDartCap, splitBezierAtT, splitPatternByLine, updateDart } from "./patternOperations";

const square: PatternPiece = { id: "square", name: "Quadrado", seamAllowanceMm: 10, points: [
  { id: "a", xMm: 0, yMm: 0 }, { id: "b", xMm: 100, yMm: 0 },
  { id: "c", xMm: 100, yMm: 100 }, { id: "d", xMm: 0, yMm: 100 },
] };

describe("operações puras do molde", () => {
  it("classifica cortes válidos, tangentes, externos e múltiplos", () => {
    expect(classifyCutIntersections(square, [{ xMm: -10, yMm: 50 }, { xMm: 110, yMm: 50 }]).kind).toBe("valid");
    expect(classifyCutIntersections(square, [{ xMm: -10, yMm: -10 }, { xMm: 0, yMm: 0 }]).kind).toBe("touching");
    expect(classifyCutIntersections(square, [{ xMm: -10, yMm: -10 }, { xMm: -5, yMm: -5 }]).kind).toBe("outside");
    const concave = { ...square, points: [{ id: "a", xMm: 0, yMm: 0 }, { id: "b", xMm: 100, yMm: 0 }, { id: "c", xMm: 100, yMm: 100 }, { id: "d", xMm: 80, yMm: 100 }, { id: "e", xMm: 80, yMm: 30 }, { id: "f", xMm: 60, yMm: 30 }, { id: "g", xMm: 60, yMm: 100 }, { id: "h", xMm: 40, yMm: 100 }, { id: "i", xMm: 40, yMm: 30 }, { id: "j", xMm: 20, yMm: 30 }, { id: "k", xMm: 20, yMm: 100 }, { id: "l", xMm: 0, yMm: 100 }] };
    expect(classifyCutIntersections(concave, [{ xMm: -10, yMm: 50 }, { xMm: 110, yMm: 50 }]).kind).toBe("multiple");
  });

  it("divide o contorno e conserva a área total", () => {
    const paths = splitPatternByLine(square, [{ xMm: -10, yMm: 50 }, { xMm: 110, yMm: 50 }]);
    expect(paths).not.toBeNull();
    expect(area(paths![0]) + area(paths![1])).toBeCloseTo(area(square.points), 5);
    const pieces = createPatternPiecesFromSplit(square, [{ xMm: -10, yMm: 50 }, { xMm: 110, yMm: 50 }]);
    expect(pieces?.map((piece) => piece.points.length)).toEqual([4, 4]);
    const curvedTop = { ...square, points: [{ ...square.points[0], handleOut: { xMm: 30, yMm: -20 } }, { ...square.points[1], handleIn: { xMm: -30, yMm: -20 } }, ...square.points.slice(2)] };
    const curvedPieces = createPatternPiecesFromSplit(curvedTop, [{ xMm: -10, yMm: 50 }, { xMm: 110, yMm: 50 }]);
    expect(curvedPieces?.flatMap((piece) => piece.points).some((point) => point.handleOut || point.handleIn)).toBe(true);
  });

  it("mede a curva pelo arco e divide Bézier sem perder extremos", () => {
    const curved = { ...square, points: [{ ...square.points[0], handleOut: { xMm: 40, yMm: -50 } }, { ...square.points[1], handleIn: { xMm: -40, yMm: -50 } }, ...square.points.slice(2)] };
    const length = calculateCurvedSeamLength(curved, { pieceId: "square", edgeId: makeEdgeId("square", "a", "b"), startT: 0, endT: 1 });
    expect(length).toBeGreaterThan(100);
    const split = splitBezierAtT(curved.points[0], curved.points[1], 0.5);
    expect(split[0]).toMatchObject({ xMm: 0, yMm: 0 }); expect(split[2]).toMatchObject({ xMm: 100, yMm: 0 });
  });

  it("aproxima costuras curvas pelo meio do arco, não pela corda reta", () => {
    const curved = { ...square, id: "curved", points: [{ ...square.points[0], id: "ca", handleOut: { xMm: 40, yMm: -50 } }, { ...square.points[1], id: "cb", handleIn: { xMm: -40, yMm: -50 } }, ...square.points.slice(2).map((point) => ({ ...point, id: `c${point.id}` }))] };
    const straight = { ...square, id: "straight", points: square.points.map((point) => ({ ...point, id: `s${point.id}` })) };
    const partner = { ...curved, id: "partner", points: curved.points.map((point) => ({ ...point, id: `p${point.id}` })) };
    const first = { pieceId: curved.id, edgeId: makeEdgeId(curved.id, "ca", "cb"), startT: 0, endT: 1 };
    const transforms = [curved, straight, partner].map((piece) => ({ pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 }));
    const candidates = findNearbySeamCandidates({ pieces: [curved, straight, partner], seams: [] } as unknown as GarmentDraft, first, transforms, 50);
    expect(candidates[0].pieceId).toBe("partner");
  });

  it("cria, edita e fecha uma pence persistente", () => {
    const dart = createDart("square", { xMm: 50, yMm: 0 }, { xMm: 50, yMm: 60 }, 20);
    expect(dart.widthMm).toBe(20); expect(dart.lengthMm).toBe(60);
    const edited = updateDart(dart, { widthMm: 30, lengthMm: 70 });
    expect(edited.widthMm).toBe(30); expect(closeDart(edited).closed).toBe(true);
    expect(shapeDartCap(edited)).toMatchObject({ xMm: 50, yMm: 0 });
  });

  it("carrega documentos antigos e novos", () => {
    expect(parsePatternPiece(square).darts).toBeUndefined();
    const dart = closeDart(createDart("square", { xMm: 50, yMm: 0 }, { xMm: 50, yMm: 60 }));
    const parsed = parsePatternPiece({ ...square, darts: [dart], internalLines: [{ id: "fold", pieceId: "stale", points: [square.points[0], square.points[1]], curved: false, purpose: "fold" }] });
    expect(parsed.darts?.[0].pieceId).toBe("square"); expect(parsed.internalLines?.[0].pieceId).toBe("square");
  });
});

function area(points: Array<{ xMm: number; yMm: number }>): number { return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.xMm * next.yMm - next.xMm * point.yMm; }, 0) / 2); }
