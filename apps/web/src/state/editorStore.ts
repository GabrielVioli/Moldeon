import { create } from "zustand";
import { currentEngine } from "../core/engineRuntime";
import {
  createDocumentId,
  createPatternPieceFromDraft,
  createPreviewPlacement,
  makeEdgeId,
  duplicatePatternPiece,
  validateSeam,
  type BodyMeasurements,
  type BodyType,
  type DraftContour,
  type EdgeRange,
  type GarmentDraft,
  type Guide,
  type PatternPiece,
  type PatternDart,
  type PatternPoint,
  type PatternVector,
  type PatternPreviewPlacement,
  type PatternSnapshot,
  type PieceWorkspaceState,
  type PieceWorkspaceTransform,
  type Seam,
  type SeamDirection,
  type SeamTreatment,
  type SeamValidationIssue,
} from "../domain/pattern";
import { closeDart, createDart, createPatternPiecesFromSplit, extendCutLine } from "../domain/patternOperations";
import { analyzeSeamCompatibility, inferAssemblyPlacement, validateSeamForAssembly, type SeamCompatibility } from "../domain/assembly";
import { validatePatternContour } from "../domain/polygonGeometry";
import {
  applyFabricPreset,
  createDefaultFabricSource,
  createFabricSource,
  type FabricPresetId,
  type FabricSource,
} from "../domain/fabric";
import {
  insertPatternPoint,
  remapSeamsAfterSegmentSplit,
  removePatternPoint,
} from "../domain/patternEditing";
import { convertPatternSegment, movePatternSegment, splitPatternSegment } from "../domain/segmentEditing";
import { updateDart as updatePatternDart } from "../domain/patternOperations";
import {
  DocumentCommandHistory,
  type DocumentCommandType,
  type EditorDocumentState,
} from "./documentCommandHistory";

export interface EditorState {
  garment: GarmentDraft;
  baselinePieces: PatternPiece[];
  activePieceId: string;
  snapshot: PatternSnapshot;
  engineBackend: "wasm" | "typescript";
  selectedPointId: string | null;
  selectedEdgeId: string | null;
  selectedSeamId: string | null;
  pieceSelectionActive: boolean;
  selectedPieceIds: string[];
  draftContour: DraftContour | null;
  draftCursor: PatternPoint | null;
  draftError: string | null;
  seamIssues: SeamValidationIssue[];
  seamProposal: { first: EdgeRange; second: EdgeRange; compatibility: SeamCompatibility } | null;
  seamFirstEdge: EdgeRange | null;
  nearbySeamSuggestion: { first: EdgeRange; second: EdgeRange } | null;
  cutDraft: { pieceId: string; start: PatternVector; end: PatternVector; phase: "placing" | "ready"; error?: string } | null;
  dartDraft: { pieceId: string; edgePoint: PatternVector; apex: PatternVector; phase: "placing" | "ready" } | null;
  selectedDartId: string | null;
  measureDraft: { start: PatternVector; end: PatternVector } | null;
  simulateVersion: number;
  canUndo: boolean;
  canRedo: boolean;
  setEngineSnapshot(snapshot: PatternSnapshot, backend: "wasm" | "typescript"): void;
  restoreGarment(garment: GarmentDraft, activePieceId: string, backend: "wasm" | "typescript"): void;
  loadGarment(garment: GarmentDraft): void;
  selectPiece(pieceId: string): void;
  togglePieceSelection(pieceId: string): void;
  setPieceSelection(pieceIds: string[]): void;
  selectAllPieces(): void;
  deleteSelectedPieces(): void;
  rotateSelectedPieces(deltaDeg: number): void;
  duplicateSelectedPieces(mirrored?: boolean): void;
  selectPoint(pointId: string | null): void;
  selectEdge(edgeId: string | null): void;
  selectSeam(seamId: string | null): void;
  clearSelection(): void;
  beginEdit(label: string, type?: DocumentCommandType): void;
  commitEdit(): void;
  cancelEdit(): void;
  movePoint(pointId: string, xMm: number, yMm: number): void;
  moveHandle(pointId: string, handle: "in" | "out", xMm: number, yMm: number): void;
  setSegmentCurve(pointId: string, enabled: boolean): void;
  insertPoint(startPointId: string, t: number): void;
  removePoint(pointId: string): void;
  setSeamAllowance(valueMm: number): void;
  addSeam(first: EdgeRange, second: EdgeRange, direction?: "forward" | "reverse"): void;
  proposeSeam(first: EdgeRange, second: EdgeRange): void;
  selectFirstSeamEdge(edge: EdgeRange | null): void;
  setNearbySeamSuggestion(suggestion: EditorState["nearbySeamSuggestion"]): void;
  cancelSeamProposal(): void;
  confirmSeamProposal(options: { name: string; direction: SeamDirection; treatment: SeamTreatment }): void;
  setCutDraft(draft: (Omit<NonNullable<EditorState["cutDraft"]>, "phase"> & { phase?: "placing" | "ready" }) | null): void;
  freezeCutDraft(): void;
  confirmCut(keepJoined: boolean): void;
  setDartDraft(draft: (Omit<NonNullable<EditorState["dartDraft"]>, "phase"> & { phase?: "placing" | "ready" }) | null): void;
  freezeDartDraft(): void;
  confirmDart(): void;
  selectDart(dartId: string | null): void;
  updateDart(dartId: string, update: Partial<Pick<PatternDart, "widthMm" | "lengthMm" | "directionDeg">>): void;
  removeDart(dartId: string): void;
  invertDart(dartId: string): void;
  moveSelectedSegment(dxMm: number, dyMm: number): void;
  convertSelectedSegment(kind: "line" | "cubic"): void;
  splitSelectedSegment(): void;
  setMeasureDraft(draft: EditorState["measureDraft"]): void;
  cancelIntent(): void;
  updateSeam(seamId: string, update: { name?: string; direction?: SeamDirection; treatment?: SeamTreatment; active?: boolean }): void;
  removeSeam(seamId: string): void;
  toggleSeamDirection(seamId: string): void;
  toggleSeamActive(seamId: string): void;
  addGuide(orientation: Guide["orientation"], positionMm: number): void;
  moveGuide(guideId: string, positionMm: number): void;
  removeGuide(guideId: string): void;
  setBodyType(bodyType: BodyType): void;
  setBodyMeasurement(measurement: keyof BodyMeasurements, valueMm: number): void;
  addFabric(presetId: FabricPresetId): string;
  updateFabric(fabricId: string, update: Partial<FabricSource>): void;
  applyFabricPreset(fabricId: string, presetId: FabricPresetId): void;
  removeFabric(fabricId: string): void;
  assignFabricToActivePiece(fabricId: string): void;
  setActivePiecePlacements(placements: PatternPreviewPlacement[]): void;
  setAssemblyPlacement(pieceId: string, placement: Partial<ReturnType<typeof inferAssemblyPlacement>>): void;
  setEdgeFinish(pieceId: string, edgeId: string, finish: NonNullable<PatternPiece["edgeFinishes"]>[string]): void;
  setGarmentEase(region: "bustMm" | "waistMm" | "hipMm" | "sleeveMm", valueMm: number): void;
  movePieceInWorkspace(pieceId: string, xMm: number, yMm: number): void;
  setPieceWorkspaceTransform(pieceId: string, transform: PieceWorkspaceTransform): void;
  setPieceWorkspaceTransforms(transforms: PieceWorkspaceTransform[]): void;
  rotatePieceInWorkspace(pieceId: string, deltaDeg: number): void;
  setPieceVisibility(pieceId: string, visible: boolean): void;
  setPieceLocked(pieceId: string, locked: boolean): void;
  duplicatePiece(pieceId: string, mirrored?: boolean): void;
  startDraft(name: string): void;
  addDraftPoint(xMm: number, yMm: number): void;
  updateDraftCursor(xMm: number, yMm: number): void;
  removeDraftPoint(): void;
  closeDraft(): void;
  cancelDraft(): void;
  deletePiece(pieceId: string): void;
  renamePiece(pieceId: string, name: string): void;
  resetPattern(): void;
  undo(): void;
  redo(): void;
  simulate(): void;
}

