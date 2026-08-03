import type {
  BodyMeasurements,
  BodyType,
  GarmentDraft,
  PatternPiece,
  PatternPoint,
  PatternPreviewPlacement,
} from "../domain/pattern";
import { createDefaultFabricSource } from "../domain/fabric";

export type PatternTemplateId =
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
    id: "tshirt",
    name: "Camiseta básica",
    category: "Parte de cima",
    description: "Corpo com folga confortável e manga curta.",
    pieces: "Frente, costas e manga",
  },
  {
    id: "blouse",
    name: "Blusa básica",
    category: "Parte de cima",
    description: "Base solta, decote mais aberto e manga longa.",
    pieces: "Frente, costas e manga",
  },
  {
    id: "straight-skirt",
    name: "Saia reta",
    category: "Parte de baixo",
    description: "Base simples da cintura ao joelho.",
    pieces: "Frente e costas",
  },
  {
    id: "mini-skirt",
    name: "Minissaia",
    category: "Parte de baixo",
    description: "Base curta com leve abertura na barra.",
    pieces: "Frente e costas",
  },
  {
    id: "straight-pants",
    name: "Calça reta",
    category: "Parte de baixo",
    description: "Perna reta e gancho simplificado para edição.",
    pieces: "Frente e costas",
  },
  {
    id: "basic-jacket",
    name: "Jaqueta básica",
    category: "Casaco",
    description: "Base com abertura frontal, costas e manga longa.",
    pieces: "Frente, costas e manga",
  },
] as const;

export function createGarmentFromTemplate(
  templateId: PatternTemplateId,
  inputMeasurements: BodyMeasurements,
  bodyType: BodyType = "feminine",
): GarmentDraft {
  const measurements = validateMeasurements(inputMeasurements);
  const generator = GENERATORS[templateId];
  const summary = PATTERN_TEMPLATES.find((template) => template.id === templateId);
  if (!summary) throw new RangeError("Molde-base desconhecido.");

  const fabric = createDefaultFabricSource();
  const pieces = generator(measurements).map((piece) => ({
    ...piece,
    fabricId: fabric.id,
  }));
  return {
    id: `${templateId}-${Date.now().toString(36)}`,
    templateId,
    name: summary.name,
    description: summary.description,
    bodyType,
    measurements: { ...measurements },
    fabrics: [fabric],
    pieces,
  };
}

type TemplateGenerator = (measurements: BodyMeasurements) => PatternPiece[];

const GENERATORS: Record<PatternTemplateId, TemplateGenerator> = {
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
  "straight-pants": createPantsPieces,
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
  ) =>
    piece(
      `${options.id}-${suffix}`,
      suffix === "front" ? "Frente" : "Costas",
      [
        point("center-waist", 0, 0),
        point("side-waist", waistWidth, 0, {
          out: { xMm: (hipWidth - waistWidth) * 0.8, yMm: hipDepth * 0.3 },
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
      },
    );

  return [createSide("front", "front"), createSide("back", "back")];
}

function createPantsPieces(measurements: BodyMeasurements): PatternPiece[] {
  const hipQuarter = (measurements.hipMm + 55) / 4;
  const waistQuarter = (measurements.waistMm + 30) / 4;
  const length = measurements.heightMm * 0.59;
  const rise = Math.max(255, measurements.hipMm * 0.27);
  const frontCrotch = measurements.hipMm / 18;
  const backCrotch = measurements.hipMm / 9;
  const hemHalfWidth = Math.max(78, measurements.hipMm * 0.085);

  const front = createTrouserPiece({
    id: "straight-pants-front",
    name: "Frente",
    waistQuarter,
    hipQuarter,
    length,
    rise,
    crotchExtension: frontCrotch,
    hemHalfWidth,
    surface: "front",
  });
  const back = createTrouserPiece({
    id: "straight-pants-back",
    name: "Costas",
    waistQuarter: waistQuarter + 20,
    hipQuarter: hipQuarter + 18,
    length,
    rise: rise + 35,
    crotchExtension: backCrotch,
    hemHalfWidth: hemHalfWidth + 8,
    surface: "back",
  });
  return [front, back];
}

interface TrouserPieceOptions {
  id: string;
  name: string;
  waistQuarter: number;
  hipQuarter: number;
  length: number;
  rise: number;
  crotchExtension: number;
  hemHalfWidth: number;
  surface: "front" | "back";
}

function createTrouserPiece(options: TrouserPieceOptions): PatternPiece {
  const {
    id,
    name,
    waistQuarter,
    hipQuarter,
    length,
    rise,
    crotchExtension,
    hemHalfWidth,
    surface,
  } = options;
  const centerLine = crotchExtension + 78;
  const outerWaistX = centerLine + waistQuarter;
  const outerHipX = centerLine + hipQuarter;
  const legCenter = centerLine + hipQuarter * 0.48;
  return piece(
    id,
    name,
    [
      point("waist-center", centerLine, 0),
      point("waist-side", outerWaistX, 12),
      point("hip-side", outerHipX, rise * 0.62, {
        in: { xMm: -3, yMm: -rise * 0.22 },
      }),
      point("hem-outside", legCenter + hemHalfWidth, length),
      point("hem-inside", legCenter - hemHalfWidth, length),
      point("inseam-crotch", centerLine + 40, rise + 45, {
        out: { xMm: -48, yMm: -8 },
      }),
      point("crotch-tip", 0, rise, {
        in: { xMm: 24, yMm: 26 },
        out: { xMm: crotchExtension * 0.75, yMm: -rise * 0.42 },
      }),
    ],
    {
      cutQuantity: 2,
      previewPlacements: [
        placement("leg", surface, "left"),
        placement("leg", surface, "right", true),
      ],
    },
  );
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
}

function piece(
  id: string,
  name: string,
  points: PatternPoint[],
  options: PieceOptions,
): PatternPiece {
  return {
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
  };
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
    offsetZMm: 25,
    scale: 1,
    ...(mirrorX ? { mirrorX: true } : {}),
  };
}

function validateMeasurements(
  measurements: BodyMeasurements,
): BodyMeasurements {
  const ranges: Record<keyof BodyMeasurements, readonly [number, number]> = {
    heightMm: [1300, 2100],
    bustMm: [600, 1600],
    waistMm: [500, 1500],
    hipMm: [650, 1700],
    shoulderWidthMm: [300, 650],
    torsoLengthMm: [320, 650],
    armLengthMm: [430, 850],
    inseamMm: [580, 1100],
  };
  for (const [key, value] of Object.entries(measurements) as [
    keyof BodyMeasurements,
    number,
  ][]) {
    const [minimum, maximum] = ranges[key];
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new RangeError(
        `A medida ${key} precisa ficar entre ${minimum} e ${maximum} mm.`,
      );
    }
  }
  return { ...measurements };
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
