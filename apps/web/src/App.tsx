import { useEffect, useState } from "react";
import { initializeEngine } from "./core/engineRuntime";
import { PatternCanvas } from "./editor/PatternCanvas";
import { GarmentViewport } from "./viewport/GarmentViewport";
import { Inspector } from "./components/Inspector";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { exportPatternAsSvg } from "./export/svg";
import { saveAutosave } from "./storage/opfs";
import { useEditorStore } from "./state/editorStore";

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

  useEffect(() => {
    let active = true;

    void initializeEngine().then((engine) => {
      if (active) setEngineSnapshot(engine.snapshot(), engine.backend);
    });

    return () => {
      active = false;
    };
  }, [setEngineSnapshot]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void saveAutosave(snapshot)
        .then((method) => setAutosaveStatus(`Salvo localmente · ${method}`))
        .catch((error: unknown) => {
          console.warn("Autosave falhou", error);
          setAutosaveStatus("Falha no autosave");
        });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [snapshot]);

  return (
    <div className="app-shell">
      <Toolbar
        onSimulate={simulate}
        onReset={resetPattern}
        onExportSvg={() => exportPatternAsSvg(snapshot)}
      />

      <main className="workspace">
        <section className="editor-panel">
          <div className="panel-titlebar">
            <div>
              <span className="section-eyebrow">Molde 2D</span>
              <strong>Frente · milímetros</strong>
            </div>
            <span className="hint">Shift + arrastar: mover tela · roda: zoom</span>
          </div>
          <PatternCanvas
            snapshot={snapshot}
            selectedPointId={selectedPointId}
            onSelectPoint={selectPoint}
            onMovePoint={movePoint}
          />
        </section>

        <section className="preview-panel">
          <GarmentViewport snapshot={snapshot} simulateVersion={simulateVersion} />
        </section>

        <Inspector
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
