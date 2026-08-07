import { create } from "zustand";
import { currentEngine } from "../core/engineRuntime";
import {
  appendInternalPathNode,
  createInternalPath,
  moveInternalPathHandle,
  moveInternalPathNode,
  normalizeInternalPath,
  removeLastInternalPathNode,
  setInternalPathPurpose,
  setInternalPathSegmentKind,
  type InternalPathAnalysis,
} from "../domain/internalPaths";
import {
  analyzeModelingInternalPath,
  appendAnchoredInternalPathPoint,
  applyModelingInternalPathOperation,
  finalizeBoundaryAnchors,
  moveAnchoredDraftCursor,
  moveAnchoredInternalPathNode,
  startAnchoredInternalPath,
} from "../domain/modelingCut";
import {
  isInternalPath,
  type GarmentDraft,
  type InternalPath,
  type InternalPathPurpose,
  type PatternPiece,
  type PatternVector,
} from "../domain/pattern";
import { useEditorStore } from "./editorStore";

interface InternalPathEditorState {
  draftPathId: string | null;
  selectedPathId: string | null;
  selectedNodeId: string | null;
  selectedSegmentId: string | null;
  analysis: InternalPathAnalysis | null;
  startPath(pieceId: string, purpose: InternalPathPurpose, point: PatternVector): void;
  appendDraftPoint(point: PatternVector): void;
  updateDraftCursor(point: PatternVector): void;
  removeLastDraftPoint(): void;
  confirmDraft(): boolean;
  cancelDraft(): void;
  selectPath(pathId: string | null, segmentId?: string | null): void;
  selectNode(nodeId: string | null): void;
  beginGeometryEdit(label?: string): void;
  moveSelectedNode(point: PatternVector): void;
  moveSelectedHandle(handle: "in" | "out", vector: PatternVector): void;
  commitGeometryEdit(): void;
  cancelGeometryEdit(): void;
  setPurpose(purpose: InternalPathPurpose): void;
  setSelectedSegmentKind(kind: "line" | "cubic"): void;
  toggleVisibility(): void;
  toggleLocked(): void;
  deleteSelectedPath(): void;
  applySelectedPath(keepJoined?: boolean): boolean;
  refreshAnalysis(): void;
  reset(): void;
}

