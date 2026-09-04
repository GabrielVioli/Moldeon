import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildSewingStep0Registration,
  resolveSewingStep0Target,
  transformSewingStep0Point,
} from "./SewingStep0";

function constraint(instanceA: string, instanceB: string, seamId: string, seamGroupId = seamId) {
  return { instanceA, instanceB, seamId, seamGroupId };
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
});
