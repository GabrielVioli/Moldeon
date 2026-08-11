import type { BodyMeasurements, BodyType } from "./pattern";
import {
  FormulaError,
  FormulaGraphEngine,
  formulaQuantity,
  parseFormula,
  type FormulaDefinition,
  type FormulaUnit,
} from "./formulaEngine";

export const MEASUREMENT_PROFILE_VERSION = 1 as const;
export const BODY_FORMULA_SET_ID = "moldeon-body-defaults" as const;
export const BODY_FORMULA_SET_VERSION = "2026.1" as const;
export const PARAMETRIC_PROJECT_VERSION = 1 as const;

export type MeasurementOrigin = "supplied" | "estimated" | "derived";
export type BodyMeasurementKey = keyof BodyMeasurements;

export interface MeasurementCatalogEntry {
  key: BodyMeasurementKey;
  label: string;
  group: "general" | "neck-shoulder" | "torso" | "arm" | "hip" | "leg" | "other";
  unit: "mm" | "degree";
  minimum: number;
  maximum: number;
  step: number;
  essential?: boolean;
  description: string;
}

export interface MeasurementProfileEntry {
  key: BodyMeasurementKey;
  value: number;
  unit: "mm" | "degree";
  origin: MeasurementOrigin;
  defaultOrigin?: Exclude<MeasurementOrigin, "supplied">;
  formula?: string;
  formulaVersion?: string;
  dependencies: string[];
  overridden: boolean;
  error?: string;
}

export interface MeasurementProfile {
  schemaVersion: 1;
  formulaSetId: typeof BODY_FORMULA_SET_ID;
  formulaSetVersion: string;
  bodyType: BodyType;
  entries: Partial<Record<BodyMeasurementKey, MeasurementProfileEntry>>;
}

export interface ParametricVariableRecord {
  id: string;
  name: string;
  expression: string;
  unit: "mm" | "ratio" | "degree" | "scalar";
  formulaVersion: string;
  dependencies: string[];
  description?: string;
}

export interface ParametricConstructionNodeRecord {
  id: string;
  kind:
    | "measurement"
    | "variable"
    | "free-point"
    | "computed-point"
    | "line"
    | "arc"
    | "curve"
    | "transform"
    | "operation";
  dependencies: string[];
  payload: Record<string, unknown>;
}

export interface ParametricConstructionGraphRecord {
  version: 1 | 2;
  nodes: ParametricConstructionNodeRecord[];
}

export interface PatternGenerationRecord {
  patternId: string;
  templateId: string;
  templateVersion: string;
  engineVersion: 1;
  measurementSetId: string;
  formulaSetVersion: string;
  measurementValues: Partial<Record<BodyMeasurementKey, number>>;
  measurementOrigins: Partial<Record<BodyMeasurementKey, MeasurementOrigin>>;
  defaultValues: Partial<Record<BodyMeasurementKey, number>>;
  constructionSystem?: string;
  validationStatus?: "experimental" | "geometrically-validated" | "manually-reviewed";
  componentValidation?: {
    body: "experimental" | "geometrically-validated" | "manually-reviewed";
    sleeve?: "experimental" | "geometrically-validated" | "manually-reviewed";
  };
  requiredMeasurements?: BodyMeasurementKey[];
  estimatedMeasurements?: BodyMeasurementKey[];
  ease?: { bustMm: number; waistMm: number; hipMm: number; sleeveMm: number };
  limits?: {
    minimumAreaMm2: number;
    shoulderToleranceMm?: number;
    sideSeamToleranceMm: number;
    inseamToleranceMm?: number;
    minimumCurveSeparationMm: number;
  };
  manualReview?: boolean;
  methodology?: PatternMethodologyRecord;
}

export interface PatternMethodologyRecord {
  id: string;
  version: string;
  name: string;
  sourceType: "documented-adaptation" | "moldeon-original" | "pending";
  documentationPath: string;
  references: string[];
}

