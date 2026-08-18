import { describe, expect, it } from "vitest";
import { analyzeSeamCompatibility, validateSeamForAssembly } from "./assembly";
import {
  edgeRangeSequenceLength,
  edgeRangesMateriallyOverlap,
  getPatternEdges,
  resolveEdgeRangeSequenceProgress,
  seamSideRanges,
  type EdgeRange,
  type GarmentDraft,
  type PatternPiece,
  type Seam,
} from "./pattern";
import { garmentDraftToPatternDocumentV3, patternDocumentV3ToGarmentDraft } from "./patternDocumentV3";
import { createDefaultFabricSource } from "./fabric";

function strip(id: string, lengthMm: number): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 0,
    points: [
      { id: `${id}:0`, xMm: 0, yMm: 0 },
      { id: `${id}:1`, xMm: lengthMm, yMm: 0 },
      { id: `${id}:2`, xMm: lengthMm, yMm: 20 },
      { id: `${id}:3`, xMm: 0, yMm: 20 },
    ],
  };
}

function range(piece: PatternPiece): EdgeRange {
  return { pieceId: piece.id, edgeId: getPatternEdges(piece)[0].id, startT: 0, endT: 1 };
}

function garment(lengths: number[]): GarmentDraft {
  const fabric = createDefaultFabricSource();
  return {
    id: "composite",
    templateId: "composite",
    name: "Composite",
    description: "Teste",
    bodyType: "feminine",
    measurements: {
      heightMm: 1680, bustMm: 920, waistMm: 760, hipMm: 1000,
      shoulderWidthMm: 400, torsoLengthMm: 440, armLengthMm: 590, inseamMm: 780,
    },
    fabrics: [fabric],
    pieces: lengths.map((length, index) => ({ ...strip(`p${index}`, length), fabricId: fabric.id })),
  };
}

function seam(firstRanges: EdgeRange[], secondRanges: EdgeRange[], direction: Seam["direction"] = "same"): Seam {
  return {
    id: "composite-seam",
    name: "Costura composta",
    first: firstRanges[0],
    second: secondRanges[0],
    ...(firstRanges.length > 1 ? { firstRanges } : {}),
    ...(secondRanges.length > 1 ? { secondRanges } : {}),
    direction,
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
  };
}

