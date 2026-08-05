from pathlib import Path

path = Path('apps/web/src/components/ContextBar.tsx')
source = path.read_text(encoding='utf-8')
old = '''  const selectedPath = selectedPathId
    ? garment.pieces
        .flatMap((piece) => piece.internalLines ?? [])
        .find((line) => line.id === selectedPathId && isInternalPath(line))
    : undefined;
  const draftPath = draftPathId
    ? garment.pieces
        .flatMap((piece) => piece.internalLines ?? [])
        .find((line) => line.id === draftPathId && isInternalPath(line))
    : undefined;'''
new = '''  const internalPaths = garment.pieces
    .flatMap((piece) => piece.internalLines ?? [])
    .filter(isInternalPath);
  const selectedPath = selectedPathId
    ? internalPaths.find((line) => line.id === selectedPathId)
    : undefined;
  const draftPath = draftPathId
    ? internalPaths.find((line) => line.id === draftPathId)
    : undefined;'''
if source.count(old) != 1:
    raise SystemExit(f'context internal path narrowing occurrence count: {source.count(old)}')
path.write_text(source.replace(old, new), encoding='utf-8')