export interface ParametricProjectMetadata {
  schemaVersion: 1;
  templateId?: string;
  templateVersion?: string;
  variables: ParametricVariableRecord[];
  constructionGraph: ParametricConstructionGraphRecord;
  generations: PatternGenerationRecord[];
}

interface DefaultFormula {
  key: BodyMeasurementKey;
  expression: string;
  origin: Exclude<MeasurementOrigin, "supplied">;
}

export interface MeasurementFormulaUpdateResult {
  accepted: boolean;
  profile: MeasurementProfile;
  measurements: BodyMeasurements;
  error?: string;
  recomputed: BodyMeasurementKey[];
}

export const BODY_MEASUREMENT_CATALOG: readonly MeasurementCatalogEntry[] = [
  item("heightMm", "Altura", "general", "mm", 1200, 2300, 5, "Altura total do corpo.", true),
  item("bustMm", "Busto ou tórax", "general", "mm", 550, 1800, 5, "Circunferência principal do tórax.", true),
  item("waistMm", "Cintura", "general", "mm", 450, 1700, 5, "Circunferência natural da cintura.", true),
  item("hipMm", "Quadril", "general", "mm", 600, 1900, 5, "Circunferência de maior volume do quadril.", true),
  item("shoulderWidthMm", "Largura de ombros", "general", "mm", 260, 750, 5, "Distância entre as extremidades dos ombros.", true),
  item("torsoLengthMm", "Comprimento do tronco", "general", "mm", 280, 750, 5, "Comprimento vertical de referência do tronco.", true),
  item("armLengthMm", "Comprimento do braço", "general", "mm", 350, 950, 5, "Ombro até o punho.", true),
  item("inseamMm", "Entrepernas", "general", "mm", 450, 1250, 5, "Gancho até o chão pela parte interna.", true),
  item("neckCircumferenceMm", "Contorno do pescoço", "neck-shoulder", "mm", 240, 650, 5, "Circunferência da base do pescoço."),
  item("neckWidthMm", "Largura do pescoço", "neck-shoulder", "mm", 45, 180, 1, "Largura horizontal usada no decote."),
  item("shoulderSlopeDeg", "Inclinação do ombro", "neck-shoulder", "degree", 0, 35, 0.5, "Ângulo de queda do ombro."),
  item("shoulderLengthMm", "Comprimento do ombro", "neck-shoulder", "mm", 70, 260, 1, "Base do pescoço até a extremidade do ombro."),
  item("bustHeightMm", "Altura do busto", "torso", "mm", 160, 500, 5, "Ombro até a linha do busto."),
  item("bustSpanMm", "Distância entre bustos", "torso", "mm", 100, 360, 5, "Distância horizontal entre os ápices."),
  item("highBustMm", "Busto alto", "torso", "mm", 500, 1750, 5, "Circunferência acima do volume principal do busto."),
  item("frontWaistLengthMm", "Comprimento frente até cintura", "torso", "mm", 250, 750, 5, "Ombro à cintura pela frente."),
  item("backWaistLengthMm", "Comprimento costas até cintura", "torso", "mm", 250, 750, 5, "Ombro à cintura pelas costas."),
  item("armholeDepthMm", "Profundidade da cava", "torso", "mm", 120, 420, 5, "Ombro à linha inferior da cava."),
  item("backWidthMm", "Largura das costas", "torso", "mm", 220, 650, 5, "Largura transversal das costas."),
  item("frontWidthMm", "Largura da frente", "torso", "mm", 200, 650, 5, "Largura transversal da frente."),
  item("bicepMm", "Bíceps", "arm", "mm", 160, 800, 5, "Circunferência do braço na região mais larga."),
  item("elbowCircumferenceMm", "Cotovelo", "arm", "mm", 150, 650, 5, "Circunferência do cotovelo."),
  item("wristMm", "Punho", "arm", "mm", 90, 400, 5, "Circunferência do punho."),
  item("elbowLengthMm", "Comprimento até cotovelo", "arm", "mm", 180, 600, 5, "Ombro até o cotovelo."),
  item("hipHeightMm", "Altura do quadril", "hip", "mm", 100, 420, 5, "Cintura à linha de maior volume do quadril."),
  item("sittingCrotchHeightMm", "Altura de gancho sentado", "hip", "mm", 150, 450, 5, "Cintura ao assento em posição sentada."),
  item("crotchDepthMm", "Profundidade do gancho", "hip", "mm", 140, 500, 5, "Profundidade horizontal de referência do gancho."),
  item("seatDepthMm", "Profundidade do assento", "hip", "mm", 120, 500, 5, "Profundidade frontal a traseira do quadril."),
  item("waistDropMm", "Queda de cintura", "hip", "mm", 0, 120, 1, "Diferença vertical entre linhas de cintura."),
  item("waistFrontArcMm", "Semiarco frontal da cintura", "hip", "mm", 90, 450, 5, "Medida de uma lateral ao centro da frente da cintura."),
  item("waistBackArcMm", "Semiarco traseiro da cintura", "hip", "mm", 90, 450, 5, "Medida de uma lateral ao centro das costas da cintura."),
  item("hipFrontArcMm", "Semiarco frontal do quadril", "hip", "mm", 125, 500, 5, "Medida de uma lateral ao centro da frente do quadril/assento."),
  item("hipBackArcMm", "Semiarco traseiro do quadril", "hip", "mm", 125, 500, 5, "Medida de uma lateral ao centro das costas do quadril/assento."),
  item("thighMm", "Coxa", "leg", "mm", 280, 1100, 5, "Circunferência da parte superior da coxa."),
  item("kneeCircumferenceMm", "Joelho", "leg", "mm", 220, 800, 5, "Circunferência do joelho."),
  item("calfMm", "Panturrilha", "leg", "mm", 180, 750, 5, "Circunferência da panturrilha."),
  item("ankleCircumferenceMm", "Tornozelo", "leg", "mm", 120, 500, 5, "Circunferência do tornozelo."),
  item("kneeHeightMm", "Altura do joelho", "leg", "mm", 250, 800, 5, "Gancho ao joelho pela parte interna."),
  item("outseamLengthMm", "Comprimento lateral da perna", "leg", "mm", 600, 1500, 5, "Cintura ao chão pela lateral."),
  item("insideLegLengthMm", "Comprimento interno da perna", "leg", "mm", 450, 1250, 5, "Alias derivado da entreperna."),
  item("headCircumferenceMm", "Contorno da cabeça", "other", "mm", 400, 750, 5, "Circunferência máxima da cabeça."),
] as const;

