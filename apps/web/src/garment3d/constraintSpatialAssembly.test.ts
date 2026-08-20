import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentDraft } from "../domain/pattern";
import { buildXpbdInitialization, type XpbdInitializationData } from "../physics/GarmentXpbdAdapter";
import { createXpbdState, measureXpbdDiagnostics, stepXpbd, type XpbdState } from "../physics/xpbd";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { createGeneralGarmentShellFixture } from "../testFixtures/generalGarmentShell";
import { measureIntrinsicDistortion, type GarmentAssemblyState } from "./GarmentAssembly";
import { auditAdapterSeamResiduals } from "./InitialSeamResidual";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

const REPORT = process.env.MOLDEON_10_6_REPORT === "1";

describe("Prompt 10.6 constraint-based spatial assembly", () => {
  it("P0 preserves multiple material relations between the same PanelInstances", () => {
    const { arrangement } = arrange(createGeneralGarmentShellFixture());
    const graph = arrangement.constraintSpatialAssembly.graph;
    const pairGroups = relationGroupsByPair(graph.relations);
    const multiple = [...pairGroups.values()].filter((groups) => groups.size > 1);
    expect(multiple.length).toBeGreaterThanOrEqual(2);
    expect([...pairGroups.values()].some((groups) => groups.has("g-side-ab") && groups.has("g-shoulder-ab"))).toBe(true);
    expect(arrangement.constraintSpatialAssembly.components[0].strategy).toBe("constraint-spatial-shell");
    expect(arrangement.constraintSpatialAssembly.components[0].normalizedResidual).toBeLessThan(0.4);
  });

  it("G1 preserves the analytical self-seam tube as a fast path, not the global architecture", () => {
    const { arrangement } = arrange(createBaselineFixture("self-seam-tube"));
    expect(arrangement.constraintSpatialAssembly.components.some((component) => component.strategy === "analytic-fast-path")).toBe(true);
    expect([...arrangement.state.positions].every(Number.isFinite)).toBe(true);
  });

  it("G3/G10 distinguish a closed four-panel shell from an underconstrained open chain", () => {
    const closed = arrange(createBaselineFixture("spatial-four-panel-tube")).arrangement;
    const open = arrange(createBaselineFixture("spatial-open-chain")).arrangement;
    expect(closed.constraintSpatialAssembly.graph.components[0].cycleCount).toBeGreaterThan(0);
    expect(closed.constraintSpatialAssembly.components[0].strategy).toBe("constraint-spatial-shell");
    expect(open.constraintSpatialAssembly.graph.components[0].supportsSpatialShell).toBe(false);
    expect(open.constraintSpatialAssembly.components[0].strategy).toBe("underconstrained-open");
    expect([...open.state.positions].every(Number.isFinite)).toBe(true);
  });

  it("G4/G5 keeps free neckline and armhole boundaries while producing a 3D shell", () => {
    const { arrangement } = arrange(createGeneralGarmentShellFixture());
    const component = arrangement.constraintSpatialAssembly.components[0];
    expect(component.freeBoundaryCount).toBeGreaterThanOrEqual(8);
    expect(component.nonPlanarityRad).toBeGreaterThan(0.1);
    expect(component.coarseOverlapScore).toBeLessThan(0.8);
    expect(component.maxResidualMm).toBeLessThan(120);
    expect(component.intrinsicDistortion).toBeLessThan(2e-4);
  });

  it("G6/G7 integrates a band and local shaping without letting the band dominate", () => {
    const { arrangement } = arrange(createBaselineFixture("spatial-notched-tube-waistband"));
    const components = arrangement.constraintSpatialAssembly.components;
    expect(components.length).toBeGreaterThan(0);
    expect(components.some((component) => component.strategy === "constraint-spatial-shell")).toBe(true);
    const relationClasses = arrangement.constraintSpatialAssembly.graph.relations.map((relation) => relation.classification);
    expect(relationClasses).toContain("local-shaping-closure");
    expect([...arrangement.state.positions].every(Number.isFinite)).toBe(true);
    expect(maxComponentExtent(arrangement.state)).toBeLessThan(3);
  });

  it("G9 preserves N-to-M composite seam mappings", () => {
    const { arrangement, initialization } = arrange(createBaselineFixture("xpbd-four-panel-composite"));
    expect(arrangement.state.stitchConstraints.some((constraint) => constraint.seamGroupId.includes("composite-2-to-3"))).toBe(true);
    const audit = auditAdapterSeamResiduals(
      arrangement.state,
      arrangement.garment,
      initialization.positions,
      initialization.seamIndices,
      initialization.seamWeights,
      initialization.seamRestDistances,
      initialization.seamGroupIds,
    );
    expect(audit.maximumCorrespondenceJumpMm).toBeLessThan(1e-3);
  });

  it("G11 opens coherently when a structural seam is removed", () => {
    const full = arrange(createGeneralGarmentShellFixture()).arrangement;
    const open = arrange(createGeneralGarmentShellFixture({ removeSide: true })).arrangement;
    expect(open.constraintSpatialAssembly.graph.relations.length).toBeLessThan(full.constraintSpatialAssembly.graph.relations.length);
    expect(open.constraintSpatialAssembly.components[0].freeBoundaryCount).toBeGreaterThanOrEqual(full.constraintSpatialAssembly.components[0].freeBoundaryCount);
    expect([...open.state.positions].every(Number.isFinite)).toBe(true);
  });

  it("G12/G13 is independent from display names and insertion order with curved boundaries", () => {
    const canonical = arrange(createGeneralGarmentShellFixture()).arrangement;
    const renamed = arrange(createGeneralGarmentShellFixture({ randomNames: true })).arrangement;
    const reordered = arrange(createGeneralGarmentShellFixture({ reorderPieces: true, reverseSeams: true })).arrangement;
    expect(componentMetricSignature(canonical)).toEqual(componentMetricSignature(renamed));
    expectMetricClose(componentMetricSignature(canonical), componentMetricSignature(reordered), 2e-3);
  });

  it("G14 keeps incompatible seam residual for XPBD instead of stretching the panel in assembly", () => {
    const garment = withDressing(createBaselineFixture("length-mismatch-seam"));
    const result = physicalState(garment, "10.6-repuxo");
    const initial = measureXpbdDiagnostics(result.state);
    const distortion = measureIntrinsicDistortion(result.assembly);
    expect(initial.seamErrorMaximum).toBeGreaterThan(0.005);
    expect(distortion.maxRelativeDistortion).toBeLessThan(2e-4);
    for (let step = 0; step < 60; step += 1) stepXpbd(result.state);
    const after = measureXpbdDiagnostics(result.state, 60);
    expect(result.state.invalid).toBe(false);
    expect(after.seamErrorAverage).toBeLessThan(initial.seamErrorAverage);
  });

  it("REAL PANTS resolves four physical legs, front/back crotch closures, inseams, outseams and darts", () => {
    const garment = createBaselineFixture("straight-pants-standard");
    const input = buildResolvedAssemblyInput(garment);
    expect(input.panelInstances).toHaveLength(4);
    const physicallyBoundGroups = input.seamGroups.filter((group) => (group.physicalBindings?.length ?? 0) > 0);
    expect(physicallyBoundGroups.map((group) => group.id).sort()).toEqual([
      "template-seam:trouser-back-rise",
      "template-seam:trouser-front-rise",
      "template-seam:trouser-inseam-1",
      "template-seam:trouser-inseam-2",
      "template-seam:trouser-outseam-1",
      "template-seam:trouser-outseam-2",
      "template-seam:trouser-outseam-3",
      "template-seam:trouser-outseam-4",
    ]);
    expect(physicallyBoundGroups.every((group) =>
      group.physicalBindings?.every((binding) =>
        binding.first.every((endpoint) => endpoint.panelInstanceId.length > 0)
        && binding.second.every((endpoint) => endpoint.panelInstanceId.length > 0),
      ) ?? false,
    )).toBe(true);

    const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
    const arrangement = buildSemanticAvatarArrangement(input, avatar);
    const byInstance = new Map(arrangement.state.instances.map((instance) => [instance.id, instance]));
    const crotchConstraints = arrangement.state.stitchConstraints.filter((constraint) =>
      constraint.seamGroupId.includes("trouser-front-rise") || constraint.seamGroupId.includes("trouser-back-rise"));
    expect(crotchConstraints.length).toBeGreaterThan(4);
    expect(crotchConstraints.every((constraint) => constraint.instanceA !== constraint.instanceB)).toBe(true);
    expect(crotchConstraints.every((constraint) => {
      const a = constraint.instanceA ? byInstance.get(constraint.instanceA) : undefined;
      const b = constraint.instanceB ? byInstance.get(constraint.instanceB) : undefined;
      return a && b && a.sourcePatternId === b.sourcePatternId;
    })).toBe(true);

    const graph = arrangement.constraintSpatialAssembly.graph;
    expect(graph.nodes).toHaveLength(4);
    expect(graph.relations.some((relation) => relation.seamGroupId.includes("trouser-front-rise"))).toBe(true);
    expect(graph.relations.some((relation) => relation.seamGroupId.includes("trouser-back-rise"))).toBe(true);
    expect(graph.relations.some((relation) => relation.classification === "local-shaping-closure")).toBe(true);
    expect(graph.components[0].cycleCount).toBeGreaterThan(0);

    const component = arrangement.constraintSpatialAssembly.components[0];
    expect(component.strategy).toBe("constraint-spatial-shell");
    expect(component.nonPlanarityRad).toBeGreaterThan(0.05);
    expect(component.coarseOverlapScore).toBeLessThan(0.85);
    expect(component.intrinsicDistortion).toBeLessThan(3e-4);
    expect(component.maxResidualMm).toBeLessThan(900);
    expect(component.assemblySolveMs).toBeLessThan(500);
    expect([...arrangement.state.positions].every(Number.isFinite)).toBe(true);

    if (REPORT) console.log(`MOLDEON_10_6_PANTS_STEP0 ${JSON.stringify({
      seamGroups: input.seamGroups.map((group) => ({ id: group.id, physicalPairing: group.physicalPairing })),
      component,
      relations: graph.relations.map((relation) => ({ id: relation.id, seamGroupId: relation.seamGroupId, classification: relation.classification, samples: relation.samples.length })),
    })}`);
  });

  it("REAL PANTS survives STEP 1/10/60/240 at zero gravity without radial explosion", () => {
    const result = physicalState(createBaselineFixture("straight-pants-standard"), "10.6-pants-zero-g");
    const before = new Float32Array(result.state.positions);
    const initial = measureXpbdDiagnostics(result.state);
    const checkpoints = new Map<number, ReturnType<typeof measureXpbdDiagnostics>>();
    const timings: number[] = [];
    const startedAt = performance.now();
    for (let step = 1; step <= 240; step += 1) {
      stepXpbd(result.state);
      if (step > 40) timings.push(result.state.profile.solverStepTotalMs);
      if (step === 1 || step === 10 || step === 60 || step === 240) checkpoints.set(step, measureXpbdDiagnostics(result.state, step));
    }
    const final = checkpoints.get(240)!;
    expect(result.state.invalid).toBe(false);
    expect([...result.state.positions].every(Number.isFinite)).toBe(true);
    expect(maxDisplacement(before, result.state.positions)).toBeLessThan(1.5);
    expect(final.seamErrorAverage).toBeLessThan(initial.seamErrorAverage);
    expect(final.seamErrorMaximum).toBeLessThan(initial.seamErrorMaximum);
    expect(maxComponentExtent(result.assembly, result.state.positions)).toBeLessThan(4);
    if (REPORT) console.log(`MOLDEON_10_6_PANTS_240 ${JSON.stringify({
      elapsedMs: performance.now() - startedAt,
      initialMeanMm: initial.seamErrorAverage * 1000,
      initialMaxMm: initial.seamErrorMaximum * 1000,
      checkpoints: Object.fromEntries([...checkpoints].map(([step, metric]) => [step, { meanMm: metric.seamErrorAverage * 1000, maxMm: metric.seamErrorMaximum * 1000 }])),
      physicsMedianMs: percentile(timings, 0.5),
      physicsP95Ms: percentile(timings, 0.95),
    })}`);
  }, 15_000);

  it("A-to-B-to-A rebuild is deterministic and carries no stale pose", () => {
    const garmentA = createBaselineFixture("straight-pants-standard");
    const first = arrange(garmentA).arrangement;
    arrange(createGeneralGarmentShellFixture({ removeSide: true }));
    const restored = arrange(garmentA).arrangement;
    expectMetricClose(componentMetricSignature(first), componentMetricSignature(restored), 1e-8);
  });
});

