import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { getPatternEdges, type GarmentDraft, type PatternPiece, type Seam } from "../domain/pattern";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import type { GarmentAssemblyState, GlobalPointReference } from "../garment3d/GarmentAssembly";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildXpbdInitialization, type XpbdInitializationData } from "./GarmentXpbdAdapter";
import { advanceXpbd, createXpbdState, measureXpbdDiagnostics, type XpbdState } from "./xpbd";

describe("XPBD garment topology rebuild", () => {
  it("starts a one-panel self-seam tube with coincident seam references", () => {
    const { assembly, state } = physicalState(dressedTube(), "self-seam-tube-initial");
    const largestResidual = Math.max(...assembly.stitchConstraints.map((constraint) =>
      referenceDistance(assembly.positions, constraint.a, constraint.b)));
    expect(assembly.instances).toHaveLength(1);
    expect(largestResidual).toBeLessThan(5e-4);
    expect(measureXpbdDiagnostics(state).seamErrorMaximum).toBeLessThan(0.001);
  });

  it("runs the real self-seam tube without blocking or corrupting its topology", () => {
    const garment = dressedTube();
    const { state, initialization } = physicalState(garment, "tube-only");
    const startedAt = performance.now();

    simulate(state, 30);

    expect(performance.now() - startedAt).toBeLessThan(4_000);
    expectTopology(initialization);
    expectFiniteState(state);
    const worst = maximumEdgeDiagnostic(state);
    expect(worst.ratio, `pior aresta estrutural do tubo: ${JSON.stringify(worst)}`).toBeLessThan(2.5);
  });

  it("keeps a disconnected flap and the tube finite after a clean rebuild", () => {
    const garment = withFlap(dressedTube(), false);
    const { state, initialization } = physicalState(garment, "tube-plus-free-flap");

    simulate(state, 30);

    expectTopology(initialization);
    expectFiniteState(state);
    expect(initialization.triangles.length).toBeGreaterThan(0);
    const worst = maximumEdgeDiagnostic(state);
    expect(worst.ratio, `pior aresta com retalho livre: ${JSON.stringify(worst)}`).toBeLessThan(2.5);
  });

  it("keeps a sewn flap and the tube finite", () => {
    const garment = withFlap(dressedTube(), true);
    const { state, initialization } = physicalState(garment, "tube-plus-sewn-flap");
    const initialSeamError = measureXpbdDiagnostics(state).seamErrorMaximum;

    simulate(state, 30);

    expectTopology(initialization);
    expectFiniteState(state);
    expect(initialization.seamRestDistances.length).toBeGreaterThan(0);
    expect(measureXpbdDiagnostics(state).seamErrorMaximum).toBeLessThan(initialSeamError);
    const worst = maximumEdgeDiagnostic(state);
    expect(worst.ratio, `pior aresta com retalho costurado: ${JSON.stringify(worst)}`).toBeLessThan(3);
  });

  it("rebuilds tube → flap → tube without carrying physical state across revisions", () => {
    const tube = dressedTube();
    const first = physicalState(tube, "revision-a-first");
    const canonicalPositions = new Float32Array(first.initialization.positions);
    const canonicalTriangles = new Uint32Array(first.initialization.triangles);
    simulate(first.state, 20);
    const withExtraPanel = physicalState(withFlap(tube, false), "revision-b");
    simulate(withExtraPanel.state, 10);
    const restored = physicalState(tube, "revision-a-restored");

    expect(withExtraPanel.initialization.positions.length).toBeGreaterThan(first.initialization.positions.length);
    expect(restored.initialization.positions).toEqual(canonicalPositions);
    expect(restored.initialization.triangles).toEqual(canonicalTriangles);
    expect(restored.initialization.topologyDiagnostics.valid).toBe(true);
    expect(restored.state.stepCount).toBe(0);
    expectFiniteState(restored.state);
  });

  it("keeps four or more real PanelInstances finite with valid global indices", () => {
    const garment = createBaselineFixture("spatial-four-panel-tube");
    const materialSource = createBaselineFixture("multiple-fabrics");
    garment.fabrics = structuredClone(materialSource.fabrics);
    garment.pieces = garment.pieces.map((piece, index) => ({
      ...piece,
      fabricId: garment.fabrics[index % garment.fabrics.length].id,
    }));
    const frontReferencePieceId = garment.pieces[0].id;
    const dressed: GarmentDraft = {
      ...garment,
      dressing: { region: "lower", frontReferencePieceId },
    };
    const { state, initialization } = physicalState(dressed, "four-panel-garment");

    simulate(state, 30);

    expect(initialization.topologyDiagnostics.panels.length).toBeGreaterThanOrEqual(4);
    expect(initialization.topologyDiagnostics.maximumTriangleIndex).toBeLessThan(
      initialization.topologyDiagnostics.particleCount,
    );
    expect(initialization.topologyDiagnostics.valid).toBe(true);
    expectFiniteState(state);
    expect(maximumEdgeDiagnostic(state).ratio).toBeLessThan(4);
  }, 15_000);
});

