import {
  FormulaGraphEngine,
  formulaQuantity,
  parseFormula,
  type FormulaDefinition,
  type FormulaQuantity,
} from "../domain/formulaEngine";
import {
  closeDart,
  createDart,
} from "../domain/patternOperations";
import {
  migrateLegacyPieceToSegments,
  type BodyMeasurements,
  type GarmentEase,
  type PatternPiece,
  type PatternPoint,
  type PatternPreviewPlacement,
  type SegmentRole,
} from "../domain/pattern";
import type {
  BodyMeasurementKey,
  ParametricConstructionGraphRecord,
  ParametricVariableRecord,
} from "../domain/parametricMeasurements";

export type BasePatternTemplateId =
  | "bodice-block"
  | "tshirt"
  | "blouse"
  | "straight-skirt"
  | "mini-skirt";

export type PatternValidationStatus =
  | "experimental"
  | "geometrically-validated"
  | "manually-reviewed";

export interface BasePatternComponentStatus {
  body: PatternValidationStatus;
  sleeve?: PatternValidationStatus;
}

export interface BasePatternLimits {
  minimumAreaMm2: number;
  shoulderToleranceMm?: number;
  sideSeamToleranceMm: number;
  minimumCurveSeparationMm: number;
}

export interface BasePatternMetadata {
  templateId: BasePatternTemplateId;
  templateVersion: string;
  constructionSystem: string;
  validationStatus: PatternValidationStatus;
  componentStatus: BasePatternComponentStatus;
  requiredMeasurements: BodyMeasurementKey[];
  estimatedMeasurements: BodyMeasurementKey[];
  ease: GarmentEase;
  limits: BasePatternLimits;
  manualReview: boolean;
  notes: string[];
}

export interface BasePatternDraft {
  pieces: PatternPiece[];
  variables: ParametricVariableRecord[];
  constructionGraph: ParametricConstructionGraphRecord;
  ease: GarmentEase;
  metadata: BasePatternMetadata;
}

export interface BasePatternDraftOptions {
  /** Test and future style control. Zero removes skirt dart intake. */
  dartScale?: number;
}

interface UpperStyle {
  bustEaseMm: number;
  waistEaseMm: number;
  hipEaseMm: number;
  lowerExtensionMm: number;
  frontNeckDepthMm: number;
  backNeckDepthMm: number;
  hemFactor: number;
  sleeve: null | {
    lengthRatio: number;
    bicepEaseMm: number;
    cuffEaseMm: number;
    capHeightRatio: number;
  };
}

interface SkirtStyle {
  waistEaseMm: number;
  hipEaseMm: number;
  lengthRatio: number;
  minimumLengthMm: number;
  hemFactor: number;
  frontHipShare: number;
  frontWaistShare: number;
}

const UPPER_STYLE: Record<"bodice-block" | "tshirt" | "blouse", UpperStyle> = {
  "bodice-block": {
    bustEaseMm: 40,
    waistEaseMm: 20,
    hipEaseMm: 35,
    lowerExtensionMm: 110,
    frontNeckDepthMm: 72,
    backNeckDepthMm: 24,
    hemFactor: 1,
    sleeve: null,
  },
  tshirt: {
    bustEaseMm: 100,
    waistEaseMm: 120,
    hipEaseMm: 100,
    lowerExtensionMm: 225,
    frontNeckDepthMm: 88,
    backNeckDepthMm: 28,
    hemFactor: 1.01,
    sleeve: {
      lengthRatio: 0.28,
      bicepEaseMm: 55,
      cuffEaseMm: 80,
      capHeightRatio: 0.58,
    },
  },
  blouse: {
    bustEaseMm: 160,
    waistEaseMm: 180,
    hipEaseMm: 160,
    lowerExtensionMm: 285,
    frontNeckDepthMm: 118,
    backNeckDepthMm: 34,
    hemFactor: 1.04,
    sleeve: {
      lengthRatio: 0.98,
      bicepEaseMm: 95,
      cuffEaseMm: 55,
      capHeightRatio: 0.62,
    },
  },
};

const SKIRT_STYLE: Record<"straight-skirt" | "mini-skirt", SkirtStyle> = {
  "straight-skirt": {
    waistEaseMm: 20,
    hipEaseMm: 45,
    lengthRatio: 0.36,
    minimumLengthMm: 500,
    hemFactor: 0.98,
    frontHipShare: 0.49,
    frontWaistShare: 0.48,
  },
  "mini-skirt": {
    waistEaseMm: 20,
    hipEaseMm: 45,
    lengthRatio: 0.245,
    minimumLengthMm: 350,
    hemFactor: 1.06,
    frontHipShare: 0.49,
    frontWaistShare: 0.48,
  },
};

