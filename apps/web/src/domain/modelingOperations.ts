import { createInternalPath } from "./internalPaths";
import {
  CUT_END_EDGE_KEY,
  CUT_END_T_KEY,
  CUT_START_EDGE_KEY,
  CUT_START_T_KEY,
} from "./modelingCut";
import { samplePatternContour } from "./polygonGeometry";
import {
  createDocumentId,
  getPatternEdges,
  isInternalPath,
  makeEdgeId,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type InternalPath,
  type PatternDart,
  type PatternInternalLine,
  type PatternPiece,
  type PatternPoint,
  type PatternVector,
  type PieceWorkspaceState,
  type PieceWorkspaceTransform,
} from "./pattern";

export type MirrorAxis = "horizontal" | "vertical";
export type AlignmentMode = "left" | "right" | "top" | "bottom" | "center-x" | "center-y";
export type DistributionAxis = "horizontal" | "vertical";
export type PleatSense = "inward" | "outward";

export interface ModelingOperationResult {
  ok: boolean;
  garment: GarmentDraft;
  activePieceId: string;
  selectedPieceIds: string[];
  diagnostics: string[];
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface JoinCandidate {
  firstEdgeIndex: number;
  secondEdgeIndex: number;
  score: number;
  toleranceMm: number;
}

export function duplicateModelingPieces(
  garmentValue: GarmentDraft,
  pieceIds: readonly string[],
  mirrorAxis?: MirrorAxis,
): ModelingOperationResult {
  const garment = structuredClone(garmentValue);
  const sources = pieceIds
    .map((id) => garment.pieces.find((piece) => piece.id === id))
    .filter((piece): piece is PatternPiece => Boolean(piece));
  if (sources.length === 0) return failure(garment, "Selecione ao menos uma peça para duplicar.");

  const duplicates = sources.map((source) => duplicatePieceTopology(source, mirrorAxis));
  const sourceStates = sources.map((source) => workspaceStateFor(garment, source.id));
  const offset = 40;
  const nextStates: PieceWorkspaceState[] = duplicates.map((duplicate, index) => ({
    ...sourceStates[index],
    pieceId: duplicate.id,
    transform: {
      ...sourceStates[index].transform,
      pieceId: duplicate.id,
      xMm: sourceStates[index].transform.xMm + offset,
      yMm: sourceStates[index].transform.yMm + offset,
    },
    visible: true,
    locked: false,
  }));
  const next = syncWorkspace({
    ...garment,
    pieces: [...garment.pieces, ...duplicates],
    workspaceStates: [...(garment.workspaceStates ?? []), ...nextStates],
  });
  return success(next, duplicates.at(-1)!.id, duplicates.map((piece) => piece.id), [
    mirrorAxis
      ? `Cópia espelhada no eixo ${mirrorAxis === "horizontal" ? "vertical (X)" : "horizontal (Y)"} local da peça.`
      : "Cópia criada com deslocamento previsível de 40 mm em X e Y.",
  ]);
}

export function alignModelingPieces(
  garmentValue: GarmentDraft,
  pieceIds: readonly string[],
  mode: AlignmentMode,
): ModelingOperationResult {
  const garment = structuredClone(garmentValue);
  const entries = selectedEntries(garment, pieceIds);
  if (entries.length < 2) return failure(garment, "Selecione pelo menos duas peças para alinhar.");
  const collective = unionBounds(entries.map((entry) => entry.bounds));
  const target = mode === "left" ? collective.minX
    : mode === "right" ? collective.maxX
      : mode === "top" ? collective.minY
        : mode === "bottom" ? collective.maxY
          : mode === "center-x" ? (collective.minX + collective.maxX) / 2
            : (collective.minY + collective.maxY) / 2;
  let next = garment;
  for (const entry of entries) {
    const current = workspaceStateFor(next, entry.piece.id).transform;
    const value = mode === "left" ? entry.bounds.minX
      : mode === "right" ? entry.bounds.maxX
        : mode === "top" ? entry.bounds.minY
          : mode === "bottom" ? entry.bounds.maxY
            : mode === "center-x" ? (entry.bounds.minX + entry.bounds.maxX) / 2
              : (entry.bounds.minY + entry.bounds.maxY) / 2;
    const horizontal = mode === "left" || mode === "right" || mode === "center-x";
    next = patchWorkspaceTransform(next, entry.piece.id, {
      ...current,
      xMm: current.xMm + (horizontal ? target - value : 0),
      yMm: current.yMm + (horizontal ? 0 : target - value),
    });
  }
  return success(syncWorkspace(next), pieceIds.at(-1) ?? "", [...pieceIds], []);
}

export function distributeModelingPieces(
  garmentValue: GarmentDraft,
  pieceIds: readonly string[],
  axis: DistributionAxis,
): ModelingOperationResult {
  const garment = structuredClone(garmentValue);
  const entries = selectedEntries(garment, pieceIds);
  if (entries.length < 3) return failure(garment, "Selecione pelo menos três peças para distribuir.");
  const ordered = [...entries].sort((left, right) => center(left.bounds, axis) - center(right.bounds, axis));
  const first = center(ordered[0].bounds, axis);
  const last = center(ordered.at(-1)!.bounds, axis);
  const step = (last - first) / (ordered.length - 1);
  let next = garment;
  for (let index = 1; index < ordered.length - 1; index += 1) {
    const entry = ordered[index];
    const currentCenter = center(entry.bounds, axis);
    const target = first + step * index;
    const transform = workspaceStateFor(next, entry.piece.id).transform;
    next = patchWorkspaceTransform(next, entry.piece.id, {
      ...transform,
      xMm: transform.xMm + (axis === "horizontal" ? target - currentCenter : 0),
      yMm: transform.yMm + (axis === "vertical" ? target - currentCenter : 0),
    });
  }
  return success(syncWorkspace(next), pieceIds.at(-1) ?? "", [...pieceIds], []);
}

export function joinModelingPieces(
  garmentValue: GarmentDraft,
  pieceIds: readonly string[],
): ModelingOperationResult {
  const garment = structuredClone(garmentValue);
  if (pieceIds.length !== 2) return failure(garment, "Para unir nesta etapa, selecione exatamente duas peças.");
  const first = garment.pieces.find((piece) => piece.id === pieceIds[0]);
  const second = garment.pieces.find((piece) => piece.id === pieceIds[1]);
  if (!first || !second) return failure(garment, "Uma das peças selecionadas não existe mais.");
  const firstWorkspace = workspaceStateFor(garment, first.id);
  const secondWorkspace = workspaceStateFor(garment, second.id);
  if (firstWorkspace.locked || secondWorkspace.locked) return failure(garment, "Desbloqueie as duas peças antes de unir.");
  const candidate = findJoinCandidate(first, firstWorkspace.transform, second, secondWorkspace.transform);
  if (!candidate) {
    return failure(garment, "Nenhum par de bordas compatíveis e coincidentes foi encontrado. Aproxime e oriente as bordas antes de unir.");
  }
  const joined = buildJoinedPiece(first, firstWorkspace.transform, second, secondWorkspace.transform, candidate);
  if (!joined) return failure(garment, "A união produziria um contorno degenerado ou desconectado.");
  const removedIds = new Set([first.id, second.id]);
  const removedSeams = (garment.seams ?? []).filter((seam) => removedIds.has(seam.first.pieceId) || removedIds.has(seam.second.pieceId));
  const nextWorkspace: PieceWorkspaceState = {
    pieceId: joined.id,
    transform: { ...firstWorkspace.transform, pieceId: joined.id },
    visible: true,
    locked: false,
  };
  const next = syncWorkspace({
    ...garment,
    pieces: garment.pieces.flatMap((piece) => removedIds.has(piece.id) ? [] : [piece]).concat(joined),
    seams: (garment.seams ?? []).filter((seam) => !removedIds.has(seam.first.pieceId) && !removedIds.has(seam.second.pieceId)),
    workspaceStates: [...(garment.workspaceStates ?? []).filter((state) => !removedIds.has(state.pieceId)), nextWorkspace],
    assemblyPlacements: (garment.assemblyPlacements ?? []).filter((placement) => !removedIds.has(placement.pieceId)),
  });
  const diagnostics = [
    `Bordas unidas com tolerância de ${candidate.toleranceMm.toFixed(1)} mm.`,
    ...(removedSeams.length > 0 ? [`${removedSeams.length} costura(s) ligada(s) às peças originais foram invalidadas explicitamente pela união.`] : []),
  ];
  return success(next, joined.id, [joined.id], diagnostics);
}

export function createSimplePleat(
  garmentValue: GarmentDraft,
  pieceId: string,
  options: { depthMm: number; directionDeg: number; sense: PleatSense },
): ModelingOperationResult {
  const garment = structuredClone(garmentValue);
  const piece = garment.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return failure(garment, "Selecione uma peça para criar a prega.");
  if (!Number.isFinite(options.depthMm) || options.depthMm <= 0) return failure(garment, "A profundidade da prega precisa ser maior que zero.");
  if (!Number.isFinite(options.directionDeg)) return failure(garment, "A direção da prega precisa ser numérica.");
  const contour = samplePatternContour(piece.points).map(vector);
  if (contour.length < 3) return failure(garment, "O contorno da peça é inválido para criar uma prega.");
  const bounds = boundsOf(contour);
  const centerPoint = { xMm: (bounds.minX + bounds.maxX) / 2, yMm: (bounds.minY + bounds.maxY) / 2 };
  const angle = options.directionDeg * Math.PI / 180;
  const direction = { xMm: Math.cos(angle), yMm: Math.sin(angle) };
  const normal = { xMm: -direction.yMm, yMm: direction.xMm };
  const offsets = [-options.depthMm / 2, options.depthMm / 2];
  const lines = offsets.map((offset) => clippedInfiniteLine(contour, {
    xMm: centerPoint.xMm + normal.xMm * offset,
    yMm: centerPoint.yMm + normal.yMm * offset,
  }, direction));
  if (lines.some((line) => !line)) return failure(garment, "Não foi possível posicionar as duas linhas da prega dentro do contorno.");
  const pleatId = createDocumentId("pleat");
  const consumptionMm = options.depthMm * 2;
  const paths = (lines as [[PatternVector, PatternVector], [PatternVector, PatternVector]]).map((line, index) => {
    const path = createInternalPath(piece.id, "fold", line, { name: `Prega ${index + 1}` });
    return {
      ...path,
      metadata: {
        ...path.metadata,
        pleatId,
        pleatRole: index === 0 ? "fold-a" : "fold-b",
        pleatDepthMm: options.depthMm,
        pleatDirectionDeg: options.directionDeg,
        pleatSense: options.sense,
        pleatConsumptionMm: consumptionMm,
        pleatEffect: "fold-preparation",
      },
    } satisfies InternalPath;
  });
  const next: GarmentDraft = {
    ...garment,
    pieces: garment.pieces.map((candidate) => candidate.id === piece.id
      ? { ...candidate, internalLines: [...(candidate.internalLines ?? []), ...paths] }
      : candidate),
  };
  return success(next, piece.id, [piece.id], [
    `Prega simples registrada com duas dobras e consumo adicional de ${consumptionMm.toFixed(1)} mm de tecido.`,
    "O efeito desta etapa é preparação estrutural por linhas de dobra; nenhuma simulação 3D foi adicionada.",
  ]);
}

export function worldBoundsForPiece(garment: GarmentDraft, pieceId: string): Bounds | null {
  const piece = garment.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return null;
  return transformedBounds(piece, workspaceStateFor(garment, pieceId).transform);
}

function duplicatePieceTopology(sourceValue: PatternPiece, mirrorAxis?: MirrorAxis): PatternPiece {
  const source = structuredClone(sourceValue);
  const newId = createDocumentId("piece");
  const localBounds = boundsOf(samplePatternContour(source.points));
  const reflectPoint = (point: PatternVector): PatternVector => {
    if (!mirrorAxis) return vector(point);
    return mirrorAxis === "horizontal"
      ? { xMm: localBounds.minX + localBounds.maxX - point.xMm, yMm: point.yMm }
      : { xMm: point.xMm, yMm: localBounds.minY + localBounds.maxY - point.yMm };
  };
  const reflectVector = (value: PatternVector): PatternVector => {
    if (!mirrorAxis) return vector(value);
    return mirrorAxis === "horizontal"
      ? { xMm: -value.xMm, yMm: value.yMm }
      : { xMm: value.xMm, yMm: -value.yMm };
  };

  const sourceEntries = source.points.map((point) => ({ sourceId: point.id, point: structuredClone(point) }));
  const transformedEntries = sourceEntries.map(({ sourceId, point }) => ({
    sourceId,
    point: {
      ...point,
      ...reflectPoint(point),
      handleIn: point.handleIn ? reflectVector(point.handleIn) : undefined,
      handleOut: point.handleOut ? reflectVector(point.handleOut) : undefined,
    } as PatternPoint,
  }));
  const orderedEntries = mirrorAxis
    ? transformedEntries.reverse().map((entry) => ({
        ...entry,
        point: {
          ...entry.point,
          handleIn: entry.point.handleOut ? { ...entry.point.handleOut } : undefined,
          handleOut: entry.point.handleIn ? { ...entry.point.handleIn } : undefined,
        },
      }))
    : transformedEntries;
  const pointIdMap = new Map<string, string>();
  const points = orderedEntries.map((entry, index) => {
    const id = createDocumentId(`${newId}:point-${index + 1}`);
    pointIdMap.set(entry.sourceId, id);
    return { ...entry.point, id };
  });
  const edgeMap = new Map<string, string>();
  for (const edge of getPatternEdges(source)) {
    const mappedStart = pointIdMap.get(edge.startPointId);
    const mappedEnd = pointIdMap.get(edge.endPointId);
    if (!mappedStart || !mappedEnd) continue;
    edgeMap.set(edge.id, mirrorAxis
      ? makeEdgeId(newId, mappedEnd, mappedStart)
      : makeEdgeId(newId, mappedStart, mappedEnd));
  }

  const pathIdMap = new Map<string, string>();
  const pathSegmentIdMap = new Map<string, string>();
  const internalLines: PatternInternalLine[] | undefined = source.internalLines?.map((line) => {
    if (!isInternalPath(line)) {
      return {
        ...structuredClone(line),
        id: createDocumentId("internal-line"),
        pieceId: newId,
        points: line.points.map((point) => ({
          ...point,
          ...reflectPoint(point),
          handleIn: point.handleIn ? reflectVector(point.handleIn) : undefined,
          handleOut: point.handleOut ? reflectVector(point.handleOut) : undefined,
        })),
      };
    }
    const pathId = createDocumentId("internal-path");
    pathIdMap.set(line.id, pathId);
    const nodeMap = new Map<string, string>();
    const nodes = line.nodes.map((node, index) => {
      const id = `${pathId}:node:${index + 1}`;
      nodeMap.set(node.id, id);
      return {
        ...node,
        id,
        ...reflectPoint(node),
        handleIn: node.handleIn ? reflectVector(node.handleIn) : undefined,
        handleOut: node.handleOut ? reflectVector(node.handleOut) : undefined,
      };
    });
    const segments = line.segments.map((segment, index) => {
      const id = `${pathId}:segment:${index + 1}`;
      pathSegmentIdMap.set(segment.id, id);
      return {
        ...segment,
        id,
        startNodeId: nodeMap.get(segment.startNodeId) ?? segment.startNodeId,
        endNodeId: nodeMap.get(segment.endNodeId) ?? segment.endNodeId,
      };
    });
    const metadata = remapBoundaryMetadata(line.metadata, edgeMap, Boolean(mirrorAxis));
    return { ...line, id: pathId, pieceId: newId, nodes, segments, metadata };
  });

  const transformDart = (dart: PatternDart): PatternDart => {
    const apex = reflectPoint(dart.apex);
    const center = reflectPoint(dart.centerLine.start);
    return {
      ...structuredClone(dart),
      id: createDocumentId("dart"),
      pieceId: newId,
      ...(dart.pathId ? { pathId: pathIdMap.get(dart.pathId) ?? dart.pathId } : {}),
      ...(dart.legSegmentIds ? {
        legSegmentIds: [
          pathSegmentIdMap.get(dart.legSegmentIds[0]) ?? dart.legSegmentIds[0],
          pathSegmentIdMap.get(dart.legSegmentIds[1]) ?? dart.legSegmentIds[1],
        ] as [string, string],
      } : {}),
      apex,
      legA: reflectPoint(dart.legA),
      legB: reflectPoint(dart.legB),
      centerLine: { start: center, end: apex },
      directionDeg: Math.atan2(apex.yMm - center.yMm, apex.xMm - center.xMm) * 180 / Math.PI,
    };
  };

  const edgeFinishes = source.edgeFinishes
    ? Object.fromEntries(Object.entries(source.edgeFinishes).flatMap(([edgeId, finish]) => {
        const mapped = edgeMap.get(edgeId);
        return mapped ? [[mapped, finish]] : [];
      }))
    : undefined;
  const { nodes: _nodes, segments: _segments, contours: _contours, formatVersion: _formatVersion, ...base } = source;
  let result = migrateLegacyPieceToSegments({
    ...base,
    id: newId,
    name: `${source.name} – ${mirrorAxis ? `espelhada ${mirrorAxis === "horizontal" ? "H" : "V"}` : "cópia"}`,
    points,
    internalLines,
    darts: source.darts?.map(transformDart),
    grainline: source.grainline ? { start: reflectPoint(source.grainline.start), end: reflectPoint(source.grainline.end) } : undefined,
    annotations: source.annotations?.map((annotation) => ({ ...annotation, id: createDocumentId("annotation"), ...reflectPoint(annotation) })),
    guides: source.guides?.map((guide) => mirrorAxis === "horizontal" && guide.orientation === "vertical"
      ? { ...guide, id: createDocumentId("guide"), positionMm: localBounds.minX + localBounds.maxX - guide.positionMm }
      : mirrorAxis === "vertical" && guide.orientation === "horizontal"
        ? { ...guide, id: createDocumentId("guide"), positionMm: localBounds.minY + localBounds.maxY - guide.positionMm }
        : { ...guide, id: createDocumentId("guide") }),
    previewPlacements: source.previewPlacements?.map((placement) => ({
      ...placement,
      id: createDocumentId("preview-placement"),
      pieceId: newId,
      ...(mirrorAxis === "horizontal" ? { mirrorX: !placement.mirrorX } : {}),
    })),
    edgeFinishes,
  });
  const roleByNewEdge = new Map<string, NonNullable<PatternPiece["segments"]>[number]["role"]>();
  for (const segment of source.segments ?? []) {
    const mapped = edgeMap.get(segment.id);
    if (mapped) roleByNewEdge.set(mapped, segment.role);
  }
  result = {
    ...result,
    segments: result.segments?.map((segment) => ({ ...segment, role: roleByNewEdge.get(segment.id) ?? segment.role })),
  };
  return result;
}

function remapBoundaryMetadata(
  metadataValue: InternalPath["metadata"],
  edgeMap: Map<string, string>,
  reverseParameter: boolean,
): InternalPath["metadata"] {
  const metadata = { ...metadataValue };
  for (const [edgeKey, tKey] of [[CUT_START_EDGE_KEY, CUT_START_T_KEY], [CUT_END_EDGE_KEY, CUT_END_T_KEY]] as const) {
    const oldEdge = metadata[edgeKey];
    const oldT = metadata[tKey];
    if (typeof oldEdge !== "string" || typeof oldT !== "number") continue;
    const mapped = edgeMap.get(oldEdge);
    if (!mapped) {
      delete metadata[edgeKey];
      delete metadata[tKey];
      metadata.boundaryReferenceInvalidated = true;
      continue;
    }
    metadata[edgeKey] = mapped;
    metadata[tKey] = reverseParameter ? 1 - oldT : oldT;
  }
  return metadata;
}

function selectedEntries(garment: GarmentDraft, pieceIds: readonly string[]) {
  return pieceIds.flatMap((id) => {
    const piece = garment.pieces.find((candidate) => candidate.id === id);
    if (!piece) return [];
    const workspace = workspaceStateFor(garment, id);
    if (workspace.locked || !workspace.visible) return [];
    return [{ piece, bounds: transformedBounds(piece, workspace.transform) }];
  });
}

function findJoinCandidate(
  first: PatternPiece,
  firstTransform: PieceWorkspaceTransform,
  second: PatternPiece,
  secondTransform: PieceWorkspaceTransform,
): JoinCandidate | null {
  let best: JoinCandidate | null = null;
  for (let firstIndex = 0; firstIndex < first.points.length; firstIndex += 1) {
    const a0 = localToWorld(first.points[firstIndex], firstTransform);
    const a1 = localToWorld(first.points[(firstIndex + 1) % first.points.length], firstTransform);
    const firstLength = approximateEdgeLength(first.points[firstIndex], first.points[(firstIndex + 1) % first.points.length]);
    for (let secondIndex = 0; secondIndex < second.points.length; secondIndex += 1) {
      const b0 = localToWorld(second.points[secondIndex], secondTransform);
      const b1 = localToWorld(second.points[(secondIndex + 1) % second.points.length], secondTransform);
      const secondLength = approximateEdgeLength(second.points[secondIndex], second.points[(secondIndex + 1) % second.points.length]);
      const toleranceMm = Math.max(2, Math.max(firstLength, secondLength) * 0.015);
      const lengthDifference = Math.abs(firstLength - secondLength);
      if (lengthDifference > toleranceMm) continue;
      const endpointGap = distance(a0, b1) + distance(a1, b0);
      if (distance(a0, b1) > toleranceMm || distance(a1, b0) > toleranceMm) continue;
      const score = endpointGap + lengthDifference;
      if (!best || score < best.score) best = { firstEdgeIndex: firstIndex, secondEdgeIndex: secondIndex, score, toleranceMm };
    }
  }
  return best;
}

function buildJoinedPiece(
  first: PatternPiece,
  firstTransform: PieceWorkspaceTransform,
  second: PatternPiece,
  secondTransform: PieceWorkspaceTransform,
  candidate: JoinCandidate,
): PatternPiece | null {
  const firstPath = contourWithoutEdge(first.points, candidate.firstEdgeIndex).map(clonePoint);
  const secondPath = contourWithoutEdge(second.points, candidate.secondEdgeIndex).map((point) => transformPointBetweenWorkspaces(point, secondTransform, firstTransform));
  if (firstPath.length < 2 || secondPath.length < 2) return null;

  const start = mergeJoinPoint(firstPath[0], secondPath.at(-1)!, "closure");
  const middle = mergeJoinPoint(firstPath.at(-1)!, secondPath[0], "middle");
  const points = [
    start,
    ...firstPath.slice(1, -1),
    middle,
    ...secondPath.slice(1, -1),
  ].map((point, index) => ({ ...point, id: createDocumentId(`joined-point-${index + 1}`) }));
  if (points.length < 3 || polygonArea(points) < 4 || selfIntersects(points)) return null;

  const newId = createDocumentId("piece");
  const transformSecondVector = (vectorValue: PatternVector) => rotateVector(vectorValue, secondTransform.rotationDeg - firstTransform.rotationDeg);
  const secondInternal = (second.internalLines ?? []).map((line): PatternInternalLine => {
    if (isInternalPath(line)) {
      return {
        ...structuredClone(line),
        pieceId: newId,
        nodes: line.nodes.map((node) => ({
          ...node,
          ...worldToLocal(localToWorld(node, secondTransform), firstTransform),
          handleIn: node.handleIn ? transformSecondVector(node.handleIn) : undefined,
          handleOut: node.handleOut ? transformSecondVector(node.handleOut) : undefined,
        })),
        metadata: clearBoundaryMetadata(line.metadata),
      };
    }
    return {
      ...structuredClone(line),
      pieceId: newId,
      points: line.points.map((point) => ({
        ...point,
        ...worldToLocal(localToWorld(point, secondTransform), firstTransform),
        handleIn: point.handleIn ? transformSecondVector(point.handleIn) : undefined,
        handleOut: point.handleOut ? transformSecondVector(point.handleOut) : undefined,
      })),
    };
  });
  const firstInternal = (first.internalLines ?? []).map((line): PatternInternalLine => isInternalPath(line)
    ? { ...structuredClone(line), pieceId: newId, metadata: clearBoundaryMetadata(line.metadata) }
    : { ...structuredClone(line), pieceId: newId });
  const secondDarts = (second.darts ?? []).map((dart) => transformDartBetweenWorkspaces(dart, newId, secondTransform, firstTransform));
  const firstDarts = (first.darts ?? []).map((dart) => ({ ...structuredClone(dart), pieceId: newId }));
  return migrateLegacyPieceToSegments({
    ...structuredClone(first),
    id: newId,
    name: `${first.name} + ${second.name}`,
    points,
    internalLines: [...firstInternal, ...secondInternal],
    darts: [...firstDarts, ...secondDarts],
    previewPlacements: undefined,
    edgeFinishes: {},
    formatVersion: undefined,
    nodes: undefined,
    segments: undefined,
    contours: undefined,
  });
}

function contourWithoutEdge(points: PatternPoint[], edgeIndex: number): PatternPoint[] {
  const result: PatternPoint[] = [];
  let index = (edgeIndex + 1) % points.length;
  for (let count = 0; count < points.length; count += 1) {
    result.push(points[index]);
    if (index === edgeIndex) break;
    index = (index + 1) % points.length;
  }
  if (result[0]) delete result[0].handleIn;
  if (result.at(-1)) delete result.at(-1)!.handleOut;
  return result;
}

function mergeJoinPoint(first: PatternPoint, second: PatternPoint, side: "middle" | "closure"): PatternPoint {
  return side === "middle"
    ? {
        ...first,
        xMm: (first.xMm + second.xMm) / 2,
        yMm: (first.yMm + second.yMm) / 2,
        handleOut: second.handleOut ? { ...second.handleOut } : undefined,
      }
    : {
        ...first,
        xMm: (first.xMm + second.xMm) / 2,
        yMm: (first.yMm + second.yMm) / 2,
        handleIn: second.handleIn ? { ...second.handleIn } : undefined,
      };
}

function transformPointBetweenWorkspaces(
  point: PatternPoint,
  source: PieceWorkspaceTransform,
  target: PieceWorkspaceTransform,
): PatternPoint {
  const local = worldToLocal(localToWorld(point, source), target);
  const delta = source.rotationDeg - target.rotationDeg;
  return {
    ...clonePoint(point),
    ...local,
    handleIn: point.handleIn ? rotateVector(point.handleIn, delta) : undefined,
    handleOut: point.handleOut ? rotateVector(point.handleOut, delta) : undefined,
  };
}

function transformDartBetweenWorkspaces(
  dart: PatternDart,
  pieceId: string,
  source: PieceWorkspaceTransform,
  target: PieceWorkspaceTransform,
): PatternDart {
  const transform = (point: PatternVector) => worldToLocal(localToWorld(point, source), target);
  const apex = transform(dart.apex);
  const center = transform(dart.centerLine.start);
  return {
    ...structuredClone(dart),
    pieceId,
    apex,
    legA: transform(dart.legA),
    legB: transform(dart.legB),
    centerLine: { start: center, end: apex },
    directionDeg: Math.atan2(apex.yMm - center.yMm, apex.xMm - center.xMm) * 180 / Math.PI,
  };
}

function clearBoundaryMetadata(metadataValue: InternalPath["metadata"]): InternalPath["metadata"] {
  const metadata = { ...metadataValue };
  delete metadata[CUT_START_EDGE_KEY];
  delete metadata[CUT_START_T_KEY];
  delete metadata[CUT_END_EDGE_KEY];
  delete metadata[CUT_END_T_KEY];
  metadata.boundaryReferenceInvalidatedByJoin = true;
  return metadata;
}

function clippedInfiniteLine(
  contour: readonly PatternVector[],
  origin: PatternVector,
  direction: PatternVector,
): [PatternVector, PatternVector] | null {
  const hits: Array<{ point: PatternVector; projection: number }> = [];
  const reach = Math.max(10000, Math.hypot(...[boundsOf(contour).maxX - boundsOf(contour).minX, boundsOf(contour).maxY - boundsOf(contour).minY]) * 5);
  const start = { xMm: origin.xMm - direction.xMm * reach, yMm: origin.yMm - direction.yMm * reach };
  const end = { xMm: origin.xMm + direction.xMm * reach, yMm: origin.yMm + direction.yMm * reach };
  for (let index = 0; index < contour.length; index += 1) {
    const hit = segmentIntersection(start, end, contour[index], contour[(index + 1) % contour.length]);
    if (!hit) continue;
    if (hits.some((candidate) => distance(candidate.point, hit) < 0.05)) continue;
    hits.push({ point: hit, projection: (hit.xMm - origin.xMm) * direction.xMm + (hit.yMm - origin.yMm) * direction.yMm });
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.projection - b.projection);
  return [hits[0].point, hits.at(-1)!.point];
}

function transformedBounds(piece: PatternPiece, transform: PieceWorkspaceTransform): Bounds {
  return boundsOf(samplePatternContour(piece.points).map((point) => localToWorld(point, transform)));
}

function boundsOf(points: readonly PatternVector[]): Bounds {
  return {
    minX: Math.min(...points.map((point) => point.xMm)),
    minY: Math.min(...points.map((point) => point.yMm)),
    maxX: Math.max(...points.map((point) => point.xMm)),
    maxY: Math.max(...points.map((point) => point.yMm)),
  };
}

function unionBounds(bounds: readonly Bounds[]): Bounds {
  return {
    minX: Math.min(...bounds.map((item) => item.minX)),
    minY: Math.min(...bounds.map((item) => item.minY)),
    maxX: Math.max(...bounds.map((item) => item.maxX)),
    maxY: Math.max(...bounds.map((item) => item.maxY)),
  };
}

function center(bounds: Bounds, axis: DistributionAxis): number {
  return axis === "horizontal" ? (bounds.minX + bounds.maxX) / 2 : (bounds.minY + bounds.maxY) / 2;
}

function workspaceStateFor(garment: GarmentDraft, pieceId: string): PieceWorkspaceState {
  return garment.workspaceStates?.find((state) => state.pieceId === pieceId) ?? {
    pieceId,
    transform: garment.workspaceTransforms?.find((transform) => transform.pieceId === pieceId) ?? { pieceId, xMm: 0, yMm: 0, rotationDeg: 0 },
    visible: true,
    locked: false,
  };
}

function patchWorkspaceTransform(garment: GarmentDraft, pieceId: string, transform: PieceWorkspaceTransform): GarmentDraft {
  const existing = workspaceStateFor(garment, pieceId);
  const states = [...(garment.workspaceStates ?? []).filter((state) => state.pieceId !== pieceId), { ...existing, pieceId, transform: { ...transform, pieceId } }];
  return syncWorkspace({ ...garment, workspaceStates: states });
}

function syncWorkspace(garment: GarmentDraft): GarmentDraft {
  const states = (garment.workspaceStates ?? garment.pieces.map((piece) => workspaceStateFor(garment, piece.id)))
    .filter((state) => garment.pieces.some((piece) => piece.id === state.pieceId));
  return {
    ...garment,
    workspaceStates: states,
    workspaceTransforms: states.map((state) => ({ ...state.transform, pieceId: state.pieceId })),
  };
}

function localToWorld(point: PatternVector, transform: PieceWorkspaceTransform): PatternVector {
  const angle = transform.rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    xMm: point.xMm * cos - point.yMm * sin + transform.xMm,
    yMm: point.xMm * sin + point.yMm * cos + transform.yMm,
  };
}

