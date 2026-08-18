import { describe, expect, it } from "vitest";
import realPantsRaw from "../testFixtures/realDocuments/real-pants.v3.json";
import {
  edgeRangeSequenceLength,
  getPatternEdges,
  resolveEdgeRangeSequenceProgress,
  seamSideRanges,
  type EdgeRange,
  type PatternPiece,
  type Seam,
} from "../domain/pattern";
import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildResolvedAssemblyInputFromDocument } from "./ResolvedAssemblyInput";
import { buildCoarseIsometricAssembly } from "./CoarseAssemblyPipeline";
import { auditAssemblySeamResiduals } from "./InitialSeamResidual";
import { orderCompositeEdgeRangesByContinuity } from "./CompositeEdgeRangeOrder";
import { evaluateCoarseBinding, type CoarseAssemblyMesh } from "./CoarseAssemblyMesh";
import { buildXpbdInitialization } from "../physics/GarmentXpbdAdapter";
import {
  createXpbdState,
  measureXpbdDiagnostics,
  stepXpbd,
  type XpbdState,
} from "../physics/xpbd";

const FRONT_GROUP = "seam-6e42b318-8607-44f0-8353-f0fca3ac48b5";
const FRONT_NAMES = new Set(["calca", "calca – espelhada"]);
const BACK_NAMES = new Set(["atras", "atras – espelhada"]);