export const useInternalPathEditorStore = create<InternalPathEditorState>((set, get) => ({
  draftPathId: null,
  selectedPathId: null,
  selectedNodeId: null,
  selectedSegmentId: null,
  analysis: null,

  startPath(pieceId, purpose, point) {
    const editor = useEditorStore.getState();
    const piece = editor.garment.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) return;
    if (get().draftPathId) get().cancelDraft();
    editor.beginEdit(purpose === "dart" ? "Desenhar pence" : "Desenhar caminho interno", "geometry");
    let path = createInternalPath(pieceId, purpose, [point, point]);
    path = startAnchoredInternalPath(path, piece);
    const first = path.nodes[0];
    const cursor = path.nodes.at(-1);
    if (first && cursor && first.id !== cursor.id) {
      path = moveInternalPathNode(path, cursor.id, first);
    }
    path.metadata = { ...path.metadata, draft: true };
    updateEditorGarment(addOrReplacePath(editor.garment, pieceId, path), pieceId);
    set({
      draftPathId: path.id,
      selectedPathId: path.id,
      selectedNodeId: null,
      selectedSegmentId: path.segments[0]?.id ?? null,
      analysis: null,
    });
  },

  appendDraftPoint(point) {
    const path = activePath(get().draftPathId);
    if (!path || path.locked) return;
    const piece = activePiece(path.pieceId);
    if (!piece) return;
    const next = appendAnchoredInternalPathPoint(
      path,
      piece,
      point,
      appendInternalPathNode,
    );
    replacePathWithoutHistory(next);
    set({ selectedSegmentId: next.segments.at(-2)?.id ?? next.segments.at(-1)?.id ?? null });
  },

  updateDraftCursor(point) {
    const path = activePath(get().draftPathId);
    const piece = path ? activePiece(path.pieceId) : null;
    if (!path || !piece || path.locked) return;
    replacePathWithoutHistory(moveAnchoredDraftCursor(path, piece, point));
  },

  removeLastDraftPoint() {
    const path = activePath(get().draftPathId);
    if (!path || path.nodes.length <= 2) return;
    const cursor = path.nodes.at(-1)!;
    let next = removeLastInternalPathNode(path);
    next = removeLastInternalPathNode(next);
    next = appendInternalPathNode(next, cursor);
    replacePathWithoutHistory(next);
    set({ selectedSegmentId: next.segments.at(-2)?.id ?? next.segments.at(-1)?.id ?? null });
  },

  confirmDraft() {
    const state = get();
    const path = activePath(state.draftPathId);
    if (!path) return false;
    const piece = activePiece(path.pieceId);
    if (!piece) return false;
    let next = removeLastInternalPathNode(path);
    if (next.nodes.length < 2 || next.segments.length < 1) return false;
    next = finalizeBoundaryAnchors(next, piece);
    next = { ...next, metadata: { ...next.metadata, draft: false } };
    replacePathWithoutHistory(next);
    useEditorStore.getState().commitEdit();
    const analysis = analyzePath(next);
    set({
      draftPathId: null,
      selectedPathId: next.id,
      selectedNodeId: null,
      selectedSegmentId: next.segments[0]?.id ?? null,
      analysis,
    });
    return true;
  },

  cancelDraft() {
    if (get().draftPathId) useEditorStore.getState().cancelEdit();
    set({ draftPathId: null, selectedPathId: null, selectedNodeId: null, selectedSegmentId: null, analysis: null });
  },

  selectPath(pathId, segmentId = null) {
    if (!pathId) {
      set({ selectedPathId: null, selectedNodeId: null, selectedSegmentId: null, analysis: null });
      return;
    }
    const path = activePath(pathId);
    if (!path) return;
    set({
      selectedPathId: path.id,
      selectedNodeId: null,
      selectedSegmentId: segmentId ?? path.segments[0]?.id ?? null,
      analysis: analyzePath(path),
    });
  },

  selectNode(selectedNodeId) {
    set({ selectedNodeId });
  },

  beginGeometryEdit(label = "Editar caminho interno") {
    useEditorStore.getState().beginEdit(label, "geometry");
  },

  moveSelectedNode(point) {
    const state = get();
    const path = activePath(state.selectedPathId);
    const piece = path ? activePiece(path.pieceId) : null;
    if (!path || !piece || !state.selectedNodeId || path.locked) return;
    const next = moveAnchoredInternalPathNode(path, piece, state.selectedNodeId, point);
    replacePathWithoutHistory(next);
    set({ analysis: analyzePath(next) });
  },

  moveSelectedHandle(handle, vector) {
    const state = get();
    const path = activePath(state.selectedPathId);
    if (!path || !state.selectedNodeId || path.locked) return;
    const next = moveInternalPathHandle(path, state.selectedNodeId, handle, vector);
    replacePathWithoutHistory(next);
    set({ analysis: analyzePath(next) });
  },

  commitGeometryEdit() {
    useEditorStore.getState().commitEdit();
    get().refreshAnalysis();
  },

  cancelGeometryEdit() {
    useEditorStore.getState().cancelEdit();
    get().refreshAnalysis();
  },

  setPurpose(purpose) {
    const path = activePath(get().selectedPathId);
    if (!path) return;
    const piece = activePiece(path.pieceId);
    let next = setInternalPathPurpose(path, purpose);
    if (piece) next = finalizeBoundaryAnchors(next, piece);
    commitPathMutation(next, "Converter finalidade do caminho");
    get().refreshAnalysis();
  },

  setSelectedSegmentKind(kind) {
    const state = get();
    const path = activePath(state.selectedPathId);
    const segmentId = state.selectedSegmentId ?? path?.segments[0]?.id;
    if (!path || !segmentId) return;
    commitPathMutation(setInternalPathSegmentKind(path, segmentId, kind), kind === "cubic" ? "Converter caminho para curva" : "Converter caminho para reta");
    get().refreshAnalysis();
  },

  toggleVisibility() {
    const path = activePath(get().selectedPathId);
    if (!path) return;
    commitPathMutation({ ...path, visible: !path.visible }, "Alterar visibilidade do caminho");
  },

  toggleLocked() {
    const path = activePath(get().selectedPathId);
    if (!path) return;
    commitPathMutation({ ...path, locked: !path.locked }, "Alterar bloqueio do caminho");
  },

  deleteSelectedPath() {
    const state = get();
    const path = activePath(state.selectedPathId);
    if (!path) return;
    const editor = useEditorStore.getState();
    editor.beginEdit("Excluir caminho interno", "geometry");
    const garment: GarmentDraft = {
      ...editor.garment,
      pieces: editor.garment.pieces.map((piece) => piece.id === path.pieceId
        ? { ...piece, internalLines: (piece.internalLines ?? []).filter((line) => line.id !== path.id), darts: (piece.darts ?? []).filter((dart) => dart.pathId !== path.id) }
        : piece),
    };
    updateEditorGarment(garment, path.pieceId);
    useEditorStore.getState().commitEdit();
    set({ selectedPathId: null, selectedNodeId: null, selectedSegmentId: null, analysis: null });
  },

  applySelectedPath(keepJoined = false) {
    const path = activePath(get().selectedPathId);
    if (!path) return false;
    const editor = useEditorStore.getState();
    const result = applyModelingInternalPathOperation(editor.garment, path.pieceId, path.id, { keepJoined });
    if (!result.ok) {
      set({ analysis: analyzePath(path) });
      return false;
    }
    editor.beginEdit(path.purpose === "dart" ? "Aplicar pence estrutural" : keepJoined ? "Cortar e manter costurado" : "Aplicar corte interno", path.purpose === "dart" ? "dart" : "cut");
    updateEditorGarment(result.garment, result.activePieceId);
    useEditorStore.getState().commitEdit();
    set({
      draftPathId: null,
      selectedPathId: path.purpose === "dart" ? path.id : null,
      selectedNodeId: null,
      selectedSegmentId: null,
      analysis: null,
    });
    return true;
  },

  refreshAnalysis() {
    const path = activePath(get().selectedPathId);
    set({ analysis: path ? analyzePath(path) : null });
  },

  reset() {
    set({ draftPathId: null, selectedPathId: null, selectedNodeId: null, selectedSegmentId: null, analysis: null });
  },
}));

