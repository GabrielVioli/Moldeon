import {
  createDocumentId,
  createUnclassifiedBodyPlacement,
  migrateLegacyPieceToSegments,
  seamSideRanges,
  syncLegacyPointsFromSegments,
  type EdgeRange,
  type GarmentDraft,
  type InternalPath,
  type InternalPathDiagnostic,
  type InternalPathIntersection,
  type InternalPathNode,
  type InternalPathPurpose,
  type InternalPathSegment,
  type PatternDart,
  type PatternPiece,
  type PatternPoint,
  type PatternSegment,
  type PatternVector,
  type PieceWorkspaceState,
  type Seam,
} from "./pattern";
import {
  remapSeamsAfterSegmentSplit,
  splitPatternSegmentAt,
} from "./patternEditing";
import {
  samplePatternContour,
  samplePatternSegment,
} from "./polygonGeometry";

const INTERSECTION_EPSILON_MM = 0.08;
const MIN_REGION_AREA_MM2 = 4;
const TANGENCY_SINE = 0.035;
const PATH_CURVE_STEPS = 32;
const CONTOUR_CURVE_STEPS = 48;
const PATH_LINE_SAMPLE_SPACING_MM = 18;
const DART_SNAP_THRESHOLD_MM = 18;
const STRUCTURAL_EPSILON_MM = 1e-6;

export interface NormalizedDartGeometry {
  path: InternalPath;
  apex: InternalPathNode;
  legA: InternalPathNode;
  legB: InternalPathNode;
  center: InternalPathNode;
  widthMm: number;
  lengthMm: number;
}

export interface DartGeometryNormalization {
  valid: boolean;
  geometry?: NormalizedDartGeometry;
  diagnostics: InternalPathDiagnostic[];
}

export interface InternalPathAnalysis {
  valid: boolean;
  operation: "cut" | "dart" | "annotation";
  diagnostics: InternalPathDiagnostic[];
  intersections: InternalPathIntersection[];
  affectedSeamIds: string[];
  regionAreasMm2: number[];
}

export interface InternalPathOperationResult {
  ok: boolean;
  garment: GarmentDraft;
  activePieceId: string;
  diagnostics: InternalPathDiagnostic[];
  createdPieceIds: string[];
  createdSeamGroupId?: string;
}

interface SampledPathPoint extends PatternVector {
  segmentId: string;
  segmentT: number;
  distanceMm: number;
}

interface SampledContourPoint extends PatternVector {
  edgeId: string;
  edgeT: number;
  distanceMm: number;
}

interface MutableIntersection extends InternalPathIntersection {
  pathDistanceMm: number;
  nodeId?: string;
}

interface GeometrySegment {
  sourceEdgeId?: string;
  cutIndex?: number;
  kind: "line" | "cubic";
  role: PatternSegment["role"];
  start: PatternVector;
  end: PatternVector;
  control1?: PatternVector;
  control2?: PatternVector;
}

interface BuiltPiece {
  piece: PatternPiece;
  sourceEdgeMap: Map<string, string>;
  cutEdgeIds: string[];
}

export function createInternalPath(
  pieceId: string,
  purpose: InternalPathPurpose,
  points: readonly PatternVector[],
  options: { name?: string; curved?: boolean } = {},
): InternalPath {
  if (points.length < 2) {
    throw new TypeError("Um caminho interno precisa de pelo menos dois nós.");
  }
  const id = createDocumentId("internal-path");
  const nodes: InternalPathNode[] = points.map((point, index) => ({
    id: `${id}:node:${index + 1}`,
    xMm: round(point.xMm),
    yMm: round(point.yMm),
  }));
  const segments: InternalPathSegment[] = nodes.slice(0, -1).map((node, index) => ({
    id: `${id}:segment:${index + 1}`,
    startNodeId: node.id,
    endNodeId: nodes[index + 1].id,
    kind: options.curved ? "cubic" : "line",
  }));
  const path: InternalPath = {
    id,
    pieceId,
    name: options.name ?? defaultPathName(purpose),
    nodes,
    segments,
    purpose,
    visible: true,
    locked: false,
    metadata: {
      geometryVersion: 1,
      snapEnabled: true,
    },
  };
  return options.curved
    ? segments.reduce(
        (current, segment) => setInternalPathSegmentKind(current, segment.id, "cubic"),
        path,
      )
    : path;
}

export function normalizeInternalPath(
  raw: InternalPath | {
    id: string;
    pieceId: string;
    points: PatternPoint[];
    curved: boolean;
    purpose: string;
  },
): InternalPath {
  if ("nodes" in raw && Array.isArray(raw.nodes) && "segments" in raw && Array.isArray(raw.segments)) {
    return structuredClone(raw as InternalPath);
  }
  const legacy = raw as { id: string; pieceId: string; points: PatternPoint[]; curved: boolean; purpose: string };
  const purpose = legacyPurpose(legacy.purpose);
  const converted = createInternalPath(legacy.pieceId, purpose, legacy.points, {
    name: defaultPathName(purpose),
    curved: legacy.curved,
  });
  return { ...converted, id: legacy.id, nodes: converted.nodes.map((node, index) => ({ ...node, id: `${legacy.id}:node:${index + 1}` })), segments: converted.segments.map((segment, index) => ({ ...segment, id: `${legacy.id}:segment:${index + 1}`, startNodeId: `${legacy.id}:node:${index + 1}`, endNodeId: `${legacy.id}:node:${index + 2}` })) };
}

export function appendInternalPathNode(
  pathValue: InternalPath,
  point: PatternVector,
): InternalPath {
  const path = structuredClone(pathValue);
  if (path.locked) return path;
  const previous = path.nodes.at(-1);
  const node: InternalPathNode = {
    id: `${path.id}:node:${path.nodes.length + 1}:${createDocumentId("n")}`,
    xMm: round(point.xMm),
    yMm: round(point.yMm),
  };
  path.nodes.push(node);
  if (previous) {
    path.segments.push({
      id: `${path.id}:segment:${path.segments.length + 1}:${createDocumentId("s")}`,
      startNodeId: previous.id,
      endNodeId: node.id,
      kind: "line",
    });
  }
  return path;
}

export function removeLastInternalPathNode(pathValue: InternalPath): InternalPath {
  const path = structuredClone(pathValue);
  if (path.locked || path.nodes.length === 0) return path;
  const removed = path.nodes.pop();
  if (removed) {
    path.segments = path.segments.filter(
      (segment) => segment.startNodeId !== removed.id && segment.endNodeId !== removed.id,
    );
  }
  return path;
}

export function moveInternalPathNode(
  pathValue: InternalPath,
  nodeId: string,
  next: PatternVector,
): InternalPath {
  if (pathValue.locked) return pathValue;
  return {
    ...pathValue,
    nodes: pathValue.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, xMm: round(next.xMm), yMm: round(next.yMm) }
        : node,
    ),
  };
}

export function moveInternalPathHandle(
  pathValue: InternalPath,
  nodeId: string,
  handle: "in" | "out",
  vector: PatternVector,
): InternalPath {
  if (pathValue.locked) return pathValue;
  const property = handle === "in" ? "handleIn" : "handleOut";
  return {
    ...pathValue,
    nodes: pathValue.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, [property]: { xMm: round(vector.xMm), yMm: round(vector.yMm) } }
        : node,
    ),
  };
}