export const BASE_PATTERN_METADATA: Record<BasePatternTemplateId, BasePatternMetadata> = {
  "bodice-block": metadata("bodice-block", "bodice-block@2", {
    bustMm: 40,
    waistMm: 20,
    hipMm: 35,
    sleeveMm: 0,
  }, "geometrically-validated", { body: "geometrically-validated" }, [
    "Base de referência para transformações posteriores, não um molde final de produção.",
    "Revisão em toile e ajuste manual ainda não foram registrados.",
  ]),
  tshirt: metadata("tshirt", "tshirt@2", {
    bustMm: 100,
    waistMm: 120,
    hipMm: 100,
    sleeveMm: 55,
  }, "experimental", {
    body: "geometrically-validated",
    sleeve: "experimental",
  }, [
    "Corpo reconstruído a partir da base superior versionada.",
    "A manga preserva conectores e piques, mas permanece experimental até a etapa própria de mangas.",
  ]),
  blouse: metadata("blouse", "blouse@2", {
    bustMm: 160,
    waistMm: 180,
    hipMm: 160,
    sleeveMm: 95,
  }, "experimental", {
    body: "geometrically-validated",
    sleeve: "experimental",
  }, [
    "Regra estética de decote e comprimento é separada das fórmulas estruturais.",
    "A manga longa permanece experimental até comparação manual de cava e cabeça de manga.",
  ]),
  "straight-skirt": metadata("straight-skirt", "straight-skirt@2", {
    bustMm: 0,
    waistMm: 20,
    hipMm: 45,
    sleeveMm: 0,
  }, "geometrically-validated", { body: "geometrically-validated" }, [
    "Pences frontal e traseira participam da largura aberta da cintura.",
    "Abertura traseira futura está documentada, mas não é gerada nesta versão.",
  ]),
  "mini-skirt": metadata("mini-skirt", "mini-skirt@2", {
    bustMm: 0,
    waistMm: 20,
    hipMm: 45,
    sleeveMm: 0,
  }, "geometrically-validated", { body: "geometrically-validated" }, [
    "Comprimento e abertura de barra são regras estéticas versionadas.",
    "Revisão manual em toile ainda não foi registrada.",
  ]),
};

export function isBasePatternTemplateId(value: string): value is BasePatternTemplateId {
  return value in BASE_PATTERN_METADATA;
}

export function draftBasePattern(
  templateId: BasePatternTemplateId,
  measurements: BodyMeasurements,
  options: BasePatternDraftOptions = {},
): BasePatternDraft {
  if (templateId === "straight-skirt" || templateId === "mini-skirt") {
    return draftSkirt(templateId, measurements, options);
  }
  return draftUpper(templateId, measurements);
}

function draftUpper(
  templateId: "bodice-block" | "tshirt" | "blouse",
  measurements: BodyMeasurements,
): BasePatternDraft {
  const metadataValue = BASE_PATTERN_METADATA[templateId];
  const style = UPPER_STYLE[templateId];
  const definitions = upperDefinitions(style);
  const inputs = measurementInputs(measurements);
  const values = evaluateDefinitions(definitions, inputs);
  const pieces = [
    createUpperPiece(`${templateId}-front`, "Frente", "front", values),
    createUpperPiece(`${templateId}-back`, "Costas", "back", values),
  ];
  if (style.sleeve) {
    const sleeveDefinitions = createSleeveDefinitions(style.sleeve);
    const sleeveInputs = measurementInputs(measurements);
    const sleeveValues = evaluateDefinitions(sleeveDefinitions, sleeveInputs);
    pieces.push(createSleevePiece(`${templateId}-sleeve`, sleeveValues));
    definitions.push(...sleeveDefinitions);
  }
  return {
    pieces,
    variables: formulaVariables(definitions, metadataValue.templateVersion),
    constructionGraph: constructionGraph(definitions),
    ease: metadataValue.ease,
    metadata: metadataValue,
  };
}

