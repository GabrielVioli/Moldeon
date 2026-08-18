import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "./AvatarParametricModel";
import { buildAvatarCollisionModel } from "./AvatarCollisionModel";
import { deepestBodyContact, packAvatarCollisionModel } from "../physics/bodyCollision";
import type { BodyMeasurements } from "../domain/pattern";

const EXPLICIT_BODY: BodyMeasurements = {
  heightMm: 1720,
  bustMm: 920,
  waistMm: 760,
  hipMm: 980,
  shoulderWidthMm: 420,
  torsoLengthMm: 620,
  armLengthMm: 600,
  inseamMm: 800,
  bicepMm: 310,
  wristMm: 170,
  thighMm: 570,
  calfMm: 370,
  ankleCircumferenceMm: 225,
  kneeHeightMm: 450,
  hipHeightMm: 190,
  bustHeightMm: 250,
};

describe("Prompt 11 avatar proxy junction coverage", () => {
  it("covers pelvis-to-thigh and chest-to-upper-arm joints without garment rules", () => {
    const avatar = buildAvatarParametricModel(EXPLICIT_BODY, "feminine");
    const collision = buildAvatarCollisionModel(avatar);
    const packed = packAvatarCollisionModel(collision);

    const points = [
      avatar.joints.hipLeft,
      avatar.joints.hipRight,
      avatar.joints.shoulderLeft,
      avatar.joints.shoulderRight,
    ] as const;
    for (const point of points) {
      const contact = deepestBodyContact(point, packed);
      expect(contact, `joint ${point.join(",")} should be inside the collision union`).not.toBeNull();
      expect(contact!.penetrationM).toBeGreaterThan(0);
    }
  });

  it("keeps the required P0 proxy set finite and deterministic", () => {
    const avatar = buildAvatarParametricModel(EXPLICIT_BODY, "masculine");
    const first = buildAvatarCollisionModel(avatar);
    const second = buildAvatarCollisionModel(avatar);
    expect(second).toEqual(first);
    const ids = new Set(first.proxies.map((proxy) => proxy.id));
    for (const id of [
      "collision:chest","collision:abdomen","collision:pelvis",
      "collision:upper-arm-left","collision:upper-arm-right",
      "collision:forearm-left","collision:forearm-right",
      "collision:thigh-left","collision:thigh-right",
      "collision:calf-left","collision:calf-right",
    ]) expect(ids.has(id)).toBe(true);
    expect(first.proxies).toHaveLength(12);
  });
});
