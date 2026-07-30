import { describe, expect, it } from "vitest";
import type { PatternPiece } from "../domain/pattern";
import { PatternCommandHistory } from "./patternCommandHistory";

describe("PatternCommandHistory", () => {
  it("stores a complete drag as one undoable transaction", () => {
    const history = new PatternCommandHistory();
    const initial = pieceAt(0);

    history.begin("Mover ponto", initial);
    history.record("Mover ponto", initial, pieceAt(10));
    history.record("Mover ponto", pieceAt(10), pieceAt(20));
    expect(history.commit(pieceAt(30))).toBe(true);

    expect(history.undo()).toEqual(initial);
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toEqual(pieceAt(30));
  });

  it("clears redo after a new command", () => {
    const history = new PatternCommandHistory();
    history.record("Primeiro", pieceAt(0), pieceAt(10));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.record("Novo", pieceAt(0), pieceAt(20));
    expect(history.canRedo).toBe(false);
  });

  it("keeps memory bounded by the configured command limit", () => {
    const history = new PatternCommandHistory(2);
    history.record("1", pieceAt(0), pieceAt(1));
    history.record("2", pieceAt(1), pieceAt(2));
    history.record("3", pieceAt(2), pieceAt(3));

    expect(history.undo()).toEqual(pieceAt(2));
    expect(history.undo()).toEqual(pieceAt(1));
    expect(history.undo()).toBeNull();
  });

  it("restores the initial piece when a transaction is cancelled", () => {
    const history = new PatternCommandHistory();
    history.begin("Mover ponto", pieceAt(0));

    expect(history.cancel()).toEqual(pieceAt(0));
    expect(history.canUndo).toBe(false);
  });
});

function pieceAt(xMm: number): PatternPiece {
  return {
    id: "test",
    name: "Teste",
    seamAllowanceMm: 10,
    points: [
      { id: "a", xMm, yMm: 0 },
      { id: "b", xMm: 100, yMm: 0 },
      { id: "c", xMm: 0, yMm: 100 },
    ],
  };
}
