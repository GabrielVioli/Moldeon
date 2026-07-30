import { memo } from "react";

interface ToolbarProps {
  onSimulate(): void;
  onReset(): void;
  onExportSvg(): void;
  onUndo(): void;
  onRedo(): void;
  onToggleCurve(): void;
  canUndo: boolean;
  canRedo: boolean;
  canEditCurve: boolean;
  curveActive: boolean;
}

export const Toolbar = memo(function Toolbar({
  onSimulate,
  onReset,
  onExportSvg,
  onUndo,
  onRedo,
  onToggleCurve,
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
          <span>Modelagem técnica</span>
        </div>
      </div>

      <nav className="tool-buttons" aria-label="Ferramentas">
        <button className="tool-button active" type="button">Selecionar</button>
        <button className="tool-button" type="button" disabled title="Próximo marco">Ponto</button>
        <button className="tool-button" type="button" disabled title="Próximo marco">Linha</button>
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
        <button className="secondary-button" type="button" onClick={onExportSvg}>Exportar SVG</button>
        <button className="secondary-button" type="button" onClick={onReset}>Restaurar</button>
        <button className="primary-button" type="button" onClick={onSimulate}>Vestir no 3D</button>
      </div>
    </header>
  );
});
