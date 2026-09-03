import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { buildAvatarParametricModel } from "./AvatarParametricModel";
import { projectAvatarBody2D, projectPoint, selectBodyReferenceSeedAnchor, shouldApplyBodyReferenceSeed } from "./BodyProjection2D";

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

  it("omits disconnected internal facial geometry that has no body bindings", () => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const baseline = projectAvatarBody2D(avatar, "front");
    const mesh = avatar.humanBody.visualMesh;
    const vertexCount = mesh.positions.length / 3;
    const positions = new Float32Array(mesh.positions.length + 9);
    positions.set(mesh.positions);
    positions.set([
      -0.02, avatar.landmarks.headCenterY, 0.08,
      0.02, avatar.landmarks.headCenterY, 0.08,
      0, avatar.landmarks.headCenterY - 0.02, 0.08,
    ], mesh.positions.length);
    const normals = new Float32Array(mesh.normals.length + 9);
    normals.set(mesh.normals);
    normals.set([0, 0, 1, 0, 0, 1, 0, 0, 1], mesh.normals.length);
    const indices = new Uint32Array(mesh.indices.length + 3);
    indices.set(mesh.indices);
    indices.set([vertexCount, vertexCount + 1, vertexCount + 2], mesh.indices.length);
    const synthetic = {
      ...avatar,
      humanBody: {
        ...avatar.humanBody,
        visualMesh: { ...mesh, positions, normals, indices },
      },
    };

    expect(projectAvatarBody2D(synthetic, "front").silhouette).toEqual(baseline.silhouette);
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

  it("uses the 2D view to seed opposite geometric body hemispheres", () => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const point = { xMm: 0, yMm: -avatar.landmarks.waistY * 1000 };
    const front = selectBodyReferenceSeedAnchor(avatar, projectAvatarBody2D(avatar, "front"), point);
    const back = selectBodyReferenceSeedAnchor(avatar, projectAvatarBody2D(avatar, "back"), point);
    expect(front).toBeDefined();
    expect(back).toBeDefined();

    const centerZ = (avatar.humanBody.visualMesh.bounds.min[2] + avatar.humanBody.visualMesh.bounds.max[2]) * 0.5;
    const depth = (id: string) => avatar.anchors.find((anchor) => anchor.id === id)!.position[2] - centerZ;
    expect(depth(front!.anchor.id)).toBeGreaterThan(0);
    expect(depth(back!.anchor.id)).toBeLessThan(0);
    expect(front!.anchor.id).not.toBe(back!.anchor.id);
  });

  it("keeps the absolute material scale out of view-aware seed selection", () => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const projection = projectAvatarBody2D(avatar, "front");
    const selected = selectBodyReferenceSeedAnchor(avatar, projection, { xMm: 100, yMm: -avatar.landmarks.hipY * 1000 });
    expect(selected).toBeDefined();
    expect(projectPoint([0.1, 0, 0], "front").xMm).toBe(100);
  });

  it("never overwrites an existing authored 3D arrangement", () => {
    const base = {
      id: "panel-instance",
      pieceId: "panel",
      region: "torso" as const,
      surface: "front" as const,
      bodySide: "center" as const,
      rotationDeg: 0,
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 25,
      scale: 1,
    };
    expect(shouldApplyBodyReferenceSeed(undefined)).toBe(true);
    expect(shouldApplyBodyReferenceSeed({ ...base, bodyAnchorId: "torso-front" })).toBe(true);
    expect(shouldApplyBodyReferenceSeed({ ...base, presentationMode: "authored" })).toBe(false);
    expect(shouldApplyBodyReferenceSeed({ ...base, positionMm: [0, 1, -0.2] })).toBe(false);
    expect(shouldApplyBodyReferenceSeed({
      ...base,
      surfaceAttachment: {
        version: 1,
        topologySignature: "body-test",
        triangleIndex: 0,
        barycentric: [1, 0, 0],
        normalOffsetMm: 25,
      },
    })).toBe(false);
  });
});
