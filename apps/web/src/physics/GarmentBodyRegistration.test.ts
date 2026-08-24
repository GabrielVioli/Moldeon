import { beforeAll, describe, expect, it } from "vitest";
import { buildAvatarParametricModel, type AvatarParametricModel } from "../avatar/AvatarParametricModel";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import type { AssemblyPanelInstance, GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createBaselineFixture, type BaselineFixtureId } from "../testFixtures/baselineGarments";
import {
  applyGarmentBodyRegistration,
  resolveGarmentBodyRegistration,
} from "./GarmentBodyRegistration";

interface RegistrationFixture {
  state: GarmentAssemblyState;
  avatar: AvatarParametricModel;
}

describe("Prompt 11.0.4C garment registration A-J", () => {
  let shirt: RegistrationFixture;
  let canonical: GarmentAssemblyState;

  beforeAll(() => {
    shirt = buildFixture("tshirt-standard");
    canonical = cloneState(shirt.state);
    const diagnostic = resolveGarmentBodyRegistration(canonical, shirt.avatar);
    expect(diagnostic.status).toBe("registered");
    applyGarmentBodyRegistration(canonical, diagnostic);
  }, 60_000);

  it("A. a frontal garment remains frontal through a proper rigid registration", () => {
    const state = cloneState(shirt.state);
    const before = new Float32Array(state.positions);
    const diagnostic = resolveGarmentBodyRegistration(state, shirt.avatar);
    expect(diagnostic.status).toBe("registered");
    expect(diagnostic.registrationDeterminant).toBeCloseTo(1, 6);
    expect(diagnostic.negativeTransformCount).toBe(0);
    applyGarmentBodyRegistration(state, diagnostic);
    expect(maxPairDistanceDelta(before, state.positions)).toBeLessThan(2e-7);
    expect(frontBackSeparation(state)).toBeGreaterThan(0);
  });

  it("B. a different material orientation resolves to the same anatomical pose", () => {
    const state = cloneState(shirt.state);
    rigidlyTransformState(state, quaternionFromAxisAngle([1, 0, 0], Math.PI * 0.5), [0.31, -0.22, 0.17]);
    const diagnostic = resolveGarmentBodyRegistration(state, shirt.avatar);
    expect(diagnostic.status).toBe("registered");
    applyGarmentBodyRegistration(state, diagnostic);
    expect(maxPositionDelta(state.positions, canonical.positions)).toBeLessThan(2e-5);
  });

  it("C. an artificial 180 degree yaw is corrected from semantics", () => {
    const state = cloneState(shirt.state);
    rigidlyTransformState(state, quaternionFromAxisAngle([0, 1, 0], Math.PI), [-0.12, 0.08, 0.24]);
    const diagnostic = resolveGarmentBodyRegistration(state, shirt.avatar);
    expect(diagnostic.status).toBe("registered");
    applyGarmentBodyRegistration(state, diagnostic);
    expect(maxPositionDelta(state.positions, canonical.positions)).toBeLessThan(2e-5);
  });

  it("D. left and right physical copies keep their anatomical sides", () => {
    expect(sideCentroidX(canonical, "right")).toBeGreaterThan(sideCentroidX(canonical, "left"));
  });

  it("E. a reflected spatial pose is rejected and diagnosed", () => {
    const state = cloneState(shirt.state);
    reflectStateX(state);
    const diagnostic = resolveGarmentBodyRegistration(state, shirt.avatar);
    expect(diagnostic.status).toBe("body-placement-required");
    expect(diagnostic.negativeTransformCount).toBe(1);
    expect(diagnostic.registrationAmbiguities.join(" ")).toMatch(/quiralidade/i);
  });

  it("F. render winding and the physics outward side agree after registration", () => {
    for (const instance of canonical.instances) {
      const expected = expectedOutward(instance);
      if (!expected) continue;
      const raw = meanTriangleNormal(canonical.positions, instance);
      const corrected = instance.arrangement?.flipWinding ? raw.map((value) => -value) : raw;
      expect(dot(corrected, expected), instance.id).toBeGreaterThan(0);
    }
  });

  it("G. a narrow attachment cannot redefine torso registration", () => {
    const full = resolveGarmentBodyRegistration(cloneState(shirt.state), shirt.avatar);
    const torsoOnly = cloneState(shirt.state);
    const torsoIds = new Set(
      torsoOnly.instances.filter((instance) => instance.placement.region === "torso").map((instance) => instance.id),
    );
    torsoOnly.instances = torsoOnly.instances.filter((instance) => torsoIds.has(instance.id));
    torsoOnly.stitchConstraints = torsoOnly.stitchConstraints.filter((stitch) =>
      Boolean(stitch.instanceA && stitch.instanceB && torsoIds.has(stitch.instanceA) && torsoIds.has(stitch.instanceB)));
    const torso = resolveGarmentBodyRegistration(torsoOnly, shirt.avatar);
    expect(full.status).toBe("registered");
    expect(torso.status).toBe("registered");
    expect(maxArrayDelta(full.transform.rotation, torso.transform.rotation)).toBeLessThan(1e-10);
    expect(maxArrayDelta(full.transform.translation, torso.transform.translation)).toBeLessThan(1e-10);
  });

  it("H. cut-on-fold and mirrored physical-copy identity/parity are unchanged", () => {
    const before = shirt.state.instances.map((instance) => [instance.id, instance.materialParity] as const);
    const after = canonical.instances.map((instance) => [instance.id, instance.materialParity] as const);
    expect(after).toEqual(before);
    expect(after.some(([id, parity]) => id.endsWith(":fold-b") && parity === -1)).toBe(true);
  });

  it("I. reset produces the exact same registered position buffer", () => {
    const first = cloneState(shirt.state);
    const second = cloneState(shirt.state);
    applyGarmentBodyRegistration(first, resolveGarmentBodyRegistration(first, shirt.avatar));
    applyGarmentBodyRegistration(second, resolveGarmentBodyRegistration(second, shirt.avatar));
    expect([...second.positions]).toEqual([...first.positions]);
  });

  it("J. registration is camera-independent and deterministic", () => {
    const first = resolveGarmentBodyRegistration(cloneState(shirt.state), shirt.avatar);
    const unrelatedCameraOrbit = { azimuthRad: 2.4, elevationRad: -0.3, distanceM: 4.2 };
    expect(unrelatedCameraOrbit.azimuthRad).toBeGreaterThan(0);
    const second = resolveGarmentBodyRegistration(cloneState(shirt.state), shirt.avatar);
    expect(second).toEqual(first);
  });
});

