import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternPiece,
  type Seam,
} from "../domain/pattern";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";


describe("Prompt 10.6 extended constraint topologies", () => {
  it("G2 solves a two-panel component while preserving parallel relations", () => {
    const garment = createTwoPanelDoubleRelationGarment();
    const arrangement = arrange(garment);
    const graph = arrangement.constraintSpatialAssembly.graph;
    expect(graph.nodes).toHaveLength(2);
    expect(graph.relations.length).toBeGreaterThanOrEqual(2);
    expect(graph.components[0].parallelRelationCount).toBeGreaterThanOrEqual(1);
    expect(graph.components[0].supportsSpatialShell).toBe(true);
    expect(arrangement.constraintSpatialAssembly.components[0].strategy).toBe("constraint-spatial-shell");
    expect([...arrangement.state.positions].every(Number.isFinite)).toBe(true);
  });

  it("same and opposite relation direction remain distinct through material correspondence", () => {
    const same = arrange(createDirectionalGarment("same"));
    const opposite = arrange(createDirectionalGarment("opposite"));
    const sameConstraints = same.state.stitchConstraints.filter((constraint) => constraint.seamGroupId === "directional-main");
    const oppositeConstraints = opposite.state.stitchConstraints.filter((constraint) => constraint.seamGroupId === "directional-main");
    expect(sameConstraints.length).toBe(oppositeConstraints.length);
    expect(sameConstraints.length).toBeGreaterThan(2);
    expect(referenceSignature(sameConstraints[0].b)).not.toBe(referenceSignature(oppositeConstraints[0].b));
    expect([...same.state.positions].every(Number.isFinite)).toBe(true);
    expect([...opposite.state.positions].every(Number.isFinite)).toBe(true);
  });

  it("G15 integrates body plus two independent closed bands without ring dominance", () => {
    const garment = createBodyWithTwoBands();
    const arrangement = arrange(garment);
    const graph = arrangement.constraintSpatialAssembly.graph;
    expect(graph.nodes.length).toBeGreaterThanOrEqual(6);
    expect(graph.relations.some((relation) => relation.seamGroupId.includes("upper-band-loop"))).toBe(true);
    expect(graph.relations.some((relation) => relation.seamGroupId === "lower-band-loop")).toBe(true);
    expect(graph.relations.some((relation) => relation.seamGroupId === "lower-band-attach")).toBe(true);
    expect(arrangement.constraintSpatialAssembly.components.some((component) => component.strategy === "constraint-spatial-shell")).toBe(true);
    expect(maxExtent(arrangement.state.positions)).toBeLessThan(4);
    expect([...arrangement.state.positions].every(Number.isFinite)).toBe(true);
  });
});

function arrange(garment: GarmentDraft) {
  const input = buildResolvedAssemblyInput(garment);
  const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
  return buildSemanticAvatarArrangement(input, avatar);
}

function createTwoPanelDoubleRelationGarment(): GarmentDraft {
  const base = createBaselineFixture("spatial-two-panel-tube");
  const [first, second] = base.pieces;
  const firstEdges = getPatternEdges(first);
  const secondEdges = getPatternEdges(second);
  const extra: Seam = {
    id: "two-panel-top",
    groupId: "two-panel-top",
    name: "Second independent relation",
    first: { pieceId: first.id, edgeId: firstEdges[0].id, startT: 0, endT: 1 },
    second: { pieceId: second.id, edgeId: secondEdges[0].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  return { ...base, seams: [...(base.seams ?? []), extra] };
}

function createDirectionalGarment(direction: "same" | "opposite"): GarmentDraft {
  const base = createBaselineFixture("equal-length-seam");
  const source = base.seams?.[0];
  if (!source) throw new Error("Missing directional baseline seam");
  return {
    ...base,
    dressing: { region: "upper", frontReferencePieceId: base.pieces[0].id },
    seams: [{ ...source, id: "directional-main", groupId: "directional-main", direction }],
  };
}

function createBodyWithTwoBands(): GarmentDraft {
  const base = createBaselineFixture("spatial-notched-tube-waistband");
  const bodyPieces = base.pieces.filter((piece) => piece.id.startsWith("spatial-notch-"));
  const fabricId = base.fabrics[0].id;
  const width = bodyPieces.reduce((total, piece) => {
    const edge = getPatternEdges(piece).find((candidate) => candidate.role === "hem");
    if (!edge) return total;
    const start = piece.points.find((point) => point.id === edge.startPointId)!;
    const end = piece.points.find((point) => point.id === edge.endPointId)!;
    return total + Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
  }, 0);
  const lowerBand = rectangularBand("spatial-lower-band", width, 32, fabricId);
  const lowerEdges = getPatternEdges(lowerBand);
  const hemRanges = bodyPieces.flatMap((piece) => getPatternEdges(piece)
    .filter((edge) => edge.role === "hem")
    .map((edge) => ({ pieceId: piece.id, edgeId: edge.id, startT: 0, endT: 1 })));
  const lowerLoop: Seam = {
    id: "lower-band-loop",
    groupId: "lower-band-loop",
    name: "Lower band loop",
    first: { pieceId: lowerBand.id, edgeId: lowerEdges[1].id, startT: 0, endT: 1 },
    second: { pieceId: lowerBand.id, edgeId: lowerEdges[3].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  const attach: Seam = {
    id: "lower-band-attach",
    groupId: "lower-band-attach",
    name: "Lower band attachment",
    first: { pieceId: lowerBand.id, edgeId: lowerEdges[0].id, startT: 0, endT: 1 },
    second: hemRanges[0],
    secondRanges: hemRanges,
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  return {
    ...base,
    pieces: [...base.pieces, lowerBand],
    seams: [...(base.seams ?? []), lowerLoop, attach],
    assemblyPlacements: [
      ...(base.assemblyPlacements ?? []),
      {
        pieceId: lowerBand.id,
        role: "waist",
        outwardSide: "front",
        positionMm: [0, -450, 0],
        rotationDeg: [0, 0, 0],
        flipped: false,
        source: "template",
      },
    ],
  };
}

function rectangularBand(id: string, widthMm: number, heightMm: number, fabricId: string): PatternPiece {
  const migrated = migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 10,
    cutQuantity: 1,
    fabricId,
    points: [
      { id: `${id}:a`, xMm: 0, yMm: 0 },
      { id: `${id}:b`, xMm: widthMm, yMm: 0 },
      { id: `${id}:c`, xMm: widthMm, yMm: heightMm },
      { id: `${id}:d`, xMm: 0, yMm: heightMm },
    ],
  });
  return {
    ...migrated,
    segments: migrated.segments?.map((segment, index) => ({
      ...segment,
      role: (["waist", "sideSeam", "hem", "sideSeam"] as const)[index] ?? "other",
    })),
  };
}

function referenceSignature(reference: { particleIndices: number[]; weights: number[] }): string {
  return `${reference.particleIndices.join(",")}:${reference.weights.map((weight) => weight.toFixed(6)).join(",")}`;
}

function maxExtent(positions: Float32Array): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxX = Math.max(maxX, positions[index]);
    maxY = Math.max(maxY, positions[index + 1]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}
