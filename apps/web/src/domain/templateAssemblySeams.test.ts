import { describe, expect, it } from "vitest";
import {
  edgeRangeLength,
  getPatternEdges,
  seamSideRanges,
  type GarmentDraft,
  type PatternPiece,
  type Seam,
} from "./pattern";
import {
  buildTemplateAssemblySeams,
  resolveTemplateAssemblyGarment,
} from "./templateAssemblySeams";
import {
  createGarmentFromTemplate,
  DEFAULT_BODY_MEASUREMENTS,
} from "../patterns/templateCatalog";


describe("template assembly seams", () => {
  it("creates five complete canonical seam groups for a basic top", () => {
    const garment = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const seams = buildTemplateAssemblySeams(garment);
    const groupIds = [...new Set(seams.map((seam) => seam.groupId))];
    expect([...groupIds].sort()).toEqual([
      "guided-sleeve:back-armhole",
      "guided-sleeve:body-shoulder",
      "guided-sleeve:body-side",
      "guided-sleeve:front-armhole",
      "guided-sleeve:underarm",
    ].sort());
    for (const groupId of groupIds) {
      const group = seams.filter((seam) => seam.groupId === groupId);
      expect(group.length).toBeGreaterThan(0);
      expect(group.every((seam) => seam.direction === "same" || seam.direction === "opposite")).toBe(true);
    }
  });

  it("uses endpoint directions that preserve garment landmarks", () => {
    const garment = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const seams = buildTemplateAssemblySeams(garment);
    const shoulder = seams.filter((seam) => seam.groupId === "guided-sleeve:body-shoulder");
    const side = seams.filter((seam) => seam.groupId === "guided-sleeve:body-side");
    expect(shoulder.every((seam) => seam.direction === "same")).toBe(true);
    expect(side.every((seam) => seam.direction === "same")).toBe(true);
  });

  it("covers complete armhole and sleeve-cap arcs without hiding extra length", () => {
    const garment = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const seams = buildTemplateAssemblySeams(garment);
    const front = garment.pieces.find((piece) => getPatternEdges(piece).some((edge) => edge.role === "frontArmhole"))!;
    const back = garment.pieces.find((piece) => getPatternEdges(piece).some((edge) => edge.role === "backArmhole"))!;
    const sleeve = garment.pieces.find((piece) => getPatternEdges(piece).some((edge) => edge.role === "sleeveCapFront"))!;

    const frontGroup = groupLengths(garment, seams, "guided-sleeve:front-armhole");
    const backGroup = groupLengths(garment, seams, "guided-sleeve:back-armhole");
    expect(frontGroup.first).toBeCloseTo(roleLength(front, "frontArmhole"), 3);
    expect(
      frontGroup.second,
      JSON.stringify(seams.filter((seam) => seam.groupId === "guided-sleeve:front-armhole").map((seam) => seam.second)),
    ).toBeCloseTo(roleLength(sleeve, "sleeveCapFront"), 3);
    expect(backGroup.first).toBeCloseTo(roleLength(back, "backArmhole"), 3);
    expect(backGroup.second).toBeCloseTo(roleLength(sleeve, "sleeveCapBack"), 3);
    expect(Math.abs(roleLength(sleeve, "sleeveCapFront") - roleLength(front, "frontArmhole"))).toBeLessThanOrEqual(16);
    expect(Math.abs(roleLength(sleeve, "sleeveCapBack") - roleLength(back, "backArmhole"))).toBeLessThanOrEqual(16);
  });

  it("creates complete outseam, inseam and paired-copy rise relations for trousers", () => {
    const garment = createGarmentFromTemplate(
      "straight-pants",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const seams = buildTemplateAssemblySeams(garment);
    const roles = seams.map((seam) => {
      const firstPiece = garment.pieces.find((piece) => piece.id === seam.first.pieceId)!;
      const secondPiece = garment.pieces.find((piece) => piece.id === seam.second.pieceId)!;
      const firstRole = getPatternEdges(firstPiece).find((edge) => edge.id === seam.first.edgeId)?.role;
      const secondRole = getPatternEdges(secondPiece).find((edge) => edge.id === seam.second.edgeId)?.role;
      return `${firstRole}/${secondRole}`;
    });
    expect(seams.length).toBeGreaterThanOrEqual(8);
    expect(roles.filter((role) => role === "outseam/outseam").length).toBeGreaterThanOrEqual(3);
    expect(roles.filter((role) => role === "inseam/inseam").length).toBeGreaterThanOrEqual(2);
    const frontRise = seams.find((seam) => seam.groupId === "template-seam:trouser-front-rise");
    const backRise = seams.find((seam) => seam.groupId === "template-seam:trouser-back-rise");
    expect(frontRise?.physicalPairing).toBe("paired-copies");
    expect(backRise?.physicalPairing).toBe("paired-copies");
    expect(frontRise?.firstRanges?.length).toBeGreaterThanOrEqual(2);
    expect(backRise?.firstRanges?.length).toBeGreaterThanOrEqual(2);
    expect(roles.some((role) => role === "frontCrotch/frontCrotch")).toBe(true);
    expect(roles.some((role) => role === "backCrotch/backCrotch")).toBe(true);
  });

  it("replaces incompatible template-edge seams and preserves unrelated custom seams", () => {
    const generated = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const canonical = buildTemplateAssemblySeams(generated);
    const shoulder = canonical.find((seam) => seam.groupId === "guided-sleeve:body-shoulder")!;
    const wrongShoulder = {
      ...shoulder,
      id: "manual-wrong",
      name: "Costura",
      direction: "opposite" as const,
    };
    const custom = {
      ...shoulder,
      id: "custom-neck-detail",
      groupId: "custom-neck-detail",
      name: "Detalhe custom",
      first: shoulder.first,
      second: shoulder.second,
    };
    const resolved = resolveTemplateAssemblyGarment({
      ...generated,
      seams: [wrongShoulder, custom],
    });
    expect(resolved.seams?.some((seam) => seam.id === "manual-wrong")).toBe(false);
    expect(resolved.seams?.some((seam) => seam.id === "custom-neck-detail")).toBe(true);
    expect(resolved.seams?.some((seam) => seam.groupId === "guided-sleeve:body-shoulder")).toBe(true);
  });
});

function roleLength(piece: PatternPiece, role: string): number {
  return getPatternEdges(piece)
    .filter((edge) => edge.role === role)
    .reduce((sum, edge) => sum + edgeRangeLength(piece, {
      pieceId: piece.id,
      edgeId: edge.id,
      startT: 0,
      endT: 1,
    }), 0);
}

function groupLengths(garment: GarmentDraft, seams: Seam[], groupId: string) {
  const grouped = seams.filter((seam) => seam.groupId === groupId);
  const first = grouped.reduce((sum, seam) => sum + seamSideRanges(seam, "first").reduce((rangeSum, range) => {
    const piece = garment.pieces.find((candidate) => candidate.id === range.pieceId)!;
    return rangeSum + edgeRangeLength(piece, range);
  }, 0), 0);
  const second = grouped.reduce((sum, seam) => sum + seamSideRanges(seam, "second").reduce((rangeSum, range) => {
    const piece = garment.pieces.find((candidate) => candidate.id === range.pieceId)!;
    return rangeSum + edgeRangeLength(piece, range);
  }, 0), 0);
  return { first, second };
}
