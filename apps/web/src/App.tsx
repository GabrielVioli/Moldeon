import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { initializeEngine } from "./core/engineRuntime";
import { createPatternSnapshot } from "./core/fallbackPatternEngine";
import { PatternCanvas } from "./editor/PatternCanvas";
import type { EditorTool } from "./editor/PatternCanvas";
import { Inspector } from "./components/Inspector";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { PiecesPanel } from "./components/PiecesPanel";
import { PreviewPlacementPanel } from "./components/PreviewPlacementPanel";
import { AssemblyPanel } from "./components/AssemblyPanel";
import { ContextBar } from "./components/ContextBar";
import { exportPatternAsSvg } from "./export/svg";
import { loadAutosave, saveAutosave } from "./storage/opfs";
import { useEditorStore } from "./state/editorStore";
import { createPreviewPlacement, type GarmentDraft, type PreviewRegion } from "./domain/pattern";
import { evaluateGarment3DEligibility, shouldLoadThreeViewport, type WorkspaceMode } from "./domain/assembly";

type WorkspaceView = "editor" | "preview" | "inspector";
type RenderBackend = "deferred" | "webgpu" | "webgl2";

const MOBILE_QUERY = "(max-width: 760px)";
const loadGarmentViewport = () => import("./viewport/GarmentViewport");
const loadPatternLibrary = () => import("./components/PatternLibraryDialog");
const loadFittingRoom = () => import("./components/FittingRoomDialog");
const LazyGarmentViewport = lazy(async () => {
  const module = await loadGarmentViewport();
  return { default: module.GarmentViewport };
});
const LazyPatternLibraryDialog = lazy(async () => {
  const module = await loadPatternLibrary();
  return { default: module.PatternLibraryDialog };
});
const LazyFittingRoomDialog = lazy(async () => {
  const module = await loadFittingRoom();
  return { default: module.FittingRoomDialog };
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
  const setActivePiecePlacements = useEditorStore((state) => state.setActivePiecePlacements);
  const rotatePieceInWorkspace = useEditorStore((state) => state.rotatePieceInWorkspace);
  const setPieceWorkspaceTransform = useEditorStore((state) => state.setPieceWorkspaceTransform);
  const deletePiece = useEditorStore((state) => state.deletePiece);
  const renamePiece = useEditorStore((state) => state.renamePiece);
  const resetPattern = useEditorStore((state) => state.resetPattern);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const simulate = useEditorStore((state) => state.simulate);
  const [autosaveStatus, setAutosaveStatus] = useState("Autosave aguardando");
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [mobileView, setMobileView] = useState<WorkspaceView>("editor");
  const [previewRequested, setPreviewRequested] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [fittingOpen, setFittingOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("modeling");
  const [renderBackend, setRenderBackend] =
    useState<RenderBackend>("deferred");
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const eligibility = useMemo(() => evaluateGarment3DEligibility(garment), [garment]);
  const showViewport = shouldLoadThreeViewport(eligibility, previewRequested, workspaceMode);
  const garmentSnapshots = useMemo(
    () => (showViewport ? garment.pieces.map(createPatternSnapshot) : []),
    [garment, showViewport],
  );
  const handleSimulate = useCallback(() => {
    setWorkspaceMode("assembly");
    setPreviewRequested(true);
    if (isMobile) setMobileView("preview");
    simulate();
  }, [isMobile, simulate]);
  const handleDressBody = useCallback(() => {
    setWorkspaceMode("fitting");
    setPreviewRequested(true);
    if (isMobile) setMobileView("preview");
  }, [isMobile]);
  const handleExportSvg = useCallback(() => {
    const currentGarment = useEditorStore.getState().garment;
    exportPatternAsSvg(currentGarment.pieces.map(createPatternSnapshot), currentGarment.name);
  }, []);
  const handleChooseTemplate = useCallback(
    (nextGarment: GarmentDraft) => {
      loadGarment(nextGarment);
      setActiveTool("select");
      setLibraryOpen(false);
      if (isMobile) setMobileView("editor");
    },
    [isMobile, loadGarment],
  );
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
    if (tool === "draft") handleCreateBlankPiece();
    else setActiveTool(tool);
  }, [cancelIntent, handleCreateBlankPiece]);
  const handleDuplicatePiece = useCallback(
    (pieceId: string, mirrored = false) => {
      duplicatePiece(pieceId, mirrored);
      setActiveTool("select");
    },
    [duplicatePiece],
  );
  const handlePieceDrop = useCallback((pieceId: string, region: PreviewRegion) => {
    selectPiece(pieceId);
    setActivePiecePlacements([createPreviewPlacement(pieceId, { region })]);
  }, [selectPiece, setActivePiecePlacements]);
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
  const selectedPointIndex = snapshot.piece.points.findIndex(
    (point) => point.id === selectedPointId,
  );
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
          } else {
            const nextSnapshot =
              autosave?.document.kind === "snapshot"
                ? engine.restorePiece(autosave.document.snapshot.piece)
                : engine.snapshot();
            setEngineSnapshot(nextSnapshot, engine.backend);
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
  }, [restoreGarment, setEngineSnapshot]);

  useEffect(() => {
    if (!persistenceReady) return;

    const timeout = window.setTimeout(() => {
      void saveAutosave(garment, activePieceId)
        .then((method) => setAutosaveStatus(`Salvo localmente · ${method}`))
        .catch((error: unknown) => {
          console.warn("Autosave falhou", error);
          setAutosaveStatus("Falha no autosave");
        });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [activePieceId, garment, persistenceReady]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isEditableTarget(event.target)) {
        if (useEditorStore.getState().draftContour) {
          cancelDraft();
        }
        setActiveTool("select");
        return;
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
  }, [activePieceId, cancelDraft, closeDraft, duplicatePiece, redo, removeDraftPoint, selectAllPieces, undo]);

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (
        isEditableTarget(event.target) ||
        useEditorStore.getState().draftContour !== null ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) {
        return;
      }
      const currentSelectedPointId =
        useEditorStore.getState().selectedPointId;
      const currentPieceId = useEditorStore.getState().activePieceId;
      event.preventDefault();
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
  }, [deletePiece, deleteSelectedPieces, removePoint]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isEditableTarget(event.target)) return;
      cancelIntent();
      setActiveTool("select");
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [cancelIntent]);

  useEffect(() => {
    if (activeTool === "draft" && draftContour === null) setActiveTool("select");
  }, [activeTool, draftContour]);

  return (
    <div className="app-shell">
      <Toolbar
        garmentName={garment.name}
        onOpenLibrary={() => setLibraryOpen(true)}
        onPrepareLibrary={() => {
          void loadPatternLibrary();
        }}
        onOpenFitting={() => setFittingOpen(true)}
        onPrepareFitting={() => {
          void loadFittingRoom();
        }}
        onSimulate={handleSimulate}
        canAssemble3D={eligibility.canPreviewGarment}
        workspaceMode={workspaceMode}
        canDressBody={eligibility.canDressBody}
        onWorkspaceModeChange={(mode) => mode === "fitting" ? handleDressBody() : setWorkspaceMode(mode)}
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

      <main className={`workspace mode-${workspaceMode}`}>
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
              if (eligibility.canPreviewGarment) void loadGarmentViewport();
            }}
            onSelect={() => {
              if (eligibility.canPreviewGarment) setPreviewRequested(true);
              setMobileView("preview");
            }}
          >
            Prévia 3D
          </WorkspaceTab>
          <WorkspaceTab
            id="inspector-tab"
            panelId="inspector-panel"
            active={mobileView === "inspector"}
            onSelect={() => setMobileView("inspector")}
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
              <strong>{snapshot.piece.name} · milímetros</strong>
            </div>
            <span className="hint desktop-hint">Shift + arrastar: mover tela · roda: zoom</span>
            <span className="hint mobile-hint">Arraste pontos · fundo move · pinça aproxima</span>
          </div>
          <div className="editor-body">
            <PiecesPanel
              pieces={garment.pieces}
              workspaceStates={garment.workspaceStates ?? []}
              activePieceId={activePieceId}
              selectedPieceIds={selectedPieceIds}
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
                  disabled={draftContour !== null}
                  onClick={() => setActiveTool(activeTool === "point" ? "select" : "point")}
                >
                  + Ponto
                </button>
                <button
                  type="button"
                  disabled={snapshot.piece.points.length <= 3 || selectedPoint === null}
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
              <ContextBar tool={activeTool} onDone={() => setActiveTool("select")} />
            </div>
          </div>
        </section>

        <section
          className={`preview-panel workspace-view${mobileView === "preview" ? " is-mobile-active" : ""}`}
          id="preview-panel"
          aria-labelledby="preview-tab"
        >
          {showViewport ? (
            <Suspense fallback={<ViewportPlaceholder loading />}>
              <LazyGarmentViewport
                garment={garment}
                snapshots={garmentSnapshots}
                simulateVersion={simulateVersion}
                active={!isMobile || mobileView === "preview"}
                onBackendChange={setRenderBackend}
                onPieceDrop={handlePieceDrop}
                showBody={workspaceMode === "fitting"}
                connectedPieceIds={eligibility.connectedPieceIds}
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
        /> : workspaceMode === "fitting" ? <PreviewPlacementPanel /> : <Inspector
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
        />}
      </main>

      <StatusBar
        backend={engineBackend}
        renderBackend={renderBackend}
        autosaveStatus={autosaveStatus}
      />

      {libraryOpen ? (
        <Suspense fallback={<DialogPlaceholder />}>
          <LazyPatternLibraryDialog
            onClose={() => setLibraryOpen(false)}
            onChoose={handleChooseTemplate}
          />
        </Suspense>
      ) : null}

      {fittingOpen ? (
        <Suspense fallback={<DialogPlaceholder label="Abrindo sala de prova" />}>
          <LazyFittingRoomDialog
            onClose={() => setFittingOpen(false)}
            onPreview={() => {
              setFittingOpen(false);
              handleSimulate();
            }}
          />
        </Suspense>
      ) : null}
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

function ViewportPlaceholder({ loading = false }: { loading?: boolean }) {
  return (
    <div className="viewport-placeholder" role="status">
      {loading ? <span className="viewport-spinner" aria-hidden="true" /> : null}
      <strong>{loading ? "Preparando prévia 3D" : "Montagem 3D ainda indisponível"}</strong>
      <span>{loading ? "O editor 2D continua leve enquanto o 3D carrega." : "Conecte duas peças válidas por uma costura e solicite a montagem."}</span>
    </div>
  );
}

function DialogPlaceholder({
  label = "Carregando moldes essenciais",
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
