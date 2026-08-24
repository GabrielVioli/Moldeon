from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

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
  const closed = triangulateBoundaryLoops(welded.positions, welded.indices, welded.regionIds);
  if (signedVolume(closed.positions, closed.indices) < 0) {
    for (let offset = 0; offset < closed.indices.length; offset += 3) {
      const swap = closed.indices[offset + 1];
      closed.indices[offset + 1] = closed.indices[offset + 2];
      closed.indices[offset + 2] = swap;
    }
  }
  return {
    positions: Float32Array.from(closed.positions),
    normals: buildVertexNormals(closed.positions, closed.indices),
    indices: Uint32Array.from(closed.indices),
    regionIds: closed.regionIds,
    bounds: computeBounds(closed.positions),
  };
}
'''
if old not in text:
    raise RuntimeError("boundary-fill weld return block not found")
text = text.replace(old, new, 1)

marker = '''function polygonizeTetra(
'''
if marker not in text:
    raise RuntimeError("boundary-fill polygonize marker not found")
helper = r'''function triangulateBoundaryLoops(
  sourcePositions: readonly number[],
  sourceIndices: readonly number[],
  sourceRegions: readonly HumanBodyRegionId[],
): { positions: number[]; indices: number[]; regionIds: HumanBodyRegionId[] } {
  const positions = [...sourcePositions];
  const indices = [...sourceIndices];
  const regionIds = [...sourceRegions];
  const edgeRecords = new Map<string, { a: number; b: number; count: number; from: number; to: number }>();
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const tri = [indices[offset], indices[offset + 1], indices[offset + 2]] as const;
    for (const [from, to] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = edgeKey(from, to);
      const current = edgeRecords.get(key);
      if (current) current.count += 1;
      else edgeRecords.set(key, { a: Math.min(from, to), b: Math.max(from, to), count: 1, from, to });
    }
  }
  const boundary = [...edgeRecords.values()].filter((edge) => edge.count === 1);
  if (boundary.length === 0) return { positions, indices, regionIds };

  const outgoing = new Map<number, number[]>();
  const undirected = new Map<number, number[]>();
  for (const edge of boundary) {
    const out = outgoing.get(edge.from) ?? [];
    out.push(edge.to);
    outgoing.set(edge.from, out);
    for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      const list = undirected.get(a) ?? [];
      list.push(b);
      undirected.set(a, list);
    }
  }

  const unused = new Set(boundary.map((edge) => edgeKey(edge.a, edge.b)));
  const triangleKeys = new Set<string>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    triangleKeys.add([indices[offset], indices[offset + 1], indices[offset + 2]].sort((a, b) => a - b).join(":"));
  }

  while (unused.size > 0) {
    const seedKey = unused.values().next().value as string;
    const seed = edgeRecords.get(seedKey);
    if (!seed) {
      unused.delete(seedKey);
      continue;
    }
    const loop = [seed.from, seed.to];
    unused.delete(seedKey);
    let previous = seed.from;
    let current = seed.to;
    let closed = false;
    for (let guard = 0; guard <= boundary.length + 2; guard += 1) {
      if (current === loop[0]) {
        loop.pop();
        closed = true;
        break;
      }
      const directedNext = (outgoing.get(current) ?? []).find((candidate) =>
        candidate !== previous && unused.has(edgeKey(current, candidate))
      );
      const fallbackNext = (undirected.get(current) ?? []).find((candidate) =>
        candidate !== previous && unused.has(edgeKey(current, candidate))
      );
      const next = directedNext ?? fallbackNext;
      if (next === undefined) {
        if ((undirected.get(current) ?? []).includes(loop[0])) closed = true;
        break;
      }
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

    // Existing surface triangles traverse the hole boundary in one direction.
    // New faces use the opposite winding. No centroid vertex is introduced, so
    // a tiny numerical loop cannot generate zero-area fan triangles.
    for (let index = 1; index < loop.length - 1; index += 1) {
      const a = loop[0];
      const b = loop[index + 1];
      const c = loop[index];
      if (a === b || b === c || c === a) continue;
      const pa = arrayVertex(positions, a);
      const pb = arrayVertex(positions, b);
      const pc = arrayVertex(positions, c);
      if (magnitude(cross(sub(pb, pa), sub(pc, pa))) <= 1e-10) continue;
      const canonical = [a, b, c].sort((first, second) => first - second).join(":");
      if (triangleKeys.has(canonical)) continue;
      triangleKeys.add(canonical);
      indices.push(a, b, c);
    }
  }
  return { positions, indices, regionIds };
}

'''
text = text.replace(marker, helper + marker, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