function worldToLocal(point: PatternVector, transform: PieceWorkspaceTransform): PatternVector {
  const dx = point.xMm - transform.xMm;
  const dy = point.yMm - transform.yMm;
  const angle = -transform.rotationDeg * Math.PI / 180;
  return { xMm: dx * Math.cos(angle) - dy * Math.sin(angle), yMm: dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function rotateVector(point: PatternVector, degrees: number): PatternVector {
  const angle = degrees * Math.PI / 180;
  return { xMm: point.xMm * Math.cos(angle) - point.yMm * Math.sin(angle), yMm: point.xMm * Math.sin(angle) + point.yMm * Math.cos(angle) };
}

function approximateEdgeLength(start: PatternPoint, end: PatternPoint): number {
  const points = samplePatternContour([
    { ...start, id: "edge-start" },
    { ...end, id: "edge-end" },
  ]);
  if (points.length < 2) return distance(start, end);
  let total = 0;
  for (let index = 0; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
  return total;
}

function selfIntersects(points: PatternPoint[]): boolean {
  const sampled = samplePatternContour(points);
  for (let first = 0; first < sampled.length; first += 1) {
    const a = sampled[first];
    const b = sampled[(first + 1) % sampled.length];
    for (let second = first + 2; second < sampled.length; second += 1) {
      if ((second + 1) % sampled.length === first) continue;
      const c = sampled[second];
      const d = sampled[(second + 1) % sampled.length];
      const hit = segmentIntersection(a, b, c, d);
      if (hit && distance(hit, a) > 0.01 && distance(hit, b) > 0.01 && distance(hit, c) > 0.01 && distance(hit, d) > 0.01) return true;
    }
  }
  return false;
}

function segmentIntersection(a: PatternVector, b: PatternVector, c: PatternVector, d: PatternVector): PatternVector | null {
  const r = { xMm: b.xMm - a.xMm, yMm: b.yMm - a.yMm };
  const s = { xMm: d.xMm - c.xMm, yMm: d.yMm - c.yMm };
  const denominator = r.xMm * s.yMm - r.yMm * s.xMm;
  if (Math.abs(denominator) < 1e-9) return null;
  const q = { xMm: c.xMm - a.xMm, yMm: c.yMm - a.yMm };
  const t = (q.xMm * s.yMm - q.yMm * s.xMm) / denominator;
  const u = (q.xMm * r.yMm - q.yMm * r.xMm) / denominator;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return { xMm: a.xMm + r.xMm * t, yMm: a.yMm + r.yMm * t };
}

function polygonArea(points: readonly PatternVector[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.xMm * next.yMm - next.xMm * current.yMm;
  }
  return Math.abs(sum) / 2;
}

function clonePoint(point: PatternPoint): PatternPoint {
  return {
    ...point,
    handleIn: point.handleIn ? { ...point.handleIn } : undefined,
    handleOut: point.handleOut ? { ...point.handleOut } : undefined,
  };
}

function vector(point: PatternVector): PatternVector {
  return { xMm: point.xMm, yMm: point.yMm };
}

function distance(a: PatternVector, b: PatternVector): number {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

function success(
  garment: GarmentDraft,
  activePieceId: string,
  selectedPieceIds: string[],
  diagnostics: string[],
): ModelingOperationResult {
  return { ok: true, garment, activePieceId, selectedPieceIds, diagnostics };
}

function failure(garment: GarmentDraft, message: string): ModelingOperationResult {
  return { ok: false, garment, activePieceId: "", selectedPieceIds: [], diagnostics: [message] };
}
