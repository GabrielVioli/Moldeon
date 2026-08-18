import type { PanelTopology } from "./PanelTopology";
import type { PanelEdgePath } from "./types";
import type { PanelVertexSourceMapping } from "./types";
import { getPatternEdges } from "../domain/pattern";

const DEFAULT_REFINEMENT_ITERATIONS = 2;
const MAX_REFINEMENT_ITERATIONS = 3;

/**
 * Subdivide cada triângulo em quatro triângulos menores.
 *
 * Os índices existentes permanecem válidos, portanto pontos do molde,
 * pences e costuras já construídas continuam referenciando os mesmos
 * vértices. Novos pontos são acrescentados apenas no fim dos arrays.
 *
 * Também inserimos os novos pontos nas sequências das bordas. Isso evita
 * que a superfície seja refinada enquanto a costura continua presa a uma
 * borda grosseira.
 */
export function refinePanelTopology(
  topology: PanelTopology,
  requestedIterations = DEFAULT_REFINEMENT_ITERATIONS,
): PanelTopology {
  const iterations = clampInteger(
    requestedIterations,
    0,
    MAX_REFINEMENT_ITERATIONS,
  );

  if (iterations === 0 || topology.triangles.length === 0) {
    return topology;
  }

  const positions = Array.from(topology.positions2DMm);
  let triangles = Array.from(topology.triangles);
  let boundaryVertices = [...topology.boundaryVertices];
  let edges = cloneEdgePaths(topology.edges);
  const vertexSources: PanelVertexSourceMapping[] = topology.vertexSources.map((source) => structuredClone(source));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const midpointByEdge = new Map<string, number>();
    const refinedTriangles: number[] = [];

    const midpoint = (first: number, second: number): number => {
      const key = edgeKey(first, second);
      const existing = midpointByEdge.get(key);
      if (existing !== undefined) return existing;

      const index = positions.length / 2;
      positions.push(
        (positions[first * 2] + positions[second * 2]) / 2,
        (positions[first * 2 + 1] + positions[second * 2 + 1]) / 2,
      );
      const firstSource = vertexSources[first];
      const secondSource = vertexSources[second];
      const sameEdge = firstSource?.edgeId && firstSource.edgeId === secondSource?.edgeId;
      const t = sameEdge && firstSource.t !== undefined && secondSource?.t !== undefined
        ? (firstSource.t + secondSource.t) / 2
        : undefined;
      vertexSources.push({
        vertexIndex: index,
        sourcePatternId: topology.sourcePatternId,
        ...(sameEdge ? { sourceSegmentId: firstSource.sourceSegmentId, edgeId: firstSource.edgeId } : {}),
        ...(t === undefined ? {} : { t }),
        ...(sameEdge && t !== undefined
          ? { interpolation: {
              startPointId: firstSource.interpolation?.startPointId,
              endPointId: firstSource.interpolation?.endPointId,
              t,
            } }
          : { derivedFromVertexIndices: [first, second] }),
        restPosition2DMm: {
          x: positions[index * 2],
          y: positions[index * 2 + 1],
        },
      });
      midpointByEdge.set(key, index);
      return index;
    };

    for (let offset = 0; offset < triangles.length; offset += 3) {
      const a = triangles[offset];
      const b = triangles[offset + 1];
      const c = triangles[offset + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);

      refinedTriangles.push(
        a, ab, ca,
        ab, b, bc,
        ca, bc, c,
        ab, bc, ca,
      );
    }

    triangles = refinedTriangles;
    boundaryVertices = insertKnownMidpoints(
      boundaryVertices,
      midpointByEdge,
      true,
    );

    edges = new Map(
      [...edges.entries()].map(([edgeId, path]) => {
        const vertexIndices = insertKnownMidpoints(
          path.vertexIndices,
          midpointByEdge,
          false,
        );

        return [
          edgeId,
          createEdgePath(
            path.pieceId,
            path.edgeId,
            vertexIndices,
            positions,
          ),
        ];
      }),
    );
  }

  const positions2DMm = Float32Array.from(positions);
  const positions2D = new Float32Array(positions2DMm.length);

  for (let index = 0; index < positions2DMm.length; index += 1) {
    positions2D[index] = positions2DMm[index] * 0.001;
  }

  const sourcePointVertices = new Map(
    [...topology.sourcePointVertices.entries()].map(([pointId, indices]) => [
      pointId,
      [...indices],
    ]),
  );

  const edgeVertices = new Map(
    [...edges.entries()].map(([edgeId, path]) => [
      edgeId,
      [...path.vertexIndices],
    ]),
  );

  return {
    ...topology,
    positions2DMm,
    positions2D,
    triangles: Uint32Array.from(triangles),
    boundaryVertices,
    edges,
    edgeVertices,
    sourcePointVertices,
    vertexSources,
    sourcePointToVertices: sourcePointVertices,
  };
}

