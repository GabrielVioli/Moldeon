import { memo } from "react";
import type { BodyMeasurements, BodyType } from "../domain/pattern";

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

const MEASUREMENT_FIELDS: readonly {
  key: keyof BodyMeasurements;
  label: string;
  minimumCm: number;
  maximumCm: number;
}[] = [
  { key: "heightMm", label: "Altura", minimumCm: 130, maximumCm: 210 },
  { key: "bustMm", label: "Busto/tórax", minimumCm: 60, maximumCm: 160 },
  { key: "waistMm", label: "Cintura", minimumCm: 50, maximumCm: 150 },
  { key: "hipMm", label: "Quadril", minimumCm: 65, maximumCm: 170 },
  {
    key: "shoulderWidthMm",
    label: "Largura de ombros",
    minimumCm: 30,
    maximumCm: 65,
  },
  {
    key: "torsoLengthMm",
    label: "Comprimento do tronco",
    minimumCm: 32,
    maximumCm: 65,
  },
  {
    key: "armLengthMm",
    label: "Comprimento do braço",
    minimumCm: 43,
    maximumCm: 85,
  },
  {
    key: "inseamMm",
    label: "Entreperna",
    minimumCm: 58,
    maximumCm: 110,
  },
] as const;

export const BodyMeasurementsForm = memo(function BodyMeasurementsForm({
  bodyType,
  measurements,
  compact = false,
  onBodyTypeChange,
  onMeasurementChange,
}: BodyMeasurementsFormProps) {
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
                value={Number((measurements[field.key] / 10).toFixed(1))}
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
