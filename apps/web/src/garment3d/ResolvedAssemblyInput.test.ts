import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type BodyAnchorId, type GarmentDraft, type PatternPiece } from "../domain/pattern";
import { buildGarmentAssemblyMeshes } from "./GarmentThreeBridge";
import { buildResolvedGarmentAssembly } from "./ResolvedGarmentAssembly";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

function placement(
  region: "torso" | "leg",
  surface: "front" | "back",
  bodySide: "center" | "right",
  anchorId: BodyAnchorId,
) {
  return {
    version: 1 as const,
    status: "confirmed" as const,
    includeIn3D: true,
    role: "custom" as const,
    region,
    surface,
    bodySide,
    anchorId,
    outwardFace: "normal" as const,
    offsetXMm: 0,
    offsetYMm: 0,
    offsetZMm: 25,
    rotationXDeg: 0,
    rotationYDeg: 0,
    rotationZDeg: 0,
    source: "manual" as const,
  };
}

function square(id: string, bodyPlacement: PatternPiece["bodyPlacement"]): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    bodyPlacement,
    points: [
      { id: `${id}:a`, xMm: 0, yMm: 0 },
      { id: `${id}:b`, xMm: 100, yMm: 0 },
      { id: `${id}:c`, xMm: 100, yMm: 160 },
      { id: `${id}:d`, xMm: 0, yMm: 160 },
    ],
  };
}

function draft(pieces: PatternPiece[]): GarmentDraft {
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  return {
    ...blank,
    templateId: "source-a",
    fabrics: [fabric],
    pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })),
  };
}

