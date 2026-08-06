import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_MEASUREMENTS,
  createGarmentFromTemplate,
} from "../patterns/templateCatalog";
import { getPatternEdges } from "./pattern";
import {
  buildTemplateAssemblySeams,
  resolveTemplateAssemblyGarment,
  templateAssemblyNeedsRepair,
} from "./templateAssemblySeams";

function rolePair(
  garment: ReturnType<typeof createGarmentFromTemplate>,
  seamId: string,
): string {
  const seam = garment.seams?.find((candidate) => candidate.id === seamId);
  if (!seam) return "missing";
  const firstPiece = garment.pieces.find((piece) => piece.id === seam.first.pieceId)!;
  const secondPiece = garment.pieces.find((piece) => piece.id === seam.second.pieceId)!;
  const firstRole = getPatternEdges(firstPiece).find((edge) => edge.id === seam.first.edgeId)?.role;
  const secondRole = getPatternEdges(secondPiece).find((edge) => edge.id === seam.second.edgeId)?.role;
  return `${firstRole}/${secondRole}/${seam.direction}`;
}

describe("template assembly seams", () => {
  it("creates the five canonical seams of a basic top", () => {
    const garment = createGarmentFromTemplate(
      "tshirt",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const seams = buildTemplateAssemblySeams(garment);

    expect(seams).toHaveLength(5);
    expect(seams.map((seam) => seam.name)).toEqual(
      expect.arrayContaining([
        "Ombros",
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

    expect(rolePair(garment, "template-seam:shoulder")).toBe(
      "shoulder/shoulder/same",
    );
    expect(rolePair(garment, "template-seam:body-side")).toBe(
      "sideSeam/sideSeam/same",
    );
    expect(rolePair(garment, "template-seam:sleeve-underarm")).toBe(
      "sideSeam/sideSeam/opposite",
    );
    expect(rolePair(garment, "template-seam:front-armhole")).toBe(
      "frontArmhole/sleeveCapFront/opposite",
    );
    expect(rolePair(garment, "template-seam:back-armhole")).toBe(
      "backArmhole/sleeveCapBack/same",
    );
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
    const wrongShoulder = {
      ...canonical[0],
      id: "manual-wrong",
      name: "Costura",
      direction: "opposite" as const,
    };
    const custom = {
      ...canonical[0],
      id: "custom-neck-detail",
      name: "Detalhe livre",
      first: {
        ...canonical[0].first,
        edgeId: getPatternEdges(generated.pieces[0]).find(
          (edge) => edge.role === "neckline",
        )!.id,
      },
      second: {
        ...canonical[0].second,
        edgeId: getPatternEdges(generated.pieces[1]).find(
          (edge) => edge.role === "neckline",
        )!.id,
      },
    };
    generated.seams = [wrongShoulder, custom];

    expect(templateAssemblyNeedsRepair(generated)).toBe(true);
    const resolved = resolveTemplateAssemblyGarment(generated);

    expect(resolved.seams).toHaveLength(6);
    expect(resolved.seams?.find((seam) => seam.id === "manual-wrong")).toMatchObject({
      direction: "same",
      name: "Costura",
    });
    expect(resolved.seams?.some((seam) => seam.id === "custom-neck-detail")).toBe(true);
    expect(templateAssemblyNeedsRepair(resolved)).toBe(false);
  });
});
