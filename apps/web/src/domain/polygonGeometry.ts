import type { PatternPoint } from "./pattern";

const GEOMETRY_EPSILON = 1e-8;
const CUBIC_SAMPLE_SPACING_MM = 18;
const MAX_CUBIC_STEPS = 24;

export interface TriangulatedPatternContour {
  ok: true;
  indices: number[];
  signedAreaMm2: number;
}

export interface InvalidPatternContour {
  ok: false;
  issues: string[];
}

export type PatternContourResult =
  | TriangulatedPatternContour
  | InvalidPatternContour;

export function segmentIsCurve(
  start: PatternPoint,
  end: PatternPoint,
): boolean {
  return start.handleOut !== undefined || end.handleIn !== undefined;
}

export function samplePatternContour(
  points: readonly PatternPoint[],
): PatternPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));

  const sampled: PatternPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const segment = samplePatternSegment(current, next);
    sampled.push(...segment.slice(0, -1));
  }
  return sampled;
}

export function samplePatternSegment(
  start: PatternPoint,
  end: PatternPoint,
): PatternPoint[] {
  if (!segmentIsCurve(start, end)) {
    return [{ ...start }, { ...end }];
  }

  const control1 = absoluteHandle(start, start.handleOut);
  const control2 = absoluteHandle(end, end.handleIn);
  if (isStraightCubic(start, control1, control2, end)) {
    return [{ ...start }, { ...end }];
  }

  const controlLength =
    distanceBetween(start, control1) +
    distanceBetween(control1, control2) +
    distanceBetween(control2, end);
  const steps = Math.min(
    MAX_CUBIC_STEPS,
    Math.max(4, Math.ceil(controlLength / CUBIC_SAMPLE_SPACING_MM)),
  );
  const sampled: PatternPoint[] = [{ ...start }];

  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const inverse = 1 - t;
    sampled.push({
      id: `${start.id}::${end.id}::${step}`,
      xMm:
        inverse ** 3 * start.xMm +
        3 * inverse ** 2 * t * control1.xMm +
        3 * inverse * t ** 2 * control2.xMm +
        t ** 3 * end.xMm,
      yMm:
        inverse ** 3 * start.yMm +
        3 * inverse ** 2 * t * control1.yMm +
        3 * inverse * t ** 2 * control2.yMm +
        t ** 3 * end.yMm,
    });
  }

  sampled.push({ ...end });
  return sampled;
}

export function createSeamAllowanceContour(
  points: readonly PatternPoint[],
  allowanceMm: number,
): PatternPoint[] | null {
  if (
    !Number.isFinite(allowanceMm) ||
    allowanceMm < 0 ||
    validatePatternContour(points).length > 0
  ) {
    return null;
  }

  if (allowanceMm <= GEOMETRY_EPSILON) {
    return points.map((point) => ({ ...point, id: `seam-${point.id}` }));
  }

  const orientation = polygonSignedAreaMm2(points) > 0 ? 1 : -1;
  const miterLimit = allowanceMm * 4;

  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const incoming = unitDirection(previous, point);
    const outgoing = unitDirection(point, next);
    const incomingNormal = outwardNormal(incoming, orientation);
    const outgoingNormal = outwardNormal(outgoing, orientation);
    const firstShifted = {
      x: point.xMm + incomingNormal.x * allowanceMm,
      y: point.yMm + incomingNormal.y * allowanceMm,
    };
    const secondShifted = {
      x: point.xMm + outgoingNormal.x * allowanceMm,
      y: point.yMm + outgoingNormal.y * allowanceMm,
    };
    const denominator = vectorCross(incoming, outgoing);

    let xMm: number;
    let yMm: number;

    if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
      const combined = normalizeVector({
        x: incomingNormal.x + outgoingNormal.x,
        y: incomingNormal.y + outgoingNormal.y,
      });
      xMm = point.xMm + combined.x * allowanceMm;
      yMm = point.yMm + combined.y * allowanceMm;
    } else {
      const betweenShifted = {
        x: secondShifted.x - firstShifted.x,
        y: secondShifted.y - firstShifted.y,
      };
      const alongIncoming =
        vectorCross(betweenShifted, outgoing) / denominator;
      xMm = firstShifted.x + incoming.x * alongIncoming;
      yMm = firstShifted.y + incoming.y * alongIncoming;
    }

    const offsetX = xMm - point.xMm;
    const offsetY = yMm - point.yMm;
    const miterLength = Math.hypot(offsetX, offsetY);
    if (miterLength > miterLimit) {
      const scale = miterLimit / miterLength;
      xMm = point.xMm + offsetX * scale;
      yMm = point.yMm + offsetY * scale;
    }

    return { id: `seam-${point.id}`, xMm, yMm };
  });
}

