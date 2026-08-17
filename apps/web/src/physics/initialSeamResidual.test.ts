import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentDraft } from "../domain/pattern";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "../garment3d/SemanticAvatarArrangement";
import { createBaselineFixture, type BaselineFixtureId } from "../testFixtures/baselineGarments";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import {
  createXpbdState,
  measureXpbdDiagnostics,
  stepXpbd,
  type XpbdState,
} from "./xpbd";

const COMPLEX_FIXTURE = "spatial-notched-tube-waistband" as const;
const COMPOSITE_GROUP = `${COMPLEX_FIXTURE}:composite-top`;
const LOCAL_CLOSURE_GROUP = `${COMPLEX_FIXTURE}:local-closure`;

function pipeline(garment: GarmentDraft, revision = "initial-seam-residual") {
  const input = buildResolvedAssemblyInput(garment);
  const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
  const arrangement = buildSemanticAvatarArrangement(input, avatar);
  const initialization = buildXpbdInitialization(arrangement.state, arrangement.garment, revision, {
    config: {
      gravity: [0, 0, 0],
      iterations: 5,
      maximumSubsteps: 2,
    },
  });
  const state = createState(initialization);
  return { arrangement, initialization, state };
}

function fixture(id: BaselineFixtureId): GarmentDraft {
  return createBaselineFixture(id);
}

function createState(initialization: ReturnType<typeof buildXpbdInitialization>): XpbdState {
  return createXpbdState({
    positions: new Float32Array(initialization.positions),
    previousPositions: new Float32Array(initialization.previousPositions),
    predictedPositions: new Float32Array(initialization.predictedPositions),
    velocities: new Float32Array(initialization.velocities),
    inverseMasses: new Float32Array(initialization.inverseMasses),
    restPositions: new Float32Array(initialization.restPositions),
    materialCoordinates: new Float32Array(initialization.materialCoordinates),
    triangles: new Uint32Array(initialization.triangles),
    distances: {
      indices: new Uint32Array(initialization.distanceIndices),
      restLengths: new Float32Array(initialization.distanceRestLengths),
      compliances: new Float32Array(initialization.distanceCompliances),
      lambdas: new Float32Array(initialization.distanceRestLengths.length),
      kinds: new Uint8Array(initialization.distanceKinds),
    },
    shears: {
      indices: new Uint32Array(initialization.shearIndices),
      restCosines: new Float32Array(initialization.shearRestCosines),
      compliances: new Float32Array(initialization.shearCompliances),
      lambdas: new Float32Array(initialization.shearRestCosines.length),
    },
    seams: {
      indices: new Uint32Array(initialization.seamIndices),
      weights: new Float32Array(initialization.seamWeights),
      restDistances: new Float32Array(initialization.seamRestDistances),
      compliances: new Float32Array(initialization.seamCompliances),
      relaxations: new Float32Array(initialization.seamRelaxations),
      lambdas: new Float32Array(initialization.seamRestDistances.length),
      seamGroupIds: [...initialization.seamGroupIds],
    },
    pins: {
      indices: new Uint32Array(initialization.pinIndices),
      targets: new Float32Array(initialization.pinTargets),
    },
    config: { ...initialization.config, gravity: [0, 0, 0] },
  });
}

function maxParticleDisplacement(before: Float32Array, after: Float32Array): number {
  let maximum = 0;
  for (let offset = 0; offset < before.length; offset += 3) {
    maximum = Math.max(maximum, Math.hypot(
      after[offset] - before[offset],
      after[offset + 1] - before[offset + 1],
      after[offset + 2] - before[offset + 2],
    ));
  }
  return maximum;
}

function maximumStructuralRatio(state: XpbdState): number {
  let maximum = 0;
  for (let index = 0; index < state.distances.restLengths.length; index += 1) {
    if (state.distances.kinds[index] !== 0) continue;
    const first = state.distances.indices[index * 2] * 3;
    const second = state.distances.indices[index * 2 + 1] * 3;
    const current = Math.hypot(
      state.positions[second] - state.positions[first],
      state.positions[second + 1] - state.positions[first + 1],
      state.positions[second + 2] - state.positions[first + 2],
    );
    const rest = state.distances.restLengths[index];
    if (rest > 1e-9) maximum = Math.max(maximum, current / rest);
  }
  return maximum;
}

