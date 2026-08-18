import { describe, expect, it } from "vitest";
import pantsRaw from "../testFixtures/realDocuments/real-pants.v3.json";
import skirtRaw from "../testFixtures/realDocuments/real-miniskirt.v3.json";
import shirtRaw from "../testFixtures/realDocuments/real-shirt.v3.json";
import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { buildAvatarCollisionModel, type AvatarCollisionProxy } from "../avatar/AvatarCollisionModel";

const FIXTURES = [
  ["real-pants.v3.json", pantsRaw],
  ["real-miniskirt.v3.json", skirtRaw],
  ["real-shirt.v3.json", shirtRaw],
] as const;

describe("Prompt 11 coordinate registration audit", () => {
  it("records garment/body coordinate frames and measurement provenance", () => {
    const reports = FIXTURES.map(([name, raw]) => {
      const document = parsePatternDocumentV3(raw);
      const result = buildCoarseIsometricAssembly(document);
      const avatar = buildAvatarParametricModel(document.measurements.values, document.body.type);
      const collision = buildAvatarCollisionModel(avatar);
      const garmentAabb = aabbFromPositions(result.state.positions);
      const colliderAabb = aabbFromColliders(collision.proxies);
      const origins = Object.fromEntries(Object.entries(document.measurements.profile?.entries ?? {}).map(([key, entry]) => [key, entry?.origin]));
      const report = {
        fixture: name,
        suppliedKeys: document.measurements.suppliedKeys ?? [],
        estimatedKeys: document.measurements.estimatedKeys ?? [],
        derivedKeys: document.measurements.derivedKeys ?? [],
        avatarMeasurementOrigins: origins,
        garmentAabb,
        colliderAabb,
        landmarks: avatar.landmarks,
        garmentSpan: span(garmentAabb),
        colliderSpan: span(colliderAabb),
        patternBodyPlacement: document.patternDefinitions.map((definition) => ({
          id: definition.id,
          name: definition.name,
          placement: definition.bodyPlacement,
        })),
        panelPlacement: document.panelInstances.map((panel) => ({
          id: panel.id,
          sourcePatternId: panel.sourcePatternId,
          placementStatus: panel.placementStatus,
          bodySide: panel.bodySide ?? null,
          surface: panel.surface ?? null,
          arrangementAnchor: panel.arrangementAnchor ?? null,
        })),
        assemblyPlacement: result.state.instances.map((instance) => ({
          id: instance.id,
          pieceId: instance.pieceId,
          placement: instance.placement,
          arrangement: instance.arrangement ?? null,
        })),
      };
      for (const value of [...garmentAabb.min, ...garmentAabb.max, ...colliderAabb.min, ...colliderAabb.max, ...Object.values(avatar.landmarks)]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      return report;
    });
    if (process.env.MOLDEON_PROMPT11_COORDINATE_REPORT === "1") {
      console.log("MOLDEON_PROMPT11_COORDINATES", JSON.stringify(reports));
    }
  }, 120_000);
});

function aabbFromPositions(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis]);
      max[axis] = Math.max(max[axis], positions[offset + axis]);
    }
  }
  return { min, max };
}

function aabbFromColliders(proxies: readonly AvatarCollisionProxy[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const proxy of proxies) {
    if (proxy.kind === "ellipsoid") {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], proxy.center[axis] - proxy.radii[axis]);
        max[axis] = Math.max(max[axis], proxy.center[axis] + proxy.radii[axis]);
      }
      continue;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], proxy.start[axis] - proxy.radius, proxy.end[axis] - proxy.radius);
      max[axis] = Math.max(max[axis], proxy.start[axis] + proxy.radius, proxy.end[axis] + proxy.radius);
    }
  }
  return { min, max };
}

function span(aabb: { min: [number, number, number]; max: [number, number, number] }): [number, number, number] {
  return [aabb.max[0] - aabb.min[0], aabb.max[1] - aabb.min[1], aabb.max[2] - aabb.min[2]];
}