export function setInternalPathSegmentKind(
  pathValue: InternalPath,
  segmentId: string,
  kind: "line" | "cubic",
): InternalPath {
  const path = structuredClone(pathValue);
  if (path.locked) return path;
  const segment = path.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return path;
  segment.kind = kind;
  const start = path.nodes.find((node) => node.id === segment.startNodeId);
  const end = path.nodes.find((node) => node.id === segment.endNodeId);
  if (!start || !end) return path;
  if (kind === "line") {
    delete start.handleOut;
    delete end.handleIn;
  } else {
    start.handleOut = {
      xMm: round((end.xMm - start.xMm) / 3),
      yMm: round((end.yMm - start.yMm) / 3),
    };
    end.handleIn = {
      xMm: round((start.xMm - end.xMm) / 3),
      yMm: round((start.yMm - end.yMm) / 3),
    };
  }
  return path;
}

export function setInternalPathPurpose(
  path: InternalPath,
  purpose: InternalPathPurpose,
): InternalPath {
  return {
    ...path,
    purpose,
    name: path.name.trim() ? path.name : defaultPathName(purpose),
    metadata: { ...path.metadata, purposeVersion: 1 },
  };
}

export function sampleInternalPath(pathValue: InternalPath): PatternPoint[] {
  const path = normalizeInternalPath(pathValue);
  const nodes = new Map(path.nodes.map((node) => [node.id, node]));
  const points: PatternPoint[] = [];
  for (const segment of path.segments) {
    const start = nodes.get(segment.startNodeId);
    const end = nodes.get(segment.endNodeId);
    if (!start || !end) continue;
    const startPoint: PatternPoint = {
      id: start.id,
      xMm: start.xMm,
      yMm: start.yMm,
      ...(segment.kind === "cubic" && start.handleOut ? { handleOut: start.handleOut } : {}),
    };
    const endPoint: PatternPoint = {
      id: end.id,
      xMm: end.xMm,
      yMm: end.yMm,
      ...(segment.kind === "cubic" && end.handleIn ? { handleIn: end.handleIn } : {}),
    };
    const sampled = segment.kind === "line"
      ? sampleStraightInternalSegment(startPoint, endPoint)
      : samplePatternSegment(startPoint, endPoint);
    points.push(...(points.length === 0 ? sampled : sampled.slice(1)));
  }
  return points;
}

function sampleStraightInternalSegment(start: PatternPoint, end: PatternPoint): PatternPoint[] {
  const lengthMm = distance(start, end);
  const steps = Math.min(256, Math.max(1, Math.ceil(lengthMm / PATH_LINE_SAMPLE_SPACING_MM)));
  return Array.from({ length: steps + 1 }, (_, index) => {
    if (index === 0) return { ...start };
    if (index === steps) return { ...end };
    const t = index / steps;
    return {
      id: `${start.id}::${end.id}::line:${index}`,
      ...lerp(start, end, t),
    };
  });
}

export function findNearestInternalPathSegment(
  pathValue: InternalPath,
  point: PatternVector,
): { segmentId: string; t: number; distanceMm: number } | null {
  const path = normalizeInternalPath(pathValue);
  const sampled = samplePathWithMetadata(path);
  let best: { segmentId: string; t: number; distanceMm: number } | null = null;
  for (let index = 0; index < sampled.length - 1; index += 1) {
    const first = sampled[index];
    const second = sampled[index + 1];
    if (first.segmentId !== second.segmentId) continue;
    const projection = projectPointOnSegment(point, first, second);
    const t = first.segmentT + (second.segmentT - first.segmentT) * projection.t;
    if (!best || projection.distanceMm < best.distanceMm) {
      best = { segmentId: first.segmentId, t, distanceMm: projection.distanceMm };
    }
  }
  return best;
}

export function analyzeInternalPath(
  pieceValue: PatternPiece,
  pathValue: InternalPath,
  seams: readonly Seam[] = [],
): InternalPathAnalysis {
  const piece = migrateLegacyPieceToSegments(structuredClone(pieceValue));
  const path = normalizeInternalPath(pathValue);
  const diagnostics: InternalPathDiagnostic[] = [];
  if (path.nodes.length < 2 || path.segments.length < 1) {
    diagnostics.push(errorDiagnostic("path-too-short", "O caminho precisa de pelo menos dois nós."));
  }
  const sampledPath = samplePathWithMetadata(path);
  const sampledContour = sampleContourWithMetadata(piece);
  if (pathSelfIntersects(sampledPath)) {
    diagnostics.push(errorDiagnostic("path-self-intersection", "O caminho cruza a si mesmo. Divida a operação em caminhos menores."));
  }
  const intersections = collectIntersections(sampledPath, sampledContour);
  const affectedSeamIds = [...new Set(
    seams
      .filter((seam) =>
        [...seamSideRanges(seam, "first"), ...seamSideRanges(seam, "second")]
          .some((range) => range.pieceId === piece.id),
      )
      .map((seam) => seam.id),
  )];

  if (path.purpose === "dart") {
    const normalized = normalizeDartPathGeometry(piece, path);
    diagnostics.push(...normalized.diagnostics);
    return {
      valid: normalized.valid && diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      operation: "dart",
      diagnostics,
      intersections,
      affectedSeamIds,
      regionAreasMm2: [],
    };
  }

  if (path.purpose !== "cut" && path.purpose !== "cut-and-sew") {
    return {
      valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      operation: "annotation",
      diagnostics,
      intersections,
      affectedSeamIds,
      regionAreasMm2: [],
    };
  }

  const boundaryTangency = findBoundaryTangency(sampledPath, sampledContour);
  const nearBoundaryWithoutCrossing = intersections.length < 2 && sampledPath.some((point) => nearestContourDistance(sampledContour, point) <= INTERSECTION_EPSILON_MM * 3);
  if (intersections.some((intersection) => intersection.tangent) || boundaryTangency || nearBoundaryWithoutCrossing) {
    diagnostics.push(errorDiagnostic("tangent-intersection", "O caminho apenas tangencia ou acompanha a borda. Faça-o atravessar o contorno com um ângulo perceptível.", intersections.find((intersection) => intersection.tangent) ?? boundaryTangency));
  }
  if (intersections.length < 2) {
    diagnostics.push(errorDiagnostic("insufficient-intersections", "O corte precisa atravessar o contorno exatamente duas vezes."));
  } else if (intersections.length > 2) {
    diagnostics.push(errorDiagnostic("too-many-intersections", `O caminho atravessa o contorno ${intersections.length} vezes. Esta etapa aceita exatamente duas interseções.`));
  }

  const regionAreasMm2 = intersections.length === 2
    ? estimateSplitAreas(piece, path, intersections as [InternalPathIntersection, InternalPathIntersection])
    : [];
  if (regionAreasMm2.some((area) => area < MIN_REGION_AREA_MM2)) {
    diagnostics.push(errorDiagnostic("degenerate-region", "O corte produziria uma região degenerada ou menor que a tolerância de 4 mm²."));
  }
  if (affectedSeamIds.length > 0) {
    diagnostics.push({
      code: "affected-seams",
      severity: "warning",
      message: `${affectedSeamIds.length} costura(s) serão remapeadas; referências impossíveis serão removidas com diagnóstico.`,
      seamIds: affectedSeamIds,
    });
  }
  return {
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error") && intersections.length === 2,
    operation: "cut",
    diagnostics,
    intersections,
    affectedSeamIds,
    regionAreasMm2,
  };
}

