import { describe, expect, it } from "vitest";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";
import { createPreviewPlacement, type GarmentDraft } from "../domain/pattern";
import { createDefaultFabricSource } from "../domain/fabric";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import { parseAutosave, parseAutosaveOrThrow } from "./opfs";

describe("autosave serialization", () => {
  it("parses a valid legacy autosave", () => {
    const snapshot = new FallbackPatternEngine().snapshot();
    const serialized = JSON.stringify({
      version: 1,
      snapshot,
      savedAt: "2026-07-30T12:00:00.000Z",
    });

    expect(parseAutosave(serialized)).toEqual({
      kind: "snapshot",
      snapshot,
      sourceVersion: 1,
    });
  });

  it("migrates a V2 garment with multiple pieces through V3", () => {
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
            createPreviewPlacement(snapshot.piece.id, { region: "hip" }),
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

    const parsed = parseAutosaveOrThrow(serialized);
    expect(parsed).toMatchObject({
      kind: "garment",
      activePieceId: snapshot.piece.id,
      sourceVersion: 2,
      patternDocument: {
        formatVersion: 3,
        units: "mm",
        metadata: { projectId: "project" },
      },
    });
    if (parsed.kind !== "garment") return;
    expect(parsed.garment.id).toBe(garment.id);
    expect(parsed.garment.name).toBe(garment.name);
    expect(parsed.garment.measurements).toEqual(garment.measurements);
    expect(parsed.garment.pieces[0].points).toEqual(garment.pieces[0].points);
    expect(parsed.patternDocument.panelInstances).toHaveLength(1);
  });

  it("restores a native V3 autosave", () => {
    const snapshot = new FallbackPatternEngine().snapshot();
    const fabric = createDefaultFabricSource();
    const garment: GarmentDraft = {
      id: "project-v3",
      templateId: "custom",
      name: "Projeto V3",
      description: "Documento canônico",
      bodyType: "masculine",
      measurements: {
        heightMm: 1800,
        bustMm: 1000,
        waistMm: 860,
        hipMm: 1010,
        shoulderWidthMm: 450,
        torsoLengthMm: 500,
        armLengthMm: 640,
        inseamMm: 840,
      },
      fabrics: [fabric],
      pieces: [
        {
          ...snapshot.piece,
          fabricId: fabric.id,
          cutQuantity: 2,
        },
      ],
    };
    const document = garmentDraftToPatternDocumentV3(garment, {
      activePatternId: snapshot.piece.id,
    });
    const serialized = JSON.stringify({
      version: 3,
      document,
      activePatternId: snapshot.piece.id,
      savedAt: "2026-08-05T19:00:00.000Z",
    });

    const parsed = parseAutosaveOrThrow(serialized);
    expect(parsed).toMatchObject({
      kind: "garment",
      sourceVersion: 3,
      activePieceId: snapshot.piece.id,
      migrationWarnings: [],
    });
    if (parsed.kind !== "garment") return;
    expect(parsed.patternDocument).toEqual(document);
    expect(parsed.garment.pieces[0].cutQuantity).toBe(2);
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
    expect(parsed.sourceVersion).toBe(2);
    expect(parsed.patternDocument.formatVersion).toBe(3);
    expect(parsed.garment.bodyType).toBe("feminine");
    expect(parsed.garment.measurements.shoulderWidthMm).toBeGreaterThan(0);
    expect(parsed.garment.fabrics).toHaveLength(1);
    expect(parsed.garment.pieces[0].fabricId).toBe(
      parsed.garment.fabrics[0].id,
    );
  });

  it("rejects malformed or unsupported autosaves", () => {
    expect(parseAutosave("not-json")).toBeNull();
    expect(parseAutosave(JSON.stringify({ version: 3 }))).toBeNull();
    expect(() => parseAutosaveOrThrow("not-json")).toThrow(
      "O autosave não contém JSON válido",
    );
  });
});
