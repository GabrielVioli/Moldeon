import type { PatternPoint } from "./pattern";

const GEOMETRY_EPSILON = 1e-8;

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
