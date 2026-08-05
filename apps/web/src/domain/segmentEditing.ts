import {
  createDocumentId,
  migrateLegacyPieceToSegments,
  syncLegacyPointsFromSegments,
  type PatternPiece,
  type PatternVector,
} from "./pattern";
import { splitPatternSegmentAt } from "./patternEditing";

export function movePatternNode(
  piece: PatternPiece,
  nodeId: string,
  next: PatternVector,
): PatternPiece {
  const model = migrateLegacyPieceToSegments(structuredClone(piece));
  const node = model.nodes?.find((candidate) => candidate.id === nodeId);
  if (!node) return piece;
  const dx = next.xMm - node.xMm;
  const dy = next.yMm - node.yMm;
  node.xMm = next.xMm;
  node.yMm = next.yMm;
  for (const segment of model.segments ?? []) {
    if (segment.startNodeId === nodeId && segment.control1) {
      segment.control1 = translate(segment.control1, dx, dy);
    }
    if (segment.endNodeId === nodeId && segment.control2) {
      segment.control2 = translate(segment.control2, dx, dy);
    }
  }
  return syncLegacyPointsFromSegments(model);
}

export function movePatternSegment(
  piece: PatternPiece,
  segmentId: string,
  dxMm: number,
  dyMm: number,
): PatternPiece {
  const model = migrateLegacyPieceToSegments(structuredClone(piece));
  const segment = model.segments?.find(
    (candidate) => candidate.id === segmentId,
  );
  if (!segment) return piece;
  const ids = new Set([segment.startNodeId, segment.endNodeId]);
  model.nodes = model.nodes?.map((node) =>
    ids.has(node.id)
      ? { ...node, xMm: node.xMm + dxMm, yMm: node.yMm + dyMm }
      : node,
  );
  for (const candidate of model.segments ?? []) {
    if (candidate.startNodeId === segment.startNodeId && candidate.control1) {
      candidate.control1 = translate(candidate.control1, dxMm, dyMm);
    }
    if (candidate.endNodeId === segment.startNodeId && candidate.control2) {
      candidate.control2 = translate(candidate.control2, dxMm, dyMm);
    }
    if (candidate.startNodeId === segment.endNodeId && candidate.control1) {
      candidate.control1 = translate(candidate.control1, dxMm, dyMm);
    }
    if (candidate.endNodeId === segment.endNodeId && candidate.control2) {
      candidate.control2 = translate(candidate.control2, dxMm, dyMm);
    }
  }
  return syncLegacyPointsFromSegments(model);
}

export function convertPatternSegment(
  piece: PatternPiece,
  segmentId: string,
  kind: "line" | "cubic",
): PatternPiece {
  const model = migrateLegacyPieceToSegments(structuredClone(piece));
  const segment = model.segments?.find(
    (candidate) => candidate.id === segmentId,
  );
  if (!segment) return piece;
  const start = model.nodes?.find(
    (node) => node.id === segment.startNodeId,
  );
  const end = model.nodes?.find((node) => node.id === segment.endNodeId);
  if (!start || !end) return piece;
  if (kind === "line") {
    segment.kind = "line";
    delete segment.control1;
    delete segment.control2;
  } else {
    segment.kind = "cubic";
    segment.control1 = interpolate(start, end, 1 / 3);
    segment.control2 = interpolate(start, end, 2 / 3);
  }
  return syncLegacyPointsFromSegments(model);
}

export function splitPatternSegment(
  piece: PatternPiece,
  segmentId: string,
  t = 0.5,
): PatternPiece {
  return splitPatternSegmentAt(piece, segmentId, t)?.piece ?? piece;
}

export function setSegmentSmooth(
  piece: PatternPiece,
  segmentId: string,
  smooth: boolean,
): PatternPiece {
  const model = migrateLegacyPieceToSegments(structuredClone(piece));
  const segment = model.segments?.find(
    (candidate) => candidate.id === segmentId,
  );
  if (!segment) return piece;
  segment.smoothStart = smooth;
  segment.smoothEnd = smooth;
  return model;
}

export function createStableInsertedNodeId(pieceId: string): string {
  return createDocumentId(`${pieceId}:node`);
}

function translate(
  point: PatternVector,
  dxMm: number,
  dyMm: number,
): PatternVector {
  return { xMm: point.xMm + dxMm, yMm: point.yMm + dyMm };
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