describe("composite SeamGroup sides", () => {
  it("allows distinct left and right edges of the same physical panel", () => {
    const draft = garment([100]);
    const edges = getPatternEdges(draft.pieces[0]);
    const right = { pieceId: draft.pieces[0].id, edgeId: edges[1].id, startT: 0, endT: 1 };
    const left = { pieceId: draft.pieces[0].id, edgeId: edges[3].id, startT: 0, endT: 1 };

    expect(edgeRangesMateriallyOverlap(left, right)).toBe(false);
    expect(analyzeSeamCompatibility(draft, left, right).compatible).toBe(true);
    expect(validateSeamForAssembly(seam([left], [right]), draft)).toEqual([]);
  });

  it("rejects only positive material overlap on the same edge", () => {
    const draft = garment([100]);
    const edge = getPatternEdges(draft.pieces[0])[0];
    const material = (startT: number, endT: number): EdgeRange => ({
      pieceId: draft.pieces[0].id,
      edgeId: edge.id,
      startT,
      endT,
    });

    expect(validateSeamForAssembly(seam([material(0, 1)], [material(0, 1)]), draft))
      .toContainEqual(expect.objectContaining({ code: "invalid-self-seam" }));
    expect(validateSeamForAssembly(seam([material(0, 0.65)], [material(0.4, 1)]), draft))
      .toContainEqual(expect.objectContaining({ code: "invalid-self-seam" }));
    expect(edgeRangesMateriallyOverlap(material(0, 0.4), material(0.6, 1))).toBe(false);
    expect(analyzeSeamCompatibility(draft, material(0, 0.4), material(0.6, 1)).compatible).toBe(true);
    expect(edgeRangesMateriallyOverlap(material(0, 0.5), material(0.5, 1))).toBe(false);
    expect(analyzeSeamCompatibility(draft, material(0, 0.5), material(0.5, 1)).compatible).toBe(true);
  });

  it("allows a composite self-panel seam when every material range is disjoint", () => {
    const draft = garment([100]);
    const edges = getPatternEdges(draft.pieces[0]);
    const top = (startT: number, endT: number): EdgeRange => ({ pieceId: "p0", edgeId: edges[0].id, startT, endT });
    const side = (edgeIndex: number): EdgeRange => ({ pieceId: "p0", edgeId: edges[edgeIndex].id, startT: 0, endT: 1 });
    const first = [side(1), top(0, 0.25)];
    const second = [side(3), top(0.5, 0.75)];

    expect(analyzeSeamCompatibility(draft, first, second).compatible).toBe(true);
    expect(validateSeamForAssembly(seam(first, second), draft)).toEqual([]);
  });

  it.each([
    { label: "uma para uma", lengths: [100, 100], a: [0], b: [1] },
    { label: "uma para duas", lengths: [300, 120, 180], a: [0], b: [1, 2] },
    { label: "duas para uma", lengths: [120, 180, 300], a: [0, 1], b: [2] },
    { label: "duas para três", lengths: [200, 300, 100, 150, 250], a: [0, 1], b: [2, 3, 4] },
  ])("accepts $label by accumulated arc length", ({ lengths, a, b }) => {
    const draft = garment(lengths);
    const first = a.map((index) => range(draft.pieces[index]));
    const second = b.map((index) => range(draft.pieces[index]));
    const candidate = seam(first, second);

    expect(analyzeSeamCompatibility(draft, first, second)).toMatchObject({
      compatible: true,
      differenceMm: 0,
      recommendedTreatment: "standard",
    });
    expect(validateSeamForAssembly(candidate, draft).some((issue) => issue.code === "length-mismatch")).toBe(false);
  });

  it("rejects incompatible accumulated totals rather than an individual range", () => {
    const draft = garment([569.4, 284.1, 285.3, 200]);
    const first = [range(draft.pieces[0])];
    const compatibleSecond = [range(draft.pieces[1]), range(draft.pieces[2])];
    const incompatibleSecond = [...compatibleSecond, range(draft.pieces[3])];

    expect(analyzeSeamCompatibility(draft, first, compatibleSecond).differenceMm).toBeCloseTo(0, 5);
    expect(validateSeamForAssembly(seam(first, compatibleSecond), draft)).toEqual([]);
    expect(validateSeamForAssembly(seam(first, incompatibleSecond), draft)).toContainEqual(
      expect.objectContaining({ code: "length-mismatch" }),
    );
  });

  it("maps global s through ordered ranges and reverses the whole second side for opposite", () => {
    const draft = garment([200, 300, 100, 400]);
    const first = [range(draft.pieces[0]), range(draft.pieces[1])];
    const second = [range(draft.pieces[2]), range(draft.pieces[3])];

    expect(resolveEdgeRangeSequenceProgress(draft.pieces, first, 0.2)).toMatchObject({ rangeIndex: 0, localProgress: 0.5 });
    expect(resolveEdgeRangeSequenceProgress(draft.pieces, first, 0.7)).toMatchObject({ rangeIndex: 1, localProgress: 0.5 });
    expect(resolveEdgeRangeSequenceProgress(draft.pieces, second, 1 - 0.2)).toMatchObject({ rangeIndex: 1, localProgress: 0.75 });
    expect(edgeRangeSequenceLength(draft.pieces, first)).toBeCloseTo(500, 5);
  });

  it("preserves range order, same/opposite and N-to-M sides through the canonical round trip", () => {
    const draft = garment([200, 300, 100, 150, 250]);
    const first = [range(draft.pieces[1]), range(draft.pieces[0])];
    const second = [range(draft.pieces[4]), range(draft.pieces[2]), range(draft.pieces[3])];
    draft.seams = [seam(first, second, "opposite")];

    const document = garmentDraftToPatternDocumentV3(draft);
    expect(document.seamGroups[0].first.map((item) => item.pieceId)).toEqual(["p1", "p0"]);
    expect(document.seamGroups[0].second.map((item) => item.pieceId)).toEqual(["p4", "p2", "p3"]);
    const restored = patternDocumentV3ToGarmentDraft(document);
    expect(seamSideRanges(restored.seams![0], "first")).toEqual(first);
    expect(seamSideRanges(restored.seams![0], "second")).toEqual(second);
    expect(restored.seams![0].direction).toBe("opposite");
  });
});
