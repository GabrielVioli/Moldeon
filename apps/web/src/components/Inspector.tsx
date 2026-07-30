import { memo } from "react";
import { PatternSnapshot } from "../domain/pattern";

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

      <section className="metric-grid">
        <Metric label="Área" value={`${(snapshot.areaMm2 / 10000).toFixed(1)} cm²`} />
        <Metric label="Perímetro" value={`${(snapshot.perimeterMm / 10).toFixed(1)} cm`} />
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
