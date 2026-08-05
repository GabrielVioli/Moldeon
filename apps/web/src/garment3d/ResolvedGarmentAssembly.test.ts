import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import {
  DEFAULT_BODY_MEASUREMENTS,
  createGarmentFromTemplate,
} from "../patterns/templateCatalog";
import { buildResolvedGarmentAssembly } from "./ResolvedGarmentAssembly";

describe("ResolvedGarmentAssembly", () => {
  it("connects front, back and both sleeves without cross-side stitches", () => {
    const garment = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const engine = new FallbackPatternEngine();
    const snapshots = garment.pieces.map((piece) => engine.restorePiece(piece));
    const state = buildResolvedGarmentAssembly(snapshots, garment);
    const instanceById = new Map(
      state.instances.map((instance) => [instance.id, instance]),
    );

    expect(state.instances).toHaveLength(6);

    for (const stitch of state.stitchConstraints) {
      if (
        stitch.seamId.startsWith("fold:") ||
        !stitch.instanceA ||
        !stitch.instanceB ||
        stitch.instanceA === stitch.instanceB
      ) {
        continue;
      }

      const first = instanceById.get(stitch.instanceA)!;
      const second = instanceById.get(stitch.instanceB)!;
      const firstSide = first.placement.bodySide;
      const secondSide = second.placement.bodySide;

      if (firstSide !== "center" && secondSide !== "center") {
        expect(firstSide).toBe(secondSide);
      }
    }

    expect(countConnectedComponents(state)).toBe(1);
  });
});

function countConnectedComponents(
  state: ReturnType<typeof buildResolvedGarmentAssembly>,
): number {
  const adjacency = new Map(
    state.instances.map((instance) => [instance.id, new Set<string>()]),
  );

  for (const stitch of state.stitchConstraints) {
    if (!stitch.instanceA || !stitch.instanceB) continue;
    adjacency.get(stitch.instanceA)?.add(stitch.instanceB);
    adjacency.get(stitch.instanceB)?.add(stitch.instanceA);
  }

  let count = 0;
  const visited = new Set<string>();

  for (const instance of state.instances) {
    if (visited.has(instance.id)) continue;
    count += 1;
    const queue = [instance.id];
    visited.add(instance.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return count;
}
