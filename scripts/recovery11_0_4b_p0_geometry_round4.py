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

old = '''  const welded = weldPolygonizedSurface(positions, indices, regionIds);
  const sealed = sealBoundaryLoops(welded.positions, welded.indices, welded.regionIds);
  if (signedVolume(sealed.positions, sealed.indices) < 0) {
    for (let offset = 0; offset < sealed.indices.length; offset += 3) {
      const swap = sealed.indices[offset + 1];
      sealed.indices[offset + 1] = sealed.indices[offset + 2];
      sealed.indices[offset + 2] = swap;
    }
  }
  return {
    positions: Float32Array.from(sealed.positions),
    normals: buildVertexNormals(sealed.positions, sealed.indices),
    indices: Uint32Array.from(sealed.indices),
    regionIds: sealed.regionIds,
    bounds: computeBounds(sealed.positions),
  };
}'''
new = '''  const welded = weldPolygonizedSurface(positions, indices, regionIds);
  if (signedVolume(welded.positions, welded.indices) < 0) {
    for (let offset = 0; offset < welded.indices.length; offset += 3) {
      const swap = welded.indices[offset + 1];
      welded.indices[offset + 1] = welded.indices[offset + 2];
      welded.indices[offset + 2] = swap;
    }
  }
  return {
    positions: Float32Array.from(welded.positions),
    normals: buildVertexNormals(welded.positions, welded.indices),
    indices: Uint32Array.from(welded.indices),
    regionIds: welded.regionIds,
    bounds: computeBounds(welded.positions),
  };
}'''
if text.count(old) != 1:
    raise RuntimeError(f"sealed return block mismatch: {text.count(old)}")
text = text.replace(old, new, 1)

start = text.find("\nfunction sealBoundaryLoops(")
end = text.find("\nfunction calibrateCriticalSections(", start)
if start < 0 or end < 0:
    raise RuntimeError("sealBoundaryLoops helper boundary not found")
text = text[:start] + text[end:]

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