function draftSkirt(
  templateId: "straight-skirt" | "mini-skirt",
  measurements: BodyMeasurements,
  options: BasePatternDraftOptions,
): BasePatternDraft {
  const metadataValue = BASE_PATTERN_METADATA[templateId];
  const style = SKIRT_STYLE[templateId];
  const definitions = skirtDefinitions(style, options.dartScale ?? 1);
  const inputs = measurementInputs(measurements);
  const values = evaluateDefinitions(definitions, inputs);
  return {
    pieces: [
      createSkirtPiece(`${templateId}-front`, "Frente", "front", values),
      createSkirtPiece(`${templateId}-back`, "Costas", "back", values),
    ],
    variables: formulaVariables(definitions, metadataValue.templateVersion),
    constructionGraph: constructionGraph(definitions),
    ease: metadataValue.ease,
    metadata: metadataValue,
  };
}

function upperDefinitions(style: UpperStyle): FormulaDefinition[] {
  return [
    formula("bustEaseMm", `${style.bustEaseMm}mm`, "mm"),
    formula("waistEaseMm", `${style.waistEaseMm}mm`, "mm"),
    formula("hipEaseMm", `${style.hipEaseMm}mm`, "mm"),
    formula("lowerExtensionMm", `${style.lowerExtensionMm}mm`, "mm"),
    formula("frontNeckDepthStyleMm", `${style.frontNeckDepthMm}mm`, "mm"),
    formula("backNeckDepthStyleMm", `${style.backNeckDepthMm}mm`, "mm"),
    formula("hemFactor", `${style.hemFactor}`, "ratio"),
    formula("frontShare", "clamp(frontWidthMm / (frontWidthMm + backWidthMm), 0.46, 0.54)", "ratio"),
    formula("frontWaistShare", "clamp(frontShare + 0.01, 0.47, 0.55)", "ratio"),
    formula("frontHipShare", "clamp(frontShare + 0.005, 0.47, 0.54)", "ratio"),
    formula("halfBustWithEase", "(bustMm + bustEaseMm) / 2", "mm"),
    formula("halfWaistWithEase", "(waistMm + waistEaseMm) / 2", "mm"),
    formula("halfHipWithEase", "(hipMm + hipEaseMm) / 2", "mm"),
    formula("frontBustWidth", "halfBustWithEase * frontShare", "mm"),
    formula("backBustWidth", "halfBustWithEase - frontBustWidth", "mm"),
    formula("frontWaistWidth", "halfWaistWithEase * frontWaistShare", "mm"),
    formula("backWaistWidth", "halfWaistWithEase - frontWaistWidth", "mm"),
    formula("frontHipWidth", "halfHipWithEase * frontHipShare", "mm"),
    formula("backHipWidth", "halfHipWithEase - frontHipWidth", "mm"),
    formula("shoulderRun", "min(shoulderLengthMm * cos(shoulderSlopeDeg), min(frontBustWidth, backBustWidth) - neckWidthMm - 22mm)", "mm"),
    formula("shoulderDrop", "max(8mm, shoulderLengthMm * sin(shoulderSlopeDeg))", "mm"),
    formula("frontShoulderX", "neckWidthMm + shoulderRun", "mm"),
    formula("backShoulderX", "neckWidthMm + shoulderRun", "mm"),
    formula("armholeY", "armholeDepthMm", "mm"),
    formula("frontArmholeNotchX", "frontBustWidth - max(12mm, frontBustWidth * 0.055)", "mm"),
    formula("backArmholeNotchX", "backBustWidth - max(12mm, backBustWidth * 0.045)", "mm"),
    formula("frontArmholeNotchY", "armholeY * 0.60", "mm"),
    formula("backArmholeNotchY", "armholeY * 0.52", "mm"),
    formula("sideWaistY", "(frontWaistLengthMm + backWaistLengthMm) / 2", "mm"),
    formula("frontCenterWaistY", "frontWaistLengthMm", "mm"),
    formula("backCenterWaistY", "backWaistLengthMm", "mm"),
    formula("hipY", "sideWaistY + hipHeightMm", "mm"),
    formula("hemY", "hipY + lowerExtensionMm", "mm"),
    formula("frontHemWidth", "frontHipWidth * hemFactor", "mm"),
    formula("backHemWidth", "backHipWidth * hemFactor", "mm"),
    formula("frontNeckDepth", "min(frontNeckDepthStyleMm, armholeY * 0.66)", "mm"),
    formula("backNeckDepth", "min(backNeckDepthStyleMm, armholeY * 0.28)", "mm"),
  ];
}

