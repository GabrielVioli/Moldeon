import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import {
  edgeRangeLength,
  getPatternEdges,
  type PatternPiece,
} from "../domain/pattern";
import {
  createAllParametricBodyFixtures,
  createParametricBodyFixture,
} from "../testFixtures/parametricBodyFixtures";
import {
  BASE_PATTERN_METADATA,
  draftBasePattern,
  type BasePatternTemplateId,
} from "./basePatternDrafting";
import { createGarmentFromTemplate } from "./templateCatalog";

const TARGETS: readonly BasePatternTemplateId[] = [
  "bodice-block",
  "tshirt",
  "blouse",
  "straight-skirt",
  "mini-skirt",
];

const UPPER_TARGETS: readonly BasePatternTemplateId[] = [
  "bodice-block",
  "tshirt",
  "blouse",
];

const SKIRT_TARGETS: readonly BasePatternTemplateId[] = [
  "straight-skirt",
  "mini-skirt",
];

describe("versioned base-pattern drafting", () => {
  it.each(createAllParametricBodyFixtures())(
    "creates non-degenerate 2D geometry for the $id body",
    (fixture) => {
      for (const templateId of TARGETS) {
        const garment = createGarmentFromTemplate(
          templateId,
          fixture.supplied,
          fixture.bodyType,
          fixture.profile,
        );
        expect(garment.parametric?.templateVersion).toBe(
          BASE_PATTERN_METADATA[templateId].templateVersion,
        );
        expect(garment.parametric?.variables.length).toBeGreaterThan(10);
        expect(garment.parametric?.constructionGraph.version).toBe(2);

        for (const piece of garment.pieces) {
          const snapshot = new FallbackPatternEngine().restorePiece(piece);
          expect(snapshot.issues, `${fixture.id}/${templateId}/${piece.name}`).toEqual([]);
          expect(snapshot.areaMm2).toBeGreaterThan(
            BASE_PATTERN_METADATA[templateId].limits.minimumAreaMm2,
          );
          expect(snapshot.perimeterMm).toBeGreaterThan(100);
          expect(piece.grainline).toBeDefined();
          expect(piece.points.every((point) => Number.isFinite(point.xMm) && Number.isFinite(point.yMm))).toBe(true);
        }
      }
    },
  );

  it.each(UPPER_TARGETS)(
    "%s has distinct front/back necklines and armholes with compatible joins",
    (templateId) => {
      const fixture = createParametricBodyFixture("medium");
      const garment = createGarmentFromTemplate(templateId, fixture.supplied, fixture.bodyType, fixture.profile);
      const front = pieceNamed(garment.pieces, "Frente");
      const back = pieceNamed(garment.pieces, "Costas");
      const tolerance = BASE_PATTERN_METADATA[templateId].limits;

      expect(front.points[0].yMm).toBeGreaterThan(back.points[0].yMm);
      expect(Math.abs(roleLength(front, "frontArmhole") - roleLength(back, "backArmhole"))).toBeGreaterThan(1);
      expect(Math.abs(roleLength(front, "shoulder") - roleLength(back, "shoulder"))).toBeLessThanOrEqual(tolerance.shoulderToleranceMm ?? 1);
      expect(Math.abs(roleLength(front, "sideSeam") - roleLength(back, "sideSeam"))).toBeLessThanOrEqual(tolerance.sideSeamToleranceMm);
      expect(front.annotations?.some((annotation) => /Pique frontal/.test(annotation.label))).toBe(true);
      expect(back.annotations?.some((annotation) => /Piques traseiros/.test(annotation.label))).toBe(true);
    },
  );

  it.each(SKIRT_TARGETS)("%s uses different front/back distribution and structural darts", (templateId) => {
    const fixture = createParametricBodyFixture("medium");
    const garment = createGarmentFromTemplate(templateId, fixture.supplied, fixture.bodyType, fixture.profile);
    const front = pieceNamed(garment.pieces, "Frente");
    const back = pieceNamed(garment.pieces, "Costas");

    expect(front.darts).toHaveLength(1);
    expect(back.darts).toHaveLength(1);
    expect(front.darts?.[0].closed).toBe(true);
    expect(back.darts?.[0].closed).toBe(true);
    expect(back.darts?.[0].widthMm).toBeGreaterThan(front.darts?.[0].widthMm ?? 0);
    expect(maxX(front)).not.toBe(maxX(back));

    const withoutDarts = draftBasePattern(templateId, garment.measurements, { dartScale: 0 });
    const openFront = pieceNamed(withoutDarts.pieces, "Frente");
    expect(openFront.darts).toHaveLength(0);
    expect(openFront.points[1].xMm).not.toBe(front.points[1].xMm);
    const withArea = new FallbackPatternEngine().restorePiece(front).areaMm2;
    const withoutArea = new FallbackPatternEngine().restorePiece(openFront).areaMm2;
    expect(Math.abs(withArea - withoutArea)).toBeGreaterThan(50);
  });

  it("persists connector landmarks without relying on template names", () => {
    const fixture = createParametricBodyFixture("medium");
    const garment = createGarmentFromTemplate("tshirt", fixture.supplied, fixture.bodyType, fixture.profile);
    const document = garmentDraftToPatternDocumentV3(garment);
    const front = document.patternDefinitions.find((definition) => definition.semanticRole === "front")!;
    const back = document.patternDefinitions.find((definition) => definition.semanticRole === "back")!;
    const sleeve = document.patternDefinitions.find((definition) => definition.semanticRole === "sleeve")!;

    expect(connector(front, "front-armhole").landmarks.map((landmark) => landmark.kind)).toEqual(
      expect.arrayContaining(["start", "end", "notch"]),
    );
    expect(connector(back, "back-armhole").landmarks.filter((landmark) => landmark.kind === "notch")).toHaveLength(2);
    expect(connector(front, "shoulder").landmarks.some((landmark) => landmark.kind === "balance")).toBe(true);
    expect(connector(sleeve, "sleeve-cap-front").landmarks.some((landmark) => landmark.kind === "notch")).toBe(true);
    expect(connector(sleeve, "sleeve-cap-back").landmarks.filter((landmark) => landmark.kind === "notch")).toHaveLength(2);
  });

  it("updates continuously when measurements change without inversions or fixed offsets", () => {
    const fixture = createParametricBodyFixture("medium");
    const widths: number[] = [];
    const areas: number[] = [];
    for (let bustMm = 780; bustMm <= 1280; bustMm += 25) {
      const garment = createGarmentFromTemplate(
        "tshirt",
        { ...fixture.supplied, bustMm },
        fixture.bodyType,
      );
      const front = pieceNamed(garment.pieces, "Frente");
      widths.push(maxX(front));
      areas.push(signedArea(front));
      expect(new FallbackPatternEngine().restorePiece(front).issues).toEqual([]);
    }
    expect(widths.every((width, index) => index === 0 || width >= widths[index - 1] - 0.1)).toBe(true);
    expect(areas.every((area) => Number.isFinite(area) && Math.sign(area) === Math.sign(areas[0]))).toBe(true);
    expect(maxAdjacentJump(widths)).toBeLessThan(15);
  });

  it("matches the reviewed golden metric snapshots for varied bodies", () => {
    const golden = createAllParametricBodyFixtures().flatMap((fixture) =>
      TARGETS.map((templateId) => {
        const garment = createGarmentFromTemplate(templateId, fixture.supplied, fixture.bodyType, fixture.profile);
        return {
          fixture: fixture.id,
          template: templateId,
          version: BASE_PATTERN_METADATA[templateId].templateVersion,
          pieces: garment.pieces.map(metricRecord),
        };
      }),
    );
    expect(golden).toMatchSnapshot();
  });
});

