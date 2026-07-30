import { memo } from "react";
import type { EditorTool } from "../editor/PatternCanvas";

interface ToolbarProps {
  garmentName: string;
  onOpenLibrary(): void;
  onPrepareLibrary(): void;
  onOpenFitting(): void;
  onPrepareFitting(): void;
  onSimulate(): void;
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

      <nav className="tool-buttons" aria-label="Ferramentas">
        <button
          className={`tool-button${activeTool === "select" ? " active" : ""}`}
          type="button"
          onClick={() => onSelectTool("select")}
        >
          Selecionar
        </button>
        <button
          className={`tool-button${activeTool === "point" ? " active" : ""}`}
          type="button"
          onClick={() => onSelectTool("point")}
          aria-pressed={activeTool === "point"}
          title="Clique ou toque perto do contorno"
        >
          + Ponto
        </button>
        <button
          className={`tool-button${curveActive ? " active" : ""}`}
          type="button"
          disabled={!canEditCurve}
          onClick={onToggleCurve}
          aria-pressed={curveActive}
          title={
            canEditCurve
              ? "Alternar o segmento seguinte entre linha e curva"
              : "Selecione um ponto primeiro"
          }
        >
          Curva
        </button>
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
        <button className="primary-button" type="button" onClick={onSimulate}>Vestir no 3D</button>
      </div>
    </header>
  );
});