function createSleeveDefinitions(style: NonNullable<UpperStyle["sleeve"]>): FormulaDefinition[] {
  return [
    formula("sleeveLengthRatio", `${style.lengthRatio}`, "ratio"),
    formula("bicepEaseMm", `${style.bicepEaseMm}mm`, "mm"),
    formula("cuffEaseMm", `${style.cuffEaseMm}mm`, "mm"),
    formula("capHeightRatio", `${style.capHeightRatio}`, "ratio"),
    formula("sleeveWidth", "max(280mm, bicepMm + bicepEaseMm)", "mm"),
    formula("sleeveHalfWidth", "sleeveWidth / 2", "mm"),
    formula("sleeveLength", "max(160mm, armLengthMm * sleeveLengthRatio)", "mm"),
    formula("sleeveCapHeight", "clamp(armholeDepthMm * capHeightRatio, 105mm, 185mm)", "mm"),
    formula("sleeveCuffWidth", "min(sleeveWidth * 0.82, max(wristMm + cuffEaseMm, sleeveWidth * 0.45))", "mm"),
    formula("sleeveCuffInset", "(sleeveWidth - sleeveCuffWidth) / 2", "mm"),
  ];
}

function skirtDefinitions(style: SkirtStyle, dartScale: number): FormulaDefinition[] {
  return [
    formula("waistEaseMm", `${style.waistEaseMm}mm`, "mm"),
    formula("hipEaseMm", `${style.hipEaseMm}mm`, "mm"),
    formula("skirtLengthRatio", `${style.lengthRatio}`, "ratio"),
    formula("minimumSkirtLengthMm", `${style.minimumLengthMm}mm`, "mm"),
    formula("hemFactor", `${style.hemFactor}`, "ratio"),
    formula("frontHipShareRatio", `${style.frontHipShare}`, "ratio"),
    formula("frontWaistShareRatio", `${style.frontWaistShare}`, "ratio"),
    formula("dartScale", `${dartScale}`, "ratio"),
    formula("halfHipWithEase", "(hipMm + hipEaseMm) / 2", "mm"),
    formula("halfWaistWithEase", "(waistMm + waistEaseMm) / 2", "mm"),
    formula("frontHipWidth", "halfHipWithEase * frontHipShareRatio", "mm"),
    formula("backHipWidth", "halfHipWithEase - frontHipWidth", "mm"),
    formula("frontWaistWidth", "halfWaistWithEase * frontWaistShareRatio", "mm"),
    formula("backWaistWidth", "halfWaistWithEase - frontWaistWidth", "mm"),
    formula("frontSuppression", "max(0mm, frontHipWidth - frontWaistWidth)", "mm"),
    formula("backSuppression", "max(0mm, backHipWidth - backWaistWidth)", "mm"),
    formula("frontDartWidth", "min(30mm, frontSuppression * 0.34) * dartScale", "mm"),
    formula("backDartWidth", "min(40mm, backSuppression * 0.46) * dartScale", "mm"),
    formula("frontWaistCutWidth", "frontWaistWidth + frontDartWidth", "mm"),
    formula("backWaistCutWidth", "backWaistWidth + backDartWidth", "mm"),
    formula("hipY", "hipHeightMm", "mm"),
    formula("skirtLength", "max(minimumSkirtLengthMm, heightMm * skirtLengthRatio)", "mm"),
    formula("frontHemWidth", "frontHipWidth * hemFactor", "mm"),
    formula("backHemWidth", "backHipWidth * hemFactor", "mm"),
    formula("frontDartLength", "min(105mm, hipY * 0.54)", "mm"),
    formula("backDartLength", "min(145mm, hipY * 0.72)", "mm"),
    formula("frontDartX", "frontWaistCutWidth * 0.58", "mm"),
    formula("backDartX", "backWaistCutWidth * 0.46", "mm"),
    formula("centerFrontWaistY", "waistDropMm * 0.55", "mm"),
    formula("centerBackWaistY", "0mm", "mm"),
    formula("sideWaistY", "waistDropMm * 0.30", "mm"),
  ];
}

