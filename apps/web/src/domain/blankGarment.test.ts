import { describe, expect, it } from "vitest";
import { createBlankGarment } from "./blankGarment";
import { createDefaultMeasurementProfile } from "./parametricMeasurements";

describe("blank garment", () => {
  it("creates a real empty project without an automatic template generation", () => {
    const profile = createDefaultMeasurementProfile("masculine");
    const garment = createBlankGarment(profile);

    expect(garment.templateId).toBe("blank");
    expect(garment.bodyType).toBe("masculine");
    expect(garment.pieces).toEqual([]);
    expect(garment.seams).toEqual([]);
    expect(garment.parametric).toBeUndefined();
    expect(garment.fabrics).toHaveLength(1);
  });
});
