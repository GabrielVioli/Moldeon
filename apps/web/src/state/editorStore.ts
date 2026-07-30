import { create } from "zustand";
import { currentEngine } from "../core/engineRuntime";
import { PatternSnapshot } from "../domain/pattern";
import { PatternCommandHistory } from "./patternCommandHistory";

interface EditorState {
  snapshot: PatternSnapshot;
  engineBackend: "wasm" | "typescript";
  selectedPointId: string | null;
  simulateVersion: number;
  canUndo: boolean;
  canRedo: boolean;
  setEngineSnapshot(snapshot: PatternSnapshot, backend: "wasm" | "typescript"): void;
  selectPoint(pointId: string | null): void;
  beginEdit(label: string): void;
  commitEdit(): void;
  cancelEdit(): void;
  movePoint(pointId: string, xMm: number, yMm: number): void;
  moveHandle(
    pointId: string,
    handle: "in" | "out",
    xMm: number,
    yMm: number,
  ): void;
  setSegmentCurve(pointId: string, enabled: boolean): void;
  setSeamAllowance(valueMm: number): void;
  resetPattern(): void;
  undo(): void;
  redo(): void;
  simulate(): void;
}

const initialSnapshot = currentEngine().snapshot();
const commandHistory = new PatternCommandHistory();

export const useEditorStore = create<EditorState>((set, get) => ({
  snapshot: initialSnapshot,
  engineBackend: "typescript",
  selectedPointId: null,
  simulateVersion: 0,
  canUndo: false,
  canRedo: false,

  setEngineSnapshot: (snapshot, backend) => {
    commandHistory.clear();
    set({
      snapshot,
      engineBackend: backend,
      selectedPointId: null,
      canUndo: false,
      canRedo: false,
    });
  },

  selectPoint: (selectedPointId) => set({ selectedPointId }),

  beginEdit: (label) => {
    commandHistory.begin(label, get().snapshot.piece);
  },

  commitEdit: () => {
    commandHistory.commit(get().snapshot.piece);
    set(historyAvailability());
  },

  cancelEdit: () => {
    const piece = commandHistory.cancel();
    if (!piece) return;
    const snapshot = currentEngine().restorePiece(piece);
    set({ snapshot, ...historyAvailability() });
  },

  movePoint: (pointId, xMm, yMm) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().movePoint(pointId, xMm, yMm);
    commandHistory.record("Mover ponto", before, snapshot.piece);
    set({ snapshot, ...historyAvailability() });
  },

  moveHandle: (pointId, handle, xMm, yMm) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().moveHandle(pointId, handle, xMm, yMm);
    commandHistory.record("Ajustar curva", before, snapshot.piece);
    set({ snapshot, ...historyAvailability() });
  },

  setSegmentCurve: (pointId, enabled) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().setSegmentCurve(pointId, enabled);
    commandHistory.record(
      enabled ? "Criar curva" : "Converter em linha",
      before,
      snapshot.piece,
    );
    set({ snapshot, ...historyAvailability() });
  },

  setSeamAllowance: (valueMm) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().setSeamAllowance(valueMm);
    commandHistory.record("Alterar margem", before, snapshot.piece);
    set({ snapshot, ...historyAvailability() });
  },

  resetPattern: () => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().reset();
    commandHistory.record("Restaurar molde", before, snapshot.piece);
    set({
      snapshot,
      selectedPointId: null,
      ...historyAvailability(),
    });
  },

  undo: () => {
    if (commandHistory.isTransactionActive) {
      commandHistory.commit(get().snapshot.piece);
    }
    const piece = commandHistory.undo();
    if (!piece) return;

    const snapshot = currentEngine().restorePiece(piece);
    set({
      snapshot,
      selectedPointId: keepSelectedPoint(get().selectedPointId, snapshot),
      ...historyAvailability(),
    });
  },

  redo: () => {
    if (commandHistory.isTransactionActive) {
      commandHistory.commit(get().snapshot.piece);
    }
    const piece = commandHistory.redo();
    if (!piece) return;

    const snapshot = currentEngine().restorePiece(piece);
    set({
      snapshot,
      selectedPointId: keepSelectedPoint(get().selectedPointId, snapshot),
      ...historyAvailability(),
    });
  },

  simulate: () => set((state) => ({ simulateVersion: state.simulateVersion + 1 })),
}));

function historyAvailability() {
  return {
    canUndo: commandHistory.canUndo,
    canRedo: commandHistory.canRedo,
  };
}

function keepSelectedPoint(
  selectedPointId: string | null,
  snapshot: PatternSnapshot,
): string | null {
  return snapshot.piece.points.some((point) => point.id === selectedPointId)
    ? selectedPointId
    : null;
}