function createUpperPiece(
  id: string,
  name: string,
  surface: "front" | "back",
  values: Readonly<Record<string, number>>,
): PatternPiece {
  const isFront = surface === "front";
  const bustWidth = values[`${surface}BustWidth`];
  const waistWidth = values[`${surface}WaistWidth`];
  const hipWidth = values[`${surface}HipWidth`];
  const hemWidth = values[`${surface}HemWidth`];
  const shoulderX = values[`${surface}ShoulderX`];
  const notchX = values[`${surface}ArmholeNotchX`];
  const notchY = values[`${surface}ArmholeNotchY`];
  const centerWaistY = values[`${surface}CenterWaistY`];
  const neckDepth = values[`${surface}NeckDepth`];
  const armholeRole: SegmentRole = isFront ? "frontArmhole" : "backArmhole";
  const notchControl = isFront ? 0.34 : 0.27;
  const underarmControl = isFront ? 0.24 : 0.31;
  return piece(
    id,
    name,
    [
      point("center-neck", 0, neckDepth, {
        out: { xMm: values.neckWidthMm * 0.52, yMm: -neckDepth * 0.05 },
      }),
      point("neck-shoulder", values.neckWidthMm, 0, {
        in: { xMm: -values.neckWidthMm * 0.18, yMm: neckDepth * 0.66 },
      }),
      point("shoulder-tip", shoulderX, values.shoulderDrop, {
        out: {
          xMm: Math.max(18, (notchX - shoulderX) * notchControl),
          yMm: values.armholeY * (isFront ? 0.12 : 0.16),
        },
      }),
      point("armhole-notch", notchX, notchY, {
        in: {
          xMm: -Math.max(12, (notchX - shoulderX) * 0.24),
          yMm: -values.armholeY * (isFront ? 0.11 : 0.15),
        },
        out: {
          xMm: Math.max(8, (bustWidth - notchX) * 0.7),
          yMm: values.armholeY * underarmControl,
        },
      }),
      point("underarm", bustWidth, values.armholeY, {
        in: {
          xMm: -Math.max(16, (bustWidth - notchX) * 1.2),
          yMm: -values.armholeY * (isFront ? 0.16 : 0.20),
        },
      }),
      point("side-waist", waistWidth, values.sideWaistY, {
        in: { xMm: (bustWidth - waistWidth) * 0.34, yMm: -values.hipY * 0.12 },
        out: { xMm: (hipWidth - waistWidth) * 0.45, yMm: values.hipHeightMm * 0.28 },
      }),
      point("side-hip", hipWidth, values.hipY, {
        in: { xMm: -(hipWidth - waistWidth) * 0.25, yMm: -values.hipHeightMm * 0.30 },
      }),
      point("side-hem", hemWidth, values.hemY),
      point("center-hem", 0, values.hemY),
    ],
    {
      cutQuantity: 1,
      cutOnFold: true,
      previewPlacements: [placement("torso", surface, "center")],
      segmentRoles: [
        "neckline",
        "shoulder",
        armholeRole,
        armholeRole,
        "sideSeam",
        "sideSeam",
        "sideSeam",
        "hem",
        "fold",
      ],
      grainline: {
        start: { xMm: Math.min(bustWidth, hipWidth) * 0.38, yMm: values.armholeY + 28 },
        end: { xMm: Math.min(hemWidth, hipWidth) * 0.38, yMm: values.hemY - 35 },
      },
      internalLines: [
        referenceLine(`${id}:bust-line`, id, "Linha do busto", 0, values.armholeY, bustWidth, values.armholeY),
        referenceLine(`${id}:waist-line`, id, "Linha da cintura", 0, centerWaistY, waistWidth, values.sideWaistY),
        referenceLine(`${id}:hip-line`, id, "Linha do quadril", 0, values.hipY, hipWidth, values.hipY),
      ],
      annotations: [
        { id: `${id}:center`, label: isFront ? "Centro frente na dobra" : "Centro costas na dobra", xMm: 8, yMm: values.hemY * 0.62 },
        { id: `${id}:armhole-notch`, label: isFront ? "Pique frontal de cava" : "Piques traseiros de cava", xMm: notchX - 8, yMm: notchY - 8 },
        { id: `${id}:shoulder-balance`, label: "Marca de ombro", xMm: (values.neckWidthMm + shoulderX) / 2, yMm: values.shoulderDrop * 0.5 - 8 },
      ],
    },
  );
}

