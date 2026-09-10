from pathlib import Path

path = Path("apps/web/src/viewport/SewingStep0.ts")
text = path.read_text(encoding="utf-8")

# The exact body-plane intersection is already a topological contour. The first
# exact-profile attempt discarded segment adjacency and polar-sorted all points,
# which creates short chords/jumps on non-convex hip/glute contours. Those jumps
# show up as 20-30% local material errors even though the seam closes. Preserve
# the mesh-plane segment graph order instead.
text = text.replace(
'''    const ordered = [...component].sort((left, right) =>
      Math.atan2(left.x, left.y) - Math.atan2(right.x, right.y),
    );''',
'''    const ordered = [...component];''',
1,
)

start = text.index("function connectedPlaneComponents(")
end = text.index("\nfunction polygonContainsOrigin(", start)
replacement = r'''function connectedPlaneComponents(
  segments: readonly [THREE.Vector2, THREE.Vector2][],
): THREE.Vector2[][] {
  const toleranceM = 0.0002;
  const keyFor = (point: THREE.Vector2) => `${Math.round(point.x / toleranceM)}:${Math.round(point.y / toleranceM)}`;
  const points = new Map<string, { sum: THREE.Vector2; count: number }>();
  const adjacency = new Map<string, Set<string>>();
  const addPoint = (key: string, point: THREE.Vector2): void => {
    const current = points.get(key);
    if (current) {
      current.sum.add(point);
      current.count += 1;
    } else {
      points.set(key, { sum: point.clone(), count: 1 });
    }
    if (!adjacency.has(key)) adjacency.set(key, new Set());
  };
  for (const [a, b] of segments) {
    const ka = keyFor(a);
    const kb = keyFor(b);
    if (ka === kb) continue;
    addPoint(ka, a);
    addPoint(kb, b);
    adjacency.get(ka)!.add(kb);
    adjacency.get(kb)!.add(ka);
  }

  const pointFor = (key: string): THREE.Vector2 => {
    const entry = points.get(key)!;
    return entry.sum.clone().multiplyScalar(1 / entry.count);
  };
  const components: THREE.Vector2[][] = [];
  const globallyVisited = new Set<string>();
  for (const seed of adjacency.keys()) {
    if (globallyVisited.has(seed)) continue;
    const stack = [seed];
    const componentKeys: string[] = [];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (globallyVisited.has(key)) continue;
      globallyVisited.add(key);
      componentKeys.push(key);
      for (const next of adjacency.get(key) ?? []) if (!globallyVisited.has(next)) stack.push(next);
    }
    if (componentKeys.length < 3) continue;
    const allowed = new Set(componentKeys);

    // A manifold triangle/plane intersection is degree two. Tiny numerical
    // duplicates can create degree >2; in that case choose the continuation
    // that changes direction the least, never a polar chord across the body.
    let startKey = componentKeys[0];
    for (const key of componentKeys) {
      const point = pointFor(key);
      const current = pointFor(startKey);
      if (point.y > current.y || (Math.abs(point.y - current.y) <= 1e-9 && point.x < current.x)) startKey = key;
    }

    const startNeighbors = [...(adjacency.get(startKey) ?? [])].filter((key) => allowed.has(key));
    let bestCycle: string[] | null = null;
    for (const firstNeighbor of startNeighbors) {
      const cycle = [startKey];
      let previous = startKey;
      let current = firstNeighbor;
      const usedEdges = new Set<string>();
      const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
      for (let guard = 0; guard <= componentKeys.length * 3; guard += 1) {
        cycle.push(current);
        if (current === startKey) break;
        const incoming = pointFor(current).sub(pointFor(previous)).normalize();
        const candidates = [...(adjacency.get(current) ?? [])]
          .filter((next) => allowed.has(next) && next !== previous && !usedEdges.has(edgeKey(current, next)));
        if (candidates.length === 0) break;
        let next = candidates[0];
        let bestTurn = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          const direction = pointFor(candidate).sub(pointFor(current)).normalize();
          // Prefer the straightest continuation through a split node. This
          // follows the original intersection polyline instead of cutting
          // across a concavity.
          const turn = 1 - THREE.MathUtils.clamp(incoming.dot(direction), -1, 1);
          if (turn < bestTurn) {
            bestTurn = turn;
            next = candidate;
          }
        }
        usedEdges.add(edgeKey(previous, current));
        previous = current;
        current = next;
      }
      if (cycle.at(-1) === startKey) cycle.pop();
      const unique = new Set(cycle);
      if (unique.size >= 8 && (bestCycle === null || unique.size > new Set(bestCycle).size)) bestCycle = cycle;
    }

    if (bestCycle) {
      components.push(bestCycle.map(pointFor));
      continue;
    }

    // Do not invent a polar-sorted contour when topology cannot be traced.
    // Returning no candidate makes the caller fall back to the conservative
    // ellipse path instead of creating a geometrically invalid material map.
  }
  return components;
}
'''
text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")
print("Applied topological body-plane contour tracing fix")
