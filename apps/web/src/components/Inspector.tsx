import { memo } from "react";
import { edgeRangeLength, type PatternSnapshot } from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";

interface InspectorProps {
  id: string;
  labelledBy: string;
  mobileActive: boolean;
  snapshot: PatternSnapshot;
  selectedPointId: string | null;
  onEditStart(label: string): void;
  onEditEnd(): void;
  onEditCancel(): void;
  onMovePoint(pointId: string, xMm: number, yMm: number): void;
  curveActive: boolean;
  onToggleCurve(): void;
  onSeamAllowanceChange(valueMm: number): void;
}

export const Inspector = memo(function Inspector({
  id,
  labelledBy,
  mobileActive,
  snapshot,
  selectedPointId,
  onEditStart,
  onEditEnd,
  onEditCancel,
  onMovePoint,
  curveActive,
  onToggleCurve,
  onSeamAllowanceChange,
}: InspectorProps) {
  const selectedPoint = snapshot.piece.points.find((point) => point.id === selectedPointId) ?? null;
  const garment = useEditorStore((state) => state.garment);
  const seamIssues = useEditorStore((state) => state.seamIssues);
  const removeSeam = useEditorStore((state) => state.removeSeam);
  const toggleSeamDirection = useEditorStore((state) => state.toggleSeamDirection);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const pieceSelectionActive = useEditorStore((state) => state.pieceSelectionActive);
  const setWorkspaceTransform = useEditorStore((state) => state.setPieceWorkspaceTransform);
  const setPieceVisibility = useEditorStore((state) => state.setPieceVisibility);
  const setPieceLocked = useEditorStore((state) => state.setPieceLocked);
  const renamePiece = useEditorStore((state) => state.renamePiece);
  const workspace = garment.workspaceStates?.find((state) => state.pieceId === activePieceId) ?? {
    pieceId: activePieceId,
    transform: { pieceId: activePieceId, xMm: 0, yMm: 0, rotationDeg: 0 },
    visible: true,
    locked: false,
  };

  return (
    <aside
      className={`inspector workspace-view${mobileActive ? " is-mobile-active" : ""}`}
      id={id}
      aria-labelledby={labelledBy}
    >
      <section>
        <div className="section-eyebrow">Peça ativa</div>
        <h2>{snapshot.piece.name}</h2>
        <p className="muted">Arraste os pontos no editor para alterar o contorno.</p>
      </section>

      {pieceSelectionActive && !selectedPoint ? (
        <section>
          <div className="section-eyebrow">Peça selecionada</div>
          <div className="piece-properties">
            <label>Nome<input value={snapshot.piece.name} onFocus={() => onEditStart("Renomear peça")} onBlur={onEditEnd} onChange={(event) => renamePiece(activePieceId, event.currentTarget.value)} /></label>
            <WorkspaceNumber label="Posição X" value={workspace.transform.xMm} unit="mm" onFocus={() => onEditStart("Mover peça")} onBlur={onEditEnd} onChange={(value) => setWorkspaceTransform(activePieceId, { ...workspace.transform, xMm: value })} />
            <WorkspaceNumber label="Posição Y" value={workspace.transform.yMm} unit="mm" onFocus={() => onEditStart("Mover peça")} onBlur={onEditEnd} onChange={(value) => setWorkspaceTransform(activePieceId, { ...workspace.transform, yMm: value })} />
            <WorkspaceNumber label="Rotação" value={workspace.transform.rotationDeg} unit="°" onFocus={() => onEditStart("Rotacionar peça")} onBlur={onEditEnd} onChange={(value) => setWorkspaceTransform(activePieceId, { ...workspace.transform, rotationDeg: value })} />
            <label className="check-field"><input type="checkbox" checked={workspace.visible} onChange={(event) => setPieceVisibility(activePieceId, event.currentTarget.checked)} />Visível</label>
            <label className="check-field"><input type="checkbox" checked={workspace.locked} onChange={(event) => setPieceLocked(activePieceId, event.currentTarget.checked)} />Bloqueada</label>
          </div>
        </section>
      ) : null}

      <section className="metric-grid">
        <Metric label="Área" value={`${(snapshot.areaMm2 / 10000).toFixed(1)} cm²`} />
        <Metric label="Perímetro" value={`${(snapshot.perimeterMm / 10).toFixed(1)} cm`} />
        <Metric
          label="Cortar"
          value={`${snapshot.piece.cutQuantity ?? 1}×${snapshot.piece.cutOnFold ? " na dobra" : ""}`}
        />
        <Metric
          label="Pontos"
          value={snapshot.piece.points.length.toString()}
        />
      </section>

      <section>
        <label className="field-label" htmlFor="seam-allowance">Margem de costura</label>
        <div className="input-with-unit">
          <input
            id="seam-allowance"
            type="number"
            min="0"
            step="1"
            value={snapshot.piece.seamAllowanceMm}
            onFocus={() => onEditStart("Alterar margem")}
            onBlur={onEditEnd}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onEditCancel();
                event.currentTarget.blur();
              }
            }}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) onSeamAllowanceChange(value);
            }}
          />
          <span>mm</span>
        </div>
      </section>

      <section>
        <div className="section-eyebrow">Ponto selecionado</div>
        {selectedPoint ? (
          <div className="coordinate-grid">
            <label>
              X
              <input
                type="number"
                step="0.1"
                value={selectedPoint.xMm}
                onFocus={() => onEditStart("Mover ponto")}
                onBlur={onEditEnd}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    onEditCancel();
                    event.currentTarget.blur();
                  }
                }}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(value)) {
                    onMovePoint(selectedPoint.id, value, selectedPoint.yMm);
                  }
                }}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                step="0.1"
                value={selectedPoint.yMm}
                onFocus={() => onEditStart("Mover ponto")}
                onBlur={onEditEnd}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    onEditCancel();
                    event.currentTarget.blur();
                  }
                }}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(value)) {
                    onMovePoint(selectedPoint.id, selectedPoint.xMm, value);
                  }
                }}
              />
            </label>
            <button
              className={`curve-toggle-button${curveActive ? " active" : ""}`}
              type="button"
              onClick={onToggleCurve}
              aria-pressed={curveActive}
            >
              {curveActive ? "Converter saída em linha" : "Curvar segmento de saída"}
            </button>
          </div>
        ) : (
          <p className="muted">Clique em um ponto do molde.</p>
        )}
      </section>

      <section>
        <div className="section-eyebrow">Costuras</div>
        {(garment.seams ?? []).length === 0 ? <p className="muted">Selecione duas bordas no modo costura.</p> : (
          <ul className="seam-list">{(garment.seams ?? []).map((seam) => {
            const firstPiece = garment.pieces.find((piece) => piece.id === seam.first.pieceId);
            const secondPiece = garment.pieces.find((piece) => piece.id === seam.second.pieceId);
            const firstLength = firstPiece ? edgeRangeLength(firstPiece, seam.first) : 0;
            const secondLength = secondPiece ? edgeRangeLength(secondPiece, seam.second) : 0;
            const issue = seamIssues.find((item) => item.seamId === seam.id);
            return <li key={seam.id}><strong>{firstPiece?.name ?? "Peça ausente"} ↔ {secondPiece?.name ?? "Peça ausente"}</strong><small>{firstLength.toFixed(1)} / {secondLength.toFixed(1)} mm · Δ {Math.abs(firstLength - secondLength).toFixed(1)} mm</small>{issue ? <span>{issue.message}</span> : null}<div><button type="button" onClick={() => toggleSeamDirection(seam.id)}>{seam.direction === "same" ? "Mesmo sentido" : "Sentido oposto"}</button><button type="button" onClick={() => removeSeam(seam.id)}>Remover</button></div></li>;
          })}</ul>
        )}
      </section>

      <section>
        <div className="section-eyebrow">Validação</div>
        {snapshot.issues.length === 0 ? (
          <div className="validation-ok">Contorno válido para a prévia.</div>
        ) : (
          <ul className="issue-list">
            {snapshot.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        )}
      </section>
    </aside>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkspaceNumber({ label, value, unit, onFocus, onBlur, onChange }: { label: string; value: number; unit: string; onFocus(): void; onBlur(): void; onChange(value: number): void }) {
  return <label>{label}<div className="input-with-unit"><input type="number" step="0.1" value={value} onFocus={onFocus} onBlur={onBlur} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { useEditorStore.getState().cancelEdit(); event.currentTarget.blur(); } }} onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onChange(next); }} /><span>{unit}</span></div></label>;
}