function createSleevePiece(
  id: string,
  values: Readonly<Record<string, number>>,
): PatternPiece {
  const width = values.sleeveWidth;
  const half = values.sleeveHalfWidth;
  const cap = values.sleeveCapHeight;
  const length = values.sleeveLength;
  const cuffInset = values.sleeveCuffInset;
  return piece(
    id,
    "Manga",
    [
      point("underarm-front", 0, cap, {
        out: { xMm: width * 0.14, yMm: -cap * 0.48 },
      }),
      point("front-notch", half * 0.72, cap * 0.34, {
        in: { xMm: -width * 0.10, yMm: cap * 0.10 },
        out: { xMm: width * 0.08, yMm: -cap * 0.22 },
      }),
      point("cap", half, 0, {
        in: { xMm: -width * 0.10, yMm: 0 },
        out: { xMm: width * 0.12, yMm: 0 },
      }),
      point("back-notch", half * 1.34, cap * 0.28, {
        in: { xMm: -width * 0.10, yMm: -cap * 0.14 },
        out: { xMm: width * 0.12, yMm: cap * 0.18 },
      }),
      point("underarm-back", width, cap, {
        in: { xMm: -width * 0.16, yMm: -cap * 0.52 },
      }),
      point("cuff-back", width - cuffInset, length),
      point("cuff-front", cuffInset, length),
    ],
    {
      cutQuantity: 2,
      previewPlacements: [
        placement("arm", "front", "left"),
        placement("arm", "front", "right", true),
      ],
      segmentRoles: [
        "sleeveCapFront",
        "sleeveCapFront",
        "sleeveCapBack",
        "sleeveCapBack",
        "sideSeam",
        "hem",
        "sideSeam",
      ],
      grainline: {
        start: { xMm: half, yMm: cap + 25 },
        end: { xMm: half, yMm: length - 25 },
      },
      internalLines: [
        referenceLine(`${id}:bicep-line`, id, "Linha do bíceps", 0, cap, width, cap),
      ],
      annotations: [
        { id: `${id}:front-notch`, label: "Pique frontal", xMm: half * 0.72, yMm: cap * 0.34 },
        { id: `${id}:back-notch`, label: "Dois piques traseiros", xMm: half * 1.34, yMm: cap * 0.28 },
        { id: `${id}:shoulder`, label: "Marca de ombro", xMm: half, yMm: 10 },
      ],
    },
  );
}

function createSkirtPiece(
  id: string,
  name: string,
  surface: "front" | "back",
  values: Readonly<Record<string, number>>,
): PatternPiece {
  const isFront = surface === "front";
  const hipWidth = values[`${surface}HipWidth`];
  const waistCutWidth = values[`${surface}WaistCutWidth`];
  const hemWidth = values[`${surface}HemWidth`];
  const dartWidth = values[`${surface}DartWidth`];
  const dartLength = values[`${surface}DartLength`];
  const dartX = values[`${surface}DartX`];
  const centerWaistY = values[isFront ? "centerFrontWaistY" : "centerBackWaistY"];
  const waistYAtDart = interpolateY(centerWaistY, values.sideWaistY, waistCutWidth === 0 ? 0 : dartX / waistCutWidth);
  const darts = dartWidth > 0.05
    ? [closeDart(createDart(id, { xMm: dartX, yMm: waistYAtDart }, { xMm: dartX, yMm: waistYAtDart + dartLength }, dartWidth))]
    : [];
  return piece(
    id,
    name,
    [
      point("center-waist", 0, centerWaistY),
      point("side-waist", waistCutWidth, values.sideWaistY, {
        out: { xMm: (hipWidth - waistCutWidth) * 0.72, yMm: values.hipY * 0.26 },
      }),
      point("side-hip", hipWidth, values.hipY, {
        in: { xMm: -Math.max(3, (hipWidth - waistCutWidth) * 0.24), yMm: -values.hipY * 0.38 },
      }),
      point("side-hem", hemWidth, values.skirtLength),
      point("center-hem", 0, values.skirtLength),
    ],
    {
      cutQuantity: 1,
      cutOnFold: true,
      previewPlacements: [placement("hip", surface, "center")],
      segmentRoles: ["waist", "sideSeam", "sideSeam", "hem", "fold"],
      darts,
      grainline: {
        start: { xMm: hipWidth * 0.46, yMm: values.hipY + 30 },
        end: { xMm: hemWidth * 0.46, yMm: values.skirtLength - 35 },
      },
      internalLines: [
        referenceLine(`${id}:hip-line`, id, "Linha do quadril", 0, values.hipY, hipWidth, values.hipY),
      ],
      annotations: [
        { id: `${id}:center`, label: isFront ? "Centro frente na dobra" : "Centro costas na dobra", xMm: 8, yMm: values.skirtLength * 0.58 },
        { id: `${id}:dart`, label: isFront ? "Pence frontal" : "Pence traseira", xMm: dartX + 6, yMm: waistYAtDart + dartLength * 0.55 },
        { id: `${id}:hip`, label: "Linha do quadril", xMm: 12, yMm: values.hipY - 7 },
      ],
    },
  );
}

