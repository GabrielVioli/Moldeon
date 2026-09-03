import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { initializeEngine } from "./core/engineRuntime";
import { createPatternSnapshot } from "./core/fallbackPatternEngine";
import { PatternCanvas } from "./editor/PatternCanvas";
import type { EditorTool } from "./editor/PatternCanvas";
import { clearEditorSelection } from "./editor/editorCoreSelection";
import { Inspector } from "./components/Inspector";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { PiecesPanel } from "./components/PiecesPanel";
import { PreviewPlacementPanel } from "./components/PreviewPlacementPanel";
import { AssemblyPanel } from "./components/AssemblyPanel";
import { ContextBar } from "./components/ContextBar";
import { DressingPreflightDialog } from "./components/DressingPreflightDialog";
import { exportPatternAsSvg } from "./export/svg";
import { loadAutosave, saveAutosave } from "./storage/opfs";
import { useEditorStore } from "./state/editorStore";
import { useInternalPathEditorStore } from "./state/internalPathEditorStore";
import { evaluateDressingPreflight, evaluateGarment3DEligibility, shouldLoadThreeViewport, type WorkspaceMode } from "./domain/assembly";
import { canAddGuidedSleeve } from "./domain/sleeveSystem";
import { createBlankGarment } from "./domain/blankGarment";
import { buildResolvedAssemblyInput, updateResolvedAssemblyArrangements, type ResolvedAssemblyInput } from "./garment3d/ResolvedAssemblyInput";
import type { ArrangementCommit } from "./viewport/ArrangementWorkspace";

type WorkspaceView = "editor" | "preview" | "inspector";
type RenderBackend = "deferred" | "webgpu" | "webgl2";

const MOBILE_QUERY = "(max-width: 760px)";
const COMPACT_WORKSPACE_QUERY = "(max-width: 1180px)";
const loadGarmentViewport = () => import("./viewport/GarmentViewport");
const loadFittingRoom = () => import("./components/FittingRoomDialog");
const loadSleeveWizard = () => import("./components/SleeveWizardDialog");
const LazyGarmentViewport = lazy(async () => {
  const module = await loadGarmentViewport();
  return { default: module.GarmentViewport };
});
const LazyFittingRoomDialog = lazy(async () => {
  const module = await loadFittingRoom();
  return { default: module.FittingRoomDialog };
});
const LazySleeveWizardDialog = lazy(async () => {
  const module = await loadSleeveWizard();
  return { default: module.SleeveWizardDialog };
});

