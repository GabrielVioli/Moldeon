import { memo, useMemo, useState } from "react";
import {
  buildAssemblyGraph,
  evaluateGarment3DEligibility,
  type SeamCompatibility,
} from "../domain/assembly";
import {
  getPatternEdges,
  type SeamDirection,
  type SeamTreatment,
} from "../domain/pattern";
import {
  resolveTemplateAssemblyGarment,
  templateAssemblyNeedsRepair,
} from "../domain/templateAssemblySeams";
import { useEditorStore } from "../state/editorStore";

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
  const setAssemblyPlacement = useEditorStore(
    (state) => state.setAssemblyPlacement,
  );
  const setGarmentEase = useEditorStore((state) => state.setGarmentEase);
  const setEdgeFinish = useEditorStore((state) => state.setEdgeFinish);
  const resolvedGarment = useMemo(
    () => resolveTemplateAssemblyGarment(garment),
    [garment],
  );
  const needsTemplateRepair = useMemo(
    () => templateAssemblyNeedsRepair(garment),
    [garment],
  );
  const graph = useMemo(
    () => buildAssemblyGraph(resolvedGarment),
    [resolvedGarment],
  );
  const eligibility = useMemo(
    () => evaluateGarment3DEligibility(resolvedGarment),
    [resolvedGarment],
  );
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const activePiece =
    garment.pieces.find((piece) => piece.id === activePieceId) ??
    garment.pieces[0];
  const placement = garment.assemblyPlacements?.find(
    (candidate) => candidate.pieceId === activePiece.id,
  );

  const repairTemplateAssembly = () => {
    useEditorStore.setState((state) => {
      const resolved = resolveTemplateAssemblyGarment(state.garment);

      if (!templateAssemblyNeedsRepair(state.garment)) {
        return state;
      }

      return {
        garment: resolved,
        seamIssues: [],
        seamProposal: null,
        seamFirstEdge: null,
        nearbySeamSuggestion: null,
        simulateVersion: state.simulateVersion + 1,
      };
    });
  };

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

      {needsTemplateRepair ? (
        <section className="assembly-section">
          <strong>O molde-base possui costuras incompatíveis.</strong>
          <p>
            Corrija automaticamente ombros, laterais, mangas e cavas usando a
            função de cada borda.
          </p>
          <button type="button" onClick={repairTemplateAssembly}>
            Corrigir costuras do molde-base
          </button>
        </section>
      ) : null}

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
        {(garment.seams ?? []).length === 0 ? (
          <p>Nenhuma costura confirmada.</p>
        ) : (
          (garment.seams ?? []).map((seam) => (
            <div className={`assembly-row seam-editor-row${selectedSeamId === seam.id ? " is-selected" : ""}${seam.active === false ? " is-inactive" : ""}`} key={seam.id} onClick={() => selectSeam(seam.id)}>
              <input
                aria-label="Nome da costura"
                value={seam.name ?? seam.id}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) =>
                  updateSeam(seam.id, { name: event.currentTarget.value })
                }
              />
              <select
                aria-label="Tratamento"
                value={seam.treatment ?? "standard"}
                onChange={(event) =>
                  updateSeam(seam.id, {
                    treatment: event.currentTarget.value as SeamTreatment,
                  })
                }
              >
                {TREATMENTS.map((treatment) => (
                  <option key={treatment.value} value={treatment.value}>
                    {treatment.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={(event) => { event.stopPropagation(); toggleSeamActive(seam.id); }}>
                {seam.active === false ? "Reativar" : "Desativar"}
              </button>
              <button type="button" onClick={(event) => { event.stopPropagation(); toggleSeamDirection(seam.id); }}>
                Inverter
              </button>
              <button type="button" onClick={(event) => { event.stopPropagation(); removeSeam(seam.id); }}>
                Excluir
              </button>
            </div>
          ))
        )}
      </section>

      <details className="assembly-advanced">
        <summary>Ajustes avançados</summary>

        <section className="assembly-section">
          <h3>Posição inicial · {activePiece.name}</h3>
          <div className="assembly-row">
            <select
              aria-label="Papel da peça"
              value={placement?.role ?? "custom"}
              onChange={(event) =>
                setAssemblyPlacement(activePiece.id, {
                  role: event.currentTarget.value as NonNullable<
                    typeof placement
                  >["role"],
                })
              }
            >
              <option value="front">Frente</option>
              <option value="back">Costas</option>
              <option value="sleeve">Manga</option>
              <option value="waist">Cintura</option>
              <option value="leg">Perna</option>
              <option value="collar">Gola</option>
              <option value="custom">Personalizada</option>
            </select>
            <button
              type="button"
              onClick={() => setAssemblyPlacement(activePiece.id, {})}
            >
              {placement ? "Atualizar" : "Inferir posição"}
            </button>
          </div>
        </section>

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

        <section className="assembly-section">
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
        </section>
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
