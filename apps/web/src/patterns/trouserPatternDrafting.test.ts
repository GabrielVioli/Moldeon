import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import {
  edgeRangeLength,
  getPatternEdges,
  type PatternPiece,
} from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import {
  createAllParametricBodyFixtures,
  createParametricBodyFixture,
} from "../testFixtures/parametricBodyFixtures";
import { createGarmentFromTemplate } from "./templateCatalog";
import {
  draftTrouserPattern,
  TROUSER_PATTERN_METADATA,
} from "./trouserPatternDrafting";

describe("versioned parametric trouser drafting", () => {
  it.each(createAllParametricBodyFixtures())(
    "creates distinct non-degenerate front and back for the $id body",
    (fixture) => {
      const garment = createGarmentFromTemplate(
        "straight-pants",
        fixture.supplied,
        fixture.bodyType,
        fixture.profile,
      );
      expect(garment.parametric?.templateVersion).toBe("straight-pants@3");
      expect(garment.parametric?.variables.length).toBeGreaterThan(35);
      expect(garment.parametric?.constructionGraph.version).toBe(2);
      expect(garment.pieces).toHaveLength(2);

      const front = pieceByCrotchRole(garment.pieces, "frontCrotch");
      const back = pieceByCrotchRole(garment.pieces, "backCrotch");
      for (const piece of [front, back]) {
        const snapshot = new FallbackPatternEngine().restorePiece(piece);
        expect(snapshot.issues, `${fixture.id}/${piece.name}`).toEqual([]);
        expect(snapshot.areaMm2).toBeGreaterThan(TROUSER_PATTERN_METADATA.limits.minimumAreaMm2);
        expect(snapshot.perimeterMm).toBeGreaterThan(1_000);
        expect(piece.cutQuantity).toBe(2);
        expect(piece.previewPlacements?.map((placement) => placement.bodySide)).toEqual(["left", "right"]);
        expect(piece.previewPlacements?.map((placement) => Boolean(placement.mirrorX))).toEqual([false, true]);
        expect(piece.grainline).toBeDefined();
        expect(piece.internalLines).toHaveLength(4);
        expect(piece.annotations?.some((annotation) => /quadril/i.test(annotation.label))).toBe(true);
        expect(piece.annotations?.some((annotation) => /joelho/i.test(annotation.label))).toBe(true);
        expect(piece.annotations?.some((annotation) => /gancho/i.test(annotation.label))).toBe(true);
      }

      expect(roleLength(back, "backCrotch")).toBeGreaterThan(roleLength(front, "frontCrotch"));
      expect(front.points.some((point) => point.id.endsWith(":fork"))).toBe(true);
      expect(back.points.some((point) => point.id.endsWith(":fork"))).toBe(true);
      expect(front.points.some((point) => /:(inseam-crotch|crotch-tip)$/.test(point.id))).toBe(false);
      expect(back.points.some((point) => /:(inseam-crotch|crotch-tip)$/.test(point.id))).toBe(false);
      expect(minX(back)).toBeLessThan(minX(front));
      expect(back.points[0].yMm).toBeLessThan(front.points[0].yMm);
      expect(maxX(back)).not.toBe(maxX(front));
      expect(Math.abs(roleLength(front, "outseam") - roleLength(back, "outseam"))).toBeLessThanOrEqual(
        TROUSER_PATTERN_METADATA.limits.sideSeamToleranceMm,
      );
      expect(Math.abs(roleLength(front, "inseam") - roleLength(back, "inseam"))).toBeLessThanOrEqual(
        TROUSER_PATTERN_METADATA.limits.inseamToleranceMm,
      );
    },
  );

  it("uses structural front and back darts", () => {
    const fixture = createParametricBodyFixture("medium");
    const garment = createGarmentFromTemplate(
      "straight-pants",
      fixture.supplied,
      fixture.bodyType,
      fixture.profile,
    );
    const front = pieceByCrotchRole(garment.pieces, "frontCrotch");
    const back = pieceByCrotchRole(garment.pieces, "backCrotch");
    expect(front.darts).toHaveLength(1);
    expect(back.darts).toHaveLength(1);
    expect(front.darts?.[0].closed).toBe(true);
    expect(back.darts?.[0].closed).toBe(true);
    expect(back.darts?.[0].widthMm).toBeGreaterThan(front.darts?.[0].widthMm ?? 0);

    const withoutDarts = draftTrouserPattern(garment.measurements, { dartScale: 0 });
    const frontWithout = pieceByCrotchRole(withoutDarts.pieces, "frontCrotch");
    const backWithout = pieceByCrotchRole(withoutDarts.pieces, "backCrotch");
    expect(frontWithout.darts).toHaveLength(0);
    expect(backWithout.darts).toHaveLength(0);
    expect(frontWithout.points[1].xMm).not.toBe(front.points[1].xMm);
    expect(backWithout.points[1].xMm).not.toBe(back.points[1].xMm);
    const frontArea = new FallbackPatternEngine().restorePiece(front).areaMm2;
    const frontWithoutArea = new FallbackPatternEngine().restorePiece(frontWithout).areaMm2;
    expect(Math.abs(frontArea - frontWithoutArea)).toBeGreaterThan(100);
  });

  it("persists waist, leg, crotch and hem connectors with landmarks", () => {
    const fixture = createParametricBodyFixture("medium");
    const garment = createGarmentFromTemplate(
      "straight-pants",
      fixture.supplied,
      fixture.bodyType,
      fixture.profile,
    );
    const document = garmentDraftToPatternDocumentV3(garment);
    const front = document.patternDefinitions.find((definition) =>
      definition.connectors.some((connector) => connector.role === "front-rise"),
    );
    const back = document.patternDefinitions.find((definition) =>
      definition.connectors.some((connector) => connector.role === "back-rise"),
    );
    expect(front).toBeDefined();
    expect(back).toBeDefined();
    for (const definition of [front!, back!]) {
      for (const role of ["waist", "outseam", "inseam", "hem"] as const) {
        const connector = definition.connectors.find((candidate) => candidate.role === role);
        expect(connector, `${definition.name}/${role}`).toBeDefined();
        expect(connector?.landmarks.map((landmark) => landmark.kind)).toEqual(
          expect.arrayContaining(["start", "end"]),
        );
      }
    }
    expect(front?.connectors.some((connector) => connector.role === "front-rise")).toBe(true);
    expect(back?.connectors.some((connector) => connector.role === "back-rise")).toBe(true);
  });

  it("updates continuously across hip measurements without inversion or jumps", () => {
    const fixture = createParametricBodyFixture("medium");
    const widths: number[] = [];
    const signedAreas: number[] = [];
    for (let hipMm = 780; hipMm <= 1380; hipMm += 20) {
      const garment = createGarmentFromTemplate(
        "straight-pants",
        { ...fixture.supplied, hipMm },
        fixture.bodyType,
      );
      const front = pieceByCrotchRole(garment.pieces, "frontCrotch");
      const snapshot = new FallbackPatternEngine().restorePiece(front);
      expect(snapshot.issues).toEqual([]);
      widths.push(maxX(front) - minX(front));
      signedAreas.push(signedArea(front));
    }
    expect(widths.every((width, index) => index === 0 || width >= widths[index - 1] - 0.2)).toBe(true);
    expect(signedAreas.every((area) => Number.isFinite(area) && Math.sign(area) === Math.sign(signedAreas[0]))).toBe(true);
    expect(maxAdjacentJump(widths)).toBeLessThan(10);
  });

  it("matches golden geometry metrics for varied bodies", () => {
    const golden = createAllParametricBodyFixtures().map((fixture) => {
      const garment = createGarmentFromTemplate(
        "straight-pants",
        fixture.supplied,
        fixture.bodyType,
        fixture.profile,
      );
      return {
        fixture: fixture.id,
        template: TROUSER_PATTERN_METADATA.templateVersion,
        pieces: garment.pieces.map(metricRecord),
      };
    });
    expect(golden).toMatchSnapshot();
  });
});

