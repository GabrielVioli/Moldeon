import {
  createDefaultFabricSource,
  fabricPreset,
  type FabricSource,
} from "../domain/fabric";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type BodyMeasurements,
  type GarmentDraft,
  type PatternDart,
  type PatternPiece,
  type PatternPoint,
  type Seam,
  type SegmentRole,
} from "../domain/pattern";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import {
  createGarmentFromTemplate,
  DEFAULT_BODY_MEASUREMENTS,
  type PatternTemplateId,
} from "../patterns/templateCatalog";

export const BASELINE_FIXTURE_IDS = [
  "tshirt-standard",
  "blouse-standard",
  "straight-skirt-standard",
  "mini-skirt-standard",
  "straight-pants-standard",
  "free-simple-piece",
  "bezier-piece",
  "inserted-point-piece",
  "dart-piece",
  "equal-length-seam",
  "length-mismatch-seam",
  "self-seam-tube",
  "sleeve-with-body",
  "multiple-fabrics",
  "legacy-valid",
  "intentionally-invalid",
] as const;

export type BaselineFixtureId = (typeof BASELINE_FIXTURE_IDS)[number];

const MEASUREMENTS: BodyMeasurements = {
  ...DEFAULT_BODY_MEASUREMENTS,
};

export function createBaselineFixture(id: BaselineFixtureId): GarmentDraft {
  switch (id) {
    case "tshirt-standard":
      return templateFixture("tshirt", id);
    case "blouse-standard":
      return templateFixture("blouse", id);
    case "straight-skirt-standard":
      return templateFixture("straight-skirt", id);
    case "mini-skirt-standard":
      return templateFixture("mini-skirt", id);
    case "straight-pants-standard":
      return templateFixture("straight-pants", id);
    case "free-simple-piece":
      return garmentFixture(id, [rectanglePiece("free-piece", 260, 180)]);
    case "bezier-piece":
      return garmentFixture(id, [bezierPiece()]);
    case "inserted-point-piece":
      return garmentFixture(id, [insertedPointPiece()]);
    case "dart-piece":
      return garmentFixture(id, [dartPiece()]);
    case "equal-length-seam":
      return pairedSeamFixture(id, 240, 240);
    case "length-mismatch-seam":
      return pairedSeamFixture(id, 240, 310);
    case "self-seam-tube":
      return selfSeamFixture(id);
    case "sleeve-with-body":
      return templateFixture("tshirt", id);
    case "multiple-fabrics":
      return multipleFabricsFixture(id);
    case "legacy-valid":
      return legacyFixture(id);
    case "intentionally-invalid":
      return invalidFixture(id);
  }
}

export function createAllBaselineFixtures(): Record<
  BaselineFixtureId,
  GarmentDraft
> {
  return Object.fromEntries(
    BASELINE_FIXTURE_IDS.map((id) => [id, createBaselineFixture(id)]),
  ) as Record<BaselineFixtureId, GarmentDraft>;
}

function templateFixture(
  templateId: Exclude<PatternTemplateId, "basic-jacket">,
  fixtureId: string,
): GarmentDraft {
  const generated = createGarmentFromTemplate(
    templateId,
    MEASUREMENTS,
    "feminine",
  );
  const fabric = deterministicFabric("fixture-fabric-primary", "cotton");
  const normalized: GarmentDraft = {
    ...generated,
    id: `fixture-${fixtureId}`,
    fabrics: [fabric],
    pieces: generated.pieces.map((piece) => ({
      ...structuredClone(piece),
      fabricId: fabric.id,
    })),
    seams: structuredClone(generated.seams ?? []),
    assemblyPlacements: structuredClone(generated.assemblyPlacements ?? []),
  };

  return resolveTemplateAssemblyGarment(normalized);
}

