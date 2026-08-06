import { memo, useEffect, useMemo, useState } from "react";
import type { GarmentDraft } from "../domain/pattern";
import {
  changeMeasurementBodyType,
  createDefaultMeasurementProfile,
  measurementProfileToBodyMeasurements,
  overrideMeasurement,
  resetMeasurementOverride,
  updateMeasurementFormula,
} from "../domain/parametricMeasurements";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import {
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
  const [profile, setProfile] = useState(() => createDefaultMeasurementProfile("feminine"));
  const measurements = useMemo(() => measurementProfileToBodyMeasurements(profile), [profile]);
  const bodyType = profile.bodyType;
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
      const generated = createGarmentFromTemplate(
        templateId,
        measurements,
        bodyType,
        profile,
      );
      onChoose(resolveTemplateAssemblyGarment(generated));
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
          measurementProfile={profile}
          onBodyTypeChange={(nextBodyType) => setProfile((current) => changeMeasurementBodyType(current, nextBodyType))}
          onMeasurementChange={(measurement, value) => {
            const result = overrideMeasurement(profile, measurement, value);
            if (result.accepted) setProfile(result.profile);
          }}
          onResetMeasurement={(measurement) => {
            const result = resetMeasurementOverride(profile, measurement);
            if (result.accepted) setProfile(result.profile);
          }}
          onFormulaChange={(measurement, expression) => {
            const result = updateMeasurementFormula(profile, measurement, expression);
            if (result.accepted) setProfile(result.profile);
            return result;
          }}
        />

        <div className="template-grid">
          {PATTERN_TEMPLATES.map((template) => (
            <button
              className="template-card"
              key={template.id}
              type="button"
              disabled={template.status !== "available"}
              onClick={() => chooseTemplate(template.id)}
            >
              <span
                className={`template-icon template-icon-${template.id}`}
                aria-hidden="true"
              />
              <span className="template-card-copy">
                <span className="template-category">{template.category}</span>
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <small>{template.pieces}</small>
                <small>
                  <strong>Usa:</strong> {template.requiredMeasurements.join(", ")}
                </small>
                <small>
                  <strong>Estimadas:</strong> {template.estimatedMeasurements.join(", ")}
                </small>
                <small className="template-status">
                  {template.status === "development"
                    ? "Em desenvolvimento"
                    : validationLabel(template.validationStatus)}
                </small>
                <small>{template.reviewNotes[0]}</small>
              </span>
            </button>
          ))}
        </div>

        {error ? <div className="dialog-error">{error}</div> : null}
        <footer className="dialog-note">
          As medidas listadas como estimadas usam proporções antropométricas e
          devem ser conferidas. Faça um protótipo antes de cortar o tecido
          definitivo.
        </footer>
      </section>
    </div>
  );
});

function validationLabel(status: "experimental" | "geometrically-validated" | "manually-reviewed"): string {
  if (status === "manually-reviewed") return "Revisado manualmente";
  if (status === "geometrically-validated") return "Validado geometricamente · prova manual pendente";
  return "Experimental · não validado manualmente";
}
