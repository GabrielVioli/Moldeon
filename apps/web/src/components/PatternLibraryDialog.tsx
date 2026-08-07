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
import { ModalPortal } from "./ModalPortal";

interface PatternLibraryDialogProps {
  onClose(): void;
  onChoose(garment: GarmentDraft): void;
}

type LibraryChoice = PatternTemplateId | "blank";

export const PatternLibraryDialog = memo(function PatternLibraryDialog({
  onClose,
  onChoose,
}: PatternLibraryDialogProps) {
  const [profile, setProfile] = useState(() => createDefaultMeasurementProfile("feminine"));
  const [choice, setChoice] = useState<LibraryChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const measurements = useMemo(() => measurementProfileToBodyMeasurements(profile), [profile]);
  const bodyType = profile.bodyType;
  const selectedTemplate = choice && choice !== "blank"
    ? PATTERN_TEMPLATES.find((template) => template.id === choice)
    : null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const createSelection = () => {
    if (!choice) return;
    try {
      setError(null);
      if (choice === "blank") {
        const base = createGarmentFromTemplate("tshirt", measurements, bodyType, profile);
        onChoose({
          ...base,
          id: `garment-empty-${Date.now().toString(36)}`,
          templateId: "blank",
          name: "Projeto vazio",
          description: "Bancada vazia pronta para desenhar.",
          pieces: [],
          seams: [],
          workspaceTransforms: [],
          workspaceStates: [],
          assemblyPlacements: [],
          parametric: undefined,
        });
        return;
      }
      const generated = createGarmentFromTemplate(choice, measurements, bodyType, profile);
      onChoose(resolveTemplateAssemblyGarment(generated));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível gerar este molde-base.");
    }
  };

  return (
    <ModalPortal>
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
              <p>Escolha primeiro o que deseja criar. As medidas aparecem na etapa seguinte.</p>
            </div>
            <button className="dialog-close" type="button" onClick={onClose} aria-label="Fechar biblioteca">×</button>
          </header>

          <div className="pattern-library-scroll">
            <div className="template-first-heading">
              <h2>Qual molde vai para a bancada?</h2>
              <p>Todos os contornos continuarão editáveis depois da criação.</p>
            </div>

            <div className="template-grid recovery-template-grid">
              <button
                className={`template-card empty-project-card${choice === "blank" ? " is-selected" : ""}`}
                type="button"
                aria-pressed={choice === "blank"}
                onClick={() => setChoice("blank")}
              >
                <span className="template-icon" aria-hidden="true">＋</span>
                <span className="template-card-copy">
                  <span className="template-category">Projeto livre</span>
                  <strong>Bancada vazia</strong>
                  <span>Comece sem nenhuma peça e desenhe do zero.</span>
                  <small>Zero peças · undo preservado</small>
                </span>
              </button>

              {PATTERN_TEMPLATES.map((template) => (
                <button
                  className={`template-card${choice === template.id ? " is-selected" : ""}`}
                  key={template.id}
                  type="button"
                  disabled={template.status !== "available"}
                  aria-pressed={choice === template.id}
                  onClick={() => setChoice(template.id)}
                >
                  <span className={`template-icon template-icon-${template.id}`} aria-hidden="true" />
                  <span className="template-card-copy">
                    <span className="template-category">{template.category}</span>
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                    <small>{template.pieces}</small>
                    <small className="template-status">{template.status === "development" ? "Em desenvolvimento" : validationLabel(template.validationStatus)}</small>
                  </span>
                </button>
              ))}
            </div>

            {choice && choice !== "blank" ? (
              <section className="library-measurements" aria-label="Medidas do molde selecionado">
                <div className="template-first-heading">
                  <h2>Medidas para {selectedTemplate?.name}</h2>
                  <p>Os valores informados têm prioridade. Estimativas ficam claramente marcadas.</p>
                </div>
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
              </section>
            ) : null}
            {error ? <div className="dialog-error" role="alert">{error}</div> : null}
          </div>

          <footer className="library-actions">
            <span>{choice === "blank" ? "A bancada será criada sem peças." : selectedTemplate ? `${selectedTemplate.name} selecionado.` : "Selecione um molde ou uma bancada vazia."}</span>
            <div>
              <button className="secondary-dialog-button" type="button" onClick={onClose}>Cancelar</button>
              <button className="primary-dialog-button" type="button" disabled={!choice} onClick={createSelection}>
                {choice === "blank" ? "Criar bancada vazia" : "Criar molde"}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </ModalPortal>
  );
});

function validationLabel(status: "experimental" | "geometrically-validated" | "manually-reviewed"): string {
  if (status === "manually-reviewed") return "Revisado manualmente";
  if (status === "geometrically-validated") return "Validado geometricamente";
  return "Experimental";
}
