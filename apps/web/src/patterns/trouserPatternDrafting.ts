import {
  FormulaGraphEngine,
  formulaQuantity,
  parseFormula,
  type FormulaDefinition,
  type FormulaQuantity,
} from "../domain/formulaEngine";
import { closeDart, createDart } from "../domain/patternOperations";
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
import type { PatternValidationStatus } from "./basePatternDrafting";
import { TROUSER_BLOCK_METHODOLOGY } from "./templateMethodology";

export interface TrouserPatternLimits {
  minimumAreaMm2: number;
  sideSeamToleranceMm: number;
  inseamToleranceMm: number;
  minimumCurveSeparationMm: number;
}

export interface TrouserPatternMetadata {
  templateId: "straight-pants";
  templateVersion: string;
  constructionSystem: string;
  methodology: PatternMethodologyRecord;
  validationStatus: PatternValidationStatus;
  componentStatus: { body: PatternValidationStatus };
  requiredMeasurements: BodyMeasurementKey[];
  estimatedMeasurements: BodyMeasurementKey[];
  ease: GarmentEase;
  limits: TrouserPatternLimits;
  manualReview: boolean;
  notes: string[];
}

export interface TrouserPatternDraft {
  pieces: PatternPiece[];
  variables: ParametricVariableRecord[];
  constructionGraph: ParametricConstructionGraphRecord;
  ease: GarmentEase;
  metadata: TrouserPatternMetadata;
}

export interface TrouserPatternDraftOptions {
  /** Escala estrutural das pences. Zero remove a tomada para testes e futuras variações. */
  dartScale?: number;
}

const TEMPLATE_VERSION = "straight-pants@3";
const FORMULA_VERSION = `${TEMPLATE_VERSION}:formula-v1`;

export const TROUSER_PATTERN_METADATA: TrouserPatternMetadata = {
  templateId: "straight-pants",
  templateVersion: TEMPLATE_VERSION,
  constructionSystem: "Titan trouser block adaptation for Moldeon 2026.3",
  methodology: TROUSER_BLOCK_METHODOLOGY,
  validationStatus: "geometrically-validated",
  componentStatus: { body: "geometrically-validated" },
  requiredMeasurements: [
    "waistMm",
    "hipMm",
    "hipHeightMm",
    "sittingCrotchHeightMm",
    "crotchDepthMm",
    "seatDepthMm",
    "waistDropMm",
    "waistFrontArcMm",
    "waistBackArcMm",
    "hipFrontArcMm",
    "hipBackArcMm",
    "thighMm",
    "kneeCircumferenceMm",
    "ankleCircumferenceMm",
    "kneeHeightMm",
    "outseamLengthMm",
    "insideLegLengthMm",
  ],
  estimatedMeasurements: [
    "hipHeightMm",
    "sittingCrotchHeightMm",
    "crotchDepthMm",
    "seatDepthMm",
    "waistDropMm",
    "waistFrontArcMm",
    "waistBackArcMm",
    "hipFrontArcMm",
    "hipBackArcMm",
    "thighMm",
    "kneeCircumferenceMm",
    "ankleCircumferenceMm",
    "kneeHeightMm",
    "outseamLengthMm",
    "insideLegLengthMm",
  ],
  ease: { bustMm: 0, waistMm: 0, hipMm: 0, sleeveMm: 0 },
  limits: {
    minimumAreaMm2: 30_000,
    sideSeamToleranceMm: 18,
    inseamToleranceMm: 22,
    minimumCurveSeparationMm: 0.8,
  },
  manualReview: false,
  notes: [
    "Adaptação do bloco Titan: folga percentual, forquilha única, fio calculado entre lateral e gancho e perna traseira mais larga.",
    "Os semiarcos frontal e traseiro podem ser medidos; a divisão 48/52 aparece apenas como estimativa declarada no perfil corporal.",
    "A construção passou por invariantes geométricos, mas continua aguardando toile e aprovação visual manual.",
    "Braguilha, cós, bolsos, zíper e preparação industrial permanecem fora desta versão.",
  ],
};

