import { memo, useEffect, useState } from "react";
import type { BodyMeasurements, GarmentDraft } from "../domain/pattern";
import {
  DEFAULT_BODY_MEASUREMENTS,
  PATTERN_TEMPLATES,
  createGarmentFromTemplate,
  type PatternTemplateId,
} from "../patterns/templateCatalog";

interface PatternLibraryDialogProps {
  onClose(): void;
  onChoose(garment: GarmentDraft): void;
}

export const PatternLibraryDialog = memo(function PatternLibraryDialog({
  onClose,
  onChoose,
}: PatternLibraryDialogProps) {
  const [measurements, setMeasurements] = useState<BodyMeasurements>(
    DEFAULT_BODY_MEASUREMENTS,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const chooseTemplate = (templateId: PatternTemplateId) => {
    try {
      setError(null);
      onChoose(createGarmentFromTemplate(templateId, measurements));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível gerar este molde-base.",
      );
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="pattern-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pattern-library-title"
      >
        <header className="dialog-header">
          <div>
            <span className="section-eyebrow">Começar por uma base</span>
            <h1 id="pattern-library-title">Moldes essenciais</h1>
            <p>
              Informe as medidas do corpo e escolha uma base. Todas as peças
              continuarão editáveis.
            </p>
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={onClose}
            aria-label="Fechar biblioteca"
          >
            ×
          </button>
        </header>

        <fieldset className="body-measurements">
          <legend>Medidas corporais</legend>
          <MeasurementField
            label="Altura"
            valueMm={measurements.heightMm}
            minimumCm={130}
            maximumCm={210}
            onChange={(heightMm) =>
              setMeasurements((current) => ({ ...current, heightMm }))
            }
          />
          <MeasurementField
            label="Busto/tórax"
            valueMm={measurements.bustMm}
            minimumCm={60}
            maximumCm={160}
            onChange={(bustMm) =>
              setMeasurements((current) => ({ ...current, bustMm }))
            }
          />
          <MeasurementField
            label="Cintura"
            valueMm={measurements.waistMm}
            minimumCm={50}
            maximumCm={150}
            onChange={(waistMm) =>
              setMeasurements((current) => ({ ...current, waistMm }))
            }
          />
          <MeasurementField
            label="Quadril"
            valueMm={measurements.hipMm}
            minimumCm={65}
            maximumCm={170}
            onChange={(hipMm) =>
              setMeasurements((current) => ({ ...current, hipMm }))
            }
          />
        </fieldset>

        <div className="template-grid">
          {PATTERN_TEMPLATES.map((template) => (
            <button
              className="template-card"
              key={template.id}
              type="button"
              onClick={() => chooseTemplate(template.id)}
            >
              <span className={`template-icon template-icon-${template.id}`} aria-hidden="true" />
              <span className="template-card-copy">
                <span className="template-category">{template.category}</span>
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <small>{template.pieces}</small>
              </span>
            </button>
          ))}
        </div>

        {error ? <div className="dialog-error">{error}</div> : null}
        <footer className="dialog-note">
          Bases simplificadas para criação e testes. Confira o caimento antes de
          cortar o tecido definitivo.
        </footer>
      </section>
    </div>
  );
});

interface MeasurementFieldProps {
  label: string;
  valueMm: number;
  minimumCm: number;
  maximumCm: number;
  onChange(valueMm: number): void;
}

function MeasurementField({
  label,
  valueMm,
  minimumCm,
  maximumCm,
  onChange,
}: MeasurementFieldProps) {
  return (
    <label>
      <span>{label}</span>
      <span className="measurement-input">
        <input
          type="number"
          min={minimumCm}
          max={maximumCm}
          step="0.5"
          value={valueMm / 10}
          onChange={(event) => {
            const valueCm = event.currentTarget.valueAsNumber;
            if (Number.isFinite(valueCm)) onChange(valueCm * 10);
          }}
        />
        <span>cm</span>
      </span>
    </label>
  );
}

