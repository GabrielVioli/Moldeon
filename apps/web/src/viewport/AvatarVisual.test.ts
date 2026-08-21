import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { createAvatarVisual } from "./AvatarVisual";

describe("AvatarVisual canonical anatomy", () => {
  it("renders the HumanBodyModel visual LOD as one continuous mesh", () => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const visual = createAvatarVisual(avatar, {
      radialSegments: 18,
      castShadow: false,
      receiveShadow: false,
    });
    const meshes: THREE.Mesh[] = [];
    visual.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });

    expect(meshes).toHaveLength(1);
    expect(meshes[0].name).toBe("avatar:human-body");
    expect(meshes[0].userData.canonicalSurface).toBe(true);
    expect(meshes[0].geometry.getAttribute("position").count).toBe(avatar.humanBody.visualMesh.positions.length / 3);
    expect(meshes[0].geometry.index?.count).toBe(avatar.humanBody.visualMesh.indices.length);
  });
});