const initialSnapshot = currentEngine().snapshot();
const history = new DocumentCommandHistory();
const initialGarment = ensureWorkspaceState(createLegacyGarment(initialSnapshot.piece));

export const useEditorStore = create<EditorState>((set, get) => ({
  garment: initialGarment,
  baselinePieces: clonePieces(initialGarment.pieces),
  activePieceId: initialSnapshot.piece.id,
  snapshot: initialSnapshot,
  engineBackend: "typescript",
  selectedPointId: null,
  selectedEdgeId: null,
  selectedSeamId: null,
  pieceSelectionActive: false,
  selectedPieceIds: [],
  draftContour: null,
  draftCursor: null,
  draftError: null,
  seamIssues: [],
  seamProposal: null,
  seamFirstEdge: null,
  nearbySeamSuggestion: null,
  cutDraft: null,
  dartDraft: null,
  selectedDartId: null,
  measureDraft: null,
  simulateVersion: 0,
  canUndo: false,
  canRedo: false,

  setEngineSnapshot: (snapshot, backend) => {
    history.clear();
    const garment = ensureWorkspaceState(replacePiece(get().garment, snapshot.piece));
    set({
      garment,
      snapshot: preservePieceMetadata(snapshot, snapshot.piece),
      engineBackend: backend,
      activePieceId: snapshot.piece.id,
      selectedPointId: null,
      selectedEdgeId: null,
      selectedSeamId: null,
      pieceSelectionActive: false,
      selectedPieceIds: [],
      ...historyAvailability(),
    });
  },

  restoreGarment: (garment, requestedPieceId, backend) => {
    history.clear();
    const normalized = migrateLegacyDocument(garment);
    const activePiece = normalized.pieces.find((piece) => piece.id === requestedPieceId) ?? normalized.pieces[0];
    if (!activePiece) return;
    const snapshot = restoreSnapshot(activePiece);
    set({
      garment: replacePiece(normalized, snapshot.piece),
      baselinePieces: clonePieces(normalized.pieces),
      activePieceId: activePiece.id,
      snapshot,
      engineBackend: backend,
      selectedPointId: null,
      selectedEdgeId: null,
      selectedSeamId: null,
      pieceSelectionActive: false,
      selectedPieceIds: [],
      draftContour: null,
      draftCursor: null,
      draftError: null,
      seamIssues: collectSeamIssues(normalized),
      seamProposal: null,
      seamFirstEdge: null,
      nearbySeamSuggestion: null,
      cutDraft: null,
      dartDraft: null,
      selectedDartId: null,
      measureDraft: null,
      ...historyAvailability(),
    });
  },

  loadGarment: (garment) => {
    history.clear();
    const normalized = migrateLegacyDocument(garment);
    const activePiece = normalized.pieces[0];
    if (!activePiece) return;
    applyDocumentState(set, get, { garment: normalized, activePieceId: activePiece.id });
    set({ baselinePieces: clonePieces(normalized.pieces), ...historyAvailability() });
  },

  selectPiece: (pieceId) => {
    const piece = get().garment.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) return;
    set({
      activePieceId: pieceId,
      snapshot: restoreSnapshot(piece),
      selectedPointId: null,
      selectedEdgeId: null,
      selectedSeamId: null,
      pieceSelectionActive: true,
      selectedPieceIds: [pieceId],
    });
  },

  togglePieceSelection: (pieceId) => {
    const state = get();
    const piece = state.garment.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) return;
    const selectedPieceIds = state.selectedPieceIds.includes(pieceId)
      ? state.selectedPieceIds.filter((id) => id !== pieceId)
      : [...state.selectedPieceIds, pieceId];
    const activePieceId = selectedPieceIds.includes(pieceId) ? pieceId : (selectedPieceIds.at(-1) ?? state.activePieceId);
    const activePiece = state.garment.pieces.find((candidate) => candidate.id === activePieceId) ?? piece;
    set({ selectedPieceIds, activePieceId: activePiece.id, snapshot: restoreSnapshot(activePiece), pieceSelectionActive: selectedPieceIds.length > 0, selectedPointId: null, selectedEdgeId: null });
  },
  setPieceSelection: (pieceIds) => {
    const state = get();
    const selectedPieceIds = [...new Set(pieceIds)].filter((id) => state.garment.pieces.some((piece) => piece.id === id));
    const activePieceId = selectedPieceIds.at(-1) ?? state.activePieceId;
    const piece = state.garment.pieces.find((candidate) => candidate.id === activePieceId);
    set({ selectedPieceIds, pieceSelectionActive: selectedPieceIds.length > 0, ...(piece ? { activePieceId, snapshot: restoreSnapshot(piece) } : {}), selectedPointId: null, selectedEdgeId: null });
  },
  selectAllPieces: () => set((state) => ({ selectedPieceIds: state.garment.pieces.filter((piece) => workspaceStateFor(state.garment, piece.id).visible).map((piece) => piece.id), pieceSelectionActive: true })),
  deleteSelectedPieces: () => {
    const state = get();
    const removable = state.selectedPieceIds.filter((id) => !workspaceStateFor(state.garment, id).locked);
    if (removable.length === 0 || removable.length >= state.garment.pieces.length) return;
    changeDocument(set, get, "piece-delete", "Excluir peças selecionadas", (document) => {
      const pieces = document.garment.pieces.filter((piece) => !removable.includes(piece.id));
      return { activePieceId: pieces[0].id, garment: syncLegacyTransforms({ ...document.garment, pieces, seams: (document.garment.seams ?? []).filter((seam) => !removable.includes(seam.first.pieceId) && !removable.includes(seam.second.pieceId)), workspaceStates: (document.garment.workspaceStates ?? []).filter((item) => !removable.includes(item.pieceId)) }) };
    }, { selectedPieceIds: [], pieceSelectionActive: false });
  },
  rotateSelectedPieces: (deltaDeg) => {
    const ids = get().selectedPieceIds;
    changeDocument(set, get, "workspace", "Girar peças selecionadas", (document) => ({ ...document, garment: ids.reduce((garment, id) => workspaceStateFor(garment, id).locked ? garment : patchWorkspaceState(garment, id, (item) => ({ ...item, transform: { ...item.transform, rotationDeg: normalizeRotation(item.transform.rotationDeg + deltaDeg) } })), document.garment) }));
  },
  duplicateSelectedPieces: (mirrored = false) => {
    const state = get(); const ids = state.selectedPieceIds;
    const pairs = ids.map((id) => state.garment.pieces.find((piece) => piece.id === id)).filter((piece): piece is PatternPiece => Boolean(piece)).map((piece) => {
      const duplicate = duplicatePatternPiece(piece, { mirrored, name: `${piece.name} – ${mirrored ? "espelhada" : "cópia"}` });
      const source = workspaceStateFor(state.garment, piece.id);
      return { duplicate, workspace: { ...source, pieceId: duplicate.id, locked: false, transform: { ...source.transform, pieceId: duplicate.id, xMm: source.transform.xMm + 40, yMm: source.transform.yMm + 40 } } as PieceWorkspaceState };
    });
    if (!pairs.length) return;
    changeDocument(set, get, "piece-duplicate", mirrored ? "Espelhar seleção" : "Duplicar seleção", (document) => ({ activePieceId: pairs[0].duplicate.id, garment: syncLegacyTransforms({ ...document.garment, pieces: [...document.garment.pieces, ...pairs.map((pair) => pair.duplicate)], workspaceStates: [...(document.garment.workspaceStates ?? []), ...pairs.map((pair) => pair.workspace)] }) }), { selectedPieceIds: pairs.map((pair) => pair.duplicate.id), pieceSelectionActive: true });
  },

  selectPoint: (selectedPointId) => set({
    selectedPointId,
    selectedEdgeId: null,
    selectedSeamId: null,
    pieceSelectionActive: false,
  }),
  selectEdge: (selectedEdgeId) => set({
    selectedEdgeId,
    selectedPointId: null,
    selectedSeamId: null,
    pieceSelectionActive: false,
  }),
  selectSeam: (selectedSeamId) => set({
    selectedSeamId,
    selectedPointId: null,
    selectedEdgeId: null,
    selectedDartId: null,
    pieceSelectionActive: false,
    selectedPieceIds: [],
  }),
  clearSelection: () => set({
    selectedPointId: null,
    selectedEdgeId: null,
    selectedSeamId: null,
    pieceSelectionActive: false,
    selectedPieceIds: [],
  }),

  beginEdit: (label, type = inferCommandType(label)) => {
    history.begin(type, label, captureDocument(get));
  },
  commitEdit: () => {
    history.commit(captureDocument(get));
    set(historyAvailability());
  },
  cancelEdit: () => {
    const document = history.cancel();
    if (document) applyDocumentState(set, get, document);
  },

  movePoint: (pointId, xMm, yMm) => {
    const before = captureDocument(get);
    applyGeometrySnapshot(set, get, currentEngine().movePoint(pointId, xMm, yMm));
    recordIfStandalone(set, get, "geometry", "Mover ponto", before);
  },
  moveHandle: (pointId, handle, xMm, yMm) => {
    const before = captureDocument(get);
    applyGeometrySnapshot(set, get, currentEngine().moveHandle(pointId, handle, xMm, yMm));
    recordIfStandalone(set, get, "geometry", "Ajustar curva", before);
  },
  setSegmentCurve: (pointId, enabled) => {
    const before = captureDocument(get);
    applyGeometrySnapshot(set, get, currentEngine().setSegmentCurve(pointId, enabled));
    recordIfStandalone(set, get, "geometry", enabled ? "Criar curva" : "Converter em linha", before);
  },
  insertPoint: (startPointId, t) => {
    const state = get();
    const insertion = insertPatternPoint(state.snapshot.piece, startPointId, t);
    if (!insertion) return;
    const before = captureDocument(get);
    const rawSnapshot = currentEngine().restorePiece(insertion.piece);
    const snapshot = preservePieceMetadata(rawSnapshot, insertion.piece);
    const garment = replacePiece(
      {
        ...state.garment,
        seams: remapSeamsAfterSegmentSplit(
          state.garment.seams ?? [],
          insertion.split,
        ),
      },
      snapshot.piece,
    );
    set({
      garment,
      snapshot,
      selectedPointId: insertion.pointId,
      selectedEdgeId: null,
      selectedSeamId: null,
    });
    recordIfStandalone(set, get, "geometry", "Adicionar ponto", before);
  },
  removePoint: (pointId) => {
    const piece = removePatternPoint(get().snapshot.piece, pointId);
    if (!piece) return;
    const before = captureDocument(get);
    applyGeometrySnapshot(set, get, currentEngine().restorePiece(piece), {
      selectedPointId: null,
    });
    recordIfStandalone(set, get, "geometry", "Excluir ponto", before);
  },
  setSeamAllowance: (valueMm) => {
    const before = captureDocument(get);
    applyGeometrySnapshot(set, get, currentEngine().setSeamAllowance(valueMm));
    recordIfStandalone(set, get, "seam-allowance", "Alterar margem", before);
  },

  addSeam: (first, second, direction = "forward") => {
    const state = get();
    const seam: Seam = {
      id: createDocumentId("seam"),
      first: { ...first },
      second: { ...second },
      direction: direction === "reverse" ? "opposite" : "same",
      easeRatio: 0,
      type: "standard",
      name: `Costura ${(state.garment.seams?.length ?? 0) + 1}`,
      treatment: "standard",
    };
    const issues = validateSeam(seam, state.garment);
    if (issues.length > 0) {
      set({ seamIssues: issues });
      return;
    }
    changeDocument(set, get, "seam", "Criar costura", (document) => ({
      ...document,
      garment: { ...document.garment, seams: [...(document.garment.seams ?? []), seam] },
    }));
  },
  removeSeam: (seamId) => changeDocument(set, get, "seam", "Remover costura", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      seams: (document.garment.seams ?? []).filter((seam) => seam.id !== seamId),
    },
  }), { selectedSeamId: null }),
  toggleSeamDirection: (seamId) => changeDocument(set, get, "seam", "Inverter costura", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      seams: (document.garment.seams ?? []).map((seam) =>
        seam.id === seamId
          ? { ...seam, direction: seam.direction === "same" ? "opposite" : "same" }
          : seam,
      ),
    },
  }), { selectedSeamId: seamId }),
  toggleSeamActive: (seamId) => changeDocument(set, get, "seam", "Alterar estado da costura", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      seams: (document.garment.seams ?? []).map((seam) =>
        seam.id === seamId ? { ...seam, active: seam.active === false } : seam,
      ),
    },
  }), { selectedSeamId: seamId }),

  addGuide: (orientation, positionMm) => updateActivePieceDocument(
    set,
    get,
    "metadata",
    "Adicionar guia",
    (piece) => ({
      ...piece,
      guides: [...(piece.guides ?? []), { id: createDocumentId("guide"), orientation, positionMm }],
    }),
  ),
  moveGuide: (guideId, positionMm) => updateActivePieceDocument(
    set,
    get,
    "metadata",
    "Mover guia",
    (piece) => ({
      ...piece,
      guides: (piece.guides ?? []).map((guide) =>
        guide.id === guideId ? { ...guide, positionMm } : guide,
      ),
    }),
  ),
  removeGuide: (guideId) => updateActivePieceDocument(
    set,
    get,
    "metadata",
    "Remover guia",
    (piece) => ({ ...piece, guides: (piece.guides ?? []).filter((guide) => guide.id !== guideId) }),
  ),

  setBodyType: (bodyType) => changeDocument(set, get, "metadata", "Alterar corpo", (document) => ({
    ...document,
    garment: { ...document.garment, bodyType },
  })),
  setBodyMeasurement: (measurement, valueMm) => {
    if (!Number.isFinite(valueMm) || valueMm <= 0) return;
    changeDocument(set, get, "measurement", "Alterar medida corporal", (document) => ({
      ...document,
      garment: {
        ...document.garment,
        measurements: { ...document.garment.measurements, [measurement]: valueMm },
      },
    }));
  },

  addFabric: (presetId) => {
    const source = createFabricSource(presetId, get().garment.fabrics.length);
    changeDocument(set, get, "metadata", "Adicionar tecido", (document) => ({
      ...document,
      garment: { ...document.garment, fabrics: [...document.garment.fabrics, source] },
    }));
    return source.id;
  },
  updateFabric: (fabricId, update) => changeDocument(set, get, "metadata", "Editar tecido", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      fabrics: document.garment.fabrics.map((fabric) =>
        fabric.id === fabricId ? sanitizeFabricUpdate({ ...fabric, ...update }, fabric) : fabric,
      ),
    },
  })),
  applyFabricPreset: (fabricId, presetId) => changeDocument(set, get, "metadata", "Alterar tecido", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      fabrics: document.garment.fabrics.map((fabric) =>
        fabric.id === fabricId ? applyFabricPreset(fabric, presetId) : fabric,
      ),
    },
  })),
  removeFabric: (fabricId) => {
    if (get().garment.fabrics.length <= 1) return;
    changeDocument(set, get, "metadata", "Remover tecido", (document) => {
      const fabrics = document.garment.fabrics.filter((fabric) => fabric.id !== fabricId);
      const fallbackId = fabrics[0].id;
      return {
        ...document,
        garment: {
          ...document.garment,
          fabrics,
          pieces: document.garment.pieces.map((piece) =>
            piece.fabricId === fabricId ? { ...piece, fabricId: fallbackId } : piece,
          ),
        },
      };
    });
  },
  assignFabricToActivePiece: (fabricId) => {
    if (!get().garment.fabrics.some((fabric) => fabric.id === fabricId)) return;
    updateActivePieceDocument(set, get, "metadata", "Atribuir tecido", (piece) => ({ ...piece, fabricId }));
  },
  setActivePiecePlacements: (placements) => updateActivePieceDocument(
    set,
    get,
    "placement",
    placements.length > 0 ? "Alterar preparação 3D" : "Remover do corpo",
    (piece) => ({
      ...piece,
      ...(placements.length > 0
        ? { previewPlacements: structuredClone(placements) }
        : { previewPlacements: undefined }),
    }),
  ),
  setAssemblyPlacement: (pieceId, update) => {
    if (!get().garment.pieces.some((piece) => piece.id === pieceId)) return;
    changeDocument(set, get, "placement", "Posicionar peça na montagem", (document) => {
    const piece = document.garment.pieces.find((candidate) => candidate.id === pieceId)!;
    const current = document.garment.assemblyPlacements?.find((placement) => placement.pieceId === pieceId)
      ?? inferAssemblyPlacement(piece, document.garment.assemblyPlacements?.length ?? 0);
    const placement = { ...current, ...update, pieceId, source: "manual" as const };
    return {
      ...document,
      garment: {
        ...document.garment,
        assemblyPlacements: [
          ...(document.garment.assemblyPlacements ?? []).filter((candidate) => candidate.pieceId !== pieceId),
          placement,
        ],
      },
    };
    });
  },
  setEdgeFinish: (pieceId, edgeId, finish) => changeDocument(set, get, "metadata", "Alterar acabamento", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      pieces: document.garment.pieces.map((piece) => piece.id === pieceId
        ? { ...piece, edgeFinishes: { ...(piece.edgeFinishes ?? {}), [edgeId]: finish } }
        : piece),
    },
  })),
  setGarmentEase: (region, valueMm) => {
    if (!Number.isFinite(valueMm)) return;
    changeDocument(set, get, "metadata", "Alterar folga da roupa", (document) => ({
      ...document,
      garment: {
        ...document.garment,
        ease: { bustMm: 80, waistMm: 60, hipMm: 80, sleeveMm: 50, ...(document.garment.ease ?? {}), [region]: valueMm },
      },
    }));
  },

  movePieceInWorkspace: (pieceId, xMm, yMm) => {
    const state = workspaceStateFor(get().garment, pieceId);
    if (state.locked) return;
    get().setPieceWorkspaceTransform(pieceId, { ...state.transform, xMm, yMm });
  },
  setPieceWorkspaceTransform: (pieceId, transform) => {
    if (workspaceStateFor(get().garment, pieceId).locked) return;
    const before = captureDocument(get);
    const garment = patchWorkspaceState(get().garment, pieceId, (state) => ({
      ...state,
      transform: { ...transform, pieceId, rotationDeg: normalizeRotation(transform.rotationDeg) },
    }));
    set({ garment });
    recordIfStandalone(set, get, "workspace", "Mover peça", before);
  },
  setPieceWorkspaceTransforms: (transforms) => {
    if (transforms.length === 0) return;
    const before = captureDocument(get);
    const locked = new Set((get().garment.workspaceStates ?? []).filter((state) => state.locked).map((state) => state.pieceId));
    let garment = get().garment;
    for (const transform of transforms) {
      if (locked.has(transform.pieceId)) continue;
      garment = patchWorkspaceState(garment, transform.pieceId, (state) => ({
        ...state,
        transform: { ...transform, rotationDeg: normalizeRotation(transform.rotationDeg) },
      }));
    }
    set({ garment });
    recordIfStandalone(set, get, "workspace", "Mover peças", before);
  },
  proposeSeam: (first, second) => set((state) => ({
    seamProposal: {
      first: { ...first },
      second: { ...second },
      compatibility: analyzeSeamCompatibility(state.garment, first, second),
    },
    seamIssues: [],
    seamFirstEdge: null,
  })),
  selectFirstSeamEdge: (seamFirstEdge) => set({ seamFirstEdge, seamProposal: null }),
  setNearbySeamSuggestion: (nearbySeamSuggestion) => set({ nearbySeamSuggestion }),
  cancelSeamProposal: () => set({ seamProposal: null, seamFirstEdge: null }),
  confirmSeamProposal: (options) => {
    const state = get();
    const proposal = state.seamProposal;
    if (!proposal) return;
    const seam: Seam = {
      id: createDocumentId("seam"),
      name: options.name.trim() || `Costura ${(state.garment.seams?.length ?? 0) + 1}`,
      first: { ...proposal.first },
      second: { ...proposal.second },
      direction: options.direction,
      treatment: options.treatment,
      type: options.treatment,
      easeRatio: proposal.compatibility.differencePercent / 100,
    };
    const issues = validateSeamForAssembly(seam, state.garment);
    if (issues.length > 0) {
      set({ seamIssues: issues });
      return;
    }
    changeDocument(set, get, "seam", "Confirmar costura", (document) => ({
      ...document,
      garment: { ...document.garment, seams: [...(document.garment.seams ?? []), seam] },
    }));
    set({ seamProposal: null, seamIssues: [], nearbySeamSuggestion: null });
  },
  setCutDraft: (cutDraft) => set({ cutDraft: cutDraft ? { ...cutDraft, phase: cutDraft.phase ?? "placing" } : null }),
  freezeCutDraft: () => set((state) => {
    if (!state.cutDraft) return {};
    const distance = Math.hypot(state.cutDraft.end.xMm - state.cutDraft.start.xMm, state.cutDraft.end.yMm - state.cutDraft.start.yMm);
    return { cutDraft: { ...state.cutDraft, phase: "ready", ...(distance < 4 ? { error: "Escolha dois pontos diferentes." } : {}) } };
  }),
  confirmCut: (keepJoined) => {
    const state = get(); const draft = state.cutDraft;
    if (draft?.phase !== "ready") return;
    const source = draft && state.garment.pieces.find((piece) => piece.id === draft.pieceId);
    if (!draft || !source) return;
    const split = createPatternPiecesFromSplit(source, extendCutLine(source, [draft.start, draft.end]));
    if (!split) { set({ cutDraft: { ...draft, phase: "ready", error: "O corte precisa atravessar o molde." } }); return; }
    const workspace = workspaceStateFor(state.garment, source.id);
    const workspaceStates = split.map((piece) => ({ ...workspace, pieceId: piece.id, transform: { ...workspace.transform, pieceId: piece.id } }));
    const cutSeam: Seam | null = keepJoined ? { id: createDocumentId("seam"), name: "Recorte unido", first: { pieceId: split[0].id, edgeId: makeLastEdgeId(split[0]), startT: 0, endT: 1 }, second: { pieceId: split[1].id, edgeId: makeLastEdgeId(split[1]), startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", treatment: "standard" } : null;
    changeDocument(set, get, "cut", keepJoined ? "Cortar e manter unidas" : "Cortar peça", (document) => ({ activePieceId: split[0].id, garment: syncLegacyTransforms({ ...document.garment, pieces: document.garment.pieces.flatMap((piece) => piece.id === source.id ? split : [piece]), seams: [...(document.garment.seams ?? []).filter((seam) => seam.first.pieceId !== source.id && seam.second.pieceId !== source.id), ...(cutSeam ? [cutSeam] : [])], workspaceStates: [...(document.garment.workspaceStates ?? []).filter((item) => item.pieceId !== source.id), ...workspaceStates] }) }), { cutDraft: null, selectedPieceIds: [split[0].id], pieceSelectionActive: true });
  },
  setDartDraft: (dartDraft) => set({ dartDraft: dartDraft ? { ...dartDraft, phase: dartDraft.phase ?? "placing" } : null }),
  freezeDartDraft: () => set((state) => state.dartDraft ? { dartDraft: { ...state.dartDraft, phase: "ready" } } : {}),
  confirmDart: () => {
    const draft = get().dartDraft; if (!draft) return;
    if (draft.phase !== "ready") return;
    const dart = createDart(draft.pieceId, draft.edgePoint, draft.apex);
    changeDocument(set, get, "dart", "Criar pence", (document) => ({ ...document, garment: { ...document.garment, pieces: document.garment.pieces.map((piece) => piece.id === draft.pieceId ? { ...piece, darts: [...(piece.darts ?? []), closeDart(dart)] } : piece) } }), { dartDraft: null, selectedDartId: dart.id });
  },
  selectDart: (selectedDartId) => set({ selectedDartId, selectedPointId: null, selectedEdgeId: null, selectedSeamId: null, pieceSelectionActive: false }),
  updateDart: (dartId, update) => changeDocument(
    set,
    get,
    "dart",
    "Editar pence",
    (document) => ({
      ...document,
      garment: {
        ...document.garment,
        pieces: document.garment.pieces.map((piece) => ({
          ...piece,
          darts: (piece.darts ?? []).map((dart) =>
            dart.id === dartId
              ? { ...updatePatternDart(dart, update), closed: dart.closed }
              : dart,
          ),
        })),
      },
    }),
    { selectedDartId: dartId },
  ),
  removeDart: (dartId) => changeDocument(set, get, "dart", "Excluir pence", (document) => ({ ...document, garment: { ...document.garment, pieces: document.garment.pieces.map((piece) => ({ ...piece, darts: (piece.darts ?? []).filter((dart) => dart.id !== dartId) })) } }), { selectedDartId: null }),
  invertDart: (dartId) => {
    const dart = get().garment.pieces.flatMap((piece) => piece.darts ?? []).find((candidate) => candidate.id === dartId); if (!dart) return;
    get().updateDart(dartId, { directionDeg: dart.directionDeg + 180 });
  },
  moveSelectedSegment: (dxMm, dyMm) => {
    const edgeId = get().selectedEdgeId; if (!edgeId) return;
    updateActivePieceDocument(set, get, "geometry", "Mover borda", (piece) => movePatternSegment(piece, edgeId, dxMm, dyMm));
  },
  convertSelectedSegment: (kind) => {
    const edgeId = get().selectedEdgeId; if (!edgeId) return;
    updateActivePieceDocument(set, get, "geometry", kind === "cubic" ? "Converter para curva" : "Converter para reta", (piece) => convertPatternSegment(piece, edgeId, kind));
  },
  splitSelectedSegment: () => {
    const state = get(); const edgeId = state.selectedEdgeId; if (!edgeId) return;
    const beforeIds = new Set(state.garment.pieces.find((piece) => piece.id === state.activePieceId)?.segments?.map((segment) => segment.id) ?? []);
    updateActivePieceDocument(set, get, "geometry", "Dividir borda", (piece) => splitPatternSegment(piece, edgeId));
    const replacement = get().garment.pieces.find((piece) => piece.id === get().activePieceId)?.segments?.find((segment) => !beforeIds.has(segment.id));
    set({ selectedEdgeId: replacement?.id ?? null });
  },
  setMeasureDraft: (measureDraft) => set({ measureDraft }),
  cancelIntent: () => set({ seamProposal: null, seamFirstEdge: null, nearbySeamSuggestion: null, seamIssues: [], cutDraft: null, dartDraft: null, measureDraft: null }),
  updateSeam: (seamId, update) => changeDocument(set, get, "seam", "Editar costura", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      seams: (document.garment.seams ?? []).map((seam) => seam.id === seamId
        ? { ...seam, ...update, ...(update.treatment ? { type: update.treatment } : {}) }
        : seam),
    },
  })),
  rotatePieceInWorkspace: (pieceId, deltaDeg) => {
    const state = workspaceStateFor(get().garment, pieceId);
    if (state.locked) return;
    get().setPieceWorkspaceTransform(pieceId, {
      ...state.transform,
      rotationDeg: state.transform.rotationDeg + deltaDeg,
    });
  },
  setPieceVisibility: (pieceId, visible) => changeDocument(set, get, "workspace", "Alterar visibilidade", (document) => ({
    ...document,
    garment: patchWorkspaceState(document.garment, pieceId, (state) => ({ ...state, visible })),
  })),
  setPieceLocked: (pieceId, locked) => changeDocument(set, get, "workspace", "Alterar bloqueio", (document) => ({
    ...document,
    garment: patchWorkspaceState(document.garment, pieceId, (state) => ({ ...state, locked })),
  })),

  duplicatePiece: (pieceId, mirrored = false) => {
    const source = get().garment.pieces.find((piece) => piece.id === pieceId);
    if (!source) return;
    const duplicate = duplicatePatternPiece(source, {
      mirrored,
      name: `${source.name} – ${mirrored ? "espelhada" : "cópia"}`,
    });
    const sourceWorkspace = workspaceStateFor(get().garment, source.id);
    const width = pieceWidth(source);
    const nextWorkspace: PieceWorkspaceState = {
      pieceId: duplicate.id,
      transform: {
        pieceId: duplicate.id,
        xMm: sourceWorkspace.transform.xMm + Math.max(140, width + 50),
        yMm: sourceWorkspace.transform.yMm + 30,
        rotationDeg: sourceWorkspace.transform.rotationDeg,
      },
      visible: true,
      locked: false,
    };
    changeDocument(set, get, "piece-duplicate", mirrored ? "Duplicar espelhado" : "Duplicar peça", (document) => ({
      activePieceId: duplicate.id,
      garment: syncLegacyTransforms({
        ...document.garment,
        pieces: [...document.garment.pieces, duplicate],
        workspaceStates: [...(document.garment.workspaceStates ?? []), nextWorkspace],
      }),
    }));
  },

  startDraft: (name) => set({
    draftContour: {
      id: createDocumentId("piece"),
      name: name.trim() || "Nova peça",
      points: [],
      closed: false,
    },
    draftCursor: null,
    draftError: null,
    selectedPointId: null,
    selectedEdgeId: null,
    pieceSelectionActive: false,
  }),
  addDraftPoint: (xMm, yMm) => set((state) => {
    if (!state.draftContour || state.draftContour.closed) return {};
    return {
      draftContour: {
        ...state.draftContour,
        points: [
          ...state.draftContour.points,
          { id: createDocumentId(`${state.draftContour.id}:point`), xMm, yMm },
        ],
      },
      draftError: null,
    };
  }),
  updateDraftCursor: (xMm, yMm) => set((state) =>
    state.draftContour
      ? { draftCursor: { id: "draft-cursor", xMm, yMm } }
      : {},
  ),
  removeDraftPoint: () => set((state) => {
    if (!state.draftContour) return {};
    return {
      draftContour: {
        ...state.draftContour,
        points: state.draftContour.points.slice(0, -1),
      },
      draftError: null,
    };
  }),
  closeDraft: () => {
    const draft = get().draftContour;
    if (!draft) return;
    if (draft.points.length < 3) {
      set({ draftError: "Adicione pelo menos três pontos antes de fechar." });
      return;
    }
    const issues = validatePatternContour(draft.points);
    if (issues.length > 0) {
      set({ draftError: issues[0] });
      return;
    }
    const minX = Math.min(...draft.points.map((point) => point.xMm));
    const minY = Math.min(...draft.points.map((point) => point.yMm));
    const localDraft: DraftContour = {
      ...draft,
      closed: true,
      points: draft.points.map((point) => ({ ...point, xMm: point.xMm - minX, yMm: point.yMm - minY })),
    };
    const piece = createPatternPieceFromDraft(localDraft);
    const workspace: PieceWorkspaceState = {
      pieceId: piece.id,
      transform: { pieceId: piece.id, xMm: minX, yMm: minY, rotationDeg: 0 },
      visible: true,
      locked: false,
    };
    changeDocument(set, get, "piece-create", "Criar peça", (document) => ({
      activePieceId: piece.id,
      garment: syncLegacyTransforms({
        ...document.garment,
        pieces: [...document.garment.pieces, piece],
        workspaceStates: [...(document.garment.workspaceStates ?? []), workspace],
      }),
    }), {
      draftContour: null,
      draftCursor: null,
      draftError: null,
      pieceSelectionActive: true,
    });
  },
  cancelDraft: () => set({ draftContour: null, draftCursor: null, draftError: null }),

  deletePiece: (pieceId) => {
    if (get().garment.pieces.length <= 1) return;
    changeDocument(set, get, "piece-delete", "Excluir peça", (document) => {
      const pieces = document.garment.pieces.filter((piece) => piece.id !== pieceId);
      const activePieceId = document.activePieceId === pieceId ? pieces[0].id : document.activePieceId;
      return {
        activePieceId,
        garment: syncLegacyTransforms({
          ...document.garment,
          pieces,
          seams: (document.garment.seams ?? []).filter(
            (seam) => seam.first.pieceId !== pieceId && seam.second.pieceId !== pieceId,
          ),
          workspaceStates: (document.garment.workspaceStates ?? []).filter((state) => state.pieceId !== pieceId),
        }),
      };
    }, { pieceSelectionActive: false });
  },
  renamePiece: (pieceId, name) => changeDocument(set, get, "piece-rename", "Renomear peça", (document) => ({
    ...document,
    garment: {
      ...document.garment,
      pieces: document.garment.pieces.map((piece) =>
        piece.id === pieceId ? { ...piece, name: name.trim() || piece.name } : piece,
      ),
    },
  })),
  resetPattern: () => {
    const original = get().baselinePieces.find((piece) => piece.id === get().activePieceId);
    if (!original) return;
    updateActivePieceDocument(set, get, "geometry", "Restaurar molde", () => structuredClone(original));
  },
  undo: () => {
    if (history.isTransactionActive) history.commit(captureDocument(get));
    const document = history.undo();
    if (document) applyDocumentState(set, get, document);
  },
  redo: () => {
    if (history.isTransactionActive) history.commit(captureDocument(get));
    const document = history.redo();
    if (document) applyDocumentState(set, get, document);
  },
  simulate: () => set((state) => ({ simulateVersion: state.simulateVersion + 1 })),
}));

