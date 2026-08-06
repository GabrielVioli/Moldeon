import { memo, useEffect, useMemo, useState } from "react";
import type { BodyMeasurements, BodyType } from "../domain/pattern";
import {
  BODY_MEASUREMENT_CATALOG,
  createMeasurementProfile,
  type BodyMeasurementKey,
  type MeasurementFormulaUpdateResult,
  type MeasurementOrigin,
  type MeasurementProfile,
} from "../domain/parametricMeasurements";

interface BodyMeasurementsFormProps {
  bodyType: BodyType;
  measurements: BodyMeasurements;
  measurementProfile?: MeasurementProfile;
  compact?: boolean;
  onBodyTypeChange(bodyType: BodyType): void;
  onMeasurementChange(measurement: BodyMeasurementKey, value: number): void;
  onResetMeasurement?(measurement: BodyMeasurementKey): void;
  onFormulaChange?(
    measurement: BodyMeasurementKey,
    expression: string,
  ): MeasurementFormulaUpdateResult;
  onEditStart?(): void;
  onEditEnd?(): void;
  onEditCancel?(): void;
}

const GROUPS = [
  { id: "general", label: "Medidas gerais", open: true },
  { id: "neck-shoulder", label: "Pescoço e ombros", open: false },
  { id: "torso", label: "Tronco", open: false },
  { id: "arm", label: "Braços", open: false },
  { id: "hip", label: "Quadril e gancho", open: false },
  { id: "leg", label: "Pernas", open: false },
  { id: "other", label: "Outras medidas", open: false },
] as const;

