import { describe, expect, it } from "vitest";
import { createAllParametricBodyFixtures } from "../testFixtures/parametricBodyFixtures";
import {
  BODY_MEASUREMENT_CATALOG,
  changeMeasurementBodyType,
  createMeasurementProfile,
  measurementProfileToBodyMeasurements,
  overrideMeasurement,
  parseMeasurementProfile,
  resetMeasurementOverride,
  serializeMeasurementProfile,
  updateMeasurementFormula,
} from "./parametricMeasurements";

const BASE = {
  heightMm: 1680,
  bustMm: 920,
  waistMm: 760,
  hipMm: 1000,
  shoulderWidthMm: 400,
  torsoLengthMm: 440,
  armLengthMm: 590,
  inseamMm: 780,
};

describe("parametricMeasurements", () => {
  it("resolves all catalog measurements for varied body proportions", () => {
    for (const fixture of createAllParametricBodyFixtures()) {
      const resolved = measurementProfileToBodyMeasurements(fixture.profile);
      for (const item of BODY_MEASUREMENT_CATALOG) {
        expect(resolved[item.key], `${fixture.id}:${String(item.key)}`).toBeTypeOf("number");
        expect(resolved[item.key]!, `${fixture.id}:${String(item.key)}`).toBeGreaterThanOrEqual(0);
      }
      expect(resolved.heightMm).toBe(fixture.supplied.heightMm);
      expect(resolved.bustMm).toBe(fixture.supplied.bustMm);
    }
  });

  it("distinguishes supplied, estimated and derived measurements", () => {
    const profile = createMeasurementProfile(BASE, "feminine");
    expect(profile.entries.heightMm?.origin).toBe("supplied");
    expect(profile.entries.neckCircumferenceMm?.origin).toBe("estimated");
    expect(profile.entries.neckWidthMm?.origin).toBe("derived");
  });

  it("allows an estimate to be overridden and restored", () => {
    const profile = createMeasurementProfile(BASE, "feminine");
    const estimated = profile.entries.bicepMm!.value;
    const overridden = overrideMeasurement(profile, "bicepMm", estimated + 37);
    expect(overridden.accepted).toBe(true);
    expect(overridden.profile.entries.bicepMm?.origin).toBe("supplied");
    expect(overridden.profile.entries.bicepMm?.overridden).toBe(true);
    expect(overridden.measurements.bicepMm).toBeCloseTo(estimated + 37, 8);

    const restored = resetMeasurementOverride(overridden.profile, "bicepMm");
    expect(restored.accepted).toBe(true);
    expect(restored.profile.entries.bicepMm?.origin).toBe("estimated");
    expect(restored.measurements.bicepMm).toBeCloseTo(estimated, 8);
  });

  it("recomputes dependents after an authoritative measurement changes", () => {
    const profile = createMeasurementProfile(BASE, "feminine");
    const before = profile.entries.neckWidthMm!.value;
    const result = overrideMeasurement(profile, "bustMm", 1100);
    expect(result.recomputed).toContain("neckCircumferenceMm");
    expect(result.recomputed).toContain("neckWidthMm");
    expect(result.profile.entries.neckWidthMm!.value).not.toBe(before);
  });

  it("does not replace a valid profile when a custom formula is invalid", () => {
    const profile = createMeasurementProfile(BASE, "feminine");
    const previous = profile.entries.bicepMm!.value;
    const invalid = updateMeasurementFormula(profile, "bicepMm", "bustMm / 0");
    expect(invalid.accepted).toBe(false);
    expect(invalid.profile.entries.bicepMm!.value).toBe(previous);
  });

  it("accepts a custom formula and updates its dependents", () => {
    const profile = createMeasurementProfile(BASE, "feminine");
    const result = updateMeasurementFormula(profile, "bicepMm", "bustMm * 0.4");
    expect(result.accepted).toBe(true);
    expect(result.measurements.bicepMm).toBeCloseTo(368, 8);
    expect(result.measurements.elbowCircumferenceMm).toBeCloseTo(312.8, 8);
  });

  it("keeps supplied measurements authoritative when body defaults change", () => {
    const profile = createMeasurementProfile(BASE, "feminine");
    const changed = changeMeasurementBodyType(profile, "masculine");
    expect(changed.entries.heightMm?.value).toBe(BASE.heightMm);
    expect(changed.entries.bustMm?.value).toBe(BASE.bustMm);
    expect(changed.entries.shoulderSlopeDeg?.value).toBe(12);
  });

  it("round trips a versioned profile without changing formulas", () => {
    const profile = createMeasurementProfile(BASE, "feminine");
    const serialized = serializeMeasurementProfile(profile);
    const restored = parseMeasurementProfile(JSON.parse(serialized));
    expect(serializeMeasurementProfile(restored)).toBe(serialized);
  });
});
