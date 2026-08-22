from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")
old = '  const sealed = sealBoundaryLoops(welded.positions, welded.indices, welded.regionIds);'
new = '  const sealed = { positions: welded.positions, indices: welded.indices, regionIds: welded.regionIds };'
if old not in text:
    raise RuntimeError("seal call not found")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
