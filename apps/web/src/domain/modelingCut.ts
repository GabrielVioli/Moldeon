import {
  analyzeInternalPath,
  applyInternalPathOperation,
  moveInternalPathNode,
  normalizeInternalPath,
  sampleInternalPath,
  type InternalPathAnalysis,
  type InternalPathOperationResult,
} from "./internalPaths";
import { findNearestPatternSegment } from "./patternEditing";
import {
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type InternalPath,
  type InternalPathPurpose,
  type PatternPiece,
  type PatternSegment,
  type PatternVector,
  type Seam,
} from "./pattern";
import { samplePatternContour } from "./polygonGeometry";

export const CUT_START_EDGE_KEY = "cutStartEdgeId";
export const CUT_START_T_KEY = "cutStartT";
export const CUT_END_EDGE_KEY = "cutEndEdgeId";
export const CUT_END_T_KEY = "cutEndT";
export const CUT_ANCHOR_VERSION_KEY = "cutBoundaryAnchorVersion";

const DEFAULT_SNAP_MM = 8;
const VERTEX_SNAP_T = 0.02;
const PROXY_EXTENSION_MM = 1.5;

export interface BoundaryAnchor {
  edgeId: string;
  t: number;
  point: PatternVector;
  distanceMm: number;
}

export interface CutPreviewRegion {
  id: "a" | "b";
  points: PatternVector[];
  areaMm2: number;
}

export function purposeUsesBoundaryAnchors(purpose: InternalPathPurpose): boolean {
  return purpose === "cut" || purpose === "cut-and-sew";
}

export function snapInternalPathPointToContour(
  piece: PatternPiece,
  point: PatternVector,
  thresholdMm = DEFAULT_SNAP_MM,
): BoundaryAnchor | null {
  const target = findNearestPatternSegment(piece, point);
  if (!target || target.distanceMm > thresholdMm) return null;
  const t = target.t <= VERTEX_SNAP_T ? 0 : target.t >= 1 - VERTEX_SNAP_T ? 1 : target.t;
  const projected = pointOnPatternEdge(piece, target.segmentId, t);
  if (!projected) return null;
  return {
    edgeId: target.segmentId,
    t,
    point: projected,
    distanceMm: target.distanceMm,
  };
}

export function startAnchoredInternalPath(
  pathValue: InternalPath,
  piece: PatternPiece,
  thresholdMm = DEFAULT_SNAP_MM,
): InternalPath {
  if (!purposeUsesBoundaryAnchors(pathValue.purpose)) return pathValue;
  const path = normalizeInternalPath(pathValue);
  const first = path.nodes[0];
  if (!first) return path;
  const anchor = snapInternalPathPointToContour(piece, first, thresholdMm);
  if (!anchor) return clearBoundaryAnchor(path, "start");
  let next = moveInternalPathNode(path, first.id, anchor.point);
  next = writeBoundaryAnchor(next, "start", anchor);
  return next;
}

export function appendAnchoredInternalPathPoint(
  pathValue: InternalPath,
  piece: PatternPiece,
  point: PatternVector,
  append: (path: InternalPath, point: PatternVector) => InternalPath,
  thresholdMm = DEFAULT_SNAP_MM,
): InternalPath {
  let path = normalizeInternalPath(pathValue);
  const cursor = path.nodes.at(-1);
  if (!cursor) return path;
  const anchor = purposeUsesBoundaryAnchors(path.purpose)
    ? snapInternalPathPointToContour(piece, point, thresholdMm)
    : null;
  const fixedPoint = anchor?.point ?? point;
  path = moveInternalPathNode(path, cursor.id, fixedPoint);
  path = append(path, fixedPoint);
  if (purposeUsesBoundaryAnchors(path.purpose)) {
    path = anchor ? writeBoundaryAnchor(path, "end", anchor) : clearBoundaryAnchor(path, "end");
  }
  return path;
}

