import { describe, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import {
  buildHumanBodyModel,
  inspectHumanBodyMesh,
  measureHumanBodyMeshCircumferenceAtY,
} from "./HumanBodyModel";

describe("HumanBodyModel metric report", () => {
  it("prints generated-surface diagnostics without changing acceptance gates", () => {
    const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS, { disableCache: true });
    const ys = {
      bust: body.landmarks["bust-apex-left"].position[1],
      waist: body.landmarks["center-front-waist"].position[1],
      hip: body.landmarks["full-hip-front"].position[1],
    };
    const surface = Object.fromEntries(Object.entries(ys).map(([id, y]) => [id, {
      visualMm: measureHumanBodyMeshCircumferenceAtY(body.visualMesh, y),
      collisionMm: measureHumanBodyMeshCircumferenceAtY(body.collisionMesh, y),
    }]));
    const crotchY = body.landmarks["inseam-top-left"].position[1];
    let nearestCenterX = Number.POSITIVE_INFINITY;
    for (let vertex = 0; vertex < body.visualMesh.positions.length / 3; vertex += 1) {
      const x = body.visualMesh.positions[vertex * 3];
      const y = body.visualMesh.positions[vertex * 3 + 1];
      if (y < crotchY - 0.04 && y > crotchY - 0.13) nearestCenterX = Math.min(nearestCenterX, Math.abs(x));
    }
    console.log("HUMAN_BODY_METRICS", JSON.stringify({
      targets: body.measurements,
      surface,
      diagnosticErrorsMm: body.diagnostics.measurementErrorsMm,
      lodSectionDeltaMm: body.diagnostics.lodSectionDeltaMm,
      maxLodSectionDeltaMm: body.diagnostics.maxLodSectionDeltaMm,
      nearestCenterXmm: nearestCenterX * 1000,
      visual: inspectHumanBodyMesh(body.visualMesh),
      collision: inspectHumanBodyMesh(body.collisionMesh),
      visualBounds: body.visualMesh.bounds,
      collisionBounds: body.collisionMesh.bounds,
    }));
  }, 30_000);
});
