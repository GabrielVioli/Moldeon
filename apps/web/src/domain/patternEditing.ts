import {
  migrateLegacyPieceToSegments,
  seamSideRanges,
  syncLegacyPointsFromSegments,
  type EdgeRange,
  type PatternNode,
  type PatternPiece,
  type PatternPoint,
  type PatternSegment,
  type PatternVector,
  type Seam,
} from "./pattern";

export interface SegmentInsertionTarget {
  startPointId: string;
  segmentId: string;
  t: number;
  distanceMm: number;
}

export interface SegmentSplitMapping {
  pieceId: string;
  originalEdgeId: string;
  firstEdgeId: string;
  secondEdgeId: string;
  splitT: number;
}

export interface InsertedPatternPoint {
  piece: PatternPiece;
  pointId: string;
  split: SegmentSplitMapping;
}

const CURVE_HIT_STEPS = 32;
const MIN_SPLIT_T = 0.02;
const MAX_SPLIT_T = 0.98;
const EPSILON = 1e-7;

export function findNearestPatternSegment(
  source: PatternPiece | readonly PatternPoint[],
  target: PatternVector,
): SegmentInsertionTarget | null {
  const piece = Array.isArray(source)
    ? migrateLegacyPieceToSegments({
        id: "hit-test-piece",
        name: "Hit test",
        seamAllowanceMm: 0,
        points: source.map(clonePoint),
      })
    : migrateLegacyPieceToSegments(structuredClone(source as PatternPiece));

  if (!piece.nodes?.length || !piece.segments?.length) return null;
  const nodes = new Map(piece.nodes.map((node) => [node.id, node]));
  let nearest: SegmentInsertionTarget | null = null;

  for (const segment of orderedSegments(piece)) {
    const start = nodes.get(segment.startNodeId);
    const end = nodes.get(segment.endNodeId);
    if (!start || !end) continue;
    const steps = segment.kind === "cubic" ? CURVE_HIT_STEPS : 1;

    for (let step = 0; step < steps; step += 1) {
      const startT = step / steps;
      const endT = (step + 1) / steps;
      const sampleStart = segmentPoint(segment, start, end, startT);
      const sampleEnd = segmentPoint(segment, start, end, endT);
      const projection = projectPointOnLine(target, sampleStart, sampleEnd);
      const t = startT + (endT - startT) * projection.t;

      if (!nearest || projection.distanceMm < nearest.distanceMm) {
        nearest = {
          startPointId: segment.startNodeId,
          segmentId: segment.id,
          t,
          distanceMm: projection.distanceMm,
        };
      }
    }
  }

  return nearest;
}

export function insertPatternPoint(
  piece: PatternPiece,
  startPointId: string,
  rawT: number,
): InsertedPatternPoint | null {
  const model = migrateLegacyPieceToSegments(structuredClone(piece));
  const segment = orderedSegments(model).find(
    (candidate) => candidate.startNodeId === startPointId,
  );
  if (!segment) return null;
  return splitPatternSegmentAt(model, segment.id, rawT);
}

export function splitPatternSegmentAt(
  piece: PatternPiece,
  segmentId: string,
  rawT: number,
): InsertedPatternPoint | null {
  const model = migrateLegacyPieceToSegments(structuredClone(piece));
  if (!model.nodes || !model.segments || !model.contours) return null;

  const segmentIndex = model.segments.findIndex(
    (candidate) => candidate.id === segmentId,
  );
  if (segmentIndex < 0) return null;

  const sourceSegment = model.segments[segmentIndex];
  const start = model.nodes.find(
    (node) => node.id === sourceSegment.startNodeId,
  );
  const end = model.nodes.find((node) => node.id === sourceSegment.endNodeId);
  if (!start || !end) return null;

  const t = clamp(rawT, MIN_SPLIT_T, MAX_SPLIT_T);
  const pointId = nextInsertedPointId(model);
  const secondSegmentId = nextSplitSegmentId(model, sourceSegment.id);
  const split = splitSegmentGeometry(sourceSegment, start, end, pointId, t);

  model.nodes.push(split.node);
  model.segments.splice(segmentIndex, 1, split.first, {
    ...split.second,
    id: secondSegmentId,
  });
  model.contours = model.contours.map((contour) => ({
    ...contour,
    segmentIds: contour.segmentIds.flatMap((id) =>
      id === sourceSegment.id ? [sourceSegment.id, secondSegmentId] : [id],
    ),
  }));

  if (model.edgeFinishes?.[sourceSegment.id]) {
    model.edgeFinishes = {
      ...model.edgeFinishes,
      [secondSegmentId]: model.edgeFinishes[sourceSegment.id],
    };
  }

  const synchronized = syncLegacyPointsFromSegments(model);
  return {
    piece: synchronized,
    pointId,
    split: {
      pieceId: piece.id,
      originalEdgeId: sourceSegment.id,
      firstEdgeId: sourceSegment.id,
      secondEdgeId: secondSegmentId,
      splitT: t,
    },
  };
}

