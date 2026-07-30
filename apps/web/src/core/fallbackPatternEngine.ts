import {
  PatternEngineFacade,
  PatternPiece,
  PatternSnapshot,
  parsePatternPiece,
  polygonAreaMm2,
  polygonPerimeterMm,
} from "../domain/pattern";
import {
  samplePatternContour,
  triangulatePatternContour,
} from "../domain/polygonGeometry";

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
    return createPatternSnapshot(this.piece);
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

  moveHandle(
    pointId: string,
    handle: "in" | "out",
    xMm: number,
    yMm: number,
  ): PatternSnapshot {
    assertFinite(xMm, "A coordenada X da alça");
    assertFinite(yMm, "A coordenada Y da alça");

    this.piece.points = this.piece.points.map((point) =>
      point.id === pointId
        ? {
            ...point,
            [handle === "in" ? "handleIn" : "handleOut"]: { xMm, yMm },
          }
        : point,
    );
    return this.snapshot();
  }

  setSegmentCurve(pointId: string, enabled: boolean): PatternSnapshot {
    const startIndex = this.piece.points.findIndex(
      (point) => point.id === pointId,
    );
    if (startIndex < 0) return this.snapshot();

    const endIndex = (startIndex + 1) % this.piece.points.length;
    const start = this.piece.points[startIndex];
    const end = this.piece.points[endIndex];
    const deltaX = end.xMm - start.xMm;
    const deltaY = end.yMm - start.yMm;

    this.piece.points = this.piece.points.map((point, index) => {
      if (index === startIndex) {
        const { handleOut: _removed, ...rest } = point;
        return enabled
          ? { ...rest, handleOut: { xMm: deltaX / 3, yMm: deltaY / 3 } }
          : rest;
      }
      if (index === endIndex) {
        const { handleIn: _removed, ...rest } = point;
        return enabled
          ? { ...rest, handleIn: { xMm: -deltaX / 3, yMm: -deltaY / 3 } }
          : rest;
      }
      return point;
    });
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

export function createPatternSnapshot(piece: PatternPiece): PatternSnapshot {
  const parsedPiece = parsePatternPiece(piece);
  const contour = samplePatternContour(parsedPiece.points);
  const areaMm2 = polygonAreaMm2(contour);
  const perimeterMm = polygonPerimeterMm(contour);
  const triangulation = triangulatePatternContour(contour);
  const issues = triangulation.ok ? [] : triangulation.issues;

  return {
    piece: structuredClone(parsedPiece),
    areaMm2,
    perimeterMm,
    issues,
  };
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} precisa ser um número finito.`);
  }
}
