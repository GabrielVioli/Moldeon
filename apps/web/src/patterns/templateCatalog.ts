import type {
  BodyMeasurements,
  BodyType,
  GarmentDraft,
  PatternPiece,
  PatternPoint,
  PatternPreviewPlacement,
  SegmentRole,
} from "../domain/pattern";
import { migrateLegacyPieceToSegments } from "../domain/pattern";
import { createDefaultFabricSource } from "../domain/fabric";
import { inferAssemblyPlacement } from "../domain/assembly";
import { closeDart, createDart } from "../domain/patternOperations";
import { createInitialConstructionGraph } from "../domain/constructionGraph";
import {
  BODY_MEASUREMENT_CATALOG,
  createMeasurementProfile,
  measurementProfileSnapshot,
  measurementProfileToBodyMeasurements,
  type MeasurementProfile,
} from "../domain/parametricMeasurements";
import {
  BASE_PATTERN_METADATA,
  draftBasePattern,
  isBasePatternTemplateId,
  type PatternValidationStatus,
} from "./basePatternDrafting";
import {
  draftTrouserPattern,
  TROUSER_PATTERN_METADATA,
} from "./trouserPatternDrafting";

export type PatternTemplateId =
  | "bodice-block"
  | "tshirt"
  | "blouse"
  | "straight-skirt"
  | "mini-skirt"
  | "straight-pants"
  | "basic-jacket";

export interface PatternTemplateSummary {
  id: PatternTemplateId;
  name: string;
  category: "Parte de cima" | "Parte de baixo" | "Casaco";
  description: string;
  pieces: string;
  status: "available" | "development";
  validationStatus: PatternValidationStatus;
  reviewNotes: string[];
  requiredMeasurements: string[];
  estimatedMeasurements: string[];
  formulaVersion: string;
  instanceExpansion?: string[];
}

export const DEFAULT_BODY_MEASUREMENTS: BodyMeasurements = {
  heightMm: 1680,
  bustMm: 920,
  waistMm: 760,
  hipMm: 1000,
  shoulderWidthMm: 400,
  torsoLengthMm: 440,
  armLengthMm: 590,
  inseamMm: 780,
};

export const TEMPLATE_FORMULA_VERSIONS: Record<PatternTemplateId, string> = {
  "bodice-block": BASE_PATTERN_METADATA["bodice-block"].templateVersion,
  tshirt: BASE_PATTERN_METADATA.tshirt.templateVersion,
  blouse: BASE_PATTERN_METADATA.blouse.templateVersion,
  "straight-skirt": BASE_PATTERN_METADATA["straight-skirt"].templateVersion,
  "mini-skirt": BASE_PATTERN_METADATA["mini-skirt"].templateVersion,
  "straight-pants": TROUSER_PATTERN_METADATA.templateVersion,
  "basic-jacket": "basic-jacket@1",
};

export const DEFAULT_MASCULINE_BODY_MEASUREMENTS: BodyMeasurements = {
  heightMm: 1780,
  bustMm: 1000,
  waistMm: 850,
  hipMm: 980,
  shoulderWidthMm: 460,
  torsoLengthMm: 475,
  armLengthMm: 630,
  inseamMm: 830,
};

