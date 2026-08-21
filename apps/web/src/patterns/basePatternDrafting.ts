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
  PatternMethodologyRecord,
} from "../domain/parametricMeasurements";
import {
  createDefaultSleeveSettings,
  draftGuidedSleeve,
  SLEEVE_SYSTEM_VERSION,
  type SleeveDraftSettings,
} from "../domain/sleeveSystem";
import {
  SKIRT_BLOCK_METHODOLOGY,
  UPPER_BLOCK_METHODOLOGY,
} from "./templateMethodology";

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
  methodology: PatternMethodologyRecord;
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
  bustEaseRatio: number;
  waistEaseRatio: number;
  hipEaseRatio: number;
  lengthBonusRatio: number;
  frontNeckDepthRatio: number;
  backNeckDepthRatio: number;
  hemFactor: number;
  sleeve: "short" | "long" | null;
}

interface SkirtStyle {
  waistEaseMm: number;
  hipEaseMm: number;
  lengthRatio: number;
  minimumLengthMm: number;
  hemFactor: number;
}

const UPPER_STYLE: Record<"bodice-block" | "tshirt" | "blouse", UpperStyle> = {
  "bodice-block": {
    bustEaseRatio: 0.04,
    waistEaseRatio: 0.02,
    hipEaseRatio: 0.035,
    lengthBonusRatio: 0.04,
    frontNeckDepthRatio: 0.17,
    backNeckDepthRatio: 0.045,
    hemFactor: 1,
    sleeve: null,
  },
  tshirt: {
    bustEaseRatio: 0.12,
    waistEaseRatio: 0.12,
    hipEaseRatio: 0.18,
    lengthBonusRatio: 0.03,
    frontNeckDepthRatio: 0.25,
    backNeckDepthRatio: 0.05,
    hemFactor: 1.01,
    sleeve: "short",
  },
  blouse: {
    bustEaseRatio: 0.18,
    waistEaseRatio: 0.18,
    hipEaseRatio: 0.18,
    lengthBonusRatio: 0.12,
    frontNeckDepthRatio: 0.30,
    backNeckDepthRatio: 0.055,
    hemFactor: 1.04,
    sleeve: "long",
  },
};

const SKIRT_STYLE: Record<"straight-skirt" | "mini-skirt", SkirtStyle> = {
  "straight-skirt": {
    waistEaseMm: 20,
    hipEaseMm: 45,
    lengthRatio: 0.36,
    minimumLengthMm: 500,
    hemFactor: 0.98,
  },
  "mini-skirt": {
    waistEaseMm: 20,
    hipEaseMm: 45,
    lengthRatio: 0.245,
    minimumLengthMm: 350,
    hemFactor: 1.06,
  },
};

