import type { PatternPiece, PatternPoint } from "./pattern";

export interface SegmentInsertionTarget {
  startPointId: string;
  t: number;
  distanceMm: number;
}

export interface InsertedPatternPoint {
  piece: PatternPiece;
  pointId: string;
}

const CURVE_HIT_STEPS = 20;

export function findNearestPatternSegment(
  points: readonly PatternPoint[],
  target: { xMm: number; yMm: number },
): SegmentInsertionTarget | null {
  if (points.length < 2) return null;

  let nearest: SegmentInsertionTarget | null = null;
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex];
    const end = points[(pointIndex + 1) % points.length];
    const curved = Boolean(start.handleOut || end.handleIn);
    const steps = curved ? CURVE_HIT_STEPS : 1;

    for (let step = 0; step < steps; step += 1) {
      const startT = step / steps;
      const endT = (step + 1) / steps;
      const sampleStart = segmentPoint(start, end, startT);
      const sampleEnd = segmentPoint(start, end, endT);
      const projection = projectPointOnLine(target, sampleStart, sampleEnd);
      const t = startT + (endT - startT) * projection.t;

      if (!nearest || projection.distanceMm < nearest.distanceMm) {
        nearest = {
          startPointId: start.id,
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
  const startIndex = piece.points.findIndex(
    (point) => point.id === startPointId,
  );
  if (startIndex < 0) return null;

  const endIndex = (startIndex + 1) % piece.points.length;
  const points = piece.points.map(clonePoint);
  const start = points[startIndex];
  const end = points[endIndex];
  const t = Math.min(0.95, Math.max(0.05, rawT));
  const pointId = nextInsertedPointId(piece);
  const inserted = splitSegment(start, end, pointId, t);

  points[startIndex] = inserted.start;
  points[endIndex] = inserted.end;
  points.splice(startIndex + 1, 0, inserted.point);

  return {
    piece: { ...piece, points },
    pointId,
  };
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
  return { ...piece, points };
}

function splitSegment(
  sourceStart: PatternPoint,
  sourceEnd: PatternPoint,
  pointId: string,
  t: number,
): { start: PatternPoint; point: PatternPoint; end: PatternPoint } {
  const start = clonePoint(sourceStart);
  const end = clonePoint(sourceEnd);
  if (!start.handleOut && !end.handleIn) {
    return {
      start,
      point: {
        id: pointId,
        xMm: roundMm(lerp(start.xMm, end.xMm, t)),
        yMm: roundMm(lerp(start.yMm, end.yMm, t)),
      },
      end,
    };
  }

  const p0 = { xMm: start.xMm, yMm: start.yMm };
  const p1 = {
    xMm: start.xMm + (start.handleOut?.xMm ?? 0),
    yMm: start.yMm + (start.handleOut?.yMm ?? 0),
  };
  const p2 = {
    xMm: end.xMm + (end.handleIn?.xMm ?? 0),
    yMm: end.yMm + (end.handleIn?.yMm ?? 0),
  };
  const p3 = { xMm: end.xMm, yMm: end.yMm };
  const a = lerpPoint(p0, p1, t);
  const b = lerpPoint(p1, p2, t);
  const c = lerpPoint(p2, p3, t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  const split = lerpPoint(d, e, t);

  start.handleOut = vectorBetween(p0, a);
  end.handleIn = vectorBetween(p3, c);
  return {
    start,
    point: {
      id: pointId,
      xMm: roundMm(split.xMm),
      yMm: roundMm(split.yMm),
      handleIn: vectorBetween(split, d),
      handleOut: vectorBetween(split, e),
    },
    end,
  };
}

function segmentPoint(
  start: PatternPoint,
  end: PatternPoint,
  t: number,
): { xMm: number; yMm: number } {
  if (!start.handleOut && !end.handleIn) {
    return {
      xMm: lerp(start.xMm, end.xMm, t),
      yMm: lerp(start.yMm, end.yMm, t),
    };
  }
  const oneMinusT = 1 - t;
  const control1X = start.xMm + (start.handleOut?.xMm ?? 0);
  const control1Y = start.yMm + (start.handleOut?.yMm ?? 0);
  const control2X = end.xMm + (end.handleIn?.xMm ?? 0);
  const control2Y = end.yMm + (end.handleIn?.yMm ?? 0);
  return {
    xMm:
      oneMinusT ** 3 * start.xMm +
      3 * oneMinusT ** 2 * t * control1X +
      3 * oneMinusT * t ** 2 * control2X +
      t ** 3 * end.xMm,
    yMm:
      oneMinusT ** 3 * start.yMm +
      3 * oneMinusT ** 2 * t * control1Y +
      3 * oneMinusT * t ** 2 * control2Y +
      t ** 3 * end.yMm,
  };
}

function projectPointOnLine(
  target: { xMm: number; yMm: number },
  start: { xMm: number; yMm: number },
  end: { xMm: number; yMm: number },
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
  const t = Math.min(1, Math.max(0, rawT));
  const xMm = lerp(start.xMm, end.xMm, t);
  const yMm = lerp(start.yMm, end.yMm, t);
  return {
    t,
    distanceMm: Math.hypot(target.xMm - xMm, target.yMm - yMm),
  };
}

function nextInsertedPointId(piece: PatternPiece): string {
  const existing = new Set(piece.points.map((point) => point.id));
  let sequence = 1;
  while (existing.has(`${piece.id}:insert-${sequence}`)) sequence += 1;
  return `${piece.id}:insert-${sequence}`;
}

function clonePoint(point: PatternPoint): PatternPoint {
  return {
    ...point,
    ...(point.handleIn ? { handleIn: { ...point.handleIn } } : {}),
    ...(point.handleOut ? { handleOut: { ...point.handleOut } } : {}),
  };
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function lerpPoint(
  start: { xMm: number; yMm: number },
  end: { xMm: number; yMm: number },
  t: number,
) {
  return {
    xMm: lerp(start.xMm, end.xMm, t),
    yMm: lerp(start.yMm, end.yMm, t),
  };
}

function vectorBetween(
  start: { xMm: number; yMm: number },
  end: { xMm: number; yMm: number },
) {
  return {
    xMm: roundMm(end.xMm - start.xMm),
    yMm: roundMm(end.yMm - start.yMm),
  };
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
