import type { EdgeRange, GarmentDraft, PatternPiece, Seam } from "../domain/pattern";
import type { PanelTopology } from "./PanelTopology";
import { buildPanelTopology, getEdgeVertexRange, resampleEdgeVertices } from "./PanelTopology";

export interface StitchConstraint {
  pieceA: string;
  vertexA: number;
  pieceB: string;
  vertexB: number;
  restDistance: number;
  stiffness: number;
}

export function buildSelfSeamConstraints(
  garment: GarmentDraft,
  sampleCount = 24,
): StitchConstraint[] {
  const constraints: StitchConstraint[] = [];
  const pieceTopologies = new Map<string, PanelTopology>();

  for (const seam of garment.seams ?? []) {
    if (seam.first.pieceId !== seam.second.pieceId) continue;
    const pieceId = seam.first.pieceId;
    if (!pieceTopologies.has(pieceId)) {
      const piece = garment.pieces.find((item) => item.id === pieceId);
      if (!piece) continue;
      pieceTopologies.set(pieceId, buildPanelTopology(piece));
    }

    const topology = pieceTopologies.get(pieceId)!;
    const firstVertices = getEdgeVertexRange(topology, seam.first);
    const secondVertices = getEdgeVertexRange(topology, seam.second);
    if (firstVertices.length < 2 || secondVertices.length < 2) continue;

    const count = Math.max(
      Math.min(sampleCount, Math.max(firstVertices.length, secondVertices.length)),
      2,
    );
    const resampledA = resampleEdgeVertices(topology, firstVertices, count);
    const resampledB = resampleEdgeVertices(topology, secondVertices, count);
    if (resampledA.length !== resampledB.length) {
      continue;
    }

    const sortedB = seam.direction === "opposite" ? [...resampledB].reverse() : resampledB;
    for (let index = 0; index < resampledA.length; index += 1) {
      const vertexA = resampledA[index];
      const vertexB = sortedB[index];
      if (vertexA === vertexB) continue;
      constraints.push({
        pieceA: pieceId,
        vertexA,
        pieceB: pieceId,
        vertexB,
        restDistance: 0,
        stiffness: 1,
      });
    }
  }

  return constraints;
}
