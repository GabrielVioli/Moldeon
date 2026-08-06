import type { PanelTopology } from "./PanelTopology";
import type { PanelEdgePath } from "./types";

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