type StoreSetter = (
  partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>),
) => void;
type StoreGetter = () => EditorState;

function captureDocument(get: StoreGetter): EditorDocumentState {
  const state = get();
  return { garment: structuredClone(state.garment), activePieceId: state.activePieceId };
}

function applyDocumentState(
  set: StoreSetter,
  get: StoreGetter,
  document: EditorDocumentState,
  additional: Partial<EditorState> = {},
): void {
  const garment = ensureWorkspaceState(document.garment);
  const piece = garment.pieces.find((candidate) => candidate.id === document.activePieceId) ?? garment.pieces[0];
  if (!piece) return;
  const snapshot = restoreSnapshot(piece);
  const selectedPieceIds = get().selectedPieceIds.filter((id) => garment.pieces.some((candidate) => candidate.id === id));
  set({
    garment: replacePiece(garment, snapshot.piece),
    activePieceId: piece.id,
    snapshot,
    selectedPointId: null,
    selectedEdgeId: null,
    selectedSeamId: null,
    seamIssues: collectSeamIssues(garment),
    seamProposal: null,
    seamFirstEdge: null,
    nearbySeamSuggestion: null,
    cutDraft: null,
    dartDraft: null,
    measureDraft: null,
    selectedPieceIds,
    pieceSelectionActive: selectedPieceIds.length > 0,
    selectedDartId: null,
    ...historyAvailability(),
    ...additional,
  });
  void get;
}