export function normalizeDartPathGeometry(
  pieceValue: PatternPiece,
  pathValue: InternalPath,
): DartGeometryNormalization {
  const piece = migrateLegacyPieceToSegments(structuredClone(pieceValue));
  const path = normalizeInternalPath(pathValue);
  const contour = sampleContourWithMetadata(piece);
  const polygon = samplePatternContour(piece.points);
  const diagnostics: InternalPathDiagnostic[] = [];
  const total = contour.at(-1)?.distanceMm ?? 0;
  if (total <= STRUCTURAL_EPSILON_MM) {
    return { valid: false, diagnostics: [errorDiagnostic("dart-contour-invalid", "O contorno da peça não permite criar a pence.")] };
  }

  const roleNode = (key: string) => {
    const id = path.metadata[key];
    return typeof id === "string" ? path.nodes.find((node) => node.id === id) : undefined;
  };
  let apexSource = roleNode("dartApexNodeId");
  let legASource = roleNode("dartLegANodeId");
  let legBSource = roleNode("dartLegBNodeId");

  if (!apexSource || !legASource || !legBSource) {
    if (path.nodes.length === 2) {
      const centerSource = path.nodes[0];
      apexSource = path.nodes[1];
      const centerProjection = nearestContourProjection(contour, centerSource);
      if (centerProjection.distanceMm > DART_SNAP_THRESHOLD_MM) {
        diagnostics.push(errorDiagnostic("dart-legs-not-found", "Não foi possível identificar duas pernas da pence."));
      } else {
        const legacyWidth = Math.abs(Number(path.metadata.dartWidthMm ?? 20));
        const first = projectionAtContourDistance(contour, centerProjection.distanceAlongMm - legacyWidth / 2, total);
        const second = projectionAtContourDistance(contour, centerProjection.distanceAlongMm + legacyWidth / 2, total);
        legASource = { id: `${path.id}:leg-a`, ...first.point };
        legBSource = { id: `${path.id}:leg-b`, ...second.point };
      }
    } else if (path.nodes.length === 3) {
      const candidates = path.nodes.flatMap((candidateApex, apexIndex) => {
        const apexProjection = nearestContourProjection(contour, candidateApex);
        if (!pointInPolygon(candidateApex, polygon) || apexProjection.distanceMm <= STRUCTURAL_EPSILON_MM) return [];
        const legs = path.nodes.filter((_, index) => index !== apexIndex);
        const projections = legs.map((node) => ({ node, projection: nearestContourProjection(contour, node) }));
        if (projections.some(({ projection }) => projection.distanceMm > DART_SNAP_THRESHOLD_MM)) return [];
        const [first, second] = projections;
        const signedArea = Math.abs(cross(subtract(candidateApex, first.projection.point), subtract(second.projection.point, first.projection.point)));
        if (distance(first.projection.point, second.projection.point) <= STRUCTURAL_EPSILON_MM || signedArea <= STRUCTURAL_EPSILON_MM) return [];
        return [{
          apex: candidateApex,
          legs: projections,
          score: first.projection.distanceMm + second.projection.distanceMm,
        }];
      }).sort((left, right) => left.score - right.score);

      const winner = candidates[0];
      if (winner) {
        apexSource = winner.apex;
        const ordered = [...winner.legs].sort((left, right) => left.projection.distanceAlongMm - right.projection.distanceAlongMm);
        legASource = ordered[0].node;
        legBSource = ordered[1].node;
      }
    }
  }

  if (!legASource || !legBSource) {
    diagnostics.push(errorDiagnostic("dart-legs-not-found", "Não foi possível identificar duas pernas da pence."));
  }
  if (!apexSource) {
    diagnostics.push(errorDiagnostic("dart-apex-not-found", "Não foi possível identificar o ápice da pence."));
  }
  if (diagnostics.length > 0 || !legASource || !legBSource || !apexSource) {
    return { valid: false, diagnostics: dedupeDiagnostics(diagnostics) };
  }

  const legAProjection = nearestContourProjection(contour, legASource);
  const legBProjection = nearestContourProjection(contour, legBSource);
  if (legAProjection.distanceMm > DART_SNAP_THRESHOLD_MM || legBProjection.distanceMm > DART_SNAP_THRESHOLD_MM) {
    return { valid: false, diagnostics: [errorDiagnostic("dart-legs-not-found", "Não foi possível identificar duas pernas da pence.")] };
  }
  if (!pointInPolygon(apexSource, polygon) || nearestContourDistance(contour, apexSource) <= STRUCTURAL_EPSILON_MM) {
    return { valid: false, diagnostics: [errorDiagnostic("dart-apex-not-found", "Não foi possível identificar o ápice da pence.")] };
  }

  const forward = wrappedContourDelta(legAProjection.distanceAlongMm, legBProjection.distanceAlongMm, total);
  const signedWidth = forward <= total / 2 ? forward : forward - total;
  const widthMm = Math.abs(signedWidth);
  const centerProjection = projectionAtContourDistance(contour, legAProjection.distanceAlongMm + signedWidth / 2, total);
  const lengthMm = distance(centerProjection.point, apexSource);
  const area = Math.abs(cross(subtract(apexSource, legAProjection.point), subtract(legBProjection.point, legAProjection.point)));
  if (widthMm <= STRUCTURAL_EPSILON_MM || lengthMm <= STRUCTURAL_EPSILON_MM || area <= STRUCTURAL_EPSILON_MM) {
    return { valid: false, diagnostics: [errorDiagnostic("dart-region-invalid", "Os pontos não formam uma região válida.")] };
  }

  const legA: InternalPathNode = { ...legASource, xMm: round(legAProjection.point.xMm), yMm: round(legAProjection.point.yMm) };
  const legB: InternalPathNode = { ...legBSource, xMm: round(legBProjection.point.xMm), yMm: round(legBProjection.point.yMm) };
  const apex: InternalPathNode = { ...apexSource, xMm: round(apexSource.xMm), yMm: round(apexSource.yMm) };
  const existingCenter = roleNode("dartCenterNodeId");
  const center: InternalPathNode = {
    id: existingCenter?.id ?? `${path.id}:center`,
    xMm: round(centerProjection.point.xMm),
    yMm: round(centerProjection.point.yMm),
  };
  const closed = path.metadata.closed === true;
  const nodes = closed ? [legA, apex, legB, center] : [legA, apex, legB];
  const segments: InternalPathSegment[] = [
    { id: `${path.id}:dart-leg-a`, startNodeId: legA.id, endNodeId: apex.id, kind: "line" },
    { id: `${path.id}:dart-leg-b`, startNodeId: apex.id, endNodeId: legB.id, kind: "line" },
    ...(closed ? [{ id: `${path.id}:dart-center`, startNodeId: center.id, endNodeId: apex.id, kind: "line" } as InternalPathSegment] : []),
  ];
  const normalizedPath: InternalPath = {
    ...path,
    nodes,
    segments,
    metadata: {
      ...path.metadata,
      dartApexNodeId: apex.id,
      dartLegANodeId: legA.id,
      dartLegBNodeId: legB.id,
      dartCenterNodeId: center.id,
      dartLegAEdgeId: legAProjection.edgeId,
      dartLegAT: legAProjection.edgeT,
      dartLegBEdgeId: legBProjection.edgeId,
      dartLegBT: legBProjection.edgeT,
      dartBoundaryAnchorVersion: 1,
      dartWidthMm: widthMm,
    },
  };
  return {
    valid: true,
    diagnostics: [],
    geometry: { path: normalizedPath, apex, legA, legB, center, widthMm, lengthMm },
  };
}