function garmentFixture(
  fixtureId: string,
  pieces: PatternPiece[],
  seams: Seam[] = [],
  fabrics: FabricSource[] = [
    deterministicFabric("fixture-fabric-primary", "cotton"),
  ],
): GarmentDraft {
  const primaryFabric = fabrics[0];
  const normalizedPieces = pieces.map((piece) => ({
    ...structuredClone(piece),
    fabricId: piece.fabricId ?? primaryFabric.id,
  }));

  return {
    id: `fixture-${fixtureId}`,
    templateId: fixtureId,
    name: fixtureId,
    description: `Fixture determinística: ${fixtureId}`,
    bodyType: "feminine",
    measurements: { ...MEASUREMENTS },
    fabrics: structuredClone(fabrics),
    pieces: normalizedPieces,
    seams: structuredClone(seams),
    assemblyPlacements: normalizedPieces.map((piece, index) => ({
      pieceId: piece.id,
      role: index === 0 ? "front" : "back",
      outwardSide: index === 0 ? "front" : "back",
      positionMm: [0, 0, index === 0 ? 70 : -70],
      rotationDeg: [0, 0, 0],
      flipped: false,
      source: "template",
    })),
    ease: { bustMm: 80, waistMm: 60, hipMm: 80, sleeveMm: 50 },
  };
}

function rectanglePiece(
  id: string,
  widthMm: number,
  heightMm: number,
  roles: readonly SegmentRole[] = ["waist", "sideSeam", "hem", "sideSeam"],
): PatternPiece {
  return withSegmentRoles(
    migrateLegacyPieceToSegments({
      id,
      name: id,
      seamAllowanceMm: 10,
      cutQuantity: 1,
      points: [
        point(`${id}:a`, 0, 0),
        point(`${id}:b`, widthMm, 0),
        point(`${id}:c`, widthMm, heightMm),
        point(`${id}:d`, 0, heightMm),
      ],
      grainline: {
        start: { xMm: widthMm / 2, yMm: 20 },
        end: { xMm: widthMm / 2, yMm: heightMm - 20 },
      },
    }),
    roles,
  );
}

function bezierPiece(): PatternPiece {
  return withSegmentRoles(
    migrateLegacyPieceToSegments({
      id: "bezier-piece",
      name: "Peça com curva Bézier",
      seamAllowanceMm: 10,
      cutQuantity: 1,
      points: [
        {
          ...point("bezier-piece:a", 0, 70),
          handleOut: { xMm: 65, yMm: -85 },
        },
        {
          ...point("bezier-piece:b", 220, 70),
          handleIn: { xMm: -65, yMm: -85 },
        },
        point("bezier-piece:c", 220, 250),
        point("bezier-piece:d", 0, 250),
      ],
    }),
    ["neckline", "sideSeam", "hem", "sideSeam"],
  );
}

function insertedPointPiece(): PatternPiece {
  return withSegmentRoles(
    migrateLegacyPieceToSegments({
      id: "inserted-point-piece",
      name: "Peça com ponto inserido",
      seamAllowanceMm: 10,
      cutQuantity: 1,
      points: [
        point("inserted-point-piece:a", 0, 0),
        point("inserted-point-piece:b", 120, 0),
        point("inserted-point-piece:inserted", 240, 0),
        point("inserted-point-piece:c", 240, 180),
        point("inserted-point-piece:d", 0, 180),
      ],
    }),
    ["waist", "waist", "sideSeam", "hem", "sideSeam"],
  );
}

function dartPiece(): PatternPiece {
  const piece = rectanglePiece("dart-piece", 300, 420, [
    "waist",
    "sideSeam",
    "hem",
    "fold",
  ]);
  const dart: PatternDart = {
    id: "dart-piece:dart-1",
    pieceId: piece.id,
    apex: { xMm: 165, yMm: 145 },
    legA: { xMm: 145, yMm: 0 },
    legB: { xMm: 185, yMm: 0 },
    centerLine: {
      start: { xMm: 165, yMm: 0 },
      end: { xMm: 165, yMm: 145 },
    },
    widthMm: 40,
    lengthMm: 145,
    directionDeg: 90,
    closed: true,
  };
  return { ...piece, cutOnFold: true, darts: [dart] };
}

