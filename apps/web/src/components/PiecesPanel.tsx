import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PatternPiece, PieceWorkspaceState } from "../domain/pattern";

interface PiecesPanelProps {
  pieces: PatternPiece[];
  workspaceStates: PieceWorkspaceState[];
  activePieceId: string;
  selectedPieceIds: string[];
  dismissKey?: string;
  onSelect(pieceId: string): void;
  onToggleSelect(pieceId: string): void;
  onCreate(): void;
  onVisibilityChange(pieceId: string, visible: boolean): void;
  onLockChange(pieceId: string, locked: boolean): void;
  onDuplicate(pieceId: string): void;
  onDuplicateMirrored(pieceId: string): void;
  onRename(pieceId: string): void;
  onDelete(pieceId: string): void;
  onRotate(pieceId: string, action: "left" | "right" | "reset"): void;
}

interface PopoverState {
  pieceId: string;
  style: CSSProperties;
}

export const PiecesPanel = memo(function PiecesPanel({
  pieces,
  workspaceStates,
  activePieceId,
  selectedPieceIds,
  dismissKey = "",
  onSelect,
  onToggleSelect,
  onCreate,
  onVisibilityChange,
  onLockChange,
  onDuplicate,
  onDuplicateMirrored,
  onRename,
  onDelete,
  onRotate,
}: PiecesPanelProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef(false);

  const closePopover = (returnFocus = false) => {
    returnFocusRef.current = returnFocus;
    setPopover(null);
  };

  useEffect(() => {
    closePopover(false);
  }, [activePieceId, dismissKey]);

  useEffect(() => {
    if (!popover) {
      if (returnFocusRef.current) triggerRef.current?.focus();
      returnFocusRef.current = false;
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closePopover(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePopover(true);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popover]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!popover || !menu) return;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    let left = Number(popover.style.left ?? 0);
    let top = Number(popover.style.top ?? 0);
    if (rect.right > window.innerWidth - margin) {
      left -= rect.right - window.innerWidth + margin;
    }
    if (rect.bottom > window.innerHeight - margin) {
      top -= rect.bottom - window.innerHeight + margin;
    }
    if (rect.left < margin) left += margin - rect.left;
    if (rect.top < margin) top += margin - rect.top;
    if (left !== popover.style.left || top !== popover.style.top) {
      setPopover((current) =>
        current ? { ...current, style: { ...current.style, left, top } } : null,
      );
      return;
    }
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }, [popover]);

  const openPopover = (pieceId: string, trigger: HTMLButtonElement) => {
    if (popover?.pieceId === pieceId) {
      closePopover(true);
      return;
    }
    triggerRef.current = trigger;
    const rect = trigger.getBoundingClientRect();
    setPopover({
      pieceId,
      style: {
        position: "fixed",
        left: Math.max(8, rect.right - 210),
        top: rect.bottom + 6,
      },
    });
  };

  const runAction = (action: () => void) => {
    closePopover(true);
    action();
  };

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
          const workspace = workspaceStates.find(
            (state) => state.pieceId === piece.id,
          ) ?? {
            pieceId: piece.id,
            transform: {
              pieceId: piece.id,
              xMm: 0,
              yMm: 0,
              rotationDeg: 0,
            },
            visible: true,
            locked: false,
          };
          const menuId = `piece-actions-${sanitizeId(piece.id)}`;
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
              <input
                type="checkbox"
                checked={selectedPieceIds.includes(piece.id)}
                onChange={() => onToggleSelect(piece.id)}
                aria-label={`Selecionar ${piece.name}`}
              />
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
                <small>
                  {piece.cutQuantity ?? 1}×{piece.cutOnFold ? " · dobra" : ""}
                </small>
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
              <button
                type="button"
                className="pieces-more"
                aria-label={`Mais ações para ${piece.name}`}
                aria-haspopup="menu"
                aria-expanded={popover?.pieceId === piece.id}
                aria-controls={popover?.pieceId === piece.id ? menuId : undefined}
                onClick={(event) => openPopover(piece.id, event.currentTarget)}
              >
                …
              </button>
              {popover?.pieceId === piece.id ? (
                <div
                  ref={menuRef}
                  id={menuId}
                  className="pieces-popover"
                  role="menu"
                  aria-label={`Ações de ${piece.name}`}
                  style={popover.style}
                >
                  <button role="menuitem" type="button" onClick={() => runAction(() => onRename(piece.id))}>Renomear</button>
                  <button role="menuitem" type="button" onClick={() => runAction(() => onDuplicate(piece.id))}>Duplicar</button>
                  <button role="menuitem" type="button" onClick={() => runAction(() => onDuplicateMirrored(piece.id))}>Duplicar espelhado</button>
                  <button role="menuitem" type="button" onClick={() => runAction(() => onRotate(piece.id, "left"))}>Girar 90° à esquerda</button>
                  <button role="menuitem" type="button" onClick={() => runAction(() => onRotate(piece.id, "right"))}>Girar 90° à direita</button>
                  <button role="menuitem" type="button" onClick={() => runAction(() => onRotate(piece.id, "reset"))}>Restaurar rotação</button>
                  <button role="menuitem" type="button" onClick={() => runAction(() => onDelete(piece.id))}>Excluir</button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </aside>
  );
});

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