export function App() {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const snapshot = useEditorStore((state) => state.snapshot);
  const engineBackend = useEditorStore((state) => state.engineBackend);
  const selectedPointId = useEditorStore((state) => state.selectedPointId);
  const simulateVersion = useEditorStore((state) => state.simulateVersion);
  const selectedPieceIds = useEditorStore((state) => state.selectedPieceIds);
  const togglePieceSelection = useEditorStore((state) => state.togglePieceSelection);
  const selectAllPieces = useEditorStore((state) => state.selectAllPieces);
  const deleteSelectedPieces = useEditorStore((state) => state.deleteSelectedPieces);
  const cancelIntent = useEditorStore((state) => state.cancelIntent);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const setEngineSnapshot = useEditorStore((state) => state.setEngineSnapshot);
  const restoreGarment = useEditorStore((state) => state.restoreGarment);
  const loadGarment = useEditorStore((state) => state.loadGarment);
  const selectPiece = useEditorStore((state) => state.selectPiece);
  const selectPoint = useEditorStore((state) => state.selectPoint);
  const beginEdit = useEditorStore((state) => state.beginEdit);
  const commitEdit = useEditorStore((state) => state.commitEdit);
  const cancelEdit = useEditorStore((state) => state.cancelEdit);
  const movePoint = useEditorStore((state) => state.movePoint);
  const moveHandle = useEditorStore((state) => state.moveHandle);
  const setSegmentCurve = useEditorStore((state) => state.setSegmentCurve);
  const insertPoint = useEditorStore((state) => state.insertPoint);
  const removePoint = useEditorStore((state) => state.removePoint);
  const setSeamAllowance = useEditorStore((state) => state.setSeamAllowance);
  const duplicatePiece = useEditorStore((state) => state.duplicatePiece);
  const startDraft = useEditorStore((state) => state.startDraft);
  const closeDraft = useEditorStore((state) => state.closeDraft);
  const cancelDraft = useEditorStore((state) => state.cancelDraft);
  const removeDraftPoint = useEditorStore((state) => state.removeDraftPoint);
  const draftContour = useEditorStore((state) => state.draftContour);
  const draftError = useEditorStore((state) => state.draftError);
  const setPieceVisibility = useEditorStore((state) => state.setPieceVisibility);
  const setPieceLocked = useEditorStore((state) => state.setPieceLocked);
  const rotatePieceInWorkspace = useEditorStore((state) => state.rotatePieceInWorkspace);
  const setPieceWorkspaceTransform = useEditorStore((state) => state.setPieceWorkspaceTransform);
  const deletePiece = useEditorStore((state) => state.deletePiece);
  const renamePiece = useEditorStore((state) => state.renamePiece);
  const resetPattern = useEditorStore((state) => state.resetPattern);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const simulate = useEditorStore((state) => state.simulate);
  const setGarmentDressing = useEditorStore((state) => state.setGarmentDressing);
  const addGuidedSleeve = useEditorStore((state) => state.addGuidedSleeve);
  const setPanelInstanceArrangements = useEditorStore((state) => state.setPanelInstanceArrangements);
  const [autosaveStatus, setAutosaveStatus] = useState("Autosave aguardando");
  const autosaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveRevisionRef = useRef(0);
  const arrangementInteractionActiveRef = useRef(false);
  const pendingArrangementInputRef = useRef<ResolvedAssemblyInput | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [mobileView, setMobileView] = useState<WorkspaceView>("editor");
  const [previewRequested, setPreviewRequested] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [fittingOpen, setFittingOpen] = useState(false);
  const [sleeveWizardOpen, setSleeveWizardOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("modeling");
  const [dressingPreflightOpen, setDressingPreflightOpen] = useState(false);
  const [renderBackend, setRenderBackend] =
    useState<RenderBackend>("deferred");
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isCompactWorkspace = useMediaQuery(COMPACT_WORKSPACE_QUERY);
  const eligibility = useMemo(() => evaluateGarment3DEligibility(garment), [garment]);
  const dressingPreflight = useMemo(() => evaluateDressingPreflight(garment), [garment]);
  const canAddSleeve = useMemo(() => canAddGuidedSleeve(garment.pieces), [garment.pieces]);
  const showViewport = shouldLoadThreeViewport(eligibility, previewRequested, workspaceMode);
  const assemblyInput = useMemo(() => {
    const pending = pendingArrangementInputRef.current;
    if (pending) {
      pendingArrangementInputRef.current = null;
      return pending;
    }
    return buildResolvedAssemblyInput(garment);
  }, [garment]);
  const handleArrangementCommit = useCallback((commits: ArrangementCommit[]) => {
    const updates = commits.flatMap((commit) => {
      const instance = assemblyInput.panelInstances.find((candidate) => candidate.id === commit.instanceId);
      if (!instance) return [];
      const existing = instance.arrangementAnchor;
      return [{
        pieceId: instance.sourcePatternId,
        copyIndex: instance.copyIndex,
        placement: {
          id: instance.id,
          pieceId: instance.sourcePatternId,
          region: existing?.region ?? "custom" as const,
          surface: existing?.surface ?? "custom" as const,
          bodySide: existing?.bodySide ?? "center" as const,
          ...(existing?.bodyAnchorId ? { bodyAnchorId: existing.bodyAnchorId } : {}),
          rotationDeg: commit.orientationDeg[2],
          offsetXMm: existing?.offsetXMm ?? 0,
          offsetYMm: existing?.offsetYMm ?? 0,
          offsetZMm: existing?.offsetZMm ?? 12,
          scale: 1,
          mirrorX: instance.mirrored,
          positionMm: commit.positionMm,
          orientationDeg: commit.orientationDeg,
          ...(commit.surfaceAttachment ? { surfaceAttachment: commit.surfaceAttachment } : {}),
          presentationMode: "authored" as const,
        },
      }];
    });
    if (updates.length === 0) return;
    pendingArrangementInputRef.current = updateResolvedAssemblyArrangements(
      assemblyInput,
      commits.map((commit) => ({
        instanceId: commit.instanceId,
        positionMm: [...commit.positionMm],
        orientationDeg: [...commit.orientationDeg],
        ...(commit.surfaceAttachment ? { surfaceAttachment: commit.surfaceAttachment } : {}),
      })),
    );
    setPanelInstanceArrangements(updates);
  }, [assemblyInput, setPanelInstanceArrangements]);
  const handleArrangementInteractionChange = useCallback((active: boolean) => {
    arrangementInteractionActiveRef.current = active;
  }, []);
  const openDressedViewport = useCallback((mode: "assembly" | "fitting") => {
    setWorkspaceMode(mode);
    setPreviewRequested(true);
    setIsRightPanelOpen(true);
    if (isCompactWorkspace) setMobileView("preview");
    simulate();
  }, [isCompactWorkspace, simulate]);
  const handleSimulate = useCallback(() => {
    if (!dressingPreflight.canDress) {
      setDressingPreflightOpen(true);
      return;
    }
    openDressedViewport("assembly");
  }, [dressingPreflight.canDress, openDressedViewport]);
  const handleDressBody = useCallback(() => {
    if (!dressingPreflight.canDress) {
      setDressingPreflightOpen(true);
      return;
    }
    openDressedViewport("fitting");
  }, [dressingPreflight.canDress, openDressedViewport]);
  const handleWorkspaceModeChange = useCallback((mode: WorkspaceMode) => {
    if (mode === "fitting") {
      if (!dressingPreflight.canDress) {
        setDressingPreflightOpen(true);
        return;
      }
      if (previewRequested) {
        setWorkspaceMode("fitting");
        setIsRightPanelOpen(true);
        if (isCompactWorkspace) setMobileView("preview");
        return;
      }
      handleDressBody();
      return;
    }
    setWorkspaceMode(mode);
    if (mode === "assembly") {
      setPreviewRequested(true);
      setIsRightPanelOpen(true);
      if (isCompactWorkspace) setMobileView("preview");
      return;
    }
    if (isCompactWorkspace) setMobileView("editor");
  }, [dressingPreflight.canDress, handleDressBody, isCompactWorkspace, previewRequested]);
  useEffect(() => {
    if (!dressingPreflightOpen || !dressingPreflight.canDress) return;
    setDressingPreflightOpen(false);
    openDressedViewport("fitting");
  }, [dressingPreflight.canDress, dressingPreflightOpen, openDressedViewport]);
  const closeRightPanel = useCallback(() => {
    setIsRightPanelOpen(false);
    setPreviewRequested(false);
    if (isCompactWorkspace) setMobileView("editor");
  }, [isCompactWorkspace]);
  const openRightPanel = useCallback((view: WorkspaceView = "preview") => {
    setIsRightPanelOpen(true);
    if (view === "preview" && eligibility.canOpenViewport) setPreviewRequested(true);
    if (isCompactWorkspace) setMobileView(view);
  }, [eligibility.canOpenViewport, isCompactWorkspace]);
  const handleExportSvg = useCallback(() => {
    const currentGarment = useEditorStore.getState().garment;
    exportPatternAsSvg(currentGarment.pieces.map(createPatternSnapshot), currentGarment.name);
  }, []);
  const handleConfirmSleeve = useCallback((options: Parameters<typeof addGuidedSleeve>[0]) => {
    const result = addGuidedSleeve(options);
    if (!result.accepted) {
      window.alert(result.message ?? "Não foi possível criar a manga.");
      return;
    }
    setSleeveWizardOpen(false);
    setActiveTool("select");
    setWorkspaceMode("modeling");
    if (isCompactWorkspace) setMobileView("editor");
  }, [addGuidedSleeve, isCompactWorkspace]);
  const handleInsertPoint = useCallback(
    (startPointId: string, t: number) => {
      insertPoint(startPointId, t);
      setActiveTool("select");
    },
    [insertPoint],
  );
  const handleCreateBlankPiece = useCallback(() => {
    const name = window.prompt("Nome da peça", "Nova peça");
    if (name === null) return;
    startDraft(name.trim() || "Nova peça");
    setActiveTool("draft");
  }, [startDraft]);
  const handleSelectTool = useCallback((tool: EditorTool) => {
    cancelIntent();
    const pathState = useInternalPathEditorStore.getState();
    if (pathState.draftPathId) pathState.cancelDraft();
    else if (pathState.selectedPathId) pathState.selectPath(null);
    if (tool !== "select") clearEditorSelection({ preservePieces: tool === "cut" });
    if (tool === "draft") handleCreateBlankPiece();
    else {
      setActiveTool(tool);
      if (tool === "seam") {
        if (isCompactWorkspace) {
          setWorkspaceMode("modeling");
          setMobileView("editor");
        } else {
          setWorkspaceMode("assembly");
          setIsRightPanelOpen(true);
        }
      }
    }
  }, [cancelIntent, handleCreateBlankPiece, isCompactWorkspace]);
  const handleDuplicatePiece = useCallback(
    (pieceId: string, mirrored = false) => {
      duplicatePiece(pieceId, mirrored);
      setActiveTool("select");
    },
    [duplicatePiece],
  );
  const handleRotatePiece = useCallback((pieceId: string, action: "left" | "right" | "reset") => {
    if (action === "left") rotatePieceInWorkspace(pieceId, -90);
    else if (action === "right") rotatePieceInWorkspace(pieceId, 90);
    else {
      const workspace = useEditorStore.getState().garment.workspaceStates?.find((state) => state.pieceId === pieceId);
      if (workspace) setPieceWorkspaceTransform(pieceId, { ...workspace.transform, rotationDeg: 0 });
    }
  }, [rotatePieceInWorkspace, setPieceWorkspaceTransform]);
  const handleRenamePiece = useCallback(
    (pieceId: string) => {
      const current = garment.pieces.find((piece) => piece.id === pieceId);
      if (!current) return;
      const nextName = window.prompt("Novo nome da peça", current.name);
      if (nextName === null) return;
      renamePiece(pieceId, nextName.trim() || current.name);
    },
    [garment.pieces, renamePiece],
  );
  const handleDeletePiece = useCallback(
    (pieceId: string) => {
      const piece = garment.pieces.find((candidate) => candidate.id === pieceId);
      if (!piece) return;
      const confirmed = window.confirm(`Excluir “${piece.name}”?`);
      if (!confirmed) return;
      deletePiece(pieceId);
    },
    [deletePiece, garment.pieces],
  );
  const hasPieces = garment.pieces.length > 0;
  const selectedPointIndex = hasPieces
    ? snapshot.piece.points.findIndex((point) => point.id === selectedPointId)
    : -1;
  const selectedPoint =
    selectedPointIndex >= 0 ? snapshot.piece.points[selectedPointIndex] : null;
  const nextPoint =
    selectedPointIndex >= 0
      ? snapshot.piece.points[
          (selectedPointIndex + 1) % snapshot.piece.points.length
        ]
      : null;
  const selectedCurveActive =
    selectedPoint !== null &&
    nextPoint !== null &&
    (selectedPoint.handleOut !== undefined || nextPoint.handleIn !== undefined);
  const handleToggleCurve = useCallback(() => {
    const currentSelectedPointId =
      useEditorStore.getState().selectedPointId;
    if (!currentSelectedPointId) return;

    const currentPoints = useEditorStore.getState().snapshot.piece.points;
    const currentIndex = currentPoints.findIndex(
      (point) => point.id === currentSelectedPointId,
    );
    if (currentIndex < 0) return;
    const current = currentPoints[currentIndex];
    const next = currentPoints[(currentIndex + 1) % currentPoints.length];
    setSegmentCurve(
      currentSelectedPointId,
      !(current.handleOut || next.handleIn),
    );
  }, [setSegmentCurve]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const engine = await initializeEngine();
        const autosave = await loadAutosave();

        if (active) {
          if (autosave?.document.kind === "garment") {
            restoreGarment(
              autosave.document.garment,
              autosave.document.activePieceId,
              engine.backend,
            );
          } else if (autosave?.document.kind === "snapshot") {
            const nextSnapshot =
              engine.restorePiece(autosave.document.snapshot.piece);
            setEngineSnapshot(nextSnapshot, engine.backend);
          } else {
            loadGarment(createBlankGarment());
          }
          if (autosave) setAutosaveStatus(`Restaurado · ${autosave.method}`);
        }
      } catch (error) {
        console.error("Falha ao inicializar o editor.", error);
        if (active) setAutosaveStatus("Falha ao inicializar");
      } finally {
        if (active) setPersistenceReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadGarment, restoreGarment, setEngineSnapshot]);

  useEffect(() => {
    if (!persistenceReady) return;
    const revision = autosaveRevisionRef.current + 1;
    autosaveRevisionRef.current = revision;
    let timeout = 0;
    let cancelled = false;

    const persistWhenIdle = () => {
      if (cancelled || autosaveRevisionRef.current !== revision) return;
      if (arrangementInteractionActiveRef.current) {
        timeout = window.setTimeout(persistWhenIdle, 350);
        return;
      }
      setAutosaveStatus("Salvando alterações…");
      const request = autosaveQueueRef.current.then(async () => {
        if (arrangementInteractionActiveRef.current) {
          timeout = window.setTimeout(persistWhenIdle, 350);
          return;
        }
        const current = useEditorStore.getState();
        const method = await saveAutosave(current.garment, current.activePieceId);
        if (autosaveRevisionRef.current === revision) {
          setAutosaveStatus(`Salvo localmente · ${method}`);
        }
      });
      autosaveQueueRef.current = request.catch((error: unknown) => {
        console.warn("Autosave falhou", error);
        if (autosaveRevisionRef.current === revision) setAutosaveStatus("Falha no autosave");
      });
    };

    // Arrangement commits are intentionally coalesced so serialization cannot
    // land between two consecutive manipulation gestures.
    timeout = window.setTimeout(persistWhenIdle, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activePieceId, garment, persistenceReady]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!persistenceReady) return;
      if (event.key === "Escape" && !isEditableTarget(event.target)) {
        event.preventDefault();
        const pathState = useInternalPathEditorStore.getState();
        const state = useEditorStore.getState();
        if (pathState.draftPathId) pathState.cancelDraft();
        else if (state.draftContour) cancelDraft();
        else {
          state.cancelEdit();
          state.cancelIntent();
        }
        clearEditorSelection();
        setActiveTool("select");
        return;
      }
      if (!isEditableTarget(event.target) && useInternalPathEditorStore.getState().draftPathId) {
        const pathState = useInternalPathEditorStore.getState();
        if (event.key === "Enter") {
          event.preventDefault();
          if (pathState.confirmDraft()) setActiveTool("select");
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          pathState.removeLastDraftPoint();
          return;
        }
      }
      if (!isEditableTarget(event.target) && useEditorStore.getState().draftContour) {
        if (event.key === "Enter") {
          event.preventDefault();
          closeDraft();
          if (!useEditorStore.getState().draftContour) setActiveTool("select");
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          removeDraftPoint();
          return;
        }
      }
      if (event.key === "Enter" && !isEditableTarget(event.target)) {
        const state = useEditorStore.getState();
        if (state.seamDraft) {
          event.preventDefault();
          if (state.seamDraft.activeSide === "first") state.finishSeamDraftSide();
          else state.reviewSeamDraft();
          return;
        }
        if (state.seamProposal) {
          event.preventDefault();
          state.confirmSeamProposal({ name: "Costura", direction: state.seamProposal.compatibility.recommendedDirection, treatment: state.seamProposal.compatibility.recommendedTreatment });
          setActiveTool("select");
          return;
        }
        if (state.cutDraft?.phase === "ready") {
          event.preventDefault();
          state.confirmCut(false);
          if (!useEditorStore.getState().cutDraft) setActiveTool("select");
          return;
        }
        if (state.dartDraft?.phase === "ready") {
          event.preventDefault();
          state.confirmDart();
          setActiveTool("select");
          return;
        }
      }
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        selectAllPieces();
      } else if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      } else if ((event.ctrlKey || event.metaKey) && key === "d") {
        event.preventDefault();
        if (activePieceId) {
          duplicatePiece(activePieceId, event.shiftKey);
        }
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activePieceId, cancelDraft, closeDraft, duplicatePiece, persistenceReady, redo, removeDraftPoint, selectAllPieces, undo]);

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (!persistenceReady) return;
      if (
        isEditableTarget(event.target) ||
        useEditorStore.getState().draftContour !== null ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) {
        return;
      }
      const currentState = useEditorStore.getState();
      const currentSelectedPointId = currentState.selectedPointId;
      const currentPieceId = currentState.activePieceId;
      event.preventDefault();
      if (currentState.selectedSeamId) {
        currentState.removeSeam(currentState.selectedSeamId);
        return;
      }
      if (currentSelectedPointId) {
        removePoint(currentSelectedPointId);
        return;
      }
      if (useEditorStore.getState().selectedPieceIds.length > 1) {
        deleteSelectedPieces();
        return;
      }
      if (currentPieceId && useEditorStore.getState().pieceSelectionActive) {
        const piece = useEditorStore.getState().garment.pieces.find((candidate) => candidate.id === currentPieceId);
        if (piece) {
          const confirmed = window.confirm(`Excluir “${piece.name}”?`);
          if (confirmed) deletePiece(currentPieceId);
        }
      }
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [deletePiece, deleteSelectedPieces, persistenceReady, removePoint]);

  useEffect(() => {
    if (activeTool === "draft" && draftContour === null) setActiveTool("select");
  }, [activeTool, draftContour]);

  return (
    <div className="app-shell" aria-busy={!persistenceReady}>
      <Toolbar
        garmentName={garment.name}
        onOpenSleeveWizard={() => setSleeveWizardOpen(true)}
        onPrepareSleeveWizard={() => {
          if (canAddSleeve) void loadSleeveWizard();
        }}
        canAddSleeve={canAddSleeve}
        onOpenFitting={() => setFittingOpen(true)}
        onPrepareFitting={() => {
          void loadFittingRoom();
        }}
        onSimulate={handleDressBody}
        canAssemble3D={eligibility.canPreviewGarment}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={handleWorkspaceModeChange}
        onReset={resetPattern}
        onExportSvg={handleExportSvg}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        canEditCurve={selectedPoint !== null}
        curveActive={selectedCurveActive}
        onToggleCurve={handleToggleCurve}
        activeTool={activeTool}
        onSelectTool={handleSelectTool}
      />

      <main className={`workspace mode-${workspaceMode}${isRightPanelOpen ? "" : " is-right-panel-closed"}`}>
        <nav className="mobile-workspace-tabs" aria-label="Painéis do projeto" role="tablist">
          <WorkspaceTab
            id="editor-tab"
            panelId="editor-panel"
            active={mobileView === "editor"}
            onSelect={() => setMobileView("editor")}
          >
            Molde 2D
          </WorkspaceTab>
          <WorkspaceTab
            id="preview-tab"
            panelId="preview-panel"
            active={mobileView === "preview"}
            onPrepare={() => {
              if (eligibility.canOpenViewport) void loadGarmentViewport();
            }}
            onSelect={() => {
              if (eligibility.canOpenViewport) setPreviewRequested(true);
              openRightPanel("preview");
            }}
          >
            Manequim 3D
          </WorkspaceTab>
          <WorkspaceTab
            id="inspector-tab"
            panelId="inspector-panel"
            active={mobileView === "inspector"}
            onSelect={() => openRightPanel("inspector")}
          >
            {workspaceMode === "assembly" ? "Montagem" : "Medidas"}
          </WorkspaceTab>
        </nav>

        <section
          className={`editor-panel workspace-view${mobileView === "editor" ? " is-mobile-active" : ""}`}
          id="editor-panel"
          aria-labelledby="editor-tab"
        >
          <div className="panel-titlebar">
            <div>
              <span className="section-eyebrow">Molde 2D</span>
              <strong>{hasPieces ? `${snapshot.piece.name} · milímetros` : "Bancada vazia · milímetros"}</strong>
            </div>
            <div className="panel-title-actions">
              <span className="hint desktop-hint">Fundo: pan · Shift + arrastar: selecionar · roda/trackpad: navegar</span>
              <span className="hint mobile-hint">Arraste pontos · fundo move · pinça aproxima</span>
              <button
                type="button"
                className="right-panel-toggle"
                aria-expanded={isRightPanelOpen}
                aria-controls="workspace-right-panel"
                title={isRightPanelOpen ? "Recolher painel direito" : "Mostrar painel direito"}
                onClick={() => isRightPanelOpen ? closeRightPanel() : openRightPanel("preview")}
              >
                <span aria-hidden="true">{isRightPanelOpen ? "›" : "‹"}</span>
                <span>{isRightPanelOpen ? "Recolher painel" : "Mostrar painel"}</span>
              </button>
            </div>
          </div>
          <div className="editor-body">
            <PiecesPanel
              pieces={garment.pieces}
              workspaceStates={garment.workspaceStates ?? []}
              activePieceId={activePieceId}
              selectedPieceIds={selectedPieceIds}
              dismissKey={activeTool + ":" + mobileView + ":" + workspaceMode}
              onSelect={selectPiece}
              onToggleSelect={togglePieceSelection}
              onCreate={handleCreateBlankPiece}
              onVisibilityChange={setPieceVisibility}
              onLockChange={setPieceLocked}
              onDuplicate={handleDuplicatePiece}
              onDuplicateMirrored={(pieceId) => handleDuplicatePiece(pieceId, true)}
              onRename={handleRenamePiece}
              onDelete={handleDeletePiece}
              onRotate={handleRotatePiece}
            />
            <div className="canvas-stack">
              <div className="point-actions" role="group" aria-label="Editar pontos">
                <button
                  type="button"
                  className={activeTool === "point" ? "active" : ""}
                  disabled={!hasPieces || draftContour !== null}
                  onClick={() => setActiveTool(activeTool === "point" ? "select" : "point")}
                >
                  + Ponto
                </button>
                <button
                  type="button"
                  disabled={!hasPieces || snapshot.piece.points.length <= 3 || selectedPoint === null}
                  onClick={() => selectedPoint && removePoint(selectedPoint.id)}
                >
                  − Ponto
                </button>
              </div>
              {draftContour ? (
                <div className="draft-banner">
                  Desenhando <strong>{draftContour.name}</strong> · clique no primeiro ponto ou Enter para fechar · Escape cancela
                </div>
              ) : null}
              {draftError ? <div className="draft-error" role="alert">{draftError}</div> : null}
              <PatternCanvas
                snapshot={snapshot}
                tool={activeTool}
                selectedPointId={selectedPointId}
                onSelectPoint={selectPoint}
                onEditStart={beginEdit}
                onEditEnd={commitEdit}
                onMovePoint={movePoint}
                onMoveHandle={moveHandle}
                onInsertPoint={handleInsertPoint}
                onToolChange={setActiveTool}
              />
              {!hasPieces && draftContour === null ? (
                <div className="empty-workspace" role="status">
                  <strong>A bancada está vazia</strong>
                  <span>Desenhe a primeira peça diretamente nesta bancada.</span>
                  <div>
                    <button type="button" onClick={handleCreateBlankPiece}>Desenhar primeira peça</button>
                  </div>
                </div>
              ) : null}
              <ContextBar tool={activeTool} onDone={() => setActiveTool("select")} />
            </div>
          </div>
        </section>

        <div id="workspace-right-panel" className="workspace-right-panel" hidden={!isRightPanelOpen} aria-hidden={!isRightPanelOpen}>
        <section
          className={`preview-panel workspace-view${mobileView === "preview" ? " is-mobile-active" : ""}`}
          id="preview-panel"
          aria-labelledby="preview-tab"
        >
          <button
            type="button"
            className="right-panel-close"
            aria-expanded={isRightPanelOpen}
            aria-controls="workspace-right-panel"
            title={isCompactWorkspace ? "Voltar à bancada 2D" : "Recolher painel direito"}
            onClick={closeRightPanel}
          >
            <span aria-hidden="true">×</span>
            <span>{isCompactWorkspace ? "Voltar à bancada" : "Recolher"}</span>
          </button>
          {showViewport ? (
            <Suspense fallback={<ViewportPlaceholder loading />}>
              <LazyGarmentViewport
                assemblyInput={assemblyInput}
                simulateVersion={simulateVersion}
                active={isRightPanelOpen && (!isCompactWorkspace || mobileView === "preview")}
                displayMode={workspaceMode === "fitting" ? "full-fitting" : "side-preview"}
                onBackendChange={setRenderBackend}
                onArrangementCommit={handleArrangementCommit}
                onArrangementInteractionChange={handleArrangementInteractionChange}
                sewingActive={activeTool === "seam"}
              />
            </Suspense>
          ) : (
            <ViewportPlaceholder />
          )}
        </section>

        {workspaceMode === "assembly" ? <AssemblyPanel
          previewRequested={previewRequested}
          mobileActive={mobileView === "inspector"}
          onRequestPreview={handleSimulate}
          onDressBody={handleDressBody}
        /> : workspaceMode === "fitting" ? (
          <details className="fitting-summary-drawer">
            <summary>Detalhes da prova</summary>
            <PreviewPlacementPanel
              onChangeRegion={() => {
                setGarmentDressing({ region: undefined });
                setDressingPreflightOpen(true);
              }}
              onBackToAssembly={() => {
                setWorkspaceMode("assembly");
                if (isCompactWorkspace) setMobileView("editor");
              }}
            />
          </details>
        ) : hasPieces ? <Inspector
          id="inspector-panel"
          labelledBy="inspector-tab"
          mobileActive={mobileView === "inspector"}
          snapshot={snapshot}
          selectedPointId={selectedPointId}
          onEditStart={beginEdit}
          onEditEnd={commitEdit}
          onEditCancel={cancelEdit}
          onMovePoint={movePoint}
          curveActive={selectedCurveActive}
          onToggleCurve={handleToggleCurve}
          onSeamAllowanceChange={setSeamAllowance}
        /> : <EmptyInspector mobileActive={mobileView === "inspector"} />}
        </div>
      </main>

      <StatusBar
        backend={engineBackend}
        renderBackend={renderBackend}
        autosaveStatus={autosaveStatus}
      />

      {sleeveWizardOpen ? (
        <Suspense fallback={<DialogPlaceholder label="Preparando assistente de manga" />}>
          <LazySleeveWizardDialog
            garment={garment}
            onClose={() => setSleeveWizardOpen(false)}
            onConfirm={handleConfirmSleeve}
          />
        </Suspense>
      ) : null}

      {fittingOpen ? (
        <Suspense fallback={<DialogPlaceholder label="Abrindo sala de prova" />}>
          <LazyFittingRoomDialog
            onClose={() => setFittingOpen(false)}
            onPreview={() => {
              setFittingOpen(false);
              handleDressBody();
            }}
          />
        </Suspense>
      ) : null}

      {dressingPreflightOpen ? (
        <DressingPreflightDialog
          garment={garment}
          preflight={dressingPreflight}
          onChooseRegion={(region) => setGarmentDressing({ region })}
          onChooseFront={(frontReferencePieceId) => setGarmentDressing({ frontReferencePieceId })}
          onFixSeams={() => {
            setDressingPreflightOpen(false);
            setWorkspaceMode("assembly");
            setIsRightPanelOpen(true);
            if ((garment.seams?.length ?? 0) === 0) setActiveTool("seam");
            if (isCompactWorkspace) setMobileView("editor");
          }}
          onClose={() => setDressingPreflightOpen(false)}
        />
      ) : null}

      {!persistenceReady ? <DialogPlaceholder label="Preparando sua bancada" /> : null}
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

interface WorkspaceTabProps {
  id: string;
  panelId: string;
  active: boolean;
  onSelect(): void;
  onPrepare?(): void;
  children: string;
}

function WorkspaceTab({
  id,
  panelId,
  active,
  onSelect,
  onPrepare,
  children,
}: WorkspaceTabProps) {
  return (
    <button
      className="workspace-tab"
      id={id}
      type="button"
      role="tab"
      aria-controls={panelId}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onFocus={onPrepare}
      onPointerEnter={onPrepare}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function EmptyInspector({ mobileActive }: { mobileActive: boolean }) {
  return (
    <aside
      className={`inspector empty-inspector workspace-view${mobileActive ? " is-mobile-active" : ""}`}
      id="inspector-panel"
      aria-labelledby="inspector-tab"
    >
      <span className="section-eyebrow">Propriedades</span>
      <strong>Nenhuma peça selecionada</strong>
      <p>Desenhe a primeira peça para começar.</p>
    </aside>
  );
}

function ViewportPlaceholder({ loading = false }: { loading?: boolean }) {
  return (
    <div className="viewport-placeholder" role="status">
      {loading ? <span className="viewport-spinner" aria-hidden="true" /> : null}
      <strong>{loading ? "Preparando manequim vestido" : "Manequim 3D ainda indisponível"}</strong>
      <span>{loading ? "O editor 2D continua leve enquanto avatar e roupa são preparados." : "Crie ao menos uma peça triangulável e solicite a prova no manequim."}</span>
    </div>
  );
}

function DialogPlaceholder({
  label = "Carregando",
}: {
  label?: string;
}) {
  return (
    <div className="dialog-backdrop" role="status">
      <div className="dialog-loading">
        <span className="viewport-spinner" aria-hidden="true" />
        <strong>{label}</strong>
      </div>
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
}
