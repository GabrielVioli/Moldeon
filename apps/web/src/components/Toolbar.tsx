import { memo } from "react";
import type { EditorTool } from "../editor/PatternCanvas";
import type { WorkspaceMode } from "../domain/assembly";

interface ToolbarProps {
  garmentName: string;
  onOpenLibrary(): void;
  onPrepareLibrary(): void;
  onOpenFitting(): void;
  onPrepareFitting(): void;
  onSimulate(): void;
  canAssemble3D: boolean;
  workspaceMode: WorkspaceMode;
  canDressBody: boolean;
  onWorkspaceModeChange(mode: WorkspaceMode): void;
  onReset(): void;
  onExportSvg(): void;
  onUndo(): void;
  onRedo(): void;
  onToggleCurve(): void;
  activeTool: EditorTool;
  onSelectTool(tool: EditorTool): void;
  canUndo: boolean;
  canRedo: boolean;
  canEditCurve: boolean;
  curveActive: boolean;
}

export const Toolbar = memo(function Toolbar({
  garmentName,
  onOpenLibrary,
  onPrepareLibrary,
  onOpenFitting,
  onPrepareFitting,
  onSimulate,
  canAssemble3D,
  workspaceMode,
  canDressBody,
  onWorkspaceModeChange,
  onReset,
  onExportSvg,
  onUndo,
  onRedo,
  onToggleCurve,
  activeTool,
  onSelectTool,
  canUndo,
  canRedo,
  canEditCurve,
  curveActive,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">M</span>
        <div>
          <strong>Moldeon</strong>
          <span>{garmentName}</span>
        </div>
      </div>

      <nav className="workspace-mode-switch" aria-label="Modo do espaço de trabalho">
        <button type="button" className={workspaceMode === "modeling" ? "active" : ""} onClick={() => onWorkspaceModeChange("modeling")}>Modelagem</button>
        <button type="button" className={workspaceMode === "assembly" ? "active" : ""} onClick={() => onWorkspaceModeChange("assembly")}>Montagem</button>
        <button type="button" className={workspaceMode === "fitting" ? "active" : ""} disabled={!canDressBody} onClick={() => onWorkspaceModeChange("fitting")}>Prova</button>
      </nav>

      <nav className="tool-buttons" aria-label="Ferramentas">
        <button
          className={`tool-button${activeTool === "select" ? " active" : ""}`}
          type="button"
          onClick={() => onSelectTool("select")}
        >
          Selecionar
        </button>
        <button
          className={`tool-button${activeTool === "draft" ? " active" : ""}`}
          type="button"
          onClick={() => onSelectTool("draft")}
          aria-pressed={activeTool === "draft"}
          title="Desenhar uma nova peça"
        >
          Desenhar
        </button>
        <button className={`tool-button${activeTool === "cut" ? " active" : ""}`} type="button" onClick={() => onSelectTool("cut")} title="Trace uma linha atravessando a peça">Recortar</button>
        <button className={`tool-button${activeTool === "dart" ? " active" : ""}`} type="button" onClick={() => onSelectTool("dart")} title="Clique na borda e depois no ápice">Pence</button>
        <button
          className={`tool-button${activeTool === "seam" ? " active" : ""}`}
          type="button"
          onClick={() => onSelectTool("seam")}
          title="Ferramenta de costura: selecione duas arestas"
        >
          Costurar
        </button>
        <button className={`tool-button${activeTool === "measure" ? " active" : ""}`} type="button" onClick={() => onSelectTool("measure")} title="Clique em dois pontos">Medir</button>
      </nav>

      <div className="toolbar-actions">
        <button
          className="library-button"
          type="button"
          onFocus={onPrepareLibrary}
          onPointerEnter={onPrepareLibrary}
          onClick={onOpenLibrary}
        >
          Moldes
        </button>
        <button
          className="fitting-button"
          type="button"
          onFocus={onPrepareFitting}
          onPointerEnter={onPrepareFitting}
          onClick={onOpenFitting}
        >
          Corpo e tecido
        </button>
        <div
          className="history-actions"
          role="group"
          aria-label="Histórico de edição"
        >
          <button
            className="history-button"
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Desfazer"
            title="Desfazer (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            className="history-button"
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Refazer"
            title="Refazer (Ctrl+Shift+Z)"
          >
            ↷
          </button>
        </div>
        <button className="secondary-button" type="button" onClick={onExportSvg}>
          <span className="desktop-action-label">Exportar </span>SVG
        </button>
        <button
          className="secondary-button restore-button"
          type="button"
          onClick={onReset}
        >
          Restaurar
        </button>
        <button className="primary-button" type="button" disabled={!canAssemble3D} onClick={onSimulate}>Montar no 3D</button>
      </div>
    </header>
  );
});
