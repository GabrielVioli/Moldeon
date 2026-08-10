import { describe, expect, it } from "vitest";
import {
  CUT_END_EDGE_KEY,
  CUT_END_T_KEY,
  CUT_START_EDGE_KEY,
  CUT_START_T_KEY,
  analyzeMultiPieceCut,
  analyzeModelingInternalPath,
  applyMultiPieceCutOperation,
  applyModelingInternalPathOperation,
  buildCutPreviewRegions,
  finalizeBoundaryAnchors,
} from "./modelingCut";
import {
  createInternalPath,
  moveInternalPathHandle,
  setInternalPathSegmentKind,
} from "./internalPaths";
import {
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type InternalPath,
  type PatternPiece,
  type Seam,
} from "./pattern";

function rectangle(id = "piece-a"): PatternPiece {
  return migrateLegacyPieceToSegments({
    id,
    name: "Retângulo",
    seamAllowanceMm: 10,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 100, yMm: 0 },
      { id: `${id}-c`, xMm: 100, yMm: 100 },
      { id: `${id}-d`, xMm: 0, yMm: 100 },
    ],
  });
}

function garment(piece: PatternPiece, extraPieces: PatternPiece[] = [], seams: Seam[] = []): GarmentDraft {
  return {
    id: "cut-garment",
    templateId: "custom",
    name: "Teste de corte",
    description: "Gate 9.5-05",
    bodyType: "feminine",
    measurements: {
      heightMm: 1650,
      bustMm: 900,
      waistMm: 720,
      hipMm: 980,
      shoulderWidthMm: 390,
      torsoLengthMm: 430,
      armLengthMm: 580,
      inseamMm: 760,
    },
    fabrics: [],
    pieces: [piece, ...extraPieces],
    seams,
    workspaceStates: [piece, ...extraPieces].map((candidate) => ({
      pieceId: candidate.id,
      transform: { pieceId: candidate.id, xMm: 0, yMm: 0, rotationDeg: 0 },
      visible: true,
      locked: false,
    })),
  };
}

function anchoredCut(piece: PatternPiece, points: Array<{ xMm: number; yMm: number }>): InternalPath {
  return finalizeBoundaryAnchors(createInternalPath(piece.id, "cut", points), piece);
}

function withPath(piece: PatternPiece, path: InternalPath): PatternPiece {
  return { ...piece, internalLines: [path] };
}

