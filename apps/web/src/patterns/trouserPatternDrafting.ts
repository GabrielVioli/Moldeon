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
} from "../domain/parametricMeasurements";
import type { PatternValidationStatus } from "./basePatternDrafting";

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

const TEMPLATE_VERSION = "straight-pants@2";
const FORMULA_VERSION = `${TEMPLATE_VERSION}:formula-v1`;

export const TROUSER_PATTERN_METADATA: TrouserPatternMetadata = {
  templateId: "straight-pants",
  templateVersion: TEMPLATE_VERSION,
  constructionSystem: "Moldeon Reference Trouser Block 2026",
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
    "thighMm",
    "kneeCircumferenceMm",
    "ankleCircumferenceMm",
    "kneeHeightMm",
    "outseamLengthMm",
    "insideLegLengthMm",
  ],
  ease: { bustMm: 0, waistMm: 30, hipMm: 55, sleeveMm: 0 },
  limits: {
    minimumAreaMm2: 30_000,
    sideSeamToleranceMm: 18,
    inseamToleranceMm: 22,
    minimumCurveSeparationMm: 0.8,
  },
  manualReview: false,
  notes: [
    "Frente e costas usam distribuição, cintura, extensão e curva de gancho próprias.",
    "A construção passou por invariantes geométricos e montagem lógica, mas não por toile ou revisão presencial.",
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
    formula("halfDressedHip", "(hipMm + 55mm) / 2", "mm"),
    formula("halfDressedWaist", "(waistMm + 30mm) / 2", "mm"),
    formula("frontHipShare", "0.48", "ratio"),
    formula("frontWaistShare", "0.47", "ratio"),
    formula("frontHipWidth", "halfDressedHip * frontHipShare", "mm"),
    formula("backHipWidth", "halfDressedHip - frontHipWidth", "mm"),
    formula("frontWaistFinal", "halfDressedWaist * frontWaistShare", "mm"),
    formula("backWaistFinal", "halfDressedWaist - frontWaistFinal", "mm"),
    formula("dartScale", String(dartScale), "ratio"),
    formula("frontSuppression", "max(0mm, frontHipWidth - frontWaistFinal)", "mm"),
    formula("backSuppression", "max(0mm, backHipWidth - backWaistFinal)", "mm"),
    formula("frontDartWidth", "min(24mm, max(0mm, frontSuppression * 0.22)) * dartScale", "mm"),
    formula("backDartWidth", "min(40mm, max(16mm, backSuppression * 0.40)) * dartScale", "mm"),
    formula("frontWaistOpen", "frontWaistFinal + frontDartWidth", "mm"),
    formula("backWaistOpen", "backWaistFinal + backDartWidth", "mm"),
    formula("hipLineY", "clamp(hipHeightMm, 120mm, sittingCrotchHeightMm - 48mm)", "mm"),
    formula("crotchLineY", "clamp(sittingCrotchHeightMm + 6mm, hipLineY + 48mm, 430mm)", "mm"),
    formula("insideLeg", "insideLegLengthMm", "mm"),
    formula("outseam", "max(outseamLengthMm, insideLeg + crotchLineY - 5mm)", "mm"),
    formula("kneeDistance", "clamp(kneeHeightMm, 220mm, insideLeg - 170mm)", "mm"),
    formula("kneeLineY", "crotchLineY + kneeDistance", "mm"),
    formula("frontCrotchExtension", "max(38mm, crotchDepthMm * 0.16 + seatDepthMm * 0.035)", "mm"),
    formula("backCrotchExtension", "max(82mm, crotchDepthMm * 0.34 + seatDepthMm * 0.10)", "mm"),
    formula("frontCenterWaistY", "waistDropMm * 0.52", "mm"),
    formula("frontSideWaistY", "waistDropMm * 0.12", "mm"),
    formula("backCenterRise", "max(18mm, waistDropMm * 0.72 + seatDepthMm * 0.035)", "mm"),
    formula("backCenterWaistY", "0mm - backCenterRise", "mm"),
    formula("backSideWaistY", "0mm - waistDropMm * 0.08", "mm"),
    formula("frontDartLength", "clamp(hipLineY * 0.48, 75mm, 115mm)", "mm"),
    formula("backDartLength", "clamp(hipLineY * 0.66, 105mm, 155mm)", "mm"),
    formula("frontDartX", "frontWaistOpen * 0.58", "mm"),
    formula("backDartX", "backWaistOpen * 0.46", "mm"),
    formula("dressedThigh", "thighMm + 40mm", "mm"),
    formula("frontThighWidth", "dressedThigh * 0.48", "mm"),
    formula("backThighWidth", "dressedThigh - frontThighWidth", "mm"),
    formula("frontSideCrotchX", "max(frontHipWidth * 0.93, frontThighWidth * 0.54)", "mm"),
    formula("backSideCrotchX", "max(backHipWidth * 0.95, backThighWidth * 0.52)", "mm"),
    formula("frontInseamCrotchX", "frontSideCrotchX - frontThighWidth", "mm"),
    formula("backInseamCrotchX", "backSideCrotchX - backThighWidth", "mm"),
    formula("frontCrotchTipX", "frontInseamCrotchX - frontCrotchExtension", "mm"),
    formula("backCrotchTipX", "backInseamCrotchX - backCrotchExtension", "mm"),
    formula("frontCreaseX", "(frontSideCrotchX + frontInseamCrotchX) / 2", "mm"),
    formula("backCreaseX", "(backSideCrotchX + backInseamCrotchX) / 2", "mm"),
    formula("dressedKnee", "kneeCircumferenceMm + 50mm", "mm"),
    formula("frontKneeWidth", "dressedKnee * 0.48", "mm"),
    formula("backKneeWidth", "dressedKnee - frontKneeWidth", "mm"),
    formula("hemCircumference", "max(380mm, ankleCircumferenceMm + 120mm)", "mm"),
    formula("frontHemWidth", "hemCircumference * 0.48", "mm"),
    formula("backHemWidth", "hemCircumference - frontHemWidth", "mm"),
    formula("frontKneeOutsideX", "frontCreaseX + frontKneeWidth * 0.53", "mm"),
    formula("frontKneeInsideX", "frontCreaseX - frontKneeWidth * 0.47", "mm"),
    formula("backKneeOutsideX", "backCreaseX + backKneeWidth * 0.51", "mm"),
    formula("backKneeInsideX", "backCreaseX - backKneeWidth * 0.49", "mm"),
    formula("frontHemOutsideX", "frontCreaseX + frontHemWidth * 0.53", "mm"),
    formula("frontHemInsideX", "frontCreaseX - frontHemWidth * 0.47", "mm"),
    formula("backHemOutsideX", "backCreaseX + backHemWidth * 0.51", "mm"),
    formula("backHemInsideX", "backCreaseX - backHemWidth * 0.49", "mm"),
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
  const hipWidth = values[`${prefix}HipWidth`];
  const sideCrotchX = values[`${prefix}SideCrotchX`];
  const inseamCrotchX = values[`${prefix}InseamCrotchX`];
  const crotchTipX = values[`${prefix}CrotchTipX`];
  const creaseX = values[`${prefix}CreaseX`];
  const kneeOutsideX = values[`${prefix}KneeOutsideX`];
  const kneeInsideX = values[`${prefix}KneeInsideX`];
  const hemOutsideX = values[`${prefix}HemOutsideX`];
  const hemInsideX = values[`${prefix}HemInsideX`];
  const centerWaistY = values[`${prefix}CenterWaistY`];
  const sideWaistY = values[`${prefix}SideWaistY`];
  const dartWidth = values[`${prefix}DartWidth`];
  const dartLength = values[`${prefix}DartLength`];
  const dartX = values[`${prefix}DartX`];
  const dartY = interpolateY(centerWaistY, sideWaistY, waistOpen === 0 ? 0 : dartX / waistOpen);
  const darts = dartWidth > 0.05
    ? [closeDart(createDart(id, { xMm: dartX, yMm: dartY }, { xMm: dartX, yMm: dartY + dartLength }, dartWidth))]
    : [];
  const extension = Math.abs(crotchTipX - inseamCrotchX);

  return piece(
    id,
    name,
    [
      point("center-waist", 0, centerWaistY, {
        in: { xMm: -Math.max(18, extension * 0.24), yMm: values.crotchLineY * 0.31 },
      }),
      point("side-waist", waistOpen, sideWaistY, {
        out: { xMm: Math.max(4, (hipWidth - waistOpen) * 0.54), yMm: values.hipLineY * 0.30 },
      }),
      point("side-hip", hipWidth, values.hipLineY, {
        in: { xMm: -Math.max(4, Math.abs(hipWidth - waistOpen) * 0.28), yMm: -values.hipLineY * 0.33 },
        out: { xMm: (sideCrotchX - hipWidth) * 0.48, yMm: (values.crotchLineY - values.hipLineY) * 0.46 },
      }),
      point("side-crotch", sideCrotchX, values.crotchLineY, {
        in: { xMm: (hipWidth - sideCrotchX) * 0.30, yMm: -(values.crotchLineY - values.hipLineY) * 0.34 },
      }),
      point("knee-outside", kneeOutsideX, values.kneeLineY),
      point("hem-outside", hemOutsideX, values.outseam),
      point("hem-inside", hemInsideX, values.outseam),
      point("knee-inside", kneeInsideX, values.kneeLineY),
      point("inseam-crotch", inseamCrotchX, values.crotchLineY + (isFront ? 16 : 4), {
        out: { xMm: (crotchTipX - inseamCrotchX) * 0.36, yMm: isFront ? -3 : -8 },
      }),
      point("crotch-tip", crotchTipX, values.crotchLineY, {
        in: { xMm: Math.max(12, extension * 0.30), yMm: isFront ? 10 : 18 },
        out: { xMm: Math.max(24, extension * 0.78), yMm: isFront ? -24 : -38 },
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
        "inseam",
        isFront ? "frontCrotch" : "backCrotch",
      ],
      darts,
      grainline: {
        start: { xMm: creaseX, yMm: values.crotchLineY + 45 },
        end: { xMm: creaseX, yMm: values.outseam - 45 },
      },
      internalLines: [
        referenceLine(`${id}:hip-line`, id, "Linha do quadril", Math.min(0, crotchTipX * 0.18), values.hipLineY, hipWidth, values.hipLineY),
        referenceLine(`${id}:crotch-line`, id, "Linha do gancho", crotchTipX, values.crotchLineY, sideCrotchX, values.crotchLineY),
        referenceLine(`${id}:knee-line`, id, "Linha do joelho", kneeInsideX, values.kneeLineY, kneeOutsideX, values.kneeLineY),
        referenceLine(`${id}:crease-line`, id, "Centro da perna", creaseX, values.crotchLineY + 18, creaseX, values.outseam - 18),
      ],
      annotations: [
        { id: `${id}:hip-landmark`, label: "Landmark do quadril", xMm: hipWidth - 34, yMm: values.hipLineY - 8 },
        { id: `${id}:crotch-landmark`, label: isFront ? "Gancho frontal" : "Gancho traseiro", xMm: crotchTipX + 10, yMm: values.crotchLineY - 10 },
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
    frontHipShare: "Distribuição estrutural de quadril entre frente e costas.",
    frontWaistShare: "Distribuição estrutural de cintura entre frente e costas.",
    crotchLineY: "Altura vertical do gancho derivada da medida sentada.",
    frontCrotchExtension: "Extensão frontal do gancho, menor que a traseira.",
    backCrotchExtension: "Extensão traseira do gancho com participação da profundidade do assento.",
    backCenterRise: "Elevação funcional da cintura traseira.",
    frontDartWidth: "Tomada opcional da pence frontal.",
    backDartWidth: "Tomada estrutural da pence traseira.",
    frontCreaseX: "Centro geométrico da perna frontal.",
    backCreaseX: "Centro geométrico da perna traseira.",
    kneeLineY: "Linha do joelho medida a partir do gancho.",
    hemCircumference: "Regra estética versionada da barra reta.",
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
