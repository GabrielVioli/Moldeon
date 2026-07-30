import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { initializeEngine } from "./core/engineRuntime";
import { PatternCanvas } from "./editor/PatternCanvas";
import { Inspector } from "./components/Inspector";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { exportPatternAsSvg } from "./export/svg";
import { loadAutosave, saveAutosave } from "./storage/opfs";
import { useEditorStore } from "./state/editorStore";

type WorkspaceView = "editor" | "preview" | "inspector";
type RenderBackend = "deferred" | "webgpu" | "webgl2";

const MOBILE_QUERY = "(max-width: 760px)";
const loadGarmentViewport = () => import("./viewport/GarmentViewport");
const LazyGarmentViewport = lazy(async () => {
  const module = await loadGarmentViewport();
  return { default: module.GarmentViewport };
});

export function App() {
  const snapshot = useEditorStore((state) => state.snapshot);
  const engineBackend = useEditorStore((state) => state.engineBackend);
  const selectedPointId = useEditorStore((state) => state.selectedPointId);
  const simulateVersion = useEditorStore((state) => state.simulateVersion);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const setEngineSnapshot = useEditorStore((state) => state.setEngineSnapshot);
  const selectPoint = useEditorStore((state) => state.selectPoint);
  const beginEdit = useEditorStore((state) => state.beginEdit);
  const commitEdit = useEditorStore((state) => state.commitEdit);
  const cancelEdit = useEditorStore((state) => state.cancelEdit);
  const movePoint = useEditorStore((state) => state.movePoint);
  const moveHandle = useEditorStore((state) => state.moveHandle);
  const setSegmentCurve = useEditorStore((state) => state.setSegmentCurve);
  const setSeamAllowance = useEditorStore((state) => state.setSeamAllowance);
  const resetPattern = useEditorStore((state) => state.resetPattern);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const simulate = useEditorStore((state) => state.simulate);
  const [autosaveStatus, setAutosaveStatus] = useState("Autosave aguardando");
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [mobileView, setMobileView] = useState<WorkspaceView>("editor");
  const [previewRequested, setPreviewRequested] = useState(false);
  const [renderBackend, setRenderBackend] =
    useState<RenderBackend>("deferred");
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const showViewport =
    !isMobile || previewRequested || mobileView === "preview";
  const handleSimulate = useCallback(() => {
    setPreviewRequested(true);
    if (isMobile) setMobileView("preview");
    simulate();
  }, [isMobile, simulate]);
  const handleExportSvg = useCallback(() => {
    exportPatternAsSvg(useEditorStore.getState().snapshot);
  }, []);
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
        const nextSnapshot = autosave
          ? engine.restorePiece(autosave.snapshot.piece)
          : engine.snapshot();

        if (active) {
          setEngineSnapshot(nextSnapshot, engine.backend);
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
  }, [setEngineSnapshot]);

  useEffect(() => {
    if (!persistenceReady) return;

    const timeout = window.setTimeout(() => {
      void saveAutosave(snapshot)
        .then((method) => setAutosaveStatus(`Salvo localmente · ${method}`))
        .catch((error: unknown) => {
          console.warn("Autosave falhou", error);
          setAutosaveStatus("Falha no autosave");
        });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [persistenceReady, snapshot]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
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

  return (
    <div className="app-shell">
      <Toolbar
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
              <strong>Frente · milímetros</strong>
            </div>
            <span className="hint desktop-hint">Shift + arrastar: mover tela · roda: zoom</span>
            <span className="hint mobile-hint">Arraste pontos · fundo move · pinça aproxima</span>
          </div>
          <PatternCanvas
            snapshot={snapshot}
            selectedPointId={selectedPointId}
            onSelectPoint={selectPoint}
            onEditStart={beginEdit}
            onEditEnd={commitEdit}
            onMovePoint={movePoint}
            onMoveHandle={moveHandle}
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
                snapshot={snapshot}
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
