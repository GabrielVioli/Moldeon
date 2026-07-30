import { z } from "zod";

export const PatternPointSchema = z.object({
  id: z.string(),
  xMm: z.number(),
  yMm: z.number(),
});

export const PatternPieceSchema = z.object({
  id: z.string(),
  name: z.string(),
  seamAllowanceMm: z.number().nonnegative(),
  points: z.array(PatternPointSchema).min(3),
});

export const PatternSnapshotSchema = z.object({
  piece: PatternPieceSchema,
  areaMm2: z.number().nonnegative(),
  perimeterMm: z.number().nonnegative(),
  issues: z.array(z.string()),
});

export type PatternPoint = z.infer<typeof PatternPointSchema>;
export type PatternPiece = z.infer<typeof PatternPieceSchema>;
export type PatternSnapshot = z.infer<typeof PatternSnapshotSchema>;

export interface PatternEngineFacade {
  readonly backend: "wasm" | "typescript";
  snapshot(): PatternSnapshot;
  movePoint(pointId: string, xMm: number, yMm: number): PatternSnapshot;
  setSeamAllowance(valueMm: number): PatternSnapshot;
  reset(): PatternSnapshot;
}

export function distanceMm(a: PatternPoint, b: PatternPoint): number {
  return Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
}

export function polygonAreaMm2(points: PatternPoint[]): number {
  let twiceArea = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.xMm * next.yMm - next.xMm * current.yMm;
  }

  return Math.abs(twiceArea) / 2;
}

export function polygonPerimeterMm(points: PatternPoint[]): number {
  return points.reduce((total, current, index) => {
    const next = points[(index + 1) % points.length];
    return total + distanceMm(current, next);
  }, 0);
}