describe("Prompt 10.3 initial SeamGroup residual audit", () => {
  it("localizes the upper-band residual to spatial assembly and preserves the same correspondence in adapter and Worker", () => {
    const result = pipeline(fixture(COMPLEX_FIXTURE));
    const before = result.arrangement.initialSeamResidualAudit.beforeTubeAlignment.groups
      .find((group) => group.seamGroupId === COMPOSITE_GROUP)!;
    const after = result.arrangement.initialSeamResidualAudit.afterTubeAlignment.groups
      .find((group) => group.seamGroupId === COMPOSITE_GROUP)!;
    const adapter = result.initialization.seamResidualAudit.groups
      .find((group) => group.seamGroupId === COMPOSITE_GROUP)!;
    const worker = measureXpbdDiagnostics(result.state).seamErrorsByGroup[COMPOSITE_GROUP];
    if (process.env.MOLDEON_RESIDUAL_REPORT === "1") {
      console.log("MOLDEON_10_3_RESIDUAL", JSON.stringify({
        before: { meanMm: before.meanResidualMm, maxMm: before.maxResidualMm },
        after: { meanMm: after.meanResidualMm, maxMm: after.maxResidualMm },
        adapter: { meanMm: adapter.meanResidualMm, maxMm: adapter.maxResidualMm },
        worker: { meanMm: worker.meanError * 1000, maxMm: worker.maxError * 1000 },
        maxCorrespondenceJumpMm: result.initialization.seamResidualAudit.maximumCorrespondenceJumpMm,
        corrections: result.arrangement.initialSeamResidualAudit.tubeGroupCorrections,
      }));
    }

    expect(before.classification).toBe("structural-alignment");
    expect(before.maxDistanceMm).toBeGreaterThan(20);
    expect(result.arrangement.initialSeamResidualAudit.tubeGroupCorrections.length).toBeGreaterThan(0);
    expect(after.maxDistanceMm).toBeLessThan(before.maxDistanceMm * 0.65);
    expect(result.initialization.seamResidualAudit.maximumCorrespondenceJumpMm).toBeLessThan(0.001);
    expect(Math.abs(adapter.maxResidualMm - worker.maxError * 1_000)).toBeLessThan(0.01);
    expect(Math.abs(adapter.meanResidualMm - worker.meanError * 1_000)).toBeLessThan(0.01);
    expect(result.initialization.seamResidualAudit.invariantErrors).toEqual([]);
  });

  it("classifies the diagonal shaping closure separately instead of forcing every residual to zero", () => {
    const result = pipeline(fixture(COMPLEX_FIXTURE));
    const local = result.arrangement.initialSeamResidualAudit.afterTubeAlignment.groups
      .find((group) => group.seamGroupId === LOCAL_CLOSURE_GROUP)!;

    expect(local.classification).toBe("local-shaping-closure");
    expect(local.sampleCount).toBeGreaterThan(0);
    expect(Number.isFinite(local.maxResidualMm)).toBe(true);
  });

  it.each([
    "self-seam-tube",
    "spatial-two-panel-tube",
    "spatial-four-panel-tube",
  ] as const)("keeps %s structurally coherent at step zero", (fixtureId) => {
    const result = pipeline(fixture(fixtureId), `scene-${fixtureId}`);
    const structural = result.arrangement.initialSeamResidualAudit.afterTubeAlignment.groups.filter(
      (group) => group.classification === "structural-alignment",
    );

    expect(structural.length).toBeGreaterThan(0);
    expect(Math.max(...structural.map((group) => group.maxDistanceMm))).toBeLessThan(5);
    expect(result.initialization.seamResidualAudit.maximumCorrespondenceJumpMm).toBeLessThan(0.001);
  });

  it("survives the zero-gravity first-step killer test without a structural kick", () => {
    const result = pipeline(fixture(COMPLEX_FIXTURE), "zero-g-one-step");
    const before = new Float32Array(result.state.positions);
    const diagnosticsBefore = measureXpbdDiagnostics(result.state);

    stepXpbd(result.state);

    const diagnosticsAfter = measureXpbdDiagnostics(result.state);
    expect(result.state.invalid).toBe(false);
    expect([...result.state.positions].every(Number.isFinite)).toBe(true);
    expect(maxParticleDisplacement(before, result.state.positions)).toBeLessThan(0.06);
    expect(maximumStructuralRatio(result.state)).toBeLessThan(1.8);
    expect(diagnosticsAfter.seamErrorsByGroup[COMPOSITE_GROUP].maxError)
      .toBeLessThanOrEqual(diagnosticsBefore.seamErrorsByGroup[COMPOSITE_GROUP].maxError + 1e-6);
  });

  it("stays finite through 60 zero-gravity steps and converges structural seams progressively", () => {
    const result = pipeline(fixture(COMPLEX_FIXTURE), "zero-g-sixty");
    const initial = measureXpbdDiagnostics(result.state).seamErrorsByGroup[COMPOSITE_GROUP].meanError;
    let at30 = initial;
    for (let step = 1; step <= 60; step += 1) {
      stepXpbd(result.state);
      if (step === 30) at30 = measureXpbdDiagnostics(result.state).seamErrorsByGroup[COMPOSITE_GROUP].meanError;
    }
    const at60 = measureXpbdDiagnostics(result.state).seamErrorsByGroup[COMPOSITE_GROUP].meanError;

    expect(result.state.invalid).toBe(false);
    expect([...result.state.positions].every(Number.isFinite)).toBe(true);
    expect(at30).toBeLessThan(initial * 0.1);
    expect(at60).toBeLessThan(initial * 0.1);
    expect(at60).toBeLessThan(0.001);
    expect(maximumStructuralRatio(result.state)).toBeLessThan(2.5);
  });

  it("is independent from display names and seam creation order", () => {
    const canonical = fixture(COMPLEX_FIXTURE);
    const shuffled: GarmentDraft = {
      ...canonical,
      pieces: [...canonical.pieces].reverse().map((piece, index) => ({
        ...piece,
        name: ["A7", "X2", "foo", "bar", "Q9"][index] ?? `random-${index}`,
      })),
      seams: [...(canonical.seams ?? [])].reverse(),
    };
    const first = pipeline(canonical, "canonical");
    const second = pipeline(shuffled, "renamed-reordered");
    const firstGroup = first.arrangement.initialSeamResidualAudit.afterTubeAlignment.groups
      .find((group) => group.seamGroupId === COMPOSITE_GROUP)!;
    const secondGroup = second.arrangement.initialSeamResidualAudit.afterTubeAlignment.groups
      .find((group) => group.seamGroupId === COMPOSITE_GROUP)!;

    expect(Math.abs(firstGroup.meanDistanceMm - secondGroup.meanDistanceMm)).toBeLessThan(0.01);
    expect(Math.abs(firstGroup.maxDistanceMm - secondGroup.maxDistanceMm)).toBeLessThan(0.01);
  });

  it("rebuilds A to B to A without stale seam references", () => {
    const firstA = pipeline(fixture("spatial-four-panel-tube"), "a-first");
    const b = pipeline(fixture(COMPLEX_FIXTURE), "b");
    const secondA = pipeline(fixture("spatial-four-panel-tube"), "a-second");

    expect(b.initialization.positions.length).not.toBe(firstA.initialization.positions.length);
    expect(secondA.initialization.positions).toEqual(firstA.initialization.positions);
    expect(secondA.initialization.seamIndices).toEqual(firstA.initialization.seamIndices);
    expect(secondA.initialization.seamWeights).toEqual(firstA.initialization.seamWeights);
    expect(secondA.initialization.seamResidualAudit.invariantErrors).toEqual([]);
  });
});