const CATALOG_BY_KEY = new Map(BODY_MEASUREMENT_CATALOG.map((entry) => [entry.key, entry]));

const COMMON_FORMULAS: readonly DefaultFormula[] = [
  formula("neckWidthMm", "neckCircumferenceMm / 5", "derived"),
  formula("shoulderLengthMm", "max(70mm, shoulderWidthMm / 2 - neckWidthMm / 2)", "derived"),
  formula("bustHeightMm", "torsoLengthMm * 0.60", "estimated"),
  formula("bustSpanMm", "bustMm * 0.20", "estimated"),
  formula("highBustMm", "bustMm * 0.93", "estimated"),
  formula("frontWaistLengthMm", "torsoLengthMm * 1.02", "estimated"),
  formula("backWaistLengthMm", "torsoLengthMm * 0.98", "estimated"),
  formula("armholeDepthMm", "bustMm / 6 + 70mm", "estimated"),
  formula("backWidthMm", "bustMm * 0.38", "estimated"),
  formula("frontWidthMm", "bustMm * 0.36", "estimated"),
  formula("elbowCircumferenceMm", "bicepMm * 0.85", "estimated"),
  formula("elbowLengthMm", "armLengthMm * 0.53", "derived"),
  formula("hipHeightMm", "heightMm * 0.115", "estimated"),
  formula("sittingCrotchHeightMm", "heightMm * 0.155", "estimated"),
  formula("crotchDepthMm", "hipMm * 0.245", "estimated"),
  formula("seatDepthMm", "hipMm * 0.24", "estimated"),
  formula("waistDropMm", "hipHeightMm * 0.08", "estimated"),
  formula("waistFrontArcMm", "waistMm * 0.24", "estimated"),
  formula("waistBackArcMm", "waistMm / 2 - waistFrontArcMm", "derived"),
  formula("hipFrontArcMm", "hipMm * 0.24", "estimated"),
  formula("hipBackArcMm", "hipMm / 2 - hipFrontArcMm", "derived"),
  formula("kneeCircumferenceMm", "hipMm * 0.40", "estimated"),
  formula("ankleCircumferenceMm", "hipMm * 0.24", "estimated"),
  formula("kneeHeightMm", "inseamMm * 0.52", "derived"),
  formula("outseamLengthMm", "inseamMm + sittingCrotchHeightMm", "derived"),
  formula("insideLegLengthMm", "inseamMm", "derived"),
  formula("headCircumferenceMm", "heightMm * 0.335", "estimated"),
];

