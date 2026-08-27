import { beforeAll, describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { HumanBodyMesh, HumanBodyRegionId } from "../avatar/HumanBodyModel";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { createBodyCollisionRuntimeState, initializeBodyDressing, solveBodyCollisions } from "./bodyCollision";
import { closestPointOnExactBody, packHumanBodyMesh, type PackedBodyMesh } from "./exactBodySurface";

describe("11.0.5 controlled anatomical exact contacts", () => {
  let visualMesh: HumanBodyMesh;
  let packedMesh: PackedBodyMesh;
  let regionVertices: Map<HumanBodyRegionId, Set<number>>;

  beforeAll(() => {
    const avatar = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    visualMesh = avatar.humanBody.visualMesh;
    packedMesh = packHumanBodyMesh(visualMesh);
    regionVertices = new Map(avatar.humanBody.surfaceRegions.map((region) => [
      region.id,
      new Set(region.visualVertexIndices),
    ]));
  }, 30_000);

  it("repels superficial patches at bust, waist, abdomen, hip, glute, crotch, thigh, shoulder and arm", () => {
    const fixtures: Array<{ region: HumanBodyRegionId; depthM: number }> = [
      { region: "bust-left", depthM: 0.0005 },
      { region: "waist", depthM: 0.0005 },
      { region: "abdomen", depthM: 0.002 },
      { region: "full-hip", depthM: 0.0005 },
      { region: "glute-left", depthM: 0.0005 },
      { region: "crotch", depthM: 0.0005 },
      { region: "thigh-left", depthM: 0.0005 },
      { region: "shoulder-left", depthM: 0.0005 },
      { region: "upper-arm-left", depthM: 0.0005 },
    ];
    const samples = fixtures.map(({ region }) => surfaceSample(visualMesh, region, regionVertices.get(region)));
    const positions = Float32Array.from(samples.flatMap(({ point, normal }, index) => [
      point[0] - normal[0] * fixtures[index].depthM,
      point[1] - normal[1] * fixtures[index].depthM,
      point[2] - normal[2] * fixtures[index].depthM,
    ]));
    const body = createBodyCollisionRuntimeState(
      { kinds: new Uint8Array(), data: new Float32Array(), regions: [] },
      new Float32Array(fixtures.length),
      new Float32Array(fixtures.length).fill(0.4),
      true,
      0.00005,
      packedMesh,
    );
    initializeBodyDressing(body, positions, 0.01);
    solveBodyCollisions({
      predictedPositions: positions,
      previousPositions: positions.slice(),
      velocities: new Float32Array(positions.length),
      inverseMasses: new Float32Array(fixtures.length).fill(1),
      correctionLimits: new Float32Array(fixtures.length).fill(0.01),
      maximumCorrectionM: 0.01,
      fixedTimeStep: 1 / 120,
      body,
      allowSwept: true,
    });

    expect(body.assemblyContactBlocked).toBe(false);
    expect(body.bodyVertexContacts).toBe(fixtures.length);
    expect(body.globalCollisionEarlyReturnCount).toBe(0);
    for (let particle = 0; particle < fixtures.length; particle += 1) {
      const offset = particle * 3;
      const query = closestPointOnExactBody(body.exactSurface!, [positions[offset], positions[offset + 1], positions[offset + 2]], true);
      expect(query.signedDistanceM, fixtures[particle].region).toBeGreaterThanOrEqual(-0.00005);
    }
  }, 30_000);
});

function surfaceSample(mesh: HumanBodyMesh, region: HumanBodyRegionId, vertices: Set<number> | undefined) {
  if (!vertices || vertices.size === 0) throw new RangeError(`Região anatômica sem binding: ${region}.`);
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const indices = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]] as const;
    if (!indices.every((vertex) => vertices.has(vertex))) continue;
    const a = point(mesh.positions, indices[0]);
    const b = point(mesh.positions, indices[1]);
    const c = point(mesh.positions, indices[2]);
    const ab = subtract(b, a);
    const ac = subtract(c, a);
    const cross: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(...cross);
    if (length <= 1e-10) continue;
    return {
      point: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] as [number, number, number],
      normal: cross.map((value) => value / length) as [number, number, number],
    };
  }
  throw new RangeError(`Região anatômica sem triângulo: ${region}.`);
}

function point(positions: Float32Array, vertex: number): [number, number, number] {
  return [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
}

function subtract(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
