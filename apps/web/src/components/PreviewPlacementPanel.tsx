import { memo, useMemo } from "react";
import { buildAssemblyGraph } from "../domain/assembly";
import type { GarmentDressingRegion } from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";

const REGION_LABELS: Record<GarmentDressingRegion, string> = {
  upper: "Parte superior",
  lower: "Parte inferior",
  full: "Corpo inteiro",
  arm: "Braço",
  neck: "Pescoço",
  custom: "Personalizado",
};

export const PreviewPlacementPanel = memo(function PreviewPlacementPanel({
  onChangeRegion,
  onBackToAssembly,
}: {
  onChangeRegion(): void;
  onBackToAssembly(): void;
}) {
  const garment = useEditorStore((state) => state.garment);
  const graph = useMemo(() => buildAssemblyGraph(garment), [garment]);
  const region = garment.dressing?.region;
  const seamCount = graph.validSeamIds.length;

  return (
    <aside className="placement-panel fitting-summary-panel" aria-label="Resumo da prova">
      <span className="section-eyebrow">Prova</span>
      <h2>Roupa montada</h2>
      <p className="muted">
        O Moldeon organizou as peças a partir das costuras criadas na bancada.
      </p>

      <dl className="fitting-summary-list">
        <div><dt>Onde vestir</dt><dd>{region ? REGION_LABELS[region] : "Não definido"}</dd></div>
        <div><dt>Peças</dt><dd>{garment.pieces.length}</dd></div>
        <div><dt>Costuras válidas</dt><dd>{seamCount}</dd></div>
        <div><dt>Conjuntos</dt><dd>{graph.connectedComponents.length}</dd></div>
      </dl>

      <div className="fitting-summary-actions">
        <button type="button" onClick={onBackToAssembly}>Voltar às costuras</button>
        <button type="button" onClick={onChangeRegion}>Alterar onde vestir</button>
      </div>
    </aside>
  );
});