export function moveAnchoredDraftCursor(
  pathValue: InternalPath,
  piece: PatternPiece,
  point: PatternVector,
  thresholdMm = DEFAULT_SNAP_MM,
): InternalPath {
  const path = normalizeInternalPath(pathValue);
  const cursor = path.nodes.at(-1);
  if (!cursor) return path;
  const anchor = purposeUsesBoundaryAnchors(path.purpose)
    ? snapInternalPathPointToContour(piece, point, thresholdMm)
    : null;
  return moveInternalPathNode(path, cursor.id, anchor?.point ?? point);
}

export function finalizeBoundaryAnchors(
  pathValue: InternalPath,
  piece: PatternPiece,
  thresholdMm = DEFAULT_SNAP_MM,
): InternalPath {
  let path = normalizeInternalPath(pathValue);
  if (!purposeUsesBoundaryAnchors(path.purpose)) return path;
  const first = path.nodes[0];
  const last = path.nodes.at(-1);
  if (!first || !last) return path;
  const start = snapInternalPathPointToContour(piece, first, thresholdMm);
  const end = snapInternalPathPointToContour(piece, last, thresholdMm);
  if (start) {
    path = moveInternalPathNode(path, first.id, start.point);
    path = writeBoundaryAnchor(path, "start", start);
  } else {
    path = clearBoundaryAnchor(path, "start");
  }
  if (end) {
    path = moveInternalPathNode(path, last.id, end.point);
    path = writeBoundaryAnchor(path, "end", end);
  } else {
    path = clearBoundaryAnchor(path, "end");
  }
  return path;
}

export function moveAnchoredInternalPathNode(
  pathValue: InternalPath,
  piece: PatternPiece,
  nodeId: string,
  point: PatternVector,
  thresholdMm = DEFAULT_SNAP_MM,
): InternalPath {
  let path = normalizeInternalPath(pathValue);
  const index = path.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return path;
  if (!purposeUsesBoundaryAnchors(path.purpose) || (index !== 0 && index !== path.nodes.length - 1)) {
    return moveInternalPathNode(path, nodeId, point);
  }
  const anchor = snapInternalPathPointToContour(piece, point, thresholdMm);
  path = moveInternalPathNode(path, nodeId, anchor?.point ?? point);
  const side = index === 0 ? "start" : "end";
  return anchor ? writeBoundaryAnchor(path, side, anchor) : clearBoundaryAnchor(path, side);
}

export function readBoundaryAnchors(path: InternalPath): { start: BoundaryAnchor | null; end: BoundaryAnchor | null } {
  const read = (side: "start" | "end"): BoundaryAnchor | null => {
    const edgeKey = side === "start" ? CUT_START_EDGE_KEY : CUT_END_EDGE_KEY;
    const tKey = side === "start" ? CUT_START_T_KEY : CUT_END_T_KEY;
    const edgeId = path.metadata[edgeKey];
    const t = path.metadata[tKey];
    const node = side === "start" ? path.nodes[0] : path.nodes.at(-1);
    if (typeof edgeId !== "string" || typeof t !== "number" || !node || !Number.isFinite(t)) return null;
    return {
      edgeId,
      t: clamp01(t),
      point: { xMm: node.xMm, yMm: node.yMm },
      distanceMm: 0,
    };
  };
  return { start: read("start"), end: read("end") };
}

export function analyzeModelingInternalPath(
  piece: PatternPiece,
  pathValue: InternalPath,
  seams: readonly Seam[] = [],
): InternalPathAnalysis {
  const path = finalizeBoundaryAnchors(pathValue, piece);
  const analyzedPath = purposeUsesBoundaryAnchors(path.purpose)
    ? boundaryIntersectionProxy(piece, path)
    : path;
  const analysis = analyzeInternalPath(piece, analyzedPath, seams);
  if (purposeUsesBoundaryAnchors(path.purpose)) {
    const anchors = readBoundaryAnchors(path);
    if (!anchors.start || !anchors.end) {
      const diagnostics = analysis.diagnostics.filter((item) => item.code !== "insufficient-intersections");
      diagnostics.push({
        code: "cut-endpoints-not-anchored",
        severity: "error",
        message: "O corte precisa começar e terminar encaixado no contorno da peça.",
        pathId: path.id,
      });
      return { ...analysis, valid: false, diagnostics };
    }
  }
  return analysis;
}

