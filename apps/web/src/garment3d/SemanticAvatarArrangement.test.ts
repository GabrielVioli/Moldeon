import { describe, expect, it } from "vitest";
import { createPatternSnapshot } from "../core/fallbackPatternEngine";
import { duplicatePatternPiece, type GarmentDraft } from "../domain/pattern";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import {
  createGarmentFromTemplate,
  DEFAULT_BODY_MEASUREMENTS,
  type PatternTemplateId,
} from "../patterns/templateCatalog";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

function arrange(templateId: PatternTemplateId) {
  const garment = createGarmentFromTemplate(templateId, DEFAULT_BODY_MEASUREMENTS, "feminine");
  const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
  return buildSemanticAvatarArrangement(
    garment.pieces.map(createPatternSnapshot),
    garment,
    avatar,
  );
}

function instanceCenterX(result: ReturnType<typeof arrange>, instanceId: string): number {
  const instance = result.state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error(`Instância ausente: ${instanceId}`);
  let sum = 0;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    sum += result.state.positions[(instance.particleStart + local) * 3];
  }
  return sum / instance.vertexCount;
}

describe("SemanticAvatarArrangement", () => {
  it("places a t-shirt and its sleeves on torso and correct arms", () => {
    const result = arrange("tshirt");
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(visible).toHaveLength(6);
    const arms = visible.filter((instance) => instance.placement.region === "arm");
    expect(arms.map((instance) => instance.placement.bodySide).sort()).toEqual(["left", "right"]);
    const left = arms.find((instance) => instance.placement.bodySide === "left")!;
    const right = arms.find((instance) => instance.placement.bodySide === "right")!;
    expect(instanceCenterX(result, left.id)).toBeLessThan(0);
    expect(instanceCenterX(result, right.id)).toBeGreaterThan(0);
    expect(visible.every((instance) => instance.arrangement?.anchorId)).toBe(true);
    expect(result.state.positions.every(Number.isFinite)).toBe(true);
  });

  it("wraps skirt front and back around waist and hip instead of floating", () => {
    const result = arrange("straight-skirt");
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(visible).toHaveLength(4);
    expect(visible.every((instance) => instance.arrangement?.mapping === "body-surface")).toBe(true);
    const yValues = visible.flatMap((instance) => Array.from({ length: instance.vertexCount }, (_, local) => result.state.positions[(instance.particleStart + local) * 3 + 1]));
    expect(Math.max(...yValues)).toBeLessThanOrEqual(result.avatar.landmarks.waistY + 0.04);
    expect(Math.min(...yValues)).toBeLessThan(result.avatar.landmarks.hipY);
  });

  it("places four trouser panels on the declared left and right legs", () => {
    const result = arrange("straight-pants");
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(visible).toHaveLength(4);
    const left = visible.filter((instance) => instance.placement.bodySide === "left");
    const right = visible.filter((instance) => instance.placement.bodySide === "right");
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    expect(left.every((instance) => instanceCenterX(result, instance.id) < 0)).toBe(true);
    expect(right.every((instance) => instanceCenterX(result, instance.id) > 0)).toBe(true);
    expect(visible.every((instance) => instance.arrangement?.mapping === "anatomical-half-tube")).toBe(true);
  });

  it("omits an unanchored panel and emits a named diagnostic", () => {
    const garment = createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS, "feminine");
    const invalidPieceId = garment.pieces[0].id;
    const snapshots = garment.pieces.map(createPatternSnapshot);
    const invalid: GarmentDraft = {
      ...garment,
      pieces: garment.pieces.map((piece) => piece.id === invalidPieceId ? { ...piece, previewPlacements: [] } : piece),
      assemblyPlacements: garment.assemblyPlacements?.filter((placement) => placement.pieceId !== invalidPieceId),
    };
    const result = buildSemanticAvatarArrangement(
      snapshots,
      invalid,
      buildAvatarParametricModel(invalid.measurements, invalid.bodyType),
    );
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-anchor", pieceId: invalidPieceId, severity: "error" }),
    ]));
    expect(result.state.instances.filter((instance) => instance.pieceId === invalidPieceId && result.visibleInstanceIds.has(instance.id))).toHaveLength(0);
  });

  it("reports a disconnected but anchored component", () => {
    const garment = createGarmentFromTemplate("tshirt", DEFAULT_BODY_MEASUREMENTS, "feminine");
    const front = garment.pieces.find((piece) => piece.previewPlacements?.some((placement) => placement.region === "torso" && placement.surface === "front"))!;
    const extra = duplicatePatternPiece(front, { newId: "detached-front", name: "Painel adicional" });
    extra.previewPlacements = [{
      ...front.previewPlacements![0],
      id: "detached-front-anchor",
      pieceId: extra.id,
      offsetZMm: 18,
    }];
    const extended: GarmentDraft = { ...garment, pieces: [...garment.pieces, extra] };
    const result = buildSemanticAvatarArrangement(
      extended.pieces.map(createPatternSnapshot),
      extended,
      buildAvatarParametricModel(extended.measurements, extended.bodyType),
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "disconnected-component" && diagnostic.pieceId === extra.id)).toBe(true);
  });


  it("masks only mannequin shells covered by each semantic garment", () => {
    const shirt = arrange("tshirt");
    expect([...shirt.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:chest",
      "avatar:abdomen",
      "avatar:upper-arm-left",
      "avatar:upper-arm-right",
    ]));
    expect(shirt.coveredAvatarPartNames.has("avatar:head")).toBe(false);
    expect(shirt.coveredAvatarPartNames.has("avatar:hand-left")).toBe(false);

    const skirt = arrange("straight-skirt");
    expect([...skirt.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:pelvis",
      "avatar:thigh-left",
      "avatar:thigh-right",
    ]));
    expect(skirt.coveredAvatarPartNames.has("avatar:foot-left")).toBe(false);

    const trousers = arrange("straight-pants");
    expect([...trousers.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:pelvis",
      "avatar:thigh-left",
      "avatar:thigh-right",
      "avatar:calf-left",
      "avatar:calf-right",
    ]));
    expect(trousers.coveredAvatarPartNames.has("avatar:foot-left")).toBe(false);
  });

});
