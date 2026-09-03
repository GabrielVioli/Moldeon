import { memo, useMemo, useState } from "react";
import {
  buildAssemblyGraph,
  evaluateGarment3DEligibility,
  type SeamCompatibility,
} from "../domain/assembly";
import {
  getPatternEdges,
  type SeamDistribution,
  type SeamDirection,
  type SeamTreatment,
} from "../domain/pattern";
import {
  groupSeamsByRelation,
  seamRelationLabel,
} from "../domain/templateAssemblySeams";
import { useEditorStore } from "../state/editorStore";
import { BodyPositionPanel } from "./BodyPositionPanel";

interface AssemblyPanelProps {
  previewRequested: boolean;
  onRequestPreview(): void;
  onDressBody(): void;
  mobileActive: boolean;
}

const TREATMENTS: Array<{ value: SeamTreatment; label: string }> = [
  { value: "standard", label: "Padrão" },
  { value: "ease", label: "Distribuir folga" },
  { value: "gather", label: "Franzir" },
  { value: "stretch", label: "Acomodar elasticidade" },
  { value: "intentional-mismatch", label: "Diferença intencional" },
];

export const AssemblyPanel = memo(function AssemblyPanel({
  previewRequested,
  onRequestPreview,
  onDressBody,
  mobileActive,
}: AssemblyPanelProps) {
  const garment = useEditorStore((state) => state.garment);
  const proposal = useEditorStore((state) => state.seamProposal);
  const cancelProposal = useEditorStore((state) => state.cancelSeamProposal);
  const confirmProposal = useEditorStore((state) => state.confirmSeamProposal);
  const updateSeam = useEditorStore((state) => state.updateSeam);
  const removeSeam = useEditorStore((state) => state.removeSeam);
  const selectedSeamId = useEditorStore((state) => state.selectedSeamId);
  const selectSeam = useEditorStore((state) => state.selectSeam);
  const toggleSeamDirection = useEditorStore((state) => state.toggleSeamDirection);
  const toggleSeamActive = useEditorStore((state) => state.toggleSeamActive);
  const setGarmentEase = useEditorStore((state) => state.setGarmentEase);
  const setEdgeFinish = useEditorStore((state) => state.setEdgeFinish);
  const graph = useMemo(
    () => buildAssemblyGraph(garment),
    [garment],
  );
  const eligibility = useMemo(
    () => evaluateGarment3DEligibility(garment),
    [garment],
  );
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const activePiece =
    garment.pieces.find((piece) => piece.id === activePieceId) ??
    garment.pieces[0];
  const seamGroups = groupSeamsByRelation(garment.seams);

  return (
    <aside
      className={`assembly-panel workspace-view${
        mobileActive ? " is-mobile-active" : ""
      }`}
      aria-label="Montagem da roupa"
    >
      <header>
        <span className="section-eyebrow">Montagem</span>
        <strong>
          {graph.connectedComponents.length} grupo(s) · {graph.openEdges.length}{" "}
          borda(s) ainda sem costura
        </strong>
      </header>

      {proposal ? (
        <SeamProposalForm
          key={`${proposal.first.pieceId}/${proposal.first.edgeId}/${proposal.second.pieceId}/${proposal.second.edgeId}`}
          sequence={(garment.seams?.length ?? 0) + 1}
          compatibility={proposal.compatibility}
          onCancel={cancelProposal}
          onConfirm={confirmProposal}
        />
      ) : (
        <p className="assembly-help">
          Use Costurar e clique em uma borda de cada peça. Você confirma a
          união na própria prancheta.
        </p>
      )}

      <section className="assembly-section">
        <h3>Costuras</h3>
        {seamGroups.length === 0 ? (
          <p>Nenhuma costura confirmada.</p>
        ) : (
          seamGroups.map((group) => {
            const representative = group[0];
            const selected = group.some((seam) => seam.id === selectedSeamId);
            const inactive = group.every((seam) => seam.active === false);
            return (
            <div className={`assembly-row seam-editor-row${selected ? " is-selected" : ""}${inactive ? " is-inactive" : ""}`} key={representative.groupId ?? representative.id} onClick={() => selectSeam(representative.id)}>
              <button
                type="button"
                className="seam-select-button"
                aria-label={"Selecionar costura " + seamRelationLabel(group)}
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  selectSeam(representative.id);
                }}
              >
                {selected ? "✓" : "○"}
              </button>
              <input
                aria-label="Nome da costura"
                value={seamRelationLabel(group)}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const label = event.currentTarget.value;
                  group.forEach((seam, index) => updateSeam(seam.id, {
                    name: group.length > 1 ? `${label} · trecho ${index + 1}` : label,
                  }));
                }}
              />
              <select
                aria-label="Tratamento"
                value={representative.treatment ?? "standard"}
                onChange={(event) => {
                  for (const seam of group) updateSeam(seam.id, {
                    treatment: event.currentTarget.value as SeamTreatment,
                  });
                }}
              >
                {TREATMENTS.map((treatment) => (
                  <option key={treatment.value} value={treatment.value}>
                    {treatment.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Distribuição da costura"
                value={representative.distribution ?? "uniform"}
                onChange={(event) => {
                  const distribution = event.currentTarget.value as SeamDistribution;
                  for (const seam of group) updateSeam(seam.id, { distribution });
                }}
              >
                <option value="uniform">Uniforme</option>
                <option value="proportional">Proporcional</option>
                <option value="center-biased">Concentrada no centro</option>
                <option value="custom">Personalizada</option>
              </select>
              <label className="seam-number-field">
                Proporção
                <input
                  aria-label="Proporção alvo da costura"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={representative.targetRatio ?? Math.max(0.01, 1 + representative.easeRatio)}
                  onChange={(event) => {
                    const targetRatio = Math.max(0.01, event.currentTarget.valueAsNumber || 1);
                    for (const seam of group) updateSeam(seam.id, { targetRatio });
                  }}
                />
              </label>
              <label className="seam-number-field">
                Folga (mm)
                <input
                  aria-label="Folga da costura em milímetros"
                  type="number"
                  min="0"
                  step="0.5"
                  value={representative.slackMm ?? 0}
                  onChange={(event) => {
                    const slackMm = Math.max(0, event.currentTarget.valueAsNumber || 0);
                    for (const seam of group) updateSeam(seam.id, { slackMm });
                  }}
                />
              </label>
              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) if ((seam.active === false) === inactive) toggleSeamActive(seam.id); }}>
                {inactive ? "Reativar" : "Desativar"}
              </button>
              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) toggleSeamDirection(seam.id); }}>
                Inverter direção
              </button>
              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) removeSeam(seam.id); }}>
                Excluir
              </button>
            </div>
            );
          })
        )}
      </section>

      <details className="assembly-advanced">
        <summary>Ajustes avançados</summary>

        {activePiece ? (
          <details className="assembly-panel-classification">
            <summary>Classificação técnica do painel ativo</summary>
            <BodyPositionPanel key={activePiece.id} piece={activePiece} />
          </details>
        ) : null}

        <section className="assembly-section">
          <h3>Folga da roupa</h3>
          <div className="ease-grid">
            {(["bustMm", "waistMm", "hipMm", "sleeveMm"] as const).map(
              (region) => (
                <label key={region}>
                  {
                    {
                      bustMm: "Busto",
                      waistMm: "Cintura",
                      hipMm: "Quadril",
                      sleeveMm: "Manga",
                    }[region]
                  }
                  <input
                    type="number"
                    step="0.1"
                    value={
                      (garment.ease?.[region] ??
                        {
                          bustMm: 80,
                          waistMm: 60,
                          hipMm: 80,
                          sleeveMm: 50,
                        }[region]) / 10
                    }
                    onChange={(event) =>
                      setGarmentEase(region, event.currentTarget.valueAsNumber * 10)
                    }
                  />{" "}
                  cm
                </label>
              ),
            )}
          </div>
        </section>

        {activePiece ? <section className="assembly-section">
          <h3>Acabamento de borda</h3>
          <select
            aria-label="Acabamento da primeira borda"
            value={
              activePiece.edgeFinishes?.[getPatternEdges(activePiece)[0]?.id] ??
              "raw"
            }
            onChange={(event) => {
              const edge = getPatternEdges(activePiece)[0];
              if (edge) {
                setEdgeFinish(
                  activePiece.id,
                  edge.id,
                  event.currentTarget.value as
                    | "raw"
                    | "hem"
                    | "binding"
                    | "facing"
                    | "elastic",
                );
              }
            }}
          >
            <option value="raw">Sem acabamento</option>
            <option value="hem">Bainha</option>
            <option value="binding">Viés</option>
            <option value="facing">Revel</option>
            <option value="elastic">Elástico</option>
          </select>
        </section> : null}
      </details>

      <section className="assembly-readiness" aria-live="polite">
        <strong>
          {eligibility.canPreviewGarment
            ? "Roupa pronta para montagem 3D"
            : "Complete a estrutura 2D"}
        </strong>
        {eligibility.issues.slice(0, 3).map((issue) => (
          <p key={issue}>{issue}</p>
        ))}
        {eligibility.warnings.slice(0, 2).map((warning) => (
          <p className="warning" key={warning}>
            {warning}
          </p>
        ))}
        <button
          type="button"
          disabled={!eligibility.canPreviewGarment}
          onClick={onRequestPreview}
        >
          {previewRequested ? "Atualizar roupa montada" : "Montar roupa em 3D"}
        </button>
        <button
          type="button"
          disabled={!eligibility.canDressBody}
          onClick={onDressBody}
        >
          Vestir no corpo
        </button>
      </section>
    </aside>
  );
});

