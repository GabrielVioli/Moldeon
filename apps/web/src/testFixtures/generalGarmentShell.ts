import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternPiece,
  type PatternPoint,
  type Seam,
  type SegmentRole,
} from "../domain/pattern";
import { createBaselineFixture } from "./baselineGarments";

export interface GeneralGarmentShellOptions {
  shoulders?: boolean;
  removeSide?: boolean;
  randomNames?: boolean;
  reorderPieces?: boolean;
  reverseSeams?: boolean;
}

export function createGeneralGarmentShellFixture(
  options: GeneralGarmentShellOptions = {},
): GarmentDraft {
  const base = createBaselineFixture("free-simple-piece");
  const source = ["A", "B", "C", "D"].map((id, index) => ({
    ...neutralPanel(id, index % 2 === 0 ? "frontArmhole" : "backArmhole"),
    fabricId: base.fabrics[0].id,
    name: options.randomNames ? `random-${37 - index * 7}` : id,
  }));
  const pieces = options.reorderPieces
    ? [source[2], source[0], source[3], source[1]]
    : source;
  const byId = new Map(source.map((piece) => [piece.id, piece]));
  const edge = (pieceId: string, edgeIndex: number) =>
    getPatternEdges(byId.get(pieceId)!)[edgeIndex];
  const relation = (
    id: string,
    firstId: string,
    firstEdge: number,
    secondId: string,
    secondEdge: number,
  ): Seam => ({
    id,
    groupId: id,
    name: options.randomNames ? `unnamed-${id.length}` : id,
    first: { pieceId: firstId, edgeId: edge(firstId, firstEdge).id, startT: 0, endT: 1 },
    second: { pieceId: secondId, edgeId: edge(secondId, secondEdge).id, startT: 0, endT: 1 },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  });
  let seams: Seam[] = [
    relation("g-side-ab", "A", 2, "B", 4),
    relation("g-shoulder-ab", "A", 0, "B", 0),
    relation("g-shoulder-bc", "B", 0, "C", 0),
    relation("g-side-cd", "C", 2, "D", 4),
    relation("g-shoulder-cd", "C", 0, "D", 0),
    relation("g-shoulder-da", "D", 0, "A", 0),
  ];
  if (options.shoulders === false) seams = seams.filter((seam) => !seam.id.includes("shoulder"));
  if (options.removeSide) seams = seams.filter((seam) => seam.id !== "g-side-cd");
  if (options.reverseSeams) seams.reverse();
  return {
    ...base,
    id: "fixture-general-garment-shell",
    templateId: "fixture-general-garment-shell",
    name: "Neutral four-panel garment shell",
    pieces,
    seams,
    assemblyPlacements: pieces.map((piece) => ({
      pieceId: piece.id,
      role: "front",
      outwardSide: "front",
      positionMm: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      flipped: false,
      source: "manual",
    })),
    dressing: { region: "upper", frontReferencePieceId: "A" },
  };
}

function neutralPanel(
  id: string,
  armholeRole: "frontArmhole" | "backArmhole",
): PatternPiece {
  const piece = migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 10,
    cutQuantity: 1,
    points: [
      point(`${id}:neck-shoulder`, 36, 0, undefined, { xMm: -12, yMm: 18 }),
      point(`${id}:shoulder-arm`, 96, 18, { xMm: 18, yMm: 4 }),
      point(`${id}:underarm`, 120, 82, undefined, { xMm: -12, yMm: -28 }),
      point(`${id}:outer-hem`, 120, 300),
      point(`${id}:inner-hem`, 0, 300),
      point(`${id}:neck-center`, 0, 62, { xMm: 14, yMm: -34 }),
    ],
    grainline: { start: { xMm: 60, yMm: 70 }, end: { xMm: 60, yMm: 270 } },
  });
  const roles: SegmentRole[] = [
    "shoulder",
    armholeRole,
    "sideSeam",
    "hem",
    "sideSeam",
    "neckline",
  ];
  return {
    ...piece,
    segments: piece.segments?.map((segment, index) => ({
      ...segment,
      role: roles[index] ?? "other",
    })),
  };
}

function point(
  id: string,
  xMm: number,
  yMm: number,
  handleOut?: { xMm: number; yMm: number },
  handleIn?: { xMm: number; yMm: number },
): PatternPoint {
  return { id, xMm, yMm, ...(handleOut ? { handleOut } : {}), ...(handleIn ? { handleIn } : {}) };
}
