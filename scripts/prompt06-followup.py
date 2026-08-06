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

print("Prompt 6 typed metadata follow-up applied")