export const PATTERN_TEMPLATES: readonly PatternTemplateSummary[] = [
  {
    id: "bodice-block",
    name: "Corpo básico",
    category: "Parte de cima",
    description: "Bloco de referência com frente e costas distintas.",
    pieces: "Frente e costas",
    status: "available",
    validationStatus: BASE_PATTERN_METADATA["bodice-block"].validationStatus,
    reviewNotes: BASE_PATTERN_METADATA["bodice-block"].notes,
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["bodice-block"],
    requiredMeasurements: ["busto", "cintura", "quadril", "ombro", "cava", "frente e costas"],
    estimatedMeasurements: ["pescoço", "inclinação do ombro", "altura do quadril"],
  },
  {
    id: "tshirt",
    name: "Camiseta básica",
    category: "Parte de cima",
    description: "Corpo com folga confortável e manga curta.",
    pieces: "Frente, costas e manga",
    status: "available",
    validationStatus: BASE_PATTERN_METADATA["tshirt"].validationStatus,
    reviewNotes: BASE_PATTERN_METADATA["tshirt"].notes,
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["tshirt"],
    requiredMeasurements: ["busto", "cintura", "quadril", "ombros", "comprimento do tronco"],
    estimatedMeasurements: ["pescoço", "inclinação do ombro", "profundidade da cava", "bíceps"],
  },
  {
    id: "blouse",
    name: "Blusa básica",
    category: "Parte de cima",
    description: "Base solta, decote mais aberto e manga longa.",
    pieces: "Frente, costas e manga",
    status: "available",
    validationStatus: BASE_PATTERN_METADATA["blouse"].validationStatus,
    reviewNotes: BASE_PATTERN_METADATA["blouse"].notes,
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["blouse"],
    requiredMeasurements: ["busto", "cintura", "quadril", "ombros", "comprimento do tronco", "braço"],
    estimatedMeasurements: ["pescoço", "inclinação do ombro", "profundidade da cava", "bíceps", "punho"],
  },
  {
    id: "straight-skirt",
    name: "Saia reta",
    category: "Parte de baixo",
    description: "Base simples da cintura ao joelho.",
    pieces: "Frente e costas",
    status: "available",
    validationStatus: BASE_PATTERN_METADATA["straight-skirt"].validationStatus,
    reviewNotes: BASE_PATTERN_METADATA["straight-skirt"].notes,
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["straight-skirt"],
    requiredMeasurements: ["cintura", "quadril", "altura"],
    estimatedMeasurements: ["altura do quadril", "comprimento da saia"],
  },
  {
    id: "mini-skirt",
    name: "Minissaia",
    category: "Parte de baixo",
    description: "Base curta com leve abertura na barra.",
    pieces: "Frente e costas",
    status: "available",
    validationStatus: BASE_PATTERN_METADATA["mini-skirt"].validationStatus,
    reviewNotes: BASE_PATTERN_METADATA["mini-skirt"].notes,
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["mini-skirt"],
    requiredMeasurements: ["cintura", "quadril", "altura"],
    estimatedMeasurements: ["altura do quadril", "comprimento da saia"],
  },
  {
    id: "straight-pants",
    name: "Calça reta",
    category: "Parte de baixo",
    description: "Base paramétrica com frente, costas e ganchos construídos separadamente.",
    pieces: "2 definições editáveis · 4 instâncias físicas",
    status: "available",
    validationStatus: TROUSER_PATTERN_METADATA.validationStatus,
    reviewNotes: TROUSER_PATTERN_METADATA.notes,
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["straight-pants"],
    requiredMeasurements: ["cintura", "quadril", "gancho sentado", "coxa", "joelho", "entrepernas"],
    estimatedMeasurements: ["profundidade do gancho", "assento", "queda de cintura", "tornozelo"],
    instanceExpansion: [
      "Frente · cortar 2x → frente esquerda e frente direita",
      "Costas · cortar 2x → costas esquerda e costas direita",
    ],
  },
  {
    id: "basic-jacket",
    name: "Jaqueta básica",
    category: "Casaco",
    description: "Modelagem própria de casaco ainda em validação.",
    pieces: "Em desenvolvimento",
    status: "development",
    validationStatus: "experimental",
    reviewNotes: ["Indisponível até possuir bloco próprio e revisão manual."],
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["basic-jacket"],
    requiredMeasurements: ["busto", "cintura", "quadril", "ombros", "braço"],
    estimatedMeasurements: ["pescoço", "cava", "folga estrutural"],
  },
] as const;