const FORMULAS_BY_BODY: Record<BodyType, readonly DefaultFormula[]> = {
  feminine: [
    formula("shoulderWidthMm", "heightMm * 0.238", "estimated"),
    formula("torsoLengthMm", "heightMm * 0.262", "estimated"),
    formula("armLengthMm", "heightMm * 0.35", "estimated"),
    formula("inseamMm", "heightMm * 0.465", "estimated"),
    formula("neckCircumferenceMm", "bustMm * 0.39", "estimated"),
    formula("shoulderSlopeDeg", "14deg", "estimated"),
    formula("bicepMm", "bustMm * 0.33", "estimated"),
    formula("wristMm", "bustMm * 0.18", "estimated"),
    formula("thighMm", "hipMm * 0.58", "estimated"),
    formula("calfMm", "hipMm * 0.38", "estimated"),
    ...COMMON_FORMULAS,
  ],
  masculine: [
    formula("shoulderWidthMm", "heightMm * 0.258", "estimated"),
    formula("torsoLengthMm", "heightMm * 0.267", "estimated"),
    formula("armLengthMm", "heightMm * 0.354", "estimated"),
    formula("inseamMm", "heightMm * 0.466", "estimated"),
    formula("neckCircumferenceMm", "bustMm * 0.41", "estimated"),
    formula("shoulderSlopeDeg", "12deg", "estimated"),
    formula("bicepMm", "bustMm * 0.34", "estimated"),
    formula("wristMm", "bustMm * 0.19", "estimated"),
    formula("thighMm", "hipMm * 0.60", "estimated"),
    formula("calfMm", "hipMm * 0.40", "estimated"),
    ...COMMON_FORMULAS,
  ],
};

export function createDefaultMeasurementProfile(bodyType: BodyType): MeasurementProfile {
  const measurements: BodyMeasurements = bodyType === "feminine"
    ? { heightMm: 1680, bustMm: 920, waistMm: 760, hipMm: 1000, shoulderWidthMm: 400, torsoLengthMm: 440, armLengthMm: 590, inseamMm: 780 }
    : { heightMm: 1780, bustMm: 1000, waistMm: 850, hipMm: 980, shoulderWidthMm: 460, torsoLengthMm: 475, armLengthMm: 630, inseamMm: 830 };
  let profile = createMeasurementProfile(measurements, bodyType);
  for (const key of ["shoulderWidthMm", "torsoLengthMm", "armLengthMm", "inseamMm"] as const) {
    profile = resetMeasurementOverride(profile, key).profile;
  }
  return profile;
}

