import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { BodyMeasurements } from "../domain/pattern";
import {
  closestPointOnExactBody,
  createExactBodySurfaceRuntime,
  packHumanBodyMesh,
  segmentCrossingExactBody,
} from "./exactBodySurface";

describe("11.0.5 exact body BVH performance", () => {
  it("keeps cold construction and warm human-surface queries bounded", () => {
    const avatar = buildAvatarParametricModel(MEASUREMENTS, "feminine");
    const runtime = createExactBodySurfaceRuntime(packHumanBodyMesh(avatar.humanBody.visualMesh));
    const mesh = runtime.mesh;
    const samples: Array<[number, number, number]> = [];
    for (let vertex = 0; vertex < mesh.positions.length / 3 && samples.length < 1_000; vertex += 16) {
      const offset = vertex * 3;
      samples.push([
        mesh.positions[offset] + mesh.normals[offset] * 0.004,
        mesh.positions[offset + 1] + mesh.normals[offset + 1] * 0.004,
        mesh.positions[offset + 2] + mesh.normals[offset + 2] * 0.004,
      ]);
    }
    for (const point of samples.slice(0, 50)) closestPointOnExactBody(runtime, point, false);
    runtime.queries = 0;
    runtime.bvhNodeVisits = 0;
    runtime.triangleTests = 0;
    const warmStarted = performance.now();
    for (const point of samples) closestPointOnExactBody(runtime, point, false);
    const warmMs = performance.now() - warmStarted;
    const segmentStarted = performance.now();
    let segmentHits = 0;
    for (let index = 0; index < 200; index += 1) {
      const y = 0.72 + index * 0.002;
      if (segmentCrossingExactBody(runtime, [-0.45, y, 0], [0.45, y, 0])) segmentHits += 1;
    }
    const segmentMs = performance.now() - segmentStarted;
    const report = {
      bvhBuildMs: runtime.bvh.buildMs,
      bvhNodes: runtime.bvh.nodeCount,
      queries: samples.length,
      warmMs,
      averageNodeVisits: runtime.bvhNodeVisits / Math.max(1, runtime.queries + 200),
      averageTriangleTests: runtime.triangleTests / Math.max(1, runtime.queries + 200),
      segmentMs,
      segmentHits,
    };
    console.log("P1105_EXACT_BODY_BENCH", JSON.stringify(report));
    expect(runtime.bvh.buildMs).toBeLessThan(5_000);
    expect(warmMs).toBeLessThan(2_000);
    expect(report.averageTriangleTests).toBeLessThan(250);
    expect(segmentHits).toBeGreaterThan(0);
  }, 30_000);
});

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
