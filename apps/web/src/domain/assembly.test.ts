import { describe, expect, it } from "vitest";
import {
  analyzeSeamCompatibility,
  buildAssemblyGraph,
  evaluateDressingPreflight,
  evaluateGarment3DEligibility,
  shouldLoadThreeViewport,
  suggestBodyPlacement,
} from "./assembly";
import { createDefaultFabricSource } from "./fabric";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  parseGarmentDraft,
  type GarmentDraft,
  type PatternPiece,
  type Seam,
  type SegmentRole,
} from "./pattern";

function rectangle(id: string, width: number, height = 100): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 10,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: width, yMm: 0 },
      { id: `${id}-c`, xMm: width, yMm: height },
      { id: `${id}-d`, xMm: 0, yMm: height },
    ],
  };
}

function rectangleWithRoles(
  id: string,
  width: number,
  roles: readonly SegmentRole[],
): PatternPiece {
  const piece = migrateLegacyPieceToSegments(rectangle(id, width));
  piece.segments = piece.segments?.map((segment, index) => ({
    ...segment,
    role: roles[index] ?? "other",
  }));
  return piece;
}

function garment(widthA = 100, widthB = 100): GarmentDraft {
  const pieces = [rectangle("front", widthA), rectangle("back", widthB)];
  const fabric = createDefaultFabricSource();
  return {
    id: "test",
    templateId: "test",
    name: "Teste",
    description: "Teste de montagem",
    bodyType: "feminine",
    measurements: {
      heightMm: 1680,
      bustMm: 920,
      waistMm: 760,
      hipMm: 1000,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    },
    fabrics: [fabric],
    pieces: pieces.map((piece, index) => ({
      ...piece,
      fabricId: fabric.id,
      bodyPlacement: {
        version: 1,
        status: "confirmed",
        includeIn3D: true,
        role: index ? "back" : "front",
        region: "torso",
        surface: index ? "back" : "front",
        bodySide: "center",
        anchorId: index ? "torso-back" : "torso-front",
        outwardFace: "normal",
        offsetXMm: 0,
        offsetYMm: 0,
        offsetZMm: 25,
        rotationXDeg: 0,
        rotationYDeg: 0,
        rotationZDeg: 0,
        source: "manual",
      },
    })),
    assemblyPlacements: pieces.map((piece, index) => ({
      pieceId: piece.id,
      role: index ? "back" : "front",
      outwardSide: index ? "back" : "front",
      positionMm: [0, 0, index ? -50 : 50],
      rotationDeg: [0, index ? 180 : 0, 0],
      flipped: false,
      source: "template",
    })),
  };
}

function seamFor(draft: GarmentDraft): Seam {
  const first = getPatternEdges(draft.pieces[0])[0];
  const second = getPatternEdges(draft.pieces[1])[0];
  return {
    id: "side",
    name: "Lateral",
    direction: "opposite",
    treatment: "standard",
    type: "standard",
    easeRatio: 0,
    first: {
      pieceId: first.pieceId,
      edgeId: first.id,
      startT: 0,
      endT: 1,
    },
    second: {
      pieceId: second.pieceId,
      edgeId: second.id,
      startT: 0,
      endT: 1,
    },
  };
}

describe("seam compatibility", () => {
  it("classifies exact, small and large differences", () => {
    const exact = garment(100, 100);
    const slight = garment(100, 106);
    const large = garment(100, 140);
    const ranges = (draft: GarmentDraft) => {
      const seam = seamFor(draft);
      return analyzeSeamCompatibility(draft, seam.first, seam.second);
    };
    expect(ranges(exact).recommendedTreatment).toBe("standard");
    expect(ranges(slight).recommendedTreatment).toBe("ease");
    expect(ranges(large).recommendedTreatment).toBe("intentional-mismatch");
  });

  it("accepts a declared treatment for an intentional length difference", () => {
    const draft = garment(100, 140);
    draft.seams = [
      {
        ...seamFor(draft),
        treatment: "intentional-mismatch",
        type: "intentional-mismatch",
      },
    ];
    expect(evaluateGarment3DEligibility(draft).canPreviewGarment).toBe(true);
  });

  it("rejects the exact same range within the same piece", () => {
    const draft = garment();
    const seam = seamFor(draft);
    expect(
      analyzeSeamCompatibility(draft, seam.first, {
        ...seam.first,
      }).compatible,
    ).toBe(false);
  });
});

