import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentDraft } from "../domain/pattern";
import { buildSemanticAvatarArrangement } from "../garment3d/SemanticAvatarArrangement";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { applyBodyContactVelocities, createBodyCollisionRuntimeState } from "./bodyCollision";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import {
  createXpbdState,
  DEFAULT_XPBD_CONFIG,
  measureXpbdDiagnostics,
  resetXpbdState,
  stepXpbd,
  XPBD_MISSING_PARTICLE,
  type XpbdState,
} from "./xpbd";

describe("Prompt 11.0.3 material physics integrity", () => {
  it("keeps an unpinned patch materially unchanged for 1000 zero-gravity steps", () => {
    const state = patchState([0, 0, 0]);
    const initial = new Float32Array(state.positions);
    runSteps(state, 1000);
    const diagnostics = measureXpbdDiagnostics(state);

    expect(state.invalid).toBe(false);
    expect(maximumDelta(state.positions, initial)).toBeLessThan(1e-6);
    expect(diagnostics.structuralStretchMeanRatio).toBeCloseTo(1, 5);
    expect(diagnostics.triangleAreaMeanRatio).toBeCloseTo(1, 5);
    expect(diagnostics.garmentAabbGrowthRatio).toBeCloseTo(1, 5);
  });

  it("lets a free patch fall under full gravity without growing or hidden pins", () => {
    const state = patchState([0, -9.81, 0]);
    const initialCentroid = centroidY(state.positions);
    runSteps(state, 500);
    const diagnostics = measureXpbdDiagnostics(state);

    expect(centroidY(state.positions)).toBeLessThan(initialCentroid - 1);
    expect(diagnostics.structuralStretchMaxRatio).toBeLessThan(1.01);
    expect(diagnostics.garmentAabbGrowthRatio).toBeLessThan(1.01);
    expect(diagnostics.explicitPinCount).toBe(0);
    expect(diagnostics.temporarySupportCount).toBe(0);
  });

  it.each([
    ["zero gravity", [0, 0, 0] as [number, number, number]],
    ["full gravity", [0, -9.81, 0] as [number, number, number]],
  ])("keeps a narrow band sewn to a shell stable with %s", (_label, gravity) => {
    const state = narrowBandShellState(gravity);
    const initialCentroid = centroidY(state.positions);
    runSteps(state, 500);
    const diagnostics = measureXpbdDiagnostics(state);

    expect(state.invalid).toBe(false);
    expect(diagnostics.structuralStretchMaxRatio).toBeLessThan(1.03);
    expect(diagnostics.structuralCompressionMinRatio).toBeGreaterThan(0.97);
    expect(diagnostics.triangleAreaMinRatio).toBeGreaterThan(0.94);
    expect(diagnostics.triangleAreaMaxRatio).toBeLessThan(1.06);
    expect(diagnostics.seamErrorMaximum).toBeLessThan(1e-5);
    if (gravity[1] < 0) expect(centroidY(state.positions)).toBeLessThan(initialCentroid - 1);
  });

  it("derives structural and shear rest state from material 2D, not assembly pose", () => {
    const garment = createBaselineFixture("free-simple-piece");
    const arrangement = arrangementFor(garment);
    const canonical = buildXpbdInitialization(arrangement.state, arrangement.garment, "material-canonical");
    const posedState = {
      ...arrangement.state,
      positions: Float32Array.from(arrangement.state.positions, (value, index) => value * (index % 3 === 2 ? 3 : 1.7)),
    };
    const posed = buildXpbdInitialization(posedState, arrangement.garment, "material-posed");

    expect(posed.distanceRestLengths).toEqual(canonical.distanceRestLengths);
    expect(posed.shearRestCosines).toEqual(canonical.shearRestCosines);
    expect(posed.triangleRestAreas).toEqual(canonical.triangleRestAreas);
    expect(posed.positions).not.toEqual(canonical.positions);
  });

  it("keeps the inherited tube plus sewn flap stable for 240 zero-gravity steps", () => {
    const state = garmentState(createBaselineFixture("xpbd-tube-with-flap"), [0, 0, 0]);
    const initialSeam = measureXpbdDiagnostics(state).seamErrorMaximum;
    runSteps(state, 240);
    const diagnostics = measureXpbdDiagnostics(state);

    expect(state.invalid).toBe(false);
    expect(diagnostics.seamErrorMaximum).toBeLessThan(initialSeam);
    expect(diagnostics.structuralStretchMeanRatio).toBeLessThan(1.05);
    expect(diagnostics.structuralStretchMaxRatio).toBeLessThan(4);
    expect(diagnostics.garmentAabbGrowthRatio).toBeLessThan(1.25);
  }, 20_000);

  it("materializes paired dart-leg constraints and deterministic front/back volumetric seeds", () => {
    const garment = createBaselineFixture("dart-piece");
    const first = arrangementFor(garment);
    const backGarment = structuredClone(garment);
    backGarment.assemblyPlacements![0].outwardSide = "back";
    const second = arrangementFor(backGarment);
    const firstDarts = first.state.stitchConstraints.filter((constraint) => constraint.treatment === "dart");
    const secondDarts = second.state.stitchConstraints.filter((constraint) => constraint.treatment === "dart");

    expect(firstDarts.length).toBeGreaterThan(1);
    expect(firstDarts.map((constraint) => constraint.seamGroupId)).toEqual(
      secondDarts.map((constraint) => constraint.seamGroupId),
    );
    expect(firstDarts.every((constraint) => constraint.instanceA === constraint.instanceB)).toBe(true);
    expect(secondDarts.every((constraint) => constraint.instanceA === constraint.instanceB)).toBe(true);
    expect(first.state.positions).not.toEqual(second.state.positions);

    for (const candidate of [garment, backGarment]) {
      const state = garmentState(candidate, [0, 0, 0]);
      runSteps(state, 120);
      const dartGroups = Object.entries(measureXpbdDiagnostics(state).seamErrorsByGroup)
        .filter(([groupId]) => groupId.startsWith("dart:"));
      expect(state.invalid).toBe(false);
      expect(dartGroups.length).toBe(1);
      expect(dartGroups[0][1].maxError).toBeLessThan(0.01);
    }
  }, 15_000);

  it("makes a stiffer fabric resist hinge deflection more than a flexible fabric", () => {
    const stiff = foldedHingeState(1_000);
    const flexible = foldedHingeState(1_000_000_000);
    runSteps(stiff, 80);
    runSteps(flexible, 80);

    expect(Math.abs(stiff.positions[11])).toBeLessThan(Math.abs(flexible.positions[11]));
    expect(stiff.invalid).toBe(false);
    expect(flexible.invalid).toBe(false);
  });

  it("rolls back metric catastrophe, zeroes velocity and reports the reason", () => {
    const state = patchState([0, 0, 0]);
    const safe = new Float32Array(state.positions);
    state.positions[3] = 50;
    state.predictedPositions[3] = 50;
    state.inverseMasses.fill(0);
    state.velocities.fill(7);
    stepXpbd(state);

    expect(state.invalid).toBe(true);
    expect(state.invalidReason).toBe("metric-instability");
    expect(state.positions).toEqual(safe);
    expect([...state.velocities].every((value) => value === 0)).toBe(true);
  });

  it("reset restores pose while fabric-only changes preserve material rest geometry", () => {
    const garment = createBaselineFixture("free-simple-piece");
    const original = garmentState(garment, [0, -9.81, 0]);
    const rest = new Float32Array(original.restPositions);
    runSteps(original, 10);
    resetXpbdState(original);
    expect(original.positions).toEqual(rest);

    const changed: GarmentDraft = structuredClone(garment);
    changed.fabrics[0].physics = { ...changed.fabrics[0].physics, bending: 0.94, stretchWarpPercent: 0.5 };
    const before = buildXpbdInitialization(arrangementFor(garment).state, garment, "fabric-before");
    const after = buildXpbdInitialization(arrangementFor(changed).state, changed, "fabric-after");
    expect(after.distanceRestLengths).toEqual(before.distanceRestLengths);
    expect(after.triangleRestAreas).toEqual(before.triangleRestAreas);
    expect(after.distanceCompliances).not.toEqual(before.distanceCompliances);
    expect(after.bendCompliances).not.toEqual(before.bendCompliances);
  });

  it("removes positional body correction from velocity while preserving real outward motion", () => {
    const body = createBodyCollisionRuntimeState(
      { kinds: new Uint8Array(0), data: new Float32Array(0), regions: [] },
      Float32Array.of(0),
      Float32Array.of(0),
      true,
    );
    body.contactMask[0] = 1;
    body.contactNormals.set([1, 0, 0]);
    body.contactCorrections.set([0.1, 0, 0]);
    const velocities = Float32Array.of(13, 0, 0);
    applyBodyContactVelocities(velocities, body, 0.01);
    expect(velocities[0]).toBeCloseTo(3, 5);
    expect(velocities[1]).toBe(0);
    expect(velocities[2]).toBe(0);
  });
});

