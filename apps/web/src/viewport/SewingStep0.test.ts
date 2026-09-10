import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  analyzeSewingStep0BodyFit,
  buildSewingStep0Registration,
  resolveSewingStep0Target,
  transformSewingStep0Point,
} from "./SewingStep0";

function constraint(instanceA: string, instanceB: string, seamId: string, seamGroupId = seamId) {
  return { instanceA, instanceB, seamId, seamGroupId };
}


function selfSeamFitState(circumferenceMm: number) {
  return {
    positions: new Float32Array(12),
    initialPositions: new Float32Array(12),
    previousPositions: new Float32Array(12),
    inverseMasses: new Float32Array(4),
    instances: [{
      id: "tube",
      particleStart: 0,
      vertexCount: 4,
      topology: {
        positions2DMm: new Float32Array([
          0, 0,
          circumferenceMm, 0,
          circumferenceMm, 300,
          0, 300,
        ]),
        triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
      },
    }],
    structuralConstraints: [],
    stitchConstraints: [0, 1, 2].map((index) => ({
      id: `self:${index}`,
      seamId: "self",
      seamGroupId: "self",
      treatment: "plain",
      distribution: "uniform",
      targetRatio: 1,
      slackMm: 0,
      a: { particleIndices: [index === 2 ? 3 : 0], weights: [1] },
      b: { particleIndices: [index === 2 ? 2 : 1], weights: [1] },
      restDistance: 0,
      physicalRestDistance: 0,
      stiffness: 1,
      instanceA: "tube",
      instanceB: "tube",
      progress: index / 2,
    })),
    anchorConstraints: [],
    warnings: [],
    invalid: false,
  } as any;
}

describe("11.0.8 STEP-0 target and rigid registration", () => {
  it("solves only the selected active sewn component and ignores darts", () => {
    const target = resolveSewingStep0Target([
      constraint("a", "b", "seam-1"),
      constraint("b", "c", "seam-2"),
      constraint("c", "d", "dart-1", "dart:waist"),
      constraint("x", "y", "seam-3"),
    ], "seam-1", []);
    expect(target?.rootInstanceId).toBe("a");
    expect(new Set(target?.instanceIds)).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not silently fall back to another relation when the selected seam is inactive/missing", () => {
    expect(resolveSewingStep0Target([
      constraint("a", "b", "seam-1"),
    ], "inactive-seam", [])).toBeNull();
  });

  it("keeps a valid self-sewn physical panel as a one-panel STEP-0 target", () => {
    const target = resolveSewingStep0Target([
      constraint("tube", "tube", "self-seam"),
    ], "self-seam", []);
    expect(target).toEqual({ rootInstanceId: "tube", instanceIds: ["tube"] });
  });

  it("registers solver coordinates onto the authored root frame with rotation only", () => {
    const solved = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const current = new Float32Array([
      10, 20, 30,
      10, 21, 30,
      9, 20, 30,
    ]);
    const triangles = new Uint32Array([0, 1, 2]);
    const registration = buildSewingStep0Registration(solved, current, triangles);
    expect(registration).not.toBeNull();
    const mappedA = transformSewingStep0Point(new THREE.Vector3(0, 0, 0), registration!);
    const mappedB = transformSewingStep0Point(new THREE.Vector3(1, 0, 0), registration!);
    expect(mappedA.distanceTo(mappedB)).toBeCloseTo(1, 8);
    expect(registration!.solvedRootCentroid.clone()
      .applyQuaternion(registration!.rotation)
      .sub(registration!.solvedRootCentroid.clone().applyQuaternion(registration!.rotation))
      .length()).toBeCloseTo(0, 8);
    const mappedCentroid = transformSewingStep0Point(registration!.solvedRootCentroid, registration!);
    expect(mappedCentroid.distanceTo(registration!.currentRootCentroid)).toBeLessThan(1e-8);
  });

  it("pins the same authored material vertex while discarding the solver pose", () => {
    const solved = new Float32Array([
      4, 7, 2,
      5, 7, 2,
      4, 8, 2,
    ]);
    const current = new Float32Array([
      -3, 1, 9,
      -3, 2, 9,
      -4, 1, 9,
    ]);
    const registration = buildSewingStep0Registration(
      solved,
      current,
      new Uint32Array([0, 1, 2]),
      1,
    );
    expect(registration).not.toBeNull();
    const mappedAnchor = transformSewingStep0Point(new THREE.Vector3(5, 7, 2), registration!);
    expect(mappedAnchor.distanceTo(new THREE.Vector3(-3, 2, 9))).toBeLessThan(1e-8);
  });

  it("accepts 1020 mm around a 1000 mm full hip within the 2% material contract", () => {
    const state = selfSeamFitState(1020);
    const fit = analyzeSewingStep0BodyFit(state, { rootInstanceId: "tube", instanceIds: ["tube"] }, {
      id: "full-hip",
      region: "full-hip",
      yM: 0.9,
      targetCircumferenceMm: 1000,
      actualCircumferenceMm: 1000,
      halfWidthM: 0.16,
      frontDepthM: 0.09,
      backDepthM: 0.11,
      centerZM: 0,
    frontLobeM: 0,
      backLobeM: 0,
      lobeHalfDistanceM: 0,
      }, 0.0005);
    expect(fit.status).toBe("fits");
    expect(fit.materialCircumferenceMm).toBeCloseTo(1020, 3);
    expect(fit.requiredCircumferenceMm).toBeGreaterThan(1000);
    expect(fit.stretchRequiredPercent).toBe(0);
  });

  it("rejects a 435 mm loop quantitatively instead of pretending it fits a 1000 mm hip", () => {
    const state = selfSeamFitState(435);
    const fit = analyzeSewingStep0BodyFit(state, { rootInstanceId: "tube", instanceIds: ["tube"] }, {
      id: "full-hip",
      region: "full-hip",
      yM: 0.9,
      targetCircumferenceMm: 1000,
      actualCircumferenceMm: 1000,
      halfWidthM: 0.16,
      frontDepthM: 0.09,
      backDepthM: 0.11,
      centerZM: 0,
    frontLobeM: 0,
      backLobeM: 0,
      lobeHalfDistanceM: 0,
      }, 0.0005);
    expect(fit.status).toBe("insufficient-circumference");
    expect(fit.materialCircumferenceMm).toBeCloseTo(435, 3);
    expect(fit.requiredCircumferenceMm).toBeGreaterThan(1000);
    expect(fit.stretchRequiredPercent!).toBeGreaterThan(100);
  });

});