describe("Prompt 10.7.2 real pants front/back crotch differential", () => {
  it("preserves continuous composite material correspondence through Assembly, Adapter and Worker", () => {
    const document = parsePatternDocumentV3(realPantsRaw);
    const canonicalBefore = JSON.stringify(document);
    const input = buildResolvedAssemblyInputFromDocument(document);
    const pieces = input.garmentProjection.pieces;
    const nameById = new Map(document.patternDefinitions.map((definition) => [definition.id, definition.name]));
    const front = document.seamGroups.find((group) => group.id === FRONT_GROUP);
    const back = document.seamGroups.find((group) => {
      const names = new Set([...group.first, ...group.second]
        .map((range) => nameById.get(range.pieceId))
        .filter((name): name is string => Boolean(name)));
      return sameSet(names, BACK_NAMES);
    });
    expect(front, "front crotch group missing from real-pants.v3.json").toBeDefined();
    expect(back, "back crotch group missing from real-pants.v3.json").toBeDefined();

    const frontSeam = input.garmentProjection.seams?.find((seam) => (seam.groupId ?? seam.id) === front!.id);
    const backSeam = input.garmentProjection.seams?.find((seam) => (seam.groupId ?? seam.id) === back!.id);
    expect(frontSeam).toBeDefined();
    expect(backSeam).toBeDefined();
    expect(seamNames(frontSeam!, pieces)).toEqual(FRONT_NAMES);
    expect(seamNames(backSeam!, pieces)).toEqual(BACK_NAMES);

    const frontMaterial = assertStructuralComposite(frontSeam!, pieces);
    const backMaterial = assertStructuralComposite(backSeam!, pieces);
    expect(frontMaterial.firstLengthMm).toBeCloseTo(237.945491479519, 6);
    expect(frontMaterial.secondLengthMm).toBeCloseTo(237.945491479519, 6);
    expect(frontMaterial.mismatchMm).toBeLessThan(1e-6);
    expect(backMaterial.firstLengthMm).toBeCloseTo(222.867624915812, 6);
    expect(backMaterial.secondLengthMm).toBeCloseTo(222.867624915812, 6);
    expect(backMaterial.mismatchMm).toBeLessThan(1e-6);

    // The real fixture is the reproducer: one authored FRONT side is stored in
    // non-continuous creation order. Runtime ordering must fix the traversal
    // without mutating the canonical V3 document or reversing any EdgeRange.
    expect(rawJunctionGapMm(pieces, seamSideRanges(frontSeam!, "first"))).toBeGreaterThan(150);
    expect(frontMaterial.firstJunctionGapMm).toBeLessThan(1e-6);
    expect(frontMaterial.secondJunctionGapMm).toBeLessThan(1e-6);
    expect(backMaterial.firstJunctionGapMm).toBeLessThan(1e-6);
    expect(backMaterial.secondJunctionGapMm).toBeLessThan(1e-6);
    expect(JSON.stringify(document)).toBe(canonicalBefore);

    const result = buildCoarseIsometricAssembly(document);
    const assemblyAudit = auditAssemblySeamResiduals(result.state, input.garmentProjection);
    const frontAssembly = groupAudit(assemblyAudit, front!.id);
    const backAssembly = groupAudit(assemblyAudit, back!.id);
    expect(frontAssembly.classification).toBe("structural-alignment");
    expect(backAssembly.classification).toBe("structural-alignment");
    // Baseline on this exact fixture was ~98.79 / 149.19 mm for FRONT before
    // continuous composite ordering. Keep the mapping regression bounded.
    expect(frontAssembly.meanResidualMm).toBeLessThan(80);
    expect(frontAssembly.maxResidualMm).toBeLessThan(120);

    const initialization = buildXpbdInitialization(
      result.state,
      input.garmentProjection,
      input.signature,
      { config: { gravity: [0, 0, 0] } },
    );
    const frontAdapter = groupAudit(initialization.seamResidualAudit, front!.id);
    const backAdapter = groupAudit(initialization.seamResidualAudit, back!.id);
    expect(initialization.seamResidualAudit.maximumCorrespondenceJumpMm).toBeLessThan(0.01);

    const worker = createWorkerState(initialization);
    const step0 = measureXpbdDiagnostics(worker);
    assertWorkerMatchesAdapter(step0, front!.id, frontAdapter);
    assertWorkerMatchesAdapter(step0, back!.id, backAdapter);

    const checkpoints = new Map<number, ReturnType<typeof measureXpbdDiagnostics>>();
    for (let step = 1; step <= 480; step += 1) {
      stepXpbd(worker);
      if (step === 1 || step === 60 || step === 240 || step === 480) {
        checkpoints.set(step, measureXpbdDiagnostics(worker));
      }
    }
    expect(worker.invalid).toBe(false);
    for (const diagnostics of checkpoints.values()) {
      const frontCheckpoint = workerGroup(diagnostics, front!.id);
      const backCheckpoint = workerGroup(diagnostics, back!.id);
      expect(Number.isFinite(frontCheckpoint.meanMm)).toBe(true);
      expect(Number.isFinite(frontCheckpoint.maxMm)).toBe(true);
      expect(Number.isFinite(backCheckpoint.meanMm)).toBe(true);
      expect(Number.isFinite(backCheckpoint.maxMm)).toBe(true);
    }
    const step240Front = workerGroup(checkpoints.get(240)!, front!.id);
    const step240Back = workerGroup(checkpoints.get(240)!, back!.id);
    expect(step240Front.meanMm).toBeLessThan(10);
    expect(step240Front.maxMm).toBeLessThan(60);
    expect(step240Back.meanMm).toBeLessThan(10);
    expect(step240Back.maxMm).toBeLessThan(60);
    const step480Front = workerGroup(checkpoints.get(480)!, front!.id);
    const step480Back = workerGroup(checkpoints.get(480)!, back!.id);
    expect(step480Front.maxMm).toBeLessThan(12);
    expect(step480Back.maxMm).toBeLessThan(12);

    if (process.env.MOLDEON_10_7_2_REPORT === "1") {
      console.log("MOLDEON_10_7_2_REAL_PANTS", JSON.stringify({
        fixture: "real-pants.v3.json",
        front: diagnosticReport(frontSeam!, pieces, result, frontMaterial, frontAssembly, frontAdapter, step0, checkpoints),
        back: diagnosticReport(backSeam!, pieces, result, backMaterial, backAssembly, backAdapter, step0, checkpoints),
        adapterMaximumCorrespondenceJumpMm: initialization.seamResidualAudit.maximumCorrespondenceJumpMm,
      }));
    }
  }, 120_000);
});

