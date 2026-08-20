import type {
  EdgeRange,
  PatternDart,
  PatternEdge,
  PatternPiece,
  PatternPoint,
} from "../domain/pattern";
import { getPatternEdges } from "../domain/pattern";
import {
  samplePatternSegment,
  triangulatePatternContour,
} from "../domain/polygonGeometry";
import type { PatternContourResult } from "../domain/polygonGeometry";
import type {
  DartTopology,
  PanelEdgePath,
  PanelTopology as CanonicalPanelTopology,
  PanelVertexSourceMapping,
} from "./types";

/**
 * Durante a migração, mantemos alguns campos antigos para que os módulos
 * criados anteriormente continuem compilando.
 *
 * Eles serão removidos depois que PanelSimulation e
 * StitchConstraintBuilder forem migrados para os tipos canônicos.
 */
export interface PanelTopology extends CanonicalPanelTopology {
  /**
   * @deprecated Use positions2DMm.
   *
   * Versão das posições convertida para metros.
   */
  positions2D: Float32Array;

  /**
   * @deprecated Use edges.
   */
  edgeVertices: Map<string, number[]>;

  /**
   * @deprecated Use sourcePointVertices.
   */
  sourcePointToVertices: Map<string, number[]>;
}

interface PendingEdgePath {
  edge: PatternEdge;
  startIndex: number;
  sampledPointCount: number;
  reversed: boolean;
}

interface OrderedEdgeTraversal {
  edge: PatternEdge;
  reversed: boolean;
}

interface MaterializedDartTriangulation {
  dart: PatternDart;
  legAIndex: number;
  legBIndex: number;
  apexIndex: number;
  triangulation: PatternContourResult;
}

const EDGE_SAMPLE_SPACING_MM = 20;
const PARAMETER_EPSILON = 1e-6;
const GEOMETRY_EPSILON_MM = 1e-5;
const DEFAULT_METERS_PER_MM = 0.001;

/**
 * Constrói a topologia intermediária de uma peça.
 *
 * Responsabilidades:
 * - preservar a ordem do contorno;
 * - preservar a relação borda -> vértices;
 * - amostrar curvas;
 * - adicionar pontos em bordas retas longas;
 * - garantir que todos os vértices de borda sejam usados por triângulos;
 * - manter milímetros na topologia lógica;
 * - fornecer temporariamente uma versão em metros para o código antigo.
 */
