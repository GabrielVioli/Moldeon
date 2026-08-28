import { memo, useEffect, useState } from "react";
import { useEditorStore } from "../state/editorStore";
import { BodyMeasurementsForm } from "./BodyMeasurementsForm";
import { BodyPositionPanel } from "./BodyPositionPanel";

type FittingSection = "body" | "placement";

interface FittingRoomDialogProps {
  onClose(): void;
  onPreview(): void;
}

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
  const [section, setSection] = useState<FittingSection>("body");

  const activePiece =
    garment.pieces.find((piece) => piece.id === activePieceId) ?? garment.pieces[0];
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
                <BodyPositionPanel piece={activePiece} />
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
