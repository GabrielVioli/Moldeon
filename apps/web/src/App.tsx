import { useEffect, useState } from "react";
import { initializeEngine } from "./core/engineRuntime";
import { PatternCanvas } from "./editor/PatternCanvas";
import { GarmentViewport } from "./viewport/GarmentViewport";
import { Inspector } from "./components/Inspector";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { exportPatternAsSvg } from "./export/svg";
import { loadAutosave, saveAutosave } from "./storage/opfs";
import { useEditorStore } from "./state/editorStore";

type WorkspaceView = "editor" | "preview" | "inspector";

export function App() {
  const snapshot = useEditorStore((state) => state.snapshot);
  const engineBackend = useEditorStore((state) => state.engineBackend);
  const selectedPointId = useEditorStore((state) => state.selectedPointId);
  const simulateVersion = useEditorStore((state) => state.simulateVersion);
  const setEngineSnapshot = useEditorStore((state) => state.setEngineSnapshot);
  const selectPoint = useEditorStore((state) => state.selectPoint);
  const movePoint = useEditorStore((state) => state.movePoint);
  const setSeamAllowance = useEditorStore((state) => state.setSeamAllowance);
  const resetPattern = useEditorStore((state) => state.resetPattern);
  const simulate = useEditorStore((state) => state.simulate);
  const [autosaveStatus, setAutosaveStatus] = useState("Autosave aguardando");
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [mobileView, setMobileView] = useState<WorkspaceView>("editor");

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

  return (
    <div className="app-shell">
      <Toolbar
        onSimulate={simulate}
        onReset={resetPattern}
        onExportSvg={() => exportPatternAsSvg(snapshot)}
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
            onSelect={() => setMobileView("preview")}
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
            onMovePoint={movePoint}
          />
        </section>

        <section
          className={`preview-panel workspace-view${mobileView === "preview" ? " is-mobile-active" : ""}`}
          id="preview-panel"
          aria-labelledby="preview-tab"
        >
          <GarmentViewport snapshot={snapshot} simulateVersion={simulateVersion} />
        </section>

        <Inspector
          id="inspector-panel"
          labelledBy="inspector-tab"
          mobileActive={mobileView === "inspector"}
          snapshot={snapshot}
          selectedPointId={selectedPointId}
          onMovePoint={movePoint}
          onSeamAllowanceChange={setSeamAllowance}
        />
      </main>

      <StatusBar backend={engineBackend} autosaveStatus={autosaveStatus} />
    </div>
  );
}

interface WorkspaceTabProps {
  id: string;
  panelId: string;
  active: boolean;
  onSelect(): void;
  children: string;
}

function WorkspaceTab({
  id,
  panelId,
  active,
  onSelect,
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
      onClick={onSelect}
    >
      {children}
    </button>
  );
}
