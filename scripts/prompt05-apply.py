from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    file.write_text(source.replace(old, new), encoding="utf-8")


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    start_index = source.find(start)
    end_index = source.find(end, start_index)
    if start_index < 0 or end_index < 0:
        raise SystemExit(f"{path}: boundaries not found: {start!r} / {end!r}")
    file.write_text(source[:start_index] + replacement + source[end_index:], encoding="utf-8")


# pattern.ts: expanded runtime-compatible measurements and optional parametric metadata.
replace_once(
    "apps/web/src/domain/pattern.ts",
    'import {\n  createDefaultFabricSource,\n  parseFabricSources,\n  type FabricSource,\n} from "./fabric";\n',
    'import {\n  createDefaultFabricSource,\n  parseFabricSources,\n  type FabricSource,\n} from "./fabric";\nimport {\n  parseMeasurementProfile,\n  parseParametricProjectMetadata,\n  type MeasurementProfile,\n  type ParametricProjectMetadata,\n} from "./parametricMeasurements";\n',
)
replace_once(
    "apps/web/src/domain/pattern.ts",
    '''export interface BodyMeasurements {
  heightMm: number;
  bustMm: number;
  waistMm: number;
  hipMm: number;
  shoulderWidthMm: number;
  torsoLengthMm: number;
  armLengthMm: number;
  inseamMm: number;
  bicepMm?: number;
  wristMm?: number;
  thighMm?: number;
  calfMm?: number;
}
''',
    '''export interface BodyMeasurements {
  heightMm: number;
  bustMm: number;
  waistMm: number;
  hipMm: number;
  shoulderWidthMm: number;
  torsoLengthMm: number;
  armLengthMm: number;
  inseamMm: number;
  neckCircumferenceMm?: number;
  neckWidthMm?: number;
  shoulderSlopeDeg?: number;
  shoulderLengthMm?: number;
  bustHeightMm?: number;
  bustSpanMm?: number;
  highBustMm?: number;
  frontWaistLengthMm?: number;
  backWaistLengthMm?: number;
  armholeDepthMm?: number;
  backWidthMm?: number;
  frontWidthMm?: number;
  bicepMm?: number;
  elbowCircumferenceMm?: number;
  wristMm?: number;
  elbowLengthMm?: number;
  hipHeightMm?: number;
  sittingCrotchHeightMm?: number;
  crotchDepthMm?: number;
  thighMm?: number;
  kneeCircumferenceMm?: number;
  calfMm?: number;
  ankleCircumferenceMm?: number;
  kneeHeightMm?: number;
  outseamLengthMm?: number;
  insideLegLengthMm?: number;
  seatDepthMm?: number;
  waistDropMm?: number;
  headCircumferenceMm?: number;
}
''',
)
replace_once(
    "apps/web/src/domain/pattern.ts",
    '''  assemblyPlacements?: AssemblyPlacement[];
  ease?: GarmentEase;
}
''',
    '''  assemblyPlacements?: AssemblyPlacement[];
  ease?: GarmentEase;
  measurementProfile?: MeasurementProfile;
  parametric?: ParametricProjectMetadata;
}
''',
)
replace_between(
    "apps/web/src/domain/pattern.ts",
    "export function parseBodyMeasurements(value: unknown): BodyMeasurements {",
    "export function parseGarmentDraft(value: unknown): GarmentDraft {",
    '''export function parseBodyMeasurements(value: unknown): BodyMeasurements {
  if (!isRecord(value)) {
    throw new TypeError("As medidas corporais precisam ser um objeto.");
  }

  const heightMm = readFiniteNumber(value.heightMm, "A altura");
  const bustMm = readFiniteNumber(value.bustMm, "A medida de busto ou tórax");
  const waistMm = readFiniteNumber(value.waistMm, "A medida de cintura");
  const hipMm = readFiniteNumber(value.hipMm, "A medida de quadril");
  const measurements: BodyMeasurements = {
    heightMm,
    bustMm,
    waistMm,
    hipMm,
    shoulderWidthMm: readOptionalPositiveNumber(value.shoulderWidthMm, heightMm * 0.238, "A largura de ombros"),
    torsoLengthMm: readOptionalPositiveNumber(value.torsoLengthMm, heightMm * 0.262, "O comprimento do tronco"),
    armLengthMm: readOptionalPositiveNumber(value.armLengthMm, heightMm * 0.35, "O comprimento do braço"),
    inseamMm: readOptionalPositiveNumber(value.inseamMm, heightMm * 0.465, "A medida de entreperna"),
  };
  const optionalKeys: readonly (keyof BodyMeasurements)[] = [
    "neckCircumferenceMm", "neckWidthMm", "shoulderSlopeDeg", "shoulderLengthMm",
    "bustHeightMm", "bustSpanMm", "highBustMm", "frontWaistLengthMm", "backWaistLengthMm",
    "armholeDepthMm", "backWidthMm", "frontWidthMm", "bicepMm", "elbowCircumferenceMm",
    "wristMm", "elbowLengthMm", "hipHeightMm", "sittingCrotchHeightMm", "crotchDepthMm",
    "thighMm", "kneeCircumferenceMm", "calfMm", "ankleCircumferenceMm", "kneeHeightMm",
    "outseamLengthMm", "insideLegLengthMm", "seatDepthMm", "waistDropMm", "headCircumferenceMm",
  ];
  for (const key of optionalKeys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    const parsed = readFiniteNumber(candidate, `A medida ${key}`);
    if (parsed < 0 || (parsed === 0 && key !== "shoulderSlopeDeg" && key !== "waistDropMm")) {
      throw new TypeError(`A medida ${key} precisa ser positiva.`);
    }
    measurements[key] = parsed;
  }
  if (Object.values(measurements).some((measurement) => measurement < 0)) {
    throw new TypeError("As medidas corporais não podem ser negativas.");
  }
  return measurements;
}

''',
)
replace_once(
    "apps/web/src/domain/pattern.ts",
    '''  const assemblyPlacements = parseAssemblyPlacements(value.assemblyPlacements, pieceIds);
  const ease = parseGarmentEase(value.ease);

  return {
''',
    '''  const assemblyPlacements = parseAssemblyPlacements(value.assemblyPlacements, pieceIds);
  const ease = parseGarmentEase(value.ease);
  const measurementProfile = value.measurementProfile === undefined
    ? undefined
    : parseMeasurementProfile(value.measurementProfile);
  const parametric = value.parametric === undefined
    ? undefined
    : parseParametricProjectMetadata(value.parametric);

  return {
''',
)
replace_once(
    "apps/web/src/domain/pattern.ts",
    '''    ...(assemblyPlacements === undefined ? {} : { assemblyPlacements }),
    ...(ease === undefined ? {} : { ease }),
  };
}
''',
    '''    ...(assemblyPlacements === undefined ? {} : { assemblyPlacements }),
    ...(ease === undefined ? {} : { ease }),
    ...(measurementProfile === undefined ? {} : { measurementProfile }),
    ...(parametric === undefined ? {} : { parametric }),
  };
}
''',
)