function assertStructuralComposite(seam: Seam, pieces: readonly PatternPiece[]) {
  expect(seam.direction).toBe("opposite");
  expect(seam.canonicalTreatment ?? seam.treatment).toBe("standard");
  expect(seam.distribution ?? "uniform").toBe("uniform");
  expect(seam.targetRatio ?? 1 + seam.easeRatio).toBeCloseTo(1, 8);
  expect(seam.slackMm ?? 0).toBeCloseTo(0, 8);
  expect(seam.physicalBindings?.length).toBeGreaterThan(0);
  for (const binding of seam.physicalBindings ?? []) {
    expect(binding.first.length).toBeGreaterThan(0);
    expect(binding.second.length).toBeGreaterThan(0);
    expect(binding.first.every((reference) => reference.panelInstanceId.endsWith(":panel:1"))).toBe(true);
    expect(binding.second.every((reference) => reference.panelInstanceId.endsWith(":panel:1"))).toBe(true);
  }

  const rawFirst = seamSideRanges(seam, "first");
  const rawSecond = seamSideRanges(seam, "second");
  expect(rawFirst).toHaveLength(2);
  expect(rawSecond).toHaveLength(2);
  const first = orderCompositeEdgeRangesByContinuity(pieces, rawFirst);
  const second = orderCompositeEdgeRangesByContinuity(pieces, rawSecond);
  expect(rangeIdentitySet(first)).toEqual(rangeIdentitySet(rawFirst));
  expect(rangeIdentitySet(second)).toEqual(rangeIdentitySet(rawSecond));
  expect(first.every((range) => range.startT === 0 && range.endT === 1)).toBe(true);
  expect(second.every((range) => range.startT === 0 && range.endT === 1)).toBe(true);
  assertSequenceProgressMonotonic(pieces, first);
  assertSequenceProgressMonotonic(pieces, second);

  const firstLengthMm = edgeRangeSequenceLength(pieces, first);
  const secondLengthMm = edgeRangeSequenceLength(pieces, second);
  return {
    first,
    second,
    firstLengthMm,
    secondLengthMm,
    mismatchMm: Math.abs(firstLengthMm - secondLengthMm),
    mismatchPercent: Math.abs(firstLengthMm - secondLengthMm) / Math.max(firstLengthMm, secondLengthMm) * 100,
    firstJunctionGapMm: rawJunctionGapMm(pieces, first),
    secondJunctionGapMm: rawJunctionGapMm(pieces, second),
  };
}

function assertSequenceProgressMonotonic(pieces: readonly PatternPiece[], ranges: readonly EdgeRange[]): void {
  const order = new Map(ranges.map((range, index) => [rangeKey(range), index]));
  let previousOrder = -1;
  let previousT = -1;
  for (let sample = 0; sample <= 100; sample += 1) {
    const resolved = resolveEdgeRangeSequenceProgress(pieces, ranges, sample / 100);
    expect(resolved).toBeDefined();
    const currentOrder = order.get(rangeKey(resolved!.range));
    expect(currentOrder).toBeDefined();
    expect(currentOrder!).toBeGreaterThanOrEqual(previousOrder);
    if (currentOrder === previousOrder) expect(resolved!.t).toBeGreaterThanOrEqual(previousT - 1e-9);
    else previousT = -1;
    previousOrder = currentOrder!;
    previousT = resolved!.t;
  }
}

function rawJunctionGapMm(pieces: readonly PatternPiece[], ranges: readonly EdgeRange[]): number {
  if (ranges.length < 2) return 0;
  let maximum = 0;
  for (let index = 0; index + 1 < ranges.length; index += 1) {
    const left = rangePoint(pieces, ranges[index], ranges[index].endT);
    const right = rangePoint(pieces, ranges[index + 1], ranges[index + 1].startT);
    maximum = Math.max(maximum, Math.hypot(left[0] - right[0], left[1] - right[1]));
  }
  return maximum;
}

function rangePoint(pieces: readonly PatternPiece[], range: EdgeRange, t: number): readonly [number, number] {
  const piece = pieces.find((candidate) => candidate.id === range.pieceId)!;
  const edge = getPatternEdges(piece).find((candidate) => candidate.id === range.edgeId)!;
  const start = piece.points.find((point) => point.id === edge.startPointId)!;
  const end = piece.points.find((point) => point.id === edge.endPointId)!;
  const c1 = start.handleOut ?? { xMm: start.xMm, yMm: start.yMm };
  const c2 = end.handleIn ?? { xMm: end.xMm, yMm: end.yMm };
  const u = 1 - t;
  return [
    u ** 3 * start.xMm + 3 * u * u * t * c1.xMm + 3 * u * t * t * c2.xMm + t ** 3 * end.xMm,
    u ** 3 * start.yMm + 3 * u * u * t * c1.yMm + 3 * u * t * t * c2.yMm + t ** 3 * end.yMm,
  ];
}

