import {
  getPatternEdges,
  sampleEdgeRange,
  type EdgeRange,
  type GarmentDraft,
  type PatternPiece,
  type PatternVector,
  type PieceWorkspaceTransform,
  type Seam,
} from "../domain/pattern";
import { findNearestPatternSegment } from "../domain/patternEditing";
import { pieceLocalToWorld, pieceWorldToLocal } from "./coordinates";

export interface EdgeHit {
  range: EdgeRange;
  distanceMm: number;
  t: number;
}

export interface SeamHit {
  seam: Seam;
  side: "first" | "second";
  distanceMm: number;
}

export function findNearestEdgeHit(
  garment: GarmentDraft,
  world: PatternVector,
  maxDistanceMm: number,
): EdgeHit | null {
  let nearest: EdgeHit | null = null;
  for (const piece of garment.pieces) {
    if (!workspaceStateFor(garment, piece.id).visible) continue;
    const local = pieceWorldToLocal(world, workspaceTransformFor(garment, piece.id));
    const target = findNearestPatternSegment(piece, local);
    if (!target || target.distanceMm > maxDistanceMm) continue;
    const edge = getPatternEdges(piece).find(
      (candidate) => candidate.id === target.segmentId,
    );
    if (!edge) continue;
    const hit: EdgeHit = {
      range: {
        pieceId: piece.id,
        edgeId: edge.id,
        startT: 0,
        endT: 1,
      },
      distanceMm: target.distanceMm,
      t: target.t,
    };
    if (!nearest || hit.distanceMm < nearest.distanceMm) nearest = hit;
  }
  return nearest;
}

export function findNearestSeamHit(
  garment: GarmentDraft,
  world: PatternVector,
  maxDistanceMm: number,
): SeamHit | null {
  let nearest: SeamHit | null = null;
  for (const seam of garment.seams ?? []) {
    for (const side of ["first", "second"] as const) {
      const range = seam[side];
      const piece = garment.pieces.find(
        (candidate) => candidate.id === range.pieceId,
      );
      if (!piece || !workspaceStateFor(garment, piece.id).visible) continue;
      const distanceMm = distanceToRange(
        piece,
        range,
        workspaceTransformFor(garment, piece.id),
        world,
      );
      if (distanceMm > maxDistanceMm) continue;
      if (!nearest || distanceMm < nearest.distanceMm) {
        nearest = { seam, side, distanceMm };
      }
    }
  }
  return nearest;
}

export function pointInsidePiece(
  piece: PatternPiece,
  local: PatternVector,
): boolean {
  const points = piece.points;
  if (points.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const intersects =
      currentPoint.yMm > local.yMm !== previousPoint.yMm > local.yMm &&
      local.xMm <
        ((previousPoint.xMm - currentPoint.xMm) *
          (local.yMm - currentPoint.yMm)) /
          (previousPoint.yMm - currentPoint.yMm) +
          currentPoint.xMm;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToRange(
  piece: PatternPiece,
  range: EdgeRange,
  transform: PieceWorkspaceTransform,
  world: PatternVector,
): number {
  const samples = sampleEdgeRange(piece, range).map((point) =>
    pieceLocalToWorld(point, transform),
  );
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < samples.length; index += 1) {
    nearest = Math.min(
      nearest,
      distanceToLine(world, samples[index - 1], samples[index]),
    );
  }
  return nearest;
}

function distanceToLine(
  point: PatternVector,
  start: PatternVector,
  end: PatternVector,
): number {
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const lengthSquared = dx * dx + dy * dy;
  const rawT =
    lengthSquared === 0
      ? 0
      : ((point.xMm - start.xMm) * dx +
          (point.yMm - start.yMm) * dy) /
        lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  return Math.hypot(
    point.xMm - (start.xMm + dx * t),
    point.yMm - (start.yMm + dy * t),
  );
}

function workspaceTransformFor(
  garment: GarmentDraft,
  pieceId: string,
): PieceWorkspaceTransform {
  return workspaceStateFor(garment, pieceId).transform;
}

function workspaceStateFor(garment: GarmentDraft, pieceId: string) {
  return (
    garment.workspaceStates?.find((state) => state.pieceId === pieceId) ?? {
      pieceId,
      transform:
        garment.workspaceTransforms?.find(
          (transform) => transform.pieceId === pieceId,
        ) ?? { pieceId, xMm: 0, yMm: 0, rotationDeg: 0 },
      visible: true,
      locked: false,
    }
  );
}
