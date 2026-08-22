from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")
start = text.find("function weldPolygonizedSurface(\n")
end = text.find("function polygonizeTetra(\n", start)
if start < 0 or end < 0:
    raise RuntimeError("spatial-weld function markers not found")

replacement = r'''function weldPolygonizedSurface(
  positions: readonly number[],
  indices: readonly number[],
  regionIds: readonly HumanBodyRegionId[],
): { positions: number[]; indices: number[]; regionIds: HumanBodyRegionId[] } {
  // 0.02 mm is far below fitting tolerances. Adjacent-cell lookup avoids the
  // quantization-boundary crack that the previous scalar rounding produced.
  const toleranceM = 0.00002;
  const tolerance2 = toleranceM * toleranceM;
  const cellSize = toleranceM;
  const weldedPositions: number[] = [];
  const weldedRegions: HumanBodyRegionId[] = [];
  const remap = new Uint32Array(positions.length / 3);
  const grid = new Map<string, number[]>();
  const cell = (value: number) => Math.floor(value / cellSize);
  const key = (ix: number, iy: number, iz: number) => `${ix}:${iy}:${iz}`;

  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const ix = cell(x);
    const iy = cell(y);
    const iz = cell(z);
    let target = -1;
    let bestDistance2 = Number.POSITIVE_INFINITY;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (const candidate of grid.get(key(ix + dx, iy + dy, iz + dz)) ?? []) {
            const cx = weldedPositions[candidate * 3];
            const cy = weldedPositions[candidate * 3 + 1];
            const cz = weldedPositions[candidate * 3 + 2];
            const distance2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
            if (distance2 <= tolerance2 && distance2 < bestDistance2) {
              target = candidate;
              bestDistance2 = distance2;
            }
          }
        }
      }
    }
    if (target < 0) {
      target = weldedPositions.length / 3;
      weldedPositions.push(x, y, z);
      weldedRegions.push(regionIds[vertex]);
      const bucketKey = key(ix, iy, iz);
      const bucket = grid.get(bucketKey) ?? [];
      bucket.push(target);
      grid.set(bucketKey, bucket);
    }
    remap[vertex] = target;
  }

  const weldedIndices: number[] = [];
  const triangles = new Set<string>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = remap[indices[offset]];
    const b = remap[indices[offset + 1]];
    const c = remap[indices[offset + 2]];
    if (a === b || b === c || c === a) continue;
    const pa = arrayVertex(weldedPositions, a);
    const pb = arrayVertex(weldedPositions, b);
    const pc = arrayVertex(weldedPositions, c);
    if (magnitude(cross(sub(pb, pa), sub(pc, pa))) <= 1e-10) continue;
    const canonical = [a, b, c].sort((first, second) => first - second).join(":");
    if (triangles.has(canonical)) continue;
    triangles.add(canonical);
    weldedIndices.push(a, b, c);
  }
  return { positions: weldedPositions, indices: weldedIndices, regionIds: weldedRegions };
}

'''
text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
