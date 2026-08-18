import { describe, expect, it } from "vitest";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildXpbdInitialization, type XpbdInitializationData } from "./GarmentXpbdAdapter";
import { createXpbdState, measureXpbdDiagnostics, stepXpbd, type XpbdState } from "./xpbd";

describe("Prompt 10.7 Assembly → XPBD responsibility boundary", () => {
  for (const fixture of ["spatial-four-panel-tube", "spatial-notched-tube-waistband", "straight-pants-standard"] as const) {
    it(`${fixture}: zero gravity STEP 0/1/10/60/240 refines the coarse shell without a structural launch`, () => {
      const garment = createBaselineFixture(fixture);
      const result = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(garment));
      const initialization = buildXpbdInitialization(result.state, garment, `10.7:${fixture}`, {
        config: { gravity: [0, 0, 0], maximumSubsteps: 1 },
      });
      const state = stateFrom(initialization);
      const step0 = measureXpbdDiagnostics(state, 0);
      const beforeFirst = new Float32Array(state.positions);
      stepXpbd(state);
      const oneStepMaxM = maximumDisplacement(beforeFirst, state.positions);
      const step1 = measureXpbdDiagnostics(state, 1);
      runTo(state, 10);
      const step10 = measureXpbdDiagnostics(state, 10);
      runTo(state, 60);
      const step60 = measureXpbdDiagnostics(state, 60);
      runTo(state, 240);
      const step240 = measureXpbdDiagnostics(state, 240);

      if (process.env.MOLDEON_10_7_REPORT === "1") {
        console.log("MOLDEON_10_7_XPBD_BOUNDARY", JSON.stringify({
          fixture,
          assembly: result.assembly.metrics,
          adapter: {
            meanMm: initialization.seamResidualAudit.meanResidualMm,
            maxMm: initialization.seamResidualAudit.maxResidualMm,
            maximumCorrespondenceJumpMm: initialization.seamResidualAudit.maximumCorrespondenceJumpMm,
          },
          workerStep0: seam(step0),
          step1: seam(step1),
          step10: seam(step10),
          step60: seam(step60),
          step240: seam(step240),
          oneStepMaxM,
          invalid: state.invalid,
        }));
      }

      expect(initialization.topologyDiagnostics.valid).toBe(true);
      expect(initialization.seamResidualAudit.maximumCorrespondenceJumpMm).toBeLessThan(0.01);
      expect(state.invalid).toBe(false);
      expect([...state.positions].every(Number.isFinite)).toBe(true);
      expect([...state.velocities].every(Number.isFinite)).toBe(true);
      expect(oneStepMaxM).toBeLessThan(0.12);
      expect(step0.seamErrorMaximum).toBeLessThan(0.5);
      expect(step240.seamErrorAverage).toBeLessThan(step0.seamErrorAverage + 1e-6);
      expect(step240.seamErrorMaximum).toBeLessThan(0.5);
    }, 30_000);
  }
});

function stateFrom(initialization: XpbdInitializationData): XpbdState {
  return createXpbdState({
    positions: initialization.positions,
    previousPositions: initialization.previousPositions,
    predictedPositions: initialization.predictedPositions,
    velocities: new Float32Array(initialization.velocities.length),
    inverseMasses: initialization.inverseMasses,
    restPositions: initialization.restPositions,
    materialCoordinates: initialization.materialCoordinates,
    triangles: initialization.triangles,
    distances: {
      indices: initialization.distanceIndices,
      restLengths: initialization.distanceRestLengths,
      compliances: initialization.distanceCompliances,
      lambdas: new Float32Array(initialization.distanceRestLengths.length),
      kinds: initialization.distanceKinds,
    },
    shears: {
      indices: initialization.shearIndices,
      restCosines: initialization.shearRestCosines,
      compliances: initialization.shearCompliances,
      lambdas: new Float32Array(initialization.shearRestCosines.length),
    },
    seams: {
      indices: initialization.seamIndices,
      weights: initialization.seamWeights,
      restDistances: initialization.seamRestDistances,
      compliances: initialization.seamCompliances,
      relaxations: initialization.seamRelaxations,
      lambdas: new Float32Array(initialization.seamRestDistances.length),
      seamGroupIds: initialization.seamGroupIds,
    },
    pins: { indices: initialization.pinIndices, targets: initialization.pinTargets },
    config: { ...initialization.config, gravity: [0, 0, 0], maximumSubsteps: 1 },
  });
}

function runTo(state: XpbdState, target: number): void {
  while (state.stepCount < target) stepXpbd(state);
}

function maximumDisplacement(before: Float32Array, after: Float32Array): number {
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

function seam(diagnostics: ReturnType<typeof measureXpbdDiagnostics>) {
  return {
    meanMm: diagnostics.seamErrorAverage * 1000,
    maxMm: diagnostics.seamErrorMaximum * 1000,
  };
}
