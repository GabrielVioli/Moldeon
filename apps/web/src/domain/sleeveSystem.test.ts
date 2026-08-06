import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import { garmentDraftToPatternDocumentV3, validatePatternDocumentV3 } from "./patternDocumentV3";
import { getPatternEdges, type EdgeRange, type GarmentDraft, type PatternPiece } from "./pattern";
import {
  analyzeSleeveCompatibility,
  createDefaultSleeveSettings,
  detectSleeveBody,
  draftGuidedSleeve,
  isSleevePiece,
  stableSleevePieceId,
} from "./sleeveSystem";
import { createParametricBodyFixture } from "../testFixtures/parametricBodyFixtures";
import { createGarmentFromTemplate } from "../patterns/templateCatalog";

describe("guided sleeve system", () => {
  it.each(["short", "long"] as const)("drafts a %s sleeve from the actual front and back armhole arcs", (type) => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const settings = createDefaultSleeveSettings(garment, front.id, back.id, type);
    const draft = draftGuidedSleeve(garment, front.id, back.id, settings);

    expect(draft.sleevePiece.cutQuantity).toBe(2);
    expect(draft.sleevePiece.previewPlacements?.map((placement) => [placement.bodySide, Boolean(placement.mirrorX)])).toEqual([
      ["left", false],
      ["right", true],
    ]);
    expect(draft.compatibility.status, draft.compatibility.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).not.toBe("error");
    expect(draft.compatibility.frontCapMm).toBeCloseTo(
      draft.compatibility.frontArmholeMm + draft.compatibility.frontDifferenceMm,
      1,
    );
    expect(draft.compatibility.backCapMm).toBeCloseTo(
      draft.compatibility.backArmholeMm + draft.compatibility.backDifferenceMm,
      1,
    );
    expect(draft.compatibility.totalDifferenceMm).toBeCloseTo(settings.capEaseMm, 0);
    expect(draft.compatibility.frontCapMm).not.toBe(draft.compatibility.backCapMm);
    expect(new FallbackPatternEngine().restorePiece(draft.sleevePiece).issues).toEqual([]);
    expect(draft.sleevePiece.internalLines?.some((line) => "name" in line && line.name === "Linha do bíceps")).toBe(true);
    expect(draft.sleevePiece.internalLines?.some((line) => "name" in line && line.name === "Linha do cotovelo")).toBe(type === "long");
  });

  it("creates apex, shoulder, front notch and two distinct back notches", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const settings = createDefaultSleeveSettings(garment, front.id, back.id, "short");
    const draft = draftGuidedSleeve(garment, front.id, back.id, settings);
    const labels = draft.sleevePiece.annotations?.map((annotation) => annotation.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining([
      "Pique frontal",
      "Primeiro pique traseiro",
      "Segundo pique traseiro",
      "Ápice e marca de ombro",
      "Axila frontal",
      "Axila traseira",
    ]));
    expect(draft.compatibility.landmarkPairs.map((pair) => pair.id)).toEqual([
      "front-underarm",
      "front-notch",
      "shoulder-front",
      "shoulder-back",
      "back-notch-1",
      "back-notch-2",
      "back-underarm",
    ]);
    const backNotches = draft.compatibility.landmarkPairs.filter((pair) => pair.id.startsWith("back-notch"));
    expect(backNotches[0].bodyArcPosition).toBeLessThan(backNotches[1].bodyArcPosition);
    expect(backNotches[0].sleeveArcPosition).toBeLessThan(backNotches[1].sleeveArcPosition);
  });

  it("projects semantic connectors, landmarks and two stable panel instances", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const settings = createDefaultSleeveSettings(garment, front.id, back.id, "long");
    const draft = draftGuidedSleeve(garment, front.id, back.id, settings);
    const augmented: GarmentDraft = {
      ...garment,
      pieces: [...garment.pieces, draft.sleevePiece],
      seams: [...(garment.seams ?? []), ...draft.seams],
      assemblyPlacements: [
        ...(garment.assemblyPlacements ?? []),
        {
          pieceId: draft.sleevePiece.id,
          role: "sleeve",
          outwardSide: "front",
          positionMm: [0, 0, 0],
          rotationDeg: [0, 0, settings.rotationDeg],
          flipped: false,
          source: "manual",
        },
      ],
    };
    const document = garmentDraftToPatternDocumentV3(augmented);
    const definition = document.patternDefinitions.find((candidate) => candidate.id === draft.sleevePiece.id);
    expect(definition?.semanticRole).toBe("sleeve");
    const frontCap = definition?.connectors.find((connector) => connector.role === "sleeve-cap-front");
    const backCap = definition?.connectors.find((connector) => connector.role === "sleeve-cap-back");
    expect(frontCap?.landmarks.some((landmark) => landmark.kind === "notch")).toBe(true);
    expect(backCap?.landmarks.filter((landmark) => landmark.kind === "notch")).toHaveLength(2);
    expect(validatePatternDocumentV3(document)).toEqual([]);
    expect(document.panelInstances.filter((instance) => instance.sourcePatternId === draft.sleevePiece.id).map((instance) => [
      instance.id,
      instance.bodySide,
      instance.mirrored,
    ])).toEqual([
      [`${draft.sleevePiece.id}:panel:1`, "left", false],
      [`${draft.sleevePiece.id}:panel:2`, "right", true],
    ]);
  });

  it("creates front/back cap groups and a tubular underarm seam without generic auto-sewing", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const draft = draftGuidedSleeve(
      garment,
      front.id,
      back.id,
      createDefaultSleeveSettings(garment, front.id, back.id, "short"),
    );
    expect(draft.seams.length).toBeGreaterThanOrEqual(6);
    expect(new Set(draft.seams.map((seam) => seam.groupId))).toEqual(new Set([
      "guided-sleeve:front-armhole",
      "guided-sleeve:back-armhole",
      "guided-sleeve:underarm",
      "guided-sleeve:body-shoulder",
      "guided-sleeve:body-side",
    ]));
    const underarm = draft.seams.find((seam) => seam.groupId === "guided-sleeve:underarm");
    expect(underarm?.first.pieceId).toBe(draft.sleevePiece.id);
    expect(underarm?.second.pieceId).toBe(draft.sleevePiece.id);
    expect(underarm?.first.edgeId).not.toBe(underarm?.second.edgeId);
    expect(underarm?.direction).toBe("opposite");
  });


  it("covers every front and back armhole and cap interval exactly once", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const draft = draftGuidedSleeve(
      garment,
      front.id,
      back.id,
      createDefaultSleeveSettings(garment, front.id, back.id, "short"),
    );
    const groups = [
      {
        id: "guided-sleeve:front-armhole",
        body: front,
        bodyRole: "frontArmhole" as const,
        capRole: "sleeveCapFront" as const,
      },
      {
        id: "guided-sleeve:back-armhole",
        body: back,
        bodyRole: "backArmhole" as const,
        capRole: "sleeveCapBack" as const,
      },
    ];
    for (const group of groups) {
      const seams = draft.seams.filter((seam) => seam.groupId === group.id);
      expectConnectorCoverage(group.body, group.bodyRole, seams.map((seam) => seam.first));
      expectConnectorCoverage(draft.sleevePiece, group.capRole, seams.map((seam) => seam.second));
      expect(seams.every((seam) => seam.first.startT < seam.first.endT && seam.second.startT < seam.second.endT)).toBe(true);
    }
  });

  it("updates from changed shoulder and armhole geometry", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const settings = createDefaultSleeveSettings(garment, front.id, back.id, "short");
    const before = draftGuidedSleeve(garment, front.id, back.id, settings);
    const changedFront = {
      ...front,
      points: front.points.map((point, index) => index === 2
        ? { ...point, xMm: point.xMm + 16, yMm: point.yMm + 5 }
        : point),
    };
    const changedGarment = {
      ...garment,
      pieces: garment.pieces.map((piece) => piece.id === front.id ? changedFront : piece),
    };
    const after = draftGuidedSleeve(changedGarment, front.id, back.id, settings);
    expect(after.compatibility.frontArmholeMm).not.toBe(before.compatibility.frontArmholeMm);
    expect(after.sourceSignature).not.toBe(before.sourceSignature);
    expect(after.compatibility.backArmholeMm).toBe(before.compatibility.backArmholeMm);
  });

  it("updates bicep, length, cap height and rotation without changing the body", () => {
    const garment = bodice();
    const originalBody = structuredClone(garment.pieces);
    const [front, back] = bodyDefinitions(garment);
    const base = createDefaultSleeveSettings(garment, front.id, back.id, "long");
    const first = draftGuidedSleeve(garment, front.id, back.id, base);
    const second = draftGuidedSleeve(garment, front.id, back.id, {
      ...base,
      bicepCircumferenceMm: base.bicepCircumferenceMm + 70,
      lengthMm: base.lengthMm - 90,
      capHeightMm: base.capHeightMm - 12,
      rotationDeg: 9,
    });
    expect(bounds(second.sleevePiece).width).toBeGreaterThan(bounds(first.sleevePiece).width);
    expect(bounds(second.sleevePiece).height).toBeLessThan(bounds(first.sleevePiece).height);
    expect(second.sourceSignature).not.toBe(first.sourceSignature);
    expect(garment.pieces).toEqual(originalBody);
  });

  it("explains a cap that is excessively larger or smaller", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const base = createDefaultSleeveSettings(garment, front.id, back.id, "short");
    const excessive = analyzeSleeveCompatibility(garment, front.id, back.id, {
      ...base,
      capEaseMm: 60,
    });
    const deficient = analyzeSleeveCompatibility(garment, front.id, back.id, {
      ...base,
      capEaseMm: -30,
      capHeightMm: Math.max(60, base.capHeightMm - 30),
    });
    expect(excessive.status).toBe("error");
    expect(excessive.diagnostics.some((diagnostic) => diagnostic.code === "cap-excess-error")).toBe(true);
    expect(deficient.status).toBe("error");
    expect(deficient.diagnostics.some((diagnostic) => diagnostic.code === "cap-deficit")).toBe(true);
  });

  it("detects candidates by semantic connectors rather than template or piece names", () => {
    const garment = bodice();
    const renamed = garment.pieces.map((piece, index) => ({ ...piece, name: `Painel ${index + 1}` }));
    const detection = detectSleeveBody(renamed);
    expect(detection.frontCandidates).toHaveLength(1);
    expect(detection.backCandidates).toHaveLength(1);
    expect(detection.ambiguous).toBe(false);
    expect(stableSleevePieceId(
      detection.frontCandidates[0].pieceId,
      detection.backCandidates[0].pieceId,
    )).toMatch(/^guided-sleeve:/);
  });

  it("recognizes existing sleeve definitions without silently replacing them", () => {
    const fixture = createParametricBodyFixture("medium");
    const garment = createGarmentFromTemplate("tshirt", fixture.supplied, fixture.bodyType, fixture.profile);
    const detection = detectSleeveBody(garment.pieces);
    expect(detection.existingSleeveIds).toHaveLength(1);
    expect(garment.pieces.filter(isSleevePiece)).toHaveLength(1);
    expect(detection.diagnostics.some((diagnostic) => diagnostic.code === "existing-sleeve")).toBe(true);
  });

  it("matches a stable golden metric set", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const draft = draftGuidedSleeve(
      garment,
      front.id,
      back.id,
      createDefaultSleeveSettings(garment, front.id, back.id, "long"),
    );
    const snapshot = new FallbackPatternEngine().restorePiece(draft.sleevePiece);
    expect({
      version: "guided-sleeve@1",
      points: draft.sleevePiece.points.map((point) => [round(point.xMm), round(point.yMm)]),
      areaMm2: round(snapshot.areaMm2),
      perimeterMm: round(snapshot.perimeterMm),
      compatibility: draft.compatibility,
    }).toMatchSnapshot();
  });
});

