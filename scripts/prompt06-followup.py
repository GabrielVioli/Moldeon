from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text(encoding="utf-8")
    if old not in source:
        raise SystemExit(f"{path}: trecho não encontrado: {old[:100]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


replace(
    "apps/web/src/patterns/basePatternDrafting.ts",
    "  const resolved = measurements as Readonly<Record<string, number | undefined>>;\n",
    "  const resolved = measurements as unknown as Readonly<Record<string, number | undefined>>;\n",
)

replace(
    "apps/web/src/domain/parametricMeasurements.ts",
    '  componentValidation?: Record<string, "experimental" | "geometrically-validated" | "manually-reviewed">;\n',
    '  componentValidation?: {\n    body: "experimental" | "geometrically-validated" | "manually-reviewed";\n    sleeve?: "experimental" | "geometrically-validated" | "manually-reviewed";\n  };\n',
)

replace(
    "apps/web/src/domain/parametricMeasurements.ts",
    "  limits?: Record<string, number>;\n",
    "  limits?: {\n    minimumAreaMm2: number;\n    shoulderToleranceMm?: number;\n    sideSeamToleranceMm: number;\n    minimumCurveSeparationMm: number;\n  };\n",
)

replace(
    "apps/web/src/patterns/basePatternDrafting.ts",
    '    formula("halfWaistWithEase", "(waistMm + waistEaseMm) / 2", "mm"),\n'
    '    formula("halfWaistWithEase", "(waistMm + waistEaseMm) / 2", "mm"),\n',
    '    formula("halfWaistWithEase", "(waistMm + waistEaseMm) / 2", "mm"),\n',
)

replace(
    "apps/web/src/patterns/basePatternDrafting.test.ts",
    "    expect(maxX(openFront)).not.toBe(maxX(front));\n",
    "    expect(openFront.points[1].xMm).not.toBe(front.points[1].xMm);\n",
)

replace(
    "apps/web/src/patterns/basePatternDrafting.ts",
    '    "Manga experimental",\n',
    '    "Manga",\n',
)

replace(
    "apps/web/src/domain/parametricPatternDocumentV3.test.ts",
    '    expect(document.metadata.sourceTemplateVersion).toBe("tshirt@1");\n',
    '    expect(document.metadata.sourceTemplateVersion).toBe("tshirt@2");\n',
)

replace(
    "apps/web/src/domain/parametricPatternDocumentV3.test.ts",
    '    expect(document.patternDefinitions.every((definition) => definition.generation?.templateVersion === "tshirt@1")).toBe(true);\n',
    '    expect(document.patternDefinitions.every((definition) => definition.generation?.templateVersion === "tshirt@2")).toBe(true);\n',
)

print("Prompt 6 typed metadata, compatibility and source-boundary follow-up applied")
