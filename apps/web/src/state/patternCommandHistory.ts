import type { PatternPiece } from "../domain/pattern";

export interface PatternCommand {
  label: string;
  before: PatternPiece;
  after: PatternPiece;
}

interface ActiveTransaction {
  label: string;
  before: PatternPiece;
}

export class PatternCommandHistory {
  private readonly past: PatternCommand[] = [];
  private readonly future: PatternCommand[] = [];
  private activeTransaction: ActiveTransaction | null = null;

  constructor(private readonly limit = 60) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("O limite do histórico precisa ser um inteiro positivo.");
    }
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get isTransactionActive(): boolean {
    return this.activeTransaction !== null;
  }

  begin(label: string, piece: PatternPiece): void {
    if (this.activeTransaction) return;
    this.activeTransaction = { label, before: clonePiece(piece) };
  }

  commit(piece: PatternPiece): boolean {
    const transaction = this.activeTransaction;
    this.activeTransaction = null;
    if (!transaction) return false;

    return this.push(transaction.label, transaction.before, piece);
  }

  cancel(): PatternPiece | null {
    const transaction = this.activeTransaction;
    this.activeTransaction = null;
    return transaction ? clonePiece(transaction.before) : null;
  }

  record(label: string, before: PatternPiece, after: PatternPiece): boolean {
    if (this.activeTransaction) return false;
    return this.push(label, before, after);
  }

  undo(): PatternPiece | null {
    const command = this.past.pop();
    if (!command) return null;

    this.future.push(command);
    return clonePiece(command.before);
  }

  redo(): PatternPiece | null {
    const command = this.future.pop();
    if (!command) return null;

    this.past.push(command);
    return clonePiece(command.after);
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.activeTransaction = null;
  }

  private push(
    label: string,
    before: PatternPiece,
    after: PatternPiece,
  ): boolean {
    if (piecesEqual(before, after)) return false;

    this.past.push({
      label,
      before: clonePiece(before),
      after: clonePiece(after),
    });
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    return true;
  }
}

function clonePiece(piece: PatternPiece): PatternPiece {
  return {
    ...piece,
    points: piece.points.map((point) => ({
      ...point,
      ...(point.handleIn ? { handleIn: { ...point.handleIn } } : {}),
      ...(point.handleOut ? { handleOut: { ...point.handleOut } } : {}),
    })),
  };
}

function piecesEqual(left: PatternPiece, right: PatternPiece): boolean {
  if (
    left.id !== right.id ||
    left.name !== right.name ||
    left.seamAllowanceMm !== right.seamAllowanceMm ||
    left.points.length !== right.points.length
  ) {
    return false;
  }

  return left.points.every((point, index) => {
    const other = right.points[index];
    return (
      point.id === other.id &&
      point.xMm === other.xMm &&
      point.yMm === other.yMm &&
      vectorsEqual(point.handleIn, other.handleIn) &&
      vectorsEqual(point.handleOut, other.handleOut)
    );
  });
}

function vectorsEqual(
  left: PatternPointHandle,
  right: PatternPointHandle,
): boolean {
  if (!left || !right) return left === right;
  return left.xMm === right.xMm && left.yMm === right.yMm;
}

type PatternPointHandle = PatternPiece["points"][number]["handleIn"];
