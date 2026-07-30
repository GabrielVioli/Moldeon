import { create } from "zustand";
import { currentEngine } from "../core/engineRuntime";
import type {
  BodyMeasurements,
  GarmentDraft,
  PatternPiece,
  PatternSnapshot,
} from "../domain/pattern";
import {
  insertPatternPoint,
  removePatternPoint,
} from "../domain/patternEditing";
import { PatternCommandHistory } from "./patternCommandHistory";

interface EditorState {
  garment: GarmentDraft;
  baselinePieces: PatternPiece[];
  activePieceId: string;
  snapshot: PatternSnapshot;
  engineBackend: "wasm" | "typescript";
  selectedPointId: string | null;
  simulateVersion: number;
  canUndo: boolean;
  canRedo: boolean;
  setEngineSnapshot(snapshot: PatternSnapshot, backend: "wasm" | "typescript"): void;
  restoreGarment(
    garment: GarmentDraft,
    activePieceId: string,
    backend: "wasm" | "typescript",
  ): void;
  loadGarment(garment: GarmentDraft): void;
  selectPiece(pieceId: string): void;
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
  insertPoint(startPointId: string, t: number): void;
  removePoint(pointId: string): void;
  setSeamAllowance(valueMm: number): void;
  resetPattern(): void;
  undo(): void;
  redo(): void;
  simulate(): void;
}

const initialSnapshot = currentEngine().snapshot();
const commandHistory = new PatternCommandHistory();
const initialGarment = createLegacyGarment(initialSnapshot.piece);

export const useEditorStore = create<EditorState>((set, get) => ({
  garment: initialGarment,
  baselinePieces: clonePieces(initialGarment.pieces),
  activePieceId: initialSnapshot.piece.id,
  snapshot: initialSnapshot,
  engineBackend: "typescript",
  selectedPointId: null,
  simulateVersion: 0,
  canUndo: false,
  canRedo: false,

  setEngineSnapshot: (snapshot, backend) => {
    commandHistory.clear();
    const currentGarment = get().garment;
    const sourcePiece =
      currentGarment.pieces.find((piece) => piece.id === snapshot.piece.id) ??
      snapshot.piece;
    const enrichedSnapshot = preservePieceMetadata(snapshot, sourcePiece);
    set({
      garment: replacePiece(currentGarment, enrichedSnapshot.piece),
      snapshot: enrichedSnapshot,
      engineBackend: backend,
      activePieceId: enrichedSnapshot.piece.id,
      selectedPointId: null,
      canUndo: false,
      canRedo: false,
    });
  },

  restoreGarment: (garment, requestedPieceId, backend) => {
    const activePiece =
      garment.pieces.find((piece) => piece.id === requestedPieceId) ??
      garment.pieces[0];
    if (!activePiece) return;
    commandHistory.clear();
    const snapshot = preservePieceMetadata(
      currentEngine().restorePiece(activePiece),
      activePiece,
    );
    set({
      garment: replacePiece(garment, snapshot.piece),
      baselinePieces: clonePieces(garment.pieces),
      activePieceId: activePiece.id,
      snapshot,
      engineBackend: backend,
      selectedPointId: null,
      canUndo: false,
      canRedo: false,
    });
  },

  loadGarment: (garment) => {
    const activePiece = garment.pieces[0];
    if (!activePiece) return;
    commandHistory.clear();
    const snapshot = preservePieceMetadata(
      currentEngine().restorePiece(activePiece),
      activePiece,
    );
    set({
      garment: replacePiece(garment, snapshot.piece),
      baselinePieces: clonePieces(garment.pieces),
      activePieceId: activePiece.id,
      snapshot,
      selectedPointId: null,
      canUndo: false,
      canRedo: false,
    });
  },

  selectPiece: (pieceId) => {
    if (pieceId === get().activePieceId) return;
    const piece = get().garment.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) return;
    commandHistory.clear();
    const snapshot = preservePieceMetadata(
      currentEngine().restorePiece(piece),
      piece,
    );
    set({
      garment: replacePiece(get().garment, snapshot.piece),
      activePieceId: piece.id,
      snapshot,
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
    updateActiveSnapshot(set, get, currentEngine().restorePiece(piece));
  },

  movePoint: (pointId, xMm, yMm) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().movePoint(pointId, xMm, yMm);
    commandHistory.record("Mover ponto", before, snapshot.piece);
    updateActiveSnapshot(set, get, snapshot);
  },

  moveHandle: (pointId, handle, xMm, yMm) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().moveHandle(pointId, handle, xMm, yMm);
    commandHistory.record("Ajustar curva", before, snapshot.piece);
    updateActiveSnapshot(set, get, snapshot);
  },

  setSegmentCurve: (pointId, enabled) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().setSegmentCurve(pointId, enabled);
    commandHistory.record(
      enabled ? "Criar curva" : "Converter em linha",
      before,
      snapshot.piece,
    );
    updateActiveSnapshot(set, get, snapshot);
  },

  insertPoint: (startPointId, t) => {
    const before = get().snapshot.piece;
    const insertion = insertPatternPoint(before, startPointId, t);
    if (!insertion) return;
    const snapshot = currentEngine().restorePiece(insertion.piece);
    commandHistory.record("Adicionar ponto", before, snapshot.piece);
    updateActiveSnapshot(set, get, snapshot, {
      selectedPointId: insertion.pointId,
    });
  },

  removePoint: (pointId) => {
    const before = get().snapshot.piece;
    const piece = removePatternPoint(before, pointId);
    if (!piece) return;
    const snapshot = currentEngine().restorePiece(piece);
    commandHistory.record("Excluir ponto", before, snapshot.piece);
    updateActiveSnapshot(set, get, snapshot, { selectedPointId: null });
  },

  setSeamAllowance: (valueMm) => {
    const before = get().snapshot.piece;
    const snapshot = currentEngine().setSeamAllowance(valueMm);
    commandHistory.record("Alterar margem", before, snapshot.piece);
    updateActiveSnapshot(set, get, snapshot);
  },

  resetPattern: () => {
    const before = get().snapshot.piece;
    const original =
      get().baselinePieces.find((piece) => piece.id === get().activePieceId) ??
      before;
    const snapshot = currentEngine().restorePiece(original);
    commandHistory.record("Restaurar molde", before, snapshot.piece);
    updateActiveSnapshot(set, get, snapshot, { selectedPointId: null });
  },

  undo: () => {
    if (commandHistory.isTransactionActive) {
      commandHistory.commit(get().snapshot.piece);
    }
    const piece = commandHistory.undo();
    if (!piece) return;

    const snapshot = currentEngine().restorePiece(piece);
    updateActiveSnapshot(set, get, snapshot, {
      selectedPointId: keepSelectedPoint(get().selectedPointId, snapshot),
    });
  },

  redo: () => {
    if (commandHistory.isTransactionActive) {
      commandHistory.commit(get().snapshot.piece);
    }
    const piece = commandHistory.redo();
    if (!piece) return;

    const snapshot = currentEngine().restorePiece(piece);
    updateActiveSnapshot(set, get, snapshot, {
      selectedPointId: keepSelectedPoint(get().selectedPointId, snapshot),
    });
  },

  simulate: () => set((state) => ({ simulateVersion: state.simulateVersion + 1 })),
}));

