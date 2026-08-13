import { memo, useState } from "react";
import type {
  GarmentDraft,
  GarmentDressingRegion,
  PatternPiece,
} from "../domain/pattern";
import type { DressingPreflight } from "../domain/assembly";
import { samplePatternContour } from "../domain/polygonGeometry";

const REGIONS: Array<{
  value: GarmentDressingRegion;
  label: string;
  description: string;
}> = [
  { value: "upper", label: "Parte superior", description: "Blusas, camisetas e jaquetas" },
  { value: "lower", label: "Parte inferior", description: "Saias, shorts e calças" },
  { value: "full", label: "Corpo inteiro", description: "Vestidos e macacões" },
  { value: "arm", label: "Braço", description: "Mangas e peças de braço" },
  { value: "neck", label: "Pescoço", description: "Golas e peças de pescoço" },
  { value: "custom", label: "Personalizado", description: "Uma montagem fora dessas regiões" },
];

interface DressingPreflightDialogProps {
  garment: GarmentDraft;
  preflight: DressingPreflight;
  onChooseRegion(region: GarmentDressingRegion): void;
  onChooseFront(pieceId: string): void;
  onFixSeams(): void;
  onClose(): void;
}

export const DressingPreflightDialog = memo(function DressingPreflightDialog({
  garment,
  preflight,
  onChooseRegion,
  onChooseFront,
  onFixSeams,
  onClose,
}: DressingPreflightDialogProps) {
  const [selectedReferencePieceId, setSelectedReferencePieceId] = useState<string | null>(null);
  const candidates = preflight.frontCandidateGroups.flatMap((group) => {
    const piece = garment.pieces.find((candidate) => candidate.id === group.referencePieceId);
    return piece ? [{ group, piece }] : [];
  });
  const hasBlockingIssue = preflight.issues.length > 0;

  return (
    <div className="dressing-preflight-backdrop" role="presentation">
      <section
        className="dressing-preflight-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dressing-preflight-title"
      >
        <header>
          <div>
            <span className="section-eyebrow">Provar</span>
            <h2 id="dressing-preflight-title">
              {hasBlockingIssue
                ? "Corrija isto antes de provar"
                : preflight.requiresRegion
                ? "Onde esta roupa deve ser vestida?"
                : preflight.requiresFrontReference
                  ? "Qual peça ou conjunto serve como referência frontal?"
                  : "Preparando a prova"}
            </h2>
          </div>
          <button type="button" aria-label="Fechar preparação da prova" onClick={onClose}>×</button>
        </header>

        {hasBlockingIssue ? (
          <div className="dressing-preflight-blocker" role="alert">
            <p>{preflight.issues[0]}</p>
            <button type="button" className="primary-button" onClick={onFixSeams}>Voltar às costuras</button>
          </div>
        ) : preflight.requiresRegion ? (
          <div className="dressing-region-grid">
            {REGIONS.map((region) => (
              <button type="button" key={region.value} onClick={() => onChooseRegion(region.value)}>
                <strong>{region.label}</strong>
                <span>{region.description}</span>
              </button>
            ))}
          </div>
        ) : preflight.requiresFrontReference ? (
          <>
            <p className="dressing-preflight-help">
              Escolha somente a referência frontal. Se ela possuir uma parte espelhada, o Moldeon selecionará o conjunto e orientará as demais peças pelas costuras.
            </p>
            <div className="dressing-piece-grid">
              {candidates.map(({ group, piece }) => {
                const selected = selectedReferencePieceId === group.referencePieceId;
                const isSet = group.panelInstanceIds.length > 1;
                return (
                  <button
                    type="button"
                    key={group.referencePieceId}
                    className={selected ? "is-selected" : undefined}
                    aria-label={`Usar ${piece.name}${isSet ? " e sua parte espelhada" : ""} como referência frontal`}
                    aria-pressed={selected}
                    onClick={() => setSelectedReferencePieceId(group.referencePieceId)}
                  >
                    <span className="dressing-piece-thumbnails" aria-hidden="true">
                      {group.panelInstanceIds.map((instanceId) => (
                        <PieceThumbnail
                          key={instanceId}
                          piece={piece}
                          mirrored={group.mirroredPanelInstanceIds.includes(instanceId)}
                          label={isSet
                            ? group.mirroredPanelInstanceIds.includes(instanceId)
                              ? "Parte espelhada"
                              : "Parte original"
                            : piece.name}
                        />
                      ))}
                    </span>
                    <strong>{piece.name}</strong>
                    <span>{isSet ? "Conjunto com parte espelhada" : "Peça única"}</span>
                  </button>
                );
              })}
            </div>
            <div className="dressing-reference-actions">
              <button type="button" onClick={onClose}>Cancelar</button>
              <button
                type="button"
                className="primary-button"
                disabled={selectedReferencePieceId === null}
                onClick={() => selectedReferencePieceId && onChooseFront(selectedReferencePieceId)}
              >
                Usar como referência frontal
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
});

function PieceThumbnail({
  piece,
  mirrored,
  label,
}: {
  piece: PatternPiece;
  mirrored: boolean;
  label: string;
}) {
  const contour = samplePatternContour(piece.points);
  const minX = Math.min(...contour.map((point) => point.xMm));
  const maxX = Math.max(...contour.map((point) => point.xMm));
  const minY = Math.min(...contour.map((point) => point.yMm));
  const maxY = Math.max(...contour.map((point) => point.yMm));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const padding = Math.max(width, height) * 0.08;
  const points = contour
    .map((point) => `${mirrored ? minX + maxX - point.xMm : point.xMm},${point.yMm}`)
    .join(" ");
  return (
    <span className="dressing-piece-thumbnail">
      <svg
        viewBox={`${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <polygon points={points} />
      </svg>
      <small>{label}</small>
    </span>
  );
}