export function createMeasurementProfile(
  measurements: BodyMeasurements,
  bodyType: BodyType,
  existing?: MeasurementProfile,
): MeasurementProfile {
  const defaults = new Map(FORMULAS_BY_BODY[bodyType].map((definition) => [definition.key, definition]));
  const entries: MeasurementProfile["entries"] = {};

  for (const catalog of BODY_MEASUREMENT_CATALOG) {
    const previous = existing?.entries[catalog.key];
    const rawValue = measurements[catalog.key];
    const defaultFormula = defaults.get(catalog.key);
    if (previous && isValidEntry(previous, catalog.key)) {
      entries[catalog.key] = {
        ...structuredClone(previous),
        key: catalog.key,
        unit: catalog.unit,
      };
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
      entries[catalog.key] = {
        key: catalog.key,
        value: rawValue,
        unit: catalog.unit,
        origin: "supplied",
        ...(defaultFormula
          ? {
              defaultOrigin: defaultFormula.origin,
              formula: defaultFormula.expression,
              formulaVersion: BODY_FORMULA_SET_VERSION,
              dependencies: parseFormula(defaultFormula.expression).dependencies,
            }
          : { dependencies: [] }),
        overridden: Boolean(defaultFormula),
      };
      continue;
    }
    if (defaultFormula) {
      entries[catalog.key] = {
        key: catalog.key,
        value: 0,
        unit: catalog.unit,
        origin: defaultFormula.origin,
        defaultOrigin: defaultFormula.origin,
        formula: defaultFormula.expression,
        formulaVersion: BODY_FORMULA_SET_VERSION,
        dependencies: parseFormula(defaultFormula.expression).dependencies,
        overridden: false,
      };
    }
  }

  const profile: MeasurementProfile = {
    schemaVersion: MEASUREMENT_PROFILE_VERSION,
    formulaSetId: BODY_FORMULA_SET_ID,
    formulaSetVersion: existing?.formulaSetVersion ?? BODY_FORMULA_SET_VERSION,
    bodyType,
    entries,
  };
  return recomputeMeasurementProfile(profile).profile;
}

export function changeMeasurementBodyType(profile: MeasurementProfile, bodyType: BodyType): MeasurementProfile {
  const defaults = new Map(FORMULAS_BY_BODY[bodyType].map((definition) => [definition.key, definition]));
  const entries = structuredClone(profile.entries);
  for (const catalog of BODY_MEASUREMENT_CATALOG) {
    const entry = entries[catalog.key];
    const nextDefault = defaults.get(catalog.key);
    if (!entry || entry.origin === "supplied") continue;
    if (!nextDefault) continue;
    entries[catalog.key] = {
      ...entry,
      origin: nextDefault.origin,
      defaultOrigin: nextDefault.origin,
      formula: nextDefault.expression,
      formulaVersion: BODY_FORMULA_SET_VERSION,
      dependencies: parseFormula(nextDefault.expression).dependencies,
      overridden: false,
      error: undefined,
    };
  }
  return recomputeMeasurementProfile({
    ...profile,
    bodyType,
    formulaSetVersion: BODY_FORMULA_SET_VERSION,
    entries,
  }).profile;
}

export function overrideMeasurement(
  profile: MeasurementProfile,
  key: BodyMeasurementKey,
  value: number,
): MeasurementFormulaUpdateResult {
  const catalog = requireCatalog(key);
  if (!Number.isFinite(value) || value <= 0 || value < catalog.minimum || value > catalog.maximum) {
    return failure(profile, `O valor de ${catalog.label} está fora do intervalo permitido.`);
  }
  const entries = structuredClone(profile.entries);
  const current = entries[key];
  entries[key] = {
    key,
    value,
    unit: catalog.unit,
    origin: "supplied",
    ...(current?.formula ? { formula: current.formula } : {}),
    ...(current?.formulaVersion ? { formulaVersion: current.formulaVersion } : {}),
    ...(current?.defaultOrigin ? { defaultOrigin: current.defaultOrigin } : {}),
    dependencies: current?.dependencies ?? [],
    overridden: Boolean(current?.formula),
  };
  return recomputeMeasurementProfile({ ...profile, entries });
}

