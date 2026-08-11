import { memo, useEffect, useMemo, useState } from "react";
import type { GarmentDraft } from "../domain/pattern";
import {
  createDefaultSleeveSettings,
  detectSleeveBody,
  draftGuidedSleeve,
  type GuidedSleeveDraft,
  type SleeveBodyCandidate,
  type SleeveDraftSettings,
  type SleeveType,
} from "../domain/sleeveSystem";

interface SleeveWizardDialogProps {
  garment: GarmentDraft;
  onClose(): void;
  onConfirm(options: {
    frontPieceId: string;
    backPieceId: string;
    settings: SleeveDraftSettings;
    replaceExisting: boolean;
  }): void;
}

type WizardStep = "body" | "type" | "settings" | "fit";

export const SleeveWizardDialog = memo(function SleeveWizardDialog({
  garment,
  onClose,
  onConfirm,
}: SleeveWizardDialogProps) {
  const detection = useMemo(() => detectSleeveBody(garment.pieces), [garment.pieces]);
  const [step, setStep] = useState<WizardStep>("body");
  const [frontPieceId, setFrontPieceId] = useState(detection.selectedFrontId ?? detection.frontCandidates[0]?.pieceId ?? "");
  const [backPieceId, setBackPieceId] = useState(detection.selectedBackId ?? detection.backCandidates[0]?.pieceId ?? "");
  const [sleeveType, setSleeveType] = useState<SleeveType>("short");
  const [settings, setSettings] = useState<SleeveDraftSettings | null>(() =>
    initialSettings(garment, detection.frontCandidates, detection.backCandidates, "short"),
  );
  const [connectionsConfirmed, setConnectionsConfirmed] = useState(!detection.ambiguous);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [autoZoom, setAutoZoom] = useState(true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!frontPieceId || !backPieceId) return;
    try {
      setSettings(createDefaultSleeveSettings(garment, frontPieceId, backPieceId, sleeveType));
    } catch {
      setSettings(null);
    }
  }, [backPieceId, frontPieceId, garment, sleeveType]);

  const preview = useMemo(() => {
    if (!settings || !frontPieceId || !backPieceId) return { draft: null, error: null as string | null };
    try {
      return {
        draft: draftGuidedSleeve(garment, frontPieceId, backPieceId, settings),
        error: null,
      };
    } catch (reason) {
      return {
        draft: null,
        error: reason instanceof Error ? reason.message : "Não foi possível calcular a manga.",
      };
    }
  }, [backPieceId, frontPieceId, garment, settings]);

  const needsReplacement = detection.existingSleeveIds.length > 0;
  const canAdvanceBody = Boolean(frontPieceId && backPieceId && frontPieceId !== backPieceId && connectionsConfirmed);
  const canConfirm = Boolean(
    preview.draft &&
    preview.draft.compatibility.status !== "error" &&
    (!needsReplacement || replaceExisting),
  );

  const updateNumber = (key: keyof SleeveDraftSettings, value: number) => {
    if (!settings || !Number.isFinite(value)) return;
    setSettings({ ...settings, [key]: value });
  };

  return (
    <div
      className="dialog-backdrop sleeve-wizard-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="sleeve-wizard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sleeve-wizard-title"
        data-testid="sleeve-wizard"
      >
        <header className="dialog-header sleeve-wizard-header">
          <div>
            <span className="section-eyebrow">Assistente guiado</span>
            <h1 id="sleeve-wizard-title">Adicionar manga</h1>
            <p>A manga será calculada a partir dos arcos reais das cavas selecionadas. O corpo não será alterado.</p>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="Fechar assistente de manga">×</button>
        </header>

        <ol className="sleeve-wizard-steps" aria-label="Etapas do assistente">
          {(["body", "type", "settings", "fit"] as WizardStep[]).map((current, index) => (
            <li key={current} className={step === current ? "active" : stepIndex(step) > index ? "complete" : ""}>
              <span>{index + 1}</span>{stepLabel(current)}
            </li>
          ))}
        </ol>

        <div className="sleeve-wizard-content">
          {step === "body" ? (
            <BodyStep
              detection={detection}
              frontPieceId={frontPieceId}
              backPieceId={backPieceId}
              onFrontChange={(value) => { setFrontPieceId(value); setConnectionsConfirmed(false); }}
              onBackChange={(value) => { setBackPieceId(value); setConnectionsConfirmed(false); }}
              confirmed={connectionsConfirmed}
              onConfirmedChange={setConnectionsConfirmed}
              replaceExisting={replaceExisting}
              onReplaceExistingChange={setReplaceExisting}
            />
          ) : null}

          {step === "type" ? (
            <div className="sleeve-type-step">
              <h2>Escolha o comprimento inicial</h2>
              <p>O comprimento continua editável na próxima etapa.</p>
              <div className="sleeve-type-grid">
                <button
                  type="button"
                  className={sleeveType === "short" ? "active" : ""}
                  onClick={() => setSleeveType("short")}
                  data-testid="sleeve-type-short"
                >
                  <span className="sleeve-type-icon short" aria-hidden="true" />
                  <strong>Manga curta</strong>
                  <small>Comprimento inicial próximo ao terço superior do braço.</small>
                </button>
                <button
                  type="button"
                  className={sleeveType === "long" ? "active" : ""}
                  onClick={() => setSleeveType("long")}
                  data-testid="sleeve-type-long"
                >
                  <span className="sleeve-type-icon long" aria-hidden="true" />
                  <strong>Manga longa</strong>
                  <small>Inclui linha de cotovelo e punho configurável.</small>
                </button>
              </div>
            </div>
          ) : null}

          {step === "settings" && settings ? (
            <div className="sleeve-settings-step">
              <div>
                <h2>Configuração geométrica</h2>
                <p>Valores em milímetros. A cabeça é recalculada a cada alteração.</p>
              </div>
              <div className="sleeve-settings-grid">
                <NumberField label="Comprimento" value={settings.lengthMm} min={settings.capHeightMm + 55} max={950} onChange={(value) => updateNumber("lengthMm", value)} testId="sleeve-length" />
                <NumberField label="Bíceps da manga" value={settings.bicepCircumferenceMm} min={220} max={900} onChange={(value) => updateNumber("bicepCircumferenceMm", value)} testId="sleeve-bicep" />
                <NumberField label={sleeveType === "long" ? "Punho" : "Abertura da manga"} value={settings.cuffCircumferenceMm} min={120} max={900} onChange={(value) => updateNumber("cuffCircumferenceMm", value)} testId="sleeve-cuff" />
                <NumberField label="Altura da cabeça" value={settings.capHeightMm} min={55} max={260} onChange={(value) => updateNumber("capHeightMm", value)} testId="sleeve-cap-height" />
                <NumberField label="Folga total da cabeça" value={settings.capEaseMm} min={-35} max={65} step={0.5} onChange={(value) => updateNumber("capEaseMm", value)} testId="sleeve-ease" />
                <NumberField label="Rotação" value={settings.rotationDeg} min={-25} max={25} step={0.5} suffix="°" onChange={(value) => updateNumber("rotationDeg", value)} testId="sleeve-rotation" />
              </div>
              {preview.error ? <div className="dialog-error" role="alert">{preview.error}</div> : null}
              {preview.draft ? <CompatibilitySummary draft={preview.draft} compact /> : null}
            </div>
          ) : null}

          {step === "fit" && preview.draft ? (
            <FitStep draft={preview.draft} autoZoom={autoZoom} onAutoZoomChange={setAutoZoom} />
          ) : null}
        </div>

        <footer className="sleeve-wizard-actions">
          <button type="button" className="secondary-button" onClick={() => {
            const previous = previousStep(step);
            if (previous) setStep(previous);
            else onClose();
          }}>
            {step === "body" ? "Cancelar" : "Voltar"}
          </button>
          {step === "body" ? (
            <button type="button" className="primary-button" disabled={!canAdvanceBody} onClick={() => setStep("type")}>Continuar</button>
          ) : null}
          {step === "type" ? (
            <button type="button" className="primary-button" onClick={() => setStep("settings")}>Configurar</button>
          ) : null}
          {step === "settings" ? (
            <button type="button" className="primary-button" disabled={!preview.draft} onClick={() => setStep("fit")} data-testid="sleeve-view-fit">Ver encaixe</button>
          ) : null}
          {step === "fit" ? (
            <button
              type="button"
              className="primary-button"
              disabled={!canConfirm}
              onClick={() => settings && onConfirm({ frontPieceId, backPieceId, settings, replaceExisting })}
              data-testid="sleeve-confirm"
            >
              {needsReplacement ? "Substituir e criar manga" : "Criar manga e costuras"}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
});

function BodyStep({
  detection,
  frontPieceId,
  backPieceId,
  onFrontChange,
  onBackChange,
  confirmed,
  onConfirmedChange,
  replaceExisting,
  onReplaceExistingChange,
}: {
  detection: ReturnType<typeof detectSleeveBody>;
  frontPieceId: string;
  backPieceId: string;
  onFrontChange(value: string): void;
  onBackChange(value: string): void;
  confirmed: boolean;
  onConfirmedChange(value: boolean): void;
  replaceExisting: boolean;
  onReplaceExistingChange(value: boolean): void;
}) {
  const front = detection.frontCandidates.find((candidate) => candidate.pieceId === frontPieceId);
  const back = detection.backCandidates.find((candidate) => candidate.pieceId === backPieceId);
  return (
    <div className="sleeve-body-step">
      <div>
        <h2>Confirme o corpo e as cavas</h2>
        <p>Encontramos frente e costas pela forma e pelos pontos de costura, mesmo que as peças tenham outro nome.</p>
      </div>
      <div className="sleeve-source-grid">
        <CandidateSelect label="Frente do corpo" value={frontPieceId} candidates={detection.frontCandidates} onChange={onFrontChange} testId="sleeve-front-select" />
        <CandidateSelect label="Costas do corpo" value={backPieceId} candidates={detection.backCandidates} onChange={onBackChange} testId="sleeve-back-select" />
      </div>
      <div className="sleeve-source-details">
        <SourceCard title="Cava frontal" candidate={front} accent="front" />
        <SourceCard title="Cava traseira" candidate={back} accent="back" />
      </div>
      {detection.diagnostics.filter((diagnostic) => diagnostic.severity !== "info").map((diagnostic) => (
        <div className={`sleeve-diagnostic ${diagnostic.severity}`} key={`${diagnostic.code}:${diagnostic.pieceId ?? ""}`}>{diagnostic.message}</div>
      ))}
      <label className="sleeve-confirm-row">
        <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmedChange(event.currentTarget.checked)} data-testid="sleeve-confirm-body" />
        <span>Confirmo que ombros, axilas, cava frontal e cava traseira correspondem ao mesmo corpo.</span>
      </label>
      {detection.existingSleeveIds.length > 0 ? (
        <label className="sleeve-confirm-row warning">
          <input type="checkbox" checked={replaceExisting} onChange={(event) => onReplaceExistingChange(event.currentTarget.checked)} data-testid="sleeve-replace-existing" />
          <span>Substituir explicitamente a manga existente e suas costuras relacionadas. O corpo será preservado.</span>
        </label>
      ) : null}
    </div>
  );
}