export function draftTrouserPattern(
  measurements: BodyMeasurements,
  options: TrouserPatternDraftOptions = {},
): TrouserPatternDraft {
  const dartScale = clamp(options.dartScale ?? 1, 0, 1.5);
  const definitions = trouserDefinitions(dartScale);
  const inputs = trouserMeasurementInputs(measurements);
  const values = evaluateDefinitions(definitions, inputs);
  const pieces = [
    createTrouserPiece("straight-pants-front", "Frente", "front", values),
    createTrouserPiece("straight-pants-back", "Costas", "back", values),
  ];
  return {
    pieces,
    variables: formulaVariables(definitions),
    constructionGraph: constructionGraph(definitions),
    ease: TROUSER_PATTERN_METADATA.ease,
    metadata: TROUSER_PATTERN_METADATA,
  };
}

function trouserDefinitions(dartScale: number): FormulaDefinition[] {
  return [
    formula("waistEaseRatio", "0.02", "ratio"),
    formula("seatEaseRatio", "0.02", "ratio"),
    formula("kneeEaseRatio", "0.06", "ratio"),
    formula("crotchDropRatio", "0.02", "ratio"),
    formula("legBalance", "0.575", "ratio"),
    formula("grainlinePosition", "0.45", "ratio"),
    formula("frontWaistFinal", "waistFrontArcMm * (1 + waistEaseRatio)", "mm"),
    formula("backWaistFinal", "waistBackArcMm * (1 + waistEaseRatio)", "mm"),
    formula("frontSeatWidth", "hipFrontArcMm * (1 + seatEaseRatio)", "mm"),
    formula("backSeatWidth", "hipBackArcMm * (1 + seatEaseRatio)", "mm"),
    formula("dartScale", String(dartScale), "ratio"),
    formula("frontSuppression", "max(0mm, frontSeatWidth - frontWaistFinal)", "mm"),
    formula("backSuppression", "max(0mm, backSeatWidth - backWaistFinal)", "mm"),
    formula("frontDartWidth", "min(20mm, max(0mm, frontSuppression - 35mm)) * dartScale", "mm"),
    formula("backDartWidth", "min(36mm, max(18mm, backSuppression - 30mm)) * dartScale", "mm"),
    formula("frontWaistOpen", "frontWaistFinal + frontDartWidth", "mm"),
    formula("backWaistOpen", "backWaistFinal + backDartWidth", "mm"),
    formula("hipLineY", "clamp(hipHeightMm, 120mm, sittingCrotchHeightMm - 40mm)", "mm"),
    formula("crotchLineY", "max(hipLineY + 40mm, sittingCrotchHeightMm * (1 + crotchDropRatio))", "mm"),
    formula("outseam", "outseamLengthMm", "mm"),
    formula("kneeLineY", "clamp(crotchLineY + kneeHeightMm, crotchLineY + 220mm, outseam - 170mm)", "mm"),
    formula("frontForkExtension", "frontSeatWidth * 0.25", "mm"),
    formula("backForkExtension", "backSeatWidth * 0.25", "mm"),
    formula("frontForkX", "0mm - frontForkExtension", "mm"),
    formula("backForkX", "0mm - backForkExtension", "mm"),
    formula("frontCenterWaistY", "max(8mm, waistDropMm * 0.60)", "mm"),
    formula("frontSideWaistY", "0mm", "mm"),
    formula("backCenterRise", "max(25mm, seatDepthMm * 0.12)", "mm"),
    formula("backCenterWaistY", "0mm - backCenterRise", "mm"),
    formula("backSideWaistY", "0mm", "mm"),
    formula("backCenterWaistX", "backSeatWidth * 0.08", "mm"),
    formula("frontDartLength", "clamp(hipLineY * 0.50, 75mm, 110mm)", "mm"),
    formula("backDartLength", "clamp(hipLineY * 0.72, 115mm, 160mm)", "mm"),
    formula("frontDartX", "frontWaistOpen * 0.58", "mm"),
    formula("backDartX", "backCenterWaistX + backWaistOpen * 0.48", "mm"),
    formula("frontSideCrotchX", "frontSeatWidth + 4mm", "mm"),
    formula("backSideCrotchX", "backSeatWidth + 4mm", "mm"),
    formula("frontCreaseX", "frontSeatWidth + (frontForkX - frontSeatWidth) * grainlinePosition", "mm"),
    formula("backCreaseX", "backSeatWidth + (backForkX - backSeatWidth) * grainlinePosition", "mm"),
    formula("dressedKnee", "kneeCircumferenceMm * (1 + kneeEaseRatio)", "mm"),
    formula("frontKneeWidth", "dressedKnee * (1 - legBalance)", "mm"),
    formula("backKneeWidth", "dressedKnee * legBalance", "mm"),
    formula("frontHemWidth", "max(frontKneeWidth, (ankleCircumferenceMm + 120mm) * (1 - legBalance))", "mm"),
    formula("backHemWidth", "max(backKneeWidth, (ankleCircumferenceMm + 120mm) * legBalance)", "mm"),
    formula("frontKneeOutsideX", "frontCreaseX + frontKneeWidth / 2", "mm"),
    formula("frontKneeInsideX", "frontCreaseX - frontKneeWidth / 2", "mm"),
    formula("backKneeOutsideX", "backCreaseX + backKneeWidth / 2", "mm"),
    formula("backKneeInsideX", "backCreaseX - backKneeWidth / 2", "mm"),
    formula("frontHemOutsideX", "frontCreaseX + frontHemWidth / 2", "mm"),
    formula("frontHemInsideX", "frontCreaseX - frontHemWidth / 2", "mm"),
    formula("backHemOutsideX", "backCreaseX + backHemWidth / 2", "mm"),
    formula("backHemInsideX", "backCreaseX - backHemWidth / 2", "mm"),
  ];
}

