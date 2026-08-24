import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { AVATAR_FLOOR_CLEARANCE_M, resolveAvatarFloorPosition } from "./AvatarGroundPlane";

describe("registered avatar ground plane", () => {
  it("keeps the floor below the transformed feet instead of fixed at world zero", () => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const translation: [number, number, number] = [0.31, -0.82, -0.17];
    const floor = resolveAvatarFloorPosition(avatar, {
      translation,
      rotation: [0, 0, 0, 1],
    });

    expect(floor[0]).toBeCloseTo(translation[0], 8);
    expect(floor[1]).toBeCloseTo(translation[1] + avatar.landmarks.groundY - AVATAR_FLOOR_CLEARANCE_M, 8);
    expect(floor[2]).toBeCloseTo(translation[2], 8);
  });
});
