from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        'const DEFAULT_VISUAL_RESOLUTION = [44, 92, 38] as const;\nconst DEFAULT_COLLISION_RESOLUTION = [30, 64, 26] as const;',
        'const DEFAULT_VISUAL_RESOLUTION = [48, 92, 42] as const;\n// Keep the same Y stations in both LODs so circumference sampling hits the\n// same anatomical interpolation planes. X/Z stay cheaper for fitting.\nconst DEFAULT_COLLISION_RESOLUTION = [38, 92, 34] as const;',
    ),
    (
        'section("bust", "chest-front", f.bustY, m.bustMm, 1.27, 0.98, 0.89, 0.006, 0.110, 0, clamp(m.bustPointDistanceMm / m.bustMm, 0.18, 0.29)),',
        '// Spread the measured bust projection through the chest section instead\n    // of concentrating it in a high-curvature lobe. This preserves the same\n    // authored perimeter while reducing polygonization overshoot.\n    section("bust", "chest-front", f.bustY, m.bustMm, 1.27, 1.035, 0.89, 0.006, 0.082, 0, clamp(m.bustPointDistanceMm / m.bustMm, 0.18, 0.29)),',
    ),
    (
        '[Math.max(0.016, Math.abs(f.hipRight[0]) * 0.34), 0.175, Math.max(0.070, m.crotchDepthMm * 0.00036)],\n    );\n    if (y <= f.crotchY + 0.030) body = Math.max(body, -separator);',
        '// The cutter must traverse the complete front/back depth of the upper\n    // legs. A shallow closed ellipsoid only created an internal dimple and left\n    // centerline surface vertices. This depth opens the bifurcation to outside.\n      [Math.max(0.018, Math.abs(f.hipRight[0]) * 0.38), 0.180, Math.max(0.180, m.crotchDepthMm * 0.00082)],\n    );\n    if (y <= f.crotchY + 0.018) body = Math.max(body, -separator);',
    ),
    (
        '      min: [-xExtent, -0.03, -zBack - 0.055],\n      max: [xExtent, f.heightM + 0.03, zFront + 0.055],',
        '// Keep the complete closed iso-surface strictly inside the lattice.\n      // In particular the head/feet must never intersect the sampling box.\n      min: [-xExtent, -0.055, -zBack - 0.075],\n      max: [xExtent, f.heightM + 0.095, zFront + 0.075],',
    ),
]

for old, new in replacements:
    if old not in text:
        raise RuntimeError(f"expected block not found: {old[:80]!r}")
    text = text.replace(old, new, 1)

old_return = '''  if (signedVolume(positions, indices) < 0) {
    for (let offset = 0; offset < indices.length; offset += 3) {
      const swap = indices[offset + 1];
      indices[offset + 1] = indices[offset + 2];
      indices[offset + 2] = swap;
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: buildVertexNormals(positions, indices),
    indices: Uint32Array.from(indices),
    regionIds,
    bounds: computeBounds(positions),
  };
}
'''
new_return = '''  const welded = weldPolygonizedSurface(positions, indices, regionIds);
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
}

/**
 * Marching tetrahedra can emit the same zero-isosurface lattice vertex through
 * different lattice edges when the field evaluates to exactly zero. Welding
 * only numerically coincident vertices closes those topological cracks without
 * changing the body surface or its measurements.
 */
function weldPolygonizedSurface(
  positions: readonly number[],
  indices: readonly number[],
  regionIds: readonly HumanBodyRegionId[],
): { positions: number[]; indices: number[]; regionIds: HumanBodyRegionId[] } {
  const weldedPositions: number[] = [];
  const weldedRegions: HumanBodyRegionId[] = [];
  const remap = new Uint32Array(positions.length / 3);
  const byPosition = new Map<string, number>();
  const quantize = (value: number) => Math.round(value * 1e8);

  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const key = `${quantize(x)}:${quantize(y)}:${quantize(z)}`;
    let target = byPosition.get(key);
    if (target === undefined) {
      target = weldedPositions.length / 3;
      byPosition.set(key, target);
      weldedPositions.push(x, y, z);
      weldedRegions.push(regionIds[vertex]);
    }
    remap[vertex] = target;
  }

  const weldedIndices: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = remap[indices[offset]];
    const b = remap[indices[offset + 1]];
    const c = remap[indices[offset + 2]];
    if (a === b || b === c || c === a) continue;
    const pa = arrayVertex(weldedPositions, a);
    const pb = arrayVertex(weldedPositions, b);
    const pc = arrayVertex(weldedPositions, c);
    if (magnitude(cross(sub(pb, pa), sub(pc, pa))) <= 1e-10) continue;
    weldedIndices.push(a, b, c);
  }

  return { positions: weldedPositions, indices: weldedIndices, regionIds: weldedRegions };
}
'''
if old_return not in text:
    raise RuntimeError("polygonize return block not found")
text = text.replace(old_return, new_return, 1)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