export function resetMeasurementOverride(
  profile: MeasurementProfile,
  key: BodyMeasurementKey,
): MeasurementFormulaUpdateResult {
  const entry = profile.entries[key];
  if (!entry?.formula || !entry.defaultOrigin) return failure(profile, "Esta medida não possui uma estimativa para restaurar.");
  const entries = structuredClone(profile.entries);
  entries[key] = {
    ...entry,
    origin: entry.defaultOrigin,
    overridden: false,
    error: undefined,
  };
  return recomputeMeasurementProfile({ ...profile, entries });
}

export function updateMeasurementFormula(
  profile: MeasurementProfile,
  key: BodyMeasurementKey,
  expression: string,
): MeasurementFormulaUpdateResult {
  const entry = profile.entries[key];
  if (!entry?.defaultOrigin) return failure(profile, "Medidas diretas não aceitam fórmula de estimativa.");
  let dependencies: string[];
  try {
    dependencies = parseFormula(expression).dependencies;
  } catch (error) {
    return failure(profile, readableFormulaError(error));
  }
  const entries = structuredClone(profile.entries);
  entries[key] = {
    ...entry,
    formula: expression.trim(),
    formulaVersion: "custom-1",
    dependencies,
    origin: entry.overridden ? "supplied" : entry.defaultOrigin,
    error: undefined,
  };
  const validationEntries = structuredClone(entries);
  validationEntries[key] = {
    ...validationEntries[key]!,
    origin: entry.defaultOrigin,
    overridden: false,
  };
  const validation = recomputeMeasurementProfile({ ...profile, entries: validationEntries });
  const targetError = validation.profile.entries[key]?.error;
  if (targetError || validation.error) return failure(profile, targetError ?? validation.error!);
  return entry.overridden
    ? recomputeMeasurementProfile({ ...profile, entries })
    : validation;
}

export function recomputeMeasurementProfile(profile: MeasurementProfile): MeasurementFormulaUpdateResult {
  const definitions: FormulaDefinition[] = [];
  const inputs: Record<string, ReturnType<typeof formulaQuantity>> = {};
  for (const catalog of BODY_MEASUREMENT_CATALOG) {
    const entry = profile.entries[catalog.key];
    if (!entry) continue;
    if (entry.origin === "supplied" || !entry.formula) {
      inputs[catalog.key] = formulaQuantity(entry.value, unitForCatalog(catalog));
    } else {
      definitions.push({
        id: catalog.key,
        expression: entry.formula,
        unit: unitForCatalog(catalog),
        formulaVersion: entry.formulaVersion,
      });
    }
  }
  const engine = new FormulaGraphEngine(definitions, inputs);
  const evaluation = engine.evaluateAll();
  const entries = structuredClone(profile.entries);
  for (const definition of definitions) {
    const entry = entries[definition.id as BodyMeasurementKey];
    if (!entry) continue;
    const value = evaluation.values[definition.id];
    const error = evaluation.errors[definition.id];
    entries[definition.id as BodyMeasurementKey] = {
      ...entry,
      ...(value ? { value: value.value } : {}),
      ...(error ? { error: error.message } : { error: undefined }),
    };
  }
  const nextProfile = { ...profile, entries };
  const firstError = Object.values(evaluation.errors)[0];
  return {
    accepted: !firstError,
    profile: nextProfile,
    measurements: measurementProfileToBodyMeasurements(nextProfile),
    ...(firstError ? { error: firstError.message } : {}),
    recomputed: evaluation.recomputed as BodyMeasurementKey[],
  };
}

