import { describe, expect, it } from "vitest";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import {
  BODY_COLLIDER_ELLIPSOID,
  BODY_COLLIDER_STRIDE,
  createBodyCollisionRuntimeState,
} from "./bodyCollision";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import {
  DEFAULT_XPBD_CONFIG,
  createXpbdState,
  resetXpbdState,
  stepXpbd,
  type XpbdState,
} from "./xpbd";

describe("Prompt 11.0.4C canonical floor collision", () => {
  it("keeps a gravity-zero particle above the floor unchanged", () => {
    const state = scene([0.5], { gravity: [0, 0, 0] });
    const before = [...state.positions];
    for (let step = 0; step < 500; step += 1) stepXpbd(state);
    expect([...state.positions]).toEqual(before);
    expect(state.floorContactCount).toBe(0);
  });

  it("stops a freely falling particle at the thickness-aware physical plane", () => {
    const state = scene([0.08]);
    state.body.particleHalfThicknessM[0] = 0.002;
    for (let step = 0; step < 300; step += 1) stepXpbd(state);
    expect(state.positions[1]).toBeCloseTo(0.0022, 6);
    expect(state.velocities[1]).toBe(0);
  });

  it("detects a high-speed previous-to-predicted crossing with CCD", () => {
    const state = scene([0.04], { maximumVelocity: 100 });
    state.velocities[1] = -30;
    stepXpbd(state);
    expect(state.floorCcdContactCount).toBe(1);
    expect(state.positions[1]).toBeGreaterThanOrEqual(0.0002 - 1e-8);
  });

  it("uses each particle's half thickness independently", () => {
    const state = scene([0, 0]);
    state.body.particleHalfThicknessM.set([0.001, 0.004]);
    stepXpbd(state);
    expect(state.positions[1]).toBeCloseTo(0.0012, 6);
    expect(state.positions[4]).toBeCloseTo(0.0042, 6);
  });

  it("remains active while body collision is disabled", () => {
    const state = scene([0]);
    state.body.enabled = false;
    stepXpbd(state);
    expect(state.floorContactCount).toBe(1);
    expect(state.positions[1]).toBeGreaterThanOrEqual(0.0002 - 1e-8);
  });

  it("can be disabled independently from body collision", () => {
    const state = scene([0.01], { floorCollisionEnabled: false });
    state.body.enabled = true;
    for (let step = 0; step < 20; step += 1) stepXpbd(state);
    expect(state.positions[1]).toBeLessThan(0);
    expect(state.floorContactCount).toBe(0);
  });

  it("projects every particle in a loose multi-panel surrogate", () => {
    const state = scene([0.02, 0.03, 0.04, 0.05]);
    for (let step = 0; step < 120; step += 1) stepXpbd(state);
    for (let particle = 0; particle < 4; particle += 1) {
      expect(state.positions[particle * 3 + 1]).toBeGreaterThanOrEqual(0.0002 - 1e-7);
    }
  });

  it("drops the repository's loose skirt fixture onto the floor without pins or body collision", () => {
    const garment = createBaselineFixture("straight-skirt-standard");
    const assembly = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(garment));
    translateAssemblyAboveFloor(assembly.state, 0.08);
    const state = createXpbdWorkerState(buildXpbdInitialization(
      assembly.state,
      garment,
      "floor:loose-skirt",
      {
        bodyCollisionEnabled: false,
        config: {
          floorCollisionEnabled: true,
          floorY: 0,
          gravity: [0, -9.81, 0],
          maximumSubsteps: 1,
        },
      },
    ));
    let totalContacts = 0;
    for (let step = 0; step < 240 && !state.invalid; step += 1) {
      stepXpbd(state);
      totalContacts += state.floorContactCount;
    }
    expect(state.invalid).toBe(false);
    expect(totalContacts).toBeGreaterThan(0);
    for (let particle = 0; particle < state.positions.length / 3; particle += 1) {
      const plane = (state.config.floorY ?? 0)
        + state.body.particleHalfThicknessM[particle]
        + (state.config.floorContactSkinM ?? 0);
      expect(state.positions[particle * 3 + 1]).toBeGreaterThanOrEqual(plane - 1e-6);
    }
  }, 30_000);

  it("applies load-based tangential friction without bounce", () => {
    const state = scene([0.0002]);
    state.velocities[0] = 1;
    state.body.particleFriction[0] = 0.8;
    stepXpbd(state);
    expect(state.floorFrictionContactCount).toBe(1);
    expect(state.velocities[0]).toBeLessThan(1);
    expect(state.velocities[1]).toBe(0);
  });

  it("keeps tangential motion free when floor friction is zero", () => {
    const state = scene([0.0002]);
    state.velocities[0] = 1;
    state.body.particleFriction[0] = 0;
    stepXpbd(state);
    expect(state.floorContactCount).toBe(1);
    expect(state.floorFrictionContactCount).toBe(0);
    expect(state.velocities[0]).toBeCloseTo(DEFAULT_XPBD_CONFIG.damping, 6);
  });

  it("coexists with an enabled body collider without an explosive double correction", () => {
    const state = scene([0.2, 0.02]);
    for (const buffer of [state.positions, state.previousPositions, state.predictedPositions, state.restPositions]) {
      buffer[3] = 1;
    }
    const colliders = {
      kinds: new Uint8Array([BODY_COLLIDER_ELLIPSOID]),
      data: new Float32Array(BODY_COLLIDER_STRIDE),
      regions: ["torso"],
    };
    colliders.data.set([0, 0.2, 0, 0.1, 0.1, 0.1]);
    state.body = createBodyCollisionRuntimeState(
      colliders,
      new Float32Array(2).fill(0.00025),
      new Float32Array(2).fill(0.4),
      true,
    );
    let bodyContacts = 0;
    let floorContacts = 0;
    for (let step = 0; step < 120; step += 1) {
      stepXpbd(state);
      bodyContacts += state.body.bodyContactCount;
      floorContacts += state.floorContactCount;
    }
    expect(state.invalid).toBe(false);
    expect(bodyContacts).toBeGreaterThan(0);
    expect(floorContacts).toBeGreaterThan(0);
    expect([...state.positions].every(Number.isFinite)).toBe(true);
  });

  it("does not sustain any particle below the physical plane", () => {
    const state = scene([0.001, 0.003, 0.007]);
    for (let step = 0; step < 1_000; step += 1) {
      stepXpbd(state);
      for (let particle = 0; particle < 3; particle += 1) {
        expect(state.positions[particle * 3 + 1]).toBeGreaterThanOrEqual(0.0002 - 1e-7);
      }
    }
  });

  it("restarts to a bit-identical step zero and deterministic trajectory", () => {
    const state = scene([0.03, 0.05]);
    const initial = [...state.positions];
    for (let step = 0; step < 80; step += 1) stepXpbd(state);
    const firstRun = [...state.positions];
    resetXpbdState(state);
    expect([...state.positions]).toEqual(initial);
    for (let step = 0; step < 80; step += 1) stepXpbd(state);
    expect([...state.positions]).toEqual(firstRun);
  });
});

