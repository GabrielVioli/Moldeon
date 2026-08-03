import { describe, expect, it } from "vitest";
import {
  createPatternPieceFromDraft,
  duplicatePatternPiece,
  parseGarmentDraft,
  parsePatternPiece,
  parsePatternSnapshot,
  polygonAreaMm2,
  polygonPerimeterMm,
} from "./pattern";
import { createDefaultFabricSource } from "./fabric";

describe("pattern geometry", () => {
  const square = [
    { id: "a", xMm: 0, yMm: 0 },
    { id: "b", xMm: 100, yMm: 0 },
    { id: "c", xMm: 100, yMm: 100 },
    { id: "d", xMm: 0, yMm: 100 },
  ];
  const piece = (name: string, id: string) => createPatternPieceFromDraft({ id, name, points: square, closed: true });

  it("calculates polygon area", () => {
    expect(polygonAreaMm2(square)).toBe(10000);
  });

  it("calculates polygon perimeter", () => {
    expect(polygonPerimeterMm(square)).toBe(400);
  });

  it("parses valid data without a general-purpose schema runtime", () => {
    const piece = parsePatternPiece({
      id: "square",
      name: "Quadrado",
      seamAllowanceMm: 10,
      points: square,
    });

    expect(
      parsePatternSnapshot({
        piece,
        areaMm2: 10_000,
        perimeterMm: 400,
        issues: [],
      }),
    ).toEqual({
      piece,
      areaMm2: 10_000,
      perimeterMm: 400,
      issues: [],
    });
  });

  it("rejects non-finite or structurally invalid persisted data", () => {
    expect(() =>
      parsePatternPiece({
        id: "invalid",
        name: "Inválido",
        seamAllowanceMm: 10,
        points: [
          ...square.slice(0, 3),
          { id: "d", xMm: Number.POSITIVE_INFINITY, yMm: 0 },
        ],
      }),
    ).toThrow("A coordenada X do ponto 4 precisa ser um número finito.");
  });

  it("parses optional Bézier handles while keeping old files compatible", () => {
    const piece = parsePatternPiece({
      id: "curve",
      name: "Curva",
      seamAllowanceMm: 10,
      points: [
        { ...square[0], handleOut: { xMm: 20, yMm: -10 } },
        { ...square[1], handleIn: { xMm: -20, yMm: -10 } },
        square[2],
        square[3],
      ],
    });

    expect(piece.points[0].handleOut).toEqual({ xMm: 20, yMm: -10 });
    expect(piece.points[2].handleIn).toBeUndefined();
  });

  it("duplicates a piece with new point ids while preserving geometry", () => {
    const source = piece("Base", "piece-base");
    const duplicate = duplicatePatternPiece(source, { newId: "piece-copy", name: "Base – cópia" });

    expect(duplicate.id).toBe("piece-copy");
    expect(duplicate.name).toBe("Base – cópia");
    expect(duplicate.points.map((point) => point.id)).not.toContain(source.points[0].id);
    expect(duplicate.points[0].xMm).toBe(source.points[0].xMm);
    expect(duplicate.points[1].yMm).toBe(source.points[1].yMm);
  });

  it("mirrors asymmetric Bézier geometry without reusing ids or losing metadata", () => {
    const source = { ...piece("Assimétrica", "piece-curve"), grainline: { start: { xMm: 10, yMm: 5 }, end: { xMm: 10, yMm: 90 } }, annotations: [{ id: "note-1", label: "Pique", xMm: 25, yMm: 40 }] };
    source.points[0].handleOut = { xMm: 12, yMm: -7 };
    const mirrored = duplicatePatternPiece(source, { mirrored: true, newId: "piece-mirror" });
    expect(new Set(mirrored.points.map((point) => point.id)).size).toBe(source.points.length);
    expect(mirrored.points.every((point) => !source.points.some((original) => original.id === point.id))).toBe(true);
    expect(mirrored.points.some((point) => point.handleIn || point.handleOut)).toBe(true);
    expect(mirrored.grainline).toEqual(source.grainline);
    expect(mirrored.annotations).toEqual(source.annotations);
  });

  it("parses workspace transforms for multi-piece drafting layouts", () => {
    const garment = parseGarmentDraft({
      id: "draft-1",
      templateId: "base",
      name: "Projeto",
      description: "Projeto base",
      bodyType: "feminine",
      measurements: {
        heightMm: 1680,
        bustMm: 920,
        waistMm: 760,
        hipMm: 1000,
        shoulderWidthMm: 400,
        torsoLengthMm: 440,
        armLengthMm: 590,
        inseamMm: 780,
      },
      fabrics: [createDefaultFabricSource()],
      pieces: [
        piece("P1", "piece-1"),
        piece("P2", "piece-2"),
      ],
      workspaceTransforms: [
        { pieceId: "piece-1", xMm: 120, yMm: 60, rotationDeg: 0 },
        { pieceId: "piece-2", xMm: 340, yMm: 60, rotationDeg: 0 },
      ],
    });

    expect(garment.workspaceTransforms).toEqual([
      { pieceId: "piece-1", xMm: 120, yMm: 60, rotationDeg: 0 },
      { pieceId: "piece-2", xMm: 340, yMm: 60, rotationDeg: 0 },
    ]);
  });
});
