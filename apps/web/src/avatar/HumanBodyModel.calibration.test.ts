import { describe, expect, it } from "vitest";
import type { BodyMeasurements } from "../domain/pattern";
import { canonicalFemaleMesh } from "./CanonicalFemaleMesh";
import {
  buildHumanBodyModel,
  canonicalFemaleNativeMeasurements,
  inspectCanonicalIdentityDeformation,
  inspectCanonicalPoseIsolation,
} from "./HumanBodyModel";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";

describe("HumanBodyModel shape-preserving calibration", () => {
  it("returns the normalized canonical shape for its native measurement profile", () => {
    const displacement = inspectCanonicalIdentityDeformation();
    expect(displacement.rmsMm).toBeLessThanOrEqual(1);
    expect(displacement.percentile95Mm).toBeLessThanOrEqual(2);
    expect(displacement.maxMm).toBeLessThanOrEqual(5);
  });

  it("exposes measured native dimensions instead of treating defaults as canonical", () => {
    const canonical = canonicalFemaleMesh();
    const native = canonicalFemaleNativeMeasurements();
    expect(native.heightMm).toBeCloseTo(
      (canonical.bounds.max[1] - canonical.bounds.min[1]) * 1000,
      3,
    );
    expect(native.bustMm).toBeGreaterThan(native.waistMm);
    expect(native.fullHipMm).toBeGreaterThan(native.waistMm);
  });

  it("can mathematically undo presentation pose without changing body shape", () => {
    const displacement = inspectCanonicalPoseIsolation();
    expect(displacement.rmsMm).toBeLessThan(0.001);
    expect(displacement.maxMm).toBeLessThan(0.005);
  });

  it("keeps calibration stages explicit and shape separate from presentation pose", () => {
    const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS, {
      disableCache: true,
      includeCalibrationStages: true,
    });
    const stages = body.calibrationStages!;
    expect(body.diagnostics.visual.invertedTriangleCount).toBe(0);
    expect(stages.normalized.positions).not.toBe(stages.posed.positions);
    expect(stages.finalRestShape.indices).toBe(stages.final.indices);
    expect(stages.finalRestShape.topologySignature).toBe(stages.final.topologySignature);
    expect(stages.raw.positions.length / 3).toBe(body.diagnostics.asset.sourceVertexCount);
    expect(stages.normalized.positions.length / 3).toBe(body.visualMesh.positions.length / 3);
    for (const region of ["shoulder-left", "bust-left", "waist", "pelvis", "glute-left", "thigh-left", "knee-left", "calf-left", "upper-arm-left"]) {
      const diagnostics = body.diagnostics.deformationByRegion[region];
      expect(diagnostics).toBeDefined();
      expect(Object.values(diagnostics).every(Number.isFinite)).toBe(true);
    }
    expect(body.diagnostics.meshQuality.maximumEdgeStretchRatio).toBeLessThan(4);
    expect(body.diagnostics.meshQuality.maximumAreaRatio).toBeLessThan(8);
    expect(body.diagnostics.meshQuality.maximumNormalChangeDegrees).toBeLessThan(110);
    console.log("HUMAN_BODY_CALIBRATION", JSON.stringify({
      native: canonicalFemaleNativeMeasurements(),
      identity: inspectCanonicalIdentityDeformation(),
      poseIsolation: inspectCanonicalPoseIsolation(),
      deformationByRegion: body.diagnostics.deformationByRegion,
      meshQuality: body.diagnostics.meshQuality,
    }));
  });

  it("keeps the three mandatory calibration profiles human, fixed-topology and metric", () => {
    const profiles = [
      { heightMm: 1680, bustMm: 920, waistMm: 760, hipMm: 1000 },
      { heightMm: 1600, bustMm: 840, waistMm: 680, hipMm: 920 },
      { heightMm: 1750, bustMm: 1050, waistMm: 900, hipMm: 1120 },
    ].map((measurements) => buildHumanBodyModel(measurements as BodyMeasurements, {
      disableCache: true,
    }));
    const topology = profiles[0].visualMesh.topologySignature;
    for (const body of profiles) {
      expect(body.visualMesh.topologySignature).toBe(topology);
      expect(body.diagnostics.visual.invertedTriangleCount).toBe(0);
      expect(body.diagnostics.visual.boundaryEdgeCount).toBe(0);
      expect(body.diagnostics.visual.nonManifoldEdgeCount).toBe(0);
      expect(body.diagnostics.visual.degenerateTriangleCount).toBe(0);
      for (const section of body.crossSections.filter((candidate) => candidate.id !== "crotch" && candidate.id !== "shoulder")) {
        expect(Math.abs(section.actualCircumferenceMm - section.targetCircumferenceMm), section.id)
          .toBeLessThanOrEqual(Math.max(5, section.targetCircumferenceMm * 0.01));
      }
      const thigh = body.crossSections.find((section) => section.id === "thigh-left")!;
      const knee = body.crossSections.find((section) => section.id === "knee-left")!;
      const calf = body.crossSections.find((section) => section.id === "calf-left")!;
      const ankle = body.crossSections.find((section) => section.id === "ankle-left")!;
      expect(thigh.actualCircumferenceMm).toBeGreaterThan(knee.actualCircumferenceMm);
      expect(calf.actualCircumferenceMm).toBeGreaterThan(ankle.actualCircumferenceMm);
    }
  }, 60_000);
});