export function applyInternalPathOperation(
  garmentValue: GarmentDraft,
  pieceId: string,
  pathId: string,
  options: { keepJoined?: boolean } = {},
): InternalPathOperationResult {
  const garment = structuredClone(garmentValue);
  const source = garment.pieces.find((piece) => piece.id === pieceId);
  const rawPath = source?.internalLines?.find((line) => line.id === pathId);
  if (!source || !rawPath) {
    return failure(garment, pieceId, "path-not-found", "O caminho interno selecionado não existe mais.");
  }
  const path = normalizeInternalPath(rawPath);
  const analysis = analyzeInternalPath(source, path, garment.seams ?? []);
  if (!analysis.valid) {
    return {
      ok: false,
      garment,
      activePieceId: pieceId,
      diagnostics: analysis.diagnostics,
      createdPieceIds: [],
    };
  }
  if (path.purpose === "dart") {
    return applyDartPath(garment, source, path, analysis.diagnostics);
  }
  if (path.purpose !== "cut" && path.purpose !== "cut-and-sew") {
    return failure(garment, pieceId, "purpose-not-applicable", "Converta o caminho para Corte ou Pence antes de aplicar a geometria.");
  }
  return applyCutPath(garment, source, path, analysis, options.keepJoined === true || path.purpose === "cut-and-sew");
}

function applyCutPath(
  garment: GarmentDraft,
  sourceValue: PatternPiece,
  path: InternalPath,
  analysis: InternalPathAnalysis,
  keepJoined: boolean,
): InternalPathOperationResult {
  let source = migrateLegacyPieceToSegments(structuredClone(sourceValue));
  let seams = structuredClone(garment.seams ?? []);
  const hits: MutableIntersection[] = analysis.intersections
    .map((intersection) => ({ ...intersection, pathDistanceMm: intersection.pathDistanceMm }))
    .sort((left, right) => left.pathDistanceMm - right.pathDistanceMm);

  const splitOrder = [...hits].sort((left, right) => {
    if (left.edgeId === right.edgeId) return right.edgeT - left.edgeT;
    return 0;
  });
  for (const hit of splitOrder) {
    const segment = source.segments?.find((candidate) => candidate.id === hit.edgeId);
    if (!segment) continue;
    if (hit.edgeT <= 0.002) {
      hit.nodeId = segment.startNodeId;
      continue;
    }
    if (hit.edgeT >= 0.998) {
      hit.nodeId = segment.endNodeId;
      continue;
    }
    const insertion = splitPatternSegmentAt(source, hit.edgeId, hit.edgeT);
    if (!insertion) {
      return failure(garment, source.id, "contour-split-failed", "Não foi possível inserir uma interseção no contorno sem corromper a curva.");
    }
    source = insertion.piece;
    seams = remapSeamsAfterSegmentSplit(seams, insertion.split);
    hit.nodeId = insertion.pointId;
    for (const other of hits) {
      if (other === hit || other.edgeId !== insertion.split.originalEdgeId) continue;
      if (other.edgeT <= insertion.split.splitT) {
        other.edgeId = insertion.split.firstEdgeId;
        other.edgeT = insertion.split.splitT <= 0 ? 0 : other.edgeT / insertion.split.splitT;
      } else {
        other.edgeId = insertion.split.secondEdgeId;
        other.edgeT = (other.edgeT - insertion.split.splitT) / (1 - insertion.split.splitT);
      }
    }
  }
  for (const hit of hits) {
    if (hit.nodeId) continue;
    const nearest = source.nodes?.reduce<{ id: string; distance: number } | null>((best, node) => {
      const candidate = distance(node, hit);
      return !best || candidate < best.distance ? { id: node.id, distance: candidate } : best;
    }, null);
    if (!nearest || nearest.distance > 0.5) {
      return failure(garment, source.id, "intersection-node-missing", "Uma interseção não pôde ser vinculada a um nó topológico.");
    }
    hit.nodeId = nearest.id;
  }

  const first = hits[0];
  const second = hits[1];
  const outerForward = contourGeometryBetween(source, first.nodeId!, second.nodeId!);
  const outerBackward = contourGeometryBetween(source, second.nodeId!, first.nodeId!);
  const cutForward = pathGeometryBetween(path, first, second);
  if (outerForward.length === 0 || outerBackward.length === 0 || cutForward.length === 0) {
    return failure(garment, source.id, "region-build-failed", "As regiões do corte não puderam ser construídas de forma fechada.");
  }

  const firstBuilt = buildResultPiece(source, [...outerForward, ...reverseGeometry(cutForward)], path, 0);
  const secondBuilt = buildResultPiece(source, [...outerBackward, ...cutForward], path, 1);
  const mapping = new Map<string, { pieceId: string; edgeId: string }>();
  for (const [edgeId, resultEdgeId] of firstBuilt.sourceEdgeMap) mapping.set(edgeId, { pieceId: firstBuilt.piece.id, edgeId: resultEdgeId });
  for (const [edgeId, resultEdgeId] of secondBuilt.sourceEdgeMap) mapping.set(edgeId, { pieceId: secondBuilt.piece.id, edgeId: resultEdgeId });

  const diagnostics = [...analysis.diagnostics];
  const remappedSeams: Seam[] = [];
  for (const seam of seams) {
    const remapped = remapSeamToCutResults(seam, source.id, mapping);
    if (remapped) remappedSeams.push(remapped);
    else if ([...seamSideRanges(seam, "first"), ...seamSideRanges(seam, "second")]
      .some((range) => range.pieceId === source.id)) {
      diagnostics.push({
        code: "seam-invalidated",
        severity: "warning",
        message: `A costura ${seam.name ?? seam.id} foi removida porque sua borda deixou de existir após o corte.`,
        seamIds: [seam.id],
      });
    } else remappedSeams.push(seam);
  }

  let createdSeamGroupId: string | undefined;
  if (keepJoined) {
    createdSeamGroupId = createDocumentId("seam-group");
    const firstEdges = firstBuilt.cutEdgeIds;
    const secondEdges = [...secondBuilt.cutEdgeIds].reverse();
    const count = Math.min(firstEdges.length, secondEdges.length);
    for (let index = 0; index < count; index += 1) {
      remappedSeams.push({
        id: `${createdSeamGroupId}:part:${index + 1}`,
        groupId: createdSeamGroupId,
        name: "Recorte unido",
        first: { pieceId: firstBuilt.piece.id, edgeId: firstEdges[index], startT: 0, endT: 1 },
        second: { pieceId: secondBuilt.piece.id, edgeId: secondEdges[index], startT: 0, endT: 1 },
        direction: "opposite",
        easeRatio: 0,
        type: "standard",
        treatment: "standard",
        active: true,
      });
    }
  }

  const sourceWorkspace = workspaceStateFor(garment, source.id);
  const workspaceStates: PieceWorkspaceState[] = [firstBuilt.piece, secondBuilt.piece].map((piece) => ({
    ...sourceWorkspace,
    pieceId: piece.id,
    transform: { ...sourceWorkspace.transform, pieceId: piece.id },
  }));
  const pieces = garment.pieces.flatMap((piece) =>
    piece.id === source.id ? [firstBuilt.piece, secondBuilt.piece] : [piece],
  );
  const next: GarmentDraft = {
    ...garment,
    pieces,
    seams: remappedSeams,
    workspaceStates: [
      ...(garment.workspaceStates ?? []).filter((state) => state.pieceId !== source.id),
      ...workspaceStates,
    ],
    workspaceTransforms: [
      ...(garment.workspaceTransforms ?? []).filter((state) => state.pieceId !== source.id),
      ...workspaceStates.map((state) => state.transform),
    ],
    assemblyPlacements: (garment.assemblyPlacements ?? []).flatMap((placement) =>
      placement.pieceId === source.id
        ? [
            { ...placement, pieceId: firstBuilt.piece.id },
            { ...placement, pieceId: secondBuilt.piece.id },
          ]
        : [placement],
    ),
  };
  return {
    ok: true,
    garment: next,
    activePieceId: firstBuilt.piece.id,
    diagnostics,
    createdPieceIds: [firstBuilt.piece.id, secondBuilt.piece.id],
    ...(createdSeamGroupId ? { createdSeamGroupId } : {}),
  };
}

