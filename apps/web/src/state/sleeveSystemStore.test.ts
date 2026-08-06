import { beforeEach, describe, expect, it } from "vitest";
import { getPatternEdges } from "../domain/pattern";
import { createDefaultSleeveSettings, detectSleeveBody, isSleevePiece } from "../domain/sleeveSystem";
import { createGarmentFromTemplate } from "../patterns/templateCatalog";
import { createParametricBodyFixture } from "../testFixtures/parametricBodyFixtures";
import { useEditorStore } from "./editorStore";

describe("guided sleeve editor command", () => {
  beforeEach(() => {
    const fixture = createParametricBodyFixture("medium");
    useEditorStore.getState().loadGarment(
      createGarmentFromTemplate("bodice-block", fixture.supplied, fixture.bodyType, fixture.profile),
    );
  });

  it("creates the sleeve, seams and placements in one undoable command", () => {
    const initial = useEditorStore.getState().garment;
    const detection = detectSleeveBody(initial.pieces);
    const frontPieceId = detection.frontCandidates[0].pieceId;
    const backPieceId = detection.backCandidates[0].pieceId;
    const settings = createDefaultSleeveSettings(initial, frontPieceId, backPieceId, "short");

    const result = useEditorStore.getState().addGuidedSleeve({
      frontPieceId,
      backPieceId,
      settings,
      replaceExisting: false,
    });
    expect(result.accepted, result.message).toBe(true);

    const created = useEditorStore.getState();
    const sleeve = created.garment.pieces.find(isSleevePiece);
    expect(sleeve).toBeDefined();
    expect(created.activePieceId).toBe(sleeve?.id);
    expect(created.garment.seams?.some((seam) => seam.groupId === "guided-sleeve:underarm")).toBe(true);
    expect(created.garment.assemblyPlacements?.find((placement) => placement.pieceId === sleeve?.id)?.role).toBe("sleeve");
    expect(created.garment.workspaceStates?.find((entry) => entry.pieceId === sleeve?.id)).toBeDefined();
    expect(created.canUndo).toBe(true);

    created.undo();
    const undone = useEditorStore.getState();
    expect(undone.garment.pieces.some(isSleevePiece)).toBe(false);
    expect(undone.garment.seams?.some((seam) => seam.groupId?.startsWith("guided-sleeve:")) ?? false).toBe(false);
    expect(undone.garment.pieces).toHaveLength(initial.pieces.length);

    undone.redo();
    const redone = useEditorStore.getState();
    expect(redone.garment.pieces.filter(isSleevePiece)).toHaveLength(1);
    expect(redone.garment.seams?.some((seam) => seam.groupId === "guided-sleeve:front-armhole")).toBe(true);
  });

  it("does not replace an existing sleeve without explicit permission", () => {
    const initial = useEditorStore.getState().garment;
    const detection = detectSleeveBody(initial.pieces);
    const frontPieceId = detection.frontCandidates[0].pieceId;
    const backPieceId = detection.backCandidates[0].pieceId;
    const settings = createDefaultSleeveSettings(initial, frontPieceId, backPieceId, "short");
    expect(useEditorStore.getState().addGuidedSleeve({ frontPieceId, backPieceId, settings, replaceExisting: false }).accepted).toBe(true);
    const before = structuredClone(useEditorStore.getState().garment);

    const rejected = useEditorStore.getState().addGuidedSleeve({
      frontPieceId,
      backPieceId,
      settings: { ...settings, lengthMm: settings.lengthMm + 40 },
      replaceExisting: false,
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.message).toMatch(/substitui/i);
    expect(useEditorStore.getState().garment).toEqual(before);
  });

  it("explicit replacement preserves body geometry and updates only the sleeve set", () => {
    const initial = useEditorStore.getState().garment;
    const detection = detectSleeveBody(initial.pieces);
    const frontPieceId = detection.frontCandidates[0].pieceId;
    const backPieceId = detection.backCandidates[0].pieceId;
    const settings = createDefaultSleeveSettings(initial, frontPieceId, backPieceId, "short");
    useEditorStore.getState().addGuidedSleeve({ frontPieceId, backPieceId, settings, replaceExisting: false });
    const firstSleeve = useEditorStore.getState().garment.pieces.find(isSleevePiece)!;
    const bodyBefore = useEditorStore.getState().garment.pieces
      .filter((piece) => !isSleevePiece(piece))
      .map((piece) => [piece.id, geometrySignature(piece)]);

    const replaced = useEditorStore.getState().addGuidedSleeve({
      frontPieceId,
      backPieceId,
      settings: { ...settings, type: "long", lengthMm: settings.lengthMm + 280 },
      replaceExisting: true,
    });
    expect(replaced.accepted).toBe(true);
    const after = useEditorStore.getState().garment;
    const secondSleeve = after.pieces.find(isSleevePiece)!;
    expect(secondSleeve.id).toBe(firstSleeve.id);
    expect(Math.max(...secondSleeve.points.map((point) => point.yMm))).toBeGreaterThan(
      Math.max(...firstSleeve.points.map((point) => point.yMm)),
    );
    expect(after.pieces.filter((piece) => !isSleevePiece(piece)).map((piece) => [piece.id, geometrySignature(piece)])).toEqual(bodyBefore);
  });
});

function geometrySignature(piece: ReturnType<typeof useEditorStore.getState>["garment"]["pieces"][number]): string {
  return JSON.stringify({
    points: piece.points,
    edges: getPatternEdges(piece).map((edge) => [edge.id, edge.role]),
  });
}