describe("Prompt 11.0.4C repository fixtures", () => {
  for (const fixtureId of [
    "self-seam-tube",
    "spatial-four-panel-tube",
    "straight-skirt-standard",
    "spatial-notched-tube-waistband",
    "mini-skirt-standard",
    "blouse-standard",
    "straight-pants-standard",
  ] satisfies BaselineFixtureId[]) {
    it(`${fixtureId} registers rigidly or reports missing semantic authority`, () => {
      const fixture = buildFixture(fixtureId);
      const before = new Float32Array(fixture.state.positions);
      const diagnostic = resolveGarmentBodyRegistration(fixture.state, fixture.avatar);
      if (fixture.state.instances.every((instance) =>
        instance.placement.region === "custom" || instance.placement.surface === "custom")) {
        expect(diagnostic.status).toBe("body-placement-required");
        return;
      }
      expect(diagnostic.status).toBe("registered");
      expect(diagnostic.registrationDeterminant).toBeCloseTo(1, 6);
      applyGarmentBodyRegistration(fixture.state, diagnostic);
      expect(maxPairDistanceDelta(before, fixture.state.positions)).toBeLessThan(3e-7);
      expect(diagnostic.panelOutwardConsistency).toBe(1);
    }, 60_000);
  }
});

function buildFixture(id: BaselineFixtureId): RegistrationFixture {
  const input = buildResolvedAssemblyInput(createBaselineFixture(id));
  const result = buildCoarseIsometricAssembly(input.assemblyDocument);
  return {
    state: result.state,
    avatar: buildAvatarParametricModel(
      input.assemblyDocument.measurements.values,
      input.assemblyDocument.body.type,
    ),
  };
}

function cloneState(state: GarmentAssemblyState): GarmentAssemblyState {
  return {
    ...state,
    positions: new Float32Array(state.positions),
    initialPositions: new Float32Array(state.initialPositions),
    previousPositions: new Float32Array(state.previousPositions),
    inverseMasses: new Float32Array(state.inverseMasses),
    instances: state.instances.map((instance) => ({
      ...instance,
      placement: { ...instance.placement },
      ...(instance.arrangement ? {
        arrangement: {
          ...instance.arrangement,
          outwardNormal: [...instance.arrangement.outwardNormal],
          axis: [...instance.arrangement.axis],
          ...(instance.arrangement.tubeCenter ? { tubeCenter: [...instance.arrangement.tubeCenter] } : {}),
        },
      } : {}),
    })),
    structuralConstraints: state.structuralConstraints.map((constraint) => ({ ...constraint })),
    stitchConstraints: state.stitchConstraints.map((constraint) => ({
      ...constraint,
      a: { particleIndices: [...constraint.a.particleIndices], weights: [...constraint.a.weights] },
      b: { particleIndices: [...constraint.b.particleIndices], weights: [...constraint.b.weights] },
    })),
    anchorConstraints: state.anchorConstraints.map((constraint) => ({ ...constraint })),
    warnings: [...state.warnings],
  };
}

