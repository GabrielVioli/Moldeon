import { describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import type { EditorDocumentState } from "./documentCommandHistory";
import { DocumentCommandHistory } from "./documentCommandHistory";

describe("DocumentCommandHistory", () => {
  it("stores an entire drag as one ordered command", () => {
    const history = new DocumentCommandHistory();
    const initial = documentAt(0);
    history.begin("workspace", "Mover peça", initial);
    history.commit(documentAt(80));

    expect(history.undo()?.garment.workspaceStates?.[0].transform.xMm).toBe(0);
    expect(history.redo()?.garment.workspaceStates?.[0].transform.xMm).toBe(80);
  });

  it("undoes and redoes document-level piece creation", () => {
    const history = new DocumentCommandHistory();
    const before = documentAt(0);
    const after = structuredClone(before);
    after.garment.pieces.push({
      id: "second",
      name: "Segunda",
      seamAllowanceMm: 10,
      points: triangle("second"),
    });
    history.record("piece-create", "Criar peça", before, after);

    expect(history.undo()?.garment.pieces).toHaveLength(1);
    expect(history.redo()?.garment.pieces).toHaveLength(2);
  });
});

function documentAt(xMm: number): EditorDocumentState {
  const piece = {
    id: "piece",
    name: "Peça",
    seamAllowanceMm: 10,
    points: triangle("piece"),
  };
  return {
    activePieceId: piece.id,
    garment: {
      id: "garment",
      templateId: "test",
      name: "Teste",
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
      fabrics: [createDefaultFabricSource()],
      pieces: [piece],
      workspaceStates: [
        {
          pieceId: piece.id,
          transform: { pieceId: piece.id, xMm, yMm: 0, rotationDeg: 0 },
          visible: true,
          locked: false,
        },
      ],
    },
  };
}

function triangle(prefix: string) {
  return [
    { id: `${prefix}:a`, xMm: 0, yMm: 0 },
    { id: `${prefix}:b`, xMm: 100, yMm: 0 },
    { id: `${prefix}:c`, xMm: 50, yMm: 100 },
  ];
}