export function createGarmentFromTemplate(
  templateId: PatternTemplateId,
  inputMeasurements: BodyMeasurements,
  bodyType: BodyType = "feminine",
  inputProfile?: MeasurementProfile,
): GarmentDraft {
  const profile = createMeasurementProfile(inputMeasurements, bodyType, inputProfile);
  const measurements = validateMeasurements(measurementProfileToBodyMeasurements(profile));
  const generator = GENERATORS[templateId];
  const summary = PATTERN_TEMPLATES.find((template) => template.id === templateId);
  if (!summary) throw new RangeError("Molde-base desconhecido.");
  if (summary.status !== "available") throw new RangeError(`${summary.name} está em desenvolvimento.`);

  const parametricDraft = isBasePatternTemplateId(templateId)
    ? draftBasePattern(templateId, measurements)
    : templateId === "straight-pants"
      ? draftTrouserPattern(measurements)
      : undefined;
  const fabric = createDefaultFabricSource();
  const pieces = (parametricDraft?.pieces ?? generator(measurements)).map((piece) => ({
    ...piece,
    fabricId: fabric.id,
  }));
  const snapshot = measurementProfileSnapshot(profile);
  const templateVersion = TEMPLATE_FORMULA_VERSIONS[templateId];
  return {
    id: `${templateId}-${Date.now().toString(36)}`,
    templateId,
    name: summary.name,
    description: summary.description,
    bodyType,
    measurements: { ...measurements },
    measurementProfile: profile,
    parametric: {
      schemaVersion: 1,
      templateId,
      templateVersion,
      variables: parametricDraft?.variables ?? [],
      constructionGraph: parametricDraft?.constructionGraph
        ?? createInitialConstructionGraph(BODY_MEASUREMENT_CATALOG.map((entry) => entry.key)),
      generations: pieces.map((piece) => ({
        patternId: piece.id,
        templateId,
        templateVersion,
        engineVersion: 1,
        measurementSetId: "measurements-primary",
        formulaSetVersion: profile.formulaSetVersion,
        measurementValues: snapshot.values,
        measurementOrigins: snapshot.origins,
        defaultValues: snapshot.defaults,
        ...(parametricDraft ? {
          constructionSystem: parametricDraft.metadata.constructionSystem,
          validationStatus: parametricDraft.metadata.validationStatus,
          componentValidation: parametricDraft.metadata.componentStatus,
          requiredMeasurements: parametricDraft.metadata.requiredMeasurements,
          estimatedMeasurements: parametricDraft.metadata.estimatedMeasurements,
          ease: parametricDraft.metadata.ease,
          limits: parametricDraft.metadata.limits,
          manualReview: parametricDraft.metadata.manualReview,
        } : {}),
      })),
    },
    fabrics: [fabric],
    pieces,
    assemblyPlacements: pieces.map((piece, index) => ({ ...inferAssemblyPlacement(piece, index), source: "template" })),
    ease: parametricDraft?.ease ?? { bustMm: 80, waistMm: 60, hipMm: 80, sleeveMm: 50 },
  };
}

type TemplateGenerator = (measurements: BodyMeasurements) => PatternPiece[];

const GENERATORS: Record<PatternTemplateId, TemplateGenerator> = {
  "bodice-block": (measurements) => draftBasePattern("bodice-block", measurements).pieces,
  tshirt: (measurements) =>
    createTopPieces(measurements, {
      id: "tshirt",
      bodyEaseMm: 120,
      bodyLengthRatio: 0.38,
      necklineDepthMm: 85,
      sleeveLengthRatio: 0.14,
      sleeveEaseMm: 70,
    }),
  blouse: (measurements) =>
    createTopPieces(measurements, {
      id: "blouse",
      bodyEaseMm: 180,
      bodyLengthRatio: 0.42,
      necklineDepthMm: 115,
      sleeveLengthRatio: 0.34,
      sleeveEaseMm: 110,
    }),
  "straight-skirt": (measurements) =>
    createSkirtPieces(measurements, {
      id: "straight-skirt",
      lengthMm: measurements.heightMm * 0.36,
      hemFactor: 0.98,
    }),
  "mini-skirt": (measurements) =>
    createSkirtPieces(measurements, {
      id: "mini-skirt",
      lengthMm: measurements.heightMm * 0.245,
      hemFactor: 1.06,
    }),
  "straight-pants": (measurements) => draftTrouserPattern(measurements).pieces,
  "basic-jacket": createJacketPieces,
};

interface TopOptions {
  id: string;
  bodyEaseMm: number;
  bodyLengthRatio: number;
  necklineDepthMm: number;
  sleeveLengthRatio: number;
  sleeveEaseMm: number;
}