function metadata(
  templateId: BasePatternTemplateId,
  templateVersion: string,
  ease: GarmentEase,
  validationStatus: PatternValidationStatus,
  componentStatus: BasePatternComponentStatus,
  notes: string[],
): BasePatternMetadata {
  const upper = templateId === "bodice-block" || templateId === "tshirt" || templateId === "blouse";
  return {
    templateId,
    templateVersion,
    constructionSystem: upper
      ? "Moldeon Reference Upper Block 2026"
      : "Moldeon Reference Skirt Block 2026",
    validationStatus,
    componentStatus,
    requiredMeasurements: upper
      ? [
          "bustMm",
          "waistMm",
          "hipMm",
          "neckWidthMm",
          "shoulderLengthMm",
          "shoulderSlopeDeg",
          "armholeDepthMm",
          "frontWidthMm",
          "backWidthMm",
          "frontWaistLengthMm",
          "backWaistLengthMm",
          "hipHeightMm",
        ]
      : ["heightMm", "waistMm", "hipMm", "hipHeightMm", "waistDropMm"],
    estimatedMeasurements: upper
      ? [
          "neckWidthMm",
          "shoulderLengthMm",
          "shoulderSlopeDeg",
          "armholeDepthMm",
          "frontWidthMm",
          "backWidthMm",
          "frontWaistLengthMm",
          "backWaistLengthMm",
          "hipHeightMm",
        ]
      : ["hipHeightMm", "waistDropMm"],
    ease,
    limits: {
      minimumAreaMm2: 4_000,
      ...(upper ? { shoulderToleranceMm: 0.8 } : {}),
      sideSeamToleranceMm: upper ? 8 : 6,
      minimumCurveSeparationMm: 0.5,
    },
    manualReview: false,
    notes,
  };
}

function formula(id: string, expression: string, unit: FormulaDefinition["unit"]): FormulaDefinition {
  return { id, expression, unit, formulaVersion: "formula-v1" };
}

function evaluateDefinitions(
  definitions: readonly FormulaDefinition[],
  inputs: Readonly<Record<string, FormulaQuantity>>,
): Record<string, number> {
  const evaluation = new FormulaGraphEngine(definitions, inputs).evaluateAll();
  if (Object.keys(evaluation.errors).length > 0) {
    const messages = Object.entries(evaluation.errors).map(([id, error]) => `${id}: ${error.message}`);
    throw new RangeError(`Não foi possível calcular o molde-base. ${messages.join(" ")}`);
  }
  return {
    ...Object.fromEntries(Object.entries(inputs).map(([id, quantity]) => [id, quantity.value])),
    ...Object.fromEntries(Object.entries(evaluation.values).map(([id, quantity]) => [id, roundMm(quantity.value)])),
  };
}

function measurementInputs(
  measurements: BodyMeasurements,
): Record<string, FormulaQuantity> {
  const resolved = measurements as unknown as Readonly<Record<string, number | undefined>>;
  const required = [
    "heightMm",
    "bustMm",
    "waistMm",
    "hipMm",
    "neckWidthMm",
    "shoulderLengthMm",
    "shoulderSlopeDeg",
    "armholeDepthMm",
    "frontWidthMm",
    "backWidthMm",
    "frontWaistLengthMm",
    "backWaistLengthMm",
    "hipHeightMm",
    "waistDropMm",
    "armLengthMm",
    "bicepMm",
    "wristMm",
  ] as const;
  const inputs: Record<string, FormulaQuantity> = {};
  for (const key of required) {
    const value = resolved[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(`A medida ${key} é necessária para esta construção.`);
    }
    inputs[key] = formulaQuantity(value, key.endsWith("Deg") ? "degree" : "mm");
  }
  return inputs;
}

function formulaVariables(
  definitions: readonly FormulaDefinition[],
  templateVersion: string,
): ParametricVariableRecord[] {
  const unique = new Map(definitions.map((definition) => [definition.id, definition]));
  return [...unique.values()].map((definition) => ({
    id: definition.id,
    name: definition.id,
    expression: definition.expression,
    unit: definition.unit,
    formulaVersion: `${templateVersion}:formula-v1`,
    dependencies: parseFormula(definition.expression).dependencies,
    description: formulaDescription(definition.id),
  }));
}

