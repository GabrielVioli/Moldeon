import { samplePatternSegment } from "./polygonGeometry";
import {
  createDocumentId,
  edgeRangeLength,
  getEdgeById,
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type EdgeRange,
  type GarmentDraft,
  type PatternDart,
  type PatternPiece,
  type PatternPoint,
  type PatternVector,
  type PieceWorkspaceTransform,
} from "./pattern";

export interface CutIntersection extends PatternVector {
  edgeIndex: number;
  cutT: number;
}

export type CutClassification =
  | { kind: "valid"; intersections: [CutIntersection, CutIntersection] }
  | { kind: "outside" | "touching" | "multiple"; intersections: CutIntersection[] };

export function extendCutLine(piece: PatternPiece, cut: [PatternVector, PatternVector]): [PatternVector, PatternVector] {
  const dx = cut[1].xMm - cut[0].xMm; const dy = cut[1].yMm - cut[0].yMm; const length = Math.hypot(dx, dy);
  if (length < 0.01) return cut;
  const xs = piece.points.map((point) => point.xMm); const ys = piece.points.map((point) => point.yMm);
  const reach = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 2 + 100;
  const ux = dx / length; const uy = dy / length;
  return [{ xMm: cut[0].xMm - ux * reach, yMm: cut[0].yMm - uy * reach }, { xMm: cut[1].xMm + ux * reach, yMm: cut[1].yMm + uy * reach }];
}

export function splitBezierAtT(start: PatternPoint, end: PatternPoint, t: number): [PatternPoint, PatternPoint, PatternPoint] {
  const p0 = vector(start);
  const p1 = start.handleOut ? add(p0, start.handleOut) : p0;
  const p3 = vector(end);
  const p2 = end.handleIn ? add(p3, end.handleIn) : p3;
  const a = lerp(p0, p1, t); const b = lerp(p1, p2, t); const c = lerp(p2, p3, t);
  const d = lerp(a, b, t); const e = lerp(b, c, t); const middle = lerp(d, e, t);
  return [
    { ...start, handleOut: subtract(a, p0) },
    { id: createDocumentId("point"), ...middle, handleIn: subtract(d, middle), handleOut: subtract(e, middle) },
    { ...end, handleIn: subtract(c, p3) },
  ];
}

export function calculateCurvedSeamLength(piece: PatternPiece, range: EdgeRange): number {
  return edgeRangeLength(piece, range);
}

export function matchSeamDirections(first: PatternVector, firstEnd: PatternVector, second: PatternVector, secondEnd: PatternVector): "same" | "opposite" {
  const a = subtract(firstEnd, first); const b = subtract(secondEnd, second);
  return a.xMm * b.xMm + a.yMm * b.yMm >= 0 ? "opposite" : "same";
}

export function classifyCutIntersections(piece: PatternPiece, cut: [PatternVector, PatternVector]): CutClassification {
  const intersections: CutIntersection[] = [];
  for (let edgeIndex = 0; edgeIndex < piece.points.length; edgeIndex += 1) {
    const start = piece.points[edgeIndex]; const end = piece.points[(edgeIndex + 1) % piece.points.length];
    const sampled = samplePatternSegment(start, end);
    for (let index = 0; index < sampled.length - 1; index += 1) {
      const hit = segmentIntersection(cut[0], cut[1], sampled[index], sampled[index + 1]);
      if (!hit) continue;
      const duplicate = intersections.some((candidate) => distance(candidate, hit.point) < 0.01);
      if (!duplicate) intersections.push({ ...hit.point, edgeIndex, cutT: hit.firstT });
    }
  }
  intersections.sort((a, b) => a.cutT - b.cutT);
  if (intersections.length === 0) return { kind: "outside", intersections };
  if (intersections.length === 1) return { kind: "touching", intersections };
  if (intersections.length > 2) return { kind: "multiple", intersections };
  return { kind: "valid", intersections: intersections as [CutIntersection, CutIntersection] };
}

export function splitPatternByLine(piece: PatternPiece, cut: [PatternVector, PatternVector]): [PatternPoint[], PatternPoint[]] | null {
  const classification = classifyCutIntersections(piece, cut);
  if (classification.kind !== "valid") return null;
  const [first, second] = classification.intersections;
  const contour = structuredClone(piece.points);
  const firstPoint = toPoint(first); const secondPoint = toPoint(second);
  const forward = collectContour(contour, first.edgeIndex, second.edgeIndex);
  const backward = collectContour(contour, second.edgeIndex, first.edgeIndex);
  return [[firstPoint, ...forward, secondPoint], [secondPoint, ...backward, firstPoint]].map((path) => sanitizeSplitPath(dedupePoints(path))) as [PatternPoint[], PatternPoint[]];
}