export function buildPanelTopology(
  piece: PatternPiece,
  metersPerMm = DEFAULT_METERS_PER_MM,
  geometrySignature = pieceGeometrySignature(piece),
): PanelTopology {
  if (!Number.isFinite(metersPerMm) || metersPerMm <= 0) {
    throw new RangeError(
      "O fator de conversão de milímetros para metros precisa ser positivo.",
    );
  }

  const orderedEdges = getOrderedPatternEdgeTraversals(piece);

  if (orderedEdges.length < 3) {
    throw new Error(
      `A peça ${piece.name} não possui bordas suficientes para formar um painel.`,
    );
  }

  const contour: PatternPoint[] = [];
  const vertexSources: PanelVertexSourceMapping[] = [];
  const pendingPaths: PendingEdgePath[] = [];

  for (const traversal of orderedEdges) {
    const { edge, reversed } = traversal;
    const start = piece.points.find(
      (point) => point.id === edge.startPointId,
    );
    const end = piece.points.find(
      (point) => point.id === edge.endPointId,
    );

    if (!start || !end) {
      throw new Error(
        `A borda ${edge.id} referencia um ponto inexistente.`,
      );
    }

    const canonicalSamples = injectDartMouthSamples(
      sampleEdgeWithSpacing(start, end),
      piece.darts ?? [],
      start,
      end,
    );
    const samples = reversed ? [...canonicalSamples].reverse() : canonicalSamples;

    if (samples.length < 2) {
      throw new Error(
        `Não foi possível amostrar a borda ${edge.id}.`,
      );
    }

    const startIndex = contour.length;

    /*
     * Triangulation needs one continuous contour walk, but EdgeRange.t remains
     * canonical in the authored segment direction. A contour is therefore
     * allowed to traverse a segment backwards without changing edgeId/t.
     */
    const curved = start.handleOut !== undefined || end.handleIn !== undefined;
    samples.slice(0, -1).forEach((sample, sampleIndex) => {
      const vertexIndex = contour.length;
      const traversalT = sampleIndex / Math.max(1, samples.length - 1);
      const t = curved
        ? (reversed ? 1 - traversalT : traversalT)
        : lineParameter(start, end, sample);
      contour.push(sample);
      vertexSources.push({
        vertexIndex,
        sourcePatternId: piece.id,
        ...(t <= PARAMETER_EPSILON
          ? { sourcePointId: start.id }
          : t >= 1 - PARAMETER_EPSILON
            ? { sourcePointId: end.id }
            : {}),
        sourceSegmentId: edge.id,
        edgeId: edge.id,
        t,
        interpolation: { startPointId: start.id, endPointId: end.id, t },
        restPosition2DMm: { x: sample.xMm, y: sample.yMm },
      });
    });

    pendingPaths.push({
      edge,
      startIndex,
      sampledPointCount: samples.length,
      reversed,
    });
  }

  if (contour.length < 3) {
    throw new Error(
      `A peça ${piece.name} não possui um contorno válido.`,
    );
  }

  const boundaryVertexCount = contour.length;
  const closedDarts = (piece.darts ?? []).filter((dart) => dart.closed);
  const dartTriangulation = closedDarts.length === 1
    ? appendDartApexAndTriangulate(
        contour,
        vertexSources,
        piece.id,
        closedDarts[0],
      )
    : null;
  const triangulation = dartTriangulation?.triangulation
    ?? triangulatePatternContour(contour);

  if (!triangulation.ok) {
    throw new Error(
      `${piece.name}: ${triangulation.issues.join(" ")}`,
    );
  }

  const triangleIndices = [...triangulation.indices];

  /*
   * O ear clipping existente pode remover pontos colineares.
   * Esses pontos são importantes para costuras, então eles são inseridos
   * novamente nos triângulos correspondentes.
   */
  includeAllBoundaryVertices(
    contour,
    triangleIndices,
    boundaryVertexCount,
  );

  const positions2DMm = createPositionArray(contour, 1);
  const positions2D = createPositionArray(contour, metersPerMm);

  const sourcePointVertices = new Map<string, number[]>();
  const edges = new Map<string, PanelEdgePath>();

  for (const pending of pendingPaths) {
    const vertexIndices: number[] = [];

    /*
     * sampledPointCount inclui o ponto final. Como o ponto final está no
     * início da próxima borda, o último índice pode dar a volta para zero.
     */
    for (
      let sampleIndex = 0;
      sampleIndex < pending.sampledPointCount;
      sampleIndex += 1
    ) {
      const vertexIndex =
        (pending.startIndex + sampleIndex) % boundaryVertexCount;

      if (
        vertexIndices.length === 0 ||
        vertexIndices.at(-1) !== vertexIndex
      ) {
        vertexIndices.push(vertexIndex);
      }
    }

    const canonicalVertexIndices = pending.reversed
      ? [...vertexIndices].reverse()
      : vertexIndices;
    const path = createPanelEdgePath(
      piece.id,
      pending.edge.id,
      canonicalVertexIndices,
      positions2DMm,
    );

    edges.set(pending.edge.id, path);

    addSourcePointMapping(
      sourcePointVertices,
      pending.edge.startPointId,
      vertexIndices[0],
    );

    addSourcePointMapping(
      sourcePointVertices,
      pending.edge.endPointId,
      vertexIndices.at(-1)!,
    );
  }

  const edgeVertices = new Map(
    [...edges.entries()].map(([edgeId, path]) => [
      edgeId,
      [...path.vertexIndices],
    ]),
  );

  const darts: DartTopology[] = (piece.darts ?? []).map((dart) => {
    const materialized = dartTriangulation?.dart.id === dart.id
      ? dartTriangulation
      : null;
    return {
      dart: structuredClone(dart),
      legAVertices: materialized
        ? [materialized.legAIndex, materialized.apexIndex]
        : [],
      legBVertices: materialized
        ? [materialized.legBIndex, materialized.apexIndex]
        : [],
      apexVertex: materialized?.apexIndex ?? null,
    };
  });

  const boundsMm = calculateBounds(contour);

  return {
    pieceId: piece.id,
    sourcePatternId: piece.id,
    pieceName: piece.name,
    geometrySignature,
    sourcePiece: structuredClone(piece),

    positions2DMm,
    triangles: new Uint32Array(triangleIndices),
    boundaryVertices: Array.from(
      { length: boundaryVertexCount },
      (_, index) => index,
    ),
    edges,
    sourcePointVertices,
    vertexSources,
    darts,
    boundsMm,

    /*
     * Campos temporários de compatibilidade.
     */
    positions2D,
    edgeVertices,
    sourcePointToVertices: sourcePointVertices,
  };
}