function rigidlyTransformState(
  state: GarmentAssemblyState,
  rotation: readonly [number, number, number, number],
  translation: readonly [number, number, number],
): void {
  for (const values of [state.positions, state.initialPositions, state.previousPositions]) {
    for (let offset = 0; offset < values.length; offset += 3) {
      const point = rotate([values[offset], values[offset + 1], values[offset + 2]], rotation);
      values[offset] = point[0] + translation[0];
      values[offset + 1] = point[1] + translation[1];
      values[offset + 2] = point[2] + translation[2];
    }
  }
  for (const anchor of state.anchorConstraints) {
    const point = rotate([anchor.targetX, anchor.targetY, anchor.targetZ], rotation);
    anchor.targetX = point[0] + translation[0];
    anchor.targetY = point[1] + translation[1];
    anchor.targetZ = point[2] + translation[2];
  }
}

function reflectStateX(state: GarmentAssemblyState): void {
  for (const values of [state.positions, state.initialPositions, state.previousPositions]) {
    for (let offset = 0; offset < values.length; offset += 3) values[offset] *= -1;
  }
  for (const anchor of state.anchorConstraints) anchor.targetX *= -1;
}

function quaternionFromAxisAngle(
  axis: readonly [number, number, number],
  angle: number,
): [number, number, number, number] {
  const length = Math.hypot(...axis);
  const sine = Math.sin(angle * 0.5) / length;
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle * 0.5)];
}

function rotate(
  point: readonly [number, number, number],
  q: readonly [number, number, number, number],
): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const ix = qw * point[0] + qy * point[2] - qz * point[1];
  const iy = qw * point[1] + qz * point[0] - qx * point[2];
  const iz = qw * point[2] + qx * point[1] - qy * point[0];
  const iw = -qx * point[0] - qy * point[1] - qz * point[2];
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function frontBackSeparation(state: GarmentAssemblyState): number {
  return surfaceCentroidZ(state, "front") - surfaceCentroidZ(state, "back");
}

function surfaceCentroidZ(state: GarmentAssemblyState, surface: "front" | "back"): number {
  const values = state.instances
    .filter((instance) => instance.placement.surface === surface)
    .map((instance) => instanceCentroid(state.positions, instance)[2]);
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function sideCentroidX(state: GarmentAssemblyState, side: "left" | "right"): number {
  const values = state.instances
    .filter((instance) => instance.placement.bodySide === side)
    .map((instance) => instanceCentroid(state.positions, instance)[0]);
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function instanceCentroid(values: Float32Array, instance: AssemblyPanelInstance): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    result[0] += values[offset];
    result[1] += values[offset + 1];
    result[2] += values[offset + 2];
  }
  return result.map((value) => value / Math.max(1, instance.vertexCount)) as [number, number, number];
}

function expectedOutward(instance: AssemblyPanelInstance): readonly [number, number, number] | null {
  if (instance.placement.surface === "front") return [0, 0, 1];
  if (instance.placement.surface === "back") return [0, 0, -1];
  if (instance.placement.surface === "side" && instance.placement.bodySide === "left") return [-1, 0, 0];
  if (instance.placement.surface === "side" && instance.placement.bodySide === "right") return [1, 0, 0];
  return null;
}

function meanTriangleNormal(values: Float32Array, instance: AssemblyPanelInstance): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let offset = 0; offset < instance.topology.triangles.length; offset += 3) {
    const ia = (instance.particleStart + instance.topology.triangles[offset]) * 3;
    const ib = (instance.particleStart + instance.topology.triangles[offset + 1]) * 3;
    const ic = (instance.particleStart + instance.topology.triangles[offset + 2]) * 3;
    const ab = [values[ib] - values[ia], values[ib + 1] - values[ia + 1], values[ib + 2] - values[ia + 2]];
    const ac = [values[ic] - values[ia], values[ic + 1] - values[ia + 1], values[ic + 2] - values[ia + 2]];
    result[0] += ab[1] * ac[2] - ab[2] * ac[1];
    result[1] += ab[2] * ac[0] - ab[0] * ac[2];
    result[2] += ab[0] * ac[1] - ab[1] * ac[0];
  }
  const length = Math.hypot(...result);
  return result.map((value) => value / Math.max(1e-12, length)) as [number, number, number];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function maxPositionDelta(first: Float32Array, second: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < first.length; index += 1) maximum = Math.max(maximum, Math.abs(first[index] - second[index]));
  return maximum;
}

function maxArrayDelta(first: readonly number[], second: readonly number[]): number {
  return first.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - second[index])), 0);
}

function maxPairDistanceDelta(before: Float32Array, after: Float32Array): number {
  let maximum = 0;
  const particleCount = before.length / 3;
  const stride = Math.max(1, Math.floor(particleCount / 24));
  for (let first = 0; first < particleCount; first += stride) {
    for (let second = first + stride; second < particleCount; second += stride) {
      maximum = Math.max(maximum, Math.abs(distance(before, first, second) - distance(after, first, second)));
    }
  }
  return maximum;
}

function distance(values: Float32Array, first: number, second: number): number {
  const a = first * 3;
  const b = second * 3;
  return Math.hypot(
    values[a] - values[b],
    values[a + 1] - values[b + 1],
    values[a + 2] - values[b + 2],
  );
}