function rangeTangent(pieces: readonly PatternPiece[], range: EdgeRange, t: number): readonly [number, number] {
  const piece = pieces.find((candidate) => candidate.id === range.pieceId)!;
  const edge = getPatternEdges(piece).find((candidate) => candidate.id === range.edgeId)!;
  const start = piece.points.find((point) => point.id === edge.startPointId)!;
  const end = piece.points.find((point) => point.id === edge.endPointId)!;
  const c1 = start.handleOut ?? { xMm: start.xMm, yMm: start.yMm };
  const c2 = end.handleIn ?? { xMm: end.xMm, yMm: end.yMm };
  const u = 1 - t;
  const dx = 3 * u * u * (c1.xMm - start.xMm) + 6 * u * t * (c2.xMm - c1.xMm) + 3 * t * t * (end.xMm - c2.xMm);
  const dy = 3 * u * u * (c1.yMm - start.yMm) + 6 * u * t * (c2.yMm - c1.yMm) + 3 * t * t * (end.yMm - c2.yMm);
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? [dx / length, dy / length] : [0, 0];
}

function diagnosticReport(
  seam: Seam,
  pieces: readonly PatternPiece[],
  result: ReturnType<typeof buildCoarseIsometricAssembly>,
  material: ReturnType<typeof assertStructuralComposite>,
  assembly: ReturnType<typeof groupAudit>,
  adapter: ReturnType<typeof groupAudit>,
  step0: ReturnType<typeof measureXpbdDiagnostics>,
  checkpoints: ReadonlyMap<number, ReturnType<typeof measureXpbdDiagnostics>>,
) {
  const groupId = seam.groupId ?? seam.id;
  const constraints = result.state.stitchConstraints.filter((constraint) => constraint.seamGroupId === groupId);
  const coarse = result.seamResolution.byGroup.get(groupId) ?? [];
  const samples = [0, Math.floor((constraints.length - 1) / 2), Math.max(0, constraints.length - 1)].map((index) => {
    const stitch = constraints[index];
    const binding = coarse.find((candidate) => candidate.id === stitch.id);
    if (!binding) return null;
    const meshA = result.coarse.byInstanceId.get(binding.instanceA)!;
    const meshB = result.coarse.byInstanceId.get(binding.instanceB)!;
    return {
      index,
      progress: stitch.progress,
      rangeA: stitch.rangeA,
      rangeB: stitch.rangeB,
      coarseA: coarseBindingReport(meshA, binding.a),
      coarseB: coarseBindingReport(meshB, binding.b),
    };
  }).filter(Boolean);
  return {
    groupId,
    pieceNames: [...seamNames(seam, pieces)],
    physicalBindings: seam.physicalBindings,
    direction: seam.direction,
    treatment: seam.canonicalTreatment ?? seam.treatment,
    distribution: seam.distribution,
    targetRatio: seam.targetRatio,
    slackMm: seam.slackMm,
    material: {
      firstLengthMm: material.firstLengthMm,
      secondLengthMm: material.secondLengthMm,
      mismatchMm: material.mismatchMm,
      mismatchPercent: material.mismatchPercent,
      firstJunctionGapMm: material.firstJunctionGapMm,
      secondJunctionGapMm: material.secondJunctionGapMm,
      firstRanges: rangeReports(pieces, material.first),
      secondRanges: rangeReports(pieces, material.second),
    },
    sampleCount: constraints.length,
    coarseSamples: samples,
    assemblyResidual: { meanMm: assembly.meanResidualMm, maxMm: assembly.maxResidualMm },
    adapterResidual: { meanMm: adapter.meanResidualMm, maxMm: adapter.maxResidualMm },
    workerStep0: workerGroup(step0, groupId),
    gravityZero: Object.fromEntries([...checkpoints].map(([step, diagnostics]) => [`step${step}`, workerGroup(diagnostics, groupId)])),
  };
}

function rangeReports(pieces: readonly PatternPiece[], ranges: readonly EdgeRange[]) {
  let accumulated = 0;
  return ranges.map((range, order) => {
    const lengthMm = edgeRangeSequenceLength(pieces, [range]);
    const start = rangePoint(pieces, range, range.startT);
    const end = rangePoint(pieces, range, range.endT);
    const report = {
      order,
      ...range,
      pieceName: pieces.find((piece) => piece.id === range.pieceId)?.name,
      lengthMm,
      accumulatedStartMm: accumulated,
      accumulatedEndMm: accumulated + lengthMm,
      start,
      end,
      startTangent: rangeTangent(pieces, range, range.startT),
      endTangent: rangeTangent(pieces, range, range.endT),
    };
    accumulated += lengthMm;
    return report;
  });
}