/**
 * Retorna os vértices pertencentes ao intervalo selecionado de uma borda.
 */
export function getEdgeVertexRange(
  topology: PanelTopology,
  edgeRange: EdgeRange,
): number[] {
  if (edgeRange.pieceId !== topology.pieceId) {
    return [];
  }

  const path = topology.edges.get(edgeRange.edgeId);

  if (!path || path.vertexIndices.length === 0) {
    return [];
  }

  if (
    edgeRange.startT <= PARAMETER_EPSILON &&
    edgeRange.endT >= 1 - PARAMETER_EPSILON
  ) {
    return [...path.vertexIndices];
  }

  const startDistance =
    clamp01(edgeRange.startT) * path.lengthMm;
  const endDistance =
    clamp01(edgeRange.endT) * path.lengthMm;

  let startIndex = findClosestCumulativeIndex(
    path.cumulativeLengthsMm,
    startDistance,
  );
  let endIndex = findClosestCumulativeIndex(
    path.cumulativeLengthsMm,
    endDistance,
  );

  if (startIndex > endIndex) {
    [startIndex, endIndex] = [endIndex, startIndex];
  }

  /*
   * Uma costura parcial com tamanho real não deve virar apenas um ponto
   * por causa da discretização da borda.
   */
  if (
    startIndex === endIndex &&
    edgeRange.endT - edgeRange.startT > PARAMETER_EPSILON &&
    path.vertexIndices.length > 1
  ) {
    if (endIndex < path.vertexIndices.length - 1) {
      endIndex += 1;
    } else {
      startIndex -= 1;
    }
  }

  return path.vertexIndices.slice(startIndex, endIndex + 1);
}

/**
 * Compatibilidade temporária com o StitchConstraintBuilder atual.
 *
 * Esta função ainda retorna índices reais. Posteriormente ela será
 * substituída por referências interpoladas, permitindo correspondência
 * exata entre bordas com subdivisões diferentes.
 */
export function resampleEdgeVertices(
  topology: PanelTopology,
  vertexIndices: number[],
  sampleCount: number,
): number[] {
  if (vertexIndices.length === 0) {
    return [];
  }

  if (vertexIndices.length === 1) {
    return [vertexIndices[0]];
  }

  const count = Math.max(2, Math.floor(sampleCount));
  const cumulativeLengths = calculateCumulativeLengths(
    vertexIndices,
    topology.positions2DMm,
  );
  const totalLength = cumulativeLengths.at(-1) ?? 0;

  const result: number[] = [];

  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const t =
      count <= 1 ? 0 : sampleIndex / (count - 1);

    const targetDistance = totalLength * t;
    const closestIndex = findClosestCumulativeIndex(
      cumulativeLengths,
      targetDistance,
    );
    const vertexIndex = vertexIndices[closestIndex];

    if (result.at(-1) !== vertexIndex) {
      result.push(vertexIndex);
    }
  }

  return result;
}

