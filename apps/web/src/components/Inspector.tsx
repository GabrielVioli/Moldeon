import { PatternSnapshot } from "../domain/pattern";

interface InspectorProps {
  snapshot: PatternSnapshot;
  selectedPointId: string | null;
  onMovePoint(pointId: string, xMm: number, yMm: number): void;
  onSeamAllowanceChange(valueMm: number): void;
}

export function Inspector({
  snapshot,
  selectedPointId,
  onMovePoint,
  onSeamAllowanceChange,
}: InspectorProps) {
  const selectedPoint = snapshot.piece.points.find((point) => point.id === selectedPointId) ?? null;

  return (
    <aside className="inspector">
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
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(value)) {
                    onMovePoint(selectedPoint.id, selectedPoint.xMm, value);
                  }
                }}
              />
            </label>
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
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