function changeDocument(
  set: StoreSetter,
  get: StoreGetter,
  type: DocumentCommandType,
  label: string,
  transform: (document: EditorDocumentState) => EditorDocumentState,
  additional: Partial<EditorState> = {},
): void {
  const before = captureDocument(get);
  const after = transform(structuredClone(before));
  history.record(type, label, before, after);
  applyDocumentState(set, get, after, additional);
}

function updateActivePieceDocument(
  set: StoreSetter,
  get: StoreGetter,
  type: DocumentCommandType,
  label: string,
  transform: (piece: PatternPiece) => PatternPiece,
): void {
  changeDocument(set, get, type, label, (document) => ({
    ...document,
    garment: replacePiece(
      document.garment,
      transform(document.garment.pieces.find((piece) => piece.id === document.activePieceId) ?? get().snapshot.piece),
    ),
  }));
}

function applyGeometrySnapshot(
  set: StoreSetter,
  get: StoreGetter,
  rawSnapshot: PatternSnapshot,
  additional: Partial<EditorState> = {},
): void {
  const source = get().garment.pieces.find((piece) => piece.id === get().activePieceId) ?? rawSnapshot.piece;
  const snapshot = preservePieceMetadata(rawSnapshot, source);
  set({
    garment: replacePiece(get().garment, snapshot.piece),
    snapshot,
    ...additional,
  });
}

