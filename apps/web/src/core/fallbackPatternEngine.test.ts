import { describe, expect, it } from "vitest";
import { migrateLegacyPieceToSegments } from "../domain/pattern";
import { FallbackPatternEngine } from "./fallbackPatternEngine";

describe("FallbackPatternEngine", () => {
  it("restores a saved piece and recalculates derived metrics", () => {
    const engine = new FallbackPatternEngine();
    const restored = engine.restorePiece({
      id: "saved-piece",
      name: "Molde salvo",
      seamAllowanceMm: 12,
      points: [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 100, yMm: 0 },
        { id: "c", xMm: 100, yMm: 100 },
        { id: "d", xMm: 0, yMm: 100 },
      ],
    });

    expect(restored.piece.id).toBe("saved-piece");
    expect(restored.areaMm2).toBe(10_000);
    expect(restored.perimeterMm).toBe(400);
  });

  it("rejects non-finite coordinates", () => {
    const engine = new FallbackPatternEngine();
    expect(() => engine.movePoint("waist-left", Number.POSITIVE_INFINITY, 0)).toThrow(
      "A coordenada X precisa ser um número finito.",
    );
  });

  it("reports a self-intersection without creating invalid preview geometry", () => {
    const engine = new FallbackPatternEngine();
    const snapshot = engine.restorePiece({
      id: "crossed-piece",
      name: "Molde cruzado",
      seamAllowanceMm: 10,
      points: [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 100, yMm: 100 },
        { id: "c", xMm: 0, yMm: 100 },
        { id: "d", xMm: 100, yMm: 0 },
      ],
    });

    expect(snapshot.issues).toContain("O contorno possui uma autointerseção.");
  });

  it("creates and edits a cubic segment without changing the straight baseline", () => {
    const engine = new FallbackPatternEngine();
    const baseline = engine.snapshot();
    const curved = engine.setSegmentCurve("waist-left", true);

    expect(curved.piece.points[0].handleOut).toEqual({
      xMm: 260 / 3,
      yMm: 0,
    });
    expect(curved.areaMm2).toBeCloseTo(baseline.areaMm2);

    const edited = engine.moveHandle("waist-left", "out", 80, -45);
    expect(edited.piece.points[0].handleOut).toEqual({ xMm: 80, yMm: -45 });
    expect(edited.areaMm2).not.toBeCloseTo(baseline.areaMm2);
  });

  it("moves canonical nodes used by versioned library patterns", () => {
    const engine = new FallbackPatternEngine();
    engine.restorePiece(migrateLegacyPieceToSegments({
      id: "versioned-piece",
      name: "Versioned",
      seamAllowanceMm: 10,
      points: [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 100, yMm: 0 },
        { id: "c", xMm: 100, yMm: 100 },
        { id: "d", xMm: 0, yMm: 100 },
      ],
    }));

    const moved = engine.movePoint("b", 140, 20);
    expect(moved.piece.points.find((point) => point.id === "b")).toMatchObject({ xMm: 140, yMm: 20 });
    expect(moved.piece.nodes?.find((node) => node.id === "b")).toMatchObject({ xMm: 140, yMm: 20 });
  });
});