export function triangulatePatternContour(
  points: readonly PatternPoint[],
): PatternContourResult {
  const issues = validatePatternContour(points);
  if (issues.length > 0) return { ok: false, issues };

  const signedAreaMm2 = polygonSignedAreaMm2(points);
  const remaining = points.map((_, index) => index);
  if (signedAreaMm2 < 0) remaining.reverse();

  const indices: number[] = [];
  let attemptsRemaining = points.length * points.length;

  while (remaining.length > 3 && attemptsRemaining > 0) {
    let earFound = false;

    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const current = remaining[cursor];
      const next = remaining[(cursor + 1) % remaining.length];
      const a = points[previous];
      const b = points[current];
      const c = points[next];

      if (cross(a, b, c) <= GEOMETRY_EPSILON) continue;
      if (
        remaining.some(
          (candidate) =>
            candidate !== previous &&
            candidate !== current &&
            candidate !== next &&
            pointInsideTriangle(points[candidate], a, b, c),
        )
      ) {
        continue;
      }

      indices.push(previous, current, next);
      remaining.splice(cursor, 1);
      earFound = true;
      break;
    }

    if (earFound) {
      attemptsRemaining -= 1;
      continue;
    }

    const collinearCursor = remaining.findIndex((current, cursor) => {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const next = remaining[(cursor + 1) % remaining.length];
      return Math.abs(cross(points[previous], points[current], points[next])) <= GEOMETRY_EPSILON;
    });

    if (collinearCursor < 0) {
      return {
        ok: false,
        issues: ["Não foi possível triangular o contorno atual."],
      };
    }

    remaining.splice(collinearCursor, 1);
    attemptsRemaining -= 1;
  }

  if (remaining.length !== 3) {
    return {
      ok: false,
      issues: ["Não foi possível triangular o contorno atual."],
    };
  }

  indices.push(remaining[0], remaining[1], remaining[2]);
  return { ok: true, indices, signedAreaMm2 };
}

export function validatePatternContour(
  points: readonly PatternPoint[],
): string[] {
  const issues: string[] = [];

  if (points.length < 3) {
    return ["O contorno precisa ter pelo menos três pontos."];
  }

  if (
    points.some(
      (point) =>
        !Number.isFinite(point.xMm) ||
        !Number.isFinite(point.yMm),
    )
  ) {
    issues.push("Existe um ponto com coordenada inválida.");
    return issues;
  }

  if (new Set(points.map((point) => point.id)).size !== points.length) {
    issues.push("Existem pontos com identificadores duplicados.");
  }

  if (hasDuplicateCoordinates(points)) {
    issues.push("Existem pontos sobrepostos no contorno.");
  }

  if (Math.abs(polygonSignedAreaMm2(points)) <= GEOMETRY_EPSILON) {
    issues.push("O contorno não possui área suficiente.");
  }

  if (hasSelfIntersection(points)) {
    issues.push("O contorno possui uma autointerseção.");
  }

  return issues;
}

export function polygonSignedAreaMm2(
  points: readonly PatternPoint[],
): number {
  let twiceArea = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.xMm * next.yMm - next.xMm * current.yMm;
  }

  return twiceArea / 2;
}

