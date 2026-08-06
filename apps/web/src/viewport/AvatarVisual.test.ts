import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { createAvatarVisual } from "./AvatarVisual";

describe("AvatarVisual coverage", () => {
  it("omits covered internal shells while preserving visible human extremities", () => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const visual = createAvatarVisual(avatar, {
      radialSegments: 10,
      castShadow: false,
      receiveShadow: false,
      hiddenPartNames: new Set(["avatar:chest", "avatar:pelvis", "avatar:thigh-left"]),
    });
    const names = new Set<string>();
    visual.traverse((object) => names.add(object.name));
    expect(names.has("avatar:chest")).toBe(false);
    expect(names.has("avatar:pelvis")).toBe(false);
    expect(names.has("avatar:thigh-left")).toBe(false);
    expect(names.has("avatar:head")).toBe(true);
    expect(names.has("avatar:hand-left")).toBe(true);
    expect(names.has("avatar:foot-left")).toBe(true);
  });
});