export function applyModelingInternalPathOperation(
  garmentValue: GarmentDraft,
  pieceId: string,
  pathId: string,
  options: { keepJoined?: boolean } = {},
): InternalPathOperationResult {
  const garment = structuredClone(garmentValue);
  const piece = garment.pieces.find((candidate) => candidate.id === pieceId);
  const raw = piece?.internalLines?.find((line) => line.id === pathId);
  if (!piece || !raw || !("nodes" in raw)) {
    return applyInternalPathOperation(garment, pieceId, pathId, options);
  }
  const snapped = finalizeBoundaryAnchors(normalizeInternalPath(raw), piece);
  const proxy = purposeUsesBoundaryAnchors(snapped.purpose)
    ? boundaryIntersectionProxy(piece, snapped)
    : snapped;
  const proxyGarment: GarmentDraft = {
    ...garment,
    pieces: garment.pieces.map((candidate) => candidate.id === pieceId
      ? {
          ...candidate,
          internalLines: [
            ...(candidate.internalLines ?? []).filter((line) => line.id !== pathId),
            proxy,
          ],
        }
      : candidate),
  };
  return applyInternalPathOperation(proxyGarment, pieceId, pathId, options);
}

export function buildCutPreviewRegions(
  piece: PatternPiece,
  pathValue: InternalPath,
  analysisValue?: InternalPathAnalysis | null,
): CutPreviewRegion[] {
  const path = finalizeBoundaryAnchors(pathValue, piece);
  if (!purposeUsesBoundaryAnchors(path.purpose)) return [];
  const analysis = analysisValue ?? analyzeModelingInternalPath(piece, path);
  if (!analysis.valid || analysis.intersections.length !== 2) return [];
  const contour = samplePatternContour(piece.points).map(vector);
  const cut = sampleInternalPath(path).map(vector);
  if (contour.length < 3 || cut.length < 2) return [];
  const [first, second] = analysis.intersections;
  const firstContour = nearestIndex(contour, first);
  const secondContour = nearestIndex(contour, second);
  const firstPath = nearestIndex(cut, first);
  const secondPath = nearestIndex(cut, second);
  const pathSlice = cut.slice(Math.min(firstPath, secondPath), Math.max(firstPath, secondPath) + 1);
  const cutForward = [vector(first), ...pathSlice.slice(1, -1), vector(second)];
  const contourForward = [vector(first), ...wrappedInterior(contour, firstContour, secondContour), vector(second)];
  const contourBackward = [vector(second), ...wrappedInterior(contour, secondContour, firstContour), vector(first)];
  const regionA = dedupe([...contourForward, ...[...cutForward].reverse().slice(1)]);
  const regionB = dedupe([...contourBackward, ...cutForward.slice(1)]);
  return [
    { id: "a", points: regionA, areaMm2: polygonArea(regionA) },
    { id: "b", points: regionB, areaMm2: polygonArea(regionB) },
  ];
}

function boundaryIntersectionProxy(piece: PatternPiece, pathValue: InternalPath): InternalPath {
  const path = normalizeInternalPath(pathValue);
  const anchors = readBoundaryAnchors(path);
  if (!anchors.start || !anchors.end || path.nodes.length < 2) return path;
  const startPoint = pointOnPatternEdge(piece, anchors.start.edgeId, anchors.start.t);
  const endPoint = pointOnPatternEdge(piece, anchors.end.edgeId, anchors.end.t);
  if (!startPoint || !endPoint) return path;
  const next = path.nodes[1];
  const previous = path.nodes[path.nodes.length - 2];
  const startDirection = normalized({ xMm: startPoint.xMm - next.xMm, yMm: startPoint.yMm - next.yMm });
  const endDirection = normalized({ xMm: endPoint.xMm - previous.xMm, yMm: endPoint.yMm - previous.yMm });
  let proxy = moveInternalPathNode(path, path.nodes[0].id, {
    xMm: startPoint.xMm + startDirection.xMm * PROXY_EXTENSION_MM,
    yMm: startPoint.yMm + startDirection.yMm * PROXY_EXTENSION_MM,
  });
  proxy = moveInternalPathNode(proxy, path.nodes.at(-1)!.id, {
    xMm: endPoint.xMm + endDirection.xMm * PROXY_EXTENSION_MM,
    yMm: endPoint.yMm + endDirection.yMm * PROXY_EXTENSION_MM,
  });
  return proxy;
}