function CandidateSelect({ label, value, candidates, onChange, testId }: {
  label: string;
  value: string;
  candidates: SleeveBodyCandidate[];
  onChange(value: string): void;
  testId: string;
}) {
  return (
    <label className="sleeve-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)} data-testid={testId}>
        <option value="">Selecionar definição</option>
        {candidates.map((candidate) => <option value={candidate.pieceId} key={candidate.pieceId}>{candidate.pieceName} · {candidate.armholeLengthMm.toFixed(1)} mm</option>)}
      </select>
    </label>
  );
}

function SourceCard({ title, candidate, accent }: { title: string; candidate?: SleeveBodyCandidate; accent: "front" | "back" }) {
  return (
    <article className={`sleeve-source-card ${accent}`}>
      <span>{title}</span>
      {candidate ? (
        <>
          <strong>{candidate.pieceName}</strong>
          <small>{candidate.armholeLengthMm.toFixed(1)} mm de arco</small>
          <dl>
            <div><dt>Cava</dt><dd>{candidate.armholeEdgeIds.length > 0 ? "Identificada" : "Não identificada"}</dd></div>
            <div><dt>Ombro</dt><dd>{candidate.shoulderEdgeId ? "Identificado" : "Não identificado"}</dd></div>
            <div><dt>Axila</dt><dd>{candidate.sideEdgeId ? "Identificada" : "Não identificada"}</dd></div>
          </dl>
        </>
      ) : <em>Não detectada</em>}
    </article>
  );
}

