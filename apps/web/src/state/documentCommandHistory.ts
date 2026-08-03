import type { GarmentDraft } from "../domain/pattern";

export type DocumentCommandType =
  | "geometry"
  | "workspace"
  | "piece-create"
  | "piece-duplicate"
  | "piece-delete"
  | "piece-rename"
  | "measurement"
  | "seam-allowance"
  | "placement"
  | "seam"
  | "cut"
  | "dart"
  | "metadata";

export interface EditorDocumentState {
  garment: GarmentDraft;
  activePieceId: string;
}

export interface DocumentCommand {
  type: DocumentCommandType;
  label: string;
  before: EditorDocumentState;
  after: EditorDocumentState;
  undo(): EditorDocumentState;
  redo(): EditorDocumentState;
}

interface ActiveTransaction {
  type: DocumentCommandType;
  label: string;
  before: EditorDocumentState;
}

export class DocumentCommandHistory {
  private readonly past: DocumentCommand[] = [];
  private readonly future: DocumentCommand[] = [];
  private transaction: ActiveTransaction | null = null;

  constructor(private readonly limit = 80) {
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
    return this.transaction !== null;
  }

  begin(type: DocumentCommandType, label: string, state: EditorDocumentState): void {
    if (this.transaction) return;
    this.transaction = { type, label, before: cloneState(state) };
  }

  commit(state: EditorDocumentState): boolean {
    const transaction = this.transaction;
    this.transaction = null;
    if (!transaction) return false;
    return this.record(transaction.type, transaction.label, transaction.before, state);
  }

  cancel(): EditorDocumentState | null {
    const transaction = this.transaction;
    this.transaction = null;
    return transaction ? cloneState(transaction.before) : null;
  }

  record(
    type: DocumentCommandType,
    label: string,
    before: EditorDocumentState,
    after: EditorDocumentState,
  ): boolean {
    if (this.transaction || documentsEqual(before, after)) return false;
    const command = createCommand(type, label, before, after);
    this.past.push(command);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    return true;
  }

  undo(): EditorDocumentState | null {
    const command = this.past.pop();
    if (!command) return null;
    this.future.push(command);
    return command.undo();
  }

  redo(): EditorDocumentState | null {
    const command = this.future.pop();
    if (!command) return null;
    this.past.push(command);
    return command.redo();
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.transaction = null;
  }
}

function createCommand(
  type: DocumentCommandType,
  label: string,
  before: EditorDocumentState,
  after: EditorDocumentState,
): DocumentCommand {
  const storedBefore = cloneState(before);
  const storedAfter = cloneState(after);
  return {
    type,
    label,
    before: storedBefore,
    after: storedAfter,
    undo: () => cloneState(storedBefore),
    redo: () => cloneState(storedAfter),
  };
}

function cloneState(state: EditorDocumentState): EditorDocumentState {
  return structuredClone(state);
}

function documentsEqual(left: EditorDocumentState, right: EditorDocumentState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
