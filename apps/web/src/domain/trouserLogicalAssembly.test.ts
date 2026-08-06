import { describe, expect, it } from "vitest";
import { getPatternEdges, type PatternPiece } from "./pattern";
import {
  buildTrouserLogicalAssembly,
  instanceIdsForSourcePattern,
  locateTrouserSourcePattern,
  trouserSourceGeometrySignatures,
  type TrouserLogicalAssembly,
} from "./trouserLogicalAssembly";
import { createParametricBodyFixture } from "../testFixtures/parametricBodyFixtures";
import { createGarmentFromTemplate } from "../patterns/templateCatalog";

describe("trouser logical assembly", () => {
  it("expands two definitions into four stable left/right panel instances", () => {
    const garment = mediumTrouser();
    const assembly = buildTrouserLogicalAssembly(garment.pieces);
    expect(assembly.valid, assembly.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    expect(assembly.instances).toHaveLength(4);
    expect(assembly.instances.map((instance) => instance.id)).toEqual([
      "straight-pants-front:panel:1",
      "straight-pants-front:panel:2",
      "straight-pants-back:panel:1",
      "straight-pants-back:panel:2",
    ]);
    expect(assembly.instances.map((instance) => [
      instance.sourceDefinitionRole,
      instance.bodySide,
      instance.mirrored,
    ])).toEqual([
      ["front", "left", false],
      ["front", "right", true],
      ["back", "left", false],
      ["back", "right", true],
    ]);
  });

  it("forms two tubular legs, continuous front/back rises and open waist and hems", () => {
    const assembly = buildTrouserLogicalAssembly(mediumTrouser().pieces);
    expect(assembly.legs).toHaveLength(2);
    expect(assembly.legs.every((leg) => leg.tubular)).toBe(true);
    expect(assembly.legs.map((leg) => leg.side)).toEqual(["left", "right"]);
    expect(assembly.seams.map((seam) => seam.role).sort()).toEqual([
      "back-rise",
      "front-rise",
      "left-inseam",
      "left-outseam",
      "right-inseam",
      "right-outseam",
    ]);
    expect(assembly.crotch.continuous).toBe(true);
    expect(assembly.crotch.lowerJunctions).toHaveLength(2);
    expect(assembly.crotch.orderedInstancePath).toEqual([
      "straight-pants-back:panel:1",
      "straight-pants-back:panel:2",
      "straight-pants-front:panel:2",
      "straight-pants-front:panel:1",
    ]);
    expect(assembly.openConnectorIds).toHaveLength(8);
    expect(assembly.openConnectorIds.every((id) => id.endsWith(":waist") || id.endsWith(":hem"))).toBe(true);
  });

  it("never crosses left and right leg seams", () => {
    const assembly = buildTrouserLogicalAssembly(mediumTrouser().pieces);
    const byId = new Map(assembly.instances.map((instance) => [instance.id, instance]));
    for (const seam of assembly.seams.filter((candidate) => candidate.role.includes("inseam") || candidate.role.includes("outseam"))) {
      const first = byId.get(seam.first.instanceId)!;
      const second = byId.get(seam.second.instanceId)!;
      expect(first.bodySide, seam.id).toBe(second.bodySide);
      expect(first.sourceDefinitionRole, seam.id).not.toBe(second.sourceDefinitionRole);
    }
    expect(assembly.diagnostics.some((diagnostic) => diagnostic.code === "crossed-leg-seam")).toBe(false);
    expect(assembly.diagnostics.some((diagnostic) => diagnostic.code === "twisted-rise")).toBe(false);
  });

  it("locates the 2D source definition from a selected logical panel", () => {
    const assembly = buildTrouserLogicalAssembly(mediumTrouser().pieces);
    expect(locateTrouserSourcePattern(assembly, "straight-pants-front:panel:2")).toBe("straight-pants-front");
    expect(locateTrouserSourcePattern(assembly, "straight-pants-back:panel:1")).toBe("straight-pants-back");
    expect(instanceIdsForSourcePattern(assembly, "straight-pants-front")).toEqual([
      "straight-pants-front:panel:1",
      "straight-pants-front:panel:2",
    ]);
  });

  it("updates only front instances after changing the front definition", () => {
    const garment = mediumTrouser();
    const before = buildTrouserLogicalAssembly(garment.pieces);
    const editedPieces = garment.pieces.map((piece) => {
      if (!hasRole(piece, "frontCrotch")) return piece;
      return {
        ...piece,
        points: piece.points.map((point, index) => index === 4 ? { ...point, xMm: point.xMm + 7 } : point),
      };
    });
    const after = buildTrouserLogicalAssembly(editedPieces);
    assertOnlySourceChanged(before, after, "straight-pants-front");
  });

  it("updates only back instances after changing the back definition", () => {
    const garment = mediumTrouser();
    const before = buildTrouserLogicalAssembly(garment.pieces);
    const editedPieces = garment.pieces.map((piece) => {
      if (!hasRole(piece, "backCrotch")) return piece;
      return {
        ...piece,
        points: piece.points.map((point, index) => index === 8 ? { ...point, xMm: point.xMm - 9 } : point),
      };
    });
    const after = buildTrouserLogicalAssembly(editedPieces);
    assertOnlySourceChanged(before, after, "straight-pants-back");
  });

  it("diagnoses four panels on one side and incorrect mirroring with instance details", () => {
    const garment = mediumTrouser();
    const invalid = garment.pieces.map((piece) => ({
      ...piece,
      previewPlacements: (piece.previewPlacements ?? []).map((placement) => ({
        ...placement,
        bodySide: "left" as const,
        mirrorX: false,
      })),
    }));
    const assembly = buildTrouserLogicalAssembly(invalid);
    expect(assembly.valid).toBe(false);
    expect(assembly.diagnostics.some((diagnostic) => diagnostic.code === "four-panels-one-side")).toBe(true);
    const mirrorDiagnostic = assembly.diagnostics.find((diagnostic) => diagnostic.code === "incorrect-mirroring");
    expect(mirrorDiagnostic?.message).toMatch(/esquerda e direita/i);
    expect(mirrorDiagnostic?.instanceId).toBeDefined();
  });

  it("diagnoses a missing inseam connector by instance and connector", () => {
    const garment = mediumTrouser();
    const invalid = garment.pieces.map((piece) => {
      if (!hasRole(piece, "frontCrotch")) return piece;
      return {
        ...piece,
        segments: piece.segments?.map((segment) =>
          segment.role === "inseam" ? { ...segment, role: "other" as const } : segment,
        ),
      };
    });
    const assembly = buildTrouserLogicalAssembly(invalid);
    const diagnostic = assembly.diagnostics.find((candidate) => candidate.code === "missing-connector");
    expect(diagnostic?.instanceId).toMatch(/straight-pants-front:panel:/);
    expect(diagnostic?.connectorRole).toBe("inseam");
    expect(diagnostic?.message).toMatch(/inseam/);
  });
});

function mediumTrouser() {
  const fixture = createParametricBodyFixture("medium");
  return createGarmentFromTemplate(
    "straight-pants",
    fixture.supplied,
    fixture.bodyType,
    fixture.profile,
  );
}

function hasRole(piece: PatternPiece, role: "frontCrotch" | "backCrotch"): boolean {
  return getPatternEdges(piece).some((edge) => edge.role === role);
}

function assertOnlySourceChanged(
  before: TrouserLogicalAssembly,
  after: TrouserLogicalAssembly,
  changedSourcePatternId: string,
): void {
  const beforeSignatures = trouserSourceGeometrySignatures(before);
  const afterSignatures = trouserSourceGeometrySignatures(after);
  for (const instance of before.instances) {
    if (instance.sourcePatternId === changedSourcePatternId) {
      expect(afterSignatures[instance.id], instance.id).not.toBe(beforeSignatures[instance.id]);
    } else {
      expect(afterSignatures[instance.id], instance.id).toBe(beforeSignatures[instance.id]);
    }
  }
}
