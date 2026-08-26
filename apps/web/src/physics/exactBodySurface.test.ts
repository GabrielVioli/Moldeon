import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { BodyMeasurements } from "../domain/pattern";
import {
  closestPointOnExactBody,
  createExactBodySurfaceRuntime,
  packHumanBodyMesh,
  pointInsideExactBody,
  sweptPointAgainstExactBody,
  validatePackedBodyMesh,
  type PackedBodyMesh,
} from "./exactBodySurface";

describe("11.0.5 exact human surface core", () => {
  it("validates a closed outward manifold and rejects an open surface", () => {
    const cube = cubeMesh();
    expect(validatePackedBodyMesh(cube)).toMatchObject({
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      degenerateTriangleCount: 0,
      outward: true,
      watertight: true,
      valid: true,
    });
    expect(validatePackedBodyMesh({ ...cube, indices: cube.indices.slice(0, -3) })).toMatchObject({
      watertight: false,
      valid: false,
    });
  });

  it("returns signed closest points and smooth outward pseudo normals", () => {
    const runtime = createExactBodySurfaceRuntime(cubeMesh());
    expect(pointInsideExactBody(runtime, [0, 0, 0])).toBe(true);
    expect(pointInsideExactBody(runtime, [2, 0, 0])).toBe(false);
    const outside = closestPointOnExactBody(runtime, [2, 0, 0]);
    expect(outside.point[0]).toBeCloseTo(1, 6);
    expect(outside.signedDistanceM).toBeCloseTo(1, 6);
    expect(outside.normal[0]).toBeGreaterThan(0.5);
    const inside = closestPointOnExactBody(runtime, [0.8, 0, 0]);
    expect(inside.signedDistanceM).toBeCloseTo(-0.2, 6);
  });

  it("detects a fast outside-to-inside trajectory before the endpoint", () => {
    const runtime = createExactBodySurfaceRuntime(cubeMesh());
    const hit = sweptPointAgainstExactBody(runtime, [2, 0.2, 0.1], [0, 0.2, 0.1], 0.01);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThan(0.45);
    expect(hit!.t).toBeLessThan(0.51);
    expect(hit!.normal[0]).toBeGreaterThan(0.5);
  });

  it("packs the exact final human visual buffers with topology parity", () => {
    const avatar = buildAvatarParametricModel(MEASUREMENTS, "feminine");
    const packed = packHumanBodyMesh(avatar.humanBody.visualMesh);
    const collision = avatar.humanBody.collisionMesh;
    expect(packed.topologySignature).toBe(avatar.humanBody.visualMesh.topologySignature);
    expect(packed.positions).toEqual(collision.positions);
    expect(packed.indices).toEqual(collision.indices);
    expect(validatePackedBodyMesh(packed)).toMatchObject({
      vertexCount: 16_364,
      triangleCount: 32_508,
      valid: true,
    });
  }, 30_000);

  it("classifies inside/outside contact around anatomical regions, hands and feet", () => {
    const avatar = buildAvatarParametricModel(MEASUREMENTS, "feminine");
    const mesh = avatar.humanBody.visualMesh;
    const runtime = createExactBodySurfaceRuntime(packHumanBodyMesh(mesh));
    const regions = [
      "neck", "bust-left", "back-upper", "waist", "abdomen", "pelvis",
      "thigh-left", "knee-left", "calf-left",
      "ankle-left",
    ] as const;
    const vertices = regions.map((region) => {
      const vertex = mesh.regionIds.findIndex((value) => value === region);
      expect(vertex, `missing ${region}`).toBeGreaterThanOrEqual(0);
      return vertex;
    });
    vertices.push(
      avatar.humanBody.landmarks["glute-left"].binding.vertexIndices[0],
      avatar.humanBody.landmarks["crotch-front"].binding.vertexIndices[0],
      avatar.humanBody.landmarks["crotch-back"].binding.vertexIndices[0],
      avatar.humanBody.landmarks["elbow-left"].binding.vertexIndices[0],
      avatar.humanBody.landmarks["wrist-left"].binding.vertexIndices[0],
    );
    vertices.push(extremeVertex(mesh.positions, 0, -1), extremeVertex(mesh.positions, 0, 1));
    vertices.push(extremeVertex(mesh.positions, 1, -1));
    for (const [sampleIndex, vertex] of vertices.entries()) {
      const { point, normal } = incidentTriangleSample(mesh.positions, mesh.indices, vertex);
      const outside = point.map((value, axis) => value + normal[axis] * 0.001) as [number, number, number];
      const inside = point.map((value, axis) => value - normal[axis] * 0.001) as [number, number, number];
      expect(closestPointOnExactBody(runtime, outside, false).signedDistanceM, `outside sample ${sampleIndex}:${vertex}`).toBeGreaterThan(0);
      expect(closestPointOnExactBody(runtime, inside).signedDistanceM, `inside sample ${sampleIndex}:${vertex}`).toBeLessThanOrEqual(0.00005);
    }
  }, 30_000);
});

function extremeVertex(positions: Float32Array, axis: 0 | 1 | 2, direction: -1 | 1): number {
  let best = 0;
  for (let vertex = 1; vertex < positions.length / 3; vertex += 1) {
    if (positions[vertex * 3 + axis] * direction > positions[best * 3 + axis] * direction) best = vertex;
  }
  return best;
}

function incidentTriangleSample(positions: Float32Array, indices: Uint32Array, vertex: number) {
  for (let offset = 0; offset < indices.length; offset += 3) {
    if (indices[offset] !== vertex && indices[offset + 1] !== vertex && indices[offset + 2] !== vertex) continue;
    const result: [number, number, number] = [0, 0, 0];
    for (let corner = 0; corner < 3; corner += 1) {
      const pointOffset = indices[offset + corner] * 3;
      result[0] += positions[pointOffset] / 3;
      result[1] += positions[pointOffset + 1] / 3;
      result[2] += positions[pointOffset + 2] / 3;
    }
    const point = (corner: number): [number, number, number] => {
      const pointOffset = indices[offset + corner] * 3;
      return [positions[pointOffset], positions[pointOffset + 1], positions[pointOffset + 2]];
    };
    const a = point(0); const b = point(1); const c = point(2);
    const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: [number, number, number] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(...cross);
    return { point: result, normal: cross.map((value) => value / length) as [number, number, number] };
  }
  throw new RangeError(`vertex ${vertex} has no incident triangle`);
}

function cubeMesh(): PackedBodyMesh {
  const positions = Float32Array.from([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const normals = new Float32Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const length = Math.hypot(positions[offset], positions[offset + 1], positions[offset + 2]);
    normals[offset] = positions[offset] / length;
    normals[offset + 1] = positions[offset + 1] / length;
    normals[offset + 2] = positions[offset + 2] / length;
  }
  return {
    positions,
    normals,
    indices: Uint32Array.from([
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5,
    ]),
    topologySignature: "fixture:cube",
  };
}

const MEASUREMENTS: BodyMeasurements = {
  heightMm: 1680,
  bustMm: 900,
  waistMm: 700,
  hipMm: 980,
  shoulderWidthMm: 400,
  torsoLengthMm: 600,
  armLengthMm: 580,
  inseamMm: 780,
  bicepMm: 290,
  wristMm: 165,
  thighMm: 550,
  calfMm: 360,
  ankleCircumferenceMm: 220,
  kneeHeightMm: 440,
  hipHeightMm: 190,
  bustHeightMm: 250,
};