function SeamProposalForm({
  sequence,
  compatibility,
  onCancel,
  onConfirm,
}: {
  sequence: number;
  compatibility: SeamCompatibility;
  onCancel(): void;
  onConfirm(options: {
    name: string;
    direction: SeamDirection;
    treatment: SeamTreatment;
  }): void;
}) {
  const [name, setName] = useState(`Costura ${sequence}`);
  const [direction, setDirection] = useState<SeamDirection>(
    compatibility.recommendedDirection,
  );
  const [treatment, setTreatment] = useState<SeamTreatment>(
    compatibility.recommendedTreatment,
  );

  return (
    <section
      className="seam-proposal"
      role="dialog"
      aria-label="Confirmar proposta de costura"
    >
      <h3>Proposta de costura</h3>
      <p>
        {(compatibility.firstLengthMm / 10).toFixed(1)} cm ↔{" "}
        {(compatibility.secondLengthMm / 10).toFixed(1)} cm
      </p>
      <p>{compatibility.message}</p>
      <input
        aria-label="Nome da nova costura"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <select
        aria-label="Direção da costura"
        value={direction}
        onChange={(event) =>
          setDirection(event.currentTarget.value as SeamDirection)
        }
      >
        <option value="opposite">Sentidos opostos</option>
        <option value="same">Mesmo sentido</option>
      </select>
      <select
        aria-label="Tratamento da costura"
        value={treatment}
        onChange={(event) =>
          setTreatment(event.currentTarget.value as SeamTreatment)
        }
      >
        {TREATMENTS.map((candidate) => (
          <option key={candidate.value} value={candidate.value}>
            {candidate.label}
          </option>
        ))}
      </select>
      <div>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={!compatibility.compatible}
          onClick={() => onConfirm({ name, direction, treatment })}
        >
          Confirmar
        </button>
      </div>
    </section>
  );
}