function metricRecord(piece: PatternPiece) {
  const snapshot = new FallbackPatternEngine().restorePiece(piece);
  const xs = piece.points.map((point) => point.xMm);
  const ys = piece.points.map((point) => point.yMm);
  return {
    name: piece.name,
    areaMm2: round(snapshot.areaMm2),
    perimeterMm: round(snapshot.perimeterMm),
    widthMm: round(Math.max(...xs) - Math.min(...xs)),
    heightMm: round(Math.max(...ys) - Math.min(...ys)),
    shoulderMm: round(roleLength(piece, "shoulder")),
    sideSeamMm: round(roleLength(piece, "sideSeam")),
    frontArmholeMm: round(roleLength(piece, "frontArmhole")),
    backArmholeMm: round(roleLength(piece, "backArmhole")),
    dartWidthsMm: (piece.darts ?? []).map((dart) => round(dart.widthMm)),
  };
}

function pieceNamed(pieces: readonly PatternPiece[], name: string): PatternPiece {
  const piece = pieces.find((candidate) => candidate.name === name);
  if (!piece) throw new Error(`Peça ${name} ausente.`);
  return piece;
}

function roleLength(piece: PatternPiece, role: string): number {
  return getPatternEdges(piece)
    .filter((edge) => edge.role === role)
    .reduce(
      (sum, edge) => sum + edgeRangeLength(piece, {
        pieceId: piece.id,
        edgeId: edge.id,
        startT: 0,
        endT: 1,
      }),
      0,
    );
}

function connector(
  definition: ReturnType<typeof garmentDraftToPatternDocumentV3>["patternDefinitions"][number],
  role: string,
) {
  const value = definition.connectors.find((candidate) => candidate.role === role);
  if (!value) throw new Error(`Conector ${role} ausente em ${definition.name}.`);
  return value;
}

function maxX(piece: PatternPiece): number {
  return Math.max(...piece.points.map((point) => point.xMm));
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