function bodice(): GarmentDraft {
  const fixture = createParametricBodyFixture("medium");
  return createGarmentFromTemplate("bodice-block", fixture.supplied, fixture.bodyType, fixture.profile);
}

function bodyDefinitions(garment: GarmentDraft): [PatternPiece, PatternPiece] {
  const front = garment.pieces.find((piece) => getPatternEdges(piece).some((edge) => edge.role === "frontArmhole"));
  const back = garment.pieces.find((piece) => getPatternEdges(piece).some((edge) => edge.role === "backArmhole"));
  if (!front || !back) throw new Error("Corpo de teste sem frente/costas.");
  return [front, back];
}


function expectConnectorCoverage(
  piece: PatternPiece,
  role: "frontArmhole" | "backArmhole" | "sleeveCapFront" | "sleeveCapBack",
  ranges: readonly EdgeRange[],
): void {
  const edges = getPatternEdges(piece).filter((edge) => edge.role === role);
  expect(edges.length, `${piece.id}/${role}/edges`).toBeGreaterThan(0);
  for (const edge of edges) {
    const intervals = ranges
      .filter((range) => range.edgeId === edge.id)
      .sort((left, right) => left.startT - right.startT);
    expect(intervals.length, `${piece.id}/${edge.id}/intervals`).toBeGreaterThan(0);
    expect(intervals[0].startT, `${piece.id}/${edge.id}/start`).toBeCloseTo(0, 7);
    for (let index = 1; index < intervals.length; index += 1) {
      expect(intervals[index].startT, `${piece.id}/${edge.id}/gap-${index}`).toBeCloseTo(
        intervals[index - 1].endT,
        7,
      );
    }
    expect(intervals[intervals.length - 1].endT, `${piece.id}/${edge.id}/end`).toBeCloseTo(1, 7);
  }
}

function bounds(piece: PatternPiece) {
  const xs = piece.points.map((point) => point.xMm);
  const ys = piece.points.map((point) => point.yMm);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