function coarseBindingReport(mesh: CoarseAssemblyMesh, binding: Parameters<typeof evaluateCoarseBinding>[1]) {
  return {
    materialMm: [binding.materialXMm, binding.materialYMm],
    triangleId: binding.triangleIndex,
    vertices: binding.vertices,
    barycentricWeights: binding.weights,
    initialPositionM: evaluateCoarseBinding(mesh, binding),
    normal: triangleNormal(mesh, binding.triangleIndex),
  };
}

function triangleNormal(mesh: CoarseAssemblyMesh, triangleIndex: number): readonly [number, number, number] {
  const indices = [mesh.triangles[triangleIndex * 3], mesh.triangles[triangleIndex * 3 + 1], mesh.triangles[triangleIndex * 3 + 2]];
  const point = (index: number): readonly [number, number, number] => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
  const a = point(indices[0]); const b = point(indices[1]); const c = point(indices[2]);
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 1e-12 ? [nx / length, ny / length, nz / length] : [0, 0, 0];
}

function groupAudit(audit: ReturnType<typeof auditAssemblySeamResiduals>, groupId: string) {
  const group = audit.groups.find((candidate) => candidate.seamGroupId === groupId);
  expect(group, `missing residual audit for ${groupId}`).toBeDefined();
  return group!;
}

function assertWorkerMatchesAdapter(
  diagnostics: ReturnType<typeof measureXpbdDiagnostics>,
  groupId: string,
  adapter: ReturnType<typeof groupAudit>,
): void {
  const worker = workerGroup(diagnostics, groupId);
  expect(worker.meanMm).toBeCloseTo(adapter.meanResidualMm, 5);
  expect(worker.maxMm).toBeCloseTo(adapter.maxResidualMm, 5);
}

function workerGroup(diagnostics: ReturnType<typeof measureXpbdDiagnostics>, groupId: string) {
  const group = diagnostics.seamErrorsByGroup[groupId];
  expect(group, `missing Worker diagnostics for ${groupId}`).toBeDefined();
  return {
    constraintCount: group!.constraintCount,
    meanMm: group!.meanError * 1000,
    maxMm: group!.maxError * 1000,
    worstConstraintIndex: group!.worstConstraintIndex,
  };
}

function createWorkerState(initialization: ReturnType<typeof buildXpbdInitialization>): XpbdState {
  return createXpbdState({
    positions: new Float32Array(initialization.positions),
    previousPositions: new Float32Array(initialization.previousPositions),
    predictedPositions: new Float32Array(initialization.predictedPositions),
    velocities: new Float32Array(initialization.velocities),
    inverseMasses: new Float32Array(initialization.inverseMasses),
    restPositions: new Float32Array(initialization.restPositions),
    materialCoordinates: new Float32Array(initialization.materialCoordinates),
    triangles: new Uint32Array(initialization.triangles),
    distances: { indices: new Uint32Array(initialization.distanceIndices), restLengths: new Float32Array(initialization.distanceRestLengths), compliances: new Float32Array(initialization.distanceCompliances), lambdas: new Float32Array(initialization.distanceRestLengths.length), kinds: new Uint8Array(initialization.distanceKinds) },
    shears: { indices: new Uint32Array(initialization.shearIndices), restCosines: new Float32Array(initialization.shearRestCosines), compliances: new Float32Array(initialization.shearCompliances), lambdas: new Float32Array(initialization.shearRestCosines.length) },
    seams: { indices: new Uint32Array(initialization.seamIndices), weights: new Float32Array(initialization.seamWeights), restDistances: new Float32Array(initialization.seamRestDistances), compliances: new Float32Array(initialization.seamCompliances), relaxations: new Float32Array(initialization.seamRelaxations), lambdas: new Float32Array(initialization.seamRestDistances.length), seamGroupIds: [...initialization.seamGroupIds] },
    pins: { indices: new Uint32Array(initialization.pinIndices), targets: new Float32Array(initialization.pinTargets) },
    config: { ...initialization.config, gravity: [0, 0, 0] },
  });
}

function seamNames(seam: Seam, pieces: readonly PatternPiece[]): Set<string> {
  const byId = new Map(pieces.map((piece) => [piece.id, piece.name]));
  return new Set([...seamSideRanges(seam, "first"), ...seamSideRanges(seam, "second")]
    .map((range) => byId.get(range.pieceId))
    .filter((name): name is string => Boolean(name)));
}

function rangeIdentitySet(ranges: readonly EdgeRange[]): Set<string> {
  return new Set(ranges.map(rangeKey));
}

function rangeKey(range: EdgeRange): string {
  return `${range.pieceId}|${range.edgeId}|${range.startT}|${range.endT}`;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
