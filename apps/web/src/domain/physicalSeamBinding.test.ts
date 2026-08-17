import { describe, expect, it } from "vitest";
import { createBlankGarment } from "./blankGarment";
import { createDefaultFabricSource } from "./fabric";
import { getPatternEdges, type GarmentDraft, type PatternPiece } from "./pattern";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  serializePatternDocumentV3,
  validatePatternDocumentV3,
} from "./patternDocumentV3";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { buildResolvedGarmentAssembly } from "../garment3d/ResolvedGarmentAssembly";

function square(id: string, cutQuantity = 1): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 0,
    cutQuantity,
    points: [
      { id: `${id}:a`, xMm: 0, yMm: 0 },
      { id: `${id}:b`, xMm: 120, yMm: 0 },
      { id: `${id}:c`, xMm: 120, yMm: 180 },
      { id: `${id}:d`, xMm: 0, yMm: 180 },
    ],
  };
}

function garment(pieces: PatternPiece[]): GarmentDraft {
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  return { ...blank, fabrics: [fabric], pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })) };
}

describe("Prompt 10.7 canonical physical seam binding", () => {
  it("persists exact PanelInstance ids for cutQuantity > 1", () => {
    const a = square("a", 2);
    const b = square("b", 2);
    const draft = garment([a, b]);
    draft.seams = [{
      id: "side",
      first: { pieceId: a.id, edgeId: getPatternEdges(a)[1].id, startT: 0, endT: 1 },
      second: { pieceId: b.id, edgeId: getPatternEdges(b)[3].id, startT: 0, endT: 1 },
      direction: "opposite", easeRatio: 0, type: "standard", active: true,
    }];
    const document = garmentDraftToPatternDocumentV3(draft);
    expect(document.seamGroups[0].physicalPairing).toBeUndefined();
    expect(document.seamGroups[0].physicalBindings).toEqual([
      { id: "side:physical:1", first: [{ patternId: "a", panelInstanceId: "a:panel:1" }], second: [{ patternId: "b", panelInstanceId: "b:panel:1" }] },
      { id: "side:physical:2", first: [{ patternId: "a", panelInstanceId: "a:panel:2" }], second: [{ patternId: "b", panelInstanceId: "b:panel:2" }] },
    ]);
    const reparsed = parsePatternDocumentV3(JSON.parse(serializePatternDocumentV3(document)));
    expect(reparsed.seamGroups[0].physicalBindings).toEqual(document.seamGroups[0].physicalBindings);
    expect(patternDocumentV3ToGarmentDraft(reparsed).seams?.[0].physicalBindings).toEqual(document.seamGroups[0].physicalBindings);
  });

  it("migrates paired-copy self material into distinct concrete copies", () => {
    const a = square("paired", 2);
    const edge = getPatternEdges(a)[1];
    const draft = garment([a]);
    draft.seams = [{
      id: "paired-rise",
      first: { pieceId: a.id, edgeId: edge.id, startT: 0, endT: 1 },
      second: { pieceId: a.id, edgeId: edge.id, startT: 0, endT: 1 },
      direction: "same", easeRatio: 0, type: "standard", physicalPairing: "paired-copies", active: true,
    }];
    const document = garmentDraftToPatternDocumentV3(draft);
    expect(document.seamGroups[0].physicalPairing).toBeUndefined();
    expect(document.seamGroups[0].physicalBindings).toEqual([{
      id: "paired-rise:physical:1",
      first: [{ patternId: "paired", panelInstanceId: "paired:panel:1" }],
      second: [{ patternId: "paired", panelInstanceId: "paired:panel:2" }],
    }]);
    expect(validatePatternDocumentV3(document).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("keeps manual unclassified includedIn3D panels in structural runtime", () => {
    const a = square("manual-a");
    const b = square("manual-b");
    const draft = garment([a, b]);
    draft.seams = [{
      id: "manual-side",
      first: { pieceId: a.id, edgeId: getPatternEdges(a)[1].id, startT: 0, endT: 1 },
      second: { pieceId: b.id, edgeId: getPatternEdges(b)[3].id, startT: 0, endT: 1 },
      direction: "opposite", easeRatio: 0, type: "standard", active: true,
    }];
    const input = buildResolvedAssemblyInput(draft);
    expect(input.document.patternDefinitions.every((definition) => definition.bodyPlacement.status === "unclassified")).toBe(true);
    expect(input.panelInstances.map((instance) => instance.id).sort()).toEqual(["manual-a:panel:1", "manual-b:panel:1"]);
    expect(input.panelInstances.every((instance) => instance.arrangementAnchor === undefined)).toBe(true);
    const state = buildResolvedGarmentAssembly(input);
    expect(state.instances.map((instance) => instance.id).sort()).toEqual(["manual-a:panel:1", "manual-b:panel:1"]);
    expect(state.stitchConstraints.some((constraint) => constraint.seamGroupId === "manual-side")).toBe(true);
  });

  it("uses explicit ids rather than body side or list order", () => {
    const a = square("a-explicit", 2);
    const b = square("b-explicit", 2);
    const draft = garment([a, b]);
    draft.seams = [{
      id: "explicit",
      first: { pieceId: a.id, edgeId: getPatternEdges(a)[1].id, startT: 0, endT: 1 },
      second: { pieceId: b.id, edgeId: getPatternEdges(b)[3].id, startT: 0, endT: 1 },
      direction: "opposite", easeRatio: 0, type: "standard",
      physicalBindings: [{
        id: "explicit:custom",
        first: [{ patternId: a.id, panelInstanceId: "a-explicit:panel:1" }],
        second: [{ patternId: b.id, panelInstanceId: "b-explicit:panel:2" }],
      }],
      active: true,
    }];
    const state = buildResolvedGarmentAssembly(buildResolvedAssemblyInput(draft));
    const seams = state.stitchConstraints.filter((constraint) => constraint.seamGroupId === "explicit");
    expect(seams.length).toBeGreaterThan(0);
    expect(new Set(seams.map((constraint) => `${constraint.instanceA}->${constraint.instanceB}`))).toEqual(
      new Set(["a-explicit:panel:1->b-explicit:panel:2"]),
    );
  });
});