describe("9.5-05 anchored cut topology", () => {
  it("applies one workspace stroke to every selected piece it crosses", () => {
    const front = rectangle("front");
    const back = rectangle("back");
    const path = createInternalPath(front.id, "cut", [
      { xMm: -20, yMm: 50 },
      { xMm: 260, yMm: 50 },
    ]);
    const source = garment(withPath(front, path), [back]);
    source.workspaceStates = [
      { pieceId: front.id, transform: { pieceId: front.id, xMm: 0, yMm: 0, rotationDeg: 0 }, visible: true, locked: false },
      { pieceId: back.id, transform: { pieceId: back.id, xMm: 140, yMm: 0, rotationDeg: 0 }, visible: true, locked: false },
    ];

    const analysis = analyzeMultiPieceCut(source, front.id, path, [front.id, back.id]);
    expect(analysis.valid).toBe(true);
    expect(analysis.targetPieceIds).toEqual([front.id, back.id]);

    const result = applyMultiPieceCutOperation(source, front.id, path.id, [front.id, back.id]);
    expect(result.ok).toBe(true);
    expect(result.garment.pieces).toHaveLength(4);
    expect(result.createdPieceIds).toHaveLength(4);
    expect(result.selectedPieceIds).toEqual(result.createdPieceIds);
    expect(result.garment.pieces.some((piece) => piece.id === front.id || piece.id === back.id)).toBe(false);
  });

  it("cuts only intersected pieces and keeps selected pieces outside the stroke selected", () => {
    const crossed = rectangle("crossed");
    const outside = rectangle("outside");
    const path = createInternalPath(crossed.id, "cut", [
      { xMm: -20, yMm: 50 },
      { xMm: 120, yMm: 50 },
    ]);
    const source = garment(withPath(crossed, path), [outside]);
    source.workspaceStates = [
      { pieceId: crossed.id, transform: { pieceId: crossed.id, xMm: 0, yMm: 0, rotationDeg: 0 }, visible: true, locked: false },
      { pieceId: outside.id, transform: { pieceId: outside.id, xMm: 0, yMm: 180, rotationDeg: 0 }, visible: true, locked: false },
    ];

    const result = applyMultiPieceCutOperation(source, crossed.id, path.id, [crossed.id, outside.id]);
    expect(result.ok).toBe(true);
    expect(result.garment.pieces).toHaveLength(3);
    expect(result.createdPieceIds).toHaveLength(2);
    expect(result.selectedPieceIds).toEqual([...result.createdPieceIds, outside.id]);
  });

  it("accepts the blocking three-node V that starts and ends on the same contour", () => {
    const piece = rectangle();
    const path = anchoredCut(piece, [
      { xMm: 20, yMm: 0.8 },
      { xMm: 50, yMm: 55 },
      { xMm: 80, yMm: 0.7 },
    ]);
    const analysis = analyzeModelingInternalPath(piece, path);

    expect(path.nodes[0].yMm).toBeCloseTo(0, 5);
    expect(path.nodes.at(-1)!.yMm).toBeCloseTo(0, 5);
    expect(typeof path.metadata[CUT_START_EDGE_KEY]).toBe("string");
    expect(typeof path.metadata[CUT_START_T_KEY]).toBe("number");
    expect(path.metadata[CUT_START_EDGE_KEY]).toBe(path.metadata[CUT_END_EDGE_KEY]);
    expect(path.metadata[CUT_START_T_KEY]).not.toBe(path.metadata[CUT_END_T_KEY]);
    expect(analysis.valid).toBe(true);
    expect(analysis.intersections).toHaveLength(2);
    expect(buildCutPreviewRegions(piece, path, analysis)).toHaveLength(2);
  });

  it("accepts a straight cut from one edge to another without overshooting the contour", () => {
    const piece = rectangle();
    const path = anchoredCut(piece, [
      { xMm: 50, yMm: 0.5 },
      { xMm: 50, yMm: 99.5 },
    ]);
    const analysis = analyzeModelingInternalPath(piece, path);
    expect(analysis.valid).toBe(true);
    expect(analysis.intersections).toHaveLength(2);
  });

  it("supports two endpoints on the same segment and generates two valid pieces", () => {
    const source = rectangle();
    const path = anchoredCut(source, [
      { xMm: 15, yMm: 0.2 },
      { xMm: 50, yMm: 45 },
      { xMm: 85, yMm: 0.2 },
    ]);
    const piece = withPath(source, path);
    const result = applyModelingInternalPathOperation(garment(piece), piece.id, path.id);
    expect(result.ok).toBe(true);
    expect(result.createdPieceIds).toHaveLength(2);
    expect(result.garment.pieces).toHaveLength(2);
    expect(result.garment.pieces.every((candidate) => (candidate.contours?.[0]?.closed ?? false))).toBe(true);
  });

  it("snaps endpoints near exact vertices to t=0 or t=1 and deduplicates the vertex intersection", () => {
    const piece = rectangle();
    const path = anchoredCut(piece, [
      { xMm: 0.4, yMm: 0.3 },
      { xMm: 55, yMm: 45 },
      { xMm: 99.6, yMm: 99.7 },
    ]);
    const analysis = analyzeModelingInternalPath(piece, path);
    const endpointTs = [path.metadata[CUT_START_T_KEY], path.metadata[CUT_END_T_KEY]];
    expect(endpointTs.every((value) => value === 0 || value === 1)).toBe(true);
    expect(analysis.intersections).toHaveLength(2);
    expect(analysis.valid).toBe(true);
  });

  it("keeps a curved internal path valid and preserves cubic cut edges in the result", () => {
    const source = rectangle();
    let path = anchoredCut(source, [
      { xMm: 15, yMm: 0.4 },
      { xMm: 50, yMm: 60 },
      { xMm: 85, yMm: 0.4 },
    ]);
    path = setInternalPathSegmentKind(path, path.segments[0].id, "cubic");
    path = moveInternalPathHandle(path, path.nodes[0].id, "out", { xMm: 12, yMm: 34 });
    path = moveInternalPathHandle(path, path.nodes[1].id, "in", { xMm: -15, yMm: -8 });
    const analysis = analyzeModelingInternalPath(source, path);
    expect(analysis.valid).toBe(true);

    const result = applyModelingInternalPathOperation(garment(withPath(source, path)), source.id, path.id);
    expect(result.ok).toBe(true);
    const cutSegments = result.garment.pieces.flatMap((piece) => piece.segments ?? []).filter((segment) => segment.id.includes("cut-edge"));
    expect(cutSegments.some((segment) => segment.kind === "cubic")).toBe(true);
  });

  it("rejects a path that only skims the contour tangentially", () => {
    const piece = rectangle();
    const path = anchoredCut(piece, [
      { xMm: 20, yMm: 0.1 },
      { xMm: 50, yMm: 0.7 },
      { xMm: 80, yMm: 0.1 },
    ]);
    const analysis = analyzeModelingInternalPath(piece, path);
    expect(analysis.valid).toBe(false);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "tangent-intersection")).toBe(true);
  });

  it("keeps two close but distinct boundary intersections when the resulting region is non-degenerate", () => {
    const piece = rectangle();
    const path = anchoredCut(piece, [
      { xMm: 40, yMm: 0.1 },
      { xMm: 40.5, yMm: 20 },
      { xMm: 41, yMm: 0.1 },
    ]);
    const analysis = analyzeModelingInternalPath(piece, path);
    expect(analysis.intersections).toHaveLength(2);
    expect(analysis.valid).toBe(true);
  });

  it("remaps or explicitly invalidates a seam that references the cut source piece", () => {
    const source = rectangle();
    const other = rectangle("piece-b");
    const sourceEdge = source.segments![1];
    const otherEdge = other.segments![3];
    const seam: Seam = {
      id: "seam-crossing",
      name: "Costura existente",
      first: { pieceId: source.id, edgeId: sourceEdge.id, startT: 0, endT: 1 },
      second: { pieceId: other.id, edgeId: otherEdge.id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    };
    const path = anchoredCut(source, [
      { xMm: 50, yMm: 0.2 },
      { xMm: 50, yMm: 99.8 },
    ]);
    const result = applyModelingInternalPathOperation(
      garment(withPath(source, path), [other], [seam]),
      source.id,
      path.id,
    );
    expect(result.ok).toBe(true);
    const retained = result.garment.seams?.find((candidate) => candidate.id === seam.id);
    const invalidated = result.diagnostics.some((diagnostic) => diagnostic.code === "seam-invalidated");
    expect(Boolean(retained) || invalidated).toBe(true);
    if (retained) expect(retained.first.pieceId).not.toBe(source.id);
  });
});