function getOrderedPatternEdgeTraversals(
  piece: PatternPiece,
): OrderedEdgeTraversal[] {
  const availableEdges = getPatternEdges(piece);
  const edgeById = new Map(
    availableEdges.map((edge) => [edge.id, edge]),
  );

  const outerContour =
    piece.contours?.find((contour) => contour.closed) ??
    piece.contours?.[0];

  const fallback = () => availableEdges.map((edge) => ({ edge, reversed: false }));
  if (!outerContour?.segmentIds.length) return fallback();

  const orderedEdges = outerContour.segmentIds
    .map((segmentId) => edgeById.get(segmentId))
    .filter((edge): edge is PatternEdge => Boolean(edge));

  /*
   * Em projetos legados incompletos, é mais seguro usar getPatternEdges
   * do que retornar apenas parte do contorno.
   */
  if (orderedEdges.length !== availableEdges.length) return fallback();

  // `segmentIds` defines contour order, not necessarily the canonical material
  // direction of each segment. Try both orientations for the first edge and
  // derive every subsequent traversal from endpoint connectivity. Prefer the
  // authored first-edge direction when both closed walks are equivalent.
  return orientClosedContour(orderedEdges, false)
    ?? orientClosedContour(orderedEdges, true)
    ?? fallback();
}

function orientClosedContour(
  edges: readonly PatternEdge[],
  reverseFirst: boolean,
): OrderedEdgeTraversal[] | null {
  if (edges.length === 0) return [];
  const result: OrderedEdgeTraversal[] = [{ edge: edges[0], reversed: reverseFirst }];
  const firstStart = reverseFirst ? edges[0].endPointId : edges[0].startPointId;
  let currentEnd = reverseFirst ? edges[0].startPointId : edges[0].endPointId;

  for (let index = 1; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.startPointId === currentEnd) {
      result.push({ edge, reversed: false });
      currentEnd = edge.endPointId;
      continue;
    }
    if (edge.endPointId === currentEnd) {
      result.push({ edge, reversed: true });
      currentEnd = edge.startPointId;
      continue;
    }
    return null;
  }

  return currentEnd === firstStart ? result : null;
}

function sampleEdgeWithSpacing(
  start: PatternPoint,
  end: PatternPoint,
): PatternPoint[] {
  const sampledSegment = samplePatternSegment(start, end);

  /*
   * Curvas já são amostradas por samplePatternSegment.
   */
  if (sampledSegment.length > 2) {
    return sampledSegment;
  }

  const lengthMm = Math.hypot(
    end.xMm - start.xMm,
    end.yMm - start.yMm,
  );

  const steps = Math.max(
    1,
    Math.ceil(lengthMm / EDGE_SAMPLE_SPACING_MM),
  );

  if (steps === 1) {
    return [
      structuredClone(start),
      structuredClone(end),
    ];
  }

  const samples: PatternPoint[] = [];

  for (let step = 0; step <= steps; step += 1) {
    if (step === 0) {
      samples.push(structuredClone(start));
      continue;
    }

    if (step === steps) {
      samples.push(structuredClone(end));
      continue;
    }

    const t = step / steps;

    samples.push({
      id: `${start.id}::${end.id}::sample-${step}`,
      xMm: start.xMm + (end.xMm - start.xMm) * t,
      yMm: start.yMm + (end.yMm - start.yMm) * t,
    });
  }

  return samples;
}

/**
 * A dart mouth is part of the material boundary even when it was authored as
 * an internal-path operation.  Making both legs explicit boundary vertices is
 * what lets the constrained triangulation below create real fold edges.
 */