export function createPatternPiecesFromSplit(piece: PatternPiece, cut: [PatternVector, PatternVector]): [PatternPiece, PatternPiece] | null {
  const paths = splitPatternByLine(piece, cut);
  if (!paths || paths.some((path) => path.length < 3)) return null;
  const makePiece = (points: PatternPoint[], index: number): PatternPiece => {
    const { nodes: _nodes, segments: _segments, contours: _contours, formatVersion: _formatVersion, ...legacy } = structuredClone(piece);
    return migrateLegacyPieceToSegments({
      ...legacy, id: createDocumentId("piece"), name: `${piece.name} ${index + 1}`,
      points: points.map((point, pointIndex) => ({ ...point, id: createDocumentId(`cut-${pointIndex + 1}`) })),
      darts: [], internalLines: [], previewPlacements: undefined, edgeFinishes: {},
    });
  };
  return [makePiece(paths[0], 0), makePiece(paths[1], 1)];
}

export function createDart(pieceId: string, edgePoint: PatternVector, apex: PatternVector, widthMm = 20): PatternDart {
  const dx = apex.xMm - edgePoint.xMm; const dy = apex.yMm - edgePoint.yMm;
  const length = Math.max(0.01, Math.hypot(dx, dy)); const nx = -dy / length; const ny = dx / length;
  const legA = { xMm: edgePoint.xMm + nx * widthMm / 2, yMm: edgePoint.yMm + ny * widthMm / 2 };
  const legB = { xMm: edgePoint.xMm - nx * widthMm / 2, yMm: edgePoint.yMm - ny * widthMm / 2 };
  return { id: createDocumentId("dart"), pieceId, apex: { ...apex }, legA, legB, centerLine: { start: { ...edgePoint }, end: { ...apex } }, widthMm, lengthMm: length, directionDeg: Math.atan2(dy, dx) * 180 / Math.PI, closed: false };
}

export function updateDart(dart: PatternDart, update: Partial<Pick<PatternDart, "widthMm" | "lengthMm" | "directionDeg">>): PatternDart {
  const widthMm = Math.max(1, update.widthMm ?? dart.widthMm); const lengthMm = Math.max(1, update.lengthMm ?? dart.lengthMm);
  const directionDeg = update.directionDeg ?? dart.directionDeg; const angle = directionDeg * Math.PI / 180;
  const start = dart.centerLine.start; const apex = { xMm: start.xMm + Math.cos(angle) * lengthMm, yMm: start.yMm + Math.sin(angle) * lengthMm };
  return createDartFromValues(dart, start, apex, widthMm, lengthMm, directionDeg);
}

export function closeDart(dart: PatternDart): PatternDart { return { ...dart, closed: true }; }

export function shapeDartCap(dart: PatternDart): PatternVector { return lerp(dart.legA, dart.legB, 0.5); }

export function findNearbySeamCandidates(garment: GarmentDraft, first: EdgeRange, transforms: PieceWorkspaceTransform[], thresholdMm: number): EdgeRange[] {
  const firstPiece = garment.pieces.find((piece) => piece.id === first.pieceId); const firstEdge = firstPiece && getEdgeById(firstPiece, first.edgeId);
  if (!firstPiece || !firstEdge) return [];
  const firstTransform = transforms.find((item) => item.pieceId === first.pieceId) ?? { pieceId: first.pieceId, xMm: 0, yMm: 0, rotationDeg: 0 };
  const firstMid = transformPoint(edgeArcMidpoint(firstPiece, firstEdge.startPointId), firstTransform);
  const firstLength = edgeRangeLength(firstPiece, first);
  const candidates = garment.pieces.flatMap((piece) => {
    if (piece.id === first.pieceId) return [];
    const transform = transforms.find((item) => item.pieceId === piece.id) ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    return getPatternEdges(piece).flatMap((edge) => {
      const mid = transformPoint(edgeArcMidpoint(piece, edge.startPointId), transform);
      const midpointDistance = distance(firstMid, mid);
      if (midpointDistance > thresholdMm) return [];
      const range = { pieceId: piece.id, edgeId: edge.id, startT: 0, endT: 1 };
      const lengthDifference = Math.abs(firstLength - edgeRangeLength(piece, range));
      return [{ range, score: midpointDistance + lengthDifference * 0.25 }];
    });
  });
  return candidates.sort((left, right) => left.score - right.score).map((candidate) => candidate.range);
}