function recordIfStandalone(
  set: StoreSetter,
  get: StoreGetter,
  type: DocumentCommandType,
  label: string,
  before: EditorDocumentState,
): void {
  if (!history.isTransactionActive) history.record(type, label, before, captureDocument(get));
  set(historyAvailability());
}

function restoreSnapshot(piece: PatternPiece): PatternSnapshot {
  return preservePieceMetadata(currentEngine().restorePiece(piece), piece);
}

function preservePieceMetadata(snapshot: PatternSnapshot, source: PatternPiece): PatternSnapshot {
  return { ...snapshot, piece: { ...structuredClone(source), ...snapshot.piece } };
}

function replacePiece(garment: GarmentDraft, piece: PatternPiece): GarmentDraft {
  return {
    ...garment,
    pieces: garment.pieces.map((candidate) =>
      candidate.id === piece.id ? structuredClone(piece) : candidate,
    ),
  };
}

function historyAvailability() {
  return { canUndo: history.canUndo, canRedo: history.canRedo };
}

function inferCommandType(label: string): DocumentCommandType {
  return label.toLowerCase().includes("peça") ? "workspace" : "geometry";
}

function workspaceStateFor(garment: GarmentDraft, pieceId: string): PieceWorkspaceState {
  return (
    garment.workspaceStates?.find((state) => state.pieceId === pieceId) ?? {
      pieceId,
      transform:
        garment.workspaceTransforms?.find((transform) => transform.pieceId === pieceId) ??
        { pieceId, xMm: 0, yMm: 0, rotationDeg: 0 },
      visible: true,
      locked: false,
    }
  );
}

