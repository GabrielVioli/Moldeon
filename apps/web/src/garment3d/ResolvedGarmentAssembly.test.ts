import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_MEASUREMENTS,
  createGarmentFromTemplate,
} from "../patterns/templateCatalog";
import { buildResolvedGarmentAssembly } from "./ResolvedGarmentAssembly";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";

describe("ResolvedGarmentAssembly", () => {
  it("uses only persisted seam groups and never synthesizes template stitches", () => {
    const garment = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const state = buildResolvedGarmentAssembly(buildResolvedAssemblyInput(garment));
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

    const persistedSeamIds = new Set((garment.seams ?? []).map((seam) => seam.id));
    expect(state.stitchConstraints.every((stitch) =>
      stitch.seamId.startsWith("fold:")
      || stitch.seamId.startsWith("dart:")
      || persistedSeamIds.has(stitch.seamId),
    )).toBe(true);
    expect(state.stitchConstraints.some((stitch) => stitch.seamId.startsWith("template-seam:"))).toBe(false);
  });
});