function injectDartMouthSamples(
  samples: readonly PatternPoint[],
  darts: readonly PatternDart[],
  start: PatternPoint,
  end: PatternPoint,
): PatternPoint[] {
  const result = samples.map((sample) => structuredClone(sample));
  let inserted = false;

  for (const dart of darts) {
    for (const [legName, leg] of [
      ["a", dart.legA],
      ["center", dart.centerLine.start],
      ["b", dart.legB],
    ] as const) {
      const point: PatternPoint = {
        id: `${dart.id}:leg-${legName}`,
        xMm: leg.xMm,
        yMm: leg.yMm,
      };
      if (!pointOnSegment(point, start, end)) continue;
      if (result.some((candidate) => pointsCoincide(candidate, point))) continue;
      result.push(point);
      inserted = true;
    }
  }

  return inserted ? result.sort(
    (first, second) => lineParameter(start, end, first) - lineParameter(start, end, second),
  ) : result;
}

function appendDartApexAndTriangulate(
  contour: PatternPoint[],
  vertexSources: PanelVertexSourceMapping[],
  pieceId: string,
  dart: PatternDart,
): MaterializedDartTriangulation | null {
  const legAIndex = matchingVertexIndex(contour, dart.legA);
  const legBIndex = matchingVertexIndex(contour, dart.legB);
  if (legAIndex < 0 || legBIndex < 0 || legAIndex === legBIndex) return null;

  const forwardAtoB = cyclicVertexPath(legAIndex, legBIndex, contour.length);
  const forwardBtoA = cyclicVertexPath(legBIndex, legAIndex, contour.length);
  const lengthAtoB = polylineLengthMm(forwardAtoB, contour);
  const lengthBtoA = polylineLengthMm(forwardBtoA, contour);
  const mouthBoundary = lengthAtoB <= lengthBtoA ? forwardAtoB : forwardBtoA;
  const bodyBoundary = lengthAtoB <= lengthBtoA ? forwardBtoA : forwardAtoB;
  const apexIndex = contour.length;
  const apex: PatternPoint = {
    id: `${dart.id}:apex`,
    xMm: dart.apex.xMm,
    yMm: dart.apex.yMm,
  };

  const centerIndex = matchingVertexIndex(contour, dart.centerLine.start);
  const centerCursor = mouthBoundary.indexOf(centerIndex);
  const mouthParts = centerCursor > 0 && centerCursor < mouthBoundary.length - 1
    ? [
        mouthBoundary.slice(0, centerCursor + 1),
        mouthBoundary.slice(centerCursor),
      ]
    : [mouthBoundary];
  const mouths = mouthParts.map((part) =>
    triangulateIndexedSubpolygon(part, apexIndex, apex, contour));
  const body = triangulateIndexedSubpolygon(bodyBoundary, apexIndex, apex, contour);
  if (mouths.some((mouth) => !mouth.ok) || !body.ok) return null;

  contour.push(apex);
  vertexSources.push({
    vertexIndex: apexIndex,
    sourcePatternId: pieceId,
    restPosition2DMm: { x: apex.xMm, y: apex.yMm },
  });

  return {
    dart,
    legAIndex,
    legBIndex,
    apexIndex,
    triangulation: {
      ok: true,
      indices: [
        ...mouths.flatMap((mouth) => mouth.ok ? mouth.indices : []),
        ...body.indices,
      ],
      signedAreaMm2: mouths.reduce(
        (total, mouth) => total + (mouth.ok ? mouth.signedAreaMm2 : 0),
        body.signedAreaMm2,
      ),
    },
  };
}

function triangulateIndexedSubpolygon(
  boundary: readonly number[],
  apexIndex: number,
  apex: PatternPoint,
  contour: readonly PatternPoint[],
): PatternContourResult {
  const points = [...boundary.map((index) => contour[index]), apex];
  const validation = triangulatePatternContour(points);
  if (!validation.ok) return validation;
  const indices: number[] = [];
  for (let cursor = 0; cursor < boundary.length - 1; cursor += 1) {
    const firstIndex = boundary[cursor];
    const secondIndex = boundary[cursor + 1];
    const first = contour[firstIndex];
    const second = contour[secondIndex];
    const cross = (second.xMm - first.xMm) * (apex.yMm - first.yMm)
      - (second.yMm - first.yMm) * (apex.xMm - first.xMm);
    if (Math.abs(cross) <= GEOMETRY_EPSILON_MM) continue;
    indices.push(...(cross > 0
      ? [firstIndex, secondIndex, apexIndex]
      : [secondIndex, firstIndex, apexIndex]));
  }
  return {
    ok: true,
    indices,
    signedAreaMm2: validation.signedAreaMm2,
  };
}

