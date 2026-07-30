import { memo } from "react";

interface ToolbarProps {
  onSimulate(): void;
  onReset(): void;
  onExportSvg(): void;
}

export const Toolbar = memo(function Toolbar({
  onSimulate,
  onReset,
  onExportSvg,
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
        <button className="tool-button" type="button" disabled title="Próximo marco">Curva</button>
      </nav>

      <div className="toolbar-actions">
        <button className="secondary-button" type="button" onClick={onExportSvg}>Exportar SVG</button>
        <button className="secondary-button" type="button" onClick={onReset}>Restaurar</button>
        <button className="primary-button" type="button" onClick={onSimulate}>Vestir no 3D</button>
      </div>
    </header>
  );
});
