import { memo, useEffect, useState } from "react";
import type {
  BodyMeasurements,
  BodyType,
  GarmentDraft,
} from "../domain/pattern";
import {
  DEFAULT_BODY_MEASUREMENTS,
  DEFAULT_MASCULINE_BODY_MEASUREMENTS,
  PATTERN_TEMPLATES,
  createGarmentFromTemplate,
  type PatternTemplateId,
} from "../patterns/templateCatalog";
import { BodyMeasurementsForm } from "./BodyMeasurementsForm";

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
  const [bodyType, setBodyType] = useState<BodyType>("feminine");
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
      onChoose(createGarmentFromTemplate(templateId, measurements, bodyType));
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

        <BodyMeasurementsForm
          compact
          bodyType={bodyType}
          measurements={measurements}
          onBodyTypeChange={(nextBodyType) => {
            setBodyType(nextBodyType);
            setMeasurements(
              nextBodyType === "feminine"
                ? DEFAULT_BODY_MEASUREMENTS
                : DEFAULT_MASCULINE_BODY_MEASUREMENTS,
            );
          }}
          onMeasurementChange={(measurement, valueMm) =>
            setMeasurements((current) => ({
              ...current,
              [measurement]: valueMm,
            }))
          }
        />

        <div className="template-grid">
          {PATTERN_TEMPLATES.map((template) => (
            <button
              className="template-card"
              key={template.id}
              type="button"
              disabled={template.status !== "ready"}
              onClick={() => chooseTemplate(template.id)}
            >
              <span className={`template-icon template-icon-${template.id}`} aria-hidden="true" />
              <span className="template-card-copy">
                <span className="template-category">{template.category}</span>
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <small>{template.pieces}</small>
                <small><strong>Usa:</strong> {template.requiredMeasurements.join(", ")}</small>
                <small><strong>Estimadas:</strong> {template.estimatedMeasurements.join(", ")}</small>
                {template.status === "development" ? <small className="template-status">Em desenvolvimento</small> : null}
              </span>
            </button>
          ))}
        </div>

        {error ? <div className="dialog-error">{error}</div> : null}
        <footer className="dialog-note">
          As medidas listadas como estimadas usam proporções antropométricas e devem ser conferidas. Faça um protótipo antes de cortar o tecido definitivo.
        </footer>
      </section>
    </div>
  );
});