function dressedTube(): GarmentDraft {
  const garment = createBaselineFixture("self-seam-tube");
  return {
    ...garment,
    dressing: { region: "upper", frontReferencePieceId: "tube-piece" },
  };
}

function withFlap(garment: GarmentDraft, sewn: boolean): GarmentDraft {
  const source = createBaselineFixture("free-simple-piece");
  const flap: PatternPiece = structuredClone(source.pieces[0]);
  const seams = [...(garment.seams ?? [])];
  if (sewn) seams.push(flapSeam(garment.pieces[0], flap));
  return {
    ...garment,
    pieces: [...garment.pieces, flap],
    seams,
    assemblyPlacements: [
      ...(garment.assemblyPlacements ?? []),
      {
        pieceId: flap.id,
        role: "front",
        outwardSide: "front",
        positionMm: [240, 0, 0],
        rotationDeg: [0, 0, 0],
        flipped: false,
        source: "manual",
      },
    ],
  };
}

function flapSeam(tube: PatternPiece, flap: PatternPiece): Seam {
  const tubeEdge = getPatternEdges(tube).find((edge) => edge.role === "waist")!;
  const flapEdge = getPatternEdges(flap).find((edge) => edge.role === "waist")!;
  const matchingLengthT = 260 / 360;
  const startT = (1 - matchingLengthT) * 0.5;
  return {
    id: "tube-piece:flap-seam",
    name: "Retalho no tubo",
    first: { pieceId: tube.id, edgeId: tubeEdge.id, startT, endT: 1 - startT },
    second: { pieceId: flap.id, edgeId: flapEdge.id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
  };
}

function physicalState(garment: GarmentDraft, revision: string): { state: XpbdState; initialization: XpbdInitializationData; assembly: GarmentAssemblyState } {
  const assembly = buildCoarseIsometricAssembly(garmentDraftToPatternDocumentV3(garment));
  const initialization = buildXpbdInitialization(assembly.state, garment, revision, {
    config: { iterations: 5, maximumSubsteps: 2 },
  });
  const state = createXpbdState({
    positions: initialization.positions,
    previousPositions: initialization.previousPositions,
    predictedPositions: initialization.predictedPositions,
    velocities: initialization.velocities,
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
      panelIds: initialization.distancePanelIds,
      fabricIds: initialization.distanceFabricIds,
    },
    shears: {
      indices: initialization.shearIndices,
      restCosines: initialization.shearRestCosines,
      compliances: initialization.shearCompliances,
      lambdas: new Float32Array(initialization.shearRestCosines.length),
    },
    bends: {
      indices: initialization.bendIndices,
      restAngles: initialization.bendRestAngles,
      compliances: initialization.bendCompliances,
      lambdas: new Float32Array(initialization.bendRestAngles.length),
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
    config: initialization.config,
  });
  return { state, initialization, assembly: assembly.state };
}

function referenceDistance(positions: Float32Array, first: GlobalPointReference, second: GlobalPointReference): number {
  const point = (reference: GlobalPointReference): [number, number, number] => {
    const result: [number, number, number] = [0, 0, 0];
    reference.particleIndices.forEach((particle, index) => {
      const weight = reference.weights[index];
      result[0] += positions[particle * 3] * weight;
      result[1] += positions[particle * 3 + 1] * weight;
      result[2] += positions[particle * 3 + 2] * weight;
    });
    return result;
  };
  const a = point(first);
  const b = point(second);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function simulate(state: XpbdState, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) advanceXpbd(state, 1 / 60);
}

function expectTopology(initialization: XpbdInitializationData): void {
  const particleCount = initialization.positions.length / 3;
  const maximumTriangleIndex = initialization.triangles.length === 0
    ? -1
    : Math.max(...initialization.triangles);
  expect(maximumTriangleIndex).toBeLessThan(particleCount);
  expect(initialization.positions.length % 3).toBe(0);
  expect(initialization.triangles.length % 3).toBe(0);
}

function expectFiniteState(state: XpbdState): void {
  expect(state.invalid).toBe(false);
  expect([...state.positions].every(Number.isFinite)).toBe(true);
  expect([...state.velocities].every(Number.isFinite)).toBe(true);
}

function maximumEdgeDiagnostic(state: XpbdState): { ratio: number; index: number; a: number; b: number; current: number; rest: number; compliance: number } {
  let worst = { ratio: 0, index: -1, a: -1, b: -1, current: 0, rest: 0, compliance: 0 };
  for (let index = 0; index < state.distances.restLengths.length; index += 1) {
    if (state.distances.kinds[index] !== 0) continue;
    const a = state.distances.indices[index * 2] * 3;
    const b = state.distances.indices[index * 2 + 1] * 3;
    const current = Math.hypot(
      state.positions[b] - state.positions[a],
      state.positions[b + 1] - state.positions[a + 1],
      state.positions[b + 2] - state.positions[a + 2],
    );
    const rest = state.distances.restLengths[index];
    const ratio = current / rest;
    if (ratio > worst.ratio) {
      worst = {
        ratio,
        index,
        a: state.distances.indices[index * 2],
        b: state.distances.indices[index * 2 + 1],
        current,
        rest,
        compliance: state.distances.compliances[index],
      };
    }
  }
  return worst;
}
