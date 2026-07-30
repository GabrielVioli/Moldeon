import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import type { GarmentDraft } from "../domain/pattern";
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
    const garment: GarmentDraft = {
      id: "project",
      templateId: "straight-skirt",
      name: "Saia",
      description: "Teste",
      measurements: {
        heightMm: 1680,
        bustMm: 920,
        waistMm: 760,
        hipMm: 1000,
      },
      pieces: [
        {
          ...snapshot.piece,
          cutQuantity: 1,
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

  it("ignores malformed or unsupported autosaves", () => {
    expect(parseAutosave("not-json")).toBeNull();
    expect(parseAutosave(JSON.stringify({ version: 3 }))).toBeNull();
  });
});
