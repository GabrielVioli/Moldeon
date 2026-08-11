import { memo, useMemo, useState } from "react";
import { suggestBodyPlacement } from "../domain/assembly";
import {
  createUnclassifiedBodyPlacement,
  type BodyAnchorId,
  type BodyPlacementRegion,
  type BodyPlacementRole,
  type BodyPlacementSide,
  type BodyPlacementSurface,
  type PatternBodyPlacement,
  type PatternPiece,
} from "../domain/pattern";
import { createPanelInstanceId } from "../domain/patternDocumentV3";
import { useEditorStore } from "../state/editorStore";

const ROLE_OPTIONS: Array<[BodyPlacementRole, string]> = [
  ["front", "Frente"], ["back", "Costas"], ["sleeve", "Manga"],
  ["waistband", "Cós"], ["leg-front", "Frente de perna"],
  ["leg-back", "Costas de perna"], ["collar", "Gola"],
  ["panel", "Painel"], ["custom", "Personalizada"],
];
const REGION_OPTIONS: Array<[BodyPlacementRegion, string]> = [
  ["torso", "Torso"], ["waist", "Cintura"], ["hip", "Quadril"],
  ["arm", "Braço"], ["leg", "Perna"], ["neck", "Pescoço"],
  ["custom", "Personalizada"],
];
const SURFACE_OPTIONS: Array<[BodyPlacementSurface, string]> = [
  ["front", "Frente"], ["back", "Costas"], ["side", "Lateral"],
  ["custom", "Personalizada"],
];
const SIDE_OPTIONS: Array<[BodyPlacementSide, string]> = [
  ["center", "Centro"], ["left", "Esquerdo"], ["right", "Direito"],
  ["paired", "Par espelhado"], ["not-applicable", "Não aplicável"],
];
const ANCHOR_OPTIONS: Array<[BodyAnchorId, string]> = [
  ["torso-front", "Frente do torso"], ["torso-back", "Costas do torso"],
  ["shoulder-left", "Ombro esquerdo"], ["shoulder-right", "Ombro direito"],
  ["arm-left", "Braço esquerdo"], ["arm-right", "Braço direito"],
  ["waist-front", "Frente da cintura"], ["waist-back", "Costas da cintura"],
  ["hip-front", "Frente do quadril"], ["hip-back", "Costas do quadril"],
  ["hip-left", "Lateral esquerda do quadril"], ["hip-right", "Lateral direita do quadril"],
  ["leg-left", "Perna esquerda"], ["leg-right", "Perna direita"],
  ["neck", "Pescoço"],
];

interface PlacementDraft {
  role: BodyPlacementRole | "";
  region: BodyPlacementRegion | "";
  surface: BodyPlacementSurface | "";
  bodySide: BodyPlacementSide | "";
  anchorId: BodyAnchorId | "";
  includeIn3D: boolean;
  outwardFace: PatternBodyPlacement["outwardFace"];
  offsetXMm: number;
  offsetYMm: number;
  offsetZMm: number;
  rotationXDeg: number;
  rotationYDeg: number;
  rotationZDeg: number;
}

