import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import type { GarmentDraft } from "../domain/pattern";
import { createDefaultFabricSource } from "../domain/fabric";
import { parseAutosave } from "./opfs";

describe("autosave serialization", () => {
  it("parses a valid legacy autosave", () => {
    const snapshot = new FallbackPatternEngine().snapshot();
    const serialized = JSON.stringify({
      version: 1,
      snapshot,
      savedAt: "2026-07-30T12:00:00.000Z",
    });

    expect(parseAutosave(serialized)).toEqual({ kind: "snapshot", snapshot });
  });

  it("parses a garment with multiple pieces", () => {
    const snapshot = new FallbackPatternEngine().snapshot();
    const fabric = createDefaultFabricSource();
    const garment: GarmentDraft = {
      id: "project",
      templateId: "straight-skirt",
      name: "Saia",
      description: "Teste",
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
      pieces: [
        {
          ...snapshot.piece,
          cutQuantity: 1,
          fabricId: fabric.id,
          previewPlacements: [
            { region: "lower", surface: "front", bodySide: "center" },
          ],
        },
      ],
    };
    const serialized = JSON.stringify({
      version: 2,
      garment,
      activePieceId: snapshot.piece.id,
      savedAt: "2026-07-30T12:00:00.000Z",
    });

    expect(parseAutosave(serialized)).toEqual({
      kind: "garment",
      garment,
      activePieceId: snapshot.piece.id,
    });
  });

  it("migrates projects saved before body and fabric configuration", () => {
    const snapshot = new FallbackPatternEngine().snapshot();
    const serialized = JSON.stringify({
      version: 2,
      garment: {
        id: "old-project",
        templateId: "legacy-skirt",
        name: "Saia antiga",
        description: "Sem os campos novos",
        measurements: {
          heightMm: 1680,
          bustMm: 920,
          waistMm: 760,
          hipMm: 1000,
        },
        pieces: [snapshot.piece],
      },
      activePieceId: snapshot.piece.id,
      savedAt: "2026-07-30T12:00:00.000Z",
    });

    const parsed = parseAutosave(serialized);
    expect(parsed?.kind).toBe("garment");
    if (!parsed || parsed.kind !== "garment") return;
    expect(parsed.garment.bodyType).toBe("feminine");
    expect(parsed.garment.measurements.shoulderWidthMm).toBeGreaterThan(0);
    expect(parsed.garment.fabrics).toHaveLength(1);
    expect(parsed.garment.pieces[0].fabricId).toBe(
      parsed.garment.fabrics[0].id,
    );
  });

  it("ignores malformed or unsupported autosaves", () => {
    expect(parseAutosave("not-json")).toBeNull();
    expect(parseAutosave(JSON.stringify({ version: 3 }))).toBeNull();
  });
});
