import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import type { BodyAnchorId, GarmentDraft, PatternPiece } from "../domain/pattern";
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
});