function applyDartPath(
  garment: GarmentDraft,
  source: PatternPiece,
  pathValue: InternalPath,
  previousDiagnostics: InternalPathDiagnostic[],
): InternalPathOperationResult {
  const normalized = normalizeDartPathGeometry(source, pathValue);
  if (!normalized.valid || !normalized.geometry) {
    return {
      ok: false,
      garment,
      activePieceId: source.id,
      diagnostics: normalized.diagnostics,
      createdPieceIds: [],
    };
  }
  const { path, center, apex, legA, legB, widthMm, lengthMm } = normalized.geometry;
  const pathId = path.id;
  const firstLegId = `${pathId}:dart-leg-a`;
  const secondLegId = `${pathId}:dart-leg-b`;
  const centerId = `${pathId}:dart-center`;
  const dartPath: InternalPath = {
    ...path,
    purpose: "dart",
    nodes: [
      legA,
      apex,
      legB,
      center,
    ],
    segments: [
      { id: firstLegId, startNodeId: legA.id, endNodeId: apex.id, kind: "line" },
      { id: secondLegId, startNodeId: apex.id, endNodeId: legB.id, kind: "line" },
      { id: centerId, startNodeId: center.id, endNodeId: apex.id, kind: "line" },
    ],
    metadata: {
      ...path.metadata,
      dartWidthMm: widthMm,
      closed: true,
      topologyVersion: 1,
    },
  };
  const dart: PatternDart = {
    id: createDocumentId("dart"),
    pieceId: source.id,
    pathId,
    apex: { xMm: apex.xMm, yMm: apex.yMm },
    legA: { xMm: legA.xMm, yMm: legA.yMm },
    legB: { xMm: legB.xMm, yMm: legB.yMm },
    centerLine: { start: { xMm: center.xMm, yMm: center.yMm }, end: { xMm: apex.xMm, yMm: apex.yMm } },
    widthMm,
    lengthMm,
    directionDeg: Math.atan2(apex.yMm - center.yMm, apex.xMm - center.xMm) * 180 / Math.PI,
    closed: true,
    legSegmentIds: [firstLegId, secondLegId],
    closure: {
      kind: "paired-legs",
      targetDistanceMm: 0,
      state: "closed",
      topologyVersion: 1,
    },
  };
  const pieces = garment.pieces.map((piece) =>
    piece.id === source.id
      ? {
          ...piece,
          internalLines: [
            ...(piece.internalLines ?? []).filter((line) => line.id !== path.id),
            dartPath,
          ],
          darts: [...(piece.darts ?? []).filter((candidate) => candidate.pathId !== path.id), dart],
        }
      : piece,
  );
  return {
    ok: true,
    garment: { ...garment, pieces },
    activePieceId: source.id,
    diagnostics: [
      ...previousDiagnostics,
      {
        code: "dart-closure-created",
        severity: "info",
        message: "A pence foi convertida em duas pernas topológicas com relação estrutural de fechamento.",
        pathId,
      },
    ],
    createdPieceIds: [source.id],
  };
}

function buildResultPiece(
  source: PatternPiece,
  geometry: GeometrySegment[],
  appliedPath: InternalPath,
  index: number,
): BuiltPiece {
  const id = createDocumentId("piece");
  const nodes: InternalPathNode[] = [];
  const segments: PatternSegment[] = [];
  const sourceEdgeMap = new Map<string, string>();
  const cutEdgeIds: string[] = [];
  const nodeIdAt = (point: PatternVector, position: number) => {
    const existing = nodes.find((node) => distance(node, point) <= INTERSECTION_EPSILON_MM);
    if (existing) return existing.id;
    const node = { id: `${id}:node:${position + 1}`, xMm: round(point.xMm), yMm: round(point.yMm) };
    nodes.push(node);
    return node.id;
  };
  geometry.forEach((entry, position) => {
    const startNodeId = nodeIdAt(entry.start, position);
    const endNodeId = nodeIdAt(entry.end, position + 1);
    const segmentId = entry.sourceEdgeId
      ? `${entry.sourceEdgeId}:cut-result:${index + 1}`
      : `${appliedPath.id}:cut-edge:${index + 1}:${(entry.cutIndex ?? position) + 1}`;
    segments.push({
      id: segmentId,
      startNodeId,
      endNodeId,
      kind: entry.kind,
      role: entry.sourceEdgeId ? entry.role : "other",
      ...(entry.kind === "cubic" ? { control1: entry.control1, control2: entry.control2 } : {}),
    });
    if (entry.sourceEdgeId) sourceEdgeMap.set(entry.sourceEdgeId, segmentId);
    else cutEdgeIds.push(segmentId);
  });
  const contourPoints = geometry.map((entry, position): PatternPoint => ({
    id: nodes.find((node) => node.id === segments[position].startNodeId)!.id,
    xMm: entry.start.xMm,
    yMm: entry.start.yMm,
  }));
  const inheritedLines = (source.internalLines ?? [])
    .filter((line) => line.id !== appliedPath.id)
    .map((line) => normalizeInternalPath(line))
    .filter((line) => pointInPolygon(pathCentroid(line), contourPoints));
  const inheritedDarts = (source.darts ?? []).filter((dart) => pointInPolygon(dart.apex, contourPoints));
  const inheritedAnnotations = (source.annotations ?? []).filter((annotation) => pointInPolygon(annotation, contourPoints));
  const edgeFinishes: Record<string, NonNullable<PatternPiece["edgeFinishes"]>[string]> = {};
  for (const [sourceEdgeId, targetEdgeId] of sourceEdgeMap) {
    const finish = source.edgeFinishes?.[sourceEdgeId];
    if (finish) edgeFinishes[targetEdgeId] = finish;
  }
  const model: PatternPiece = {
    ...structuredClone(source),
    id,
    name: `${source.name} ${index + 1}`,
    points: [],
    formatVersion: 2,
    nodes,
    segments,
    contours: [{ id: `${id}:contour`, segmentIds: segments.map((segment) => segment.id), closed: true }],
    internalLines: inheritedLines,
    darts: inheritedDarts.map((dart) => ({ ...dart, pieceId: id })),
    annotations: inheritedAnnotations,
    edgeFinishes,
    bodyPlacement: createUnclassifiedBodyPlacement(true, "migration"),
    previewPlacements: undefined,
  };
  return {
    piece: syncLegacyPointsFromSegments(model),
    sourceEdgeMap,
    cutEdgeIds,
  };
}