# anatomical body now consumes the same versioned measurement profile as the editor.
replace_once(
    "apps/web/src/domain/anatomicalBody.ts",
    'import type { BodyMeasurements, BodyType } from "./pattern";\n',
    'import type { BodyMeasurements, BodyType } from "./pattern";\nimport { createMeasurementProfile, measurementProfileToBodyMeasurements } from "./parametricMeasurements";\n',
)
replace_once(
    "apps/web/src/domain/anatomicalBody.ts",
    '''export function deriveAnatomicalMeasurements(input: BodyMeasurements): AnatomicalMeasurements {
  return {
    ...input,
    bicepMm: positiveOr(input.bicepMm, input.bustMm * 0.33),
    wristMm: positiveOr(input.wristMm, input.bustMm * 0.18),
    thighMm: positiveOr(input.thighMm, input.hipMm * 0.58),
    calfMm: positiveOr(input.calfMm, input.hipMm * 0.38),
  };
}
''',
    '''export function deriveAnatomicalMeasurements(input: BodyMeasurements): AnatomicalMeasurements {
  const resolved = measurementProfileToBodyMeasurements(createMeasurementProfile(input, "feminine"));
  return {
    ...resolved,
    bicepMm: positiveOr(resolved.bicepMm, input.bustMm * 0.33),
    wristMm: positiveOr(resolved.wristMm, input.bustMm * 0.18),
    thighMm: positiveOr(resolved.thighMm, input.hipMm * 0.58),
    calfMm: positiveOr(resolved.calfMm, input.hipMm * 0.38),
  };
}
''',
)

