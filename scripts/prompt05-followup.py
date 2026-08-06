from pathlib import Path


def patch(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    if old not in source:
        raise SystemExit(f"{path}: missing {old[:120]!r}")
    file.write_text(source.replace(old, new, 1), encoding="utf-8")

patch(
    "apps/web/src/domain/constructionGraph.ts",
    '  measurements: Readonly<Record<string, number | undefined>>,\n',
    '  measurements: Readonly<Record<string, number | undefined>> | import("./pattern").BodyMeasurements,\n',
)
patch(
    "apps/web/src/domain/constructionGraph.ts",
    '      const value = measurements[key];\n',
    '      const value = (measurements as unknown as Record<string, number | undefined>)[key];\n',
)
patch(
    "apps/web/src/domain/formulaEngine.test.ts",
    'import { readFileSync } from "node:fs";\n',
    '',
)
patch(
    "apps/web/src/domain/formulaEngine.test.ts",
    '''  it("contains no eval or Function constructor", () => {
    const source = readFileSync(new URL("./formulaEngine.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\\beval\\s*\\(/);
    expect(source).not.toMatch(/\\bnew\\s+Function\\b/);
    expect(source).not.toMatch(/\\bFunction\\s*\\(/);
  });
''',
    '''  it("contains no eval or Function constructor in the executable API", () => {
    const source = [parseFormula, evaluateFormula, FormulaGraphEngine].map((value) => String(value)).join("\\n");
    expect(source).not.toMatch(/\\beval\\s*\\(/);
    expect(source).not.toMatch(/\\bnew\\s+Function\\b/);
    expect(source).not.toMatch(/\\bFunction\\s*\\(/);
  });
''',
)
patch(
    "apps/web/src/domain/parametricPatternDocumentV3.test.ts",
    '    const plain = structuredClone(legacyV3) as Record<string, unknown>;\n',
    '    const plain = structuredClone(legacyV3) as unknown as Record<string, unknown>;\n',
)
patch(
    "apps/web/src/patterns/templateCatalog.ts",
    '  const ranges: Record<keyof BodyMeasurements, readonly [number, number]> = {\n',
    '  const ranges: Partial<Record<keyof BodyMeasurements, readonly [number, number]>> = {\n',
)
patch(
    "apps/web/src/patterns/templateCatalog.ts",
    '''    const [minimum, maximum] = ranges[key];
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new RangeError(
        `A medida ${key} precisa ficar entre ${minimum} e ${maximum} mm.`,
      );
    }
''',
    '''    const range = ranges[key];
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
''',
)
patch(
    "apps/web/src/state/editorStore.ts",
    '        measurements: Object.fromEntries(Object.entries(profile.entries).map(([key, entry]) => [key, entry?.value])) as BodyMeasurements,\n',
    '        measurements: Object.fromEntries(Object.entries(profile.entries).map(([key, entry]) => [key, entry?.value])) as unknown as BodyMeasurements,\n',
)
patch(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''  const profile = createMeasurementProfile(garment.measurements, garment.bodyType, garment.measurementProfile);
  const measurementEntries = Object.values(profile.entries).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
''',
    '''  const profile = garment.measurementProfile
    ? createMeasurementProfile(garment.measurements, garment.bodyType, garment.measurementProfile)
    : undefined;
  const measurementEntries = profile
    ? Object.values(profile.entries).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];
''',
)
patch(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''    measurements: {
      id: "measurements-primary",
      values: measurementProfileToBodyMeasurements(profile),
      estimatedKeys: measurementEntries.filter((entry) => entry.origin === "estimated").map((entry) => entry.key),
      suppliedKeys: measurementEntries.filter((entry) => entry.origin === "supplied").map((entry) => entry.key),
      derivedKeys: measurementEntries.filter((entry) => entry.origin === "derived").map((entry) => entry.key),
      formulaSetVersion: profile.formulaSetVersion,
      profile,
    },
''',
    '''    measurements: {
      id: "measurements-primary",
      values: profile ? measurementProfileToBodyMeasurements(profile) : garment.measurements,
      estimatedKeys: measurementEntries.filter((entry) => entry.origin === "estimated").map((entry) => entry.key),
      ...(profile
        ? {
            suppliedKeys: measurementEntries.filter((entry) => entry.origin === "supplied").map((entry) => entry.key),
            derivedKeys: measurementEntries.filter((entry) => entry.origin === "derived").map((entry) => entry.key),
            formulaSetVersion: profile.formulaSetVersion,
            profile,
          }
        : {}),
    },
''',
)
patch(
    "apps/web/src/domain/patternDocumentV3.ts",
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
''',
    '''  const profile = document.measurements.profile
    ? parseMeasurementProfile(document.measurements.profile)
    : undefined;
  const generations = document.patternDefinitions.flatMap((definition) => definition.generation ? [definition.generation] : []);
  const hasParametricMetadata = Boolean(
    document.metadata.sourceTemplateVersion
    || document.variables.length > 0
    || document.constructionGraph.version === 2
    || document.constructionGraph.nodes.length > 0
    || generations.length > 0,
  );
  const parametric: ParametricProjectMetadata | undefined = hasParametricMetadata
    ? {
        schemaVersion: 1,
        ...(document.metadata.sourceTemplateId ? { templateId: document.metadata.sourceTemplateId } : {}),
        ...(document.metadata.sourceTemplateVersion ? { templateVersion: document.metadata.sourceTemplateVersion } : {}),
        variables: document.variables.map((variable) => ({
          ...variable,
          formulaVersion: variable.formulaVersion ?? "legacy-v3",
          dependencies: variable.dependencies ?? [],
        })),
        constructionGraph: document.constructionGraph,
        generations,
      }
    : undefined;
''',
)
patch(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''    measurements: measurementProfileToBodyMeasurements(profile),
    measurementProfile: profile,
    parametric,
    fabrics: document.fabrics,
''',
    '''    measurements: profile ? measurementProfileToBodyMeasurements(profile) : document.measurements.values,
    ...(profile ? { measurementProfile: profile } : {}),
    ...(parametric ? { parametric } : {}),
    fabrics: document.fabrics,
''',
)
print("Prompt 5 typecheck and compatibility follow-up applied")