describe("assembly graph and eligibility", () => {
  it("blocks dressing for unclassified named pieces without mutating a suggestion into the document", () => {
    const draft = garment();
    draft.pieces = draft.pieces.map((piece, index) => ({
      ...piece,
      name: index === 0 ? "Costas" : "Calça",
      bodyPlacement: undefined,
      previewPlacements: undefined,
    }));
    draft.assemblyPlacements = [];

    draft.seams = [seamFor(draft)];
    const before = structuredClone(draft);
    expect(evaluateGarment3DEligibility(draft)).toMatchObject({
      canOpenViewport: true,
      canPreviewGarment: true,
      canDressBody: false,
      missingClassificationPieceIds: [],
    });
    expect(evaluateDressingPreflight(draft)).toMatchObject({
      requiresRegion: true,
      requiresFrontReference: true,
    });
    expect(suggestBodyPlacement(draft.pieces[0])).toBeNull();
    expect(draft).toEqual(before);
  });

  it("round-trips assembly metadata through the document parser", () => {
    const draft = garment();
    draft.seams = [{ ...seamFor(draft), treatment: "ease", name: "Ombro" }];
    draft.ease = { bustMm: 90, waistMm: 70, hipMm: 85, sleeveMm: 45 };
    draft.dressing = { region: "upper", frontReferencePieceId: "front" };
    draft.pieces[0].edgeFinishes = {
      [getPatternEdges(draft.pieces[0])[1].id]: "hem",
    };
    const restored = parseGarmentDraft(JSON.parse(JSON.stringify(draft)));
    expect(restored.seams?.[0]).toMatchObject({
      name: "Ombro",
      treatment: "ease",
    });
    expect(restored.ease).toEqual(draft.ease);
    expect(restored.dressing).toEqual(draft.dressing);
    expect(restored.assemblyPlacements).toEqual(draft.assemblyPlacements);
    expect(restored.pieces[0].edgeFinishes).toEqual(
      draft.pieces[0].edgeFinishes,
    );
  });

  it("reports only required unsewn edges as open", () => {
    const draft = garment();
    const fabricId = draft.fabrics[0].id;
    draft.pieces = [
      rectangleWithRoles(
        "front",
        100,
        ["waist", "sideSeam", "hem", "fold"],
      ),
      rectangleWithRoles(
        "back",
        100,
        ["waist", "sideSeam", "hem", "fold"],
      ),
    ].map((piece) => ({
      ...piece,
      cutOnFold: true,
      fabricId,
    }));
    draft.seams = [
      {
        ...seamFor(draft),
        first: {
          ...seamFor(draft).first,
          edgeId: getPatternEdges(draft.pieces[0]).find(
            (edge) => edge.role === "sideSeam",
          )!.id,
        },
        second: {
          ...seamFor(draft).second,
          edgeId: getPatternEdges(draft.pieces[1]).find(
            (edge) => edge.role === "sideSeam",
          )!.id,
        },
      },
    ];

    const graph = buildAssemblyGraph(draft);
    expect(graph.connectedComponents[0]).toEqual(
      expect.arrayContaining(["front", "back"]),
    );
    expect(graph.validSeamIds).toEqual(["side"]);
    expect(graph.openEdges).toHaveLength(0);
    expect(graph.intentionalOpenEdges).toHaveLength(6);
  });

  it("authorizes dressing only after seams and the two minimal assembly answers", () => {
    const draft = garment();
    expect(evaluateGarment3DEligibility(draft)).toMatchObject({
      canPreviewGarment: true,
      canDressBody: false,
      connectedPieceIds: ["front", "back"],
    });
    draft.seams = [seamFor(draft)];
    draft.dressing = { region: "upper", frontReferencePieceId: "front" };
    expect(evaluateGarment3DEligibility(draft)).toMatchObject({
      canPreviewGarment: true,
      canDressBody: true,
      connectedPieceIds: ["front", "back"],
    });
  });

  it("keeps disconnected but valid pieces in the preview", () => {
    const draft = garment();
    const invalid = seamFor(draft);
    invalid.first.endT = 0;
    draft.seams = [invalid];
    expect(evaluateGarment3DEligibility(draft).canPreviewGarment).toBe(true);

    draft.seams = [seamFor(draft)];
    draft.pieces.push(rectangle("sleeve", 80));
    expect(evaluateGarment3DEligibility(draft).connectedPieceIds).toEqual([
      "front",
      "back",
      "sleeve",
    ]);
  });

  it("loads Three.js only after eligibility and an explicit request, independent of legacy fitting flags", () => {
    const draft = garment();
    draft.seams = [seamFor(draft)];
    const eligibility = evaluateGarment3DEligibility(draft);
    expect(shouldLoadThreeViewport(eligibility, false, "assembly")).toBe(false);
    expect(shouldLoadThreeViewport(eligibility, true, "assembly")).toBe(true);
    expect(
      shouldLoadThreeViewport(
        { ...eligibility, canDressBody: false },
        true,
        "fitting",
      ),
    ).toBe(true);
  });
});