function createTopPieces(
  measurements: BodyMeasurements,
  options: TopOptions,
): PatternPiece[] {
  const bodyLength = measurements.heightMm * options.bodyLengthRatio;
  const bodyWidth = (measurements.bustMm + options.bodyEaseMm) / 4;
  const hemWidth = Math.max(
    bodyWidth * 0.96,
    (measurements.hipMm + options.bodyEaseMm) / 4,
  );
  const armholeDepth = Math.max(185, measurements.bustMm / 5 + 25);
  const neckWidth = Math.min(88, measurements.bustMm * 0.085);
  const shoulderEnd = Math.min(bodyWidth * 0.72, measurements.bustMm * 0.19);

  const front = createBodicePiece({
    id: `${options.id}-front`,
    name: "Frente",
    bodyWidth,
    hemWidth,
    bodyLength,
    armholeDepth,
    neckWidth,
    neckDepth: options.necklineDepthMm,
    shoulderEnd,
    placement: placement("torso", "front", "center"),
  });
  const back = createBodicePiece({
    id: `${options.id}-back`,
    name: "Costas",
    bodyWidth,
    hemWidth,
    bodyLength,
    armholeDepth,
    neckWidth,
    neckDepth: Math.max(24, options.necklineDepthMm * 0.28),
    shoulderEnd,
    placement: placement("torso", "back", "center"),
  });

  const sleeveLength = measurements.heightMm * options.sleeveLengthRatio;
  const sleeveWidth = Math.max(
    290,
    measurements.bustMm * 0.31 + options.sleeveEaseMm,
  );
  const sleeve = createSleevePiece({
    id: `${options.id}-sleeve`,
    length: sleeveLength,
    width: sleeveWidth,
    capHeight: Math.min(155, armholeDepth * 0.65),
  });
  return [front, back, sleeve];
}

interface BodicePieceOptions {
  id: string;
  name: string;
  bodyWidth: number;
  hemWidth: number;
  bodyLength: number;
  armholeDepth: number;
  neckWidth: number;
  neckDepth: number;
  shoulderEnd: number;
  placement: PatternPreviewPlacement;
}

function createBodicePiece(options: BodicePieceOptions): PatternPiece {
  const {
    id,
    name,
    bodyWidth,
    hemWidth,
    bodyLength,
    armholeDepth,
    neckWidth,
    neckDepth,
    shoulderEnd,
    placement: previewPlacement,
  } = options;
  const shoulderDrop = 22;
  return piece(
    id,
    name,
    [
      point("center-neck", 0, neckDepth, {
        out: { xMm: neckWidth * 0.42, yMm: -neckDepth * 0.04 },
      }),
      point("neck-shoulder", neckWidth, 0, {
        in: { xMm: -neckWidth * 0.16, yMm: neckDepth * 0.58 },
      }),
      point("shoulder", shoulderEnd, shoulderDrop, {
        out: {
          xMm: Math.max(20, (bodyWidth - shoulderEnd) * 0.7),
          yMm: 20,
        },
      }),
      point("underarm", bodyWidth, armholeDepth, {
        in: { xMm: -32, yMm: -armholeDepth * 0.34 },
      }),
      point("side-hem", hemWidth, bodyLength),
      point("center-hem", 0, bodyLength),
    ],
    {
      cutQuantity: 1,
      cutOnFold: true,
      previewPlacements: [previewPlacement],
      segmentRoles: ["neckline", "shoulder", id.endsWith("front") ? "frontArmhole" : "backArmhole", "sideSeam", "hem", "fold"],
      grainline: { start: { xMm: bodyWidth * 0.42, yMm: armholeDepth + 25 }, end: { xMm: bodyWidth * 0.42, yMm: bodyLength - 35 } },
      annotations: [{ id: `${id}:fold-note`, label: "Cortar na dobra", xMm: 8, yMm: bodyLength * 0.58 }],
    },
  );
}

interface SleeveOptions {
  id: string;
  length: number;
  width: number;
  capHeight: number;
}

function createSleevePiece({
  id,
  length,
  width,
  capHeight,
}: SleeveOptions): PatternPiece {
  const half = width / 2;
  const cuffInset = Math.min(width * 0.18, 65);
  return piece(
    id,
    "Manga",
    [
      point("underarm-left", 0, capHeight, {
        out: { xMm: width * 0.14, yMm: -capHeight * 0.56 },
      }),
      point("cap", half, 0, {
        in: { xMm: -width * 0.16, yMm: 0 },
        out: { xMm: width * 0.16, yMm: 0 },
      }),
      point("underarm-right", width, capHeight, {
        in: { xMm: -width * 0.14, yMm: -capHeight * 0.56 },
      }),
      point("cuff-right", width - cuffInset, length),
      point("cuff-left", cuffInset, length),
    ],
    {
      cutQuantity: 2,
      previewPlacements: [
        placement("arm", "front", "left"),
        placement("arm", "front", "right", true),
      ],
      segmentRoles: ["sleeveCapFront", "sleeveCapBack", "sideSeam", "hem", "sideSeam"],
      grainline: { start: { xMm: half, yMm: capHeight + 25 }, end: { xMm: half, yMm: length - 25 } },
    },
  );
}