function createTrouserPiece(
  id: string,
  name: string,
  surface: "front" | "back",
  values: Readonly<Record<string, number>>,
): PatternPiece {
  const isFront = surface === "front";
  const prefix = isFront ? "front" : "back";
  const waistOpen = values[`${prefix}WaistOpen`];
  const seatWidth = values[`${prefix}SeatWidth`];
  const sideCrotchX = values[`${prefix}SideCrotchX`];
  const forkX = values[`${prefix}ForkX`];
  const forkExtension = values[`${prefix}ForkExtension`];
  const creaseX = values[`${prefix}CreaseX`];
  const kneeOutsideX = values[`${prefix}KneeOutsideX`];
  const kneeInsideX = values[`${prefix}KneeInsideX`];
  const hemOutsideX = values[`${prefix}HemOutsideX`];
  const hemInsideX = values[`${prefix}HemInsideX`];
  const centerWaistY = values[`${prefix}CenterWaistY`];
  const sideWaistY = values[`${prefix}SideWaistY`];
  const centerWaistX = isFront ? 0 : values.backCenterWaistX;
  const sideWaistX = centerWaistX + waistOpen;
  const dartWidth = values[`${prefix}DartWidth`];
  const dartLength = values[`${prefix}DartLength`];
  const dartX = values[`${prefix}DartX`];
  const dartY = interpolateY(centerWaistY, sideWaistY, waistOpen === 0 ? 0 : (dartX - centerWaistX) / waistOpen);
  const darts = dartWidth > 0.05
    ? [closeDart(createDart(id, { xMm: dartX, yMm: dartY }, { xMm: dartX, yMm: dartY + dartLength }, dartWidth))]
    : [];
  const riseHeight = values.crotchLineY - values.hipLineY;
  const legCurveHeight = values.kneeLineY - values.crotchLineY;

  return piece(
    id,
    name,
    [
      point("center-waist", centerWaistX, centerWaistY, {
        in: { xMm: isFront ? 0 : -centerWaistX * 0.38, yMm: values.hipLineY * 0.30 },
        out: { xMm: waistOpen * 0.28, yMm: (sideWaistY - centerWaistY) * 0.45 },
      }),
      point("side-waist", sideWaistX, sideWaistY, {
        in: { xMm: -waistOpen * 0.28, yMm: (centerWaistY - sideWaistY) * 0.45 },
        out: { xMm: Math.max(8, (seatWidth - sideWaistX) * 0.62), yMm: values.hipLineY * 0.36 },
      }),
      point("side-hip", seatWidth, values.hipLineY, {
        in: { xMm: -Math.max(7, Math.abs(seatWidth - sideWaistX) * 0.32), yMm: -values.hipLineY * 0.34 },
        out: { xMm: (sideCrotchX - seatWidth) * 0.55, yMm: riseHeight * 0.42 },
      }),
      point("side-crotch", sideCrotchX, values.crotchLineY, {
        in: { xMm: (seatWidth - sideCrotchX) * 0.45, yMm: -riseHeight * 0.42 },
        out: { xMm: (kneeOutsideX - sideCrotchX) * 0.22, yMm: legCurveHeight * 0.30 },
      }),
      point("knee-outside", kneeOutsideX, values.kneeLineY, {
        in: { xMm: (sideCrotchX - kneeOutsideX) * 0.14, yMm: -legCurveHeight * 0.34 },
      }),
      point("hem-outside", hemOutsideX, values.outseam),
      point("hem-inside", hemInsideX, values.outseam),
      point("knee-inside", kneeInsideX, values.kneeLineY, {
        out: { xMm: (forkX - kneeInsideX) * 0.18, yMm: -legCurveHeight * 0.34 },
      }),
      point("fork", forkX, values.crotchLineY, {
        in: { xMm: Math.max(34, Math.abs(kneeInsideX - forkX) * 0.42), yMm: legCurveHeight * 0.16 },
        out: { xMm: forkExtension * (isFront ? 0.82 : 0.72), yMm: isFront ? -2 : -8 },
      }),
      point("center-hip", 0, values.hipLineY, {
        in: { xMm: -forkExtension * (isFront ? 0.08 : 0.20), yMm: riseHeight * (isFront ? 0.58 : 0.70) },
        out: { xMm: isFront ? 0 : centerWaistX * 0.22, yMm: -values.hipLineY * 0.32 },
      }),
    ],
    {
      cutQuantity: 2,
      previewPlacements: [
        placement("leg", surface, "left"),
        placement("leg", surface, "right", true),
      ],
      segmentRoles: [
        "waist",
        "outseam",
        "outseam",
        "outseam",
        "outseam",
        "hem",
        "inseam",
        "inseam",
        isFront ? "frontCrotch" : "backCrotch",
        isFront ? "frontCrotch" : "backCrotch",
      ],
      darts,
      grainline: {
        start: { xMm: creaseX, yMm: values.crotchLineY + 45 },
        end: { xMm: creaseX, yMm: values.outseam - 45 },
      },
      internalLines: [
        referenceLine(`${id}:hip-line`, id, "Linha do quadril", 0, values.hipLineY, seatWidth, values.hipLineY),
        referenceLine(`${id}:crotch-line`, id, "Linha do gancho", forkX, values.crotchLineY, sideCrotchX, values.crotchLineY),
        referenceLine(`${id}:knee-line`, id, "Linha do joelho", kneeInsideX, values.kneeLineY, kneeOutsideX, values.kneeLineY),
        referenceLine(`${id}:crease-line`, id, "Centro da perna", creaseX, values.crotchLineY + 18, creaseX, values.outseam - 18),
      ],
      annotations: [
        { id: `${id}:hip-landmark`, label: "Landmark do quadril", xMm: seatWidth - 34, yMm: values.hipLineY - 8 },
        { id: `${id}:crotch-landmark`, label: isFront ? "Forquilha / gancho frontal" : "Forquilha / gancho traseiro", xMm: forkX + 10, yMm: values.crotchLineY - 10 },
        { id: `${id}:knee-landmark`, label: "Pique de joelho", xMm: kneeOutsideX - 22, yMm: values.kneeLineY - 8 },
        { id: `${id}:grain`, label: "Fio / centro da perna", xMm: creaseX + 8, yMm: (values.crotchLineY + values.outseam) / 2 },
        { id: `${id}:dart`, label: isFront ? "Pence frontal opcional" : "Pence traseira", xMm: dartX + 7, yMm: dartY + dartLength * 0.55 },
        { id: `${id}:cut-quantity`, label: "Cortar 2x: esquerda e direita", xMm: creaseX + 8, yMm: values.outseam - 70 },
      ],
    },
  );
}

