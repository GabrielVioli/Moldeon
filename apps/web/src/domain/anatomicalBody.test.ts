import { describe, expect, it } from "vitest";
import { createBodyLandmarks, deriveAnatomicalMeasurements, generateAnatomicalBodyMesh, inspectAnatomicalBodyMesh, stationCircumferences } from "./anatomicalBody";

const measurements = { heightMm: 1680, bustMm: 920, waistMm: 760, hipMm: 1000, shoulderWidthMm: 400, torsoLengthMm: 440, armLengthMm: 590, inseamMm: 780 };

describe("anatomical body", () => {
  it("derives new measurements for legacy documents", () => {
    expect(deriveAnatomicalMeasurements(measurements)).toMatchObject({ bicepMm: 303.6, wristMm: 165.6, thighMm: 580, calfMm: 380 });
  });

  it("keeps landmarks ordered and measurements coherent", () => {
    const landmarks = createBodyLandmarks(measurements);
    expect(landmarks.shoulderY).toBeGreaterThan(landmarks.bustY);
    expect(landmarks.bustY).toBeGreaterThan(landmarks.waistY);
    expect(stationCircumferences(measurements)).toEqual({ bustMm: 920, waistMm: 760, hipMm: 1000 });
  });

  it("generates finite low-poly geometry with valid indices", () => {
    const mesh = generateAnatomicalBodyMesh(measurements, "feminine");
    expect(inspectAnatomicalBodyMesh(mesh)).toMatchObject({ finite: true, indexBoundsValid: true });
    expect(inspectAnatomicalBodyMesh(mesh).vertexCount).toBeLessThan(5000);
    expect(inspectAnatomicalBodyMesh(mesh).triangleCount).toBeGreaterThan(0);
  });
});