describe("ResolvedAssemblyInput canonical contract", () => {
  it("derives front and back from the seam graph without classifying panels by name", () => {
    const first = square("banana", undefined);
    first.name = "Costas";
    const second = square("panel-123", undefined);
    second.name = "Calça";
    const garment = draft([first, second]);
    garment.dressing = { region: "upper", frontReferencePieceId: first.id };
    garment.seams = [{
      id: "side",
      name: "Lateral",
      first: { pieceId: first.id, edgeId: getPatternEdges(first)[0].id, startT: 0, endT: 1 },
      second: { pieceId: second.id, edgeId: getPatternEdges(second)[0].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    }];

    const input = buildResolvedAssemblyInput(garment);

    expect(input.document.patternDefinitions.map((definition) => definition.bodyPlacement.status)).toEqual([
      "unclassified",
      "unclassified",
    ]);
    expect(input.panelInstances).toHaveLength(2);
    expect(input.panelInstances.map((instance) => instance.surface)).toEqual(["front", "back"]);
    expect(input.panelInstances.map((instance) => instance.sourcePatternId)).toEqual([first.id, second.id]);
  });

  it("produces no panel instances or garment meshes for an empty project", () => {
    const garment = createBlankGarment();
    const input = buildResolvedAssemblyInput(garment);
    const state = buildResolvedGarmentAssembly(input);
    const meshes = buildGarmentAssemblyMeshes(state, input.garmentProjection, {
      castShadow: false,
      receiveShadow: false,
    });
    expect(input.panelInstances).toEqual([]);
    expect(state.instances).toEqual([]);
    expect(meshes).toEqual([]);
  });

  it("does not let templateId or a legacy arrangement scale alter physical assembly", () => {
    const piece = square("free", placement("torso", "front", "center", "torso-front"));
    piece.previewPlacements = [{
      id: "legacy-scaled",
      pieceId: piece.id,
      region: "torso",
      surface: "front",
      bodySide: "center",
      bodyAnchorId: "torso-front",
      rotationDeg: 0,
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 25,
      scale: 8,
    }];
    const first = draft([piece]);
    const second = { ...structuredClone(first), templateId: "completely-different-template" };
    const firstInput = buildResolvedAssemblyInput(first);
    const secondInput = buildResolvedAssemblyInput(second);
    const state = buildResolvedGarmentAssembly(firstInput);

    expect(firstInput.signature).toBe(secondInput.signature);
    expect(firstInput.panelInstances[0].arrangementAnchor?.scale).toBe(1);
    expect(state.instances[0].topology.boundsMm.width).toBeCloseTo(100, 5);
    expect(state.instances[0].placement.scale).toBe(1);
  });

  it("places identical geometry differently when explicit semantics differ", () => {
    const first = square("same-a", placement("torso", "front", "center", "torso-front"));
    const second = {
      ...square("same-b", placement("leg", "front", "right", "leg-right")),
      points: first.points.map((point, index) => ({ ...point, id: `same-b:${index}` })),
    };
    const garment = draft([first, second]);
    const input = buildResolvedAssemblyInput(garment);
    const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const result = buildSemanticAvatarArrangement(input, avatar);
    const instanceA = result.state.instances.find((instance) => instance.pieceId === first.id)!;
    const instanceB = result.state.instances.find((instance) => instance.pieceId === second.id)!;
    const firstPosition = Array.from(result.state.positions.slice(instanceA.particleStart * 3, instanceA.particleStart * 3 + 3));
    const secondPosition = Array.from(result.state.positions.slice(instanceB.particleStart * 3, instanceB.particleStart * 3 + 3));

    expect(instanceA.topology.positions2DMm).toEqual(instanceB.topology.positions2DMm);
    expect(instanceA.arrangement?.anchorId).toBe("torso-front");
    expect(instanceB.arrangement?.anchorId).toBe("leg-right");
    expect(firstPosition).not.toEqual(secondPosition);
  });

  it("consumes canonical SeamGroup treatment, distribution, ratio and slack in constraints", () => {
    const first = square("seam-a", placement("torso", "front", "center", "torso-front"));
    const second = square("seam-b", placement("torso", "back", "center", "torso-back"));
    const garment = draft([first, second]);
    garment.seams = [{
      id: "group-part-1",
      groupId: "canonical-group",
      name: "Costura canônica",
      first: { pieceId: first.id, edgeId: getPatternEdges(first)[0].id, startT: 0.1, endT: 0.9 },
      second: { pieceId: second.id, edgeId: getPatternEdges(second)[0].id, startT: 0.2, endT: 0.8 },
      direction: "opposite",
      easeRatio: 0.08,
      type: "ease",
      treatment: "ease",
      canonicalTreatment: "ease",
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 6,
      active: true,
    }];
    const input = buildResolvedAssemblyInput(garment);
    const state = buildResolvedGarmentAssembly(input);

    expect(input.seamGroups[0]).toMatchObject({
      id: "canonical-group",
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 6,
    });
    expect(state.stitchConstraints.length).toBeGreaterThan(0);
    expect(state.stitchConstraints.every((constraint) =>
      constraint.seamGroupId === "canonical-group"
      && constraint.treatment === "ease"
      && constraint.distribution === "center-biased"
      && constraint.targetRatio === 1.08
      && constraint.slackMm === 6
      && constraint.restDistance > 0.0015,
    )).toBe(true);
  });

  it.each(["same", "opposite"] as const)("generates ConstraintPoints over a composed side in %s direction", (direction) => {
    const first = square("long-edge", placement("torso", "front", "center", "torso-front"));
    const second: PatternPiece = {
      ...square("split-edge", placement("torso", "back", "center", "torso-back")),
      points: [
        { id: "split-edge:a", xMm: 0, yMm: 0 },
        { id: "split-edge:mid", xMm: 40, yMm: 0 },
        { id: "split-edge:b", xMm: 100, yMm: 0 },
        { id: "split-edge:c", xMm: 100, yMm: 160 },
        { id: "split-edge:d", xMm: 0, yMm: 160 },
      ],
    };
    const firstEdge = getPatternEdges(first)[0];
    const secondEdges = getPatternEdges(second);
    const firstRange = { pieceId: first.id, edgeId: firstEdge.id, startT: 0, endT: 1 };
    const secondRanges = [0, 1].map((index) => ({ pieceId: second.id, edgeId: secondEdges[index].id, startT: 0, endT: 1 }));
    const garment = draft([first, second]);
    garment.seams = [{
      id: "one-to-two",
      name: "Uma para duas",
      first: firstRange,
      second: secondRanges[0],
      secondRanges,
      direction,
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    }];

    const state = buildResolvedGarmentAssembly(buildResolvedAssemblyInput(garment));
    const constraints = state.stitchConstraints.filter((constraint) => constraint.seamGroupId === "one-to-two");
    expect(constraints.length).toBeGreaterThan(2);
    expect(new Set(constraints.map((constraint) => constraint.rangeB?.edgeId))).toEqual(
      new Set(secondRanges.map((range) => range.edgeId)),
    );
    expect(constraints[0].rangeB?.edgeId).toBe(direction === "same" ? secondRanges[0].edgeId : secondRanges[1].edgeId);
    expect(constraints.at(-1)?.rangeB?.edgeId).toBe(direction === "same" ? secondRanges[1].edgeId : secondRanges[0].edgeId);
  });
});
