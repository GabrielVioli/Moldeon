import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { fabricPreset, type FabricSource } from "./fabric";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternDart,
  type PatternInternalLine,
} from "./pattern";
import {
  PatternDocumentCompatibilityError,
  garmentDraftToPatternDocumentV3,
  migratePatternProject,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  serializePatternDocumentV3,
  validatePatternDocumentV3,
} from "./patternDocumentV3";
import type { PatternDocumentV3 } from "./patternDocumentV3.types";

describe("PatternDocumentV3", () => {
  it("round trips a complete V3 document without losing technical data", () => {
    const garment = createRichRoundTripGarment();
    const document = garmentDraftToPatternDocumentV3(garment, {
      activePatternId: garment.pieces[0].id,
    });
    const serialized = serializePatternDocumentV3(document);
    const parsed = parsePatternDocumentV3(JSON.parse(serialized));
    const restored = patternDocumentV3ToGarmentDraft(parsed);

    expect(parsed).toEqual(document);
    expect(parsed.formatVersion).toBe(3);
    expect(parsed.units).toBe("mm");
    expect(parsed.patternDefinitions).toHaveLength(2);
    expect(parsed.panelInstances).toHaveLength(2);
    expect(parsed.fabrics).toHaveLength(2);
    expect(parsed.seamGroups[0]).toMatchObject({
      first: [{ startT: 0.15, endT: 0.85 }],
      second: [{ startT: 0.1, endT: 0.9 }],
      active: true,
      distribution: "uniform",
      targetRatio: 1,
      slackMm: 0,
    });

    const sourcePiece = garment.pieces[0];
    const restoredPiece = restored.pieces[0];
    expect(restoredPiece.nodes).toEqual(sourcePiece.nodes);
    expect(restoredPiece.segments).toEqual(sourcePiece.segments);
    expect(restoredPiece.contours).toEqual(sourcePiece.contours);
    expect(restoredPiece.points).toEqual(sourcePiece.points);
    expect(restoredPiece.internalLines).toEqual(sourcePiece.internalLines);
    expect(restoredPiece.darts).toEqual(sourcePiece.darts);
    expect(restoredPiece.grainline).toEqual(sourcePiece.grainline);
    expect(restored.fabrics).toEqual(garment.fabrics);
    expect(restored.measurements).toEqual(garment.measurements);
    expect(restored.workspaceStates).toEqual(garment.workspaceStates);
    expect(restored.workspaceTransforms).toEqual(
      garment.workspaceStates?.map((entry) => entry.transform),
    );
    expect(restored.seams?.[0]).toMatchObject({
      first: { startT: 0.15, endT: 0.85 },
      second: { startT: 0.1, endT: 0.9 },
    });
  });

  it("migrates the deterministic legacy fixture sequentially", () => {
    const legacy = createBaselineFixture("legacy-valid");
    expect(legacy.pieces[0].formatVersion).toBeUndefined();

    const migration = migratePatternProject(legacy);

    expect(migration.sourceVersion).toBe("legacy");
    expect(migration.document.formatVersion).toBe(3);
    expect(migration.document.patternDefinitions[0].geometry.geometryVersion).toBe(2);
    expect(migration.document.patternDefinitions[0].geometry.segments).toHaveLength(4);
    expect(migration.document.panelInstances).toEqual([
      expect.objectContaining({
        id: "legacy-piece:panel:1",
        sourcePatternId: "legacy-piece",
        copyIndex: 0,
      }),
    ]);
  });

  it("migrates an explicit V2 envelope and accepts a native V3 fixture", () => {
    const garment = createBaselineFixture("bezier-piece");
    const v2 = migratePatternProject({
      formatVersion: 2,
      garment,
      activePieceId: "bezier-piece",
    });
    const native = migratePatternProject(v2.document);

    expect(v2.sourceVersion).toBe(2);
    expect(v2.document.workspace.activePatternId).toBe("bezier-piece");
    expect(v2.document.patternDefinitions[0].geometry.segments[0].kind).toBe(
      "cubic",
    );
    expect(native.sourceVersion).toBe(3);
    expect(native.document).toEqual(v2.document);
  });

  it("expands two pants definitions into four deterministic panel instances", () => {
    const garment = createBaselineFixture("straight-pants-standard");
    const document = garmentDraftToPatternDocumentV3(garment);
    const pantsDefinitions = document.patternDefinitions.filter(
      (definition) =>
        definition.semanticRole === "leg-front" ||
        definition.semanticRole === "leg-back",
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
      expect(instances.map((instance) => instance.copyIndex)).toEqual([0, 1]);
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
    const garment = createBaselineFixture("sleeve-with-body");
    const document = garmentDraftToPatternDocumentV3(garment);
    const sleeve = document.patternDefinitions.find(
      (definition) => definition.semanticRole === "sleeve",
    );

    expect(sleeve).toBeDefined();
    if (!sleeve) return;
    const instances = document.panelInstances
      .filter((instance) => instance.sourcePatternId === sleeve.id)
      .sort((left, right) => left.copyIndex - right.copyIndex);
    expect(sleeve.cutQuantity).toBe(2);
    expect(instances).toHaveLength(2);
    expect(instances.map((instance) => instance.bodySide)).toEqual([
      "left",
      "right",
    ]);
    expect(instances.map((instance) => instance.sourcePatternId)).toEqual([
      sleeve.id,
      sleeve.id,
    ]);
    expect(instances.map((instance) => instance.mirrored)).toEqual([
      false,
      true,
    ]);
  });

  it("creates connectors from unambiguous segment roles without using names", () => {
    const garment = createBaselineFixture("sleeve-with-body");
    garment.name = "sem nomes reconhecíveis";
    garment.templateId = "custom";
    garment.pieces = garment.pieces.map((piece, index) => ({
      ...piece,
      name: `definição-${index + 1}`,
    }));

    const document = garmentDraftToPatternDocumentV3(garment);
    const connectorRoles = new Set(
      document.patternDefinitions.flatMap((definition) =>
        definition.connectors.map((connector) => connector.role),
      ),
    );

    expect(connectorRoles).toContain("front-armhole");
    expect(connectorRoles).toContain("back-armhole");
    expect(connectorRoles).toContain("sleeve-cap-front");
    expect(connectorRoles).toContain("sleeve-cap-back");
    expect(connectorRoles).toContain("side-seam");
  });

  it("rejects broken references, invalid ranges and degenerate self seams", () => {
    const garment = createBaselineFixture("equal-length-seam");
    const valid = garmentDraftToPatternDocumentV3(garment);

    const missingEdge = structuredClone(valid);
    missingEdge.seamGroups[0].first[0].edgeId = "missing-edge";
    expect(() => parsePatternDocumentV3(missingEdge)).toThrow(
      "borda inexistente",
    );

    const reversedRange = structuredClone(valid);
    reversedRange.seamGroups[0].first[0].startT = 0.8;
    reversedRange.seamGroups[0].first[0].endT = 0.2;
    expect(() => parsePatternDocumentV3(reversedRange)).toThrow(
      "intervalo inválido",
    );

    const degenerate = structuredClone(valid);
    degenerate.seamGroups[0].second = structuredClone(
      degenerate.seamGroups[0].first,
    );
    expect(
      validatePatternDocumentV3(degenerate).some(
        (issue) => issue.code === "degenerate-self-seam",
      ),
    ).toBe(true);
    expect(() => parsePatternDocumentV3(degenerate)).toThrow(
      "mesmos intervalos",
    );
  });

  it("refuses lossy projection of advanced SeamGroup data", () => {
    const garment = createBaselineFixture("equal-length-seam");
    const document = garmentDraftToPatternDocumentV3(garment);
    document.seamGroups[0].first.push({
      ...document.seamGroups[0].first[0],
      startT: 0,
      endT: 0.25,
    });

    expect(() => patternDocumentV3ToGarmentDraft(document)).toThrow(
      PatternDocumentCompatibilityError,
    );
    expect(() => patternDocumentV3ToGarmentDraft(document)).toThrow(
      "múltiplos intervalos",
    );
  });

  it("keeps the legacy PatternPiece boundary accepted by the TypeScript engine", () => {
    const garment = createBaselineFixture("bezier-piece");
    const document = garmentDraftToPatternDocumentV3(garment);
    const restored = patternDocumentV3ToGarmentDraft(document);
    const engine = new FallbackPatternEngine();

    const snapshot = engine.restorePiece(restored.pieces[0]);

    expect(snapshot.piece).toEqual(restored.pieces[0]);
    expect(snapshot.issues).toEqual([]);
  });
});

function createRichRoundTripGarment(): GarmentDraft {
  const base = createBaselineFixture("equal-length-seam");
  const first = migrateLegacyPieceToSegments(structuredClone(base.pieces[0]));
  const second = migrateLegacyPieceToSegments(structuredClone(base.pieces[1]));
  if (!first.segments || !first.nodes || !first.contours) {
    throw new Error("Fixture sem topologia V2.");
  }
  const firstSegment = first.segments[0];
  const startNode = first.nodes.find(
    (node) => node.id === firstSegment.startNodeId,
  );
  const endNode = first.nodes.find(
    (node) => node.id === firstSegment.endNodeId,
  );
  if (!startNode || !endNode) throw new Error("Nós da fixture ausentes.");
  firstSegment.kind = "cubic";
  firstSegment.control1 = {
    xMm: startNode.xMm + 45,
    yMm: startNode.yMm - 30,
  };
  firstSegment.control2 = {
    xMm: endNode.xMm - 45,
    yMm: endNode.yMm - 30,
  };
  first.points = first.points.map((point) => {
    if (point.id === startNode.id) {
      return { ...point, handleOut: { xMm: 45, yMm: -30 } };
    }
    if (point.id === endNode.id) {
      return { ...point, handleIn: { xMm: -45, yMm: -30 } };
    }
    return point;
  });

  const internalLine: PatternInternalLine = {
    id: `${first.id}:internal-reference`,
    pieceId: first.id,
    curved: true,
    purpose: "reference",
    points: [
      { id: `${first.id}:internal-a`, xMm: 45, yMm: 70 },
      {
        id: `${first.id}:internal-b`,
        xMm: 130,
        yMm: 150,
        handleIn: { xMm: -20, yMm: -10 },
      },
    ],
  };
  const dart: PatternDart = {
    id: `${first.id}:dart-round-trip`,
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
  );
  const secondEdge = getPatternEdges(second).find(
    (edge) => edge.role === "sideSeam",
  );
  if (!firstEdge || !secondEdge) throw new Error("Bordas semânticas ausentes.");

  return {
    ...base,
    id: "fixture-v3-round-trip",
    templateId: "custom",
    name: "Round trip V3",
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
      },
    ],
    workspaceStates: [
      {
        pieceId: first.id,
        transform: {
          pieceId: first.id,
          xMm: 125,
          yMm: -80,
          rotationDeg: 12,
        },
        visible: true,
        locked: false,
      },
      {
        pieceId: second.id,
        transform: {
          pieceId: second.id,
          xMm: 510,
          yMm: 40,
          rotationDeg: -8,
        },
        visible: false,
        locked: true,
      },
    ],
    workspaceTransforms: undefined,
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