export const BASE_PATTERN_METADATA: Record<BasePatternTemplateId, BasePatternMetadata> = {
  "bodice-block": metadata("bodice-block", "bodice-block@3", {
    bustMm: 40,
    waistMm: 20,
    hipMm: 35,
    sleeveMm: 0,
  }, "geometrically-validated", { body: "geometrically-validated" }, [
    "Base de referência para transformações posteriores, não um molde final de produção.",
    "Revisão em toile e ajuste manual ainda não foram registrados.",
  ]),
  tshirt: metadata("tshirt", "tshirt@4", {
    bustMm: 120,
    waistMm: 120,
    hipMm: 100,
    sleeveMm: 55,
  }, "geometrically-validated", {
    body: "geometrically-validated",
    sleeve: "geometrically-validated",
  }, [
    "Corpo reconstruído a partir da base superior versionada.",
    `Manga curta gerada por ${SLEEVE_SYSTEM_VERSION} a partir dos arcos reais das cavas.`,
    "Revisão em toile e ajuste manual ainda não foram registrados.",
  ]),
  blouse: metadata("blouse", "blouse@4", {
    bustMm: 180,
    waistMm: 180,
    hipMm: 160,
    sleeveMm: 95,
  }, "geometrically-validated", {
    body: "geometrically-validated",
    sleeve: "geometrically-validated",
  }, [
    "Regra estética de decote e comprimento é separada das fórmulas estruturais.",
    `Manga longa gerada por ${SLEEVE_SYSTEM_VERSION} a partir dos arcos reais das cavas.`,
    "Revisão em toile e ajuste manual ainda não foram registrados.",
  ]),
  "straight-skirt": metadata("straight-skirt", "straight-skirt@3", {
    bustMm: 0,
    waistMm: 20,
    hipMm: 45,
    sleeveMm: 0,
  }, "geometrically-validated", { body: "geometrically-validated" }, [
    "Pences frontal e traseira participam da largura aberta da cintura.",
    "Abertura traseira futura está documentada, mas não é gerada nesta versão.",
  ]),
  "mini-skirt": metadata("mini-skirt", "mini-skirt@3", {
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
    const settings = createDefaultSleeveSettings(
      { pieces, measurements, ease: metadataValue.ease },
      pieces[0].id,
      pieces[1].id,
      style.sleeve,
    );
    const guided = draftGuidedSleeve(
      { pieces, measurements, ease: metadataValue.ease, fabrics: [] },
      pieces[0].id,
      pieces[1].id,
      settings,
    );
    if (guided.compatibility.status === "error") {
      throw new RangeError(`A manga de ${templateId} não atingiu compatibilidade geométrica.`);
    }
    pieces.push(guided.sleevePiece);
    definitions.push(...guidedSleeveDefinitions(settings));
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
    formula("bustEaseRatio", `${style.bustEaseRatio}`, "ratio"),
    formula("waistEaseRatio", `${style.waistEaseRatio}`, "ratio"),
    formula("hipEaseRatio", `${style.hipEaseRatio}`, "ratio"),
    formula("lengthBonusRatio", `${style.lengthBonusRatio}`, "ratio"),
    formula("frontNeckDepthRatio", `${style.frontNeckDepthRatio}`, "ratio"),
    formula("backNeckDepthRatio", `${style.backNeckDepthRatio}`, "ratio"),
    formula("hemFactor", `${style.hemFactor}`, "ratio"),
    formula("quarterBustWithEase", "bustMm * (1 + bustEaseRatio) / 4", "mm"),
    formula("quarterWaistWithEase", "waistMm * (1 + waistEaseRatio) / 4", "mm"),
    formula("quarterHipWithEase", "hipMm * (1 + hipEaseRatio) / 4", "mm"),
    formula("frontBustWidth", "quarterBustWithEase", "mm"),
    formula("backBustWidth", "quarterBustWithEase", "mm"),
    formula("frontWaistWidth", "quarterWaistWithEase", "mm"),
    formula("backWaistWidth", "quarterWaistWithEase", "mm"),
    formula("frontHipWidth", "quarterHipWithEase", "mm"),
    formula("backHipWidth", "quarterHipWithEase", "mm"),
    formula("shoulderRun", "min(shoulderLengthMm * cos(shoulderSlopeDeg), min(frontBustWidth, backBustWidth) - neckWidthMm - 22mm)", "mm"),
    formula("shoulderDrop", "max(8mm, shoulderLengthMm * sin(shoulderSlopeDeg))", "mm"),
    formula("frontShoulderX", "neckWidthMm + shoulderRun", "mm"),
    formula("backShoulderX", "neckWidthMm + shoulderRun", "mm"),
    formula("armholeY", "armholeDepthMm", "mm"),
    formula("frontArmholePitchX", "min(frontShoulderX - 8mm, frontWidthMm * 0.50)", "mm"),
    formula("backArmholePitchX", "min(backShoulderX - 8mm, backWidthMm * 0.49)", "mm"),
    formula("frontArmholePitchY", "shoulderDrop + (armholeY - shoulderDrop) * 0.54 + bustMm * 0.002", "mm"),
    formula("backArmholePitchY", "shoulderDrop + (armholeY - shoulderDrop) * 0.50", "mm"),
    formula("frontArmholeHollowX", "frontArmholePitchX + (frontBustWidth - frontArmholePitchX) * 0.39", "mm"),
    formula("backArmholeHollowX", "backArmholePitchX + (backBustWidth - backArmholePitchX) * 0.47", "mm"),
    formula("frontArmholeHollowY", "armholeY - (armholeY - frontArmholePitchY) * 0.23", "mm"),
    formula("backArmholeHollowY", "armholeY - (armholeY - backArmholePitchY) * 0.28", "mm"),
    formula("sideWaistY", "(frontWaistLengthMm + backWaistLengthMm) / 2", "mm"),
    formula("frontCenterWaistY", "frontWaistLengthMm", "mm"),
    formula("backCenterWaistY", "backWaistLengthMm", "mm"),
    formula("hipY", "sideWaistY + hipHeightMm", "mm"),
    formula("hemY", "hipY * (1 + lengthBonusRatio)", "mm"),
    formula("frontHemWidth", "frontHipWidth * hemFactor", "mm"),
    formula("backHemWidth", "backHipWidth * hemFactor", "mm"),
    formula("frontNeckDepth", "min(backWaistLengthMm * frontNeckDepthRatio, armholeY * 0.66)", "mm"),
    formula("backNeckDepth", "min(neckWidthMm * backNeckDepthRatio * 5, armholeY * 0.20)", "mm"),
  ];
}

function guidedSleeveDefinitions(settings: SleeveDraftSettings): FormulaDefinition[] {
  return [
    formula("guidedSleeveLength", `${settings.lengthMm}mm`, "mm"),
    formula("guidedSleeveBicep", `${settings.bicepCircumferenceMm}mm`, "mm"),
    formula("guidedSleeveCuff", `${settings.cuffCircumferenceMm}mm`, "mm"),
    formula("guidedSleeveCapHeight", `${settings.capHeightMm}mm`, "mm"),
    formula("guidedSleeveCapEase", `${settings.capEaseMm}mm`, "mm"),
    formula("guidedSleeveRotation", `${settings.rotationDeg}deg`, "degree"),
  ];
}

function skirtDefinitions(style: SkirtStyle, dartScale: number): FormulaDefinition[] {
  return [
    formula("waistEaseMm", `${style.waistEaseMm}mm`, "mm"),
    formula("hipEaseMm", `${style.hipEaseMm}mm`, "mm"),
    formula("skirtLengthRatio", `${style.lengthRatio}`, "ratio"),
    formula("minimumSkirtLengthMm", `${style.minimumLengthMm}mm`, "mm"),
    formula("hemFactor", `${style.hemFactor}`, "ratio"),
    formula("dartScale", `${dartScale}`, "ratio"),
    formula("waistWithEase", "waistMm + waistEaseMm", "mm"),
    formula("hipWithEase", "hipMm + hipEaseMm", "mm"),
    formula("waistHipDifference", "max(0mm, hipWithEase - waistWithEase)", "mm"),
    formula("frontHipWidth", "hipFrontArcMm + hipEaseMm / 4", "mm"),
    formula("backHipWidth", "hipBackArcMm + hipEaseMm / 4", "mm"),
    formula("frontWaistWidth", "waistFrontArcMm + waistEaseMm / 4", "mm"),
    formula("backWaistWidth", "waistBackArcMm + waistEaseMm / 4", "mm"),
    formula("frontSuppression", "max(0mm, frontHipWidth - frontWaistWidth)", "mm"),
    formula("backSuppression", "max(0mm, backHipWidth - backWaistWidth)", "mm"),
    formula("frontDartMethodWidth", "waistWithEase * 0.006888 + (clamp(waistHipDifference, waistWithEase * 0.2, waistWithEase * 0.344) - waistWithEase * 0.2) / 4", "mm"),
    formula("backDartMethodWidth", "waistWithEase * 0.006888 + (waistHipDifference - waistWithEase * 0.114 - (waistHipDifference - waistWithEase * 0.114) / 5) / 4", "mm"),
    formula("frontDartWidth", "min(frontSuppression * 0.72, max(0mm, frontDartMethodWidth)) * dartScale", "mm"),
    formula("backDartWidth", "min(backSuppression * 0.78, max(0mm, backDartMethodWidth)) * dartScale", "mm"),
    formula("frontWaistCutWidth", "frontWaistWidth + frontDartWidth", "mm"),
    formula("backWaistCutWidth", "backWaistWidth + backDartWidth", "mm"),
    formula("hipY", "hipHeightMm", "mm"),
    formula("skirtLength", "max(minimumSkirtLengthMm, heightMm * skirtLengthRatio)", "mm"),
    formula("frontHemWidth", "frontHipWidth * hemFactor", "mm"),
    formula("backHemWidth", "backHipWidth * hemFactor", "mm"),
    formula("frontDartLength", "hipY * 0.45", "mm"),
    formula("backDartLength", "hipY * 0.50", "mm"),
    formula("frontDartX", "frontHipWidth / 2.4", "mm"),
    formula("backDartX", "backHipWidth / 2.4", "mm"),
    formula("centerFrontWaistY", "waistDropMm * 0.55", "mm"),
    formula("centerBackWaistY", "0mm", "mm"),
    formula("sideWaistY", "max(waistDropMm * 0.30, hipY * 0.0615)", "mm"),
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
  const pitchX = values[`${surface}ArmholePitchX`];
  const pitchY = values[`${surface}ArmholePitchY`];
  const hollowX = values[`${surface}ArmholeHollowX`];
  const hollowY = values[`${surface}ArmholeHollowY`];
  const centerWaistY = values[`${surface}CenterWaistY`];
  const neckDepth = values[`${surface}NeckDepth`];
  const armholeRole: SegmentRole = isFront ? "frontArmhole" : "backArmhole";
  const shoulderToPitchY = Math.max(24, pitchY - values.shoulderDrop);
  const pitchToHollowY = Math.max(18, hollowY - pitchY);
  const hollowToUnderarmX = Math.max(18, bustWidth - hollowX);
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
          xMm: -Math.max(3, (shoulderX - pitchX) * 0.16),
          yMm: shoulderToPitchY * 0.42,
        },
      }),
      point("armhole-pitch", pitchX, pitchY, {
        in: {
          xMm: Math.max(1, (shoulderX - pitchX) * 0.04),
          yMm: -shoulderToPitchY * 0.48,
        },
        out: {
          xMm: -Math.max(1, (shoulderX - pitchX) * 0.035),
          yMm: pitchToHollowY * 0.52,
        },
      }),
      point("armhole-hollow", hollowX, hollowY, {
        in: {
          xMm: -Math.max(12, (hollowX - pitchX) * 0.42),
          yMm: -Math.max(12, (values.armholeY - pitchY) * 0.19),
        },
        out: {
          xMm: Math.max(16, hollowToUnderarmX * 0.34),
          yMm: Math.max(16, (values.armholeY - pitchY) * 0.25),
        },
      }),
      point("underarm", bustWidth, values.armholeY, {
        in: {
          xMm: -hollowToUnderarmX * 0.46,
          yMm: 0,
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
        { id: `${id}:armhole-notch`, label: isFront ? "Pique frontal de cava" : "Piques traseiros de cava", xMm: pitchX - 8, yMm: pitchY - 8 },
        { id: `${id}:shoulder-balance`, label: "Marca de ombro", xMm: (values.neckWidthMm + shoulderX) / 2, yMm: values.shoulderDrop * 0.5 - 8 },
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
  const waistRun = Math.hypot(waistCutWidth, values.sideWaistY - centerWaistY);
  const waistTangent = waistRun > 1e-9
    ? { xMm: waistCutWidth / waistRun, yMm: (values.sideWaistY - centerWaistY) / waistRun }
    : { xMm: 1, yMm: 0 };
  const inwardNormal = { xMm: -waistTangent.yMm, yMm: waistTangent.xMm };
  const dartMouth = { xMm: dartX, yMm: waistYAtDart };
  const dartApex = {
    xMm: dartMouth.xMm + inwardNormal.xMm * dartLength,
    yMm: dartMouth.yMm + inwardNormal.yMm * dartLength,
  };
  const darts = dartWidth > 0.05
    ? [closeDart({
        ...createDart(
          id,
          dartMouth,
          dartApex,
          dartWidth,
        ),
        // Dart intake is measured along the authored waist edge. The generic
        // operation places legs perpendicular to the center line, which only
        // lies on the boundary for a horizontal waist. Skirt waists are
        // sloped, so keep both legs on that material edge explicitly.
        legA: {
          xMm: dartX - waistTangent.xMm * dartWidth * 0.5,
          yMm: waistYAtDart - waistTangent.yMm * dartWidth * 0.5,
        },
        legB: {
          xMm: dartX + waistTangent.xMm * dartWidth * 0.5,
          yMm: waistYAtDart + waistTangent.yMm * dartWidth * 0.5,
        },
      })]
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
    methodology: upper ? UPPER_BLOCK_METHODOLOGY : SKIRT_BLOCK_METHODOLOGY,
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
      : [
          "heightMm",
          "waistMm",
          "hipMm",
          "waistFrontArcMm",
          "waistBackArcMm",
          "hipFrontArcMm",
          "hipBackArcMm",
          "hipHeightMm",
          "waistDropMm",
        ],
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
      : [
          "waistFrontArcMm",
          "waistBackArcMm",
          "hipFrontArcMm",
          "hipBackArcMm",
          "hipHeightMm",
          "waistDropMm",
        ],
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
    "waistFrontArcMm",
    "waistBackArcMm",
    "hipFrontArcMm",
    "hipBackArcMm",
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