# Store actions preserve provenance and reject invalid formulas atomically.
replace_once(
    "apps/web/src/state/editorStore.ts",
    'import { updateDart as updatePatternDart } from "../domain/patternOperations";\n',
    'import { updateDart as updatePatternDart } from "../domain/patternOperations";\nimport {\n  changeMeasurementBodyType,\n  createMeasurementProfile,\n  overrideMeasurement,\n  resetMeasurementOverride,\n  updateMeasurementFormula,\n  type BodyMeasurementKey,\n  type MeasurementFormulaUpdateResult,\n} from "../domain/parametricMeasurements";\n',
)
replace_once(
    "apps/web/src/state/editorStore.ts",
    '''  setBodyType(bodyType: BodyType): void;
  setBodyMeasurement(measurement: keyof BodyMeasurements, valueMm: number): void;
''',
    '''  setBodyType(bodyType: BodyType): void;
  setBodyMeasurement(measurement: BodyMeasurementKey, value: number): void;
  resetBodyMeasurement(measurement: BodyMeasurementKey): void;
  setBodyMeasurementFormula(measurement: BodyMeasurementKey, expression: string): MeasurementFormulaUpdateResult;
''',
)
replace_once(
    "apps/web/src/state/editorStore.ts",
    '''  setBodyType: (bodyType) => changeDocument(set, get, "metadata", "Alterar corpo", (document) => ({
    ...document,
    garment: { ...document.garment, bodyType },
  })),
  setBodyMeasurement: (measurement, valueMm) => {
    if (!Number.isFinite(valueMm) || valueMm <= 0) return;
    changeDocument(set, get, "measurement", "Alterar medida corporal", (document) => ({
      ...document,
      garment: {
        ...document.garment,
        measurements: { ...document.garment.measurements, [measurement]: valueMm },
      },
    }));
  },
''',
    '''  setBodyType: (bodyType) => changeDocument(set, get, "metadata", "Alterar corpo", (document) => {
    const current = createMeasurementProfile(document.garment.measurements, document.garment.bodyType, document.garment.measurementProfile);
    const profile = changeMeasurementBodyType(current, bodyType);
    return {
      ...document,
      garment: {
        ...document.garment,
        bodyType,
        measurementProfile: profile,
        measurements: Object.fromEntries(Object.entries(profile.entries).map(([key, entry]) => [key, entry?.value])) as BodyMeasurements,
      },
    };
  }),
  setBodyMeasurement: (measurement, value) => {
    const garment = get().garment;
    const profile = createMeasurementProfile(garment.measurements, garment.bodyType, garment.measurementProfile);
    const result = overrideMeasurement(profile, measurement, value);
    if (!result.accepted) return;
    changeDocument(set, get, "measurement", "Alterar medida corporal", (document) => ({
      ...document,
      garment: {
        ...document.garment,
        measurements: result.measurements,
        measurementProfile: result.profile,
      },
    }));
  },
  resetBodyMeasurement: (measurement) => {
    const garment = get().garment;
    const profile = createMeasurementProfile(garment.measurements, garment.bodyType, garment.measurementProfile);
    const result = resetMeasurementOverride(profile, measurement);
    if (!result.accepted) return;
    changeDocument(set, get, "measurement", "Restaurar medida estimada", (document) => ({
      ...document,
      garment: { ...document.garment, measurements: result.measurements, measurementProfile: result.profile },
    }));
  },
  setBodyMeasurementFormula: (measurement, expression) => {
    const garment = get().garment;
    const profile = createMeasurementProfile(garment.measurements, garment.bodyType, garment.measurementProfile);
    const result = updateMeasurementFormula(profile, measurement, expression);
    if (!result.accepted) return result;
    changeDocument(set, get, "measurement", "Alterar fórmula de medida", (document) => ({
      ...document,
      garment: { ...document.garment, measurements: result.measurements, measurementProfile: result.profile },
    }));
    return result;
  },
''',
)