function contourGeometryBetween(piece: PatternPiece, startNodeId: string, endNodeId: string): GeometrySegment[] {
  const orderedIds = piece.contours?.find((contour) => contour.closed)?.segmentIds ?? [];
  const segmentMap = new Map((piece.segments ?? []).map((segment) => [segment.id, segment]));
  const nodeMap = new Map((piece.nodes ?? []).map((node) => [node.id, node]));
  const startIndex = orderedIds.findIndex((id) => segmentMap.get(id)?.startNodeId === startNodeId);
  if (startIndex < 0) return [];
  const result: GeometrySegment[] = [];
  for (let offset = 0; offset < orderedIds.length; offset += 1) {
    const segment = segmentMap.get(orderedIds[(startIndex + offset) % orderedIds.length]);
    if (!segment) continue;
    const start = nodeMap.get(segment.startNodeId);
    const end = nodeMap.get(segment.endNodeId);
    if (!start || !end) continue;
    result.push({
      sourceEdgeId: segment.id,
      kind: segment.kind,
      role: segment.role,
      start: vector(start),
      end: vector(end),
      ...(segment.kind === "cubic" ? { control1: segment.control1, control2: segment.control2 } : {}),
    });
    if (segment.endNodeId === endNodeId) return result;
  }
  return [];
}

function pathGeometryBetween(
  path: InternalPath,
  first: InternalPathIntersection,
  second: InternalPathIntersection,
): GeometrySegment[] {
  const nodes = new Map(path.nodes.map((node) => [node.id, node]));
  const firstIndex = path.segments.findIndex((segment) => segment.id === first.pathSegmentId);
  const secondIndex = path.segments.findIndex((segment) => segment.id === second.pathSegmentId);
  if (firstIndex < 0 || secondIndex < firstIndex) return [];
  const result: GeometrySegment[] = [];
  for (let index = firstIndex; index <= secondIndex; index += 1) {
    const segment = path.segments[index];
    const start = nodes.get(segment.startNodeId);
    const end = nodes.get(segment.endNodeId);
    if (!start || !end) continue;
    const startT = index === firstIndex ? first.pathT : 0;
    const endT = index === secondIndex ? second.pathT : 1;
    if (endT - startT <= 1e-6) continue;
    const geometry = internalSegmentGeometry(segment, start, end, startT, endT);
    result.push({ ...geometry, role: "other", cutIndex: index - firstIndex });
  }
  if (result.length > 0) {
    result[0].start = { xMm: first.xMm, yMm: first.yMm };
    result[result.length - 1].end = { xMm: second.xMm, yMm: second.yMm };
  }
  return result;
}

function internalSegmentGeometry(
  segment: InternalPathSegment,
  start: InternalPathNode,
  end: InternalPathNode,
  t0: number,
  t1: number,
): Omit<GeometrySegment, "role"> {
  const p0 = vector(start);
  const p3 = vector(end);
  if (segment.kind === "line") {
    return { kind: "line", start: lerp(p0, p3, t0), end: lerp(p0, p3, t1) };
  }
  const p1 = start.handleOut ? add(p0, start.handleOut) : lerp(p0, p3, 1 / 3);
  const p2 = end.handleIn ? add(p3, end.handleIn) : lerp(p0, p3, 2 / 3);
  const curve = cubicSubcurve(p0, p1, p2, p3, t0, t1);
  return { kind: "cubic", start: curve[0], control1: curve[1], control2: curve[2], end: curve[3] };
}

function reverseGeometry(geometry: GeometrySegment[]): GeometrySegment[] {
  return [...geometry].reverse().map((segment) => ({
    ...segment,
    start: segment.end,
    end: segment.start,
    ...(segment.kind === "cubic" ? { control1: segment.control2, control2: segment.control1 } : {}),
  }));
}

function remapSeamToCutResults(
  seam: Seam,
  sourcePieceId: string,
  mapping: Map<string, { pieceId: string; edgeId: string }>,
): Seam | null {
  const remap = (range: EdgeRange): EdgeRange | null => {
    if (range.pieceId !== sourcePieceId) return range;
    const target = mapping.get(range.edgeId);
    return target ? { ...range, pieceId: target.pieceId, edgeId: target.edgeId } : null;
  };
  const firstRanges = seamSideRanges(seam, "first").map(remap);
  const secondRanges = seamSideRanges(seam, "second").map(remap);
  if (firstRanges.some((range) => !range) || secondRanges.some((range) => !range)) return null;
  const first = firstRanges as EdgeRange[];
  const second = secondRanges as EdgeRange[];
  return {
    ...seam,
    first: first[0],
    second: second[0],
    ...(first.length > 1 ? { firstRanges: first } : { firstRanges: undefined }),
    ...(second.length > 1 ? { secondRanges: second } : { secondRanges: undefined }),
  };
}

function collectIntersections(
  path: SampledPathPoint[],
  contour: SampledContourPoint[],
): MutableIntersection[] {
  const hits: MutableIntersection[] = [];
  for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex += 1) {
    const pathStart = path[pathIndex];
    const pathEnd = path[pathIndex + 1];
    if (pathStart.segmentId !== pathEnd.segmentId) continue;
    for (let contourIndex = 0; contourIndex < contour.length - 1; contourIndex += 1) {
      const contourStart = contour[contourIndex];
      const contourEnd = contour[contourIndex + 1];
      if (contourStart.edgeId !== contourEnd.edgeId) continue;
      const hit = segmentIntersection(pathStart, pathEnd, contourStart, contourEnd);
      if (!hit) continue;
      const point = hit.point;
      const duplicate = hits.find((candidate) => distance(candidate, point) <= INTERSECTION_EPSILON_MM);
      if (duplicate) continue;
      const pathT = pathStart.segmentT + (pathEnd.segmentT - pathStart.segmentT) * hit.firstT;
      const edgeT = contourStart.edgeT + (contourEnd.edgeT - contourStart.edgeT) * hit.secondT;
      const pathVector = subtract(pathEnd, pathStart);
      const contourVector = subtract(contourEnd, contourStart);
      const sine = Math.abs(cross(pathVector, contourVector)) / Math.max(1e-9, length(pathVector) * length(contourVector));
      hits.push({
        xMm: round(point.xMm),
        yMm: round(point.yMm),
        pathSegmentId: pathStart.segmentId,
        pathT,
        edgeId: contourStart.edgeId,
        edgeT,
        tangent: sine < TANGENCY_SINE,
        pathDistanceMm: pathStart.distanceMm + distance(pathStart, point),
      });
    }
  }
  return hits.sort((left, right) => left.pathDistanceMm - right.pathDistanceMm);
}