function edgeArcMidpoint(piece: PatternPiece, startPointId: string): PatternVector {
  const startIndex = piece.points.findIndex((point) => point.id === startPointId);
  if (startIndex < 0) return { xMm: 0, yMm: 0 };
  const samples = samplePatternSegment(piece.points[startIndex], piece.points[(startIndex + 1) % piece.points.length]);
  if (samples.length < 2) return samples[0] ?? { xMm: 0, yMm: 0 };
  const lengths = samples.slice(1).map((point, index) => distance(samples[index], point));
  const target = lengths.reduce((sum, value) => sum + value, 0) / 2;
  let walked = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (walked + lengths[index] >= target) {
      const t = lengths[index] === 0 ? 0 : (target - walked) / lengths[index];
      return lerp(samples[index], samples[index + 1], t);
    }
    walked += lengths[index];
  }
  return samples.at(-1)!;
}

function createDartFromValues(dart: PatternDart, start: PatternVector, apex: PatternVector, widthMm: number, lengthMm: number, directionDeg: number): PatternDart {
  const angle = directionDeg * Math.PI / 180; const nx = -Math.sin(angle); const ny = Math.cos(angle);
  return { ...dart, apex, legA: { xMm: start.xMm + nx * widthMm / 2, yMm: start.yMm + ny * widthMm / 2 }, legB: { xMm: start.xMm - nx * widthMm / 2, yMm: start.yMm - ny * widthMm / 2 }, centerLine: { start: { ...start }, end: apex }, widthMm, lengthMm, directionDeg };
}
function collectContour(points: PatternPoint[], startEdge: number, endEdge: number): PatternPoint[] { const result: PatternPoint[] = []; let index = (startEdge + 1) % points.length; while (index !== (endEdge + 1) % points.length) { result.push(points[index]); index = (index + 1) % points.length; } return result; }
function dedupePoints(points: PatternPoint[]): PatternPoint[] { return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 0.01); }
function sanitizeSplitPath(points: PatternPoint[]): PatternPoint[] { const result = points.map((point) => ({ ...point })); if (result[1]) result[1].handleIn = undefined; if (result.at(-2)) result.at(-2)!.handleOut = undefined; return result; }
function toPoint(point: PatternVector): PatternPoint { return { id: createDocumentId("intersection"), xMm: point.xMm, yMm: point.yMm }; }
function vector(point: PatternVector): PatternVector { return { xMm: point.xMm, yMm: point.yMm }; }
function add(a: PatternVector, b: PatternVector): PatternVector { return { xMm: a.xMm + b.xMm, yMm: a.yMm + b.yMm }; }
function subtract(a: PatternVector, b: PatternVector): PatternVector { return { xMm: a.xMm - b.xMm, yMm: a.yMm - b.yMm }; }
function lerp(a: PatternVector, b: PatternVector, t: number): PatternVector { return { xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t }; }
function distance(a: PatternVector, b: PatternVector): number { return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm); }
function segmentIntersection(a: PatternVector, b: PatternVector, c: PatternVector, d: PatternVector): { point: PatternVector; firstT: number } | null { const rx = b.xMm - a.xMm; const ry = b.yMm - a.yMm; const sx = d.xMm - c.xMm; const sy = d.yMm - c.yMm; const denominator = rx * sy - ry * sx; if (Math.abs(denominator) < 1e-9) return null; const qx = c.xMm - a.xMm; const qy = c.yMm - a.yMm; const t = (qx * sy - qy * sx) / denominator; const u = (qx * ry - qy * rx) / denominator; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { point: { xMm: a.xMm + t * rx, yMm: a.yMm + t * ry }, firstT: t } : null; }
function transformPoint(point: PatternVector, transform: PieceWorkspaceTransform): PatternVector { const angle = transform.rotationDeg * Math.PI / 180; return { xMm: point.xMm * Math.cos(angle) - point.yMm * Math.sin(angle) + transform.xMm, yMm: point.xMm * Math.sin(angle) + point.yMm * Math.cos(angle) + transform.yMm }; }