export function recommendedPanelRefinement(
  topology: PanelTopology,
): number {
  const triangleCount = topology.triangles.length / 3;

  if (triangleCount <= 180) return 2;
  if (triangleCount <= 700) return 1;
  return 0;
}

/**
 * Gera uma malha regular para um quadrilátero material de quatro segmentos
 * retos. Retorna undefined para qualquer geometria mais geral.
 */
export function remeshStructuredQuadrilateral(
  topology: PanelTopology,
  targetCellMm = 20,
): PanelTopology | undefined {
  const piece = topology.sourcePiece;
  const edges = getPatternEdges(piece);
  if (piece.points.length !== 4
    || edges.length !== 4
    || (piece.segments?.length && piece.segments.some((segment) => segment.kind !== "line"))
    || piece.points.some((point) => point.handleIn || point.handleOut)
    || (piece.darts?.length ?? 0) > 0
    || !Number.isFinite(targetCellMm)
    || targetCellMm <= 0) return undefined;

  const [p00, p10, p11, p01] = piece.points;
  const corners = [p00, p10, p11, p01];
  const turns = corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    const after = corners[(index + 2) % corners.length];
    return (next.xMm - point.xMm) * (after.yMm - next.yMm)
      - (next.yMm - point.yMm) * (after.xMm - next.xMm);
  });
  if (turns.some((turn) => Math.abs(turn) <= 1e-6)
    || (turns.some((turn) => turn > 0) && turns.some((turn) => turn < 0))) return undefined;
  const horizontalMm = Math.max(
    Math.hypot(p10.xMm - p00.xMm, p10.yMm - p00.yMm),
    Math.hypot(p11.xMm - p01.xMm, p11.yMm - p01.yMm),
  );
  const verticalMm = Math.max(
    Math.hypot(p11.xMm - p10.xMm, p11.yMm - p10.yMm),
    Math.hypot(p01.xMm - p00.xMm, p01.yMm - p00.yMm),
  );
  if (horizontalMm <= 1e-6 || verticalMm <= 1e-6) return undefined;
  const columns = Math.max(2, Math.ceil(horizontalMm / targetCellMm));
  const rows = Math.max(2, Math.ceil(verticalMm / targetCellMm));
  const positions: number[] = [];
  const vertexSources: PanelVertexSourceMapping[] = [];
  const sourcePointVertices = new Map<string, number[]>();
  const indexAt = (column: number, row: number) => row * (columns + 1) + column;

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const topX = p00.xMm + (p10.xMm - p00.xMm) * u;
      const topY = p00.yMm + (p10.yMm - p00.yMm) * u;
      const bottomX = p01.xMm + (p11.xMm - p01.xMm) * u;
      const bottomY = p01.yMm + (p11.yMm - p01.yMm) * u;
      const x = topX + (bottomX - topX) * v;
      const y = topY + (bottomY - topY) * v;
      const vertexIndex = indexAt(column, row);
      positions.push(x, y);

      let edgeIndex = -1;
      let t = 0;
      if (row === 0) { edgeIndex = 0; t = u; }
      else if (column === columns) { edgeIndex = 1; t = v; }
      else if (row === rows) { edgeIndex = 2; t = 1 - u; }
      else if (column === 0) { edgeIndex = 3; t = 1 - v; }
      const cornerPoint = row === 0 && column === 0 ? p00
        : row === 0 && column === columns ? p10
          : row === rows && column === columns ? p11
            : row === rows && column === 0 ? p01
              : undefined;
      const edge = edgeIndex >= 0 ? edges[edgeIndex] : undefined;
      vertexSources.push({
        vertexIndex,
        sourcePatternId: topology.sourcePatternId,
        ...(cornerPoint ? { sourcePointId: cornerPoint.id } : {}),
        ...(edge ? { sourceSegmentId: edge.id, edgeId: edge.id, t } : {}),
        ...(edge ? { interpolation: { startPointId: edge.startPointId, endPointId: edge.endPointId, t } } : {}),
        restPosition2DMm: { x, y },
      });
      if (cornerPoint) sourcePointVertices.set(cornerPoint.id, [vertexIndex]);
    }
  }

  const triangles: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = indexAt(column, row);
      const b = indexAt(column + 1, row);
      const c = indexAt(column + 1, row + 1);
      const d = indexAt(column, row + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  const edgeVertexIndices = [
    Array.from({ length: columns + 1 }, (_, column) => indexAt(column, 0)),
    Array.from({ length: rows + 1 }, (_, row) => indexAt(columns, row)),
    Array.from({ length: columns + 1 }, (_, offset) => indexAt(columns - offset, rows)),
    Array.from({ length: rows + 1 }, (_, offset) => indexAt(0, rows - offset)),
  ];
  const edgePaths = new Map(edges.map((edge, index) => [
    edge.id,
    createEdgePath(piece.id, edge.id, edgeVertexIndices[index], positions),
  ]));
  const boundaryVertices = [
    ...edgeVertexIndices[0].slice(0, -1),
    ...edgeVertexIndices[1].slice(0, -1),
    ...edgeVertexIndices[2].slice(0, -1),
    ...edgeVertexIndices[3].slice(0, -1),
  ];
  const positions2DMm = Float32Array.from(positions);
  const xCoordinates = positions.filter((_value, index) => index % 2 === 0);
  const yCoordinates = positions.filter((_value, index) => index % 2 === 1);
  const minX = Math.min(...xCoordinates);
  const minY = Math.min(...yCoordinates);
  const maxX = Math.max(...xCoordinates);
  const maxY = Math.max(...yCoordinates);
  return {
    ...topology,
    positions2DMm,
    positions2D: Float32Array.from(positions.map((value) => value * 0.001)),
    triangles: Uint32Array.from(triangles),
    boundaryVertices,
    edges: edgePaths,
    edgeVertices: new Map([...edgePaths].map(([edgeId, path]) => [edgeId, [...path.vertexIndices]])),
    sourcePointVertices,
    vertexSources,
    sourcePointToVertices: sourcePointVertices,
    boundsMm: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}

function cloneEdgePaths(
  edges: ReadonlyMap<string, PanelEdgePath>,
): Map<string, PanelEdgePath> {
  return new Map(
    [...edges.entries()].map(([edgeId, path]) => [
      edgeId,
      {
        ...path,
        vertexIndices: [...path.vertexIndices],
        cumulativeLengthsMm: [...path.cumulativeLengthsMm],
      },
    ]),
  );
}

function insertKnownMidpoints(
  vertices: readonly number[],
  midpointByEdge: ReadonlyMap<string, number>,
  closed: boolean,
): number[] {
  if (vertices.length <= 1) return [...vertices];

  const result: number[] = [];
  const segmentCount = closed ? vertices.length : vertices.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const first = vertices[index];
    const second = vertices[(index + 1) % vertices.length];
    result.push(first);

    const midpoint = midpointByEdge.get(edgeKey(first, second));
    if (midpoint !== undefined) result.push(midpoint);
  }

  if (!closed) result.push(vertices[vertices.length - 1]);
  return removeAdjacentDuplicates(result);
}

function createEdgePath(
  pieceId: string,
  edgeId: string,
  vertexIndices: number[],
  positions: readonly number[],
): PanelEdgePath {
  const cumulativeLengthsMm = [0];
  let lengthMm = 0;

  for (let index = 1; index < vertexIndices.length; index += 1) {
    const first = vertexIndices[index - 1];
    const second = vertexIndices[index];
    const dx = positions[second * 2] - positions[first * 2];
    const dy = positions[second * 2 + 1] - positions[first * 2 + 1];
    lengthMm += Math.hypot(dx, dy);
    cumulativeLengthsMm.push(lengthMm);
  }

  return {
    pieceId,
    edgeId,
    vertexIndices,
    cumulativeLengthsMm,
    lengthMm,
  };
}

function removeAdjacentDuplicates(values: readonly number[]): number[] {
  const result: number[] = [];

  for (const value of values) {
    if (result.at(-1) !== value) result.push(value);
  }

  return result;
}

function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
