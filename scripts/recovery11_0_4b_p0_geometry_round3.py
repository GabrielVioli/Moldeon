from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

old = '''  const visualMesh = polygonizeAnatomy(field, visualResolution);
  const collisionMesh = polygonizeAnatomy(field, collisionResolution);
'''
new = '''  const visualMesh = calibrateCriticalSections(
    polygonizeAnatomy(field, visualResolution),
    torsoSections,
  );
  const collisionMesh = calibrateCriticalSections(
    polygonizeAnatomy(field, collisionResolution),
    torsoSections,
  );
'''
if old not in text:
    raise RuntimeError("build mesh block not found")
text = text.replace(old, new, 1)

old = '''  const welded = weldPolygonizedSurface(positions, indices, regionIds);
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
'''
new = '''  const welded = weldPolygonizedSurface(positions, indices, regionIds);
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
}
'''
if old not in text:
    raise RuntimeError("weld return block not found")
text = text.replace(old, new, 1)

marker = '''function buildVertexNormals(positions: readonly number[], indices: readonly number[]): Float32Array {'''
if marker not in text:
    raise RuntimeError("normal marker not found")
helpers = r'''
function sealBoundaryLoops(
  sourcePositions: readonly number[],
  sourceIndices: readonly number[],
  sourceRegions: readonly HumanBodyRegionId[],
): { positions: number[]; indices: number[]; regionIds: HumanBodyRegionId[] } {
  const positions = [...sourcePositions];
  const indices = [...sourceIndices];
  const regionIds = [...sourceRegions];
  const edges = new Map<string, { a: number; b: number; count: number; directedA: number; directedB: number }>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    for (const [from, to] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as const) {
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      const key = `${a}:${b}`;
      const current = edges.get(key);
      if (current) current.count += 1;
      else edges.set(key, { a, b, count: 1, directedA: from, directedB: to });
    }
  }

  const boundary = [...edges.values()].filter((edge) => edge.count === 1);
  if (boundary.length === 0) return { positions, indices, regionIds };
  const adjacency = new Map<number, number[]>();
  for (const edge of boundary) {
    const first = adjacency.get(edge.a) ?? [];
    first.push(edge.b);
    adjacency.set(edge.a, first);
    const second = adjacency.get(edge.b) ?? [];
    second.push(edge.a);
    adjacency.set(edge.b, second);
  }

  const unused = new Set(boundary.map((edge) => `${edge.a}:${edge.b}`));
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  while (unused.size > 0) {
    const seed = unused.values().next().value as string;
    const [seedA, seedB] = seed.split(":").map(Number);
    const loop = [seedA, seedB];
    unused.delete(seed);
    let previous = seedA;
    let current = seedB;
    let closed = false;
    for (let guard = 0; guard < boundary.length + 2; guard += 1) {
      const candidates = (adjacency.get(current) ?? []).filter((next) => next !== previous && unused.has(edgeKey(current, next)));
      if (candidates.length === 0) {
        if ((adjacency.get(current) ?? []).includes(loop[0])) closed = true;
        break;
      }
      const next = candidates[0];
      unused.delete(edgeKey(current, next));
      if (next === loop[0]) {
        closed = true;
        break;
      }
      loop.push(next);
      previous = current;
      current = next;
    }
    if (!closed || loop.length < 3) continue;

    let x = 0;
    let y = 0;
    let z = 0;
    const regionCounts = new Map<HumanBodyRegionId, number>();
    for (const vertex of loop) {
      x += positions[vertex * 3];
      y += positions[vertex * 3 + 1];
      z += positions[vertex * 3 + 2];
      const region = regionIds[vertex];
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    }
    const center = positions.length / 3;
    positions.push(x / loop.length, y / loop.length, z / loop.length);
    const region = [...regionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "abdomen";
    regionIds.push(region);

    for (let index = 0; index < loop.length; index += 1) {
      const a = loop[index];
      const b = loop[(index + 1) % loop.length];
      const original = edges.get(edgeKey(a, b));
      if (original && original.directedA === a && original.directedB === b) indices.push(b, a, center);
      else indices.push(a, b, center);
    }
  }
  return { positions, indices, regionIds };
}

function calibrateCriticalSections(
  mesh: HumanBodyMesh,
  sections: readonly HumanBodyCrossSection[],
): HumanBodyMesh {
  const positions = new Float32Array(mesh.positions);
  const critical = ["bust", "waist", "full-hip"] as const;
  for (const id of critical) {
    const sectionValue = sectionById(sections, id);
    const currentMm = measureMeshCircumferenceAtY({ ...mesh, positions }, sectionValue.yM) * 1000;
    if (!Number.isFinite(currentMm) || currentMm <= 1e-6) continue;
    const factor = sectionValue.targetCircumferenceMm / currentMm;
    const plateauM = 0.012;
    const influenceM = id === "waist" ? 0.042 : 0.036;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const y = positions[vertex * 3 + 1];
      const distanceY = Math.abs(y - sectionValue.yM);
      if (distanceY >= influenceM) continue;
      const weight = distanceY <= plateauM
        ? 1
        : smoothstep(1 - (distanceY - plateauM) / (influenceM - plateauM));
      const localScale = 1 + (factor - 1) * weight;
      positions[vertex * 3] *= localScale;
      positions[vertex * 3 + 2] = sectionValue.centerZM + (positions[vertex * 3 + 2] - sectionValue.centerZM) * localScale;
    }
  }
  const positionsArray = Array.from(positions);
  const indicesArray = Array.from(mesh.indices);
  return {
    ...mesh,
    positions,
    normals: buildVertexNormals(positionsArray, indicesArray),
    bounds: computeBounds(positionsArray),
  };
}

'''
text = text.replace(marker, helpers + marker, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