function pairedSeamFixture(
  fixtureId: string,
  firstHeightMm: number,
  secondHeightMm: number,
): GarmentDraft {
  const first = rectanglePiece("seam-first", 180, firstHeightMm);
  const second = rectanglePiece("seam-second", 180, secondHeightMm);
  const firstEdge = getPatternEdges(first).find((edge) => edge.role === "sideSeam")!;
  const secondEdge = getPatternEdges(second).find((edge) => edge.role === "sideSeam")!;
  const seam: Seam = {
    id: `${fixtureId}:seam`,
    name: fixtureId,
    first: { pieceId: first.id, edgeId: firstEdge.id, startT: 0, endT: 1 },
    second: { pieceId: second.id, edgeId: secondEdge.id, startT: 0, endT: 1 },
    direction: "same",
    easeRatio:
      Math.abs(firstHeightMm - secondHeightMm) /
      Math.max(firstHeightMm, secondHeightMm),
    type: firstHeightMm === secondHeightMm ? "standard" : "intentional-mismatch",
    treatment:
      firstHeightMm === secondHeightMm ? "standard" : "intentional-mismatch",
  };
  return garmentFixture(fixtureId, [first, second], [seam]);
}

function selfSeamFixture(fixtureId: string): GarmentDraft {
  const piece = rectanglePiece("tube-piece", 360, 260);
  const sideEdges = getPatternEdges(piece).filter(
    (edge) => edge.role === "sideSeam",
  );
  const seam: Seam = {
    id: "tube-piece:self-seam",
    name: "Fechamento do tubo",
    first: {
      pieceId: piece.id,
      edgeId: sideEdges[0].id,
      startT: 0,
      endT: 1,
    },
    second: {
      pieceId: piece.id,
      edgeId: sideEdges[1].id,
      startT: 0,
      endT: 1,
    },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
  };
  return garmentFixture(fixtureId, [piece], [seam]);
}

function multipleFabricsFixture(fixtureId: string): GarmentDraft {
  const garment = templateFixture("straight-skirt", fixtureId);
  const cotton = deterministicFabric("fixture-fabric-cotton", "cotton");
  const denim = deterministicFabric("fixture-fabric-denim", "denim");
  return {
    ...garment,
    fabrics: [cotton, denim],
    pieces: garment.pieces.map((piece, index) => ({
      ...piece,
      fabricId: index === 0 ? cotton.id : denim.id,
    })),
  };
}

function legacyFixture(fixtureId: string): GarmentDraft {
  const legacyPiece: PatternPiece = {
    id: "legacy-piece",
    name: "Projeto legado válido",
    seamAllowanceMm: 12,
    points: [
      point("legacy:a", 0, 0),
      point("legacy:b", 220, 0),
      point("legacy:c", 250, 260),
      point("legacy:d", 20, 260),
    ],
  };
  return garmentFixture(fixtureId, [legacyPiece]);
}

function invalidFixture(fixtureId: string): GarmentDraft {
  const invalidPiece = migrateLegacyPieceToSegments({
    id: "invalid-bowtie",
    name: "Contorno propositalmente inválido",
    seamAllowanceMm: 10,
    points: [
      point("invalid:a", 0, 0),
      point("invalid:b", 220, 220),
      point("invalid:c", 0, 220),
      point("invalid:d", 220, 0),
    ],
  });
  return garmentFixture(fixtureId, [invalidPiece]);
}

function withSegmentRoles(
  piece: PatternPiece,
  roles: readonly SegmentRole[],
): PatternPiece {
  return {
    ...piece,
    segments: piece.segments?.map((segment, index) => ({
      ...segment,
      role: roles[index] ?? "other",
    })),
  };
}

function deterministicFabric(
  id: string,
  presetId: "cotton" | "denim",
): FabricSource {
  const preset = fabricPreset(presetId);
  return {
    ...createDefaultFabricSource(),
    id,
    name: preset.name,
    presetId,
    color: preset.color,
    physics: { ...preset.physics },
  };
}

function point(id: string, xMm: number, yMm: number): PatternPoint {
  return { id, xMm, yMm };
}
