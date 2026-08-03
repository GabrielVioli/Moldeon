import { memo } from "react";
import type { PatternPiece, PieceWorkspaceState } from "../domain/pattern";

interface PiecesPanelProps {
  pieces: PatternPiece[];
  workspaceStates: PieceWorkspaceState[];
  activePieceId: string;
  onSelect(pieceId: string): void;
  onCreate(): void;
  onVisibilityChange(pieceId: string, visible: boolean): void;
  onLockChange(pieceId: string, locked: boolean): void;
  onDuplicate(pieceId: string): void;
  onDuplicateMirrored(pieceId: string): void;
  onRename(pieceId: string): void;
  onDelete(pieceId: string): void;
  onRotate(pieceId: string, action: "left" | "right" | "reset"): void;
}

export const PiecesPanel = memo(function PiecesPanel({
  pieces,
  workspaceStates,
  activePieceId,
  onSelect,
  onCreate,
  onVisibilityChange,
  onLockChange,
  onDuplicate,
  onDuplicateMirrored,
  onRename,
  onDelete,
  onRotate,
}: PiecesPanelProps) {
  return (
    <aside className="pieces-panel" aria-label="Peças">
      <header>
        <strong>PEÇAS</strong>
        <button type="button" onClick={onCreate} aria-label="Criar nova peça">
          +
        </button>
      </header>
      <div className="pieces-list">
        {pieces.map((piece) => {
          const workspace = workspaceStates.find((state) => state.pieceId === piece.id) ?? {
            pieceId: piece.id,
            transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
            visible: true,
            locked: false,
          };
          return (
            <article
              key={piece.id}
              className={`pieces-item${piece.id === activePieceId ? " is-active" : ""}`}
              draggable={workspace.visible}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-moldeon-piece", piece.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <button
                type="button"
                className="pieces-visibility"
                aria-label={workspace.visible ? `Ocultar ${piece.name}` : `Mostrar ${piece.name}`}
                aria-pressed={workspace.visible}
                onClick={() => onVisibilityChange(piece.id, !workspace.visible)}
              >
                {workspace.visible ? "◉" : "○"}
              </button>
              <button
                type="button"
                className="pieces-name"
                aria-pressed={piece.id === activePieceId}
                onClick={() => onSelect(piece.id)}
              >
                <span>{piece.name}</span>
                <small>{piece.cutQuantity ?? 1}×{piece.cutOnFold ? " · dobra" : ""}</small>
              </button>
              <button
                type="button"
                className="pieces-lock"
                aria-label={workspace.locked ? `Desbloquear ${piece.name}` : `Bloquear ${piece.name}`}
                aria-pressed={workspace.locked}
                onClick={() => onLockChange(piece.id, !workspace.locked)}
              >
                {workspace.locked ? "▣" : "▢"}
              </button>
              <details className="pieces-menu">
                <summary aria-label={`Mais ações para ${piece.name}`}>…</summary>
                <div>
                  <button type="button" onClick={() => onRename(piece.id)}>Renomear</button>
                  <button type="button" onClick={() => onDuplicate(piece.id)}>Duplicar</button>
                  <button type="button" onClick={() => onDuplicateMirrored(piece.id)}>Duplicar espelhado</button>
                  <button type="button" onClick={() => onRotate(piece.id, "left")}>Girar 90° à esquerda</button>
                  <button type="button" onClick={() => onRotate(piece.id, "right")}>Girar 90° à direita</button>
                  <button type="button" onClick={() => onRotate(piece.id, "reset")}>Restaurar rotação</button>
                  <button type="button" onClick={() => onDelete(piece.id)}>Excluir</button>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </aside>
  );
});
