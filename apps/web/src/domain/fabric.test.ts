import { describe, expect, it } from "vitest";
import {
  applyFabricPreset,
  availableFabricAreaMm2,
  createDefaultFabricSource,
  createFabricSource,
  fabricDrapeFactor,
  parseFabricSources,
} from "./fabric";

describe("fabric sources", () => {
  it("creates independent fabric sources for upcycled projects", () => {
    const cotton = createFabricSource("cotton");
    const denim = createFabricSource("denim", 1);

    expect(cotton.id).not.toBe(denim.id);
    expect(cotton.presetId).toBe("cotton");
    expect(denim.presetId).toBe("denim");
  });

  it("changes the physical and visual preset without changing inventory size", () => {
    const source = {
      ...createDefaultFabricSource(),
      widthMm: 900,
      lengthMm: 650,
      quantity: 2,
    };
    const updated = applyFabricPreset(source, "viscose");

    expect(updated.presetId).toBe("viscose");
    expect(updated.physics.bending).toBeLessThan(source.physics.bending);
    expect(updated.widthMm).toBe(900);
    expect(updated.lengthMm).toBe(650);
    expect(updated.quantity).toBe(2);
  });

  it("derives a visibly softer drape for viscose than denim", () => {
    const viscose = createFabricSource("viscose");
    const denim = createFabricSource("denim");

    expect(fabricDrapeFactor(viscose)).toBeGreaterThan(
      fabricDrapeFactor(denim),
    );
  });

  it("calculates available area from dimensions and quantity", () => {
    const source = {
      ...createDefaultFabricSource(),
      widthMm: 1000,
      lengthMm: 800,
      quantity: 2,
    };
    expect(availableFabricAreaMm2(source)).toBe(1_600_000);
  });

  it("rejects malformed persisted colors and dimensions", () => {
    const source = createDefaultFabricSource();
    expect(() =>
      parseFabricSources([{ ...source, color: "blue" }]),
    ).toThrow(/cor/i);
    expect(() =>
      parseFabricSources([{ ...source, widthMm: 0 }]),
    ).toThrow(/largura/i);
  });
});
