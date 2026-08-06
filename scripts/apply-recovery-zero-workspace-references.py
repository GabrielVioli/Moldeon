from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/components/PatternLibraryDialog.tsx",
    '''          assemblyPlacements: [],
        });''',
    '''          assemblyPlacements: [],
          parametric: undefined,
        });''',
)

replace_once(
    "apps/web/src/state/editorStore.ts",
    '''          workspaceStates: (document.garment.workspaceStates ?? []).filter(
            (item) => !removable.includes(item.pieceId),
          ),
        }),''',
    '''          workspaceStates: (document.garment.workspaceStates ?? []).filter(
            (item) => !removable.includes(item.pieceId),
          ),
          assemblyPlacements: (document.garment.assemblyPlacements ?? []).filter(
            (item) => !removable.includes(item.pieceId),
          ),
          ...(document.garment.parametric
            ? {
                parametric: {
                  ...document.garment.parametric,
                  generations: document.garment.parametric.generations.filter(
                    (generation) => !removable.includes(generation.patternId),
                  ),
                },
              }
            : {}),
        }),''',
)

replace_once(
    "apps/web/src/state/editorStore.ts",
    '''          workspaceStates: (document.garment.workspaceStates ?? []).filter((state) => state.pieceId !== pieceId),
        }),''',
    '''          workspaceStates: (document.garment.workspaceStates ?? []).filter((state) => state.pieceId !== pieceId),
          assemblyPlacements: (document.garment.assemblyPlacements ?? []).filter(
            (placement) => placement.pieceId !== pieceId,
          ),
          ...(document.garment.parametric
            ? {
                parametric: {
                  ...document.garment.parametric,
                  generations: document.garment.parametric.generations.filter(
                    (generation) => generation.patternId !== pieceId,
                  ),
                },
              }
            : {}),
        }),''',
)

# Strengthen the focused test with derived references.
test_path = ROOT / "apps/web/src/state/emptyWorkspace.test.ts"
test = test_path.read_text(encoding="utf-8")
old = '''    project.seams = [{
      id: "join",'''
new = '''    project.assemblyPlacements = [
      { pieceId: "first", role: "front", outwardSide: "front", positionMm: [0, 0, 0], rotationDeg: [0, 0, 0], flipped: false, source: "manual" },
      { pieceId: "second", role: "back", outwardSide: "back", positionMm: [0, 0, 0], rotationDeg: [0, 0, 0], flipped: false, source: "manual" },
    ];
    project.seams = [{
      id: "join",'''
if new not in test:
    if old not in test:
        raise SystemExit("test marker not found")
    test = test.replace(old, new, 1)
old_assert = '''    expect(useEditorStore.getState().garment.workspaceStates ?? []).toEqual([]);
    useEditorStore.getState().undo();'''
new_assert = '''    expect(useEditorStore.getState().garment.workspaceStates ?? []).toEqual([]);
    expect(useEditorStore.getState().garment.assemblyPlacements ?? []).toEqual([]);
    useEditorStore.getState().undo();'''
if new_assert not in test:
    if old_assert not in test:
        raise SystemExit("test assertion marker not found")
    test = test.replace(old_assert, new_assert, 1)
test_path.write_text(test, encoding="utf-8")
