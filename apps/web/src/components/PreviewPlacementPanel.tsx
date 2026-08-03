import { createPreviewPlacement, type PatternPreviewPlacement, type PreviewBodySide, type PreviewRegion, type PreviewSurface } from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";

export function PreviewPlacementPanel() {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const setPlacements = useEditorStore((state) => state.setActivePiecePlacements);
  const piece = garment.pieces.find((item) => item.id === activePieceId) ?? garment.pieces[0];
  const placement = piece.previewPlacements?.[0] ?? createPreviewPlacement(piece.id);
  const update = (values: Partial<PatternPreviewPlacement>) => setPlacements([{ ...placement, ...values }]);

  return (
    <aside className="placement-panel">
      <span className="section-eyebrow">Preparação 3D</span>
      <h2>{piece.name}</h2>
      <p className="muted">Arraste uma peça para o avatar ou ajuste o painel.</p>
      <PlacementSelect label="Região" value={placement.region} options={["torso", "waist", "hip", "arm", "leg"]} onChange={(region) => update({ region: region as PreviewRegion })} />
      <PlacementSelect label="Superfície" value={placement.surface} options={["front", "back", "side"]} onChange={(surface) => update({ surface: surface as PreviewSurface })} />
      <PlacementSelect label="Lado" value={placement.bodySide} options={["center", "left", "right"]} onChange={(bodySide) => update({ bodySide: bodySide as PreviewBodySide })} />
      {(["rotationDeg", "offsetXMm", "offsetYMm", "offsetZMm", "scale"] as const).map((field) => (
        <label className="placement-field" key={field}>
          <span>{{ rotationDeg: "Rotação (°)", offsetXMm: "Deslocamento X (mm)", offsetYMm: "Deslocamento Y (mm)", offsetZMm: "Deslocamento Z (mm)", scale: "Escala" }[field]}</span>
          <input type="number" step={field === "scale" ? 0.05 : 1} min={field === "scale" ? 0.05 : undefined} value={placement[field]} onChange={(event) => Number.isFinite(event.currentTarget.valueAsNumber) && update({ [field]: event.currentTarget.valueAsNumber })} />
        </label>
      ))}
      <button type="button" onClick={() => setPlacements([])}>Remover da prévia</button>
    </aside>
  );
}

function PlacementSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange(value: string): void }) {
  return <label className="placement-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
