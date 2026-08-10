import {
  getEdgeById,
  type InternalPath,
  type InternalPathNode,
  type PatternPiece,
  type PatternPoint,
  type PatternVector,
} from "../domain/pattern";

export type CurveHandleKind = "in" | "out";

export interface PatternCurveHandleTarget {
  point: PatternPoint;
  pointId: string;
  handle: CurveHandleKind;
}

export interface InternalCurveHandleTarget {
  node: InternalPathNode;
  nodeId: string;
  handle: CurveHandleKind;
}

export function curveHandleHitRadiusPx(pointerType?: string): number {
  return pointerType === "touch" ? 22 : 13;
}

export function patternCurveHandleTargets(
  piece: PatternPiece,
  selectedPointId: string | null,
  selectedEdgeId: string | null,
): PatternCurveHandleTarget[] {
  const selectedPoint = selectedPointId
    ? piece.points.find((point) => point.id === selectedPointId)
    : undefined;
  if (selectedPoint) {
    return existingPatternHandles(selectedPoint, ["in", "out"]);
  }

  if (!selectedEdgeId) return [];
  const edge = getEdgeById(piece, selectedEdgeId);
  if (!edge) return [];
  const start = piece.points.find((point) => point.id === edge.startPointId);
  const end = piece.points.find((point) => point.id === edge.endPointId);
  return [
    ...(start ? existingPatternHandles(start, ["out"]) : []),
    ...(end ? existingPatternHandles(end, ["in"]) : []),
  ];
}

export function internalCurveHandleTargets(
  path: InternalPath,
  selectedNodeId: string | null,
  selectedSegmentId: string | null,
): InternalCurveHandleTarget[] {
  const selectedNode = selectedNodeId
    ? path.nodes.find((node) => node.id === selectedNodeId)
    : undefined;
  if (selectedNode) {
    return existingInternalHandles(selectedNode, ["in", "out"]);
  }

  if (!selectedSegmentId) return [];
  const segment = path.segments.find((candidate) => candidate.id === selectedSegmentId);
  if (!segment || segment.kind !== "cubic") return [];
  const start = path.nodes.find((node) => node.id === segment.startNodeId);
  const end = path.nodes.find((node) => node.id === segment.endNodeId);
  return [
    ...(start ? existingInternalHandles(start, ["out"]) : []),
    ...(end ? existingInternalHandles(end, ["in"]) : []),
  ];
}

export function findNearestPatternCurveHandle(
  piece: PatternPiece,
  selectedPointId: string | null,
  selectedEdgeId: string | null,
  local: PatternVector,
  maxDistanceMm: number,
): PatternCurveHandleTarget | null {
  return nearestTarget(
    patternCurveHandleTargets(piece, selectedPointId, selectedEdgeId),
    local,
    maxDistanceMm,
    (target) => target.point,
  );
}

export function findNearestInternalCurveHandle(
  path: InternalPath,
  selectedNodeId: string | null,
  selectedSegmentId: string | null,
  local: PatternVector,
  maxDistanceMm: number,
): InternalCurveHandleTarget | null {
  return nearestTarget(
    internalCurveHandleTargets(path, selectedNodeId, selectedSegmentId),
    local,
    maxDistanceMm,
    (target) => target.node,
  );
}

export function curveHandleEndpoint(
  anchor: PatternPoint,
  handle: CurveHandleKind,
): PatternVector | null {
  const vector = handle === "in" ? anchor.handleIn : anchor.handleOut;
  return vector
    ? { xMm: anchor.xMm + vector.xMm, yMm: anchor.yMm + vector.yMm }
    : null;
}

export function curveHandleGrabOffset(
  anchor: PatternPoint,
  handle: CurveHandleKind,
  pointerLocal: PatternVector,
): PatternVector {
  const endpoint = curveHandleEndpoint(anchor, handle);
  return endpoint
    ? { xMm: endpoint.xMm - pointerLocal.xMm, yMm: endpoint.yMm - pointerLocal.yMm }
    : { xMm: 0, yMm: 0 };
}

function existingPatternHandles(
  point: PatternPoint,
  handles: readonly CurveHandleKind[],
): PatternCurveHandleTarget[] {
  return handles
    .filter((handle) => Boolean(handle === "in" ? point.handleIn : point.handleOut))
    .map((handle) => ({ point, pointId: point.id, handle }));
}

function existingInternalHandles(
  node: InternalPathNode,
  handles: readonly CurveHandleKind[],
): InternalCurveHandleTarget[] {
  return handles
    .filter((handle) => Boolean(handle === "in" ? node.handleIn : node.handleOut))
    .map((handle) => ({ node, nodeId: node.id, handle }));
}

function nearestTarget<T extends { handle: CurveHandleKind }>(
  targets: readonly T[],
  local: PatternVector,
  maxDistanceMm: number,
  anchorFor: (target: T) => PatternPoint,
): T | null {
  let best: { target: T; distanceMm: number } | null = null;
  for (const target of targets) {
    const endpoint = curveHandleEndpoint(anchorFor(target), target.handle);
    if (!endpoint) continue;
    const distanceMm = Math.hypot(endpoint.xMm - local.xMm, endpoint.yMm - local.yMm);
    if (distanceMm <= maxDistanceMm && (!best || distanceMm < best.distanceMm)) {
      best = { target, distanceMm };
    }
  }
  return best?.target ?? null;
}