function arrangementFor(garment: GarmentDraft) {
  const input = buildResolvedAssemblyInput(garment);
  const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
  return buildSemanticAvatarArrangement(input, avatar);
}

function garmentState(garment: GarmentDraft, gravity: [number, number, number]): XpbdState {
  const arrangement = arrangementFor(garment);
  return createXpbdWorkerState(buildXpbdInitialization(arrangement.state, arrangement.garment, `material-${garment.id}`, {
    bodyCollisionEnabled: false,
    config: { gravity, iterations: 5, maximumSubsteps: 2 },
  }));
}

function patchState(gravity: [number, number, number]): XpbdState {
  return stateFromPanels(
    [0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0],
    [0, 1, 1, 1, 0, 0, 1, 0],
    [0, 2, 1, 1, 2, 3],
    gravity,
  );
}

function narrowBandShellState(gravity: [number, number, number]): XpbdState {
  const positions = [
    0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0,
    0, 1.1, 0, 1, 1.1, 0, 0, 1, 0, 1, 1, 0,
  ];
  const material = [
    0, 1, 1, 1, 0, 0, 1, 0,
    0, 0.1, 1, 0.1, 0, 0, 1, 0,
  ];
  return stateFromPanels(positions, material, [0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7], gravity, [
    [0, 6], [1, 7],
  ]);
}