# Inspector and fitting dialog pass the canonical profile and advanced actions.
replace_once(
    "apps/web/src/components/Inspector.tsx",
    '''  const setBodyMeasurement = useEditorStore((state) => state.setBodyMeasurement);
''',
    '''  const setBodyMeasurement = useEditorStore((state) => state.setBodyMeasurement);
  const resetBodyMeasurement = useEditorStore((state) => state.resetBodyMeasurement);
  const setBodyMeasurementFormula = useEditorStore((state) => state.setBodyMeasurementFormula);
''',
)
replace_once(
    "apps/web/src/components/Inspector.tsx",
    '''            bodyType={garment.bodyType}
            measurements={garment.measurements}
            onBodyTypeChange={setBodyType}
            onMeasurementChange={setBodyMeasurement}
''',
    '''            bodyType={garment.bodyType}
            measurements={garment.measurements}
            measurementProfile={garment.measurementProfile}
            onBodyTypeChange={setBodyType}
            onMeasurementChange={setBodyMeasurement}
            onResetMeasurement={resetBodyMeasurement}
            onFormulaChange={setBodyMeasurementFormula}
''',
)
replace_once(
    "apps/web/src/components/FittingRoomDialog.tsx",
    '''  const setBodyMeasurement = useEditorStore(
    (state) => state.setBodyMeasurement,
  );
''',
    '''  const setBodyMeasurement = useEditorStore(
    (state) => state.setBodyMeasurement,
  );
  const resetBodyMeasurement = useEditorStore((state) => state.resetBodyMeasurement);
  const setBodyMeasurementFormula = useEditorStore((state) => state.setBodyMeasurementFormula);
''',
)
replace_once(
    "apps/web/src/components/FittingRoomDialog.tsx",
    '''                bodyType={garment.bodyType}
                measurements={garment.measurements}
                onBodyTypeChange={setBodyType}
                onMeasurementChange={setBodyMeasurement}
''',
    '''                bodyType={garment.bodyType}
                measurements={garment.measurements}
                measurementProfile={garment.measurementProfile}
                onBodyTypeChange={setBodyType}
                onMeasurementChange={setBodyMeasurement}
                onResetMeasurement={resetBodyMeasurement}
                onFormulaChange={setBodyMeasurementFormula}
''',
)

# Template library owns a profile instead of silently materialising estimates as supplied values.
replace_once(
    "apps/web/src/components/PatternLibraryDialog.tsx",
    'import { memo, useEffect, useState } from "react";\nimport type {\n  BodyMeasurements,\n  BodyType,\n  GarmentDraft,\n} from "../domain/pattern";\n',
    'import { memo, useEffect, useMemo, useState } from "react";\nimport type { GarmentDraft } from "../domain/pattern";\nimport {\n  changeMeasurementBodyType,\n  createDefaultMeasurementProfile,\n  measurementProfileToBodyMeasurements,\n  overrideMeasurement,\n  resetMeasurementOverride,\n  updateMeasurementFormula,\n} from "../domain/parametricMeasurements";\n',
)
replace_once(
    "apps/web/src/components/PatternLibraryDialog.tsx",
    '''  DEFAULT_BODY_MEASUREMENTS,
  DEFAULT_MASCULINE_BODY_MEASUREMENTS,
''',
    '',
)
replace_once(
    "apps/web/src/components/PatternLibraryDialog.tsx",
    '''  const [measurements, setMeasurements] = useState<BodyMeasurements>(
    DEFAULT_BODY_MEASUREMENTS,
  );
  const [bodyType, setBodyType] = useState<BodyType>("feminine");
  const [error, setError] = useState<string | null>(null);
''',
    '''  const [profile, setProfile] = useState(() => createDefaultMeasurementProfile("feminine"));
  const measurements = useMemo(() => measurementProfileToBodyMeasurements(profile), [profile]);
  const bodyType = profile.bodyType;
  const [error, setError] = useState<string | null>(null);
''',
)
replace_once(
    "apps/web/src/components/PatternLibraryDialog.tsx",
    '''        bodyType,
      );
''',
    '''        bodyType,
        profile,
      );
''',
)
replace_once(
    "apps/web/src/components/PatternLibraryDialog.tsx",
    '''          compact
          bodyType={bodyType}
          measurements={measurements}
          onBodyTypeChange={(nextBodyType) => {
            setBodyType(nextBodyType);
            setMeasurements(
              nextBodyType === "feminine"
                ? DEFAULT_BODY_MEASUREMENTS
                : DEFAULT_MASCULINE_BODY_MEASUREMENTS,
            );
          }}
          onMeasurementChange={(measurement, valueMm) =>
            setMeasurements((current) => ({
              ...current,
              [measurement]: valueMm,
            }))
          }
''',
    '''          compact
          bodyType={bodyType}
          measurements={measurements}
          measurementProfile={profile}
          onBodyTypeChange={(nextBodyType) => setProfile((current) => changeMeasurementBodyType(current, nextBodyType))}
          onMeasurementChange={(measurement, value) => {
            const result = overrideMeasurement(profile, measurement, value);
            if (result.accepted) setProfile(result.profile);
          }}
          onResetMeasurement={(measurement) => {
            const result = resetMeasurementOverride(profile, measurement);
            if (result.accepted) setProfile(result.profile);
          }}
          onFormulaChange={(measurement, expression) => {
            const result = updateMeasurementFormula(profile, measurement, expression);
            if (result.accepted) setProfile(result.profile);
            return result;
          }}
''',
)

