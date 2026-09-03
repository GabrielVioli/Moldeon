import type { AssemblyStitchConstraint } from "../garment3d/GarmentAssembly";

/**
 * Returns the active physical sewing component containing rootInstanceId.
 * Dart constraints are deliberately ignored because they close material inside
 * one panel and must never turn unrelated panel movement into group movement.
 *
 * The arrangement workspace consumes this as selection semantics only. It does
 * not solve seams, deform cloth or start XPBD.
 */
export function connectedSewingInstanceIds(
  constraints: readonly Pick<AssemblyStitchConstraint, "instanceA" | "instanceB" | "seamGroupId">[],
  rootInstanceId: string,
): string[] {
  const adjacency = new Map<string, Set<string>>();

  for (const constraint of constraints) {
    const first = constraint.instanceA;
    const second = constraint.instanceB;
    if (!first || !second || first === second || constraint.seamGroupId.startsWith("dart:")) continue;
    const firstNeighbors = adjacency.get(first) ?? new Set<string>();
    const secondNeighbors = adjacency.get(second) ?? new Set<string>();
    firstNeighbors.add(second);
    secondNeighbors.add(first);
    adjacency.set(first, firstNeighbors);
    adjacency.set(second, secondNeighbors);
  }

  const visited = new Set<string>([rootInstanceId]);
  const queue = [rootInstanceId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return [...visited];
}