function trouserMeasurementInputs(
  measurements: BodyMeasurements,
): Record<string, FormulaQuantity> {
  const resolved = measurements as unknown as Readonly<Record<string, number | undefined>>;
  const keys = [
    "waistMm",
    "hipMm",
    "hipHeightMm",
    "sittingCrotchHeightMm",
    "crotchDepthMm",
    "seatDepthMm",
    "waistDropMm",
    "waistFrontArcMm",
    "waistBackArcMm",
    "hipFrontArcMm",
    "hipBackArcMm",
    "thighMm",
    "kneeCircumferenceMm",
    "ankleCircumferenceMm",
    "kneeHeightMm",
    "outseamLengthMm",
    "insideLegLengthMm",
  ] as const;
  const inputs: Record<string, FormulaQuantity> = {};
  for (const key of keys) {
    const value = resolved[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new RangeError(`A medida ${key} é necessária para construir a calça.`);
    }
    inputs[key] = formulaQuantity(value, "mm");
  }
  return inputs;
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
    throw new RangeError(`Não foi possível calcular a base de calça. ${messages.join(" ")}`);
  }
  return {
    ...Object.fromEntries(Object.entries(inputs).map(([id, quantity]) => [id, quantity.value])),
    ...Object.fromEntries(Object.entries(evaluation.values).map(([id, quantity]) => [id, roundMm(quantity.value)])),
  };
}

