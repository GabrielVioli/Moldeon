import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { buildAvatarParametricModel } from "./AvatarParametricModel";
import { projectAvatarBody2D, projectPoint } from "./BodyProjection2D";

describe("11.0.6 synchronized HumanBodyModel 2D projection", () => {
  it.each(["front", "back", "left", "right"] as const)("derives the %s silhouette and landmarks from the calibrated visual mesh", (view) => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const projection = projectAvatarBody2D(avatar, view);

    expect(projection.sourceTopologySignature).toBe(avatar.humanBody.visualMesh.topologySignature);
    expect(projection.silhouette.length).toBeGreaterThan(100);
    expect(projection.landmarks).toHaveLength(Object.keys(avatar.humanBody.landmarks).length);
    expect(projection.anchors.map((anchor) => anchor.id)).toContain("torso-front");
    expect(projection.anchors.map((anchor) => anchor.id)).toContain("arm-left");

    for (const landmark of projection.landmarks) {
      const source = avatar.humanBody.landmarks[landmark.id];
      const expected = projectPoint(source.position, view);
      expect(landmark.xMm).toBeCloseTo(expected.xMm, 8);
      expect(landmark.yMm).toBeCloseTo(expected.yMm, 8);
    }
  });

  it("preserves the absolute millimetre contract and view chirality", () => {
    expect(projectPoint([0, 0, 0], "front")).toEqual({ xMm: 0, yMm: -0 });
    expect(projectPoint([0.1, 0, 0], "front").xMm).toBeCloseTo(100, 10);
    expect(projectPoint([0.1, 0, 0], "back").xMm).toBeCloseTo(-100, 10);
    expect(projectPoint([0, 0, 0.1], "left").xMm).toBeCloseTo(100, 10);
    expect(projectPoint([0, 0, 0.1], "right").xMm).toBeCloseTo(-100, 10);
  });

  it("recomputes deterministically when body measurements change", () => {
    const base = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const wider = buildAvatarParametricModel({ ...DEFAULT_BODY_MEASUREMENTS, hipMm: DEFAULT_BODY_MEASUREMENTS.hipMm + 120 }, "feminine");
    const first = projectAvatarBody2D(base, "front");
    const repeated = projectAvatarBody2D(buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine"), "front");
    const changed = projectAvatarBody2D(wider, "front");
    const hipSpan = (projection: typeof first) => {
      const left = projection.anchors.find((anchor) => anchor.id === "hip-left")!;
      const right = projection.anchors.find((anchor) => anchor.id === "hip-right")!;
      return Math.abs(right.xMm - left.xMm);
    };

    expect(repeated).toEqual(first);
    // Overall front width is dominated by the T-pose fingertips. Measure the
    // actual hip anchors instead of mistaking that unrelated bound for body
    // calibration state.
    expect(hipSpan(changed)).toBeGreaterThan(hipSpan(first));
    expect(changed.sourceTopologySignature).toBe(first.sourceTopologySignature);
  });
});