export const BodyPositionPanel = memo(function BodyPositionPanel({ piece }: { piece: PatternPiece }) {
  const setBodyPlacement = useEditorStore((state) => state.setBodyPlacement);
  const suggestion = useMemo(() => suggestBodyPlacement(piece), [piece]);
  const [draft, setDraft] = useState<PlacementDraft>(() => draftFromPiece(piece));
  const complete = Boolean(draft.role && draft.region && draft.surface && draft.bodySide && draft.anchorId);
  const confirmed = piece.bodyPlacement?.status === "confirmed" && completePlacement(piece.bodyPlacement);
  const status = confirmed ? "Pronta para vestir" : suggestion ? "Sugestão disponível" : "Posição não definida";
  const instanceCount = Math.max(1, piece.cutQuantity ?? 1);

  const patchDraft = <K extends keyof PlacementDraft>(key: K, value: PlacementDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const confirm = () => {
    if (!complete) return;
    setBodyPlacement(piece.id, {
      version: 1,
      status: "confirmed",
      includeIn3D: draft.includeIn3D,
      role: draft.role as BodyPlacementRole,
      region: draft.region as BodyPlacementRegion,
      surface: draft.surface as BodyPlacementSurface,
      bodySide: draft.bodySide as BodyPlacementSide,
      anchorId: draft.anchorId as BodyAnchorId,
      outwardFace: draft.outwardFace,
      offsetXMm: draft.offsetXMm,
      offsetYMm: draft.offsetYMm,
      offsetZMm: draft.offsetZMm,
      rotationXDeg: draft.rotationXDeg,
      rotationYDeg: draft.rotationYDeg,
      rotationZDeg: draft.rotationZDeg,
      source: "manual",
    });
  };

  return (
    <section className="body-position-section" data-body-position-piece={piece.id}>
      <details open={!confirmed}>
        <summary>
          <span>Posição no corpo</span>
          <small className={confirmed ? "is-ready" : "is-pending"}>{status}</small>
        </summary>

        {suggestion && !confirmed ? (
          <div className="body-position-suggestion">
            <span>Sugestão: {labelFor(ANCHOR_OPTIONS, suggestion.anchorId)}</span>
            <button type="button" onClick={() => setDraft((current) => ({ ...current, ...suggestion }))}>Usar sugestão</button>
          </div>
        ) : null}

        <div className="body-position-grid">
          <SelectField label="Função da peça" value={draft.role} options={ROLE_OPTIONS} onChange={(value) => patchDraft("role", value)} />
          <SelectField label="Região corporal" value={draft.region} options={REGION_OPTIONS} onChange={(value) => patchDraft("region", value)} />
          <SelectField label="Superfície" value={draft.surface} options={SURFACE_OPTIONS} onChange={(value) => patchDraft("surface", value)} />
          <SelectField label="Lado corporal" value={draft.bodySide} options={SIDE_OPTIONS} onChange={(value) => patchDraft("bodySide", value)} />
          <SelectField label="Posição" value={draft.anchorId} options={ANCHOR_OPTIONS} onChange={(value) => patchDraft("anchorId", value)} />
          <label>Face externa
            <select value={draft.outwardFace} onChange={(event) => patchDraft("outwardFace", event.currentTarget.value as PlacementDraft["outwardFace"])}>
              <option value="normal">Face normal</option>
              <option value="flipped">Inverter face</option>
            </select>
          </label>
        </div>

        <label className="check-field">
          <input type="checkbox" checked={draft.includeIn3D} onChange={(event) => patchDraft("includeIn3D", event.currentTarget.checked)} />
          Incluir no 3D
        </label>

        <details className="body-position-advanced">
          <summary>Ajustar posição inicial</summary>
          <div className="body-position-grid numeric">
            <NumberField label="Lateral" value={draft.offsetXMm} unit="mm" onChange={(value) => patchDraft("offsetXMm", value)} />
            <NumberField label="Vertical" value={draft.offsetYMm} unit="mm" onChange={(value) => patchDraft("offsetYMm", value)} />
            <NumberField label="Afastamento" value={draft.offsetZMm} unit="mm" onChange={(value) => patchDraft("offsetZMm", value)} />
            <NumberField label="Rotação X" value={draft.rotationXDeg} unit="°" onChange={(value) => patchDraft("rotationXDeg", value)} />
            <NumberField label="Rotação Y" value={draft.rotationYDeg} unit="°" onChange={(value) => patchDraft("rotationYDeg", value)} />
            <NumberField label="Rotação Z" value={draft.rotationZDeg} unit="°" onChange={(value) => patchDraft("rotationZDeg", value)} />
          </div>
        </details>

        <div className="body-position-instances">
          <strong>Cortar: {instanceCount}×</strong>
          {Array.from({ length: instanceCount }, (_, copyIndex) => (
            <span key={copyIndex}>{copyIndex + 1}. {createPanelInstanceId(piece.id, copyIndex)}</span>
          ))}
        </div>

        <div className="body-position-actions">
          {piece.bodyPlacement?.status === "confirmed" ? (
            <button type="button" onClick={() => {
              const empty = createUnclassifiedBodyPlacement(draft.includeIn3D);
              setDraft(draftFromPlacement(empty));
              setBodyPlacement(piece.id, empty);
            }}>Remover posição</button>
          ) : null}
          <button type="button" className="primary-button" disabled={!complete} onClick={confirm}>Confirmar posição</button>
        </div>
        {!complete ? <p className="body-position-missing">Preencha os campos destacados para vestir esta peça.</p> : null}
      </details>
    </section>
  );
});

function draftFromPiece(piece: PatternPiece): PlacementDraft {
  return draftFromPlacement(piece.bodyPlacement ?? createUnclassifiedBodyPlacement());
}

function draftFromPlacement(placement: PatternBodyPlacement): PlacementDraft {
  return {
    role: placement.role ?? "",
    region: placement.region ?? "",
    surface: placement.surface ?? "",
    bodySide: placement.bodySide ?? "",
    anchorId: placement.anchorId ?? "",
    includeIn3D: placement.includeIn3D,
    outwardFace: placement.outwardFace,
    offsetXMm: placement.offsetXMm,
    offsetYMm: placement.offsetYMm,
    offsetZMm: placement.offsetZMm,
    rotationXDeg: placement.rotationXDeg,
    rotationYDeg: placement.rotationYDeg,
    rotationZDeg: placement.rotationZDeg,
  };
}

function completePlacement(placement: PatternBodyPlacement): boolean {
  return Boolean(placement.role && placement.region && placement.surface && placement.bodySide && placement.anchorId);
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T | ""; options: Array<[T, string]>; onChange(value: T): void }) {
  return <label>{label}<select aria-label={label} value={value} aria-invalid={!value} onChange={(event) => onChange(event.currentTarget.value as T)}><option value="">Selecione</option>{options.map(([option, text]) => <option value={option} key={option}>{text}</option>)}</select></label>;
}

function NumberField({ label, value, unit, onChange }: { label: string; value: number; unit: string; onChange(value: number): void }) {
  return <label>{label}<span className="input-with-unit"><input type="number" step="0.1" value={value} onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onChange(next); }} /><span>{unit}</span></span></label>;
}

function labelFor<T extends string>(options: Array<[T, string]>, value: T): string {
  return options.find(([option]) => option === value)?.[1] ?? value;
}