export function remapSeamsAfterSegmentSplit(
  seams: readonly Seam[],
  split: SegmentSplitMapping,
): Seam[] {
  return seams.flatMap((seam) => splitSeamAtEdgeParameter(seam, split));
}

export function removePatternPoint(
  piece: PatternPiece,
  pointId: string,
): PatternPiece | null {
  if (piece.points.length <= 3) return null;
  const index = piece.points.findIndex((point) => point.id === pointId);
  if (index < 0) return null;

  const points = piece.points
    .filter((point) => point.id !== pointId)
    .map(clonePoint);
  const previousIndex = (index - 1 + points.length) % points.length;
  const nextIndex = index % points.length;
  delete points[previousIndex].handleOut;
  delete points[nextIndex].handleIn;
  return migrateLegacyPieceToSegments({
    ...piece,
    formatVersion: undefined,
    nodes: undefined,
    segments: undefined,
    contours: undefined,
    points,
  });
}

function splitSegmentGeometry(
  segment: PatternSegment,
  start: PatternNode,
  end: PatternNode,
  nodeId: string,
  t: number,
): { node: PatternNode; first: PatternSegment; second: PatternSegment } {
  const p0 = vector(start);
  const p3 = vector(end);

  if (segment.kind === "line") {
    const middle = interpolate(p0, p3, t);
    return {
      node: { id: nodeId, ...roundVector(middle) },
      first: {
        ...segment,
        endNodeId: nodeId,
      },
      second: {
        ...segment,
        startNodeId: nodeId,
      },
    };
  }

  const p1 = segment.control1 ?? interpolate(p0, p3, 1 / 3);
  const p2 = segment.control2 ?? interpolate(p0, p3, 2 / 3);
  const a = interpolate(p0, p1, t);
  const b = interpolate(p1, p2, t);
  const c = interpolate(p2, p3, t);
  const d = interpolate(a, b, t);
  const e = interpolate(b, c, t);
  const middle = interpolate(d, e, t);

  return {
    node: { id: nodeId, ...roundVector(middle) },
    first: {
      ...segment,
      endNodeId: nodeId,
      control1: roundVector(a),
      control2: roundVector(d),
      smoothEnd: true,
    },
    second: {
      ...segment,
      startNodeId: nodeId,
      control1: roundVector(e),
      control2: roundVector(c),
      smoothStart: true,
    },
  };
}

function splitSeamAtEdgeParameter(
  seam: Seam,
  split: SegmentSplitMapping,
): Seam[] {
  if (seam.firstRanges || seam.secondRanges) {
    const firstRanges = seamSideRanges(seam, "first").flatMap((range) => splitRangeInSequence(range, split));
    const secondRanges = seamSideRanges(seam, "second").flatMap((range) => splitRangeInSequence(range, split));
    return [{
      ...seam,
      first: firstRanges[0],
      second: secondRanges[0],
      ...(firstRanges.length > 1 ? { firstRanges } : { firstRanges: undefined }),
      ...(secondRanges.length > 1 ? { secondRanges } : { secondRanges: undefined }),
    }];
  }
  const cutParameters = [0, 1];
  const firstCut = traversalParameterForSplit(
    seam.first,
    split,
    false,
  );
  const secondCut = traversalParameterForSplit(
    seam.second,
    split,
    seam.direction === "opposite",
  );
  if (firstCut !== null) cutParameters.push(firstCut);
  if (secondCut !== null) cutParameters.push(secondCut);

  const cuts = [...new Set(cutParameters.map((value) => round(value, 8)))]
    .filter((value) => value >= 0 && value <= 1)
    .sort((left, right) => left - right);

  const parts: Seam[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const startU = cuts[index];
    const endU = cuts[index + 1];
    if (endU - startU <= EPSILON) continue;
    const first = mapTraversalInterval(
      seam.first,
      split,
      startU,
      endU,
      false,
    );
    const second = mapTraversalInterval(
      seam.second,
      split,
      startU,
      endU,
      seam.direction === "opposite",
    );
    parts.push({
      ...seam,
      id: cuts.length > 2 && index > 0 ? `${seam.id}:split-${index + 1}` : seam.id,
      first,
      second,
    });
  }
  return parts.length > 0 ? parts : [structuredClone(seam)];
}

function splitRangeInSequence(range: EdgeRange, split: SegmentSplitMapping): EdgeRange[] {
  const cut = traversalParameterForSplit(range, split, false);
  if (cut === null) return [structuredClone(range)];
  return [
    mapTraversalInterval(range, split, 0, cut, false),
    mapTraversalInterval(range, split, cut, 1, false),
  ];
}

function traversalParameterForSplit(
  range: EdgeRange,
  split: SegmentSplitMapping,
  reverseTraversal: boolean,
): number | null {
  if (
    range.pieceId !== split.pieceId ||
    range.edgeId !== split.originalEdgeId ||
    split.splitT <= range.startT + EPSILON ||
    split.splitT >= range.endT - EPSILON
  ) {
    return null;
  }
  const normalized =
    (split.splitT - range.startT) / (range.endT - range.startT);
  return reverseTraversal ? 1 - normalized : normalized;
}

