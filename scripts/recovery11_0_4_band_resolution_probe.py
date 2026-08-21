from pathlib import Path

path = Path("apps/web/src/garment3d/CoarseAssemblyMesh.ts")
text = path.read_text(encoding="utf-8")
old = '''  if (hasStructuredSelfSeam) {
    const structured = remeshStructuredQuadrilateral(base, 80);
    if (structured) return structured;
  }'''
new = '''  if (hasStructuredSelfSeam) {
    // Phase-0 probe: halve the base strip cell so the coarse attachment grid
    // can express opening breakpoints that were previously crossed by one
    // long chord. Fine structured self-seam meshes are the 2x-refined version
    // of the 80 mm base and therefore still contain these 40 mm material loci
    // for the canonical 480 mm regression strip.
    const structured = remeshStructuredQuadrilateral(base, 40);
    if (structured) return structured;
  }'''
if text.count(old) != 1:
    raise RuntimeError(f"expected one self-seam remesh block, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print(f"patched {path}")
