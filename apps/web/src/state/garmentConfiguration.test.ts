import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_MEASUREMENTS,
  createGarmentFromTemplate,
} from "../patterns/templateCatalog";
import { useEditorStore } from "./editorStore";

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
      {
        region: "sleeve",
        surface: "back",
        bodySide: "left",
      },
      {
        region: "sleeve",
        surface: "back",
        bodySide: "right",
        mirrorX: true,
      },
    ]);

    expect(
      useEditorStore.getState().snapshot.piece.previewPlacements,
    ).toEqual([
      {
        region: "sleeve",
        surface: "back",
        bodySide: "left",
      },
      {
        region: "sleeve",
        surface: "back",
        bodySide: "right",
        mirrorX: true,
      },
    ]);
  });
});
