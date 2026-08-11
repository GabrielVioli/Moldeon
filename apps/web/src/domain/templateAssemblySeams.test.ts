import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_MEASUREMENTS,
  createGarmentFromTemplate,
} from "../patterns/templateCatalog";
import { edgeRangeLength, getPatternEdges } from "./pattern";
import {
  buildTemplateAssemblySeams,
  resolveTemplateAssemblyGarment,
  templateAssemblyNeedsRepair,
} from "./templateAssemblySeams";

function rolePair(
  garment: ReturnType<typeof createGarmentFromTemplate>,
  seamId: string,
): string {
  const seam = garment.seams?.find((candidate) => candidate.id === seamId || candidate.groupId === seamId);
  if (!seam) return "missing";
  const firstPiece = garment.pieces.find((piece) => piece.id === seam.first.pieceId)!;
  const secondPiece = garment.pieces.find((piece) => piece.id === seam.second.pieceId)!;
  const firstRole = getPatternEdges(firstPiece).find((edge) => edge.id === seam.first.edgeId)?.role;
  const secondRole = getPatternEdges(secondPiece).find((edge) => edge.id === seam.second.edgeId)?.role;
  return `${firstRole}/${secondRole}/${seam.direction}`;
}

describe("template assembly seams", () => {
  it("creates five complete canonical seam groups for a basic top", () => {
    const garment = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const seams = buildTemplateAssemblySeams(garment);

    expect(new Set(seams.map((seam) => seam.groupId ?? seam.id)).size).toBe(5);
    expect(seams.map((seam) => (seam.name ?? "").replace(/ · trecho \d+$/, ""))).toEqual(
      expect.arrayContaining([
        "Ombros do corpo",
        "Laterais do corpo",
        "Costura inferior das mangas",
        "Cava frontal",
        "Cava traseira",
      ]),
    );
  });

  it("uses endpoint directions that preserve garment landmarks", () => {
    const generated = createGarmentFromTemplate(
      "blouse",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const garment = resolveTemplateAssemblyGarment(generated);

    expect(rolePair(garment, "guided-sleeve:body-shoulder")).toBe(
      "shoulder/shoulder/same",
    );
    expect(rolePair(garment, "guided-sleeve:body-side")).toBe(
      "sideSeam/sideSeam/same",
    );
    expect(rolePair(garment, "guided-sleeve:underarm")).toBe(
      "sideSeam/sideSeam/opposite",
    );
    expect(rolePair(garment, "guided-sleeve:front-armhole")).toBe(
      "frontArmhole/sleeveCapFront/opposite",
    );
    expect(rolePair(garment, "guided-sleeve:back-armhole")).toBe(
      "backArmhole/sleeveCapBack/same",
    );
  });

  it("covers complete armhole and sleeve-cap arcs without hiding extra length", () => {
    const garment = createGarmentFromTemplate("tshirt", DEFAULT_BODY_MEASUREMENTS);
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


  it("creates complete definition-level outseam and inseam ranges for trousers", () => {
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
    expect(seams.length).toBeGreaterThanOrEqual(6);
    expect(roles.filter((role) => role === "outseam/outseam").length).toBeGreaterThanOrEqual(3);
    expect(roles.filter((role) => role === "inseam/inseam").length).toBeGreaterThanOrEqual(2);
    expect(roles.some((role) => /Crotch/.test(role))).toBe(false);
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
      name: "Detalhe livre",
      first: {
        ...shoulder.first,
        edgeId: getPatternEdges(generated.pieces[0]).find(
          (edge) => edge.role === "neckline",
        )!.id,
      },
      second: {
        ...shoulder.second,
        edgeId: getPatternEdges(generated.pieces[1]).find(
          (edge) => edge.role === "neckline",
        )!.id,
      },
    };
    generated.seams = [wrongShoulder, custom];

    expect(templateAssemblyNeedsRepair(generated)).toBe(true);
    const resolved = resolveTemplateAssemblyGarment(generated);

    expect(resolved.seams).toHaveLength(canonical.length + 1);
    expect(resolved.seams?.find((seam) => seam.id === "manual-wrong")).toMatchObject({
      direction: "same",
      name: "Costura",
    });
    expect(resolved.seams?.some((seam) => seam.id === "custom-neck-detail")).toBe(true);
    expect(templateAssemblyNeedsRepair(resolved)).toBe(false);
  });
});

function groupLengths(
  garment: ReturnType<typeof createGarmentFromTemplate>,
  seams: ReturnType<typeof buildTemplateAssemblySeams>,
  groupId: string,
) {
  return (seams ?? []).filter((seam) => seam.groupId === groupId).reduce((totals, seam) => {
    const first = garment.pieces.find((piece) => piece.id === seam.first.pieceId)!;
    const second = garment.pieces.find((piece) => piece.id === seam.second.pieceId)!;
    totals.first += edgeRangeLength(first, seam.first);
    totals.second += edgeRangeLength(second, seam.second);
    return totals;
  }, { first: 0, second: 0 });
}

function roleLength(piece: ReturnType<typeof createGarmentFromTemplate>["pieces"][number], role: string): number {
  return getPatternEdges(piece)
    .filter((edge) => edge.role === role)
    .reduce((sum, edge) => sum + edgeRangeLength(piece, { pieceId: piece.id, edgeId: edge.id, startT: 0, endT: 1 }), 0);
}
