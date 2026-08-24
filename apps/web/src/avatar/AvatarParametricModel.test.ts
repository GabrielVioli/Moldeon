import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import {
  createDefaultMeasurementProfile,
  measurementProfileToBodyMeasurements,
  overrideMeasurement,
} from "../domain/parametricMeasurements";
import { buildAvatarCollisionModel } from "./AvatarCollisionModel";
import { buildAvatarParametricModel, resolveAvatarAnchor, sampleTorsoAxes } from "./AvatarParametricModel";

describe("AvatarParametricModel", () => {
  it("resolves independent regional measurements, neutral pose, anchors and collision proxies", () => {
    const model = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const collision = buildAvatarCollisionModel(model);

    expect(model.version).toBe("avatar-parametric@1");
    expect(model.anchors.map((anchor) => anchor.id)).toEqual(expect.arrayContaining([
      "torso-front",
      "torso-back",
      "arm-left",
      "arm-right",
      "waist-front",
      "hip-back",
      "hip-left",
      "hip-right",
      "leg-left",
      "leg-right",
      "neck",
      "head",
    ]));
    expect(model.joints.shoulderLeft[0]).toBeLessThan(0);
    expect(model.joints.shoulderRight[0]).toBeGreaterThan(0);
    expect(model.joints.wristLeft[0]).toBeLessThan(model.joints.shoulderLeft[0]);
    expect(model.joints.wristRight[0]).toBeGreaterThan(model.joints.shoulderRight[0]);
    expect(model.joints.ankleLeft[0]).toBeLessThan(0);
    expect(model.joints.ankleRight[0]).toBeGreaterThan(0);
    expect(model.armPoseAngleDeg).toBeGreaterThan(0);
    expect(model.legPoseAngleDeg).toBeGreaterThan(0);
    expect(collision.proxies.length).toBeGreaterThanOrEqual(12);
    expect(collision.proxies.every((proxy) => JSON.stringify(proxy).includes("NaN") === false)).toBe(true);
    expect(resolveAvatarAnchor(model, {
      region: "custom",
      surface: "custom",
      bodySide: "left",
      bodyAnchorId: "hip-left",
    })?.id).toBe("hip-left");
  });

  it("changes bust region without uniformly scaling stature or legs", () => {
    const baseline = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const largerBust = buildAvatarParametricModel({
      ...DEFAULT_BODY_MEASUREMENTS,
      bustMm: DEFAULT_BODY_MEASUREMENTS.bustMm + 180,
    }, "feminine");

    const baselineBust = sampleTorsoAxes(baseline, baseline.landmarks.bustY);
    const largerBustAxes = sampleTorsoAxes(largerBust, largerBust.landmarks.bustY);
    expect(largerBustAxes.halfWidth).toBeGreaterThan(baselineBust.halfWidth);
    expect(largerBust.landmarks.headTopY).toBeCloseTo(baseline.landmarks.headTopY, 6);
    expect(largerBust.joints.ankleLeft[1]).toBeCloseTo(baseline.joints.ankleLeft[1], 6);
    expect(largerBust.measurements.inseamMm).toBe(baseline.measurements.inseamMm);
  });

  it("preserves estimated versus supplied limb measurements from PatternDocumentV3", () => {
    const estimatedProfile = createDefaultMeasurementProfile("feminine");
    const flattened = measurementProfileToBodyMeasurements(estimatedProfile);
    const flattenedThigh = flattened.thighMm!;
    const estimated = buildAvatarParametricModel(flattened, "feminine", { profile: estimatedProfile });

    expect(flattenedThigh).toBeCloseTo(580, 6);
    expect(estimated.measurementOrigins?.thighMm).toBe("estimated");
    expect(estimated.measurements.thighMm).toBeLessThan(flattenedThigh - 80);

    const suppliedProfile = overrideMeasurement(estimatedProfile, "thighMm", 580).profile;
    const supplied = buildAvatarParametricModel(
      measurementProfileToBodyMeasurements(suppliedProfile),
      "feminine",
      { profile: suppliedProfile },
    );
    expect(supplied.measurementOrigins?.thighMm).toBe("supplied");
    expect(supplied.measurements.thighMm).toBeCloseTo(580, 6);
  });

  it("retains estimated origins from legacy V3 measurement key lists without a profile", () => {
    const profile = createDefaultMeasurementProfile("feminine");
    const flattened = measurementProfileToBodyMeasurements(profile);
    const avatar = buildAvatarParametricModel(flattened, "feminine", {
      origins: { thighMm: "estimated" },
    });

    expect(flattened.thighMm).toBeCloseTo(580, 6);
    expect(avatar.measurementOrigins?.thighMm).toBe("estimated");
    expect(avatar.measurements.thighMm).toBeLessThan(500);
  });
});
