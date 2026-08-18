import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { fabricPreset, type FabricSource } from "./fabric";
import {
  getPatternEdges,
  duplicatePatternPiece,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternDart,
  type PatternInternalLine,
} from "./pattern";
import {
  garmentDraftToPatternDocumentV3,
  migratePatternProject,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  serializePatternDocumentV3,
  validatePatternDocumentV3,
} from "./patternDocumentV3";

describe("PatternDocumentV3", () => {
  it.each(["Costas", "Calça", "qualquer nome"])("mantém a peça livre %s explicitamente não classificada", (name) => {
    const garment = createBaselineFixture("free-simple-piece");
    garment.templateId = "custom";
    garment.assemblyPlacements = [];
    garment.pieces = garment.pieces.slice(0, 1).map((piece) => ({
      ...piece,
      name,
      previewPlacements: undefined,
      bodyPlacement: undefined,
    }));

    const document = garmentDraftToPatternDocumentV3(garment);
    expect(document.patternDefinitions[0].bodyPlacement).toMatchObject({
      status: "unclassified",
      includeIn3D: true,
    });
    expect(document.panelInstances[0]).toMatchObject({
      sourcePatternId: garment.pieces[0].id,
      placementStatus: "unclassified",
      includedIn3D: true,
    });
    expect(document.panelInstances[0].arrangementAnchor).toBeUndefined();
    expect(document.panelInstances[0].bodySide).toBeUndefined();
    expect(document.panelInstances[0]).not.toHaveProperty("geometry");
  });

  it("preserva unclassified e confirmed no round-trip sem persistir sugestão", () => {
    const garment = createBaselineFixture("free-simple-piece");
    garment.templateId = "custom";
    garment.assemblyPlacements = [];
    garment.pieces = [
      garment.pieces[0],
      duplicatePatternPiece(garment.pieces[0], { newId: "confirmed-piece", name: "Confirmada" }),
    ].map((piece, index) => ({
      ...piece,
      previewPlacements: undefined,
      bodyPlacement: index === 0 ? undefined : {
        version: 1 as const,
        status: "confirmed" as const,
        includeIn3D: true,
        role: "custom" as const,
        region: "torso" as const,
        surface: "front" as const,
        bodySide: "center" as const,
        anchorId: "torso-front" as const,
        outwardFace: "normal" as const,
        offsetXMm: 0,
        offsetYMm: 0,
        offsetZMm: 25,
        rotationXDeg: 0,
        rotationYDeg: 0,
        rotationZDeg: 0,
        source: "manual" as const,
      },
    }));

    const document = parsePatternDocumentV3(JSON.parse(serializePatternDocumentV3(garmentDraftToPatternDocumentV3(garment))));
    const restored = patternDocumentV3ToGarmentDraft(document);
    expect(restored.pieces[0].bodyPlacement?.status).toBe("unclassified");
    expect(restored.pieces[1].bodyPlacement).toMatchObject({
      status: "confirmed",
      role: "custom",
      anchorId: "torso-front",
      source: "manual",
    });
    expect(JSON.stringify(document)).not.toContain("suggested");
  });

  it("round trips curves, partial seams, darts, lines, fabrics and workspace", () => {
    const garment = richGarment();
    garment.dressing = {
      region: "upper",
      frontReferencePieceId: garment.pieces[0].id,
    };
    const document = garmentDraftToPatternDocumentV3(garment, {
      activePatternId: garment.pieces[0].id,
    });
    const parsed = parsePatternDocumentV3(
      JSON.parse(serializePatternDocumentV3(document)),
    );
    const restored = patternDocumentV3ToGarmentDraft(parsed);

    expect(parsed).toEqual(document);
    expect(parsed).toMatchObject({ formatVersion: 3, units: "mm" });
    expect(parsed.fabrics).toHaveLength(2);
    expect(parsed.seamGroups[0]).toMatchObject({
      first: [{ startT: 0.15, endT: 0.85 }],
      second: [{ startT: 0.1, endT: 0.9 }],
      active: true,
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 4.5,
    });
    expect(restored.pieces[0].segments).toEqual(garment.pieces[0].segments);
    expect(restored.pieces[0].points).toEqual(garment.pieces[0].points);
    expect(restored.pieces[0].darts).toEqual(garment.pieces[0].darts);
    expect(restored.pieces[0].internalLines).toEqual(
      garment.pieces[0].internalLines,
    );
    expect(restored.workspaceStates).toEqual(garment.workspaceStates);
    expect(restored.dressing).toEqual(garment.dressing);
    expect(restored.seams?.[0]).toMatchObject({
      first: { startT: 0.15, endT: 0.85 },
      second: { startT: 0.1, endT: 0.9 },
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 4.5,
    });
  });

  it("migrates legacy, V2 and native V3 documents sequentially", () => {
    const legacy = migratePatternProject(
      createBaselineFixture("legacy-valid"),
    );
    const v2 = migratePatternProject({
      formatVersion: 2,
      garment: createBaselineFixture("bezier-piece"),
      activePieceId: "bezier-piece",
    });
    const v3 = migratePatternProject(v2.document);

    expect(legacy.sourceVersion).toBe("legacy");
    expect(legacy.document.patternDefinitions[0].geometry.segments).toHaveLength(4);
    expect(v2.sourceVersion).toBe(2);
    expect(v2.document.patternDefinitions[0].geometry.segments[0].kind).toBe(
      "cubic",
    );
    expect(v3.sourceVersion).toBe(3);
    expect(v3.document).toEqual(v2.document);
  });

  it("expands two pants definitions into four deterministic instances", () => {
    const document = garmentDraftToPatternDocumentV3(
      createBaselineFixture("straight-pants-standard"),
    );
    const pantsDefinitions = document.patternDefinitions.filter((definition) =>
      definition.connectors.some(
        (connector) =>
          connector.role === "front-rise" || connector.role === "back-rise",
      ),
    );

    expect(pantsDefinitions).toHaveLength(2);
    expect(document.panelInstances).toHaveLength(4);
    for (const definition of pantsDefinitions) {
      const instances = document.panelInstances
        .filter((instance) => instance.sourcePatternId === definition.id)
        .sort((left, right) => left.copyIndex - right.copyIndex);
      expect(definition.cutQuantity).toBe(2);
      expect(instances.map((instance) => instance.id)).toEqual([
        `${definition.id}:panel:1`,
        `${definition.id}:panel:2`,
      ]);
      expect(instances.map((instance) => instance.bodySide)).toEqual([
        "left",
        "right",
      ]);
      expect(instances.map((instance) => instance.mirrored)).toEqual([
        false,
        true,
      ]);
    }
  });

  it("expands one sleeve definition into left and right instances", () => {
    const document = garmentDraftToPatternDocumentV3(
      createBaselineFixture("sleeve-with-body"),
    );
    const sleeve = document.patternDefinitions.find((definition) =>
      definition.connectors.some(
        (connector) => connector.role === "sleeve-cap-front",
      ),
    );
    expect(sleeve).toBeDefined();
    if (!sleeve) return;
    const instances = document.panelInstances
      .filter((instance) => instance.sourcePatternId === sleeve.id)
      .sort((left, right) => left.copyIndex - right.copyIndex);

    expect(instances.map((instance) => instance.bodySide)).toEqual([
      "left",
      "right",
    ]);
    expect(instances.map((instance) => instance.mirrored)).toEqual([
      false,
      true,
    ]);
  });

  it("creates connectors from segment roles rather than template names", () => {
    const garment = createBaselineFixture("sleeve-with-body");
    garment.name = "projeto sem nome semântico";
    garment.templateId = "custom";
    garment.pieces = garment.pieces.map((piece, index) => ({
      ...piece,
      name: `definição-${index + 1}`,
    }));
    const document = garmentDraftToPatternDocumentV3(garment);
    const roles = new Set(
      document.patternDefinitions.flatMap((definition) =>
        definition.connectors.map((connector) => connector.role),
      ),
    );

    expect(roles).toEqual(
      expect.objectContaining({
        has: expect.any(Function),
      }),
    );
    expect(roles.has("front-armhole")).toBe(true);
    expect(roles.has("back-armhole")).toBe(true);
    expect(roles.has("sleeve-cap-front")).toBe(true);
    expect(roles.has("sleeve-cap-back")).toBe(true);
  });

  it("rejects broken references, reversed ranges and degenerate self seams", () => {
    const valid = garmentDraftToPatternDocumentV3(
      createBaselineFixture("equal-length-seam"),
    );
    const missingEdge = structuredClone(valid);
    missingEdge.seamGroups[0].first[0].edgeId = "missing-edge";
    expect(() => parsePatternDocumentV3(missingEdge)).toThrow(
      "borda inexistente",
    );

    const reversed = structuredClone(valid);
    reversed.seamGroups[0].first[0].startT = 0.8;
    reversed.seamGroups[0].first[0].endT = 0.2;
    expect(() => parsePatternDocumentV3(reversed)).toThrow(
      "intervalo inválido",
    );

    const self = structuredClone(valid);
    self.seamGroups[0].second = structuredClone(self.seamGroups[0].first);
    expect(
      validatePatternDocumentV3(self).some(
        (issue) => issue.code === "degenerate-self-seam",
      ),
    ).toBe(true);
    expect(() => parsePatternDocumentV3(self)).toThrow("mesmos intervalos");
  });

  it("projects advanced SeamGroup data without losing unequal side counts", () => {
    const document = garmentDraftToPatternDocumentV3(
      createBaselineFixture("equal-length-seam"),
    );
    document.seamGroups[0].first.push({
      ...document.seamGroups[0].first[0],
      startT: 0,
      endT: 0.25,
    });

    const restored = patternDocumentV3ToGarmentDraft(document);
    expect(restored.seams).toHaveLength(1);
    expect(restored.seams?.[0].firstRanges).toEqual(document.seamGroups[0].first);
    expect(restored.seams?.[0].secondRanges).toBeUndefined();
    expect(garmentDraftToPatternDocumentV3(restored).seamGroups[0]).toMatchObject({
      first: document.seamGroups[0].first,
      second: document.seamGroups[0].second,
    });
  });

  it("round trips inactive seams without discarding their state", () => {
    const garment = createBaselineFixture("equal-length-seam");
    garment.seams = garment.seams?.map((seam) => ({ ...seam, active: false }));
    const document = garmentDraftToPatternDocumentV3(garment);

    expect(document.seamGroups[0].active).toBe(false);
    const restored = patternDocumentV3ToGarmentDraft(document);
    expect(restored.seams?.[0].active).toBe(false);
  });

  it("keeps the projected PatternPiece accepted by the fallback engine", () => {
    const document = garmentDraftToPatternDocumentV3(
      createBaselineFixture("bezier-piece"),
    );
    const restored = patternDocumentV3ToGarmentDraft(document);
    const snapshot = new FallbackPatternEngine().restorePiece(
      restored.pieces[0],
    );

    expect(snapshot.piece).toEqual(restored.pieces[0]);
    expect(snapshot.issues).toEqual([]);
  });
});