export function measurementProfileToBodyMeasurements(profile: MeasurementProfile): BodyMeasurements {
  const values: Partial<Record<BodyMeasurementKey, number>> = {};
  for (const catalog of BODY_MEASUREMENT_CATALOG) {
    const value = profile.entries[catalog.key]?.value;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) values[catalog.key] = value;
  }
  const required: readonly BodyMeasurementKey[] = [
    "heightMm",
    "bustMm",
    "waistMm",
    "hipMm",
    "shoulderWidthMm",
    "torsoLengthMm",
    "armLengthMm",
    "inseamMm",
  ];
  for (const key of required) {
    if (!(key in values)) throw new TypeError(`A medida obrigatória ${key} não pôde ser resolvida.`);
  }
  return values as BodyMeasurements;
}

export function measurementProfileSnapshot(profile: MeasurementProfile): {
  values: Partial<Record<BodyMeasurementKey, number>>;
  origins: Partial<Record<BodyMeasurementKey, MeasurementOrigin>>;
  defaults: Partial<Record<BodyMeasurementKey, number>>;
} {
  const resolved = recomputeMeasurementProfile(profile).profile;
  const defaultsProfile = recomputeMeasurementProfile({
    ...profile,
    entries: Object.fromEntries(
      Object.entries(profile.entries).map(([key, value]) => {
        const entry = value as MeasurementProfileEntry;
        return [
          key,
          entry.formula && entry.defaultOrigin
            ? { ...entry, origin: entry.defaultOrigin, overridden: false }
            : entry,
        ];
      }),
    ) as MeasurementProfile["entries"],
  }).profile;
  const values: Partial<Record<BodyMeasurementKey, number>> = {};
  const origins: Partial<Record<BodyMeasurementKey, MeasurementOrigin>> = {};
  const defaults: Partial<Record<BodyMeasurementKey, number>> = {};
  for (const catalog of BODY_MEASUREMENT_CATALOG) {
    const entry = resolved.entries[catalog.key];
    if (entry) {
      values[catalog.key] = entry.value;
      origins[catalog.key] = entry.origin;
    }
    const defaultEntry = defaultsProfile.entries[catalog.key];
    if (defaultEntry) defaults[catalog.key] = defaultEntry.value;
  }
  return { values, origins, defaults };
}

export function serializeMeasurementProfile(profile: MeasurementProfile): string {
  const entries = BODY_MEASUREMENT_CATALOG.flatMap((catalog) => {
    const entry = profile.entries[catalog.key];
    return entry ? [entry] : [];
  });
  return `${JSON.stringify({
    schemaVersion: 1,
    formulaSetId: BODY_FORMULA_SET_ID,
    formulaSetVersion: profile.formulaSetVersion,
    bodyType: profile.bodyType,
    entries,
  }, null, 2)}\n`;
}