function writeBoundaryAnchor(path: InternalPath, side: "start" | "end", anchor: BoundaryAnchor): InternalPath {
  return {
    ...path,
    metadata: {
      ...path.metadata,
      [side === "start" ? CUT_START_EDGE_KEY : CUT_END_EDGE_KEY]: anchor.edgeId,
      [side === "start" ? CUT_START_T_KEY : CUT_END_T_KEY]: anchor.t,
      [CUT_ANCHOR_VERSION_KEY]: 1,
    },
  };
}

function clearBoundaryAnchor(path: InternalPath, side: "start" | "end"): InternalPath {
  const metadata = { ...path.metadata };
  delete metadata[side === "start" ? CUT_START_EDGE_KEY : CUT_END_EDGE_KEY];
  delete metadata[side === "start" ? CUT_START_T_KEY : CUT_END_T_KEY];
  return { ...path, metadata };
}

function pointOnPatternEdge(pieceValue: PatternPiece, edgeId: string, rawT: number): PatternVector | null {
  const piece = migrateLegacyPieceToSegments(structuredClone(pieceValue));
  const segment = piece.segments?.find((candidate) => candidate.id === edgeId);
  const nodes = new Map((piece.nodes ?? []).map((node) => [node.id, node]));
  const start = segment ? nodes.get(segment.startNodeId) : undefined;
  const end = segment ? nodes.get(segment.endNodeId) : undefined;
  if (!segment || !start || !end) return null;
  const t = clamp01(rawT);
  if (segment.kind === "line") return lerp(start, end, t);
  return cubic(
    start,
    segment.control1 ?? lerp(start, end, 1 / 3),
    segment.control2 ?? lerp(start, end, 2 / 3),
    end,
    t,
  );
}

function wrappedInterior(points: PatternVector[], start: number, end: number): PatternVector[] {
  const result: PatternVector[] = [];
  let index = (start + 1) % points.length;
  for (let guard = 0; guard < points.length && index !== end; guard += 1) {
    result.push(points[index]);
    index = (index + 1) % points.length;
  }
  return result;
}

function nearestIndex(points: readonly PatternVector[], target: PatternVector): number {
  let index = 0;
  let best = Number.POSITIVE_INFINITY;
  points.forEach((point, candidate) => {
    const current = distance(point, target);
    if (current < best) {
      best = current;
      index = candidate;
    }
  });
  return index;
}

function dedupe(points: PatternVector[]): PatternVector[] {
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 0.001);
}

function polygonArea(points: readonly PatternVector[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  return Math.abs(sum) / 2;
}

function normalized(vectorValue: PatternVector): PatternVector {
  const magnitude = Math.hypot(vectorValue.xMm, vectorValue.yMm);
  return magnitude <= 1e-9
    ? { xMm: 0, yMm: 0 }
    : { xMm: vectorValue.xMm / magnitude, yMm: vectorValue.yMm / magnitude };
}

function cubic(p0: PatternVector, p1: PatternVector, p2: PatternVector, p3: PatternVector, t: number): PatternVector {
  const q = 1 - t;
  return {
    xMm: q ** 3 * p0.xMm + 3 * q ** 2 * t * p1.xMm + 3 * q * t ** 2 * p2.xMm + t ** 3 * p3.xMm,
    yMm: q ** 3 * p0.yMm + 3 * q ** 2 * t * p1.yMm + 3 * q * t ** 2 * p2.yMm + t ** 3 * p3.yMm,
  };
}

function lerp(a: PatternVector, b: PatternVector, t: number): PatternVector {
  return { xMm: a.xMm + (b.xMm - a.xMm) * t, yMm: a.yMm + (b.yMm - a.yMm) * t };
}

function vector(point: PatternVector): PatternVector {
  return { xMm: point.xMm, yMm: point.yMm };
}

function distance(a: PatternVector, b: PatternVector): number {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