function arrange(garment: GarmentDraft) {
  const input = buildResolvedAssemblyInput(garment);
  const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
  const arrangement = buildSemanticAvatarArrangement(input, avatar);
  const initialization = buildXpbdInitialization(arrangement.state, arrangement.garment, `10.6:${garment.id}`, { config: { gravity: [0, 0, 0] } });
  return { input, arrangement, initialization };
}

function physicalState(garment: GarmentDraft, revision: string): { state: XpbdState; initialization: XpbdInitializationData; assembly: GarmentAssemblyState } {
  const input = buildResolvedAssemblyInput(garment);
  const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
  const arrangement = buildSemanticAvatarArrangement(input, avatar);
  const initialization = buildXpbdInitialization(arrangement.state, arrangement.garment, revision, { config: { gravity: [0, 0, 0] } });
  const state = createXpbdState({
    positions: initialization.positions,
    previousPositions: initialization.previousPositions,
    predictedPositions: initialization.predictedPositions,
    velocities: initialization.velocities,
    inverseMasses: initialization.inverseMasses,
    restPositions: initialization.restPositions,
    materialCoordinates: initialization.materialCoordinates,
    triangles: initialization.triangles,
    distances: { indices: initialization.distanceIndices, restLengths: initialization.distanceRestLengths, compliances: initialization.distanceCompliances, lambdas: new Float32Array(initialization.distanceRestLengths.length), kinds: initialization.distanceKinds },
    shears: { indices: initialization.shearIndices, restCosines: initialization.shearRestCosines, compliances: initialization.shearCompliances, lambdas: new Float32Array(initialization.shearRestCosines.length) },
    seams: { indices: initialization.seamIndices, weights: initialization.seamWeights, restDistances: initialization.seamRestDistances, compliances: initialization.seamCompliances, relaxations: initialization.seamRelaxations, lambdas: new Float32Array(initialization.seamRestDistances.length), seamGroupIds: initialization.seamGroupIds },
    pins: { indices: initialization.pinIndices, targets: initialization.pinTargets },
    config: { ...initialization.config, gravity: [0, 0, 0] },
  });
  return { state, initialization, assembly: arrangement.state };
}

