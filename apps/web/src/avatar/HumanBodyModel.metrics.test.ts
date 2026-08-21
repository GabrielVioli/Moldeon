import { describe, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import {
  buildHumanBodyModel,
  inspectHumanBodyMesh,
  measureHumanBodyMeshCircumferenceAtY,
  type HumanBodyMesh,
} from "./HumanBodyModel";

function boundaryReport(mesh: HumanBodyMesh, landmarks: { crotchY: number; waistY: number; bustY: number }): unknown {
  const counts = new Map<string, { a: number; b: number; count: number }>();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const tri = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const a = Math.min(u, v);
      const b = Math.max(u, v);
      const key = `${a}:${b}`;
      const edge = counts.get(key);
      if (edge) edge.count += 1;
      else counts.set(key, { a, b, count: 1 });
    }
  }
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (const edge of counts.values()) {
    if (edge.count !== 1) continue;
    const ax = mesh.positions[edge.a * 3];
    const ay = mesh.positions[edge.a * 3 + 1];
    const az = mesh.positions[edge.a * 3 + 2];
    const bx = mesh.positions[edge.b * 3];
    const by = mesh.positions[edge.b * 3 + 1];
    const bz = mesh.positions[edge.b * 3 + 2];
    points.push({ x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2 });
  }
  const buckets: Record<string, number> = { feet: 0, legs: 0, crotch: 0, pelvis: 0, torso: 0, upper: 0 };
  for (const point of points) {
    if (point.y < 0.12) buckets.feet += 1;
    else if (point.y < landmarks.crotchY - 0.13) buckets.legs += 1;
    else if (point.y < landmarks.crotchY + 0.05) buckets.crotch += 1;
    else if (point.y < landmarks.waistY) buckets.pelvis += 1;
    else if (point.y < landmarks.bustY + 0.10) buckets.torso += 1;
    else buckets.upper += 1;
  }
  return {
    count: points.length,
    buckets,
    bounds: points.length === 0 ? null : {
      minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)),
      minZ: Math.min(...points.map((p) => p.z)), maxZ: Math.max(...points.map((p) => p.z)),
    },
    sample: points.slice(0, 20),
  };
}

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
    const boundaryLandmarks = { crotchY, waistY: ys.waist, bustY: ys.bust };
    console.log("HUMAN_BODY_METRICS", JSON.stringify({
      targets: body.measurements,
      surface,
      diagnosticErrorsMm: body.diagnostics.measurementErrorsMm,
      lodSectionDeltaMm: body.diagnostics.lodSectionDeltaMm,
      maxLodSectionDeltaMm: body.diagnostics.maxLodSectionDeltaMm,
      nearestCenterXmm: nearestCenterX * 1000,
      visual: inspectHumanBodyMesh(body.visualMesh),
      collision: inspectHumanBodyMesh(body.collisionMesh),
      visualBoundary: boundaryReport(body.visualMesh, boundaryLandmarks),
      collisionBoundary: boundaryReport(body.collisionMesh, boundaryLandmarks),
      visualBounds: body.visualMesh.bounds,
      collisionBounds: body.collisionMesh.bounds,
    }));
  }, 30_000);
});
