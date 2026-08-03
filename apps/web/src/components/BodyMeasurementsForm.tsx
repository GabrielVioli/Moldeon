import { memo } from "react";
import type { BodyMeasurements, BodyType } from "../domain/pattern";
import { deriveAnatomicalMeasurements } from "../domain/anatomicalBody";

interface BodyMeasurementsFormProps {
  bodyType: BodyType;
  measurements: BodyMeasurements;
  compact?: boolean;
  onBodyTypeChange(bodyType: BodyType): void;
  onMeasurementChange(
    measurement: keyof BodyMeasurements,
    valueMm: number,
  ): void;
}

const MEASUREMENT_FIELDS = [
  { key: "heightMm", label: "Altura", minimumCm: 130, maximumCm: 210 },
  { key: "bustMm", label: "Busto/tórax", minimumCm: 60, maximumCm: 160 },
  { key: "waistMm", label: "Cintura", minimumCm: 50, maximumCm: 150 },
  { key: "hipMm", label: "Quadril", minimumCm: 65, maximumCm: 170 },
  { key: "shoulderWidthMm", label: "Largura de ombros", minimumCm: 30, maximumCm: 65 },
  { key: "torsoLengthMm", label: "Comprimento do tronco", minimumCm: 32, maximumCm: 65 },
  { key: "armLengthMm", label: "Comprimento do braço", minimumCm: 43, maximumCm: 85 },
  { key: "inseamMm", label: "Entreperna", minimumCm: 58, maximumCm: 110 },
  { key: "bicepMm", label: "Bíceps", minimumCm: 18, maximumCm: 65 },
  { key: "wristMm", label: "Punho", minimumCm: 10, maximumCm: 35 },
  { key: "thighMm", label: "Coxa", minimumCm: 30, maximumCm: 100 },
  { key: "calfMm", label: "Panturrilha", minimumCm: 20, maximumCm: 70 },
] as const satisfies readonly {
  key: keyof BodyMeasurements;
  label: string;
  minimumCm: number;
  maximumCm: number;
}[];
export const BodyMeasurementsForm = memo(function BodyMeasurementsForm({
  bodyType,
  measurements,
  compact = false,
  onBodyTypeChange,
  onMeasurementChange,
}: BodyMeasurementsFormProps) {
  const completeMeasurements = deriveAnatomicalMeasurements(measurements);
  return (
    <div className={`body-form${compact ? " is-compact" : ""}`}>
      <div className="body-type-picker" role="group" aria-label="Tipo de corpo">
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

      <div className="body-measurement-grid">
        {MEASUREMENT_FIELDS.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <span className="measurement-input">
              <input
                type="number"
                min={field.minimumCm}
                max={field.maximumCm}
                step="0.5"
                value={Number((completeMeasurements[field.key] / 10).toFixed(1))}
                onChange={(event) => {
                  const valueCm = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(valueCm)) {
                    onMeasurementChange(field.key, valueCm * 10);
                  }
                }}
              />
              <span>cm</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
});
