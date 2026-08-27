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
  "exact-contact-tube",
  "xpbd-tube-with-flap",
  "xpbd-four-panel-composite",
  "spatial-two-panel-tube",
  "spatial-four-panel-tube",
  "spatial-open-chain",
  "spatial-notched-tube",
  "spatial-notched-tube-waistband",
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
    case "exact-contact-tube":
      return exactContactTubeFixture(id);
    case "xpbd-tube-with-flap":
      return tubeWithFlapFixture(id);
    case "xpbd-four-panel-composite":
      return fourPanelCompositeFixture(id);
    case "spatial-two-panel-tube":
      return spatialPanelFixture(id, 2, true);
    case "spatial-four-panel-tube":
      return spatialPanelFixture(id, 4, true);
    case "spatial-open-chain":
      return spatialPanelFixture(id, 3, false);
    case "spatial-notched-tube":
      return spatialNotchedTubeFixture(id);
    case "spatial-notched-tube-waistband":
      return spatialNotchedTubeWaistbandFixture(id);
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
    pieces: generated.pieces.map((piece) => normalizeGeneratedPiece(piece, fabric.id)),
    seams: structuredClone(generated.seams ?? []),
    assemblyPlacements: structuredClone(generated.assemblyPlacements ?? []),
  };

  return resolveTemplateAssemblyGarment(normalized);
}

