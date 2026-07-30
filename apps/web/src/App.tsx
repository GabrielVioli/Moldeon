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
import { exportPatternAsSvg } from "./export/svg";
import { loadAutosave, saveAutosave } from "./storage/opfs";
import { useEditorStore } from "./state/editorStore";
import type { GarmentDraft, PatternPiece } from "./domain/pattern";

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
  const [renderBackend, setRenderBackend] =
    useState<RenderBackend>("deferred");
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const showViewport =
    !isMobile || previewRequested || mobileView === "preview";
  const garmentSnapshots = useMemo(
    () => (showViewport ? garment.pieces.map(createPatternSnapshot) : []),
    [garment, showViewport],
  );
  const handleSimulate = useCallback(() => {
    setPreviewRequested(true);
    if (isMobile) setMobileView("preview");
    simulate();
  }, [isMobile, simulate]);
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
        setActiveTool("select");
        return;
      }
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [redo, undo]);

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (
        isEditableTarget(event.target) ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) {
        return;
      }
      const currentSelectedPointId =
        useEditorStore.getState().selectedPointId;
      if (!currentSelectedPointId) return;
      event.preventDefault();
      removePoint(currentSelectedPointId);
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [removePoint]);

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
        onSelectTool={setActiveTool}
      />

      <main className="workspace">
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
              setPreviewRequested(true);
              void loadGarmentViewport();
            }}
            onSelect={() => {
              setPreviewRequested(true);
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
            Medidas
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
          <PieceStrip
            pieces={garment.pieces}
            activePieceId={activePieceId}
            onSelect={selectPiece}
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            canRemovePoint={snapshot.piece.points.length > 3 && selectedPoint !== null}
            onRemovePoint={() => {
              if (selectedPoint) removePoint(selectedPoint.id);
            }}
          />
          <PatternCanvas
            key={`${garment.id}:${activePieceId}`}
            snapshot={snapshot}
            tool={activeTool}
            selectedPointId={selectedPointId}
            onSelectPoint={selectPoint}
            onEditStart={beginEdit}
            onEditEnd={commitEdit}
            onMovePoint={movePoint}
            onMoveHandle={moveHandle}
            onInsertPoint={handleInsertPoint}
          />
        </section>

        <section
          className={`preview-panel workspace-view${mobileView === "preview" ? " is-mobile-active" : ""}`}
          id="preview-panel"
          aria-labelledby="preview-tab"
        >
          {showViewport ? (
            <Suspense fallback={<ViewportPlaceholder />}>
              <LazyGarmentViewport
                garment={garment}
                snapshots={garmentSnapshots}
                simulateVersion={simulateVersion}
                active={!isMobile || mobileView === "preview"}
                onBackendChange={setRenderBackend}
              />
            </Suspense>
          ) : (
            <ViewportPlaceholder />
          )}
        </section>

        <Inspector
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
        />
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

interface PieceStripProps {
  pieces: PatternPiece[];
  activePieceId: string;
  onSelect(pieceId: string): void;
  activeTool: EditorTool;
  onSelectTool(tool: EditorTool): void;
  canRemovePoint: boolean;
  onRemovePoint(): void;
}

function PieceStrip({
  pieces,
  activePieceId,
  onSelect,
  activeTool,
  onSelectTool,
  canRemovePoint,
  onRemovePoint,
}: PieceStripProps) {
  return (
    <div className="piece-tools-row">
      <nav className="piece-strip" aria-label="Peças do molde">
        {pieces.map((piece) => (
          <button
            key={piece.id}
            type="button"
            aria-pressed={piece.id === activePieceId}
            onClick={() => onSelect(piece.id)}
          >
            <span>{piece.name}</span>
            <small>
              {piece.cutQuantity ? `${piece.cutQuantity}×` : "1×"}
              {piece.cutOnFold ? " · dobra" : ""}
            </small>
          </button>
        ))}
      </nav>
      <div className="point-actions" role="group" aria-label="Editar pontos">
        <button
          className={activeTool === "point" ? "active" : ""}
          type="button"
          onClick={() =>
            onSelectTool(activeTool === "point" ? "select" : "point")
          }
          aria-pressed={activeTool === "point"}
        >
          + Ponto
        </button>
        <button
          type="button"
          disabled={!canRemovePoint}
          onClick={onRemovePoint}
        >
          Excluir
        </button>
      </div>
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

function ViewportPlaceholder() {
  return (
    <div className="viewport-placeholder" role="status">
      <span className="viewport-spinner" aria-hidden="true" />
      <strong>Preparando prévia 3D</strong>
      <span>O editor 2D continua leve enquanto o 3D carrega.</span>
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