function metricRecord(piece: PatternPiece) {
  const snapshot = new FallbackPatternEngine().restorePiece(piece);
  return {
    name: piece.name,
    areaMm2: round(snapshot.areaMm2),
    perimeterMm: round(snapshot.perimeterMm),
    widthMm: round(maxX(piece) - minX(piece)),
    heightMm: round(maxY(piece) - minY(piece)),
    outseamMm: round(roleLength(piece, "outseam")),
    inseamMm: round(roleLength(piece, "inseam")),
    frontCrotchMm: round(roleLength(piece, "frontCrotch")),
    backCrotchMm: round(roleLength(piece, "backCrotch")),
    dartWidthsMm: (piece.darts ?? []).map((dart) => round(dart.widthMm)),
  };
}

function pieceByCrotchRole(
  pieces: readonly PatternPiece[],
  role: "frontCrotch" | "backCrotch",
): PatternPiece {
  const piece = pieces.find((candidate) => getPatternEdges(candidate).some((edge) => edge.role === role));
  if (!piece) throw new Error(`Peça com ${role} ausente.`);
  return piece;
}

function roleLength(piece: PatternPiece, role: string): number {
  return getPatternEdges(piece)
    .filter((edge) => edge.role === role)
    .reduce((sum, edge) => sum + edgeRangeLength(piece, {
      pieceId: piece.id,
      edgeId: edge.id,
      startT: 0,
      endT: 1,
    }), 0);
}

function maxX(piece: PatternPiece): number {
  return Math.max(...piece.points.map((point) => point.xMm));
}

function minX(piece: PatternPiece): number {
  return Math.min(...piece.points.map((point) => point.xMm));
}

function maxY(piece: PatternPiece): number {
  return Math.max(...piece.points.map((point) => point.yMm));
}

function minY(piece: PatternPiece): number {
  return Math.min(...piece.points.map((point) => point.yMm));
}

function signedArea(piece: PatternPiece): number {
  return piece.points.reduce((sum, point, index) => {
    const next = piece.points[(index + 1) % piece.points.length];
    return sum + point.xMm * next.yMm - next.xMm * point.yMm;
  }, 0) / 2;
}

function maxAdjacentJump(values: readonly number[]): number {
  return Math.max(...values.slice(1).map((value, index) => Math.abs(value - values[index])));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
