import {
  PatternEngineFacade,
  PatternPoint,
  PatternSnapshot,
  polygonAreaMm2,
  polygonPerimeterMm,
} from "../domain/pattern";

const DEFAULT_POINTS: PatternPoint[] = [
  { id: "waist-left", xMm: 0, yMm: 0 },
  { id: "waist-right", xMm: 260, yMm: 0 },
  { id: "hem-right", xMm: 315, yMm: 620 },
  { id: "hem-left", xMm: -20, yMm: 620 },
];

export class FallbackPatternEngine implements PatternEngineFacade {
  readonly backend = "typescript" as const;

  private points: PatternPoint[] = structuredClone(DEFAULT_POINTS);
  private seamAllowanceMm = 10;

  snapshot(): PatternSnapshot {
    const issues: string[] = [];
    const areaMm2 = polygonAreaMm2(this.points);
    const perimeterMm = polygonPerimeterMm(this.points);

    if (areaMm2 < 1) {
      issues.push("O contorno não possui área suficiente.");
    }

    if (this.points.some((point) => !Number.isFinite(point.xMm) || !Number.isFinite(point.yMm))) {
      issues.push("Existe um ponto com coordenada inválida.");
    }

    return {
      piece: {
        id: "skirt-front",
        name: "Saia base — frente",
        seamAllowanceMm: this.seamAllowanceMm,
        points: structuredClone(this.points),
      },
      areaMm2,
      perimeterMm,
      issues,
    };
  }

  movePoint(pointId: string, xMm: number, yMm: number): PatternSnapshot {
    this.points = this.points.map((point) =>
      point.id === pointId ? { ...point, xMm, yMm } : point,
    );

    return this.snapshot();
  }

  setSeamAllowance(valueMm: number): PatternSnapshot {
    this.seamAllowanceMm = Math.max(0, valueMm);
    return this.snapshot();
  }

  reset(): PatternSnapshot {
    this.points = structuredClone(DEFAULT_POINTS);
    this.seamAllowanceMm = 10;
    return this.snapshot();
  }
}
