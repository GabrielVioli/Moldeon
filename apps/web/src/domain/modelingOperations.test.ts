import { describe, expect, it } from "vitest";
import {
  alignModelingPieces,
  createSimplePleat,
  distributeModelingPieces,
  duplicateModelingPieces,
  joinModelingPieces,
  worldBoundsForPiece,
} from "./modelingOperations";
import {
  createInternalPath,
} from "./internalPaths";
import {
  isInternalPath,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternPiece,
} from "./pattern";
import { finalizeBoundaryAnchors } from "./modelingCut";

function piece(id: string, x = 0, y = 0): PatternPiece {
  return migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 10,
    fabricId: "fabric-a",
    cutQuantity: 2,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 100, yMm: 0 },
      { id: `${id}-c`, xMm: 100, yMm: 80 },
      { id: `${id}-d`, xMm: 0, yMm: 80 },
    ],
    annotations: [{ id: `${id}-label`, label: "Centro", xMm: 50, yMm: 40 }],
    guides: [{ id: `${id}-guide`, orientation: "vertical", positionMm: 50 }],
  });
}

function garment(pieces: PatternPiece[], positions?: Array<{ xMm: number; yMm: number; rotationDeg?: number }>): GarmentDraft {
  return {
    id: "modeling-garment",
    templateId: "custom",
    name: "Modelagem",
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
    fabrics: [{
      id: "fabric-a",
      name: "Teste",
      presetId: "cotton-poplin",
      weightGsm: 120,
      stretchWarp: 0.01,
      stretchWeft: 0.01,
      bendingWarp: 1,
      bendingWeft: 1,
      shear: 1,
      damping: 0.02,
      friction: 0.4,
      thicknessMm: 0.4,
      color: "#ffffff",
    } as GarmentDraft["fabrics"][number]],
    pieces,
    workspaceStates: pieces.map((candidate, index) => ({
      pieceId: candidate.id,
      transform: {
        pieceId: candidate.id,
        xMm: positions?.[index]?.xMm ?? 0,
        yMm: positions?.[index]?.yMm ?? 0,
        rotationDeg: positions?.[index]?.rotationDeg ?? 0,
      },
      visible: true,
      locked: false,
    })),
  };
}