function mapTraversalInterval(
  range: EdgeRange,
  split: SegmentSplitMapping,
  startU: number,
  endU: number,
  reverseTraversal: boolean,
): EdgeRange {
  const parameterAt = (u: number) =>
    reverseTraversal
      ? range.endT - u * (range.endT - range.startT)
      : range.startT + u * (range.endT - range.startT);
  const p0 = parameterAt(startU);
  const p1 = parameterAt(endU);

  if (
    range.pieceId !== split.pieceId ||
    range.edgeId !== split.originalEdgeId
  ) {
    return {
      ...range,
      startT: Math.min(p0, p1),
      endT: Math.max(p0, p1),
    };
  }

  const middle = parameterAt((startU + endU) / 2);
  const useFirst = middle <= split.splitT;
  const denominator = useFirst ? split.splitT : 1 - split.splitT;
  const mapParameter = (parameter: number) =>
    useFirst
      ? clamp(parameter / denominator, 0, 1)
      : clamp((parameter - split.splitT) / denominator, 0, 1);
  const mapped0 = mapParameter(p0);
  const mapped1 = mapParameter(p1);
  return {
    pieceId: range.pieceId,
    edgeId: useFirst ? split.firstEdgeId : split.secondEdgeId,
    startT: round(Math.min(mapped0, mapped1), 8),
    endT: round(Math.max(mapped0, mapped1), 8),
  };
}

function orderedSegments(piece: PatternPiece): PatternSegment[] {
  const byId = new Map((piece.segments ?? []).map((segment) => [segment.id, segment]));
  const contour = piece.contours?.find((candidate) => candidate.closed) ?? piece.contours?.[0];
  if (!contour) return piece.segments ?? [];
  return contour.segmentIds
    .map((id) => byId.get(id))
    .filter((segment): segment is PatternSegment => Boolean(segment));
}

function segmentPoint(
  segment: PatternSegment,
  start: PatternVector,
  end: PatternVector,
  t: number,
): PatternVector {
  if (segment.kind === "line") return interpolate(start, end, t);
  const p1 = segment.control1 ?? interpolate(start, end, 1 / 3);
  const p2 = segment.control2 ?? interpolate(start, end, 2 / 3);
  const oneMinusT = 1 - t;
  return {
    xMm:
      oneMinusT ** 3 * start.xMm +
      3 * oneMinusT ** 2 * t * p1.xMm +
      3 * oneMinusT * t ** 2 * p2.xMm +
      t ** 3 * end.xMm,
    yMm:
      oneMinusT ** 3 * start.yMm +
      3 * oneMinusT ** 2 * t * p1.yMm +
      3 * oneMinusT * t ** 2 * p2.yMm +
      t ** 3 * end.yMm,
  };
}

function projectPointOnLine(
  target: PatternVector,
  start: PatternVector,
  end: PatternVector,
) {
  const deltaX = end.xMm - start.xMm;
  const deltaY = end.yMm - start.yMm;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const rawT =
    lengthSquared === 0
      ? 0
      : ((target.xMm - start.xMm) * deltaX +
          (target.yMm - start.yMm) * deltaY) /
        lengthSquared;
  const t = clamp(rawT, 0, 1);
  const xMm = start.xMm + deltaX * t;
  const yMm = start.yMm + deltaY * t;
  return {
    t,
    distanceMm: Math.hypot(target.xMm - xMm, target.yMm - yMm),
  };
}

function nextInsertedPointId(piece: PatternPiece): string {
  const existing = new Set([
    ...piece.points.map((point) => point.id),
    ...(piece.nodes ?? []).map((node) => node.id),
  ]);
  let sequence = 1;
  while (existing.has(`${piece.id}:insert-${sequence}`)) sequence += 1;
  return `${piece.id}:insert-${sequence}`;
}

function nextSplitSegmentId(piece: PatternPiece, sourceId: string): string {
  const existing = new Set((piece.segments ?? []).map((segment) => segment.id));
  let sequence = 2;
  while (existing.has(`${sourceId}:part-${sequence}`)) sequence += 1;
  return `${sourceId}:part-${sequence}`;
}

function clonePoint(point: PatternPoint): PatternPoint {
  return {
    ...point,
    ...(point.handleIn ? { handleIn: { ...point.handleIn } } : {}),
    ...(point.handleOut ? { handleOut: { ...point.handleOut } } : {}),
  };
}

function vector(point: PatternVector): PatternVector {
  return { xMm: point.xMm, yMm: point.yMm };
}

function interpolate(
  start: PatternVector,
  end: PatternVector,
  t: number,
): PatternVector {
  return {
    xMm: start.xMm + (end.xMm - start.xMm) * t,
    yMm: start.yMm + (end.yMm - start.yMm) * t,
  };
}

function roundVector(point: PatternVector): PatternVector {
  return { xMm: round(point.xMm, 6), yMm: round(point.yMm, 6) };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
