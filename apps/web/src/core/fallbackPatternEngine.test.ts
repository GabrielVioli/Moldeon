import { describe, expect, it } from "vitest";
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
});
