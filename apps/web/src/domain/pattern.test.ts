import { describe, expect, it } from "vitest";
import {
  parsePatternPiece,
  parsePatternSnapshot,
  polygonAreaMm2,
  polygonPerimeterMm,
} from "./pattern";

describe("pattern geometry", () => {
  const square = [
    { id: "a", xMm: 0, yMm: 0 },
    { id: "b", xMm: 100, yMm: 0 },
    { id: "c", xMm: 100, yMm: 100 },
    { id: "d", xMm: 0, yMm: 100 },
  ];

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
});
