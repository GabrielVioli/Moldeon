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

type PrimaryTool = "draft" | "select" | "cut" | "dart" | "seam" | "measure";

const PRIMARY_TOOLS: readonly {
  tool: PrimaryTool;
  label: string;
  title: string;
  icon: "draw" | "edit" | "cut" | "dart" | "seam" | "measure";
}[] = [
  { tool: "draft", label: "Desenhar", title: "Desenhar uma nova peça", icon: "draw" },
  { tool: "select", label: "Editar", title: "Editar ou selecionar", icon: "edit" },
  { tool: "cut", label: "Recortar", title: "Recortar a peça", icon: "cut" },
  { tool: "dart", label: "Pence", title: "Criar uma pence", icon: "dart" },
  { tool: "seam", label: "Costurar", title: "Costurar bordas entre peças", icon: "seam" },
  { tool: "measure", label: "Medir", title: "Medir entre dois pontos", icon: "measure" },
];

export const Toolbar = memo(function Toolbar({
  garmentName,
  onOpenFitting,
  onPrepareFitting,
  onSimulate,
  canAssemble3D,
  workspaceMode,
  onWorkspaceModeChange,
  onReset,
  onExportSvg,
  onUndo,
  onRedo,
  activeTool,
  onSelectTool,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const activateTool = (tool: EditorTool) => {
    // Costurar is a modal authoring tool. Clicking it again is the explicit
    // exit path on desktop and touch, so users never need to enter another
    // modeling tool just to leave sewing mode.
    if (tool === "seam" && activeTool === "seam") {
      onSelectTool("select");
      return;
    }

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

  const closeOverflow = (target: HTMLElement) => {
    target.closest("details")?.removeAttribute("open");
  };

  return (
    <header className="toolbar" data-testid="workspace-toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">M</span>
        <div className="brand-copy">
          <strong>Moldeon</strong>
          <span title={garmentName}>{garmentName}</span>
        </div>
      </div>

      <nav className="workspace-mode-switch" aria-label="Modo do espaço de trabalho">
        <button type="button" className={workspaceMode === "modeling" ? "active" : ""} onClick={() => onWorkspaceModeChange("modeling")}>Modelar</button>
        <button type="button" className={workspaceMode === "assembly" ? "active" : ""} onClick={() => onWorkspaceModeChange("assembly")}>Montar</button>
        <button type="button" className={workspaceMode === "fitting" ? "active" : ""} onClick={() => onWorkspaceModeChange("fitting")}>Prova</button>
      </nav>

      <nav className="tool-buttons" aria-label="Ferramentas principais" data-testid="primary-tools">
        {PRIMARY_TOOLS.map(({ tool, label, title, icon }) => {
          const active = activeTool === tool;
          const seamExit = tool === "seam" && active;
          const visibleLabel = seamExit ? "Sair" : label;
          const accessibleLabel = seamExit ? "Sair do modo Costurar" : label;
          const effectiveTitle = seamExit ? "Sair do modo Costurar" : title;
          return (
            <button
              key={tool}
              className={`tool-button${active ? " active" : ""}${tool === "seam" && workspaceMode === "assembly" ? " seam-tool is-essential" : tool === "seam" ? " seam-tool" : ""}`}
              type="button"
              onClick={() => activateTool(tool)}
              aria-pressed={active}
              aria-label={accessibleLabel}
              title={effectiveTitle}
              data-testid={`primary-tool-${tool}`}
            >
              <ToolGlyph name={icon} />
              <span className="tool-label">{visibleLabel}</span>
            </button>
          );
        })}
      </nav>

      <div className="toolbar-actions">
        <div className="history-actions" role="group" aria-label="Histórico de edição">
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

        <button
          className="primary-button toolbar-preview-button"
          type="button"
          disabled={!canAssemble3D}
          onClick={onSimulate}
          title="Abrir prova 3D"
        >
          <span className="preview-button-compact" aria-hidden="true">3D</span>
          <span className="preview-button-label">Provar</span>
        </button>

        <details className="toolbar-overflow">
          <summary aria-label="Mais ações" title="Mais ações">•••</summary>
          <div className="toolbar-overflow-menu" role="menu">
            <button
              className="fitting-button"
              type="button"
              role="menuitem"
              onFocus={onPrepareFitting}
              onPointerEnter={onPrepareFitting}
              onClick={(event) => {
                closeOverflow(event.currentTarget);
                onOpenFitting();
              }}
            >
              Corpo e posição
            </button>
            <button
              className="secondary-button"
              type="button"
              role="menuitem"
              onClick={(event) => {
                closeOverflow(event.currentTarget);
                onExportSvg();
              }}
            >
              Exportar SVG
            </button>
            <button
              className="secondary-button restore-button"
              type="button"
              role="menuitem"
              onClick={(event) => {
                closeOverflow(event.currentTarget);
                onReset();
              }}
            >
              Restaurar projeto
            </button>
          </div>
        </details>
      </div>
    </header>
  );
});

function ToolGlyph({
  name,
}: {
  name: "draw" | "edit" | "cut" | "dart" | "seam" | "measure";
}) {
  if (name === "draw") {
    return <svg className="tool-glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5 5.2 12 13.8 3.4l2.8 2.8L8 14.8 4 15.5Z"/><path d="m12.7 4.5 2.8 2.8"/></svg>;
  }
  if (name === "edit") {
    return <svg className="tool-glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5 15.5 10 10 11.5 8 17 5 3.5Z"/></svg>;
  }
  if (name === "cut") {
    return <svg className="tool-glyph" viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="6" r="2.2"/><circle cx="5" cy="14" r="2.2"/><path d="m7 7 8 6M7 13l8-6"/></svg>;
  }
  if (name === "dart") {
    return <svg className="tool-glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15 10 4l7 11M3 15h14M10 4v11"/></svg>;
  }
  if (name === "seam") {
    return <svg className="tool-glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h4l2 3 2-3h6M3 13h4l2-3 2 3h6"/></svg>;
  }
  return <svg className="tool-glyph" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 13 13 3l4 4L7 17 3 13Z"/><path d="m10 6 2 2m-5 1 2 2m-5 1 2 2"/></svg>;
}