function activePath(pathId: string | null): InternalPath | null {
  if (!pathId) return null;
  for (const piece of useEditorStore.getState().garment.pieces) {
    const raw = piece.internalLines?.find((line) => line.id === pathId);
    if (raw && isInternalPath(raw)) return normalizeInternalPath(raw);
  }
  return null;
}

function activePiece(pieceId: string): PatternPiece | null {
  return useEditorStore.getState().garment.pieces.find((piece) => piece.id === pieceId) ?? null;
}

function analyzePath(path: InternalPath): InternalPathAnalysis | null {
  const editor = useEditorStore.getState();
  const piece = editor.garment.pieces.find((candidate) => candidate.id === path.pieceId);
  return piece ? analyzeModelingInternalPath(piece, path, editor.garment.seams ?? []) : null;
}

function replacePathWithoutHistory(path: InternalPath): void {
  const editor = useEditorStore.getState();
  updateEditorGarment(addOrReplacePath(editor.garment, path.pieceId, path), path.pieceId);
}

function commitPathMutation(path: InternalPath, label: string): void {
  const editor = useEditorStore.getState();
  editor.beginEdit(label, "geometry");
  updateEditorGarment(addOrReplacePath(editor.garment, path.pieceId, path), path.pieceId);
  useEditorStore.getState().commitEdit();
}

function addOrReplacePath(garment: GarmentDraft, pieceId: string, path: InternalPath): GarmentDraft {
  return {
    ...garment,
    pieces: garment.pieces.map((piece) => piece.id === pieceId
      ? { ...piece, internalLines: [...(piece.internalLines ?? []).filter((line) => line.id !== path.id), path] }
      : piece),
  };
}

function updateEditorGarment(garment: GarmentDraft, activePieceId: string): void {
  const piece = garment.pieces.find((candidate) => candidate.id === activePieceId) ?? garment.pieces[0];
  if (!piece) return;
  const raw = currentEngine().restorePiece(piece);
  const snapshot = {
    ...raw,
    piece: {
      ...structuredClone(piece),
      ...raw.piece,
      internalLines: structuredClone(piece.internalLines),
      darts: structuredClone(piece.darts),
      fabricId: piece.fabricId,
      cutQuantity: piece.cutQuantity,
      cutOnFold: piece.cutOnFold,
    } as PatternPiece,
  };
  useEditorStore.setState({
    garment,
    activePieceId: piece.id,
    snapshot,
    selectedPointId: null,
    selectedEdgeId: null,
    selectedSeamId: null,
    selectedDartId: null,
    selectedPieceIds: [piece.id],
    pieceSelectionActive: true,
  });
}
