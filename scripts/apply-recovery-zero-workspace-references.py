from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

required_markers = {
    "apps/web/src/components/PatternLibraryDialog.tsx": [
        "assemblyPlacements: []",
        "parametric: undefined",
    ],
    "apps/web/src/state/editorStore.ts": [
        "assemblyPlacements: (document.garment.assemblyPlacements ?? []).filter",
        "generations: document.garment.parametric.generations.filter",
    ],
    "apps/web/src/state/emptyWorkspace.test.ts": [
        "expect(useEditorStore.getState().garment.assemblyPlacements ?? []).toEqual([]);",
    ],
}

missing: list[str] = []
for relative_path, markers in required_markers.items():
    text = (ROOT / relative_path).read_text(encoding="utf-8")
    for marker in markers:
        if marker not in text:
            missing.append(f"{relative_path}: {marker}")

if missing:
    raise SystemExit("Limpeza de referências da bancada vazia incompleta:\n" + "\n".join(missing))

print("Empty-workspace derived references verified; no patch required.")
