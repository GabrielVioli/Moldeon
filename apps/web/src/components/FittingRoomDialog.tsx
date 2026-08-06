import { memo, useEffect, useMemo, useState } from "react";
import {
  FABRIC_PRESETS,
  availableFabricAreaMm2,
} from "../domain/fabric";
import {
  createPreviewPlacement,
  polygonAreaMm2,
  type PatternPreviewPlacement,
  type PreviewBodySide,
  type PreviewRegion,
  type PreviewSurface,
} from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { BodyMeasurementsForm } from "./BodyMeasurementsForm";

type FittingSection = "body" | "fabrics" | "placement";

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
  const setBodyMeasurement = useEditorStore(
    (state) => state.setBodyMeasurement,
  );
  const resetBodyMeasurement = useEditorStore((state) => state.resetBodyMeasurement);
  const setBodyMeasurementFormula = useEditorStore((state) => state.setBodyMeasurementFormula);
  const addFabric = useEditorStore((state) => state.addFabric);
  const updateFabric = useEditorStore((state) => state.updateFabric);
  const chooseFabricPreset = useEditorStore(
    (state) => state.applyFabricPreset,
  );
  const removeFabric = useEditorStore((state) => state.removeFabric);
  const assignFabric = useEditorStore(
    (state) => state.assignFabricToActivePiece,
  );
  const setPlacements = useEditorStore(
    (state) => state.setActivePiecePlacements,
  );
  const [section, setSection] = useState<FittingSection>("fabrics");

  const activePiece =
    garment.pieces.find((piece) => piece.id === activePieceId) ??
    garment.pieces[0];
  const activeFabric =
    garment.fabrics.find((source) => source.id === activePiece.fabricId) ??
    garment.fabrics[0];
  const placement: PatternPreviewPlacement =
    activePiece.previewPlacements?.[0] ?? createPreviewPlacement(activePiece.id);
  const duplicatedOnBothSides =
    (activePiece.previewPlacements?.length ?? 0) > 1;
  const usageByFabric = useMemo(
    () =>
      new Map(
        garment.fabrics.map((source) => [
          source.id,
          garment.pieces
            .filter((piece) => piece.fabricId === source.id)
            .reduce((total, piece) => {
              const cutMultiplier =
                (piece.cutQuantity ?? 1) * (piece.cutOnFold ? 2 : 1);
              return total + polygonAreaMm2(piece.points) * cutMultiplier;
            }, 0),
        ]),
      ),
    [garment.fabrics, garment.pieces],
  );

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
    const base = { ...placement, ...next };
    if (
      duplicate &&
      (base.region === "leg" || base.region === "arm")
    ) {
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
      >
        <header className="dialog-header">
          <div>
            <span className="section-eyebrow">Sala de prova</span>
            <h1 id="fitting-title">Corpo, tecido e posição</h1>
            <p>
              Configure o que muda o caimento antes de vestir a roupa no 3D.
            </p>
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

        <nav className="fitting-tabs" aria-label="Configuração do 3D">
          <FittingTab
            active={section === "body"}
            onClick={() => setSection("body")}
          >
            1. Corpo
          </FittingTab>
          <FittingTab
            active={section === "fabrics"}
            onClick={() => setSection("fabrics")}
          >
            2. Tecidos
          </FittingTab>
          <FittingTab
            active={section === "placement"}
            onClick={() => setSection("placement")}
          >
            3. Posição
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
                <span className="fitting-tip">
                  As medidas ficam salvas neste projeto.
                </span>
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

          {section === "fabrics" ? (
            <section className="fitting-section">
              <div className="fitting-section-heading">
                <div>
                  <span className="section-eyebrow">
                    Peça ativa · {activePiece.name}
                  </span>
                  <h2>Qual tecido esta peça usa?</h2>
                </div>
                <span className="fitting-tip">
                  Troque a peça no editor para atribuir outro retalho.
                </span>
              </div>

              <div className="fabric-preset-grid">
                {FABRIC_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={activeFabric.presetId === preset.id}
                    onClick={() =>
                      chooseFabricPreset(activeFabric.id, preset.id)
                    }
                  >
                    <span
                      className="fabric-swatch"
                      style={{ backgroundColor: preset.color }}
                    />
                    <span>
                      <strong>{preset.name}</strong>
                      <small>{preset.description}</small>
                    </span>
                  </button>
                ))}
              </div>

              <div className="fabric-source-heading">
                <div>
                  <strong>Tecidos e retalhos disponíveis</strong>
                  <span>
                    Adicione outras peças de roupa ou sobras para um projeto
                    upcycled.
                  </span>
                </div>
                <button
                  className="add-fabric-button"
                  type="button"
                  onClick={() => {
                    const fabricId = addFabric("cotton");
                    assignFabric(fabricId);
                  }}
                >
                  + Adicionar tecido
                </button>
              </div>

              <div className="fabric-source-list">
                {garment.fabrics.map((source) => {
                  const usage = usageByFabric.get(source.id) ?? 0;
                  const available = availableFabricAreaMm2(source);
                  return (
                    <article
                      className={`fabric-source-card${
                        source.id === activePiece.fabricId ? " is-assigned" : ""
                      }`}
                      key={source.id}
                    >
                      <button
                        className="fabric-assignment"
                        type="button"
                        onClick={() => assignFabric(source.id)}
                        aria-pressed={source.id === activePiece.fabricId}
                      >
                        <span
                          className="fabric-swatch"
                          style={{ backgroundColor: source.color }}
                        />
                        <span>
                          <strong>{source.name}</strong>
                          <small>
                            {source.id === activePiece.fabricId
                              ? `Usado em ${activePiece.name}`
                              : "Usar na peça ativa"}
                          </small>
                        </span>
                      </button>

                      <div className="fabric-source-fields">
                        <label>
                          Nome
                          <input
                            value={source.name}
                            onChange={(event) =>
                              updateFabric(source.id, {
                                name: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Cor
                          <input
                            type="color"
                            value={source.color}
                            onChange={(event) =>
                              updateFabric(source.id, {
                                color: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <FabricSizeField
                          label="Largura"
                          valueMm={source.widthMm}
                          onChange={(widthMm) =>
                            updateFabric(source.id, { widthMm })
                          }
                        />
                        <FabricSizeField
                          label="Comprimento"
                          valueMm={source.lengthMm}
                          onChange={(lengthMm) =>
                            updateFabric(source.id, { lengthMm })
                          }
                        />
                        <label>
                          Quantidade
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={source.quantity}
                            onChange={(event) =>
                              updateFabric(source.id, {
                                quantity: event.currentTarget.valueAsNumber,
                              })
                            }
                          />
                        </label>
                      </div>

                      <div
                        className={`fabric-area-status${
                          usage > available ? " is-insufficient" : ""
                        }`}
                      >
                        <span>
                          Molde ≈ {formatArea(usage)} · disponível{" "}
                          {formatArea(available)}
                        </span>
                        {garment.fabrics.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeFabric(source.id)}
                          >
                            Remover
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {section === "placement" ? (
            <section className="fitting-section">
              <div className="fitting-section-heading">
                <div>
                  <span className="section-eyebrow">
                    Peça ativa · {activePiece.name}
                  </span>
                  <h2>Onde esta peça fica no corpo?</h2>
                </div>
              </div>

              <div className="placement-grid">
                <label>
                  Região
                  <select
                    value={placement.region}
                    onChange={(event) =>
                      updatePlacement({
                        region: event.currentTarget.value as PreviewRegion,
                      })
                    }
                  >
                    {REGION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Lado visível
                  <select
                    value={placement.surface}
                    onChange={(event) =>
                      updatePlacement({
                        surface: event.currentTarget.value as PreviewSurface,
                      })
                    }
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
                    disabled={
                      duplicatedOnBothSides &&
                      (placement.region === "leg" ||
                        placement.region === "arm")
                    }
                    onChange={(event) =>
                      updatePlacement({
                        bodySide: event.currentTarget.value as PreviewBodySide,
                      })
                    }
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
                  disabled={
                    placement.region !== "leg" &&
                    placement.region !== "arm"
                  }
                  onChange={(event) =>
                    updatePlacement({}, event.currentTarget.checked)
                  }
                />
                <span>
                  <strong>Usar nos dois lados</strong>
                  <small>Para mangas e pernas cortadas em par.</small>
                </span>
              </label>

              <div className="placement-summary">
                A peça <strong>{activePiece.name}</strong> será posicionada em{" "}
                <strong>
                  {regionLabel(placement.region).toLowerCase()}
                </strong>
                , na <strong>{placement.surface === "front" ? "frente" : "parte de trás"}</strong>
                {duplicatedOnBothSides ? ", dos dois lados" : ""}.
              </div>
              <button
                className="secondary-dialog-button"
                type="button"
                onClick={() => setPlacements([])}
              >
                Remover do corpo
              </button>
            </section>
          ) : null}
        </div>

        <footer className="fitting-footer">
          <span>
            O consumo é aproximado e ainda não considera encaixe automático.
          </span>
          <div>
            <button className="secondary-dialog-button" type="button" onClick={onClose}>
              Fechar
            </button>
            <button className="primary-dialog-button" type="button" onClick={onPreview}>
              Vestir no 3D
            </button>
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
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FabricSizeField({
  label,
  valueMm,
  onChange,
}: {
  label: string;
  valueMm: number;
  onChange(valueMm: number): void;
}) {
  return (
    <label>
      {label}
      <span className="measurement-input">
        <input
          type="number"
          min="1"
          step="1"
          value={Number((valueMm / 10).toFixed(1))}
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

function formatArea(areaMm2: number): string {
  if (areaMm2 < 10_000) return `${Math.round(areaMm2 / 100)} cm²`;
  return `${(areaMm2 / 1_000_000).toFixed(2)} m²`;
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