function NumberField({ label, value, min, max, step = 1, suffix = "mm", onChange, testId }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange(value: number): void;
  testId: string;
}) {
  return (
    <label className="sleeve-field numeric">
      <span>{label}</span>
      <span className="sleeve-number-control">
        <input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} data-testid={testId} />
        <small>{suffix}</small>
      </span>
    </label>
  );
}

function CompatibilitySummary({ draft, compact = false }: { draft: GuidedSleeveDraft; compact?: boolean }) {
  const { compatibility } = draft;
  return (
    <section className={`sleeve-compatibility-summary ${compatibility.status}${compact ? " compact" : ""}`} aria-live="polite">
      <header>
        <strong>{compatibility.status === "compatible" ? "Encaixe dentro da tolerância" : compatibility.status === "warning" ? "Encaixe exige atenção" : "Encaixe incompatível"}</strong>
        <span>Diferença total: {signed(compatibility.totalDifferenceMm)} mm · {signed(compatibility.easePercent)}%</span>
      </header>
      <div className="sleeve-metric-grid">
        <Metric label="Cava frontal" value={compatibility.frontArmholeMm} className="front" />
        <Metric label="Cabeça frontal" value={compatibility.frontCapMm} className="front-cap" />
        <Metric label="Cava traseira" value={compatibility.backArmholeMm} className="back" />
        <Metric label="Cabeça traseira" value={compatibility.backCapMm} className="back-cap" />
      </div>
      {compatibility.diagnostics.map((diagnostic) => (
        <div className={`sleeve-diagnostic ${diagnostic.severity}`} key={diagnostic.code}>{diagnostic.message}</div>
      ))}
    </section>
  );
}

