import { describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternPiece,
  type PatternSnapshot,
  type PreviewSurface,
  type Seam,
} from "../domain/pattern";
import { solveGarmentAssembly } from "./GarmentSolver";
import { buildPhysicalGarmentAssembly } from "./PhysicalGarmentAssembly";

function halfPanel(
  id: string,
  surface: PreviewSurface,
): PatternPiece {
  const piece = migrateLegacyPieceToSegments({
    id,
    name: surface === "front" ? "Frente" : "Costas",
    seamAllowanceMm: 10,
    cutQuantity: 1,
    cutOnFold: true,
    previewPlacements: [
      {
        id: `${id}:placement`,
        pieceId: id,
        region: "torso",
        surface,
        bodySide: "center",
        rotationDeg: 0,
        offsetXMm: 0,
        offsetYMm: 0,
        offsetZMm: 0,
        scale: 1,
      },
    ],
    points: [
      { id: `${id}:fold-top`, xMm: 0, yMm: 0 },
      { id: `${id}:side-top`, xMm: 100, yMm: 0 },
      { id: `${id}:side-bottom`, xMm: 100, yMm: 200 },
      { id: `${id}:fold-bottom`, xMm: 0, yMm: 200 },
    ],
  });

  const roles = ["waist", "sideSeam", "hem", "fold"] as const;
  piece.segments = piece.segments?.map((segment, index) => ({
    ...segment,
    role: roles[index],
  }));

  return piece;
}

function snapshot(piece: PatternPiece): PatternSnapshot {
  return {
    piece,
    areaMm2: 20_000,
    perimeterMm: 600,
    issues: [],
  };
}

function garment(pieces: PatternPiece[], seams: Seam[] = []): GarmentDraft {
  const fabric = createDefaultFabricSource();

  return {
    id: "physical-test",
    templateId: "physical-test",
    name: "Teste físico",
    description: "Teste da expansão de peças cortadas na dobra.",
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
    pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })),
    seams,
    assemblyPlacements: pieces.map((piece) => ({
      pieceId: piece.id,
      role: piece.name === "Costas" ? "back" : "front",
      outwardSide: piece.name === "Costas" ? "back" : "front",
      positionMm: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      flipped: false,
      source: "template",
    })),
  };
}

function averageInstanceZ(
  positions: Float32Array,
  particleStart: number,
  vertexCount: number,
): number {
  let total = 0;

  for (let index = 0; index < vertexCount; index += 1) {
    total += positions[(particleStart + index) * 3 + 2];
  }

  return total / vertexCount;
}

describe("PhysicalGarmentAssembly", () => {
  it("expande uma meia peça cortada na dobra e une as duas metades", () => {
    const front = halfPanel("front", "front");
    const draft = garment([front]);
    const state = buildPhysicalGarmentAssembly([snapshot(front)], draft);

    expect(state.instances).toHaveLength(2);
    expect(
      state.stitchConstraints.some((constraint) =>
        constraint.seamId.startsWith("fold:"),
      ),
    ).toBe(true);

    const xs: number[] = [];
    for (let index = 0; index < state.initialPositions.length / 3; index += 1) {
      xs.push(state.initialPositions[index * 3]);
    }

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.19);
    expect(Array.from(state.initialPositions).every(Number.isFinite)).toBe(true);
  });

  it("duplica uma costura lateral por lado e mantém a expansão física neutra antes dos anchors", () => {
    const front = halfPanel("front", "front");
    const back = halfPanel("back", "back");
    const frontSide = getPatternEdges(front).find((edge) => edge.role === "sideSeam")!;
    const backSide = getPatternEdges(back).find((edge) => edge.role === "sideSeam")!;
    const sideSeam: Seam = {
      id: "side",
      name: "Laterais",
      first: {
        pieceId: front.id,
        edgeId: frontSide.id,
        startT: 0,
        endT: 1,
      },
      second: {
        pieceId: back.id,
        edgeId: backSide.id,
        startT: 0,
        endT: 1,
      },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
    };
    const draft = garment([front, back], [sideSeam]);
    const state = buildPhysicalGarmentAssembly(
      [snapshot(front), snapshot(back)],
      draft,
    );

    expect(state.instances).toHaveLength(4);

    const sidePairs = new Set(
      state.stitchConstraints
        .filter((constraint) => constraint.seamId === "side")
        .map((constraint) => `${constraint.instanceA}/${constraint.instanceB}`),
    );
    expect(sidePairs.size).toBe(2);

    const frontInstance = state.instances.find((instance) => instance.pieceId === front.id)!;
    const backInstance = state.instances.find((instance) => instance.pieceId === back.id)!;
    expect(
      averageInstanceZ(
        state.initialPositions,
        frontInstance.particleStart,
        frontInstance.vertexCount,
      ),
    ).toBeCloseTo(0, 7);
    expect(
      averageInstanceZ(
        state.initialPositions,
        backInstance.particleStart,
        backInstance.vertexCount,
      ),
    ).toBeCloseTo(0, 7);

    const report = solveGarmentAssembly(state, { iterations: 80 });
    expect(report.invalid).toBe(false);
    expect(Array.from(state.positions).every(Number.isFinite)).toBe(true);
  });
});
