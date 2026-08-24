import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import type { BodyMeasurements } from "../domain/pattern";
import {
  buildHumanBodyModel,
  inspectHumanBodyMesh,
  measureHumanBodyMeshCircumferenceAtY,
} from "./HumanBodyModel";

const tolerance = (targetMm: number) => Math.max(5, targetMm * 0.01);

const FEMALE_PROFILES: ReadonlyArray<{ id: string; measurements: BodyMeasurements }> = [
  {
    id: "compact",
    measurements: {
      heightMm: 1550, bustMm: 820, waistMm: 650, hipMm: 900,
      shoulderWidthMm: 360, torsoLengthMm: 400, armLengthMm: 530, inseamMm: 700,
      neckCircumferenceMm: 320, highBustMm: 760, bustHeightMm: 235, bustSpanMm: 165,
      hipHeightMm: 175, crotchDepthMm: 240, insideLegLengthMm: 700, outseamLengthMm: 940,
      thighMm: 520, kneeCircumferenceMm: 350, calfMm: 340, ankleCircumferenceMm: 210,
      bicepMm: 270, elbowCircumferenceMm: 235, wristMm: 145, headCircumferenceMm: 535,
    },
  },
  {
    id: "curvy",
    measurements: {
      heightMm: 1650, bustMm: 1080, waistMm: 800, hipMm: 1160,
      shoulderWidthMm: 410, torsoLengthMm: 435, armLengthMm: 580, inseamMm: 750,
      neckCircumferenceMm: 390, highBustMm: 960, bustHeightMm: 255, bustSpanMm: 216,
      hipHeightMm: 200, crotchDepthMm: 265, insideLegLengthMm: 750, outseamLengthMm: 1015,
      thighMm: 670, kneeCircumferenceMm: 440, calfMm: 410, ankleCircumferenceMm: 250,
      bicepMm: 360, elbowCircumferenceMm: 310, wristMm: 180, headCircumferenceMm: 570,
    },
  },
  {
    id: "tall",
    measurements: {
      heightMm: 1820, bustMm: 960, waistMm: 780, hipMm: 1030,
      shoulderWidthMm: 425, torsoLengthMm: 480, armLengthMm: 650, inseamMm: 870,
      neckCircumferenceMm: 370, highBustMm: 880, bustHeightMm: 280, bustSpanMm: 192,
      hipHeightMm: 215, crotchDepthMm: 280, insideLegLengthMm: 870, outseamLengthMm: 1150,
      thighMm: 600, kneeCircumferenceMm: 410, calfMm: 390, ankleCircumferenceMm: 240,
      bicepMm: 320, elbowCircumferenceMm: 270, wristMm: 170, headCircumferenceMm: 575,
    },
  },
];

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
    expect(body.collisionMesh.topologySignature).toBe(body.visualMesh.topologySignature);
    expect(body.diagnostics.visualCollisionTopologyParity).toBe(true);
    expect(body.diagnostics.maxLodSectionDeltaMm).toBeLessThanOrEqual(15);
    expect(body.surfaceRegions.map((region) => region.id)).toEqual(expect.arrayContaining([
      "neck",
      "ribcage",
      "bust-left",
      "bust-right",
      "waist",
      "full-hip",
      "pelvis",
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

  it("preserves topology, bindings, anatomy and metric tolerances across three female profiles", () => {
    const bodies = FEMALE_PROFILES.map(({ measurements }) => buildHumanBodyModel(measurements, {
      disableCache: true,
    }));
    const canonical = bodies[0];
    const circumferenceSections = [
      "bust", "underbust", "waist", "high-hip", "full-hip",
      "thigh-left", "thigh-right", "knee-left", "knee-right",
      "calf-left", "calf-right", "ankle-left", "ankle-right",
      "upper-arm-left", "upper-arm-right", "elbow-left", "elbow-right",
      "wrist-left", "wrist-right",
    ];
    const lengthKeys = [
      "height", "shoulderWidth", "shoulderToBust", "waistToHip",
      "crotchDepth", "armLength", "inseam", "outseam",
    ];

    for (const body of bodies) {
      expect(body.visualMesh.topologySignature).toBe(canonical.visualMesh.topologySignature);
      expect(body.visualMesh.positions.length).toBe(canonical.visualMesh.positions.length);
      expect(body.visualMesh.indices).toBe(canonical.visualMesh.indices);
      expect(body.diagnostics.topologyInvariant).toBe(true);
      expect(body.diagnostics.visualCollisionTopologyParity).toBe(true);
      expect(body.diagnostics.visual.invertedTriangleCount, `${body.measurements.heightMm} visual inversions`).toBe(0);
      expect(body.diagnostics.collision.invertedTriangleCount, `${body.measurements.heightMm} collision inversions`).toBe(0);

      const mesh = inspectHumanBodyMesh(body.visualMesh);
      expect(mesh).toMatchObject({
        finite: true,
        boundaryEdgeCount: 0,
        nonManifoldEdgeCount: 0,
        degenerateTriangleCount: 0,
        invertedTriangleCount: 0,
        normalsConsistent: true,
      });
      expect(mesh.signedVolumeM3).toBeGreaterThan(0);

      for (const id of circumferenceSections) {
        const section = body.crossSections.find((candidate) => candidate.id === id)!;
        expect(section, `${id} section`).toBeDefined();
        expect(
          Math.abs(section.actualCircumferenceMm - section.targetCircumferenceMm),
          `${id} circumference`,
        ).toBeLessThanOrEqual(tolerance(section.targetCircumferenceMm));
      }
      for (const key of lengthKeys) {
        expect(Math.abs(body.diagnostics.measurementErrorsMm[key]), `${key} length`).toBeLessThanOrEqual(5);
      }

      const bust = body.crossSections.find((section) => section.id === "bust")!;
      const waist = body.crossSections.find((section) => section.id === "waist")!;
      const hip = body.crossSections.find((section) => section.id === "full-hip")!;
      expect(bust.halfWidthM).toBeGreaterThan(waist.halfWidthM);
      expect(hip.halfWidthM).toBeGreaterThan(waist.halfWidthM);
      expect(body.landmarks["crotch-front"].position[2]).toBeGreaterThan(body.landmarks["crotch-back"].position[2]);
      expect(body.landmarks["glute-left"].position[2]).toBeLessThan(body.landmarks["full-hip-front"].position[2]);
      expect(body.landmarks["wrist-left"].position[1]).toBeLessThan(body.landmarks["shoulder-left"].position[1]);

      for (const [id, landmark] of Object.entries(body.landmarks)) {
        expect(landmark.position.every(Number.isFinite), `${id} position`).toBe(true);
        expect(landmark.normal.every(Number.isFinite), `${id} normal`).toBe(true);
        expect(landmark.binding.topologySignature).toBe(body.visualMesh.topologySignature);
        expect(landmark.binding.vertexIndices.length).toBeGreaterThan(0);
        expect(Array.from(landmark.binding.vertexIndices), `${id} binding`).toEqual(
          Array.from(canonical.landmarks[id as keyof typeof canonical.landmarks].binding.vertexIndices),
        );
      }
    }

    for (const region of canonical.surfaceRegions) {
      expect(region.visualVertexIndices.length, `${region.id} vertices`).toBeGreaterThan(0);
      expect(Array.from(region.visualWeights).some((weight) => weight > 0 && weight < 1), `${region.id} soft weights`).toBe(true);
      for (const body of bodies.slice(1)) {
        const counterpart = body.surfaceRegions.find((candidate) => candidate.id === region.id)!;
        expect(Array.from(counterpart.visualVertexIndices), `${region.id} indices`).toEqual(Array.from(region.visualVertexIndices));
        expect(Array.from(counterpart.visualWeights), `${region.id} weights`).toEqual(Array.from(region.visualWeights));
      }
    }
    console.log("HUMAN_BODY_PROFILE_METRICS", JSON.stringify(bodies.map((body, index) => ({
      profile: FEMALE_PROFILES[index].id,
      heightMm: body.measurements.heightMm,
      maxCircumferenceErrorMm: Math.max(...circumferenceSections.map((id) => {
        const section = body.crossSections.find((candidate) => candidate.id === id)!;
        return Math.abs(section.actualCircumferenceMm - section.targetCircumferenceMm);
      })),
      maxLengthErrorMm: Math.max(...lengthKeys.map((key) => Math.abs(body.diagnostics.measurementErrorsMm[key]))),
      boundaryEdges: body.diagnostics.visual.boundaryEdgeCount,
      nonManifoldEdges: body.diagnostics.visual.nonManifoldEdgeCount,
      invertedTriangles: body.diagnostics.visual.invertedTriangleCount,
      topologySignature: body.visualMesh.topologySignature,
    }))));
  }, 60_000);
});