describe("9.5-05 modeling operations", () => {
  it("duplicates multiple pieces with metadata and a predictable group offset", () => {
    const first = piece("first");
    const second = piece("second");
    const source = garment([first, second], [{ xMm: 10, yMm: 20 }, { xMm: 220, yMm: 40 }]);
    const result = duplicateModelingPieces(source, [first.id, second.id]);
    expect(result.ok).toBe(true);
    expect(result.selectedPieceIds).toHaveLength(2);
    expect(result.garment.pieces).toHaveLength(4);
    const copies = result.garment.pieces.filter((candidate) => result.selectedPieceIds.includes(candidate.id));
    expect(copies.map((candidate) => candidate.fabricId)).toEqual(["fabric-a", "fabric-a"]);
    expect(copies.map((candidate) => candidate.cutQuantity)).toEqual([2, 2]);
    const states = result.garment.workspaceStates!.filter((state) => result.selectedPieceIds.includes(state.pieceId));
    expect(states[0].transform.xMm).toBe(50);
    expect(states[0].transform.yMm).toBe(60);
    expect(states[1].transform.xMm).toBe(260);
    expect(states[1].transform.yMm).toBe(80);
  });

  it("mirrors horizontally and vertically while remapping persistent cut boundary references", () => {
    const source = piece("mirror");
    const cut = finalizeBoundaryAnchors(createInternalPath(source.id, "cut", [
      { xMm: 20, yMm: 0.2 },
      { xMm: 50, yMm: 40 },
      { xMm: 80, yMm: 0.2 },
    ]), source);
    source.internalLines = [cut];
    const horizontal = duplicateModelingPieces(garment([source]), [source.id], "horizontal");
    const vertical = duplicateModelingPieces(garment([source]), [source.id], "vertical");
    expect(horizontal.ok && vertical.ok).toBe(true);
    for (const result of [horizontal, vertical]) {
      const copy = result.garment.pieces.find((candidate) => candidate.id === result.activePieceId)!;
      expect(copy.internalLines?.filter(isInternalPath)).toHaveLength(1);
      const mirroredPath = copy.internalLines!.find(isInternalPath)!;
      expect(mirroredPath.pieceId).toBe(copy.id);
      expect(typeof mirroredPath.metadata.cutStartEdgeId).toBe("string");
      expect(copy.segments?.some((segment) => segment.id === mirroredPath.metadata.cutStartEdgeId)).toBe(true);
    }
    const originalXs = source.points.map((point) => point.xMm);
    const horizontalCopy = horizontal.garment.pieces.find((candidate) => candidate.id === horizontal.activePieceId)!;
    expect(Math.min(...horizontalCopy.points.map((point) => point.xMm))).toBe(Math.min(...originalXs));
    expect(Math.max(...horizontalCopy.points.map((point) => point.xMm))).toBe(Math.max(...originalXs));
  });

  it("aligns edges and centers using transformed world bounds", () => {
    const pieces = [piece("a"), piece("b")];
    const source = garment(pieces, [{ xMm: 10, yMm: 10 }, { xMm: 250, yMm: 90, rotationDeg: 15 }]);
    const left = alignModelingPieces(source, pieces.map((candidate) => candidate.id), "left");
    const leftBounds = pieces.map((candidate) => worldBoundsForPiece(left.garment, candidate.id)!);
    expect(leftBounds[0].minX).toBeCloseTo(leftBounds[1].minX, 5);
    const centered = alignModelingPieces(left.garment, pieces.map((candidate) => candidate.id), "center-y");
    const centerBounds = pieces.map((candidate) => worldBoundsForPiece(centered.garment, candidate.id)!);
    expect((centerBounds[0].minY + centerBounds[0].maxY) / 2).toBeCloseTo((centerBounds[1].minY + centerBounds[1].maxY) / 2, 5);
  });

  it("distributes three pieces evenly while preserving the two outer anchors", () => {
    const pieces = [piece("a"), piece("b"), piece("c")];
    const source = garment(pieces, [{ xMm: 0, yMm: 0 }, { xMm: 130, yMm: 0 }, { xMm: 420, yMm: 0 }]);
    const result = distributeModelingPieces(source, pieces.map((candidate) => candidate.id), "horizontal");
    const centers = pieces.map((candidate) => {
      const bounds = worldBoundsForPiece(result.garment, candidate.id)!;
      return (bounds.minX + bounds.maxX) / 2;
    });
    expect(centers[1] - centers[0]).toBeCloseTo(centers[2] - centers[1], 5);
  });

  it("joins two coincident opposite edges into one non-degenerate piece", () => {
    const first = piece("left");
    const second = piece("right");
    const source = garment([first, second], [
      { xMm: 0, yMm: 0 },
      { xMm: 200, yMm: 0, rotationDeg: 180 },
    ]);
    const result = joinModelingPieces(source, [first.id, second.id]);
    expect(result.ok).toBe(true);
    expect(result.garment.pieces).toHaveLength(1);
    const joined = result.garment.pieces[0];
    expect(joined.points.length).toBeGreaterThanOrEqual(4);
    expect(joined.contours?.[0]?.closed).toBe(true);
  });

  it("rejects joining pieces whose edges are not compatible/coincident", () => {
    const first = piece("left");
    const second = piece("far");
    const source = garment([first, second], [{ xMm: 0, yMm: 0 }, { xMm: 500, yMm: 300 }]);
    const result = joinModelingPieces(source, [first.id, second.id]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toContain("bordas compatíveis");
  });

  it("creates a simple pleat as two persistent fold paths with recorded fabric consumption", () => {
    const sourcePiece = piece("pleat");
    const result = createSimplePleat(garment([sourcePiece]), sourcePiece.id, {
      depthMm: 30,
      directionDeg: 90,
      sense: "inward",
    });
    expect(result.ok).toBe(true);
    const updated = result.garment.pieces[0];
    const folds = (updated.internalLines ?? []).filter(isInternalPath).filter((path) => path.metadata.pleatId);
    expect(folds).toHaveLength(2);
    expect(new Set(folds.map((path) => path.metadata.pleatId)).size).toBe(1);
    expect(folds.every((path) => path.purpose === "fold")).toBe(true);
    expect(folds.every((path) => path.metadata.pleatDepthMm === 30)).toBe(true);
    expect(folds.every((path) => path.metadata.pleatConsumptionMm === 60)).toBe(true);
    expect(folds.every((path) => path.metadata.pleatSense === "inward")).toBe(true);
    expect(folds.every((path) => path.metadata.pleatEffect === "fold-preparation")).toBe(true);
  });
});
