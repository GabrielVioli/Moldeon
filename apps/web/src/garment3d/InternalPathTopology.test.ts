import { describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import {
  applyInternalPathOperation,
  createInternalPath,
} from "../domain/internalPaths";
import {
  migrateLegacyPieceToSegments,
  type GarmentDraft,
} from "../domain/pattern";
import { buildPanelTopology } from "./PanelTopology";

function dartGarment(): GarmentDraft {
  const fabric = createDefaultFabricSource();
  const piece = migrateLegacyPieceToSegments({
    id: "dart-panel",
    name: "Painel com pence",
    seamAllowanceMm: 10,
    fabricId: fabric.id,
    cutQuantity: 1,
    points: [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 240, yMm: 0 },
      { id: "c", xMm: 240, yMm: 300 },
      { id: "d", xMm: 0, yMm: 300 },
    ],
  });
  const path = {
    ...createInternalPath(piece.id, "dart", [
      { xMm: 120, yMm: 0 },
      { xMm: 120, yMm: 100 },
    ]),
    metadata: { geometryVersion: 1, snapEnabled: true, dartWidthMm: 30 },
  };
  piece.internalLines = [path];
  return {
    id: "dart-topology",
    templateId: "custom",
    name: "Dart topology",
    description: "Fixture de compatibilidade entre pence e topologia.",
    bodyType: "feminine",
    measurements: {
      heightMm: 1700,
      bustMm: 900,
      waistMm: 720,
      hipMm: 980,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    },
    fabrics: [fabric],
    pieces: [piece],
  };
}

describe("InternalPath structural topology", () => {
  it("keeps a closed dart triangulable and preserves paired leg references", () => {
    const source = dartGarment();
    const pathId = source.pieces[0].internalLines?.[0].id;
    expect(pathId).toBeTruthy();
    const result = applyInternalPathOperation(source, source.pieces[0].id, pathId!);
    expect(result.ok).toBe(true);

    const piece = result.garment.pieces[0];
    const dart = piece.darts?.at(-1);
    expect(dart?.closed).toBe(true);
    expect(dart?.closure).toMatchObject({ kind: "paired-legs", state: "closed" });
    expect(dart?.legSegmentIds).toHaveLength(2);

    const internalSegments = new Set(
      piece.internalLines
        ?.flatMap((line) => "segments" in line ? line.segments.map((segment) => segment.id) : [])
        ?? [],
    );
    expect(dart?.legSegmentIds?.every((id) => internalSegments.has(id))).toBe(true);

    const topology = buildPanelTopology(piece);
    expect(topology.triangles.length).toBeGreaterThan(0);
    expect(topology.positions2D.length).toBeGreaterThanOrEqual(8);
    expect([...topology.positions2D].every(Number.isFinite)).toBe(true);
  });
});