export const BodyMeasurementsForm = memo(function BodyMeasurementsForm({
  bodyType,
  measurements,
  measurementProfile,
  compact = false,
  onBodyTypeChange,
  onMeasurementChange,
  onResetMeasurement,
  onFormulaChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
}: BodyMeasurementsFormProps) {
  const [advanced, setAdvanced] = useState(false);
  const [formulaDrafts, setFormulaDrafts] = useState<Record<string, string>>({});
  const [formulaErrors, setFormulaErrors] = useState<Record<string, string>>({});
  const profile = useMemo(
    () => createMeasurementProfile(measurements, bodyType, measurementProfile),
    [bodyType, measurementProfile, measurements],
  );

  useEffect(() => {
    setFormulaDrafts(
      Object.fromEntries(
        BODY_MEASUREMENT_CATALOG.flatMap((catalog) => {
          const formula = profile.entries[catalog.key]?.formula;
          return formula ? [[catalog.key, formula]] : [];
        }),
      ),
    );
  }, [profile]);

  const commitFormula = (key: BodyMeasurementKey) => {
    const entry = profile.entries[key];
    const expression = formulaDrafts[key] ?? entry?.formula ?? "";
    if (!onFormulaChange || !entry?.formula) return;
    const result = onFormulaChange(key, expression);
    if (!result.accepted) {
      setFormulaErrors((current) => ({
        ...current,
        [key]: result.error ?? "A fórmula não pôde ser aplicada.",
      }));
      return;
    }
    setFormulaErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  return (
    <div className={`body-form${compact ? " is-compact" : ""}`}>
      <div className="body-form-toolbar">
        <div className="body-type-picker" role="group" aria-label="Tipo de corpo para valores iniciais">
          <button
            type="button"
            aria-pressed={bodyType === "feminine"}
            onClick={() => onBodyTypeChange("feminine")}
          >
            <span className="body-type-icon body-type-feminine" aria-hidden="true" />
            Feminino
          </button>
          <button
            type="button"
            aria-pressed={bodyType === "masculine"}
            onClick={() => onBodyTypeChange("masculine")}
          >
            <span className="body-type-icon body-type-masculine" aria-hidden="true" />
            Masculino
          </button>
        </div>
        <button
          type="button"
          className="measurement-mode-toggle"
          aria-pressed={advanced}
          aria-controls="measurement-groups"
          title={advanced ? "Ocultar fórmulas e dependências" : "Mostrar fórmulas e dependências"}
          onClick={() => setAdvanced((current) => !current)}
        >
          {advanced ? "Modo simples" : "Modo avançado"}
        </button>
      </div>

      <p className="measurement-authority-note">
        O tipo corporal define somente valores iniciais. Medidas informadas por você sempre têm prioridade.
      </p>

      <div className="measurement-groups" id="measurement-groups">
        {GROUPS.map((group) => {
          const fields = BODY_MEASUREMENT_CATALOG.filter((field) => field.group === group.id);
          return (
            <details key={group.id} open={compact ? group.open : group.id === "general" || group.id === "torso"}>
              <summary>
                <span>{group.label}</span>
                <small>{fields.length} medidas</small>
              </summary>
              <div className="body-measurement-grid">
                {fields.map((field) => {
                  const entry = profile.entries[field.key];
                  if (!entry) return null;
                  const divisor = field.unit === "mm" ? 10 : 1;
                  const displayUnit = field.unit === "mm" ? "cm" : "°";
                  const value = Number((entry.value / divisor).toFixed(field.unit === "mm" ? 1 : 2));
                  const error = formulaErrors[field.key] ?? entry.error;
                  return (
                    <label key={field.key} className={`measurement-field origin-${entry.origin}${error ? " has-error" : ""}`}>
                      <span className="measurement-field-heading">
                        <span>{field.label}</span>
                        <span className="measurement-origin" title={originDescription(entry.origin)}>
                          {originLabel(entry.origin)}
                        </span>
                      </span>
                      <span className="measurement-input">
                        <input
                          type="number"
                          inputMode="decimal"
                          aria-label={`${field.label} em ${displayUnit}`}
                          min={field.minimum / divisor}
                          max={field.maximum / divisor}
                          step={field.step / divisor}
                          value={value}
                          onFocus={(event) => {
                            onEditStart?.();
                            event.currentTarget.select();
                          }}
                          onBlur={onEditEnd}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") {
                              onEditCancel?.();
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => {
                            const next = event.currentTarget.valueAsNumber;
                            if (Number.isFinite(next)) onMeasurementChange(field.key, next * divisor);
                          }}
                        />
                        <span>{displayUnit}</span>
                      </span>
                      <span className="measurement-status">
                        {entry.overridden ? "Estimativa substituída" : originDescription(entry.origin)}
                        {entry.overridden && onResetMeasurement ? (
                          <button type="button" onClick={() => onResetMeasurement(field.key)}>
                            Restaurar cálculo
                          </button>
                        ) : null}
                      </span>
                      {advanced ? (
                        <span className="measurement-advanced">
                          {entry.formula ? (
                            <>
                              <span className="formula-label">Fórmula</span>
                              <textarea
                                rows={2}
                                spellCheck={false}
                                aria-label={`Fórmula de ${field.label}`}
                                value={formulaDrafts[field.key] ?? entry.formula}
                                onFocus={onEditStart}
                                onChange={(event) => {
                                  const expression = event.currentTarget.value;
                                  setFormulaDrafts((current) => ({ ...current, [field.key]: expression }));
                                }}
                                onBlur={() => {
                                  commitFormula(field.key);
                                  onEditEnd?.();
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur();
                                  if (event.key === "Escape") {
                                    setFormulaDrafts((current) => ({ ...current, [field.key]: entry.formula! }));
                                    setFormulaErrors((current) => {
                                      const next = { ...current };
                                      delete next[field.key];
                                      return next;
                                    });
                                    onEditCancel?.();
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                              <span className="formula-dependencies">
                                Depende de: {entry.dependencies.length > 0 ? entry.dependencies.join(", ") : "nenhuma medida"}
                              </span>
                              <span className="formula-version">Versão: {entry.formulaVersion ?? "não informada"}</span>
                            </>
                          ) : (
                            <span className="formula-direct">Medida direta, sem fórmula automática.</span>
                          )}
                          {error ? <span className="formula-error" role="alert">{error}</span> : null}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
});

function originLabel(origin: MeasurementOrigin): string {
  if (origin === "supplied") return "Informada";
  if (origin === "estimated") return "Estimada";
  return "Derivada";
}

function originDescription(origin: MeasurementOrigin): string {
  if (origin === "supplied") return "Valor informado e autoritativo";
  if (origin === "estimated") return "Estimativa substituível baseada em outras medidas";
  return "Valor calculado diretamente a partir de outras medidas";
}