function patchWorkspaceState(
  garment: GarmentDraft,
  pieceId: string,
  patch: (state: PieceWorkspaceState) => PieceWorkspaceState,
): GarmentDraft {
  const states = garment.pieces.map((piece) => {
    const current = workspaceStateFor(garment, piece.id);
    return piece.id === pieceId ? patch(current) : current;
  });
  return syncLegacyTransforms({ ...garment, workspaceStates: states });
}

function ensureWorkspaceState(garment: GarmentDraft): GarmentDraft {
  let cursorX = 0;
  const existing = new Map(garment.workspaceStates?.map((state) => [state.pieceId, state]));
  const legacy = new Map(garment.workspaceTransforms?.map((transform) => [transform.pieceId, transform]));
  const workspaceStates = garment.pieces.map((piece) => {
    const stored = existing.get(piece.id);
    if (stored) return structuredClone(stored);
    const transform = legacy.get(piece.id) ?? {
      pieceId: piece.id,
      xMm: cursorX,
      yMm: 0,
      rotationDeg: 0,
    };
    cursorX = Math.max(cursorX, transform.xMm + pieceWidth(piece) + 80);
    return { pieceId: piece.id, transform: { ...transform }, visible: true, locked: false };
  });
  return syncLegacyTransforms({ ...garment, workspaceStates });
}

