import { getPatternEdges, type EdgeRange, type PatternPiece } from "../domain/pattern";

/**
 * Produces the unique continuous material traversal for a composite seam side.
 *
 * This is deliberately a runtime view. It never mutates PatternDocumentV3 and
 * never reverses an EdgeRange. Mixed-piece N↔M sequences, partial ranges and
 * ambiguous chains keep their authored order.
 */
export function orderCompositeEdgeRangesByContinuity(
  pieces: readonly PatternPiece[],
  ranges: readonly EdgeRange[],
): EdgeRange[] {
  const original = ranges.map((range) => ({ ...range }));
  if (original.length < 2) return original;
  const pieceId = original[0].pieceId;
  if (!original.every((range) => range.pieceId === pieceId)) return original;
  const piece = pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return original;

  const edgeById = new Map(getPatternEdges(piece).map((edge) => [edge.id, edge]));
  const endpoints = original.map((range) => {
    const edge = edgeById.get(range.edgeId);
    if (!edge) return null;
    const start = endpointNodeId(edge.startPointId, edge.endPointId, range.startT);
    const end = endpointNodeId(edge.startPointId, edge.endPointId, range.endT);
    return start && end ? { start, end } : null;
  });
  if (endpoints.some((endpoint) => endpoint === null)) return original;
  const typed = endpoints as Array<{ start: string; end: string }>;
  if (isContinuous(typed)) return original;

  const solutions: number[][] = [];
  for (let startIndex = 0; startIndex < original.length; startIndex += 1) {
    const chain = [startIndex];
    const used = new Set(chain);
    while (chain.length < original.length) {
      const current = typed[chain[chain.length - 1]];
      const next = typed
        .map((endpoint, index) => ({ endpoint, index }))
        .filter(({ endpoint, index }) => !used.has(index) && endpoint.start === current.end);
      if (next.length !== 1) break;
      chain.push(next[0].index);
      used.add(next[0].index);
    }
    if (chain.length === original.length) solutions.push(chain);
  }

  if (solutions.length !== 1) return original;
  return solutions[0].map((index) => ({ ...original[index] }));
}

function endpointNodeId(startNodeId: string, endNodeId: string, t: number): string | null {
  const epsilon = 1e-8;
  if (Math.abs(t) <= epsilon) return startNodeId;
  if (Math.abs(t - 1) <= epsilon) return endNodeId;
  return null;
}

function isContinuous(endpoints: readonly { start: string; end: string }[]): boolean {
  return endpoints.every((endpoint, index) => index === 0 || endpoints[index - 1].end === endpoint.start);
}