function richGarment(): GarmentDraft {
  const base = createBaselineFixture("equal-length-seam");
  const first = migrateLegacyPieceToSegments(structuredClone(base.pieces[0]));
  const second = migrateLegacyPieceToSegments(structuredClone(base.pieces[1]));
  if (!first.nodes || !first.segments) throw new Error("Topologia V2 ausente.");
  const segment = first.segments[0];
  const start = first.nodes.find((node) => node.id === segment.startNodeId)!;
  const end = first.nodes.find((node) => node.id === segment.endNodeId)!;
  segment.kind = "cubic";
  segment.control1 = { xMm: start.xMm + 45, yMm: start.yMm - 30 };
  segment.control2 = { xMm: end.xMm - 45, yMm: end.yMm - 30 };
  first.points = first.points.map((point) =>
    point.id === start.id
      ? { ...point, handleOut: { xMm: 45, yMm: -30 } }
      : point.id === end.id
        ? { ...point, handleIn: { xMm: -45, yMm: -30 } }
        : point,
  );
  const internalLine: PatternInternalLine = {
    id: `${first.id}:reference`,
    pieceId: first.id,
    curved: true,
    purpose: "reference",
    points: [
      { id: `${first.id}:line-a`, xMm: 45, yMm: 70 },
      {
        id: `${first.id}:line-b`,
        xMm: 130,
        yMm: 150,
        handleIn: { xMm: -20, yMm: -10 },
      },
    ],
  };
  const dart: PatternDart = {
    id: `${first.id}:dart`,
    pieceId: first.id,
    apex: { xMm: 90, yMm: 120 },
    legA: { xMm: 72, yMm: 0 },
    legB: { xMm: 108, yMm: 0 },
    centerLine: {
      start: { xMm: 90, yMm: 0 },
      end: { xMm: 90, yMm: 120 },
    },
    widthMm: 36,
    lengthMm: 120,
    directionDeg: 90,
    closed: true,
  };
  first.internalLines = [internalLine];
  first.darts = [dart];

  const cotton = fabric("round-trip-cotton", "cotton");
  const denim = fabric("round-trip-denim", "denim");
  first.fabricId = cotton.id;
  second.fabricId = denim.id;
  const firstEdge = getPatternEdges(first).find(
    (edge) => edge.role === "sideSeam",
  )!;
  const secondEdge = getPatternEdges(second).find(
    (edge) => edge.role === "sideSeam",
  )!;

  return {
    ...base,
    id: "fixture-v3-round-trip",
    templateId: "custom",
    fabrics: [cotton, denim],
    pieces: [first, second],
    seams: [
      {
        id: "round-trip-partial-seam",
        name: "Costura parcial",
        first: {
          pieceId: first.id,
          edgeId: firstEdge.id,
          startT: 0.15,
          endT: 0.85,
        },
        second: {
          pieceId: second.id,
          edgeId: secondEdge.id,
          startT: 0.1,
          endT: 0.9,
        },
        direction: "opposite",
        easeRatio: 0,
        type: "standard",
        treatment: "standard",
        distribution: "center-biased",
        targetRatio: 1.08,
        slackMm: 4.5,
      },
    ],
    workspaceStates: [
      workspace(first.id, 125, -80, 12, true, false),
      workspace(second.id, 510, 40, -8, false, true),
    ],
    workspaceTransforms: undefined,
  };
}

function workspace(
  pieceId: string,
  xMm: number,
  yMm: number,
  rotationDeg: number,
  visible: boolean,
  locked: boolean,
) {
  return {
    pieceId,
    transform: { pieceId, xMm, yMm, rotationDeg },
    visible,
    locked,
  };
}

function fabric(
  id: string,
  presetId: "cotton" | "denim",
): FabricSource {
  const preset = fabricPreset(presetId);
  return {
    id,
    name: preset.name,
    presetId,
    color: preset.color,
    widthMm: 1400,
    lengthMm: 1800,
    quantity: 2,
    physics: { ...preset.physics },
  };
}
