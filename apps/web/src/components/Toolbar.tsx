import { memo } from "react";
import type { EditorTool } from "../editor/PatternCanvas";
import type { WorkspaceMode } from "../domain/assembly";
import { useEditorStore } from "../state/editorStore";

interface ToolbarProps {
  garmentName: string;
  onOpenSleeveWizard(): void;
  onPrepareSleeveWizard(): void;
  canAddSleeve: boolean;
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
  onOpenSleeveWizard,
  onPrepareSleeveWizard,
  canAddSleeve,
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
  const activateTool = (tool: EditorTool) => {
    const before = useEditorStore.getState();
    const modelingTargetId = before.activePieceId
      && before.garment.pieces.some((piece) => piece.id === before.activePieceId)
      ? before.activePieceId
      : "";

    onSelectTool(tool);

    // 9.5-04 deliberately clears activePieceId when visual selection is cleared.
    // Modeling tools, however, need to retain the piece that was explicitly
    // chosen immediately before tool activation. Restore only that document
    // context, never selectedPieceIds/pieceSelectionActive. A new free piece
    // draft owns its own target and therefore does not use this bridge.
    if (tool !== "select" && tool !== "draft" && modelingTargetId) {
      const current = useEditorStore.getState();
      if (current.garment.pieces.some((piece) => piece.id === modelingTargetId)) {
        useEditorStore.setState({ activePieceId: modelingTargetId });
      }
    }
  };

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
          onClick={() => activateTool("select")}
        >
          Selecionar
        </button>
        <button
          className={`tool-button seam-tool${activeTool === "seam" ? " active" : ""}${workspaceMode === "assembly" ? " is-essential" : ""}`}
          type="button"
          onClick={() => activateTool("seam")}
          aria-pressed={activeTool === "seam"}
          title="Costurar: clique em uma borda de cada peça"
        >
          Costurar
        </button>
        <button
          className={`tool-button${activeTool === "draft" ? " active" : ""}`}
          type="button"
          onClick={() => activateTool("draft")}
          aria-pressed={activeTool === "draft"}
          title="Desenhar uma nova peça"
        >
          Desenhar
        </button>
        <button className={`tool-button${activeTool === "cut" ? " active" : ""}`} type="button" onClick={() => activateTool("cut")} title="Comece no contorno, crie os nós internos e termine no contorno; não é preciso ultrapassar a borda">Recortar</button>
        <button className={`tool-button${activeTool === "dart" ? " active" : ""}`} type="button" onClick={() => activateTool("dart")} title="Clique na borda e depois no ápice">Pence</button>
        <button className={`tool-button${activeTool === "measure" ? " active" : ""}`} type="button" onClick={() => activateTool("measure")} title="Clique em dois pontos">Medir</button>
      </nav>

      <div className="toolbar-actions">
        <button
          className="sleeve-button"
          type="button"
          disabled={!canAddSleeve}
          onFocus={onPrepareSleeveWizard}
          onPointerEnter={onPrepareSleeveWizard}
          onClick={onOpenSleeveWizard}
          title={canAddSleeve ? "Gerar manga a partir das cavas" : "Adicione frente e costas com cavas semânticas"}
          data-testid="open-sleeve-wizard"
        >
          Adicionar manga
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
        <button className="primary-button" type="button" disabled={!canAssemble3D} onClick={onSimulate}>Vestir no manequim</button>
      </div>
    </header>
  );
});