function formulaVariables(definitions: readonly FormulaDefinition[]): ParametricVariableRecord[] {
  return definitions.map((definition) => ({
    id: definition.id,
    name: definition.id,
    expression: definition.expression,
    unit: definition.unit,
    formulaVersion: FORMULA_VERSION,
    dependencies: parseFormula(definition.expression).dependencies,
    description: formulaDescription(definition.id),
  }));
}

function constructionGraph(definitions: readonly FormulaDefinition[]): ParametricConstructionGraphRecord {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const measurements = new Set<string>();
  for (const definition of definitions) {
    for (const dependency of parseFormula(definition.expression).dependencies) {
      if (!byId.has(dependency)) measurements.add(dependency);
    }
  }
  return {
    version: 2,
    nodes: [
      ...[...measurements].sort().map((measurementKey) => ({
        id: `measurement:${measurementKey}`,
        kind: "measurement" as const,
        dependencies: [],
        payload: { measurementKey },
      })),
      ...definitions.map((definition) => ({
        id: `variable:${definition.id}`,
        kind: "variable" as const,
        dependencies: parseFormula(definition.expression).dependencies.map((dependency) =>
          byId.has(dependency) ? `variable:${dependency}` : `measurement:${dependency}`,
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
    waistEaseRatio: "Folga de cintura de 2% do bloco Titan.",
    seatEaseRatio: "Folga de assento de 2% do bloco Titan.",
    legBalance: "Distribuição Titan: costas ocupam 57,5% da circunferência da perna.",
    grainlinePosition: "Posição Titan do fio a 45% entre a lateral superior e a forquilha.",
    crotchLineY: "Altura vertical do gancho derivada da medida sentada.",
    frontForkExtension: "Extensão frontal da forquilha: 25% do semiarco frontal do assento com folga.",
    backForkExtension: "Extensão traseira da forquilha: 25% do semiarco traseiro do assento com folga.",
    backCenterRise: "Elevação funcional da cintura traseira.",
    frontDartWidth: "Tomada opcional da pence frontal.",
    backDartWidth: "Tomada estrutural da pence traseira.",
    frontCreaseX: "Centro geométrico da perna frontal.",
    backCreaseX: "Centro geométrico da perna traseira.",
    kneeLineY: "Linha do joelho medida a partir do gancho.",
    frontHemWidth: "Barra frontal reta, nunca menor que a largura frontal do joelho.",
    backHemWidth: "Barra traseira reta, nunca menor que a largura traseira do joelho.",
  };
  return descriptions[id] ?? "Variável versionada da construção de calça.";
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
  previewPlacements: PatternPreviewPlacement[];
  segmentRoles: SegmentRole[];
  darts: PatternPiece["darts"];
  internalLines: PatternPiece["internalLines"];
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
    previewPlacements: options.previewPlacements.map((current) => ({ ...current, pieceId: id })),
    points: points.map((current) => ({ ...current, id: `${id}:${current.id}` })),
    darts: (options.darts ?? []).map((dart) => ({ ...dart, pieceId: id })),
    internalLines: options.internalLines,
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
    nodes: [point("start", x1, y1), point("end", x2, y2)],
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
  return start + (end - start) * clamp(t, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