interface SkirtOptions {
  id: string;
  lengthMm: number;
  hemFactor: number;
}

function createSkirtPieces(
  measurements: BodyMeasurements,
  options: SkirtOptions,
): PatternPiece[] {
  const waistEase = 20;
  const hipEase = 45;
  const waistWidth = (measurements.waistMm + waistEase) / 4;
  const hipWidth = (measurements.hipMm + hipEase) / 4;
  const hipDepth = Math.min(220, Math.max(170, measurements.heightMm * 0.115));
  const hemWidth = hipWidth * options.hemFactor;
  const createSide = (
    suffix: "front" | "back",
    surface: "front" | "back",
  ) => {
    const pieceId = `${options.id}-${suffix}`;
    const dartWidth = suffix === "front" ? 18 : 28;
    const dartLength = suffix === "front" ? Math.min(95, hipDepth * 0.52) : Math.min(130, hipDepth * 0.7);
    const waistCutWidth = waistWidth + dartWidth;
    const dartCenterX = waistCutWidth * (suffix === "front" ? 0.58 : 0.48);
    return piece(
      pieceId,
      suffix === "front" ? "Frente" : "Costas",
      [
        point("center-waist", 0, 0),
        point("side-waist", waistCutWidth, 0, {
          out: { xMm: (hipWidth - waistCutWidth) * 0.8, yMm: hipDepth * 0.3 },
        }),
        point("side-hip", hipWidth, hipDepth, {
          in: { xMm: -4, yMm: -hipDepth * 0.38 },
        }),
        point("side-hem", hemWidth, options.lengthMm),
        point("center-hem", 0, options.lengthMm),
      ],
      {
        cutQuantity: 1,
        cutOnFold: true,
        previewPlacements: [placement("hip", surface, "center")],
        segmentRoles: ["waist", "sideSeam", "sideSeam", "hem", "fold"],
        darts: [closeDart(createDart(pieceId, { xMm: dartCenterX, yMm: 0 }, { xMm: dartCenterX, yMm: dartLength }, dartWidth))],
        internalLines: [{ id: `${pieceId}:hip-line`, pieceId, curved: false, purpose: "reference", points: [point("hip-a", 0, hipDepth), point("hip-b", hipWidth, hipDepth)] }],
        grainline: { start: { xMm: hipWidth * 0.5, yMm: hipDepth + 30 }, end: { xMm: hipWidth * 0.5, yMm: options.lengthMm - 35 } },
        annotations: [{ id: `${pieceId}:hip-label`, label: "Linha do quadril", xMm: 12, yMm: hipDepth - 6 }],
      },
    );
  };

  return [createSide("front", "front"), createSide("back", "back")];
}

function createJacketPieces(measurements: BodyMeasurements): PatternPiece[] {
  const ease = 210;
  const bodyLength = measurements.heightMm * 0.39;
  const bodyWidth = (measurements.bustMm + ease) / 4;
  const hemWidth = Math.max(bodyWidth, (measurements.hipMm + ease) / 4);
  const armholeDepth = Math.max(205, measurements.bustMm / 5 + 45);
  const neckWidth = Math.min(95, measurements.bustMm * 0.09);
  const shoulderEnd = Math.min(bodyWidth * 0.72, measurements.bustMm * 0.2);

  const front = createBodicePiece({
    id: "basic-jacket-front",
    name: "Frente",
    bodyWidth,
    hemWidth,
    bodyLength,
    armholeDepth,
    neckWidth,
    neckDepth: 105,
    shoulderEnd,
    placement: placement("torso", "front", "left"),
  });
  front.cutOnFold = false;
  front.cutQuantity = 2;
  front.previewPlacements = [
    placement("torso", "front", "left"),
    placement("torso", "front", "right", true),
  ];

  const back = createBodicePiece({
    id: "basic-jacket-back",
    name: "Costas",
    bodyWidth,
    hemWidth,
    bodyLength,
    armholeDepth,
    neckWidth,
    neckDepth: 30,
    shoulderEnd,
    placement: placement("torso", "back", "center"),
  });
  const sleeve = createSleevePiece({
    id: "basic-jacket-sleeve",
    length: measurements.heightMm * 0.345,
    width: Math.max(340, measurements.bustMm * 0.34 + 100),
    capHeight: Math.min(165, armholeDepth * 0.68),
  });
  return [front, back, sleeve];
}