function cyclicVertexPath(from: number, to: number, count: number): number[] {
  const result = [from];
  let current = from;
  while (current !== to && result.length <= count) {
    current = (current + 1) % count;
    result.push(current);
  }
  return result;
}

function polylineLengthMm(
  indices: readonly number[],
  contour: readonly PatternPoint[],
): number {
  let result = 0;
  for (let index = 1; index < indices.length; index += 1) {
    const previous = contour[indices[index - 1]];
    const current = contour[indices[index]];
    result += Math.hypot(current.xMm - previous.xMm, current.yMm - previous.yMm);
  }
  return result;
}

function matchingVertexIndex(
  contour: readonly PatternPoint[],
  point: { xMm: number; yMm: number },
): number {
  return contour.findIndex((candidate) => pointsCoincide(candidate, point));
}

function pointsCoincide(
  first: { xMm: number; yMm: number },
  second: { xMm: number; yMm: number },
): boolean {
  return Math.hypot(first.xMm - second.xMm, first.yMm - second.yMm)
    <= GEOMETRY_EPSILON_MM;
}

function pointOnSegment(
  point: { xMm: number; yMm: number },
  start: { xMm: number; yMm: number },
  end: { xMm: number; yMm: number },
): boolean {
  const t = lineParameter(start, end, point);
  const projectedX = start.xMm + (end.xMm - start.xMm) * t;
  const projectedY = start.yMm + (end.yMm - start.yMm) * t;
  return Math.hypot(point.xMm - projectedX, point.yMm - projectedY)
    <= GEOMETRY_EPSILON_MM;
}

