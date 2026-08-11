import type {
  EdgeRange,
  PatternEdge,
  PatternPiece,
  PatternPoint,
} from "../domain/pattern";
import { getPatternEdges } from "../domain/pattern";
import {
  samplePatternSegment,
  triangulatePatternContour,
} from "../domain/polygonGeometry";
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

  const orderedEdges = getOrderedPatternEdges(piece);

  if (orderedEdges.length < 3) {
    throw new Error(
      `A peça ${piece.name} não possui bordas suficientes para formar um painel.`,
    );
  }

  const contour: PatternPoint[] = [];
  const vertexSources: PanelVertexSourceMapping[] = [];
  const pendingPaths: PendingEdgePath[] = [];

  for (const edge of orderedEdges) {
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

    const samples = sampleEdgeWithSpacing(start, end);

    if (samples.length < 2) {
      throw new Error(
        `Não foi possível amostrar a borda ${edge.id}.`,
      );
    }

    const startIndex = contour.length;

    /*
     * O último ponto não é adicionado aqui porque ele também é o primeiro
     * ponto da próxima borda. Isso evita coordenadas duplicadas.
     */
    samples.slice(0, -1).forEach((sample, sampleIndex) => {
      const vertexIndex = contour.length;
      const t = sampleIndex / Math.max(1, samples.length - 1);
      contour.push(sample);
      vertexSources.push({
        vertexIndex,
        sourcePatternId: piece.id,
        ...(sampleIndex === 0 ? { sourcePointId: start.id } : {}),
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
    });
  }

  if (contour.length < 3) {
    throw new Error(
      `A peça ${piece.name} não possui um contorno válido.`,
    );
  }

  const triangulation = triangulatePatternContour(contour);

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
        (pending.startIndex + sampleIndex) % contour.length;

      if (
        vertexIndices.length === 0 ||
        vertexIndices.at(-1) !== vertexIndex
      ) {
        vertexIndices.push(vertexIndex);
      }
    }

    const path = createPanelEdgePath(
      piece.id,
      pending.edge.id,
      vertexIndices,
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

  const darts: DartTopology[] = (piece.darts ?? []).map((dart) => ({
    dart: structuredClone(dart),
    legAVertices: [],
    legBVertices: [],
    apexVertex: null,
  }));

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
      { length: contour.length },
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

function getOrderedPatternEdges(
  piece: PatternPiece,
): PatternEdge[] {
  const availableEdges = getPatternEdges(piece);
  const edgeById = new Map(
    availableEdges.map((edge) => [edge.id, edge]),
  );

  const outerContour =
    piece.contours?.find((contour) => contour.closed) ??
    piece.contours?.[0];

  if (!outerContour?.segmentIds.length) {
    return availableEdges;
  }

  const orderedEdges = outerContour.segmentIds
    .map((segmentId) => edgeById.get(segmentId))
    .filter((edge): edge is PatternEdge => Boolean(edge));

  /*
   * Em projetos legados incompletos, é mais seguro usar getPatternEdges
   * do que retornar apenas parte do contorno.
   */
  if (orderedEdges.length !== availableEdges.length) {
    return availableEdges;
  }

  return orderedEdges;
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
): void {
  for (
    let boundaryIndex = 0;
    boundaryIndex < contour.length;
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