function hasDuplicateCoordinates(points: readonly PatternPoint[]): boolean {
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (
        Math.abs(points[left].xMm - points[right].xMm) <= GEOMETRY_EPSILON &&
        Math.abs(points[left].yMm - points[right].yMm) <= GEOMETRY_EPSILON
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasSelfIntersection(points: readonly PatternPoint[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;

    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      const adjacent =
        first === second ||
        firstNext === second ||
        secondNext === first;

      if (adjacent) continue;
      if (
        segmentsIntersect(
          points[first],
          points[firstNext],
          points[second],
          points[secondNext],
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function segmentsIntersect(
  a: PatternPoint,
  b: PatternPoint,
  c: PatternPoint,
  d: PatternPoint,
): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (
    ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) ||
      (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) &&
    ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) ||
      (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))
  ) {
    return true;
  }

  return (
    (Math.abs(abC) <= GEOMETRY_EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) <= GEOMETRY_EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) <= GEOMETRY_EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) <= GEOMETRY_EPSILON && pointOnSegment(b, c, d))
  );
}

function pointOnSegment(
  point: PatternPoint,
  start: PatternPoint,
  end: PatternPoint,
): boolean {
  return (
    point.xMm >= Math.min(start.xMm, end.xMm) - GEOMETRY_EPSILON &&
    point.xMm <= Math.max(start.xMm, end.xMm) + GEOMETRY_EPSILON &&
    point.yMm >= Math.min(start.yMm, end.yMm) - GEOMETRY_EPSILON &&
    point.yMm <= Math.max(start.yMm, end.yMm) + GEOMETRY_EPSILON
  );
}

function pointInsideTriangle(
  point: PatternPoint,
  a: PatternPoint,
  b: PatternPoint,
  c: PatternPoint,
): boolean {
  return (
    cross(a, b, point) >= -GEOMETRY_EPSILON &&
    cross(b, c, point) >= -GEOMETRY_EPSILON &&
    cross(c, a, point) >= -GEOMETRY_EPSILON
  );
}

function cross(
  a: PatternPoint,
  b: PatternPoint,
  c: PatternPoint,
): number {
  return (
    (b.xMm - a.xMm) * (c.yMm - a.yMm) -
    (b.yMm - a.yMm) * (c.xMm - a.xMm)
  );
}

interface Vector2 {
  x: number;
  y: number;
}

function unitDirection(start: PatternPoint, end: PatternPoint): Vector2 {
  return normalizeVector({
    x: end.xMm - start.xMm,
    y: end.yMm - start.yMm,
  });
}

function normalizeVector(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= GEOMETRY_EPSILON) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function outwardNormal(direction: Vector2, orientation: 1 | -1): Vector2 {
  return orientation === 1
    ? { x: direction.y, y: -direction.x }
    : { x: -direction.y, y: direction.x };
}

function vectorCross(left: Vector2, right: Vector2): number {
  return left.x * right.y - left.y * right.x;
}

function absoluteHandle(
  point: PatternPoint,
  handle: PatternPoint["handleIn"] | PatternPoint["handleOut"],
): PatternPoint {
  return {
    id: `${point.id}-handle`,
    xMm: point.xMm + (handle?.xMm ?? 0),
    yMm: point.yMm + (handle?.yMm ?? 0),
  };
}

function distanceBetween(left: PatternPoint, right: PatternPoint): number {
  return Math.hypot(right.xMm - left.xMm, right.yMm - left.yMm);
}

function isStraightCubic(
  start: PatternPoint,
  control1: PatternPoint,
  control2: PatternPoint,
  end: PatternPoint,
): boolean {
  const chordX = end.xMm - start.xMm;
  const chordY = end.yMm - start.yMm;
  const chordSquared = chordX * chordX + chordY * chordY;
  if (chordSquared <= GEOMETRY_EPSILON) return false;

  return [control1, control2].every((control) => {
    const relativeX = control.xMm - start.xMm;
    const relativeY = control.yMm - start.yMm;
    const distanceNumerator = Math.abs(
      chordX * relativeY - chordY * relativeX,
    );
    const projection = relativeX * chordX + relativeY * chordY;
    return (
      distanceNumerator / Math.sqrt(chordSquared) <= 0.01 &&
      projection >= 0 &&
      projection <= chordSquared
    );
  });
}
