import { describe, expect, it } from "vitest";
import { createInternalPath } from "../domain/internalPaths";
import { applyModelingInternalPathOperation, finalizeBoundaryAnchors } from "../domain/modelingCut";
import { duplicateModelingPieces, joinModelingPieces } from "../domain/modelingOperations";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type InternalPath,
  type PatternPiece,
} from "../domain/pattern";
import { convertPatternSegment } from "../domain/segmentEditing";
import { internalCurveHandleTargets, patternCurveHandleTargets } from "./curveHandleInteraction";

function garment(pieces: PatternPiece[], positions?: Array<{ xMm: number; yMm: number; rotationDeg?: number }>): GarmentDraft {
  return {
    id: "curve-origin-garment",
    templateId: "custom",
    name: "Curve origin regression",
    description: "Curve handle origin regression",
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
    pieces,
    seams: [],
    workspaceStates: pieces.map((piece, index) => ({
      pieceId: piece.id,
      transform: {
        pieceId: piece.id,
        xMm: positions?.[index]?.xMm ?? 0,
        yMm: positions?.[index]?.yMm ?? 0,
        rotationDeg: positions?.[index]?.rotationDeg ?? 0,
      },
      visible: true,
      locked: false,
    })),
  };
}

function curvedPiece(id: string, side: "top" | "left" = "top"): PatternPiece {
  return migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 0,
    points: side === "top"
      ? [
          { id: `${id}-a`, xMm: 0, yMm: 0, handleOut: { xMm: 32, yMm: -18 } },
          { id: `${id}-b`, xMm: 100, yMm: 0, handleIn: { xMm: -30, yMm: -16 } },
          { id: `${id}-c`, xMm: 100, yMm: 80 },
          { id: `${id}-d`, xMm: 0, yMm: 80 },
        ]
      : [
          { id: `${id}-a`, xMm: 0, yMm: 0, handleIn: { xMm: -20, yMm: 20 } },
          { id: `${id}-b`, xMm: 100, yMm: 0 },
          { id: `${id}-c`, xMm: 100, yMm: 80 },
          { id: `${id}-d`, xMm: 0, yMm: 80, handleOut: { xMm: -20, yMm: -20 } },
        ],
  });
}

function straightPiece(id: string): PatternPiece {
  return migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 0,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 100, yMm: 0 },
      { id: `${id}-c`, xMm: 100, yMm: 80 },
      { id: `${id}-d`, xMm: 0, yMm: 80 },
    ],
  });
}

function firstCurvedEdge(piece: PatternPiece) {
  return getPatternEdges(piece).find((edge) => {
    const start = piece.points.find((point) => point.id === edge.startPointId);
    const end = piece.points.find((point) => point.id === edge.endPointId);
    return Boolean(start?.handleOut || end?.handleIn);
  });
}

function expectEditableCurve(piece: PatternPiece) {
  const edge = firstCurvedEdge(piece);
  expect(edge, `${piece.id} should retain a curved edge`).toBeTruthy();
  expect(patternCurveHandleTargets(piece, null, edge!.id).map((target) => target.handle).sort())
    .toEqual(["in", "out"]);
}

describe("curve handles remain authoritative across 9.5-05 modeling origins", () => {
  it("keeps a manually converted cubic segment directly editable", () => {
    const source = straightPiece("manual");
    const edge = getPatternEdges(source)[0];
    const converted = convertPatternSegment(source, edge.id, "cubic");
    expectEditableCurve(converted);
  });

  it("keeps duplicated curves directly editable", () => {
    const source = curvedPiece("duplicate");
    const result = duplicateModelingPieces(garment([source]), [source.id]);
    expect(result.ok).toBe(true);
    const copy = result.garment.pieces.find((piece) => piece.id === result.activePieceId)!;
    expectEditableCurve(copy);
  });

  it("keeps horizontally mirrored curves directly editable", () => {
    const source = curvedPiece("mirror-horizontal");
    const result = duplicateModelingPieces(garment([source]), [source.id], "horizontal");
    expect(result.ok).toBe(true);
    expectEditableCurve(result.garment.pieces.find((piece) => piece.id === result.activePieceId)!);
  });

  it("keeps vertically mirrored curves directly editable", () => {
    const source = curvedPiece("mirror-vertical");
    const result = duplicateModelingPieces(garment([source]), [source.id], "vertical");
    expect(result.ok).toBe(true);
    expectEditableCurve(result.garment.pieces.find((piece) => piece.id === result.activePieceId)!);
  });

  it("keeps a non-joined curved boundary editable after joining pieces", () => {
    const first = curvedPiece("join-left", "left");
    const second = straightPiece("join-right");
    const result = joinModelingPieces(
      garment([first, second], [
        { xMm: 0, yMm: 0 },
        { xMm: 200, yMm: 80, rotationDeg: 180 },
      ]),
      [first.id, second.id],
    );
    expect(result.ok).toBe(true);
    expectEditableCurve(result.garment.pieces.find((piece) => piece.id === result.activePieceId)!);
  });

  it("keeps a preserved curved boundary editable after a real cut", () => {
    const source = curvedPiece("cut-source", "left");
    const cut = finalizeBoundaryAnchors(
      createInternalPath(source.id, "cut", [
        { xMm: 50, yMm: 0.2 },
        { xMm: 50, yMm: 79.8 },
      ]),
      source,
    );
    const withCut: PatternPiece = { ...source, internalLines: [cut] };
    const result = applyModelingInternalPathOperation(garment([withCut]), withCut.id, cut.id);
    expect(result.ok).toBe(true);
    const curvedResult = result.garment.pieces.find((piece) => firstCurvedEdge(piece));
    expect(curvedResult).toBeTruthy();
    expectEditableCurve(curvedResult!);
  });

  it("keeps cubic internal paths directly editable from segment selection", () => {
    const path: InternalPath = {
      id: "internal-cubic",
      pieceId: "internal-owner",
      name: "Internal cubic",
      purpose: "reference",
      visible: true,
      locked: false,
      metadata: {},
      nodes: [
        { id: "ia", xMm: 20, yMm: 30, handleOut: { xMm: 20, yMm: -12 } },
        { id: "ib", xMm: 80, yMm: 42, handleIn: { xMm: -18, yMm: 14 } },
      ],
      segments: [{ id: "internal-segment", startNodeId: "ia", endNodeId: "ib", kind: "cubic" }],
    };
    expect(internalCurveHandleTargets(path, null, "internal-segment").map((target) => target.handle).sort())
      .toEqual(["in", "out"]);
  });
});
