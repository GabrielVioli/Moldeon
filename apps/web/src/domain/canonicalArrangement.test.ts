import { describe, expect, it } from "vitest";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { deriveDressingPanelInstances } from "./assembly";
import { createUnclassifiedBodyPlacement, duplicatePatternPiece } from "./pattern";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  serializePatternDocumentV3,
} from "./patternDocumentV3";

describe("11.0.6 canonical PanelInstance arrangement", () => {
  it("uses explicit PanelInstance placement before the PatternDefinition default", () => {
    const garment = createBaselineFixture("exact-contact-tube");
    const piece = garment.pieces[0];
    piece.cutQuantity = 2;
    piece.cutOnFold = false;
    piece.bodyPlacement = {
      version: 1,
      status: "confirmed",
      includeIn3D: true,
      role: "sleeve",
      region: "arm",
      surface: "side",
      bodySide: "paired",
      anchorId: "arm-left",
      outwardFace: "normal",
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 12,
      rotationXDeg: 0,
      rotationYDeg: 0,
      rotationZDeg: 0,
      source: "manual",
    };
    piece.previewPlacements = [{
      id: `${piece.id}:panel:2`,
      pieceId: piece.id,
      region: "hip",
      surface: "back",
      bodySide: "right",
      bodyAnchorId: "hip-right",
      rotationDeg: 17,
      offsetXMm: 4,
      offsetYMm: 5,
      offsetZMm: 6,
      scale: 9,
      mirrorX: true,
    }];

    const document = garmentDraftToPatternDocumentV3(garment);
    expect(document.panelInstances[0]).toMatchObject({
      id: `${piece.id}:panel:1`,
      placementStatus: "confirmed",
      bodySide: "left",
      metadata: { effectivePlacementSource: "pattern-definition" },
      arrangementAnchor: { bodyAnchorId: "arm-left", scale: 1 },
    });
    expect(document.panelInstances[1]).toMatchObject({
      id: `${piece.id}:panel:2`,
      placementStatus: "confirmed",
      bodySide: "right",
      metadata: { effectivePlacementSource: "panel-instance" },
      arrangementAnchor: { bodyAnchorId: "hip-right", rotationDeg: 17, scale: 1 },
    });
  });

  it("round-trips explicit instance anchors without changing identity, side or scale", () => {
    const garment = createBaselineFixture("free-simple-piece");
    const piece = garment.pieces[0];
    piece.bodyPlacement = {
      ...createUnclassifiedBodyPlacement(),
      status: "confirmed",
      role: "front",
      region: "torso",
      surface: "front",
      bodySide: "center",
      anchorId: "torso-front",
    };
    piece.previewPlacements = [{
      id: `${piece.id}:panel:1`, pieceId: piece.id, region: "torso", surface: "front", bodySide: "center",
      bodyAnchorId: "torso-front", rotationDeg: 3, offsetXMm: 1, offsetYMm: 2, offsetZMm: 3, scale: 1,
    }];
    const original = garmentDraftToPatternDocumentV3(garment);
    const parsed = parsePatternDocumentV3(JSON.parse(serializePatternDocumentV3(original)));
    const restored = patternDocumentV3ToGarmentDraft(parsed);
    const regenerated = garmentDraftToPatternDocumentV3(restored);

    expect(regenerated.panelInstances).toEqual(original.panelInstances);
  });

  it("keeps a PatternDefinition default at definition precedence after round-trip", () => {
    const garment = createBaselineFixture("free-simple-piece");
    garment.pieces[0].bodyPlacement = {
      ...createUnclassifiedBodyPlacement(), status: "confirmed", role: "front", region: "torso", surface: "front",
      bodySide: "center", anchorId: "torso-front", source: "manual",
    };
    garment.pieces[0].previewPlacements = undefined;

    const original = garmentDraftToPatternDocumentV3(garment);
    const restored = patternDocumentV3ToGarmentDraft(parsePatternDocumentV3(JSON.parse(serializePatternDocumentV3(original))));
    const regenerated = garmentDraftToPatternDocumentV3(restored);

    expect(restored.pieces[0].previewPlacements).toBeUndefined();
    expect(regenerated.panelInstances[0].metadata.effectivePlacementSource).toBe("pattern-definition");
    expect(regenerated.panelInstances).toEqual(original.panelInstances);
  });

  it("does not infer a new manual document from names, template or Provar answers", () => {
    const garment = createBaselineFixture("exact-contact-tube");
    garment.templateId = "camiseta-que-nao-e-fato";
    garment.assemblyPlacements = [];
    garment.pieces = garment.pieces.map((piece) => ({
      ...piece,
      name: "Frente da manga direita",
      bodyPlacement: createUnclassifiedBodyPlacement(true, "manual"),
      previewPlacements: undefined,
    }));
    garment.dressing = { region: "upper", frontReferencePieceId: garment.pieces[0].id };
    const document = garmentDraftToPatternDocumentV3(garment);
    const instances = deriveDressingPanelInstances(document, garment);

    expect(instances[0].placementStatus).toBe("unclassified");
    expect(instances[0].arrangementAnchor).toBeUndefined();
    expect(instances[0].metadata.effectivePlacementSource).toBe("unassigned");
  });

  it("normalizes sufficient legacy placement and leaves insufficient legacy data unassigned", () => {
    const sufficient = createBaselineFixture("free-simple-piece");
    const source = sufficient.pieces[0];
    source.bodyPlacement = undefined;
    source.previewPlacements = [{
      id: "legacy-preview", pieceId: source.id, region: "hip", surface: "front", bodySide: "center",
      rotationDeg: 0, offsetXMm: 0, offsetYMm: 0, offsetZMm: 25, scale: 1,
    }];
    const normalized = garmentDraftToPatternDocumentV3(sufficient);
    expect(normalized.patternDefinitions[0].bodyPlacement).toMatchObject({ source: "migration", status: "confirmed", anchorId: "hip-front" });
    expect(normalized.panelInstances[0]).toMatchObject({
      placementStatus: "confirmed",
      metadata: { effectivePlacementSource: "pattern-definition" },
      arrangementAnchor: { bodyAnchorId: "hip-front", scale: 1 },
    });

    const insufficient = createBaselineFixture("free-simple-piece");
    insufficient.pieces[0].bodyPlacement = undefined;
    insufficient.pieces[0].previewPlacements = undefined;
    insufficient.assemblyPlacements = [];
    const unresolved = garmentDraftToPatternDocumentV3(insufficient);
    expect(unresolved.patternDefinitions[0].bodyPlacement).toMatchObject({ source: "migration", status: "unclassified" });
    expect(unresolved.panelInstances[0]).toMatchObject({
      placementStatus: "unclassified",
      metadata: { effectivePlacementSource: "unassigned" },
    });
    expect(unresolved.panelInstances[0].arrangementAnchor).toBeUndefined();
  });

  it("is invariant to definition, instance and template display names", () => {
    const garment = createBaselineFixture("free-simple-piece");
    const piece = garment.pieces[0];
    piece.bodyPlacement = {
      ...createUnclassifiedBodyPlacement(), status: "confirmed", role: "front", region: "torso", surface: "front",
      bodySide: "center", anchorId: "torso-front", source: "manual",
    };
    const first = garmentDraftToPatternDocumentV3(garment);
    const renamed = structuredClone(garment);
    renamed.templateId = "nome-totalmente-diferente";
    renamed.name = "Outro nome de roupa";
    renamed.pieces[0].name = "Não descreve o corpo";
    const second = garmentDraftToPatternDocumentV3(renamed);

    expect(second.panelInstances).toEqual(first.panelInstances);
  });

  it("duplicates and mirrors arrangement with new physical identity and correct side", () => {
    const garment = createBaselineFixture("free-simple-piece");
    const source = garment.pieces[0];
    source.cutQuantity = 2;
    source.bodyPlacement = {
      ...createUnclassifiedBodyPlacement(), status: "confirmed", role: "sleeve", region: "arm", surface: "side",
      bodySide: "left", anchorId: "arm-left", source: "manual",
    };
    source.previewPlacements = [{
      id: `${source.id}:panel:2`, pieceId: source.id, region: "arm", surface: "side", bodySide: "left",
      bodyAnchorId: "arm-left", rotationDeg: 0, offsetXMm: 0, offsetYMm: 0, offsetZMm: 12, scale: 1,
    }];

    const duplicate = duplicatePatternPiece(source, { newId: "copy", mirrored: false });
    const mirrored = duplicatePatternPiece(source, { newId: "mirror", mirrored: true });
    expect(duplicate.previewPlacements?.[0]).toMatchObject({ id: "copy:panel:2", pieceId: "copy", bodySide: "left", bodyAnchorId: "arm-left", scale: 1 });
    expect(mirrored.previewPlacements?.[0]).toMatchObject({ id: "mirror:panel:2", pieceId: "mirror", bodySide: "right", bodyAnchorId: "arm-right", scale: 1, mirrorX: true });
    expect(mirrored.bodyPlacement).toMatchObject({ status: "confirmed", bodySide: "right", anchorId: "arm-right", outwardFace: "flipped" });
  });
});
