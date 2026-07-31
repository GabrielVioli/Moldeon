import { create } from "zustand";
import { currentEngine } from "../core/engineRuntime";
import type {
  BodyMeasurements,
  BodyType,
  GarmentDraft,
  PatternPiece,
  PatternPreviewPlacement,
  PatternSnapshot,
  EdgeRange,
  Seam,
  Guide,
} from "../domain/pattern";
import {
  applyFabricPreset,
  createDefaultFabricSource,
  createFabricSource,
  type FabricPresetId,
  type FabricSource,
} from "../domain/fabric";
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
  // seams and guides manipulation
  addSeam(first: EdgeRange, second: EdgeRange, direction?: "forward" | "reverse"): void;
  removeSeam(seamId: string): void;
  toggleSeamDirection(seamId: string): void;
  addGuide(orientation: "horizontal" | "vertical", positionMm: number): void;
  moveGuide(guideId: string, positionMm: number): void;
  removeGuide(guideId: string): void;
  setBodyType(bodyType: BodyType): void;
  setBodyMeasurement(
    measurement: keyof BodyMeasurements,
    valueMm: number,
  ): void;
  addFabric(presetId: FabricPresetId): string;
  updateFabric(fabricId: string, update: Partial<FabricSource>): void;
  applyFabricPreset(fabricId: string, presetId: FabricPresetId): void;
  removeFabric(fabricId: string): void;
  assignFabricToActivePiece(fabricId: string): void;
  setActivePiecePlacements(placements: PatternPreviewPlacement[]): void;
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

  // Seams: create / remove / toggle direction (now stored at garment level)
  addSeam: (first: EdgeRange, second: EdgeRange, direction: "forward" | "reverse" = "forward") => {
    const state = get();
    const beforeGarment = state.garment;
    const beforeSeams = [...(beforeGarment.seams ?? [])];
    const id = `${beforeGarment.id}:seam-${beforeSeams.length + 1}`;
    // map legacy direction to new semantics
    const dir: any = direction === "reverse" ? "opposite" : "same";
    const newSeam: Seam = { id, first: { ...first } as any, second: { ...second } as any, direction: dir, easeRatio: 0, type: "standard" } as any;
    const afterSeams = [...beforeSeams, newSeam];

    // record a synthetic piece change carrying seams so undo/redo can carry them back
    const beforePiece = { ...state.snapshot.piece, seams: beforeSeams } as any;
    const afterPiece = { ...state.snapshot.piece, seams: afterSeams } as any;
    commandHistory.record("Criar costura", beforePiece, afterPiece);

    const snapshot = { ...state.snapshot, piece: afterPiece } as any;
    updateActiveSnapshot(set, get, snapshot, { selectedPointId: null });
  },

  removeSeam: (seamId: string) => {
    const state = get();
    const beforeGarment = state.garment;
    const beforeSeams = [...(beforeGarment.seams ?? [])];
    const afterSeams = beforeSeams.filter((s) => s.id !== seamId);

    const beforePiece = { ...state.snapshot.piece, seams: beforeSeams } as any;
    const afterPiece = { ...state.snapshot.piece, seams: afterSeams } as any;
    commandHistory.record("Remover costura", beforePiece, afterPiece);

    const snapshot = { ...state.snapshot, piece: afterPiece } as any;
    updateActiveSnapshot(set, get, snapshot);
  },

  toggleSeamDirection: (seamId: string) => {
    const state = get();
    const beforeGarment = state.garment;
    const beforeSeams = [...(beforeGarment.seams ?? [])];
    const afterSeams = beforeSeams.map((s) =>
      s.id === seamId ? ({ ...s, direction: s.direction === "same" ? "opposite" : "same" } as Seam) : s,
    );

    const beforePiece = { ...state.snapshot.piece, seams: beforeSeams } as any;
    const afterPiece = { ...state.snapshot.piece, seams: afterSeams } as any;
    commandHistory.record("Alternar direção da costura", beforePiece, afterPiece);

    const snapshot = { ...state.snapshot, piece: afterPiece } as any;
    updateActiveSnapshot(set, get, snapshot);
  },

  // Guides: simple create / move / remove
  addGuide: (orientation: "horizontal" | "vertical", positionMm: number) => {
    const before = get().snapshot.piece;
    const nextGuides = [...(before.guides ?? [])];
    const id = `${before.id}:guide-${nextGuides.length + 1}`;
    nextGuides.push({ id, orientation, positionMm });
    const piece = { ...before, guides: nextGuides };
    commandHistory.record("Adicionar guia", before, piece);
    updateActiveSnapshot(set, get, { ...get().snapshot, piece } as any);
  },

  moveGuide: (guideId: string, positionMm: number) => {
    const before = get().snapshot.piece;
    const nextGuides = (before.guides ?? []).map((g) =>
      g.id === guideId ? { ...g, positionMm } : g,
    );
    const piece = { ...before, guides: nextGuides };
    commandHistory.record("Mover guia", before, piece);
    updateActiveSnapshot(set, get, { ...get().snapshot, piece } as any);
  },

  removeGuide: (guideId: string) => {
    const before = get().snapshot.piece;
    const nextGuides = (before.guides ?? []).filter((g) => g.id !== guideId);
    const piece = { ...before, guides: nextGuides };
    commandHistory.record("Remover guia", before, piece);
    updateActiveSnapshot(set, get, { ...get().snapshot, piece } as any);
  },

  setBodyType: (bodyType) => {
    set((state) => ({
      garment: {
        ...state.garment,
        bodyType,
      },
    }));
  },

  setBodyMeasurement: (measurement, valueMm) => {
    if (!Number.isFinite(valueMm) || valueMm <= 0) return;
    set((state) => ({
      garment: {
        ...state.garment,
        measurements: {
          ...state.garment.measurements,
          [measurement]: valueMm,
        },
      },
    }));
  },

  addFabric: (presetId) => {
    const source = createFabricSource(presetId, get().garment.fabrics.length);
    set((state) => ({
      garment: {
        ...state.garment,
        fabrics: [...state.garment.fabrics, source],
      },
    }));
    return source.id;
  },

  updateFabric: (fabricId, update) => {
    set((state) => ({
      garment: {
        ...state.garment,
        fabrics: state.garment.fabrics.map((source) =>
          source.id === fabricId
            ? sanitizeFabricUpdate({ ...source, ...update }, source)
            : source,
        ),
      },
    }));
  },

  applyFabricPreset: (fabricId, presetId) => {
    set((state) => ({
      garment: {
        ...state.garment,
        fabrics: state.garment.fabrics.map((source) =>
          source.id === fabricId
            ? applyFabricPreset(source, presetId)
            : source,
        ),
      },
    }));
  },

  removeFabric: (fabricId) => {
    const state = get();
    if (state.garment.fabrics.length <= 1) return;
    const fabrics = state.garment.fabrics.filter(
      (source) => source.id !== fabricId,
    );
    const fallbackFabricId = fabrics[0].id;
    const garment = {
      ...state.garment,
      fabrics,
      pieces: state.garment.pieces.map((piece) =>
        piece.fabricId === fabricId
          ? { ...piece, fabricId: fallbackFabricId }
          : piece,
      ),
    };
    const activePiece =
      garment.pieces.find((piece) => piece.id === state.activePieceId) ??
      state.snapshot.piece;
    set({
      garment,
      snapshot: {
        ...state.snapshot,
        piece: structuredClone(activePiece),
      },
    });
  },

  assignFabricToActivePiece: (fabricId) => {
    if (!get().garment.fabrics.some((source) => source.id === fabricId)) return;
    updatePieceMetadata(set, get, { fabricId });
  },

  setActivePiecePlacements: (placements) => {
    if (placements.length === 0) return;
    updatePieceMetadata(set, get, {
      previewPlacements: placements.map((placement) => ({ ...placement })),
    });
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

// if snapshot.piece carries seams (used for undo/redo of seam operations),
// apply them to the garment-level seams as well
const currentGarment = get().garment;
const newGarment = (snapshot.piece as any).seams
  ? { ...currentGarment, pieces: currentGarment.pieces.map((candidate) => (candidate.id === snapshot.piece.id ? structuredClone(snapshot.piece) : candidate)), seams: structuredClone((snapshot.piece as any).seams) }
  : replacePiece(currentGarment, snapshot.piece);

set({
  garment: newGarment,
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
      ...(source.fabricId === undefined ? {} : { fabricId: source.fabricId }),
      ...(source.previewPlacements === undefined
        ? {}
        : {
            previewPlacements: source.previewPlacements.map((placement) => ({
              ...placement,
            })),
          }),
      ...(source.guides === undefined
        ? {}
        : { guides: source.guides.map((g) => ({ ...g })) }),
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
  const fabric = createDefaultFabricSource();
  const measurements: BodyMeasurements = {
    heightMm: 1680,
    bustMm: 920,
    waistMm: 760,
    hipMm: 1000,
    shoulderWidthMm: 400,
    torsoLengthMm: 440,
    armLengthMm: 590,
    inseamMm: 780,
  };
  return {
    id: "legacy-skirt",
    templateId: "legacy-skirt",
    name: "Saia base",
    description: "Molde inicial preservado para compatibilidade.",
    bodyType: "feminine",
    measurements,
    fabrics: [fabric],
    pieces: [
      {
        ...structuredClone(piece),
        cutQuantity: 1,
        cutOnFold: true,
        fabricId: fabric.id,
        previewPlacements: [
          { region: "lower", surface: "front", bodySide: "center" },
          { region: "lower", surface: "back", bodySide: "center" },
        ],
      },
    ],
  };
}

function updatePieceMetadata(
  set: StoreSetter,
  get: StoreGetter,
  update: Partial<PatternPiece>,
): void {
  const state = get();
  const piece = {
    ...state.snapshot.piece,
    ...update,
  };
  set({
    garment: replacePiece(state.garment, piece),
    snapshot: {
      ...state.snapshot,
      piece: structuredClone(piece),
    },
  });
}

function sanitizeFabricUpdate(
  candidate: FabricSource,
  fallback: FabricSource,
): FabricSource {
  return {
    ...candidate,
    name: candidate.name.trim() || fallback.name,
    color: /^#[0-9a-f]{6}$/i.test(candidate.color)
      ? candidate.color
      : fallback.color,
    widthMm:
      Number.isFinite(candidate.widthMm) && candidate.widthMm > 0
        ? candidate.widthMm
        : fallback.widthMm,
    lengthMm:
      Number.isFinite(candidate.lengthMm) && candidate.lengthMm > 0
        ? candidate.lengthMm
        : fallback.lengthMm,
    quantity:
      Number.isInteger(candidate.quantity) && candidate.quantity > 0
        ? candidate.quantity
        : fallback.quantity,
  };
}
