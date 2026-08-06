from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

required_markers = {
    "apps/web/src/domain/pattern.ts": [
        'throw new TypeError("A lista de peças do projeto é inválida.")',
    ],
    "apps/web/src/domain/patternDocumentV3.ts": [
        'throw new TypeError("As definições de molde do documento são inválidas.")',
    ],
    "apps/web/src/storage/opfs.ts": [
        'document.workspace.activePatternId ?? document.patternDefinitions[0]?.id ?? ""',
    ],
    "apps/web/src/state/editorStore.ts": [
        'activePieceId: ""',
        'if (removable.length === 0) return;',
        'if (!get().garment.pieces.some((piece) => piece.id === pieceId)) return;',
    ],
    "apps/web/src/editor/PatternCanvas.tsx": [
        'const activePiece = garment.pieces.find((piece) => piece.id === activePieceId);',
        'pieceId: "empty-workspace"',
    ],
    "apps/web/src/App.tsx": [
        'const hasPieces = garment.pieces.length > 0;',
        'Bancada vazia · milímetros',
        'A bancada está vazia',
    ],
    "apps/web/src/state/emptyWorkspace.test.ts": [
        'deletes the last piece and supports undo and redo',
    ],
    "apps/web/src/storage/emptyAutosave.test.ts": [
        'restores a V3 autosave without an active pattern',
    ],
}

missing: list[str] = []
for relative_path, markers in required_markers.items():
    text = (ROOT / relative_path).read_text(encoding="utf-8")
    for marker in markers:
        if marker not in text:
            missing.append(f"{relative_path}: {marker}")

if missing:
    raise SystemExit("Recuperação de bancada vazia incompleta:\n" + "\n".join(missing))

print("Empty-workspace recovery markers verified; no patch required.")
