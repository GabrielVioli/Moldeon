from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")
old = '  const quantize = (value: number) => Math.round(value * 1e8);'
new = '''  // Marching-tetrahedra can leave paired vertices a few micrometres apart
  // along field transitions. Weld at 0.02 mm, far below fitting tolerances and
  // two orders below the visual lattice spacing, so this repairs topology
  // without changing the anatomical silhouette.
  const quantize = (value: number) => Math.round(value * 5e4);'''
if old not in text:
    raise RuntimeError("weld quantization marker not found")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
