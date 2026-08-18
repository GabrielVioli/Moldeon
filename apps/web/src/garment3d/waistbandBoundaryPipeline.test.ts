import { describe, expect, it } from "vitest";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type GarmentDraft, type PatternPiece, type Seam } from "../domain/pattern";
import { garmentDraftToPatternDocumentV3, parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import { buildCoarseAssemblySet, evaluateCoarseBinding } from "./CoarseAssemblyMesh";
import { buildCoarseFineBindings, transferCoarseAssemblyToFine } from "./CoarseFineBinding";
import { buildCoarseSeamResolution } from "./CoarseSeamConstraints";
import { solveIsometricSurfaceAssembly } from "./IsometricSurfaceAssembly";
import { buildResolvedAssemblyInputFromDocument } from "./ResolvedAssemblyInput";
import { buildResolvedGarmentAssembly } from "./ResolvedGarmentAssembly";

const PANEL_IDS = ["curve-p0", "curve-p1", "curve-p2", "curve-p3"] as const;
const BAND_ID = "curve-band";
const WAIST_GROUP = "waist-join";

describe("Prompt 10.7.1 waist boundary pipeline", () => {
  it("preserves the authored waist EdgeRanges through physical, coarse and fine binding", () => {
    const document = mixedDirectionDocument();
    const trace = traceDocument(document, true);
    const canonical = document.seamGroups.find((group) => group.id === WAIST_GROUP)!;
    const expectedTopEdges = new Set(canonical.first.map((range) => range.edgeId));
    const bandBottom = canonical.second[0].edgeId;

    expect(canonical.first).toHaveLength(4);
    expect(canonical.physicalBindings).toHaveLength(1);
    expect(new Set(canonical.physicalBindings![0].first.map((ref) => ref.patternId))).toEqual(new Set(PANEL_IDS));
    expect(canonical.physicalBindings![0].second[0].patternId).toBe(BAND_ID);

    const projected = trace.input.garmentProjection.seams?.find((seam) => seam.groupId === WAIST_GROUP)!;
    expect(new Set((projected.firstRanges ?? [projected.first]).map((range) => range.edgeId))).toEqual(expectedTopEdges);
    expect((projected.secondRanges ?? [projected.second]).map((range) => range.edgeId)).toEqual([bandBottom]);

    const fineStitches = trace.state.stitchConstraints.filter((stitch) => stitch.seamGroupId === WAIST_GROUP);
    expect(fineStitches.length).toBeGreaterThan(8);
    expect(fineStitches.every((stitch) => Boolean(stitch.rangeA && expectedTopEdges.has(stitch.rangeA.edgeId)))).toBe(true);
    expect(fineStitches.every((stitch) => stitch.rangeB?.edgeId === bandBottom)).toBe(true);

    const topByPattern = new Map(canonical.first.map((range) => [range.pieceId, range.edgeId]));
    for (const instance of panelInstances(trace)) {
      const piece = trace.input.garmentProjection.pieces.find((candidate) => candidate.id === instance.sourcePatternId)!;
      const hemEdge = getPatternEdges(piece)[2].id;
      const topEdge = topByPattern.get(instance.sourcePatternId)!;
      const mesh = trace.coarse.byInstanceId.get(instance.id)!;
      const topPath = mesh.boundaryPaths[topEdge];
      const hemPath = mesh.boundaryPaths[hemEdge];
      expect(topPath).toBeDefined();
      expect(hemPath).toBeDefined();
      const topYs = [...topPath.vertexIndices].map((vertex) => mesh.materialPositionsMm[vertex * 2 + 1]);
      const hemYs = [...hemPath.vertexIndices].map((vertex) => mesh.materialPositionsMm[vertex * 2 + 1]);
      expect(Math.min(...topYs)).toBeGreaterThan(-25);
      expect(Math.max(...topYs)).toBeLessThan(2);
      expect(Math.max(...hemYs.map((y) => Math.abs(y - 420)))).toBeLessThan(1e-3);
      expect(trace.state.stitchConstraints.some((stitch) =>
        stitch.rangeA?.edgeId === hemEdge || stitch.rangeB?.edgeId === hemEdge,
      )).toBe(false);
    }

    const coarseWaist = trace.seams.byGroup.get(WAIST_GROUP) ?? [];
    expect(coarseWaist.length).toBe(fineStitches.length);
    expect(coarseWaist.every((seam) => seam.a.materialYMm > -25 && seam.a.materialYMm < 2)).toBe(true);
    expect(coarseWaist.every((seam) => Math.abs(seam.b.materialYMm - 42) < 1e-3)).toBe(true);

    for (const instance of panelInstances(trace)) {
      const mesh = trace.coarse.byInstanceId.get(instance.id)!;
      const topEdge = topByPattern.get(instance.sourcePatternId)!;
      const topPath = instance.topology.edges.get(topEdge)!;
      const bindings = trace.fineBindings.byInstance.get(instance.id)!;
      for (const local of topPath.vertexIndices) {
        const binding = bindings.find((candidate) => candidate.fineLocalVertex === local)!;
        const xMm = instance.topology.positions2DMm[local * 2];
        const yMm = instance.topology.positions2DMm[local * 2 + 1];
        expect(binding.coarse.materialXMm).toBeCloseTo(xMm, 4);
        expect(binding.coarse.materialYMm).toBeCloseTo(yMm, 4);
        const expected = evaluateCoarseBinding(mesh, binding.coarse);
        const offset = binding.fineParticleIndex * 3;
        expect(distance(expected, [
          trace.state.positions[offset],
          trace.state.positions[offset + 1],
          trace.state.positions[offset + 2],
        ])).toBeLessThan(2e-6);
      }
    }

    const maxWaistGap = Math.max(...coarseWaist.map((seam) => distance(
      evaluateCoarseBinding(trace.coarse.byInstanceId.get(seam.instanceA)!, seam.a),
      evaluateCoarseBinding(trace.coarse.byInstanceId.get(seam.instanceB)!, seam.b),
    )));
    expect(maxWaistGap).toBeLessThan(0.04);

    if (process.env.MOLDEON_10_7_1_REPORT === "1") {
      console.log("MOLDEON_10_7_1_BOUNDARY_TRACE", JSON.stringify(boundaryDiagnostics(trace, fineStitches)));
    }
  }, 20_000);

  it("does not swap top/bottom for mirrored PanelInstances", () => {
    const base = mixedDirectionDocument();
    const mirrored: PatternDocumentV3 = {
      ...base,
      panelInstances: base.panelInstances.map((instance, index) => ({
        ...instance,
        mirrored: index === 1 || index === 3 ? !instance.mirrored : instance.mirrored,
      })),
    };
    assertWaistMaterialIdentity(traceDocument(mirrored, false));
  });

  it("is invariant to PatternDefinition, PanelInstance and SeamGroup insertion order", () => {
    const base = mixedDirectionDocument();
    const reordered: PatternDocumentV3 = {
      ...base,
      patternDefinitions: [...base.patternDefinitions].reverse(),
      panelInstances: [...base.panelInstances].reverse(),
      seamGroups: [...base.seamGroups].reverse(),
      workspace: { ...base.workspace, patterns: [...base.workspace.patterns].reverse() },
    };
    expect(materialTraceSignature(traceDocument(base, false))).toEqual(
      materialTraceSignature(traceDocument(reordered, false)),
    );
  });
});

function mixedDirectionDocument(): PatternDocumentV3 {
  // Full-chain test intentionally uses the same normalized document shape the
  // editor sends to the assembly worker. Mixed-direction contour traversal is
  // isolated in waistbandBoundaryBinding.test.ts, where it is the actual bug
  // reproducer rather than a parser-idempotency test.
  return garmentDraftToPatternDocumentV3(curvedSkirtWithBand());
}

function traceDocument(document: PatternDocumentV3, solve: boolean) {
  const input = buildResolvedAssemblyInputFromDocument(document);
  const state = buildResolvedGarmentAssembly(input);
  const coarse = buildCoarseAssemblySet(state);
  const seams = buildCoarseSeamResolution(state, coarse);
  const fineBindings = buildCoarseFineBindings(state, coarse);
  if (solve) {
    solveIsometricSurfaceAssembly(state, coarse, seams);
    transferCoarseAssemblyToFine(state, coarse, fineBindings);
  }
  return { input, state, coarse, seams, fineBindings };
}

function panelInstances(trace: ReturnType<typeof traceDocument>) {
  return trace.state.instances.filter((item) => PANEL_IDS.includes(item.sourcePatternId as typeof PANEL_IDS[number]));
}

function assertWaistMaterialIdentity(trace: ReturnType<typeof traceDocument>): void {
  const canonical = trace.input.document.seamGroups.find((group) => group.id === WAIST_GROUP)!;
  const topEdges = new Set(canonical.first.map((range) => range.edgeId));
  const bandBottom = canonical.second[0].edgeId;
  const waist = trace.state.stitchConstraints.filter((stitch) => stitch.seamGroupId === WAIST_GROUP);
  expect(waist.length).toBeGreaterThan(8);
  expect(waist.every((stitch) => Boolean(stitch.rangeA && topEdges.has(stitch.rangeA.edgeId)))).toBe(true);
  expect(waist.every((stitch) => stitch.rangeB?.edgeId === bandBottom)).toBe(true);
  const coarse = trace.seams.byGroup.get(WAIST_GROUP) ?? [];
  expect(coarse.length).toBe(waist.length);
  expect(coarse.every((seam) => seam.a.materialYMm > -25 && seam.a.materialYMm < 2)).toBe(true);
  expect(coarse.every((seam) => Math.abs(seam.b.materialYMm - 42) < 1e-3)).toBe(true);
}

function materialTraceSignature(trace: ReturnType<typeof traceDocument>): string[] {
  return trace.state.stitchConstraints
    .filter((stitch) => stitch.seamGroupId === WAIST_GROUP)
    .map((stitch) => [
      stitch.instanceA, stitch.instanceB,
      stitch.rangeA?.edgeId, stitch.rangeA?.startT, stitch.rangeA?.endT,
      stitch.rangeB?.edgeId, stitch.rangeB?.startT, stitch.rangeB?.endT,
      stitch.progress?.toFixed(6),
    ].join("|"))
    .sort();
}

function boundaryDiagnostics(
  trace: ReturnType<typeof traceDocument>,
  stitches: ReturnType<typeof traceDocument>["state"]["stitchConstraints"],
) {
  const coarseById = new Map(trace.seams.constraints.map((seam) => [seam.id, seam]));
  const sampleIndices = new Set([0, Math.floor(stitches.length / 2), Math.max(0, stitches.length - 1)]);
  return stitches.flatMap((stitch, index) => {
    if (!sampleIndices.has(index)) return [];
    const coarse = coarseById.get(stitch.id);
    if (!coarse || !stitch.instanceA || !stitch.instanceB) return [];
    const meshA = trace.coarse.byInstanceId.get(stitch.instanceA)!;
    const meshB = trace.coarse.byInstanceId.get(stitch.instanceB)!;
    return [{
      groupId: stitch.seamGroupId,
      physicalInstanceA: stitch.instanceA,
      physicalInstanceB: stitch.instanceB,
      sourceA: stitch.rangeA,
      sourceB: stitch.rangeB,
      progress: stitch.progress,
      coarseA: {
        material: [coarse.a.materialXMm, coarse.a.materialYMm],
        triangle: coarse.a.triangleIndex,
        vertices: coarse.a.vertices,
        weights: coarse.a.weights,
        boundaryVertexIds: stitch.rangeA ? [...(meshA.boundaryPaths[stitch.rangeA.edgeId]?.vertexIndices ?? [])] : [],
        position: evaluateCoarseBinding(meshA, coarse.a),
      },
      coarseB: {
        material: [coarse.b.materialXMm, coarse.b.materialYMm],
        triangle: coarse.b.triangleIndex,
        vertices: coarse.b.vertices,
        weights: coarse.b.weights,
        boundaryVertexIds: stitch.rangeB ? [...(meshB.boundaryPaths[stitch.rangeB.edgeId]?.vertexIndices ?? [])] : [],
        position: evaluateCoarseBinding(meshB, coarse.b),
      },
    }];
  });
}

function curvedSkirtWithBand(): GarmentDraft {
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  const panels = PANEL_IDS.map((id, index) => curvedPanel(id, 104 + index * 3));
  const band = rectangle(BAND_ID, panels.reduce((sum, panel) => sum + topChord(panel), 0), 42);
  const seams: Seam[] = [];
  for (let index = 0; index < panels.length; index += 1) {
    seams.push({
      id: `side-${index}`,
      first: rangeByIndex(panels[index], 1),
      second: rangeByIndex(panels[(index + 1) % panels.length], 3),
      direction: "opposite", easeRatio: 0, type: "standard", treatment: "standard", active: true,
    });
  }
  seams.push({
    id: "band-loop",
    first: rangeByIndex(band, 1), second: rangeByIndex(band, 3),
    direction: "opposite", easeRatio: 0, type: "standard", treatment: "standard", active: true,
  });
  seams.push({
    id: WAIST_GROUP, groupId: WAIST_GROUP,
    first: rangeByIndex(panels[0], 0),
    firstRanges: panels.map((panel) => rangeByIndex(panel, 0)),
    second: rangeByIndex(band, 2),
    direction: "opposite", easeRatio: 0, type: "standard", treatment: "standard", active: true,
  });
  return {
    ...blank,
    name: "10.7.1 curved skirt boundary regression",
    fabrics: [fabric],
    pieces: [...panels, band].map((piece) => ({ ...piece, fabricId: fabric.id })),
    seams,
  };
}

function curvedPanel(id: string, widthMm: number): PatternPiece {
  return {
    id, name: id, seamAllowanceMm: 0, cutQuantity: 1,
    points: [
      { id: `${id}:tl`, xMm: 0, yMm: 0, handleOut: { xMm: widthMm * 0.3, yMm: -18 } },
      { id: `${id}:tr`, xMm: widthMm, yMm: 0, handleIn: { xMm: widthMm * 0.7, yMm: -18 } },
      { id: `${id}:br`, xMm: widthMm + 14, yMm: 420 },
      { id: `${id}:bl`, xMm: -14, yMm: 420 },
    ],
  };
}

function rectangle(id: string, widthMm: number, heightMm: number): PatternPiece {
  return {
    id, name: id, seamAllowanceMm: 0, cutQuantity: 1,
    points: [
      { id: `${id}:tl`, xMm: 0, yMm: 0 },
      { id: `${id}:tr`, xMm: widthMm, yMm: 0 },
      { id: `${id}:br`, xMm: widthMm, yMm: heightMm },
      { id: `${id}:bl`, xMm: 0, yMm: heightMm },
    ],
  };
}

function rangeByIndex(piece: PatternPiece, edgeIndex: number) {
  const edge = getPatternEdges(piece)[edgeIndex];
  return { pieceId: piece.id, edgeId: edge.id, startT: 0, endT: 1 };
}

function topChord(piece: PatternPiece): number {
  return Math.abs(piece.points[1].xMm - piece.points[0].xMm);
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