# Template generation is versioned and stores the exact measurements/defaults used.
replace_once(
    "apps/web/src/patterns/templateCatalog.ts",
    'import { closeDart, createDart } from "../domain/patternOperations";\n',
    'import { closeDart, createDart } from "../domain/patternOperations";\nimport { createInitialConstructionGraph } from "../domain/constructionGraph";\nimport {\n  BODY_MEASUREMENT_CATALOG,\n  createMeasurementProfile,\n  measurementProfileSnapshot,\n  measurementProfileToBodyMeasurements,\n  type MeasurementProfile,\n} from "../domain/parametricMeasurements";\n',
)
replace_once(
    "apps/web/src/patterns/templateCatalog.ts",
    '''  estimatedMeasurements: string[];
}
''',
    '''  estimatedMeasurements: string[];
  formulaVersion: string;
}
''',
)
replace_once(
    "apps/web/src/patterns/templateCatalog.ts",
    '''export const DEFAULT_MASCULINE_BODY_MEASUREMENTS: BodyMeasurements = {
''',
    '''export const TEMPLATE_FORMULA_VERSIONS: Record<PatternTemplateId, string> = {
  tshirt: "tshirt@1",
  blouse: "blouse@1",
  "straight-skirt": "straight-skirt@1",
  "mini-skirt": "mini-skirt@1",
  "straight-pants": "straight-pants@1",
  "basic-jacket": "basic-jacket@1",
};

export const DEFAULT_MASCULINE_BODY_MEASUREMENTS: BodyMeasurements = {
''',
)
# Add formulaVersion to all six summaries after status lines.
for status in ['status: "ready",', 'status: "development",']:
    pass
source_path = Path("apps/web/src/patterns/templateCatalog.ts")
source = source_path.read_text(encoding="utf-8")
for template_id in ["tshirt", "blouse", "straight-skirt", "mini-skirt", "straight-pants", "basic-jacket"]:
    marker = f'    id: "{template_id}",'
    start = source.index(marker)
    status_pos = source.index('    status: ', start)
    line_end = source.index('\n', status_pos) + 1
    insertion = f'    formulaVersion: TEMPLATE_FORMULA_VERSIONS["{template_id}"],\n'
    if insertion not in source[start:line_end + len(insertion)]:
        source = source[:line_end] + insertion + source[line_end:]
source_path.write_text(source, encoding="utf-8")
replace_once(
    "apps/web/src/patterns/templateCatalog.ts",
    '''export function createGarmentFromTemplate(
  templateId: PatternTemplateId,
  inputMeasurements: BodyMeasurements,
  bodyType: BodyType = "feminine",
): GarmentDraft {
  const measurements = validateMeasurements(inputMeasurements);
''',
    '''export function createGarmentFromTemplate(
  templateId: PatternTemplateId,
  inputMeasurements: BodyMeasurements,
  bodyType: BodyType = "feminine",
  inputProfile?: MeasurementProfile,
): GarmentDraft {
  const profile = createMeasurementProfile(inputMeasurements, bodyType, inputProfile);
  const measurements = validateMeasurements(measurementProfileToBodyMeasurements(profile));
''',
)
replace_once(
    "apps/web/src/patterns/templateCatalog.ts",
    '''  const pieces = generator(measurements).map((piece) => ({
    ...piece,
    fabricId: fabric.id,
  }));
  return {
''',
    '''  const pieces = generator(measurements).map((piece) => ({
    ...piece,
    fabricId: fabric.id,
  }));
  const snapshot = measurementProfileSnapshot(profile);
  const templateVersion = TEMPLATE_FORMULA_VERSIONS[templateId];
  return {
''',
)
replace_once(
    "apps/web/src/patterns/templateCatalog.ts",
    '''    measurements: { ...measurements },
    fabrics: [fabric],
''',
    '''    measurements: { ...measurements },
    measurementProfile: profile,
    parametric: {
      schemaVersion: 1,
      templateId,
      templateVersion,
      variables: [],
      constructionGraph: createInitialConstructionGraph(BODY_MEASUREMENT_CATALOG.map((entry) => entry.key)),
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
      })),
    },
    fabrics: [fabric],
''',
)

