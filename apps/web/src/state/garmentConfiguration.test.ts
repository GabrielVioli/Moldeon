import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_MEASUREMENTS,
  createGarmentFromTemplate,
} from "../patterns/templateCatalog";
import { useEditorStore } from "./editorStore";
import { createPreviewPlacement } from "../domain/pattern";

describe("garment 3D configuration", () => {
  beforeEach(() => {
    useEditorStore
      .getState()
      .loadGarment(
        createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS),
      );
  });

  it("stores body type and real measurements in the project", () => {
    useEditorStore.getState().setBodyType("masculine");
    useEditorStore.getState().setBodyMeasurement("shoulderWidthMm", 470);

    const garment = useEditorStore.getState().garment;
    expect(garment.bodyType).toBe("masculine");
    expect(garment.measurements.shoulderWidthMm).toBe(470);
  });

  it("adds and assigns another fabric to the active piece", () => {
    const fabricId = useEditorStore.getState().addFabric("denim");
    useEditorStore.getState().assignFabricToActivePiece(fabricId);

    const state = useEditorStore.getState();
    expect(state.garment.fabrics).toHaveLength(2);
    expect(state.snapshot.piece.fabricId).toBe(fabricId);
    expect(
      state.garment.pieces.find(
        (piece) => piece.id === state.activePieceId,
      )?.fabricId,
    ).toBe(fabricId);
  });

  it("reassigns pieces before removing a retalho", () => {
    const originalFabricId = useEditorStore.getState().garment.fabrics[0].id;
    const secondFabricId = useEditorStore.getState().addFabric("viscose");
    useEditorStore.getState().assignFabricToActivePiece(secondFabricId);
    useEditorStore.getState().removeFabric(secondFabricId);

    const state = useEditorStore.getState();
    expect(state.garment.fabrics).toHaveLength(1);
    expect(state.snapshot.piece.fabricId).toBe(originalFabricId);
  });

  it("changes the body region used by the active pattern piece", () => {
    useEditorStore.getState().setActivePiecePlacements([
      createPreviewPlacement(useEditorStore.getState().activePieceId, { region: "arm", surface: "back", bodySide: "left" }),
      createPreviewPlacement(useEditorStore.getState().activePieceId, { region: "arm", surface: "back", bodySide: "right", mirrorX: true }),
    ]);

    expect(
      useEditorStore.getState().snapshot.piece.previewPlacements,
    ).toMatchObject([{ region: "arm", surface: "back", bodySide: "left" }, { region: "arm", surface: "back", bodySide: "right", mirrorX: true }]);
  });

  it("rotates only the workspace transform and supports undo/redo", () => {
    const before = useEditorStore.getState();
    const originalPoints = structuredClone(before.snapshot.piece.points);
    const originalArea = before.snapshot.areaMm2;
    const originalPerimeter = before.snapshot.perimeterMm;
    const pieceId = before.activePieceId;

    useEditorStore.getState().rotatePieceInWorkspace(pieceId, 90);
    let rotated = useEditorStore.getState();
    expect(rotated.garment.workspaceStates?.find((state) => state.pieceId === pieceId)?.transform.rotationDeg).toBe(90);
    expect(rotated.snapshot.piece.points).toEqual(originalPoints);
    expect(rotated.snapshot.areaMm2).toBe(originalArea);
    expect(rotated.snapshot.perimeterMm).toBe(originalPerimeter);

    rotated.undo();
    expect(useEditorStore.getState().garment.workspaceStates?.find((state) => state.pieceId === pieceId)?.transform.rotationDeg).toBe(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.workspaceStates?.find((state) => state.pieceId === pieceId)?.transform.rotationDeg).toBe(90);
  });

  it("normalizes numeric rotations without touching preview placement", () => {
    const state = useEditorStore.getState();
    const pieceId = state.activePieceId;
    const workspace = state.garment.workspaceStates?.find((item) => item.pieceId === pieceId);
    const placements = structuredClone(state.snapshot.piece.previewPlacements);
    expect(workspace).toBeDefined();
    state.setPieceWorkspaceTransform(pieceId, { ...workspace!.transform, rotationDeg: 450 });
    expect(useEditorStore.getState().garment.workspaceStates?.find((item) => item.pieceId === pieceId)?.transform.rotationDeg).toBe(90);
    expect(useEditorStore.getState().snapshot.piece.previewPlacements).toEqual(placements);
  });

  it("moves several selected pieces in one workspace update", () => {
    const state = useEditorStore.getState();
    const transforms = state.garment.workspaceStates!.map((item, index) => ({
      ...item.transform,
      xMm: item.transform.xMm + 25 + index,
      yMm: item.transform.yMm + 40,
    }));

    state.setPieceWorkspaceTransforms(transforms);

    for (const transform of transforms) {
      expect(useEditorStore.getState().garment.workspaceStates?.find((item) => item.pieceId === transform.pieceId)?.transform).toMatchObject(transform);
    }
  });
});