function samplePathWithMetadata(path: InternalPath): SampledPathPoint[] {
  const nodes = new Map(path.nodes.map((node) => [node.id, node]));
  const result: SampledPathPoint[] = [];
  let walked = 0;
  for (const segment of path.segments) {
    const start = nodes.get(segment.startNodeId); const end = nodes.get(segment.endNodeId);
    if (!start || !end) continue;
    const steps = segment.kind === "cubic" ? PATH_CURVE_STEPS : 1;
    let previous: PatternVector | null = null;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps; const point = pointOnInternalSegment(segment, start, end, t);
      if (previous) walked += distance(previous, point);
      result.push({ ...point, segmentId: segment.id, segmentT: t, distanceMm: walked });
      previous = point;
    }
  }
  return result;
}

function sampleContourWithMetadata(pieceValue: PatternPiece): SampledContourPoint[] {
  const piece = migrateLegacyPieceToSegments(structuredClone(pieceValue));
  const nodes = new Map((piece.nodes ?? []).map((node) => [node.id, node]));
  const segments = new Map((piece.segments ?? []).map((segment) => [segment.id, segment]));
  const ordered = piece.contours?.find((contour) => contour.closed)?.segmentIds ?? [];
  const result: SampledContourPoint[] = [];
  let walked = 0;
  for (const id of ordered) {
    const segment = segments.get(id); const start = segment && nodes.get(segment.startNodeId); const end = segment && nodes.get(segment.endNodeId);
    if (!segment || !start || !end) continue;
    const steps = segment.kind === "cubic" ? CONTOUR_CURVE_STEPS : 1;
    let previous: PatternVector | null = null;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps; const point = pointOnPatternSegment(segment, start, end, t);
      if (previous) walked += distance(previous, point);
      result.push({ ...point, edgeId: segment.id, edgeT: t, distanceMm: walked });
      previous = point;
    }
  }
  return result;
}

function estimateSplitAreas(
  piece: PatternPiece,
  path: InternalPath,
  intersections: [InternalPathIntersection, InternalPathIntersection],
): number[] {
  const contour = sampleContourWithMetadata(piece);
  const cut = sampleInternalPath(path);
  const firstContour = nearestSampleIndex(contour, intersections[0]);
  const secondContour = nearestSampleIndex(contour, intersections[1]);
  const firstPath = nearestSampleIndex(cut, intersections[0]);
  const secondPath = nearestSampleIndex(cut, intersections[1]);
  const contourForward = wrappedSlice(contour, firstContour, secondContour).map(vector);
  const contourBackward = wrappedSlice(contour, secondContour, firstContour).map(vector);
  const cutForward = cut.slice(Math.min(firstPath, secondPath), Math.max(firstPath, secondPath) + 1).map(vector);
  return [
    polygonArea([...contourForward, ...[...cutForward].reverse()]),
    polygonArea([...contourBackward, ...cutForward]),
  ];
}

function pathSelfIntersects(path: SampledPathPoint[]): boolean {
  for (let first = 0; first < path.length - 1; first += 1) {
    for (let second = first + 2; second < path.length - 1; second += 1) {
      if (second === first + 1) continue;
      const hit = segmentIntersection(path[first], path[first + 1], path[second], path[second + 1]);
      if (hit && hit.firstT > 1e-4 && hit.firstT < 1 - 1e-4 && hit.secondT > 1e-4 && hit.secondT < 1 - 1e-4) return true;
    }
  }
  return false;
}

function pointOnInternalSegment(segment: InternalPathSegment, start: InternalPathNode, end: InternalPathNode, t: number): PatternVector {
  const p0 = vector(start);
  const p3 = vector(end);
  if (segment.kind === "line") return lerp(p0, p3, t);
  const p1 = start.handleOut ? add(p0, start.handleOut) : lerp(p0, p3, 1 / 3);
  const p2 = end.handleIn ? add(p3, end.handleIn) : lerp(p0, p3, 2 / 3);
  return cubic(p0, p1, p2, p3, t);
}

function pointOnPatternSegment(segment: PatternSegment, start: PatternVector, end: PatternVector, t: number): PatternVector {
  if (segment.kind === "line") return lerp(start, end, t);
  return cubic(
    start,
    segment.control1 ?? lerp(start, end, 1 / 3),
    segment.control2 ?? lerp(start, end, 2 / 3),
    end,
    t,
  );
}

function cubicSubcurve(p0: PatternVector, p1: PatternVector, p2: PatternVector, p3: PatternVector, t0: number, t1: number): [PatternVector, PatternVector, PatternVector, PatternVector] {
  const splitAt = (a: PatternVector, b: PatternVector, c: PatternVector, d: PatternVector, t: number) => {
    const ab = lerp(a, b, t); const bc = lerp(b, c, t); const cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t); const bcd = lerp(bc, cd, t); const point = lerp(abc, bcd, t);
    return { left: [a, ab, abc, point] as const, right: [point, bcd, cd, d] as const };
  };
  if (t0 <= 0 && t1 >= 1) return [p0, p1, p2, p3];
  const first = splitAt(p0, p1, p2, p3, clamp01(t1)).left;
  if (t0 <= 0) return [...first];
  const normalized = clamp01(t0 / Math.max(t1, 1e-9));
  return [...splitAt(first[0], first[1], first[2], first[3], normalized).right];
}

function pointAtWrappedContourDistance(contour: SampledContourPoint[], rawDistance: number, total: number): PatternVector {
  const target = ((rawDistance % total) + total) % total;
  for (let index = 0; index < contour.length - 1; index += 1) {
    const start = contour[index];
    const end = contour[index + 1];
    if (target < start.distanceMm || target > end.distanceMm) continue;
    const t = (target - start.distanceMm) / Math.max(1e-9, end.distanceMm - start.distanceMm);
    return lerp(start, end, t);
  }
  return vector(contour[0]);
}

function nearestContourDistance(contour: SampledContourPoint[], point: PatternVector): number {
  return nearestContourProjection(contour, point).distanceMm;
}
function nearestContourProjection(contour: SampledContourPoint[], point: PatternVector) {
  let best = { distanceMm: Number.POSITIVE_INFINITY, distanceAlongMm: 0, point: vector(contour[0] ?? point), edgeId: contour[0]?.edgeId ?? "", edgeT: 0 };
  for (let i=0;i<contour.length-1;i+=1) {
    const a=contour[i], b=contour[i+1]; if (a.edgeId!==b.edgeId) continue;
    const hit=projectPointOnSegment(point,a,b); if(hit.distanceMm>=best.distanceMm) continue;
    best={distanceMm:hit.distanceMm,distanceAlongMm:a.distanceMm+(b.distanceMm-a.distanceMm)*hit.t,point:lerp(a,b,hit.t),edgeId:a.edgeId,edgeT:a.edgeT+(b.edgeT-a.edgeT)*hit.t};
  }
  return best;
}

function projectionAtContourDistance(contour: SampledContourPoint[], rawDistance: number, total: number) {
  const target = ((rawDistance % total) + total) % total;
  for (let index = 0; index < contour.length - 1; index += 1) {
    const start = contour[index];
    const end = contour[index + 1];
    if (start.edgeId !== end.edgeId || target < start.distanceMm || target > end.distanceMm) continue;
    const t = (target - start.distanceMm) / Math.max(STRUCTURAL_EPSILON_MM, end.distanceMm - start.distanceMm);
    return {
      distanceMm: 0,
      distanceAlongMm: target,
      point: lerp(start, end, t),
      edgeId: start.edgeId,
      edgeT: start.edgeT + (end.edgeT - start.edgeT) * t,
    };
  }
  return nearestContourProjection(contour, contour[0] ?? { xMm: 0, yMm: 0 });
}

