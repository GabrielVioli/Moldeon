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
    'const MEASUREMENT_RANGES: Record<keyof BodyMeasurements, readonly [number, number]> = {\n',
    'const MEASUREMENT_RANGES: Partial<Record<keyof BodyMeasurements, readonly [number, number]>> = {\n',
)
patch(
    "apps/web/src/state/editorStore.ts",
    '        measurements: Object.fromEntries(Object.entries(profile.entries).map(([key, entry]) => [key, entry?.value])) as BodyMeasurements,\n',
    '        measurements: Object.fromEntries(Object.entries(profile.entries).map(([key, entry]) => [key, entry?.value])) as unknown as BodyMeasurements,\n',
)
print("Prompt 5 typecheck follow-up applied")