# V3 schema enrichments remain optional, so old formatVersion 3 documents stay byte-stable until explicitly edited.
replace_once(
    "apps/web/src/domain/patternDocumentV3.types.ts",
    'import type { FabricSource } from "./fabric";\n',
    'import type { FabricSource } from "./fabric";\nimport type { MeasurementProfile, PatternGenerationRecord } from "./parametricMeasurements";\n',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.types.ts",
    '''export interface MeasurementSetV3 {
  id: string;
  values: BodyMeasurements;
  estimatedKeys: string[];
  notes?: string;
}
''',
    '''export interface MeasurementSetV3 {
  id: string;
  values: BodyMeasurements;
  estimatedKeys: string[];
  suppliedKeys?: string[];
  derivedKeys?: string[];
  formulaSetVersion?: string;
  profile?: MeasurementProfile;
  notes?: string;
}
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.types.ts",
    '''  description?: string;
}

export interface ConstructionGraphV3 {
  version: 1;
''',
    '''  description?: string;
  formulaVersion?: string;
  dependencies?: string[];
}

export interface ConstructionGraphV3 {
  version: 1 | 2;
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.types.ts",
    '''  kind: "measurement" | "variable" | "free-point" | "computed-point" | "operation";
''',
    '''  kind: "measurement" | "variable" | "free-point" | "computed-point" | "line" | "arc" | "curve" | "transform" | "operation";
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.types.ts",
    '''  connectors: PatternConnectorV3[];
}
''',
    '''  connectors: PatternConnectorV3[];
  generation?: PatternGenerationRecord;
}
''',
)

# V3 adapter/parser maps optional parametric data without forcing a formula upgrade.
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    'import { parseFabricSources } from "./fabric";\n',
    'import { parseFabricSources } from "./fabric";\nimport {\n  createMeasurementProfile,\n  measurementProfileToBodyMeasurements,\n  parseMeasurementProfile,\n  parseParametricProjectMetadata,\n  type MeasurementOrigin,\n  type ParametricProjectMetadata,\n  type PatternGenerationRecord,\n} from "./parametricMeasurements";\n',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''const CONSTRUCTION_NODE_KINDS = [
  "measurement",
  "variable",
  "free-point",
  "computed-point",
  "operation",
] as const;
''',
    '''const CONSTRUCTION_NODE_KINDS = [
  "measurement",
  "variable",
  "free-point",
  "computed-point",
  "line",
  "arc",
  "curve",
  "transform",
  "operation",
] as const;
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''  const workspace = createWorkspaceState(
    garment,
    options.activePatternId,
    patternDefinitions,
  );

  return parsePatternDocumentV3({
''',
    '''  const workspace = createWorkspaceState(
    garment,
    options.activePatternId,
    patternDefinitions,
  );
  const profile = createMeasurementProfile(garment.measurements, garment.bodyType, garment.measurementProfile);
  const measurementEntries = Object.values(profile.entries).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return parsePatternDocumentV3({
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''      sourceTemplateId: garment.templateId,
      application: { name: "Moldeon" },
''',
    '''      sourceTemplateId: garment.templateId,
      ...(garment.parametric?.templateVersion ? { sourceTemplateVersion: garment.parametric.templateVersion } : {}),
      application: { name: "Moldeon" },
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''    measurements: {
      id: "measurements-primary",
      values: garment.measurements,
      estimatedKeys: [],
    },
    variables: [],
    constructionGraph: { version: 1, nodes: [] },
''',
    '''    measurements: {
      id: "measurements-primary",
      values: measurementProfileToBodyMeasurements(profile),
      estimatedKeys: measurementEntries.filter((entry) => entry.origin === "estimated").map((entry) => entry.key),
      suppliedKeys: measurementEntries.filter((entry) => entry.origin === "supplied").map((entry) => entry.key),
      derivedKeys: measurementEntries.filter((entry) => entry.origin === "derived").map((entry) => entry.key),
      formulaSetVersion: profile.formulaSetVersion,
      profile,
    },
    variables: garment.parametric?.variables ?? [],
    constructionGraph: garment.parametric?.constructionGraph ?? { version: 1, nodes: [] },
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''  return parseGarmentDraft({
    id: document.metadata.projectId,
''',
    '''  const profile = document.measurements.profile
    ? parseMeasurementProfile(document.measurements.profile)
    : createMeasurementProfile(document.measurements.values, document.body.type);
  const parametric: ParametricProjectMetadata = {
    schemaVersion: 1,
    ...(document.metadata.sourceTemplateId ? { templateId: document.metadata.sourceTemplateId } : {}),
    ...(document.metadata.sourceTemplateVersion ? { templateVersion: document.metadata.sourceTemplateVersion } : {}),
    variables: document.variables.map((variable) => ({
      ...variable,
      formulaVersion: variable.formulaVersion ?? "legacy-v3",
      dependencies: variable.dependencies ?? [],
    })),
    constructionGraph: document.constructionGraph,
    generations: document.patternDefinitions.flatMap((definition) => definition.generation ? [definition.generation] : []),
  };

  return parseGarmentDraft({
    id: document.metadata.projectId,
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''    measurements: document.measurements.values,
    fabrics: document.fabrics,
''',
    '''    measurements: measurementProfileToBodyMeasurements(profile),
    measurementProfile: profile,
    parametric,
    fabrics: document.fabrics,
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''    connectors,
  };
}
''',
    '''    connectors,
    ...(garment.parametric?.generations.find((generation) => generation.patternId === piece.id)
      ? { generation: structuredClone(garment.parametric.generations.find((generation) => generation.patternId === piece.id)!) }
      : {}),
  };
}
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''    fabricId: readString(value.fabricId, "O tecido da definição"),
    connectors,
  };
}
''',
    '''    fabricId: readString(value.fabricId, "O tecido da definição"),
    connectors,
    ...(value.generation === undefined ? {} : { generation: parsePatternGeneration(value.generation) }),
  };
}
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''function parseMeasurementSet(value: unknown): PatternDocumentV3["measurements"] {
''',
    '''function parsePatternGeneration(value: unknown): PatternGenerationRecord {
  if (!isRecord(value)) throw new TypeError("O registro de geração paramétrica é inválido.");
  const parsed = parseParametricProjectMetadata({
    schemaVersion: 1,
    variables: [],
    constructionGraph: { version: 1, nodes: [] },
    generations: [value],
  });
  return parsed.generations[0];
}

function parseMeasurementSet(value: unknown): PatternDocumentV3["measurements"] {
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''  return {
    id: readString(value.id, "O identificador das medidas"),
    values: garment.measurements,
    estimatedKeys: value.estimatedKeys.map((candidate, index) =>
      readString(candidate, `A medida estimada ${index + 1}`),
    ),
    ...(value.notes === undefined
''',
    '''  const profile = value.profile === undefined ? undefined : parseMeasurementProfile(value.profile);
  const parseKeyList = (candidate: unknown, label: string): string[] | undefined =>
    candidate === undefined
      ? undefined
      : Array.isArray(candidate)
        ? candidate.map((item, index) => readString(item, `${label} ${index + 1}`))
        : (() => { throw new TypeError(`${label} é inválida.`); })();
  return {
    id: readString(value.id, "O identificador das medidas"),
    values: profile ? measurementProfileToBodyMeasurements(profile) : garment.measurements,
    estimatedKeys: value.estimatedKeys.map((candidate, index) =>
      readString(candidate, `A medida estimada ${index + 1}`),
    ),
    ...(parseKeyList(value.suppliedKeys, "A medida informada") ? { suppliedKeys: parseKeyList(value.suppliedKeys, "A medida informada") } : {}),
    ...(parseKeyList(value.derivedKeys, "A medida derivada") ? { derivedKeys: parseKeyList(value.derivedKeys, "A medida derivada") } : {}),
    ...(value.formulaSetVersion === undefined ? {} : { formulaSetVersion: readString(value.formulaSetVersion, "A versão das fórmulas de medidas") }),
    ...(profile === undefined ? {} : { profile }),
    ...(value.notes === undefined
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''      ...(candidate.description === undefined
        ? {}
        : { description: readString(candidate.description, `A descrição da variável ${index + 1}`) }),
    };
''',
    '''      ...(candidate.description === undefined
        ? {}
        : { description: readString(candidate.description, `A descrição da variável ${index + 1}`) }),
      ...(candidate.formulaVersion === undefined
        ? {}
        : { formulaVersion: readString(candidate.formulaVersion, `A versão da variável ${index + 1}`) }),
      ...(candidate.dependencies === undefined
        ? {}
        : {
            dependencies: Array.isArray(candidate.dependencies)
              ? candidate.dependencies.map((dependency, dependencyIndex) => readString(dependency, `A dependência ${dependencyIndex + 1} da variável ${index + 1}`))
              : (() => { throw new TypeError(`As dependências da variável ${index + 1} são inválidas.`); })(),
          }),
    };
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes)) {
''',
    '''  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.nodes)) {
''',
)
replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''    version: 1,
    nodes: value.nodes.map((candidate, index) => {
''',
    '''    version: value.version,
    nodes: value.nodes.map((candidate, index) => {
''',
)

# Profile parser accepts both the stable array serialization and the in-memory keyed representation.
replace_once(
    "apps/web/src/domain/parametricMeasurements.ts",
    '''  if (!Array.isArray(value.entries)) throw new TypeError("As entradas do perfil de medidas são inválidas.");
  const entries: MeasurementProfile["entries"] = {};
  for (const candidate of value.entries) {
''',
    '''  const rawEntries = Array.isArray(value.entries)
    ? value.entries
    : isRecord(value.entries)
      ? Object.values(value.entries)
      : undefined;
  if (!rawEntries) throw new TypeError("As entradas do perfil de medidas são inválidas.");
  const entries: MeasurementProfile["entries"] = {};
  for (const candidate of rawEntries) {
''',
)
# Insert default profile helper before createMeasurementProfile.
replace_once(
    "apps/web/src/domain/parametricMeasurements.ts",
    '''export function createMeasurementProfile(
''',
    '''export function createDefaultMeasurementProfile(bodyType: BodyType): MeasurementProfile {
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
''',
)

# Styles for provenance badges, formulas and responsive fields.
styles = Path("apps/web/src/styles.css")
css = styles.read_text(encoding="utf-8")
addition = r'''

/* Prompt 5: versioned measurements and formulas */
.body-form-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.measurement-mode-toggle {
  min-height: 38px;
  padding: 7px 10px;
  color: #514a55;
  background: #fff;
  border: 1px solid #bdb5c2;
  border-radius: 8px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 800;
}

.measurement-mode-toggle[aria-pressed="true"] {
  color: #fff;
  background: #5b4964;
  border-color: #5b4964;
}

.measurement-authority-note {
  margin: 0;
  color: #686963;
  font-size: 10px;
  line-height: 1.4;
}

.measurement-groups details > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.measurement-groups details > summary small {
  color: #8a8983;
  font-size: 9px;
  font-weight: 600;
}

.measurement-field {
  align-content: start;
  padding: 8px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid transparent;
  border-radius: 8px;
}

.measurement-field-heading,
.measurement-status,
.formula-dependencies,
.formula-version,
.formula-direct,
.formula-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.measurement-origin {
  flex: 0 0 auto;
  padding: 2px 5px;
  border-radius: 999px;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.origin-supplied .measurement-origin {
  color: #36563f;
  background: #dceadd;
}

.origin-estimated .measurement-origin {
  color: #755622;
  background: #efe3c7;
}

.origin-derived .measurement-origin {
  color: #4d466f;
  background: #e4e0f0;
}

.measurement-status {
  min-height: 18px;
  color: #777770;
  font-size: 8px;
  font-weight: 600;
}

.measurement-status button {
  padding: 2px 5px;
  color: #65496e;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 8px;
  font-weight: 800;
  text-decoration: underline;
}

.measurement-advanced {
  display: grid;
  gap: 5px;
  margin-top: 4px;
  padding-top: 7px;
  border-top: 1px solid #ddd8d0;
}

.measurement-advanced textarea {
  width: 100%;
  min-height: 48px;
  resize: vertical;
  padding: 7px;
  color: #303038;
  background: #f7f6f3;
  border: 1px solid #c8c3bc;
  border-radius: 6px;
  font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.formula-label {
  color: #5d5261;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.formula-dependencies,
.formula-version,
.formula-direct {
  justify-content: flex-start;
  color: #797771;
  font-size: 8px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.formula-error {
  justify-content: flex-start;
  padding: 5px 6px;
  color: #7a2828;
  background: #f2dcdc;
  border-radius: 5px;
  font-size: 9px;
  line-height: 1.35;
}

.measurement-field.has-error {
  border-color: #ba7777;
}

@media (max-width: 900px) {
  .body-measurement-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .body-form-toolbar {
    grid-template-columns: 1fr;
  }

  .body-measurement-grid {
    grid-template-columns: 1fr;
  }

  .measurement-field {
    padding: 7px;
  }

  .measurement-input input,
  .measurement-advanced textarea {
    font-size: 16px;
  }
}
'''
if "/* Prompt 5: versioned measurements and formulas */" not in css:
    styles.write_text(css + addition, encoding="utf-8")

print("Prompt 5 integration patch applied")