type StoreSetter = Parameters<typeof useEditorStore.setState>[0] extends never
  ? never
  : (
      partial:
        | Partial<EditorState>
        | ((state: EditorState) => Partial<EditorState>),
    ) => void;
type StoreGetter = () => EditorState;

function updateActiveSnapshot(
  set: StoreSetter,
  get: StoreGetter,
  rawSnapshot: PatternSnapshot,
  additional: Partial<EditorState> = {},
): void {
  const sourcePiece =
    get().garment.pieces.find((piece) => piece.id === get().activePieceId) ??
    rawSnapshot.piece;
  const snapshot = preservePieceMetadata(rawSnapshot, sourcePiece);
  set({
    garment: replacePiece(get().garment, snapshot.piece),
    snapshot,
    ...historyAvailability(),
    ...additional,
  });
}

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

function preservePieceMetadata(
  snapshot: PatternSnapshot,
  source: PatternPiece,
): PatternSnapshot {
  return {
    ...snapshot,
    piece: {
      ...snapshot.piece,
      ...(source.cutQuantity === undefined
        ? {}
        : { cutQuantity: source.cutQuantity }),
      ...(source.cutOnFold === undefined ? {} : { cutOnFold: source.cutOnFold }),
      ...(source.previewPlacements === undefined
        ? {}
        : {
            previewPlacements: source.previewPlacements.map((placement) => ({
              ...placement,
            })),
          }),
    },
  };
}

function replacePiece(garment: GarmentDraft, piece: PatternPiece): GarmentDraft {
  return {
    ...garment,
    pieces: garment.pieces.map((candidate) =>
      candidate.id === piece.id ? structuredClone(piece) : candidate,
    ),
  };
}

function clonePieces(pieces: readonly PatternPiece[]): PatternPiece[] {
  return pieces.map((piece) => structuredClone(piece));
}

function createLegacyGarment(piece: PatternPiece): GarmentDraft {
  const measurements: BodyMeasurements = {
    heightMm: 1680,
    bustMm: 920,
    waistMm: 760,
    hipMm: 1000,
  };
  return {
    id: "legacy-skirt",
    templateId: "legacy-skirt",
    name: "Saia base",
    description: "Molde inicial preservado para compatibilidade.",
    measurements,
    pieces: [
      {
        ...structuredClone(piece),
        cutQuantity: 1,
        cutOnFold: true,
        previewPlacements: [
          { region: "lower", surface: "front", bodySide: "center" },
          { region: "lower", surface: "back", bodySide: "center" },
        ],
      },
    ],
  };
}