function withDressing(garment: GarmentDraft): GarmentDraft {
  return {
    ...garment,
    dressing: { region: "upper", frontReferencePieceId: garment.pieces[0]?.id },
  };
}

function relationGroupsByPair(relations: readonly { panelA: string; panelB: string; seamGroupId: string }[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relation.panelA === relation.panelB) continue;
    const key = [relation.panelA, relation.panelB].sort().join("<->");
    const groups = result.get(key) ?? new Set<string>();
    groups.add(relation.seamGroupId);
    result.set(key, groups);
  }
  return result;
}

function componentMetricSignature(arrangement: ReturnType<typeof buildSemanticAvatarArrangement>): number[] {
  return arrangement.constraintSpatialAssembly.components
    .map((component) => component.normalizedResidual)
    .sort((a, b) => a - b);
}

function expectMetricClose(actual: readonly number[], expected: readonly number[], tolerance: number): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expect(Math.abs(actual[index] - expected[index])).toBeLessThanOrEqual(tolerance);
  }
}

function maxDisplacement(before: Float32Array, after: Float32Array): number {
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

function maxComponentExtent(assembly: GarmentAssemblyState, positions: Float32Array = assembly.positions): number {
  let maximum = 0;
  for (const instance of assembly.instances) {
    const start = instance.particleStart;
    const end = start + instance.vertexCount;
    let minX = Number.POSITIVE_INFINITY; let minY = Number.POSITIVE_INFINITY; let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY; let maxY = Number.NEGATIVE_INFINITY; let maxZ = Number.NEGATIVE_INFINITY;
    for (let index = start; index < end; index += 1) {
      const offset = index * 3;
      minX = Math.min(minX, positions[offset]); maxX = Math.max(maxX, positions[offset]);
      minY = Math.min(minY, positions[offset + 1]); maxY = Math.max(maxY, positions[offset + 1]);
      minZ = Math.min(minZ, positions[offset + 2]); maxZ = Math.max(maxZ, positions[offset + 2]);
    }
    maximum = Math.max(maximum, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
  }
  return maximum;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}
