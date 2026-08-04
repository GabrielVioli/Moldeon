import type {
  EdgeRange,
  PatternPiece,
  PatternPoint,
} from "../domain/pattern";
import { getPatternEdges, getEdgeById } from "../domain/pattern";
import {
  samplePatternSegment,
  triangulatePatternContour,
} from "../domain/polygonGeometry";

export interface PanelTopology {
  pieceId: string;
  positions2D: Float32Array;
  triangles: Uint32Array;
  edgeVertices: Map<string, number[]>;
  boundaryVertices: number[];
  sourcePointToVertices: Map<string, number[]>;
}

const PARAM_TOLERANCE = 1e-6;

const EDGE_SAMPLE_SPACING_MM = 20;

export function buildPanelTopology(piece: PatternPiece, scaleFactor = 0.00145): PanelTopology {
  const edges = getPatternEdges(piece);
  const boundaryVertices: number[] = [];
  const edgeVertices = new Map<string, number[]>();
  const sourcePointToVertices = new Map<string, number[]>();

  const contour: PatternPoint[] = [];
  const contourKey = (point: PatternPoint) => `${point.xMm.toFixed(8)}:${point.yMm.toFixed(8)}`;

  for (const edge of edges) {
    const start = piece.points.find((point) => point.id === edge.startPointId);
    const end = piece.points.find((point) => point.id === edge.endPointId);
    if (!start || !end) continue;

    const samples = sampleEdgeWithSpacing(start, end);
    contour.push(...samples.slice(0, -1));
  }

  if (contour.length === 0) {
    throw new Error(`A peça ${piece.id} não possui contorno válido.`);
  }

  const contourKeys = contour.map(contourKey);
  const positions: number[] = [];

  for (const point of contour) {
    positions.push(point.xMm * scaleFactor, point.yMm * scaleFactor);
  }

  for (const edge of edges) {
    const start = piece.points.find((point) => point.id === edge.startPointId);
    const end = piece.points.find((point) => point.id === edge.endPointId);
    if (!start || !end) continue;

    const samples = sampleEdgeWithSpacing(start, end);
    const segmentIndices: number[] = [];
    let searchStart = 0;

    for (const sample of samples) {
      const key = contourKey({ id: sample.id, xMm: sample.xMm, yMm: sample.yMm });
      let foundIndex = -1;
      for (let index = searchStart; index < contourKeys.length; index += 1) {
        if (contourKeys[index] === key) {
          foundIndex = index;
          break;
        }
      }
      if (foundIndex < 0) {
        for (let index = 0; index < searchStart; index += 1) {
          if (contourKeys[index] === key) {
            foundIndex = index;
            break;
          }
        }
      }
      if (foundIndex < 0) continue;
      if (segmentIndices.length === 0 || segmentIndices[segmentIndices.length - 1] !== foundIndex) {
        segmentIndices.push(foundIndex);
      }
      searchStart = foundIndex;

      const vertexIndices = sourcePointToVertices.get(sample.id) ?? [];
      vertexIndices.push(foundIndex);
      sourcePointToVertices.set(sample.id, vertexIndices);
    }

    edgeVertices.set(edge.id, segmentIndices);
  }

  boundaryVertices.push(...Array.from({ length: positions.length / 2 }, (_, index) => index));

  const triangulation = triangulatePatternContour(contour);
  if (!triangulation.ok) {
    throw new Error(`Não foi possível triangular o contorno da peça ${piece.id}.`);
  }

  return {
    pieceId: piece.id,
    positions2D: new Float32Array(positions),
    triangles: new Uint32Array(triangulation.indices),
    edgeVertices,
    boundaryVertices,
    sourcePointToVertices,
  };
}

function sampleEdgeWithSpacing(start: PatternPoint, end: PatternPoint): PatternPoint[] {
  const baseSamples = samplePatternSegment(start, end);
  if (baseSamples.length > 2) return baseSamples;

  const lengthMm = Math.hypot(start.xMm - end.xMm, start.yMm - end.yMm);
  const steps = Math.max(1, Math.ceil(lengthMm / EDGE_SAMPLE_SPACING_MM));
  if (steps === 1) return baseSamples;

  const samples: PatternPoint[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    samples.push({
      id: `${start.id}::${end.id}::${step}`,
      xMm: start.xMm + (end.xMm - start.xMm) * t,
      yMm: start.yMm + (end.yMm - start.yMm) * t,
    });
  }

  return samples;
}

export function getEdgeVertexRange(
  topology: PanelTopology,
  edgeRange: EdgeRange,
): number[] {
  const vertices = topology.edgeVertices.get(edgeRange.edgeId) ?? [];
  if (vertices.length === 0) return [];

  if (edgeRange.startT <= 0 + PARAM_TOLERANCE && edgeRange.endT >= 1 - PARAM_TOLERANCE) {
    return [...vertices];
  }

  const mapped = mapEdgeVerticesToParameters(topology, vertices);
  const selected = mapped.filter((vertex) =>
    vertex.t >= edgeRange.startT - PARAM_TOLERANCE &&
    vertex.t <= edgeRange.endT + PARAM_TOLERANCE,
  ).map((vertex) => vertex.index);

  if (selected.length > 0) {
    return selected;
  }

  const startVertex = findClosestVertexByParam(mapped, edgeRange.startT);
  const endVertex = findClosestVertexByParam(mapped, edgeRange.endT);
  if (startVertex === -1 || endVertex === -1) return [];

  if (startVertex <= endVertex) {
    return vertices.slice(startVertex, endVertex + 1);
  }
  return vertices.slice(endVertex, startVertex + 1).reverse();
}

export function resampleEdgeVertices(
  topology: PanelTopology,
  vertexIndices: number[],
  sampleCount: number,
): number[] {
  const mapped = mapEdgeVerticesToParameters(topology, vertexIndices);
  if (mapped.length === 0) return [];
  const count = Math.max(2, sampleCount);
  const samples: number[] = [];
  let lastVertex = -1;

  for (let step = 0; step < count; step += 1) {
    const t = count === 1 ? 0 : step / (count - 1);
    const closestVertex = findClosestVertexByParam(mapped, t);
    if (closestVertex < 0) continue;
    const vertex = mapped[closestVertex].index;
    if (vertex !== lastVertex) {
      samples.push(vertex);
      lastVertex = vertex;
    }
  }

  return samples;
}

function mapEdgeVerticesToParameters(
  topology: PanelTopology,
  vertexIndices: number[],
) {
  const result: Array<{ index: number; t: number }> = [];
  let totalLength = 0;
  const positions = topology.positions2D;
  const points = vertexIndices.map((index) => ({
    index,
    x: positions[index * 2],
    y: positions[index * 2 + 1],
  }));

  for (let index = 1; index < points.length; index += 1) {
    totalLength += distance(points[index - 1], points[index]);
  }

  let accumulated = 0;
  result.push({ index: points[0].index, t: 0 });
  for (let index = 1; index < points.length; index += 1) {
    accumulated += distance(points[index - 1], points[index]);
    result.push({
      index: points[index].index,
      t: totalLength > 0 ? accumulated / totalLength : 0,
    });
  }

  return result;
}

function findClosestVertexByParam(
  mapped: Array<{ index: number; t: number }>,
  target: number,
) {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < mapped.length; index += 1) {
    const distance = Math.abs(mapped[index].t - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
