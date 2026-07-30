import {
  PatternEngineFacade,
  PatternPiece,
  PatternSnapshot,
  parsePatternPiece,
  polygonAreaMm2,
  polygonPerimeterMm,
} from "../domain/pattern";
import { triangulatePatternContour } from "../domain/polygonGeometry";

const DEFAULT_PIECE: PatternPiece = {
  id: "skirt-front",
  name: "Saia base — frente",
  seamAllowanceMm: 10,
  points: [
    { id: "waist-left", xMm: 0, yMm: 0 },
    { id: "waist-right", xMm: 260, yMm: 0 },
    { id: "hem-right", xMm: 315, yMm: 620 },
    { id: "hem-left", xMm: -20, yMm: 620 },
  ],
};

export class FallbackPatternEngine implements PatternEngineFacade {
  readonly backend = "typescript" as const;

  private piece: PatternPiece = structuredClone(DEFAULT_PIECE);

  snapshot(): PatternSnapshot {
    const areaMm2 = polygonAreaMm2(this.piece.points);
    const perimeterMm = polygonPerimeterMm(this.piece.points);
    const triangulation = triangulatePatternContour(this.piece.points);
    const issues = triangulation.ok ? [] : triangulation.issues;

    return {
      piece: structuredClone(this.piece),
      areaMm2,
      perimeterMm,
      issues,
    };
  }

  restorePiece(piece: PatternPiece): PatternSnapshot {
    this.piece = structuredClone(parsePatternPiece(piece));
    return this.snapshot();
  }

  movePoint(pointId: string, xMm: number, yMm: number): PatternSnapshot {
    assertFinite(xMm, "A coordenada X");
    assertFinite(yMm, "A coordenada Y");

    this.piece.points = this.piece.points.map((point) =>
      point.id === pointId ? { ...point, xMm, yMm } : point,
    );

    return this.snapshot();
  }

  setSeamAllowance(valueMm: number): PatternSnapshot {
    assertFinite(valueMm, "A margem de costura");
    this.piece.seamAllowanceMm = Math.max(0, valueMm);
    return this.snapshot();
  }

  reset(): PatternSnapshot {
    this.piece = structuredClone(DEFAULT_PIECE);
    return this.snapshot();
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} precisa ser um número finito.`);
  }
}
