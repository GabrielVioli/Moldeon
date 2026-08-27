import { describe, expect, it } from "vitest";
import {
  createBodyCollisionRuntimeState,
  initializeBodyDressing,
  solveBodyCollisions,
} from "./bodyCollision";
import type { PackedBodyMesh } from "./exactBodySurface";

describe("11.0.5 exact surface XPBD contacts", () => {
  it.each([0.0005, 0.002])("projects a %.4f m local overlap to exact surface plus material clearance", (depth) => {
    const body = runtime(1, 0, 0.00005);
    const predicted = Float32Array.from([1 - depth, 0, 0]);
    initializeBodyDressing(body, predicted, 0.035);
    solveBodyCollisions(input(body, predicted, predicted.slice(), undefined, 0.5));
    expect(predicted[0]).toBeCloseTo(1.00005, 5);
    expect(body.bodyVertexContacts).toBe(1);
    expect(body.contactMask[0]).toBe(1);
    expect(body.maximumSignedPenetrationM).toBeGreaterThanOrEqual(depth);
    expect(body.assemblyContactBlocked).toBe(false);
  });

  it("keeps an outside vertex unchanged without shrink-wrap attraction", () => {
    const body = runtime(1, 0.01, 0.00005);
    const predicted = Float32Array.from([1.2, 0, 0]);
    solveBodyCollisions(input(body, predicted, predicted.slice(), undefined, 0.5));
    expect([...predicted]).toEqual([1.2000000476837158, 0, 0]);
    expect(body.bodyVertexContacts).toBe(0);
  });

  it("uses trajectory CCD for a fast outside-to-inside particle", () => {
    const body = runtime(1, 0, 0);
    const previous = Float32Array.from([2, 0.2, 0.1]);
    const predicted = Float32Array.from([0, 0.2, 0.1]);
    solveBodyCollisions(input(body, predicted, previous, undefined, 2));
    expect(predicted[0]).toBeGreaterThanOrEqual(0.9999);
    expect(body.sweptContactCount).toBe(1);
    expect(body.exactSurface!.ccdTests).toBeGreaterThan(0);
  });

  it("detects cloth edge and triangle interior contacts barycentrically", () => {
    const body = runtime(3, 0, 0.00005);
    const predicted = Float32Array.from([
      0.9999, -1.1, -1.1,
      0.9999, 1.1, -1.1,
      0.9999, 0, 1.1,
    ]);
    solveBodyCollisions({
      ...input(body, predicted, predicted.slice(), Uint32Array.from([0, 1, 2]), 0.05),
      finalReconciliation: true,
    });
    expect(body.bodyEdgeContacts).toBeGreaterThan(0);
    expect(body.bodyTriangleContacts).toBeGreaterThan(0);
    expect(body.residualBodyIntersections).toBe(0);
    expect(body.residualBodyCrossings).toBe(0);
    expect(body.residualBodyTriangleIntersections).toBe(0);
    expect([...predicted].every(Number.isFinite)).toBe(true);
  });

  it("keeps contact skin within the product maximum", () => {
    expect(() => runtime(1, 0, 0.000151)).toThrow(/0.15 mm/);
  });

  it("isolates a deep step-0 overlap without disabling a recoverable contact", () => {
    const body = runtime(2, 0, 0.00005);
    const positions = Float32Array.from([0, 0, 0, 0.999, 0, 0]);
    initializeBodyDressing(body, positions, 0.035);
    const before = [...positions];
    solveBodyCollisions(input(body, positions, positions.slice(), undefined, 0.035));
    expect(body.assemblyContactBlocked).toBe(true);
    expect(body.deepOverlapCount).toBe(1);
    expect(body.dressingStepsRemaining).toBe(0);
    expect(positions[0]).toBe(before[0]);
    expect(positions[3]).toBeCloseTo(1.00005, 5);
    expect(body.bodyVertexContacts).toBe(1);
    expect(body.bodyParticleQueries).toBe(1);
    expect(body.localInitialOverlapSkipCount).toBe(1);
    expect(body.globalCollisionEarlyReturnCount).toBe(0);
    expect(body.contactSkipReasons).toEqual({ "initial-overlap-too-deep": 1 });
    expect(body.exactSurface!.bvhNodeVisits).toBeGreaterThan(0);
  });

  it("does not promote a transient deep penetration to an initial-overlap guard", () => {
    const body = runtime(1, 0, 0.00005);
    initializeBodyDressing(body, Float32Array.from([1.1, 0, 0]), 0.035);
    const predicted = Float32Array.from([0.98, 0, 0]);

    for (let pass = 0; pass < 12; pass += 1) {
      solveBodyCollisions(input(body, predicted, predicted.slice(), undefined, 0.003));
    }

    expect(predicted[0]).toBeGreaterThanOrEqual(1.00004);
    expect(body.bodyVertexContacts).toBeGreaterThan(0);
    expect(body.assemblyContactBlocked).toBe(false);
    expect(body.deepOverlapCount).toBe(0);
    expect(body.deepInitialOverlapMask[0]).toBe(0);
    expect(body.initialOverlapGuardMask[0]).toBe(0);
    expect(body.localInitialOverlapSkipCount).toBe(0);
    expect(body.globalCollisionEarlyReturnCount).toBe(0);
  });

  it("ends a bounded local overlap with zero residual vertex intersections and edge crossings", () => {
    const body = runtime(3, 0, 0.00005);
    const predicted = Float32Array.from([0.998, -0.1, -0.1, 1.1, 0.1, -0.1, 1.1, 0, 0.1]);
    solveBodyCollisions({
      ...input(body, predicted, predicted.slice(), Uint32Array.from([0, 1, 2]), 0.1),
      finalReconciliation: true,
    });
    expect(body.residualBodyIntersections).toBe(0);
    expect(body.residualBodyCrossings).toBe(0);
    expect(body.maximumBodyCorrectionM).toBeLessThanOrEqual(0.1);
  });
});

function runtime(particleCount: number, halfThicknessM: number, skinM: number) {
  return createBodyCollisionRuntimeState(
    { kinds: new Uint8Array(), data: new Float32Array(), regions: [] },
    new Float32Array(particleCount).fill(halfThicknessM),
    new Float32Array(particleCount).fill(0.4),
    true,
    skinM,
    cubeMesh(),
  );
}

function input(
  body: ReturnType<typeof runtime>,
  predictedPositions: Float32Array,
  previousPositions: Float32Array,
  clothTriangles?: Uint32Array,
  maximumCorrectionM = 1,
) {
  const particleCount = predictedPositions.length / 3;
  return {
    predictedPositions,
    previousPositions,
    velocities: new Float32Array(predictedPositions.length),
    inverseMasses: new Float32Array(particleCount).fill(1),
    correctionLimits: new Float32Array(particleCount).fill(maximumCorrectionM),
    maximumCorrectionM,
    fixedTimeStep: 1 / 120,
    body,
    allowSwept: true,
    clothTriangles,
  };
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
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
    ]),
    topologySignature: "fixture:cube",
  };
}
