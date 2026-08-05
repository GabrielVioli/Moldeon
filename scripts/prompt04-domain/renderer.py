from pathlib import Path

path = Path('apps/web/src/editor/PatternCanvas.tsx')
source = path.read_text(encoding='utf-8')
anchor = 'import { useEditorStore } from "../state/editorStore";'
if anchor not in source:
    raise SystemExit('PatternCanvas import anchor missing')
source = source.replace(anchor, 'import { sampleInternalPath } from "../domain/internalPaths";\n' + anchor, 1)
old = 'const points = line.points.map((point) => pieceLocalToWorld(point, transform));'
new = 'const points = ("points" in line ? line.points : sampleInternalPath(line)).map((point) => pieceLocalToWorld(point, transform));'
if source.count(old) != 1:
    raise SystemExit(f'legacy internal path renderer occurrence count: {source.count(old)}')
source = source.replace(old, new, 1)
path.write_text(source, encoding='utf-8')
