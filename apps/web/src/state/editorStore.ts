import { create } from "zustand";
import { currentEngine } from "../core/engineRuntime";
import { PatternSnapshot } from "../domain/pattern";

interface EditorState {
  snapshot: PatternSnapshot;
  engineBackend: "wasm" | "typescript";
  selectedPointId: string | null;
  simulateVersion: number;
  setEngineSnapshot(snapshot: PatternSnapshot, backend: "wasm" | "typescript"): void;
  selectPoint(pointId: string | null): void;
  movePoint(pointId: string, xMm: number, yMm: number): void;
  setSeamAllowance(valueMm: number): void;
  resetPattern(): void;
  simulate(): void;
}

const initialSnapshot = currentEngine().snapshot();

export const useEditorStore = create<EditorState>((set) => ({
  snapshot: initialSnapshot,
  engineBackend: "typescript",
  selectedPointId: null,
  simulateVersion: 0,

  setEngineSnapshot: (snapshot, backend) => set({ snapshot, engineBackend: backend }),

  selectPoint: (selectedPointId) => set({ selectedPointId }),

  movePoint: (pointId, xMm, yMm) => {
    const snapshot = currentEngine().movePoint(pointId, xMm, yMm);
    set({ snapshot });
  },

  setSeamAllowance: (valueMm) => {
    const snapshot = currentEngine().setSeamAllowance(valueMm);
    set({ snapshot });
  },

  resetPattern: () => {
    const snapshot = currentEngine().reset();
    set({ snapshot, selectedPointId: null });
  },

  simulate: () => set((state) => ({ simulateVersion: state.simulateVersion + 1 })),
}));
