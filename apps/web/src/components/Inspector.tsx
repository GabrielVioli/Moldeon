import { memo } from "react";
import { edgeRangeSequenceLength, seamSideRanges, type PatternSnapshot } from "../domain/pattern";
import { BodyMeasurementsForm } from "./BodyMeasurementsForm";
import { BodyPositionPanel } from "./BodyPositionPanel";
import { useEditorStore } from "../state/editorStore";
import { groupSeamsByRelation, seamRelationLabel } from "../domain/templateAssemblySeams";

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
  const toggleSeamActive = useEditorStore((state) => state.toggleSeamActive);
  const selectedSeamId = useEditorStore((state) => state.selectedSeamId);
  const selectSeam = useEditorStore((state) => state.selectSeam);
  const setBodyType = useEditorStore((state) => state.setBodyType);
  const setBodyMeasurement = useEditorStore((state) => state.setBodyMeasurement);
  const resetBodyMeasurement = useEditorStore((state) => state.resetBodyMeasurement);
  const setBodyMeasurementFormula = useEditorStore((state) => state.setBodyMeasurementFormula);
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
  const seamGroups = groupSeamsByRelation(garment.seams);

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

      <BodyPositionPanel key={snapshot.piece.id} piece={snapshot.piece} />

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

      <section className="measurement-panel-section">
        <details>
          <summary>Medidas corporais</summary>
          <BodyMeasurementsForm
            compact
            bodyType={garment.bodyType}
            measurements={garment.measurements}
            measurementProfile={garment.measurementProfile}
            onBodyTypeChange={setBodyType}
            onMeasurementChange={setBodyMeasurement}
            onResetMeasurement={resetBodyMeasurement}
            onFormulaChange={setBodyMeasurementFormula}
            onEditStart={() => onEditStart("Alterar medidas")}
            onEditEnd={onEditEnd}
            onEditCancel={onEditCancel}
          />
        </details>
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
        {seamGroups.length === 0 ? <p className="muted">Selecione duas bordas no modo costura.</p> : (
          <ul className="seam-list">{seamGroups.map((group) => {
            const representative = group[0];
            const firstPiece = garment.pieces.find((piece) => piece.id === representative.first.pieceId);
            const secondPiece = garment.pieces.find((piece) => piece.id === representative.second.pieceId);
            const firstLength = group.reduce((sum, seam) => {
              return sum + edgeRangeSequenceLength(garment.pieces, seamSideRanges(seam, "first"));
            }, 0);
            const secondLength = group.reduce((sum, seam) => {
              return sum + edgeRangeSequenceLength(garment.pieces, seamSideRanges(seam, "second"));
            }, 0);
            const issues = seamIssues.filter((item) => group.some((seam) => seam.id === item.seamId));
            const selected = group.some((seam) => seam.id === selectedSeamId);
            const inactive = group.every((seam) => seam.active === false);
            const sameDirection = group.every((seam) => seam.direction === "same");
            const relationId = representative.groupId ?? representative.id;
            return (
              <li key={relationId} className={`${selected ? "is-selected " : ""}${inactive ? "is-inactive" : ""}`} onClick={() => selectSeam(representative.id)}>
                <strong>{seamRelationLabel(group)}</strong>
                <small>{firstPiece?.name ?? "Peça ausente"} ↔ {secondPiece?.name ?? "Peça ausente"} · {firstLength.toFixed(1)} / {secondLength.toFixed(1)} mm · Δ {Math.abs(firstLength - secondLength).toFixed(1)} mm</small>
                {issues.map((issue) => <span key={issue.seamId}>{issue.message}</span>)}
                <div>
                  <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) if ((seam.active === false) === inactive) toggleSeamActive(seam.id); }}>{inactive ? "Reativar" : "Desativar"}</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) toggleSeamDirection(seam.id); }}>{sameDirection ? "Mesmo sentido" : "Sentido oposto"}</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) removeSeam(seam.id); }}>Remover</button>
                </div>
              </li>
            );
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