interface PointHandles {
  in?: { xMm: number; yMm: number };
  out?: { xMm: number; yMm: number };
}

function point(
  id: string,
  xMm: number,
  yMm: number,
  handles: PointHandles = {},
): PatternPoint {
  return {
    id,
    xMm: roundMm(xMm),
    yMm: roundMm(yMm),
    ...(handles.in
      ? {
          handleIn: {
            xMm: roundMm(handles.in.xMm),
            yMm: roundMm(handles.in.yMm),
          },
        }
      : {}),
    ...(handles.out
      ? {
          handleOut: {
            xMm: roundMm(handles.out.xMm),
            yMm: roundMm(handles.out.yMm),
          },
        }
      : {}),
  };
}

interface PieceOptions {
  cutQuantity: number;
  cutOnFold?: boolean;
  previewPlacements: PatternPreviewPlacement[];
  segmentRoles?: SegmentRole[];
  darts?: PatternPiece["darts"];
  internalLines?: PatternPiece["internalLines"];
  grainline?: PatternPiece["grainline"];
  annotations?: PatternPiece["annotations"];
}

function piece(
  id: string,
  name: string,
  points: PatternPoint[],
  options: PieceOptions,
): PatternPiece {
  const migrated = migrateLegacyPieceToSegments({
    id,
    name,
    seamAllowanceMm: 10,
    cutQuantity: options.cutQuantity,
    fabricId: "fabric-primary",
    ...(options.cutOnFold === undefined
      ? {}
      : { cutOnFold: options.cutOnFold }),
    previewPlacements: options.previewPlacements.map((placement) => ({
      ...placement,
      pieceId: id,
    })),
    points: points.map((current) => ({
      ...current,
      id: `${id}:${current.id}`,
    })),
    ...(options.darts ? { darts: options.darts.map((dart) => ({ ...dart, pieceId: id })) } : {}),
    ...(options.internalLines ? { internalLines: options.internalLines.map((line) => ({ ...line, pieceId: id })) } : {}),
    ...(options.grainline ? { grainline: options.grainline } : {}),
    ...(options.annotations ? { annotations: options.annotations } : {}),
  });
  if (options.segmentRoles) {
    migrated.segments = migrated.segments?.map((segment, index) => ({ ...segment, role: options.segmentRoles?.[index] ?? "other" }));
  }
  return migrated;
}

function placement(
  region: PatternPreviewPlacement["region"],
  surface: PatternPreviewPlacement["surface"],
  bodySide: PatternPreviewPlacement["bodySide"],
  mirrorX = false,
): PatternPreviewPlacement {
  return {
    id: `placement-${region}-${surface}-${bodySide}`,
    pieceId: "pending-piece",
    region,
    surface,
    bodySide,
    rotationDeg: 0,
    offsetXMm: 0,
    offsetYMm: 0,
    offsetZMm: 0,
    scale: 1,
    ...(mirrorX ? { mirrorX: true } : {}),
  };
}

function validateMeasurements(
  measurements: BodyMeasurements,
): BodyMeasurements {
  const ranges: Partial<Record<keyof BodyMeasurements, readonly [number, number]>> = {
    heightMm: [1300, 2100],
    bustMm: [600, 1600],
    waistMm: [500, 1500],
    hipMm: [650, 1700],
    shoulderWidthMm: [300, 650],
    torsoLengthMm: [320, 650],
    armLengthMm: [430, 850],
    inseamMm: [580, 1100],
    bicepMm: [180, 650],
    wristMm: [100, 350],
    thighMm: [300, 1000],
    calfMm: [200, 700],
  };
  for (const [key, value] of Object.entries(measurements) as [
    keyof BodyMeasurements,
    number,
  ][]) {
    const range = ranges[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`A medida ${key} precisa ser finita e não negativa.`);
    }
    if (range) {
      const [minimum, maximum] = range;
      if (value < minimum || value > maximum) {
        throw new RangeError(
          `A medida ${key} precisa ficar entre ${minimum} e ${maximum} mm.`,
        );
      }
    }
  }
  return { ...measurements };
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