function wrappedContourDelta(from: number, to: number, total: number): number {
  return ((to - from) % total + total) % total;
}
function findBoundaryTangency(path: SampledPathPoint[], contour: SampledContourPoint[]): PatternVector | undefined {
  for(let i=0;i<path.length-1;i+=1){const a=path[i],b=path[i+1];if(a.segmentId!==b.segmentId||distance(a,b)<1e-9)continue;
    for(let j=0;j<contour.length-1;j+=1){const c=contour[j],d=contour[j+1];if(c.edgeId!==d.edgeId||distance(c,d)<1e-9)continue;
      const av=subtract(b,a),cv=subtract(d,c),sine=Math.abs(cross(av,cv))/Math.max(1e-9,length(av)*length(cv));if(sine>=TANGENCY_SINE)continue;
      const overlapX=Math.max(Math.min(a.xMm,b.xMm),Math.min(c.xMm,d.xMm))<=Math.min(Math.max(a.xMm,b.xMm),Math.max(c.xMm,d.xMm))+INTERSECTION_EPSILON_MM*3;
      const overlapY=Math.max(Math.min(a.yMm,b.yMm),Math.min(c.yMm,d.yMm))<=Math.min(Math.max(a.yMm,b.yMm),Math.max(c.yMm,d.yMm))+INTERSECTION_EPSILON_MM*3;if(!overlapX||!overlapY)continue;
      if(Math.min(projectPointOnSegment(a,c,d).distanceMm,projectPointOnSegment(b,c,d).distanceMm,projectPointOnSegment(c,a,b).distanceMm,projectPointOnSegment(d,a,b).distanceMm)<=INTERSECTION_EPSILON_MM*3)return vector(c);
    }}return undefined;
}

function nearestSampleIndex(points: readonly PatternVector[], point: PatternVector): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((candidate, index) => {
    const candidateDistance = distance(candidate, point);
    if (candidateDistance < bestDistance) { bestDistance = candidateDistance; bestIndex = index; }
  });
  return bestIndex;
}

function wrappedSlice<T>(items: readonly T[], start: number, end: number): T[] {
  const result: T[] = [];
  let index = start;
  for (let count = 0; count <= items.length; count += 1) {
    result.push(items[index]);
    if (index === end) break;
    index = (index + 1) % items.length;
  }
  return result;
}

function pathCentroid(path: InternalPath): PatternVector {
  const points = sampleInternalPath(path);
  return points.reduce((sum, point) => ({ xMm: sum.xMm + point.xMm / points.length, yMm: sum.yMm + point.yMm / points.length }), { xMm: 0, yMm: 0 });
}

function pointInPolygon(point: PatternVector, polygon: readonly PatternVector[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.yMm > point.yMm) !== (b.yMm > point.yMm) && point.xMm < ((b.xMm - a.xMm) * (point.yMm - a.yMm)) / (b.yMm - a.yMm) + a.xMm) inside = !inside;
  }
  return inside;
}

function projectPointOnSegment(point: PatternVector, start: PatternVector, end: PatternVector) {
  const dx = end.xMm - start.xMm; const dy = end.yMm - start.yMm;
  const denominator = dx * dx + dy * dy;
  const t = denominator <= 1e-12 ? 0 : clamp01(((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) / denominator);
  const projected = { xMm: start.xMm + dx * t, yMm: start.yMm + dy * t };
  return { t, distanceMm: distance(point, projected) };
}

function segmentIntersection(a: PatternVector, b: PatternVector, c: PatternVector, d: PatternVector): { point: PatternVector; firstT: number; secondT: number } | null {
  const r = subtract(b, a); const s = subtract(d, c); const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-10) return null;
  const q = subtract(c, a); const t = cross(q, s) / denominator; const u = cross(q, r) / denominator;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return { point: add(a, scale(r, t)), firstT: clamp01(t), secondT: clamp01(u) };
}

function workspaceStateFor(garment: GarmentDraft, pieceId: string): PieceWorkspaceState {
  return garment.workspaceStates?.find((state) => state.pieceId === pieceId) ?? {
    pieceId,
    transform: garment.workspaceTransforms?.find((state) => state.pieceId === pieceId) ?? { pieceId, xMm: 0, yMm: 0, rotationDeg: 0 },
    visible: true,
    locked: false,
  };
}

function errorDiagnostic(code: InternalPathDiagnostic["code"], message: string, point?: PatternVector): InternalPathDiagnostic {
  return { code, severity: "error", message, ...(point ? { point: vector(point) } : {}) };
}

function dedupeDiagnostics(diagnostics: readonly InternalPathDiagnostic[]): InternalPathDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function failure(garment: GarmentDraft, activePieceId: string, code: InternalPathDiagnostic["code"], message: string): InternalPathOperationResult {
  return { ok: false, garment, activePieceId, diagnostics: [errorDiagnostic(code, message)], createdPieceIds: [] };
}

function legacyPurpose(value: string): InternalPathPurpose {
  if (value === "dart-center") return "dart";
  if (value === "topstitch" || value === "pocket") return "marking";
  if (value === "fold" || value === "reference" || value === "cut" || value === "cut-and-sew" || value === "dart" || value === "marking") return value;
  return "reference";
}

function defaultPathName(purpose: InternalPathPurpose): string {
  return ({ cut: "Linha de corte", "cut-and-sew": "Corte costurado", dart: "Pence", fold: "Dobra", reference: "Referência", marking: "Marcação" })[purpose];
}

function polygonArea(points: readonly PatternVector[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]; const next = points[(index + 1) % points.length];
    sum += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  return Math.abs(sum) / 2;
}

function cubic(p0: PatternVector, p1: PatternVector, p2: PatternVector, p3: PatternVector, t: number): PatternVector {
  const q = 1 - t;
  return {
    xMm: q * q * q * p0.xMm + 3 * q * q * t * p1.xMm + 3 * q * t * t * p2.xMm + t * t * t * p3.xMm,
    yMm: q * q * q * p0.yMm + 3 * q * q * t * p1.yMm + 3 * q * t * t * p2.yMm + t * t * t * p3.yMm,
  };
}

function vector(point: PatternVector): PatternVector { return { xMm: point.xMm, yMm: point.yMm }; }
function add(a: PatternVector, b: PatternVector): PatternVector { return { xMm: a.xMm + b.xMm, yMm: a.yMm + b.yMm }; }
function subtract(a: PatternVector, b: PatternVector): PatternVector { return { xMm: a.xMm - b.xMm, yMm: a.yMm - b.yMm }; }
function scale(a: PatternVector, value: number): PatternVector { return { xMm: a.xMm * value, yMm: a.yMm * value }; }
function lerp(a: PatternVector, b: PatternVector, t: number): PatternVector { return add(a, scale(subtract(b, a), t)); }
function cross(a: PatternVector, b: PatternVector): number { return a.xMm * b.yMm - a.yMm * b.xMm; }
function length(a: PatternVector): number { return Math.hypot(a.xMm, a.yMm); }
function distance(a: PatternVector, b: PatternVector): number { return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function round(value: number): number { return Math.round(value * 1e6) / 1e6; }