function syncLegacyTransforms(garment: GarmentDraft): GarmentDraft {
  return {
    ...garment,
    workspaceTransforms: (garment.workspaceStates ?? []).map((state) => ({ ...state.transform })),
  };
}

function normalizeRotation(rotationDeg: number): number {
  const normalized = ((rotationDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function migrateLegacyDocument(garment: GarmentDraft): GarmentDraft {
  const withWorkspace = ensureWorkspaceState(garment);
  return {
    ...withWorkspace,
    pieces: withWorkspace.pieces.map((piece) => {
      if (piece.previewPlacements?.length) return piece;
      const name = piece.name.toLowerCase();
      const region = name.includes("saia") || name.includes("calça") ? "hip" : "torso";
      const surface = name.includes("costas") ? "back" : "front";
      return { ...piece, previewPlacements: [createPreviewPlacement(piece.id, { region, surface })] };
    }),
  };
}

function collectSeamIssues(garment: GarmentDraft): SeamValidationIssue[] {
  return (garment.seams ?? []).flatMap((seam) => validateSeamForAssembly(seam, garment));
}

function clonePieces(pieces: readonly PatternPiece[]): PatternPiece[] {
  return pieces.map((piece) => structuredClone(piece));
}

function pieceWidth(piece: PatternPiece): number {
  const xs = piece.points.map((point) => point.xMm);
  return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
}

function makeLastEdgeId(piece: PatternPiece): string {
  const end = piece.points.at(-1)!;
  const start = piece.points[0];
  return makeEdgeId(piece.id, end.id, start.id);
}

function createLegacyGarment(piece: PatternPiece): GarmentDraft {
  const fabric = createDefaultFabricSource();
  return {
    id: "legacy-skirt",
    templateId: "legacy-skirt",
    name: "Saia base",
    description: "Molde inicial preservado para compatibilidade.",
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
    fabrics: [fabric],
    pieces: [
      {
        ...structuredClone(piece),
        cutQuantity: 1,
        cutOnFold: true,
        fabricId: fabric.id,
        previewPlacements: [
          createPreviewPlacement(piece.id, { region: "hip", surface: "front" }),
          createPreviewPlacement(piece.id, { region: "hip", surface: "back" }),
        ],
      },
    ],
  };
}

function sanitizeFabricUpdate(candidate: FabricSource, fallback: FabricSource): FabricSource {
  return {
    ...candidate,
    name: candidate.name.trim() || fallback.name,
    color: /^#[0-9a-f]{6}$/i.test(candidate.color) ? candidate.color : fallback.color,
    widthMm: Number.isFinite(candidate.widthMm) && candidate.widthMm > 0 ? candidate.widthMm : fallback.widthMm,
    lengthMm: Number.isFinite(candidate.lengthMm) && candidate.lengthMm > 0 ? candidate.lengthMm : fallback.lengthMm,
    quantity: Number.isInteger(candidate.quantity) && candidate.quantity > 0 ? candidate.quantity : fallback.quantity,
  };
}
