import { memo, useEffect, useState } from "react";
import {
  createPreviewPlacement,
  type PatternPreviewPlacement,
  type PreviewBodySide,
  type PreviewRegion,
  type PreviewSurface,
} from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { BodyMeasurementsForm } from "./BodyMeasurementsForm";

type FittingSection = "body" | "placement";

interface FittingRoomDialogProps {
  onClose(): void;
  onPreview(): void;
}

const REGION_OPTIONS: readonly { value: PreviewRegion; label: string }[] = [
  { value: "torso", label: "Tronco / blusa" },
  { value: "waist", label: "Cintura" },
  { value: "hip", label: "Quadril / saia" },
  { value: "leg", label: "Perna / calça" },
  { value: "arm", label: "Braço / manga" },
];

export const FittingRoomDialog = memo(function FittingRoomDialog({
  onClose,
  onPreview,
}: FittingRoomDialogProps) {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const setBodyType = useEditorStore((state) => state.setBodyType);
  const setBodyMeasurement = useEditorStore((state) => state.setBodyMeasurement);
  const resetBodyMeasurement = useEditorStore((state) => state.resetBodyMeasurement);
  const setBodyMeasurementFormula = useEditorStore((state) => state.setBodyMeasurementFormula);
  const setPlacements = useEditorStore((state) => state.setActivePiecePlacements);
  const [section, setSection] = useState<FittingSection>("body");

  const activePiece =
    garment.pieces.find((piece) => piece.id === activePieceId) ?? garment.pieces[0];
  const placement: PatternPreviewPlacement =
    activePiece?.previewPlacements?.[0] ?? createPreviewPlacement(activePiece?.id ?? "preview-piece");
  const duplicatedOnBothSides = (activePiece?.previewPlacements?.length ?? 0) > 1;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const updatePlacement = (
    next: Partial<PatternPreviewPlacement>,
    duplicate = duplicatedOnBothSides,
  ) => {
    if (!activePiece) return;
    const base = { ...placement, ...next, pieceId: activePiece.id };
    if (duplicate && (base.region === "leg" || base.region === "arm")) {
      setPlacements([
        { ...base, bodySide: "left", mirrorX: false },
        { ...base, bodySide: "right", mirrorX: true },
      ]);
      return;
    }
    setPlacements([{ ...base, mirrorX: false }]);
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
        className="fitting-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fitting-title"
        data-testid="fitting-dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="section-eyebrow">Sala de prova</span>
            <h1 id="fitting-title">Corpo e posição</h1>
            <p>Defina as medidas reais e onde a peça deve ficar antes de abrir a prova 3D.</p>
          </div>
          <button
            className="dialog-close"
            type="button"
            onClick={onClose}
            aria-label="Fechar sala de prova"
          >
            ×
          </button>
        </header>

        <nav className="fitting-tabs fitting-tabs-compact" aria-label="Configuração do 3D">
          <FittingTab active={section === "body"} onClick={() => setSection("body")}>
            Corpo
          </FittingTab>
          <FittingTab active={section === "placement"} onClick={() => setSection("placement")}>
            Posição
          </FittingTab>
        </nav>

        <div className="fitting-content">
          {section === "body" ? (
            <section className="fitting-section">
              <div className="fitting-section-heading">
                <div>
                  <span className="section-eyebrow">Avatar proporcional</span>
                  <h2>Use as medidas reais do corpo</h2>
                </div>
                <span className="fitting-tip">As medidas ficam salvas neste projeto.</span>
              </div>
              <BodyMeasurementsForm
                bodyType={garment.bodyType}
                measurements={garment.measurements}
                measurementProfile={garment.measurementProfile}
                onBodyTypeChange={setBodyType}
                onMeasurementChange={setBodyMeasurement}
                onResetMeasurement={resetBodyMeasurement}
                onFormulaChange={setBodyMeasurementFormula}
              />
            </section>
          ) : null}

          {section === "placement" ? (
            <section className="fitting-section">
              <div className="fitting-section-heading">
                <div>
                  <span className="section-eyebrow">
                    {activePiece ? `Peça ativa · ${activePiece.name}` : "Nenhuma peça ativa"}
                  </span>
                  <h2>Onde esta peça fica no corpo?</h2>
                </div>
              </div>

              {activePiece ? (
                <>
                  <div className="placement-grid">
                    <label>
                      Região
                      <select
                        value={placement.region}
                        onChange={(event) => updatePlacement({ region: event.currentTarget.value as PreviewRegion })}
                      >
                        {REGION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Lado visível
                      <select
                        value={placement.surface}
                        onChange={(event) => updatePlacement({ surface: event.currentTarget.value as PreviewSurface })}
                      >
                        <option value="front">Frente</option>
                        <option value="back">Costas</option>
                        <option value="side">Lateral</option>
                      </select>
                    </label>
                    <label>
                      Lado do corpo
                      <select
                        value={placement.bodySide}
                        disabled={duplicatedOnBothSides && (placement.region === "leg" || placement.region === "arm")}
                        onChange={(event) => updatePlacement({ bodySide: event.currentTarget.value as PreviewBodySide })}
                      >
                        <option value="center">Central</option>
                        <option value="left">Esquerdo</option>
                        <option value="right">Direito</option>
                      </select>
                    </label>
                  </div>

                  <div className="placement-grid placement-adjustments">
                    <PlacementField label="Rotação" value={placement.rotationDeg} onChange={(rotationDeg) => updatePlacement({ rotationDeg })} />
                    <PlacementField label="Deslocamento X" value={placement.offsetXMm} onChange={(offsetXMm) => updatePlacement({ offsetXMm })} />
                    <PlacementField label="Deslocamento Y" value={placement.offsetYMm} onChange={(offsetYMm) => updatePlacement({ offsetYMm })} />
                    <PlacementField label="Afastamento" value={placement.offsetZMm} onChange={(offsetZMm) => updatePlacement({ offsetZMm })} />
                    <label>
                      Escala
                      <input
                        type="number"
                        min="0.1"
                        step="0.05"
                        value={placement.scale}
                        onChange={(event) => {
                          const scale = event.currentTarget.valueAsNumber;
                          if (Number.isFinite(scale) && scale > 0) updatePlacement({ scale });
                        }}
                      />
                    </label>
                  </div>

                  <label className="duplicate-placement">
                    <input
                      type="checkbox"
                      checked={duplicatedOnBothSides}
                      disabled={placement.region !== "leg" && placement.region !== "arm"}
                      onChange={(event) => updatePlacement({}, event.currentTarget.checked)}
                    />
                    <span>
                      <strong>Usar nos dois lados</strong>
                      <small>Para mangas e pernas cortadas em par.</small>
                    </span>
                  </label>

                  <div className="placement-summary">
                    A peça <strong>{activePiece.name}</strong> será posicionada em{" "}
                    <strong>{regionLabel(placement.region).toLowerCase()}</strong>, na{" "}
                    <strong>{placement.surface === "front" ? "frente" : placement.surface === "back" ? "parte de trás" : "lateral"}</strong>
                    {duplicatedOnBothSides ? ", dos dois lados" : ""}.
                  </div>
                  <button className="secondary-dialog-button" type="button" onClick={() => setPlacements([])}>
                    Remover do corpo
                  </button>
                </>
              ) : (
                <p className="dialog-note">Crie ou selecione uma peça antes de configurar a posição no corpo.</p>
              )}
            </section>
          ) : null}
        </div>

        <footer className="fitting-footer">
          <span>A configuração de tecido permanece no projeto, mas os controles experimentais foram retirados desta tela.</span>
          <div>
            <button className="secondary-dialog-button" type="button" onClick={onClose}>Fechar</button>
            <button className="primary-dialog-button" type="button" onClick={onPreview}>Vestir no 3D</button>
          </div>
        </footer>
      </section>
    </div>
  );
});

function FittingTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: string;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

function PlacementField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) {
  return (
    <label>
      {label} (mm/°)
      <input
        type="number"
        step="1"
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function regionLabel(region: PreviewRegion): string {
  return REGION_OPTIONS.find((option) => option.value === region)?.label ?? region;
}
