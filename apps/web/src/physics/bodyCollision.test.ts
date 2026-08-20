import { describe, expect, it } from "vitest";
import {
  BODY_COLLIDER_CAPSULE,
  BODY_COLLIDER_ELLIPSOID,
  BODY_COLLIDER_STRIDE,
  applyBodyContactVelocity,
  createBodyCollisionRuntimeState,
  deepestBodyContact,
  earliestSweptBodyContact,
  pointCapsuleContact,
  pointEllipsoidContact,
  solveBodyCollisions,
  validatePackedBodyColliders,
  type PackedBodyColliders,
} from "./bodyCollision";

function packed(): PackedBodyColliders {
  const kinds = new Uint8Array([BODY_COLLIDER_ELLIPSOID, BODY_COLLIDER_CAPSULE]);
  const data = new Float32Array(2 * BODY_COLLIDER_STRIDE);
  data.set([0, 0, 0, 0.3, 0.5, 0.2], 0);
  data.set([0.7, -0.4, 0, 0.7, 0.4, 0, 0.15], BODY_COLLIDER_STRIDE);
  return { kinds, data, regions: ["torso", "arm-right"] };
}

describe("Prompt 11 analytical body collision", () => {
  it("does nothing outside capsule", () => {
    expect(pointCapsuleContact([1, 0, 0], [0, -0.5, 0], [0, 0.5, 0], 0.1)).toBeNull();
  });

  it("projects a point inside capsule", () => {
    const contact = pointCapsuleContact([0.03, 0, 0], [0, -0.5, 0], [0, 0.5, 0], 0.1)!;
    expect(contact.penetrationM).toBeCloseTo(0.07, 6);
    expect(Math.hypot(contact.surfacePoint[0], contact.surfacePoint[2])).toBeCloseTo(0.1, 6);
  });

  it("returns finite normal on capsule axis and zero-length capsule", () => {
    for (const contact of [
      pointCapsuleContact([0, 0, 0], [0, -0.5, 0], [0, 0.5, 0], 0.1)!,
      pointCapsuleContact([0, 0, 0], [0, 0, 0], [0, 0, 0], 0.1)!,
    ]) expect(contact.normal.every(Number.isFinite)).toBe(true);
  });

  it("projects inside ellipsoid and ignores outside", () => {
    const inside = pointEllipsoidContact([0.1, 0, 0], [0, 0, 0], [0.3, 0.5, 0.2])!;
    expect(inside.surfacePoint[0]).toBeCloseTo(0.3, 6);
    expect(pointEllipsoidContact([0.31, 0, 0], [0, 0, 0], [0.3, 0.5, 0.2])).toBeNull();
  });

  it("handles sphere as equal-radius ellipsoid", () => {
    const contact = pointEllipsoidContact([0, 0.1, 0], [0, 0, 0], [0.2, 0.2, 0.2])!;
    expect(Math.hypot(...contact.surfacePoint)).toBeCloseTo(0.2, 6);
  });

  it("chooses deepest overlapping collider deterministically", () => {
    const colliders: PackedBodyColliders = {
      kinds: new Uint8Array([BODY_COLLIDER_ELLIPSOID, BODY_COLLIDER_ELLIPSOID]),
      data: new Float32Array(2 * BODY_COLLIDER_STRIDE),
      regions: ["a", "b"],
    };
    colliders.data.set([0, 0, 0, 0.5, 0.5, 0.5], 0);
    colliders.data.set([0.2, 0, 0, 0.5, 0.5, 0.5], BODY_COLLIDER_STRIDE);
    const contact = deepestBodyContact([0.05, 0, 0], colliders)!;
    expect(contact.colliderIndex).toBe(0);
  });

  it("removes inward normal velocity", () => {
    const next = applyBodyContactVelocity([-2, 0.5, 0], [1, 0, 0], 0, 2);
    expect(next[0]).toBeCloseTo(0, 8);
    expect(next[1]).toBeCloseTo(0.5, 8);
  });

  it("preserves tangential velocity with friction zero", () => {
    expect(applyBodyContactVelocity([0, 1, 0], [1, 0, 0], 0, 3)[1]).toBeCloseTo(1, 8);
  });

  it("higher friction produces less tangential slip", () => {
    const low = applyBodyContactVelocity([0, 2, 0], [1, 0, 0], 0.2, 1);
    const high = applyBodyContactVelocity([0, 2, 0], [1, 0, 0], 0.8, 1);
    expect(Math.abs(high[1])).toBeLessThan(Math.abs(low[1]));
  });

  it("detects a high-speed sweep through capsule", () => {
    const colliders: PackedBodyColliders = {
      kinds: new Uint8Array([BODY_COLLIDER_CAPSULE]),
      data: new Float32Array(BODY_COLLIDER_STRIDE),
      regions: ["thigh-left"],
    };
    colliders.data.set([0, -0.5, 0, 0, 0.5, 0, 0.15]);
    const contact = earliestSweptBodyContact([-0.5, 0, 0], [0.5, 0, 0], colliders)!;
    expect(contact).not.toBeNull();
    expect(contact.swept).toBe(true);
  });

  it("clears gross penetration without NaN and respects regular correction limit", () => {
    const colliders = packed();
    const body = createBodyCollisionRuntimeState(colliders, new Float32Array([0]), new Float32Array([0.5]));
    const predicted = new Float32Array([0, 0, 0]);
    solveBodyCollisions({
      predictedPositions: predicted,
      previousPositions: new Float32Array([0, 0, 0]),
      inverseMasses: new Float32Array([1]),
      correctionLimits: new Float32Array([0.02]),
      maximumCorrectionM: 0.035,
      fixedTimeStep: 1 / 120,
      body,
      allowSwept: false,
    });
    expect(predicted.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...predicted)).toBeGreaterThan(0.02);
    expect(Math.hypot(...predicted)).toBeLessThanOrEqual(0.035001);
    expect(body.normalImpulseSpeed[0]).toBe(0);
  });

  it("rejects invalid collider buffers instead of producing NaN", () => {
    const invalid: PackedBodyColliders = { kinds: new Uint8Array([BODY_COLLIDER_ELLIPSOID]), data: new Float32Array(BODY_COLLIDER_STRIDE), regions: ["bad"] };
    invalid.data.set([0, 0, 0, 0.3, 0, 0.2]);
    expect(() => validatePackedBodyColliders(invalid)).toThrow(RangeError);
  });
});