function lineParameter(
  start: { xMm: number; yMm: number },
  end: { xMm: number; yMm: number },
  point: { xMm: number; yMm: number },
): number {
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const denominator = dx * dx + dy * dy;
  if (denominator <= GEOMETRY_EPSILON_MM * GEOMETRY_EPSILON_MM) return 0;
  return clamp01(((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) / denominator);
}

function createPositionArray(
  contour: readonly PatternPoint[],
  scale: number,
): Float32Array {
  const positions = new Float32Array(contour.length * 2);

  for (let index = 0; index < contour.length; index += 1) {
    positions[index * 2] = contour[index].xMm * scale;
    positions[index * 2 + 1] = contour[index].yMm * scale;
  }

  return positions;
}

function createPanelEdgePath(
  pieceId: string,
  edgeId: string,
  vertexIndices: number[],
  positions2DMm: Float32Array,
): PanelEdgePath {
  const cumulativeLengthsMm = calculateCumulativeLengths(
    vertexIndices,
    positions2DMm,
  );

  return {
    pieceId,
    edgeId,
    vertexIndices: [...vertexIndices],
    cumulativeLengthsMm,
    lengthMm: cumulativeLengthsMm.at(-1) ?? 0,
  };
}

function calculateCumulativeLengths(
  vertexIndices: readonly number[],
  positions: Float32Array,
): number[] {
  if (vertexIndices.length === 0) {
    return [];
  }

  const cumulative = [0];
  let total = 0;

  for (let index = 1; index < vertexIndices.length; index += 1) {
    const previous = vertexIndices[index - 1];
    const current = vertexIndices[index];

    const dx =
      positions[current * 2] -
      positions[previous * 2];
    const dy =
      positions[current * 2 + 1] -
      positions[previous * 2 + 1];

    total += Math.hypot(dx, dy);
    cumulative.push(total);
  }

  return cumulative;
}

function addSourcePointMapping(
  mapping: Map<string, number[]>,
  pointId: string,
  vertexIndex: number,
): void {
  const existing = mapping.get(pointId) ?? [];

  if (!existing.includes(vertexIndex)) {
    existing.push(vertexIndex);
  }

  mapping.set(pointId, existing);
}

/**
 * A triangulação atual remove vértices colineares durante o ear clipping.
 *
 * Em vez de deixar esses vértices soltos, dividimos o triângulo cuja aresta
 * contém o ponto. Assim, todo vértice de borda continua pertencendo à malha.
 */
function includeAllBoundaryVertices(
  contour: readonly PatternPoint[],
  triangles: number[],
  boundaryVertexCount = contour.length,
): void {
  for (
    let boundaryIndex = 0;
    boundaryIndex < boundaryVertexCount;
    boundaryIndex += 1
  ) {
    if (triangles.includes(boundaryIndex)) {
      continue;
    }

    const inserted = insertVertexIntoTriangleEdge(
      boundaryIndex,
      contour,
      triangles,
    );

    if (!inserted) {
      throw new Error(
        `Não foi possível integrar o vértice de borda ${boundaryIndex} à triangulação.`,
      );
    }
  }
}

function insertVertexIntoTriangleEdge(
  vertexIndex: number,
  points: readonly PatternPoint[],
  triangles: number[],
): boolean {
  const point = points[vertexIndex];

  for (
    let triangleOffset = 0;
    triangleOffset < triangles.length;
    triangleOffset += 3
  ) {
    const triangle = [
      triangles[triangleOffset],
      triangles[triangleOffset + 1],
      triangles[triangleOffset + 2],
    ] as const;

    const directedEdges: Array<
      readonly [number, number, number]
    > = [
      [triangle[0], triangle[1], triangle[2]],
      [triangle[1], triangle[2], triangle[0]],
      [triangle[2], triangle[0], triangle[1]],
    ];

    for (const [startIndex, endIndex, oppositeIndex] of directedEdges) {
      if (
        !pointStrictlyInsideSegment(
          point,
          points[startIndex],
          points[endIndex],
        )
      ) {
        continue;
      }

      triangles.splice(
        triangleOffset,
        3,

        startIndex,
        vertexIndex,
        oppositeIndex,

        vertexIndex,
        endIndex,
        oppositeIndex,
      );

      return true;
    }
  }

  return false;
}

function pointStrictlyInsideSegment(
  point: PatternPoint,
  start: PatternPoint,
  end: PatternPoint,
): boolean {
  const segmentX = end.xMm - start.xMm;
  const segmentY = end.yMm - start.yMm;
  const lengthSquared =
    segmentX * segmentX + segmentY * segmentY;

  if (lengthSquared <= GEOMETRY_EPSILON_MM) {
    return false;
  }

  const relativeX = point.xMm - start.xMm;
  const relativeY = point.yMm - start.yMm;

  const t =
    (relativeX * segmentX + relativeY * segmentY) /
    lengthSquared;

  if (
    t <= PARAMETER_EPSILON ||
    t >= 1 - PARAMETER_EPSILON
  ) {
    return false;
  }

  const projectedX = start.xMm + segmentX * t;
  const projectedY = start.yMm + segmentY * t;

  const distanceToSegment = Math.hypot(
    point.xMm - projectedX,
    point.yMm - projectedY,
  );

  return distanceToSegment <= GEOMETRY_EPSILON_MM;
}

function calculateBounds(
  points: readonly PatternPoint[],
): CanonicalPanelTopology["boundsMm"] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.xMm);
    minY = Math.min(minY, point.yMm);
    maxX = Math.max(maxX, point.xMm);
    maxY = Math.max(maxY, point.yMm);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function findClosestCumulativeIndex(
  cumulativeLengths: readonly number[],
  target: number,
): number {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (
    let index = 0;
    index < cumulativeLengths.length;
    index += 1
  ) {
    const distance = Math.abs(
      cumulativeLengths[index] - target,
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pieceGeometrySignature(piece: PatternPiece): string {
  const value = JSON.stringify({
    id: piece.id,
    points: piece.points,
    nodes: piece.nodes,
    segments: piece.segments,
    contours: piece.contours,
    internalLines: piece.internalLines,
    darts: piece.darts,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