function scene(
  heights: number[],
  config: Partial<XpbdState["config"]> = {},
): XpbdState {
  const positions = new Float32Array(heights.length * 3);
  for (let index = 0; index < heights.length; index += 1) positions[index * 3 + 1] = heights[index];
  return createXpbdState({
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses: new Float32Array(heights.length).fill(1),
    restPositions: new Float32Array(positions),
    materialCoordinates: new Float32Array(heights.length * 2),
    triangles: new Uint32Array(0),
    distances: { indices: new Uint32Array(0), restLengths: new Float32Array(0), compliances: new Float32Array(0), lambdas: new Float32Array(0), kinds: new Uint8Array(0) },
    shears: { indices: new Uint32Array(0), restCosines: new Float32Array(0), compliances: new Float32Array(0), lambdas: new Float32Array(0) },
    seams: { indices: new Uint32Array(0), weights: new Float32Array(0), restDistances: new Float32Array(0), compliances: new Float32Array(0), relaxations: new Float32Array(0), lambdas: new Float32Array(0), seamGroupIds: [] },
    pins: { indices: new Uint32Array(0), targets: new Float32Array(0) },
    config: { ...DEFAULT_XPBD_CONFIG, floorCollisionEnabled: true, maximumSubsteps: 1, ...config },
  });
}

function translateAssemblyAboveFloor(
  state: ReturnType<typeof buildCoarseIsometricAssembly>["state"],
  clearanceM: number,
): void {
  let minimumY = Number.POSITIVE_INFINITY;
  for (let offset = 1; offset < state.positions.length; offset += 3) {
    minimumY = Math.min(minimumY, state.positions[offset]);
  }
  const translationY = clearanceM - minimumY;
  for (const buffer of [state.positions, state.initialPositions, state.previousPositions]) {
    for (let offset = 1; offset < buffer.length; offset += 3) buffer[offset] += translationY;
  }
  for (const anchor of state.anchorConstraints) anchor.targetY += translationY;
}
