import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import {
  buildHumanBodyModel,
  inspectHumanBodyMesh,
  measureHumanBodyMeshCircumferenceAtY,
} from "./HumanBodyModel";

const tolerance = (targetMm: number) => Math.max(5, targetMm * 0.01);

describe("HumanBodyModel canonical female anatomy", () => {
  it("builds one watertight manifold anatomy for both visual and collision LODs", () => {
    const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS, { disableCache: true });
    const visual = inspectHumanBodyMesh(body.visualMesh);
    const collision = inspectHumanBodyMesh(body.collisionMesh);

    expect(body.version).toBe("human-body-female@1");
    expect(body.bodyFrame.units).toBe("m");
    expect(body.bodyFrame.measurementUnits).toBe("mm");
    expect(body.bodyFrame.up).toEqual([0, 1, 0]);
    expect(body.bodyFrame.front).toEqual([0, 0, 1]);
    expect(body.bodyFrame.left).toEqual([-1, 0, 0]);
    expect(body.bodyFrame.right).toEqual([1, 0, 0]);

    for (const diagnostics of [visual, collision]) {
      expect(diagnostics.finite).toBe(true);
      expect(diagnostics.vertexCount).toBeGreaterThan(1000);
      expect(diagnostics.triangleCount).toBeGreaterThan(1500);
      expect(diagnostics.boundaryEdgeCount).toBe(0);
      expect(diagnostics.nonManifoldEdgeCount).toBe(0);
      expect(diagnostics.degenerateTriangleCount).toBe(0);
      expect(diagnostics.normalsConsistent).toBe(true);
      expect(diagnostics.signedVolumeM3).toBeGreaterThan(0);
    }
  }, 30_000);

  it("keeps critical torso circumferences within fitting tolerance on the generated surface", () => {
    const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS);
    const bustY = body.landmarks["bust-apex-left"].position[1];
    const waistY = body.landmarks["center-front-waist"].position[1];
    const hipY = body.landmarks["full-hip-front"].position[1];

    const bust = measureHumanBodyMeshCircumferenceAtY(body.visualMesh, bustY);
    const waist = measureHumanBodyMeshCircumferenceAtY(body.visualMesh, waistY);
    const hip = measureHumanBodyMeshCircumferenceAtY(body.visualMesh, hipY);

    expect(Math.abs(bust - body.measurements.bustMm)).toBeLessThanOrEqual(tolerance(body.measurements.bustMm));
    expect(Math.abs(waist - body.measurements.waistMm)).toBeLessThanOrEqual(tolerance(body.measurements.waistMm));
    expect(Math.abs(hip - body.measurements.fullHipMm)).toBeLessThanOrEqual(tolerance(body.measurements.fullHipMm));
    expect(Math.abs(body.diagnostics.measurementErrorsMm.shoulderWidth)).toBeLessThanOrEqual(5);
    expect(Math.abs(body.diagnostics.measurementErrorsMm.armLength)).toBeLessThanOrEqual(5);
    expect(Math.abs(body.diagnostics.measurementErrorsMm.inseam)).toBeLessThanOrEqual(5);
  }, 30_000);

  it("has distinct female torso stations, front/back volume and a real crotch split", () => {
    const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS);
    const bust = body.crossSections.find((section) => section.id === "bust")!;
    const waist = body.crossSections.find((section) => section.id === "waist")!;
    const hip = body.crossSections.find((section) => section.id === "full-hip")!;

    expect(bust.halfWidthM).toBeGreaterThan(waist.halfWidthM);
    expect(hip.halfWidthM).toBeGreaterThan(waist.halfWidthM);
    expect(bust.frontDepthM + bust.frontLobeM).toBeGreaterThan(bust.backDepthM);
    expect(hip.backDepthM + hip.backLobeM).toBeGreaterThan(hip.frontDepthM);

    expect(body.landmarks["bust-apex-left"].position[0]).toBeLessThan(0);
    expect(body.landmarks["bust-apex-right"].position[0]).toBeGreaterThan(0);
    expect(body.landmarks["inseam-top-left"].position[0]).toBeLessThan(0);
    expect(body.landmarks["inseam-top-right"].position[0]).toBeGreaterThan(0);

    const crotchY = body.landmarks["inseam-top-left"].position[1];
    let nearestCenterX = Number.POSITIVE_INFINITY;
    for (let vertex = 0; vertex < body.visualMesh.positions.length / 3; vertex += 1) {
      const x = body.visualMesh.positions[vertex * 3];
      const y = body.visualMesh.positions[vertex * 3 + 1];
      if (y < crotchY - 0.04 && y > crotchY - 0.13) nearestCenterX = Math.min(nearestCenterX, Math.abs(x));
    }
    expect(nearestCenterX).toBeGreaterThan(0.008);
  }, 30_000);

  it("derives visual and collision LODs from the same anatomy", () => {
    const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS);
    expect(body.collisionMesh.positions.length).toBeLessThan(body.visualMesh.positions.length);
    expect(body.diagnostics.maxLodSectionDeltaMm).toBeLessThanOrEqual(15);
    expect(body.surfaceRegions.map((region) => region.id)).toEqual(expect.arrayContaining([
      "neck",
      "bust-left",
      "bust-right",
      "waist",
      "full-hip",
      "glute-left",
      "glute-right",
      "crotch",
      "thigh-left",
      "thigh-right",
      "upper-arm-left",
      "upper-arm-right",
    ]));
    expect(body.editorMeasurementsMm.quarterWaist).toBe(body.measurements.waistMm / 4);
    expect(body.editorMeasurementsMm.quarterHip).toBe(body.measurements.fullHipMm / 4);
  }, 30_000);
});
