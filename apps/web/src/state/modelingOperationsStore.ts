import { create } from "zustand";
import {
  alignModelingPieces,
  createSimplePleat,
  distributeModelingPieces,
  duplicateModelingPieces,
  joinModelingPieces,
  type AlignmentMode,
  type DistributionAxis,
  type MirrorAxis,
  type ModelingOperationResult,
  type PleatSense,
} from "../domain/modelingOperations";
import { useEditorStore } from "./editorStore";

interface ModelingOperationsState {
  diagnostics: string[];
  duplicate(mirrorAxis?: MirrorAxis): boolean;
  align(mode: AlignmentMode): boolean;
  distribute(axis: DistributionAxis): boolean;
  join(): boolean;
  createPleat(options: { depthMm: number; directionDeg: number; sense: PleatSense }): boolean;
  clearDiagnostics(): void;
}

export const useModelingOperationsStore = create<ModelingOperationsState>((set) => ({
  diagnostics: [],

  duplicate(mirrorAxis) {
    const editor = useEditorStore.getState();
    const ids = editor.selectedPieceIds.length > 0
      ? editor.selectedPieceIds
      : editor.activePieceId ? [editor.activePieceId] : [];
    return commitResult(
      duplicateModelingPieces(editor.garment, ids, mirrorAxis),
      mirrorAxis ? "Espelhar peças" : "Duplicar peças",
      "piece-duplicate",
      set,
    );
  },

  align(mode) {
    const editor = useEditorStore.getState();
    return commitResult(
      alignModelingPieces(editor.garment, editor.selectedPieceIds, mode),
      "Alinhar peças",
      "workspace",
      set,
    );
  },

  distribute(axis) {
    const editor = useEditorStore.getState();
    return commitResult(
      distributeModelingPieces(editor.garment, editor.selectedPieceIds, axis),
      "Distribuir peças",
      "workspace",
      set,
    );
  },

  join() {
    const editor = useEditorStore.getState();
    return commitResult(
      joinModelingPieces(editor.garment, editor.selectedPieceIds),
      "Unir peças",
      "geometry",
      set,
    );
  },

  createPleat(options) {
    const editor = useEditorStore.getState();
    const pieceId = editor.selectedPieceIds.length === 1
      ? editor.selectedPieceIds[0]
      : editor.activePieceId;
    return commitResult(
      createSimplePleat(editor.garment, pieceId, options),
      "Criar prega simples",
      "geometry",
      set,
    );
  },

  clearDiagnostics() {
    set({ diagnostics: [] });
  },
}));

function commitResult(
  result: ModelingOperationResult,
  label: string,
  commandType: "piece-duplicate" | "workspace" | "geometry",
  setDiagnostics: (partial: Partial<ModelingOperationsState>) => void,
): boolean {
  setDiagnostics({ diagnostics: result.diagnostics });
  if (!result.ok) return false;
  const editor = useEditorStore.getState();
  editor.beginEdit(label, commandType);
  useEditorStore.setState({ garment: result.garment, activePieceId: result.activePieceId });
  if (result.selectedPieceIds.length > 0) {
    useEditorStore.getState().setPieceSelection(result.selectedPieceIds);
  }
  useEditorStore.getState().commitEdit();
  return true;
}
