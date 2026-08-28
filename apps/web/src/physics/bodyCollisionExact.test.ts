import { describe, expect, it } from "vitest";
import {
  createBodyCollisionRuntimeState,
  initializeBodyDressing,
  resetBodyContactStep,
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

  it("rigidly recovers a connected 20 mm STEP-0 overlap without changing its material metric", () => {
    const body = runtime(4, 0, 0.00005);
    const positions = Float32Array.from([
      0.98, -0.1, -0.1,
      0.98, 0.1, -0.1,
      0.98, -0.1, 0.1,
      0.98, 0.1, 0.1,
    ]);
    const triangles = Uint32Array.from([0, 1, 2, 2, 1, 3]);
    const before = edgeLengths(positions, triangles);
    initializeBodyDressing(body, positions, 0.035, triangles);
    const afterRecovery = edgeLengths(positions, triangles);
    expect(body.initialOverlapUnresolved).toBe(false);
    expect(body.initialDepenetrationPasses).toBeGreaterThan(0);
    expect(body.initialDepenetrationMaximumTranslationM).toBeLessThanOrEqual(0.035);
    expect([...body.initialOverlapGuardMask].every((value) => value === 0)).toBe(true);
    expect([...positions].every(Number.isFinite)).toBe(true);
    expect(maximumAbsoluteDelta(before, afterRecovery)).toBeLessThan(2e-6);
    for (let pass = 0; pass < 3; pass += 1) {
      solveBodyCollisions(input(body, positions, positions.slice(), triangles, 0.035));
    }
    expect(positions[0]).toBeCloseTo(1.00005, 5);
    expect(body.bodyVertexContacts).toBeGreaterThan(0);
    expect(body.localInitialOverlapSkipCount).toBe(0);
  });

  it("recovers sewn triangulated panels without tearing seams or stretching their STEP-0 metric", () => {
    const body = runtime(6, 0, 0.00005);
    const missing = 0xffffffff;
    const positions = Float32Array.from([0.98,0.98,-0.1, 0.98,0.8,-0.1, 0.98,0.98,0.1, 0.98,0.98,-0.1, 0.8,0.98,-0.1, 0.98,0.98,0.1]);
    const triangles = Uint32Array.from([0,2,1, 3,4,5]);
    const seamIndices = Uint32Array.from([0,missing,3,missing, 2,missing,5,missing]);
    const seamWeights = Float32Array.from([1,0,1,0, 1,0,1,0]);
    const inverseMasses = new Float32Array(6).fill(1);
    const before = edgeLengths(positions, triangles);
    initializeBodyDressing(body, positions, 0.035, triangles, inverseMasses, { indices: seamIndices, weights: seamWeights });
    expect(body.initialOverlapUnresolved).toBe(false);
    expect(body.initialDepenetrationPasses).toBeGreaterThan(0);
    expect(body.dressingStepsRemaining).toBe(0);
    expect(body.grossDepenetrationEnabled).toBe(false);
    expect([...body.initialOverlapGuardMask].every((value) => value === 0)).toBe(true);
    expect(maximumAbsoluteDelta(before, edgeLengths(positions, triangles))).toBeLessThan(5e-4);
    solveBodyCollisions(input(body, positions, positions.slice(), triangles, 0.035));
    expect(body.bodyVertexContacts).toBeGreaterThan(0);
    expect(body.localInitialOverlapSkipCount).toBe(0);
  });

  it("does not propagate a deep STEP-0 overlap into a connected six-ring collision hole", () => {
    const { positions, triangles, deepParticles, shallowParticles } = connectedDeepShallowPatch();
    const body = runtime(positions.length / 3, 0, 0.00005);
    const before = edgeLengths(positions, triangles);
    initializeBodyDressing(body, positions, 0.035, triangles);

    expect(deepParticles.every((particle) => body.deepInitialOverlapMask[particle] === 1)).toBe(true);
    expect([...body.initialOverlapGuardMask].every((value) => value === 0)).toBe(true);
    expect(body.initialOverlapUnresolved).toBe(false);
    expect(maximumAbsoluteDelta(before, edgeLengths(positions, triangles))).toBeLessThan(2e-6);

    solveBodyCollisions(input(body, positions, positions.slice(), triangles, 0.035));
    for (const particle of shallowParticles) {
      expect(body.contactMask[particle]).toBe(1);
      expect(positions[particle * 3]).toBeCloseTo(1.00005, 5);
    }
    expect(body.bodyVertexContacts).toBeGreaterThanOrEqual(shallowParticles.length);
    expect(body.localInitialOverlapSkipCount).toBe(0);
    expect(body.contactSkipReasons["initial-overlap-too-deep"]).toBeUndefined();
    expect(body.globalCollisionEarlyReturnCount).toBe(0);
  });

  it("reactivates ordinary contact when a formerly deep STEP-0 particle hits the body again", () => {
    const { positions, triangles, deepParticles } = connectedDeepShallowPatch();
    const body = runtime(positions.length / 3, 0, 0.00005);
    initializeBodyDressing(body, positions, 0.035, triangles);
    for (let pass = 0; pass < 3; pass += 1) solveBodyCollisions(input(body, positions, positions.slice(), triangles, 0.035));

    resetBodyContactStep(body);
    const particle = deepParticles[0];
    positions[particle * 3 + 1] = 0.999;
    solveBodyCollisions(input(body, positions, positions.slice(), triangles, 0.035));
    expect(body.initialOverlapGuardMask[particle]).toBe(0);
    expect(body.contactMask[particle]).toBe(1);
    expect(positions[particle * 3 + 1]).toBeCloseTo(1.00005, 5);
    expect(body.localInitialOverlapSkipCount).toBe(0);
  });

  it("reports an unrecoverable STEP-0 overlap explicitly without leaving a collision guard installed", () => {
    const body = runtime(1, 0, 0.00005);
    const positions = Float32Array.from([0, 0, 0]);
    const before = [...positions];
    initializeBodyDressing(body, positions, 0.035);
    expect(body.initialOverlapUnresolved).toBe(true);
    expect(body.initialDepenetrationPasses).toBeGreaterThan(0);
    expect(body.initialDepenetrationMaximumTranslationM).toBeLessThanOrEqual(0.12 + 1e-7);
    expect([...positions]).toEqual(before);
    expect(body.initialOverlapGuardMask[0]).toBe(0);
    expect(body.assemblyContactBlocked).toBe(false);
    expect(body.dressingStepsRemaining).toBe(0);
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

function connectedDeepShallowPatch() {
  // One connected strip walks from a 30 mm deep top-face overlap to a 1 mm
  // side-face contact through exterior vertices. The old six-ring expansion
  // reached the whole strip and disabled the shallow end.
  const columns = [
    [0, 0.97],
    [0, 1.05],
    [0.5, 1.05],
    [1.05, 1.05],
    [1.05, 0.5],
    [0.999, 0],
  ] as const;
  const values: number[] = [];
  for (const [x, y] of columns) values.push(x, y, -0.02, x, y, 0.02);
  const triangleValues: number[] = [];
  for (let column = 0; column < columns.length - 1; column += 1) {
    const a = column * 2;
    const b = a + 1;
    const d = (column + 1) * 2;
    const e = d + 1;
    triangleValues.push(a, d, b, b, d, e);
  }
  return {
    positions: Float32Array.from(values),
    triangles: Uint32Array.from(triangleValues),
    deepParticles: [0, 1] as const,
    shallowParticles: [10, 11] as const,
  };
}

function edgeLengths(positions: Float32Array, triangles: Uint32Array): number[] {
  const edges = new Set<string>();
  const lengths: number[] = [];
  for (let offset = 0; offset < triangles.length; offset += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangles[offset + edge];
      const b = triangles[offset + ((edge + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) continue;
      edges.add(key);
      lengths.push(Math.hypot(
        positions[b * 3] - positions[a * 3],
        positions[b * 3 + 1] - positions[a * 3 + 1],
        positions[b * 3 + 2] - positions[a * 3 + 2],
      ));
    }
  }
  return lengths;
}

function maximumAbsoluteDelta(a: readonly number[], b: readonly number[]): number {
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  return maximum;
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