function constructionGraph(
  definitions: readonly FormulaDefinition[],
): ParametricConstructionGraphRecord {
  const unique = new Map(definitions.map((definition) => [definition.id, definition]));
  const measurementKeys = new Set<string>();
  for (const definition of unique.values()) {
    for (const dependency of parseFormula(definition.expression).dependencies) {
      if (!unique.has(dependency)) measurementKeys.add(dependency);
    }
  }
  return {
    version: 2,
    nodes: [
      ...[...measurementKeys].sort().map((measurementKey) => ({
        id: `measurement:${measurementKey}`,
        kind: "measurement" as const,
        dependencies: [],
        payload: { measurementKey },
      })),
      ...[...unique.values()].map((definition) => ({
        id: `variable:${definition.id}`,
        kind: "variable" as const,
        dependencies: parseFormula(definition.expression).dependencies.map((dependency) =>
          unique.has(dependency) ? `variable:${dependency}` : `measurement:${dependency}`,
        ),
        payload: {
          variableId: definition.id,
          expression: definition.expression,
          unit: definition.unit,
          formulaVersion: definition.formulaVersion ?? "formula-v1",
        },
      })),
    ],
  };
}

function formulaDescription(id: string): string {
  const descriptions: Record<string, string> = {
    frontShare: "Distribuição estrutural entre frente e costas a partir das larguras corporais.",
    shoulderRun: "Projeção horizontal do ombro medido com inclinação real.",
    shoulderDrop: "Queda vertical do ombro medida em graus.",
    frontArmholeNotchY: "Landmark frontal da cava.",
    backArmholeNotchY: "Landmark traseiro da cava.",
    frontDartWidth: "Parcela frontal da supressão de cintura absorvida pela pence.",
    backDartWidth: "Parcela traseira da supressão de cintura absorvida pela pence.",
    skirtLength: "Comprimento estético versionado com limite mínimo explícito.",
  };
  return descriptions[id] ?? "Variável versionada da construção geométrica.";
}

interface PointHandles {
  in?: { xMm: number; yMm: number };
  out?: { xMm: number; yMm: number };
}

function point(id: string, xMm: number, yMm: number, handles: PointHandles = {}): PatternPoint {
  return {
    id,
    xMm: roundMm(xMm),
    yMm: roundMm(yMm),
    ...(handles.in ? { handleIn: { xMm: roundMm(handles.in.xMm), yMm: roundMm(handles.in.yMm) } } : {}),
    ...(handles.out ? { handleOut: { xMm: roundMm(handles.out.xMm), yMm: roundMm(handles.out.yMm) } } : {}),
  };
}

interface PieceOptions {
  cutQuantity: number;
  cutOnFold?: boolean;
  previewPlacements: PatternPreviewPlacement[];
  segmentRoles: SegmentRole[];
  darts?: PatternPiece["darts"];
  internalLines?: PatternPiece["internalLines"];
  grainline: NonNullable<PatternPiece["grainline"]>;
  annotations: NonNullable<PatternPiece["annotations"]>;
}

function piece(id: string, name: string, points: PatternPoint[], options: PieceOptions): PatternPiece {
  const migrated = migrateLegacyPieceToSegments({
    id,
    name,
    seamAllowanceMm: 10,
    cutQuantity: options.cutQuantity,
    fabricId: "fabric-primary",
    ...(options.cutOnFold === undefined ? {} : { cutOnFold: options.cutOnFold }),
    previewPlacements: options.previewPlacements.map((current) => ({ ...current, pieceId: id })),
    points: points.map((current) => ({ ...current, id: `${id}:${current.id}` })),
    ...(options.darts ? { darts: options.darts.map((dart) => ({ ...dart, pieceId: id })) } : {}),
    ...(options.internalLines ? { internalLines: options.internalLines.map((line) => ({ ...line, pieceId: id })) } : {}),
    grainline: options.grainline,
    annotations: options.annotations,
  });
  migrated.segments = migrated.segments?.map((segment, index) => ({
    ...segment,
    role: options.segmentRoles[index] ?? "other",
  }));
  return migrated;
}

function referenceLine(
  id: string,
  pieceId: string,
  name: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): NonNullable<PatternPiece["internalLines"]>[number] {
  return {
    id,
    pieceId,
    name,
    nodes: [
      point("start", x1, y1),
      point("end", x2, y2),
    ],
    segments: [{ id: `${id}:segment`, startNodeId: "start", endNodeId: "end", kind: "line" }],
    purpose: "reference",
    visible: true,
    locked: true,
    metadata: { source: "template", label: name, version: 1 },
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
    offsetZMm: 0,
    scale: 1,
    ...(mirrorX ? { mirrorX: true } : {}),
  };
}

function interpolateY(start: number, end: number, t: number): number {
  return start + (end - start) * Math.max(0, Math.min(1, t));
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