function Metric({ label, value, className }: { label: string; value: number; className: string }) {
  return <div className={`sleeve-metric ${className}`}><span>{label}</span><strong>{value.toFixed(1)} mm</strong></div>;
}

function FitStep({ draft, autoZoom, onAutoZoomChange }: { draft: GuidedSleeveDraft; autoZoom: boolean; onAutoZoomChange(value: boolean): void }) {
  return (
    <div className="sleeve-fit-step" data-testid="sleeve-fit-step">
      <div className="sleeve-fit-copy">
        <h2>Encaixe entre cava e manga</h2>
        <p>As peças podem estar em qualquer posição na bancada. O encaixe usa os arcos e os pontos de referência.</p>
        <label className="sleeve-confirm-row compact">
          <input type="checkbox" checked={autoZoom} onChange={(event) => onAutoZoomChange(event.currentTarget.checked)} />
          <span>Enquadrar automaticamente o mini diagrama</span>
        </label>
        <CompatibilitySummary draft={draft} />
      </div>
      <SleeveFitDiagram draft={draft} autoZoom={autoZoom} />
      <div className="sleeve-landmark-list">
        {draft.compatibility.landmarkPairs.map((pair) => (
          <div key={pair.id}>
            <span className={`landmark-dot ${pair.bodyConnectorRole === "frontArmhole" ? "front" : "back"}`} />
            <strong>{pair.label}</strong>
            <small>Posição na cava: {Math.round(pair.bodyArcPosition * 100)}% · na manga: {Math.round(pair.sleeveArcPosition * 100)}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function SleeveFitDiagram({ draft, autoZoom }: { draft: GuidedSleeveDraft; autoZoom: boolean }) {
  const compatibility = draft.compatibility;
  const frontRatio = compatibility.frontArmholeMm / Math.max(compatibility.totalArmholeMm, 1);
  const apexX = 110 + 300 * frontRatio;
  return (
    <svg className={`sleeve-fit-diagram${autoZoom ? " auto-zoom" : ""}`} viewBox={autoZoom ? "60 25 500 330" : "0 0 620 390"} role="img" aria-label="Mini diagrama de encaixe entre cavas e cabeça de manga">
      <defs>
        <marker id="sleeve-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker>
      </defs>
      <text x="72" y="52" className="diagram-title">Corpo</text>
      <path className="fit-armhole front" d={`M 90 92 C 135 70, ${apexX - 55} 118, ${apexX} 176`} />
      <path className="fit-armhole back" d={`M ${apexX} 176 C ${apexX + 60} 105, 480 72, 530 96`} />
      <text x="86" y="80" className="fit-label front">cava frontal · {compatibility.frontArmholeMm.toFixed(1)}</text>
      <text x="405" y="78" className="fit-label back">cava traseira · {compatibility.backArmholeMm.toFixed(1)}</text>
      <text x="72" y="234" className="diagram-title">Manga</text>
      <path className="fit-cap front-cap" d={`M 90 310 C 135 260, ${apexX - 55} 220, ${apexX} 210`} />
      <path className="fit-cap back-cap" d={`M ${apexX} 210 C ${apexX + 62} 218, 478 258, 530 310`} />
      <circle className="fit-apex" cx={apexX} cy="210" r="6" />
      <text x={apexX + 10} y="202" className="fit-label apex">ápice / ombro</text>
      <Notch x={90 + (apexX - 90) * 0.6} y={263} label="1" className="front" />
      <Notch x={apexX + (530 - apexX) * 0.34} y={230} label="2" className="back" />
      <Notch x={apexX + (530 - apexX) * 0.67} y={260} label="2" className="back" />
      <line className="fit-guide" x1="90" y1="344" x2="530" y2="344" markerEnd="url(#sleeve-arrow)" />
      <text x="200" y="368" className="fit-caption">folga concentrada acima dos piques · {signed(compatibility.totalDifferenceMm)} mm</text>
    </svg>
  );
}

function Notch({ x, y, label, className }: { x: number; y: number; label: string; className: string }) {
  return <g className={`fit-notch ${className}`}><line x1={x} y1={y - 9} x2={x} y2={y + 9} /><text x={x + 5} y={y - 5}>{label}</text></g>;
}

function initialSettings(
  garment: GarmentDraft,
  fronts: SleeveBodyCandidate[],
  backs: SleeveBodyCandidate[],
  type: SleeveType,
): SleeveDraftSettings | null {
  if (!fronts[0] || !backs[0]) return null;
  try {
    return createDefaultSleeveSettings(garment, fronts[0].pieceId, backs[0].pieceId, type);
  } catch {
    return null;
  }
}

function stepIndex(step: WizardStep): number {
  return (["body", "type", "settings", "fit"] as WizardStep[]).indexOf(step);
}

function stepLabel(step: WizardStep): string {
  if (step === "body") return "Corpo";
  if (step === "type") return "Tipo";
  if (step === "settings") return "Medidas";
  return "Encaixe";
}

function previousStep(step: WizardStep): WizardStep | null {
  if (step === "fit") return "settings";
  if (step === "settings") return "type";
  if (step === "type") return "body";
  return null;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