function normalizeGeneratedPiece(
  piece: PatternPiece,
  fabricId: string,
): PatternPiece {
  const clone = structuredClone(piece);
  return {
    ...clone,
    fabricId,
    darts: clone.darts?.map((dart, index) => ({
      ...dart,
      id: `${clone.id}:fixture-dart-${index + 1}`,
      pieceId: clone.id,
    })),
  };
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

function selfSeamFixture(fixtureId: string, circumferenceMm = 360): GarmentDraft {
  const piece = rectanglePiece("tube-piece", circumferenceMm, 260);
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
  return {
    ...garmentFixture(fixtureId, [piece], [seam]),
    dressing: { region: "upper", frontReferencePieceId: piece.id },
  };
}

function exactContactTubeFixture(fixtureId: string): GarmentDraft {
  // The canonical body measures 1000 mm at the full hip. A 40 mm wearing
  // ease keeps the shell valid at step zero while gravity establishes a
  // shallow, recoverable contact on the real (non-ellipsoidal) hip surface.
  const tube = selfSeamFixture(fixtureId, 1040);
  return {
    ...tube,
    dressing: { region: "lower", frontReferencePieceId: tube.pieces[0].id },
  };
}

function tubeWithFlapFixture(fixtureId: string): GarmentDraft {
  const tube = selfSeamFixture(fixtureId);
  const flap = {
    ...rectanglePiece("xpbd-flap-piece", 140, 120),
    fabricId: tube.fabrics[0].id,
  };
  const tubeTop = getPatternEdges(tube.pieces[0]).find((edge) => edge.role === "waist")!;
  const flapTop = getPatternEdges(flap).find((edge) => edge.role === "waist")!;
  const parentSpan = 140 / 360;
  const parentStart = (1 - parentSpan) / 2;
  const flapSeam: Seam = {
    id: `${fixtureId}:flap-seam`,
    name: "Retalho costurado ao tubo",
    first: { pieceId: tube.pieces[0].id, edgeId: tubeTop.id, startT: parentStart, endT: 1 - parentStart },
    second: { pieceId: flap.id, edgeId: flapTop.id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
  };
  return {
    ...tube,
    dressing: { region: "upper", frontReferencePieceId: tube.pieces[0].id },
    pieces: [...tube.pieces, flap],
    seams: [...(tube.seams ?? []), flapSeam],
    assemblyPlacements: [
      ...(tube.assemblyPlacements ?? []),
      {
        pieceId: flap.id,
        role: "front",
        outwardSide: "front",
        positionMm: [250, 0, 0],
        rotationDeg: [0, 0, 0],
        flipped: false,
        source: "manual",
      },
    ],
  };
}

function fourPanelCompositeFixture(fixtureId: string): GarmentDraft {
  const pieces = Array.from({ length: 4 }, (_, index) =>
    rectanglePiece(`xpbd-panel-${index + 1}`, 160, 220));
  const topEdges = pieces.map((piece) => getPatternEdges(piece).find((edge) => edge.role === "waist")!);
  const firstRanges = [
    { pieceId: pieces[0].id, edgeId: topEdges[0].id, startT: 0, endT: 1 },
    { pieceId: pieces[1].id, edgeId: topEdges[1].id, startT: 0, endT: 1 },
  ];
  const secondRanges = [
    { pieceId: pieces[2].id, edgeId: topEdges[2].id, startT: 0, endT: 0.5 },
    { pieceId: pieces[2].id, edgeId: topEdges[2].id, startT: 0.5, endT: 1 },
    { pieceId: pieces[3].id, edgeId: topEdges[3].id, startT: 0, endT: 1 },
  ];
  const composite: Seam = {
    id: `${fixtureId}:composite-2-to-3`,
    groupId: `${fixtureId}:composite-2-to-3`,
    name: "Costura composta 2 para 3",
    first: firstRanges[0],
    second: secondRanges[0],
    firstRanges,
    secondRanges,
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
  };
  const firstSide = getPatternEdges(pieces[0]).find((edge) => edge.role === "sideSeam")!;
  const thirdSide = getPatternEdges(pieces[2]).find((edge) => edge.role === "sideSeam")!;
  const simple: Seam = {
    id: `${fixtureId}:secondary-side-seam`,
    groupId: `${fixtureId}:secondary-side-seam`,
    name: "Costura lateral secundária",
    first: { pieceId: pieces[0].id, edgeId: firstSide.id, startT: 0, endT: 1 },
    second: { pieceId: pieces[2].id, edgeId: thirdSide.id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
  };
  return {
    ...garmentFixture(fixtureId, pieces, [composite, simple]),
    dressing: { region: "upper", frontReferencePieceId: pieces[0].id },
  };
}

function spatialPanelFixture(
  fixtureId: string,
  panelCount: 2 | 3 | 4,
  closed: boolean,
): GarmentDraft {
  const pieces = Array.from({ length: panelCount }, (_, index) =>
    rectanglePiece(`spatial-panel-${index + 1}`, 120, 240));
  const connectionCount = closed ? panelCount : panelCount - 1;
  const seams: Seam[] = Array.from({ length: connectionCount }, (_, index) => {
    const first = pieces[index];
    const second = pieces[(index + 1) % panelCount];
    return {
      id: `${fixtureId}:join-${index + 1}`,
      groupId: `${fixtureId}:join-${index + 1}`,
      name: `União espacial ${index + 1}`,
      first: { pieceId: first.id, edgeId: getPatternEdges(first)[1].id, startT: 0, endT: 1 },
      second: { pieceId: second.id, edgeId: getPatternEdges(second)[3].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    };
  });
  const garment = garmentFixture(fixtureId, pieces, seams);
  return {
    ...garment,
    dressing: { region: "upper", frontReferencePieceId: pieces[0].id },
  };
}

function spatialNotchedTubeFixture(fixtureId: string): GarmentDraft {
  const pieces = Array.from({ length: 4 }, (_, index) => withSegmentRoles(
    migrateLegacyPieceToSegments({
      id: `spatial-notch-${index + 1}`,
      name: `Painel recortado ${index + 1}`,
      seamAllowanceMm: 10,
      cutQuantity: 1,
      points: [
        point(`spatial-notch-${index + 1}:a`, 0, 35),
        point(`spatial-notch-${index + 1}:b`, 40, 0),
        point(`spatial-notch-${index + 1}:c`, 80, 0),
        point(`spatial-notch-${index + 1}:d`, 120, 35),
        point(`spatial-notch-${index + 1}:e`, 120, 240),
        point(`spatial-notch-${index + 1}:f`, 0, 240),
      ],
    }),
    ["dartLeg", "waist", "dartLeg", "sideSeam", "hem", "sideSeam"],
  ));
  const seams: Seam[] = pieces.map((piece, index) => {
    const next = pieces[(index + 1) % pieces.length];
    return {
      id: `${fixtureId}:side-${index + 1}`,
      groupId: `${fixtureId}:side-${index + 1}`,
      name: `Lateral ${index + 1}`,
      first: { pieceId: piece.id, edgeId: getPatternEdges(piece)[3].id, startT: 0, endT: 1 },
      second: { pieceId: next.id, edgeId: getPatternEdges(next)[5].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    };
  });
  const garment = garmentFixture(fixtureId, pieces, seams);
  return {
    ...garment,
    dressing: { region: "upper", frontReferencePieceId: pieces[0].id },
  };
}

function spatialNotchedTubeWaistbandFixture(fixtureId: string): GarmentDraft {
  const body = spatialNotchedTubeFixture(fixtureId);
  const bodyPieces = body.pieces;
  const localClosure: Seam = {
    id: `${fixtureId}:local-closure`,
    groupId: `${fixtureId}:local-closure`,
    name: "Fechamento diagonal local",
    first: { pieceId: bodyPieces[0].id, edgeId: getPatternEdges(bodyPieces[0])[2].id, startT: 0, endT: 1 },
    second: { pieceId: bodyPieces[1].id, edgeId: getPatternEdges(bodyPieces[1])[0].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  const topRanges = bodyPieces.flatMap((piece) => getPatternEdges(piece).slice(0, 3).map((edge) => ({
    pieceId: piece.id,
    edgeId: edge.id,
    startT: 0,
    endT: 1,
  })));
  const topLengthMm = bodyPieces.reduce((total, piece) => total
    + getPatternEdges(piece).slice(0, 3).reduce((pieceTotal, edge) => pieceTotal
      + Math.hypot(
        piece.points.find((point) => point.id === edge.endPointId)!.xMm
          - piece.points.find((point) => point.id === edge.startPointId)!.xMm,
        piece.points.find((point) => point.id === edge.endPointId)!.yMm
          - piece.points.find((point) => point.id === edge.startPointId)!.yMm,
      ), 0), 0);
  const waistband = rectanglePiece(
    "spatial-upper-band",
    topLengthMm,
    35,
    ["waist", "sideSeam", "hem", "sideSeam"],
  );
  const waistbandEdges = getPatternEdges(waistband);
  const waistbandSelfSeam: Seam = {
    id: `${fixtureId}:upper-band-loop`,
    groupId: `${fixtureId}:upper-band-loop`,
    name: "Fechamento da faixa superior",
    first: { pieceId: waistband.id, edgeId: waistbandEdges[1].id, startT: 0, endT: 1 },
    second: { pieceId: waistband.id, edgeId: waistbandEdges[3].id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  const compositeTopSeam: Seam = {
    id: `${fixtureId}:composite-top`,
    groupId: `${fixtureId}:composite-top`,
    name: "União superior composta",
    first: { pieceId: waistband.id, edgeId: waistbandEdges[2].id, startT: 0, endT: 1 },
    second: topRanges[0],
    secondRanges: topRanges,
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  };
  const garment = garmentFixture(
    fixtureId,
    [...bodyPieces, waistband],
    [...(body.seams ?? []), localClosure, waistbandSelfSeam, compositeTopSeam],
  );
  return {
    ...garment,
    dressing: { region: "upper", frontReferencePieceId: bodyPieces[0].id },
  };
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