function foldedHingeState(compliance: number): XpbdState {
  const state = stateFromPanels(
    [0, 1, 0, 0, -1, 0.5, 0, 0, 0, 1, 0, 0],
    [0, 1, 0, -1, 0, 0, 1, 0],
    [2, 3, 0, 1, 3, 2],
    [0, 0, 0],
  );
  state.bends = {
    indices: Uint32Array.of(0, 1, 2, 3),
    restAngles: Float32Array.of(0),
    compliances: Float32Array.of(compliance),
    lambdas: Float32Array.of(0),
  };
  return state;
}

function stateFromPanels(
  positionValues: number[],
  materialValues: number[],
  triangleValues: number[],
  gravity: [number, number, number],
  seamPairs: Array<[number, number]> = [],
): XpbdState {
  const positions = Float32Array.from(positionValues);
  const material = Float32Array.from(materialValues);
  const triangles = Uint32Array.from(triangleValues);
  const edges = new Map<string, [number, number]>();
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const vertices = [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, a < b ? [a, b] : [b, a]);
    }
  }
  const distanceIndices: number[] = [];
  const restLengths: number[] = [];
  for (const [a, b] of edges.values()) {
    distanceIndices.push(a, b);
    restLengths.push(Math.hypot(material[b * 2] - material[a * 2], material[b * 2 + 1] - material[a * 2 + 1]));
  }
  const seamIndices: number[] = [];
  for (const [a, b] of seamPairs) seamIndices.push(a, XPBD_MISSING_PARTICLE, b, XPBD_MISSING_PARTICLE);
  return createXpbdState({
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses: new Float32Array(positions.length / 3).fill(1),
    restPositions: new Float32Array(positions),
    materialCoordinates: material,
    triangles,
    distances: {
      indices: Uint32Array.from(distanceIndices),
      restLengths: Float32Array.from(restLengths),
      compliances: new Float32Array(restLengths.length).fill(1e-8),
      lambdas: new Float32Array(restLengths.length),
      kinds: new Uint8Array(restLengths.length),
    },
    shears: { indices: new Uint32Array(0), restCosines: new Float32Array(0), compliances: new Float32Array(0), lambdas: new Float32Array(0) },
    seams: {
      indices: Uint32Array.from(seamIndices),
      weights: Float32Array.from(seamPairs.flatMap(() => [1, 0, 1, 0])),
      restDistances: new Float32Array(seamPairs.length),
      compliances: new Float32Array(seamPairs.length).fill(1e-9),
      relaxations: new Float32Array(seamPairs.length).fill(1),
      lambdas: new Float32Array(seamPairs.length),
      seamGroupIds: seamPairs.map((_, index) => `band-shell:${index}`),
    },
    pins: { indices: new Uint32Array(0), targets: new Float32Array(0) },
    config: { ...DEFAULT_XPBD_CONFIG, gravity, iterations: 8 },
  });
}

function runSteps(state: XpbdState, count: number): void {
  for (let step = 0; step < count && !state.invalid; step += 1) stepXpbd(state);
}

function centroidY(positions: Float32Array): number {
  let sum = 0;
  for (let offset = 1; offset < positions.length; offset += 3) sum += positions[offset];
  return sum / (positions.length / 3);
}

function maximumDelta(first: Float32Array, second: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < first.length; index += 1) maximum = Math.max(maximum, Math.abs(first[index] - second[index]));
  return maximum;
}