export function parseMeasurementProfile(value: unknown): MeasurementProfile {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.formulaSetId !== BODY_FORMULA_SET_ID) {
    throw new TypeError("O perfil de medidas paramétricas é inválido.");
  }
  if (value.bodyType !== "feminine" && value.bodyType !== "masculine") {
    throw new TypeError("O tipo corporal do perfil de medidas é inválido.");
  }
  const rawEntries = Array.isArray(value.entries)
    ? value.entries
    : isRecord(value.entries)
      ? Object.values(value.entries)
      : undefined;
  if (!rawEntries) throw new TypeError("As entradas do perfil de medidas são inválidas.");
  const entries: MeasurementProfile["entries"] = {};
  for (const candidate of rawEntries) {
    if (!isRecord(candidate) || typeof candidate.key !== "string") throw new TypeError("Uma entrada de medida é inválida.");
    const catalog = CATALOG_BY_KEY.get(candidate.key as BodyMeasurementKey);
    if (!catalog) throw new TypeError(`A medida ${candidate.key} não é reconhecida.`);
    const valueNumber = readFinite(candidate.value, `O valor de ${catalog.label}`);
    const origin = readOrigin(candidate.origin);
    const formulaText = candidate.formula === undefined ? undefined : readString(candidate.formula, "A fórmula da medida");
    const dependencies = Array.isArray(candidate.dependencies)
      ? candidate.dependencies.map((dependency) => readString(dependency, "A dependência da medida"))
      : formulaText
        ? parseFormula(formulaText).dependencies
        : [];
    entries[catalog.key] = {
      key: catalog.key,
      value: valueNumber,
      unit: catalog.unit,
      origin,
      ...(candidate.defaultOrigin === "estimated" || candidate.defaultOrigin === "derived"
        ? { defaultOrigin: candidate.defaultOrigin }
        : {}),
      ...(formulaText ? { formula: formulaText } : {}),
      ...(candidate.formulaVersion === undefined ? {} : { formulaVersion: readString(candidate.formulaVersion, "A versão da fórmula") }),
      dependencies,
      overridden: candidate.overridden === true,
      ...(candidate.error === undefined ? {} : { error: readString(candidate.error, "O erro da medida") }),
    };
  }
  return {
    schemaVersion: 1,
    formulaSetId: BODY_FORMULA_SET_ID,
    formulaSetVersion: readString(value.formulaSetVersion, "A versão do conjunto de fórmulas"),
    bodyType: value.bodyType,
    entries,
  };
}

export function parseParametricProjectMetadata(value: unknown): ParametricProjectMetadata {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.variables) || !isRecord(value.constructionGraph) || !Array.isArray(value.generations)) {
    throw new TypeError("Os metadados paramétricos do projeto são inválidos.");
  }
  const graph = value.constructionGraph;
  if ((graph.version !== 1 && graph.version !== 2) || !Array.isArray(graph.nodes)) {
    throw new TypeError("O grafo paramétrico do projeto é inválido.");
  }
  return structuredClone(value) as unknown as ParametricProjectMetadata;
}

export function catalogEntry(key: BodyMeasurementKey): MeasurementCatalogEntry {
  return requireCatalog(key);
}

function failure(profile: MeasurementProfile, error: string): MeasurementFormulaUpdateResult {
  return {
    accepted: false,
    profile,
    measurements: measurementProfileToBodyMeasurements(profile),
    error,
    recomputed: [],
  };
}

function item(
  key: BodyMeasurementKey,
  label: string,
  group: MeasurementCatalogEntry["group"],
  unit: MeasurementCatalogEntry["unit"],
  minimum: number,
  maximum: number,
  step: number,
  description: string,
  essential = false,
): MeasurementCatalogEntry {
  return { key, label, group, unit, minimum, maximum, step, description, essential };
}

function formula(key: BodyMeasurementKey, expression: string, origin: DefaultFormula["origin"]): DefaultFormula {
  return { key, expression, origin };
}

function requireCatalog(key: BodyMeasurementKey): MeasurementCatalogEntry {
  const catalog = CATALOG_BY_KEY.get(key);
  if (!catalog) throw new RangeError(`A medida ${String(key)} não existe no catálogo.`);
  return catalog;
}

function unitForCatalog(catalog: MeasurementCatalogEntry): FormulaUnit {
  return catalog.unit === "degree" ? "degree" : "mm";
}

function isValidEntry(entry: MeasurementProfileEntry, key: BodyMeasurementKey): boolean {
  return entry.key === key && Number.isFinite(entry.value) && entry.value >= 0;
}

function readableFormulaError(error: unknown): string {
  return error instanceof FormulaError ? error.message : error instanceof Error ? error.message : "A fórmula é inválida.";
}

function readOrigin(value: unknown): MeasurementOrigin {
  if (value === "supplied" || value === "estimated" || value === "derived") return value;
  throw new TypeError("A origem da medida é inválida.");
}

function readFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} precisa ser numérico.`);
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} precisa ser texto.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
