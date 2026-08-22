from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

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
new = '''  // With the final positional weld, the marching-tetrahedra cracks close
  // without manufacturing cap vertices. Keep the native isosurface whenever
  // it is already closed: centroid fans can create zero-area triangles and
  // over-subscribed edges on tiny numerical loops.
  const welded = weldPolygonizedSurface(positions, indices, regionIds);
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
if old not in text:
    raise RuntimeError("round5 sealed polygonization block not found")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
