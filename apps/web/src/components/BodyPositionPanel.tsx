import { memo, useEffect, useMemo, useState } from "react";
import {
  BODY_ANCHOR_SPECIFICATIONS,
  bodyAnchorSpecification,
  placementFieldsForAnchor,
} from "../domain/bodyArrangement";
import {
  createUnclassifiedBodyPlacement,
  type BodyAnchorId,
  type PatternBodyPlacement,
  type PatternPiece,
  type PatternPreviewPlacement,
} from "../domain/pattern";
import { createPanelInstanceId } from "../domain/patternDocumentV3";
import { useEditorStore } from "../state/editorStore";

interface PlacementDraft {
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
  const setPanelInstanceArrangement = useEditorStore((state) => state.setPanelInstanceArrangement);
  const confirmPanelInstanceArrangement = useEditorStore((state) => state.confirmPanelInstanceArrangement);
  const clearBodyArrangement = useEditorStore((state) => state.clearBodyArrangement);
  const instanceCount = Math.max(1, piece.cutQuantity ?? 1);
  const [copyIndex, setCopyIndex] = useState(0);
  const safeCopyIndex = Math.min(copyIndex, instanceCount - 1);
  const [draft, setDraft] = useState<PlacementDraft>(() => draftFromPiece(piece, safeCopyIndex));
  const instanceId = createPanelInstanceId(piece.id, safeCopyIndex);
  const explicitPlacement = piece.previewPlacements?.find((placement) => placement.id === instanceId);
  const effectiveAnchorId = explicitPlacement?.bodyAnchorId
    ?? (piece.bodyPlacement?.status === "confirmed" ? piece.bodyPlacement.anchorId : undefined);
  const confirmed = Boolean(effectiveAnchorId);
  const status = confirmed
    ? explicitPlacement ? "Posição desta instância" : "Padrão da peça"
    : "Sem posição definida";
  const selectedSpecification = useMemo(
    () => draft.anchorId ? bodyAnchorSpecification(draft.anchorId) : undefined,
    [draft.anchorId],
  );

  useEffect(() => {
    setDraft(draftFromPiece(piece, safeCopyIndex));
  }, [piece, safeCopyIndex]);

  const patchDraft = <K extends keyof PlacementDraft>(key: K, value: PlacementDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const confirm = () => {
    if (!draft.anchorId) return;
    const fields = placementFieldsForAnchor(draft.anchorId);
    const paired = instanceCount > 1 && (fields.bodySide === "left" || fields.bodySide === "right");
    const definitionPlacement: PatternBodyPlacement = {
      version: 1,
      status: "confirmed",
      includeIn3D: draft.includeIn3D,
      ...fields,
      bodySide: paired ? "paired" : fields.bodySide,
      anchorId: draft.anchorId,
      outwardFace: draft.outwardFace,
      offsetXMm: draft.offsetXMm,
      offsetYMm: draft.offsetYMm,
      offsetZMm: draft.offsetZMm,
      rotationXDeg: draft.rotationXDeg,
      rotationYDeg: draft.rotationYDeg,
      rotationZDeg: draft.rotationZDeg,
      source: "manual",
    };
    const instancePlacement: PatternPreviewPlacement = {
      id: instanceId,
      pieceId: piece.id,
      region: fields.region,
      surface: fields.surface,
      bodySide: fields.bodySide === "paired" || fields.bodySide === "not-applicable" ? "center" : fields.bodySide,
      bodyAnchorId: draft.anchorId,
      rotationDeg: draft.rotationZDeg,
      offsetXMm: draft.offsetXMm,
      offsetYMm: draft.offsetYMm,
      offsetZMm: draft.offsetZMm,
      scale: 1,
      mirrorX: draft.outwardFace === "flipped" || (instanceCount > 1 && safeCopyIndex % 2 === 1),
    };
    confirmPanelInstanceArrangement(piece.id, safeCopyIndex, definitionPlacement, instancePlacement);
  };

  return (
    <section className="body-position-section" data-body-position-piece={piece.id}>
      <details open={!confirmed}>
        <summary>
          <span>Posição inicial no corpo</span>
          <small className={confirmed ? "is-ready" : "is-pending"}>{status}</small>
        </summary>

        <p className="body-position-help">
          Escolha apenas a referência onde esta instância deve começar. Frente, lado, orientação e região vêm do mesmo anchor usado pelo manequim 3D.
        </p>

        {instanceCount > 1 ? (
          <label className="body-position-instance-select">
            Instância física
            <select value={safeCopyIndex} onChange={(event) => setCopyIndex(Number(event.currentTarget.value))}>
              {Array.from({ length: instanceCount }, (_, index) => (
                <option value={index} key={index}>
                  {index + 1} · {createPanelInstanceId(piece.id, index)}{index % 2 === 1 ? " · espelhada" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="body-position-anchor-select">
          Referência corporal
          <select
            aria-label="Referência corporal"
            aria-invalid={!draft.anchorId}
            value={draft.anchorId}
            onChange={(event) => patchDraft("anchorId", event.currentTarget.value as BodyAnchorId)}
          >
            <option value="">Selecione no manequim 2D ou nesta lista</option>
            {BODY_ANCHOR_SPECIFICATIONS.map((anchor) => <option value={anchor.id} key={anchor.id}>{anchor.label}</option>)}
          </select>
        </label>

        {selectedSpecification ? (
          <div className="body-position-derived" aria-live="polite">
            <span>Região: {selectedSpecification.region}</span>
            <span>Superfície: {selectedSpecification.surface}</span>
            <span>Lado: {selectedSpecification.bodySide}</span>
          </div>
        ) : null}

        <label className="check-field">
          <input type="checkbox" checked={draft.includeIn3D} onChange={(event) => patchDraft("includeIn3D", event.currentTarget.checked)} />
          Incluir no 3D
        </label>

        <details className="body-position-advanced">
          <summary>Ajustar pose inicial</summary>
          <div className="body-position-grid numeric">
            <NumberField label="Lateral" value={draft.offsetXMm} unit="mm" onChange={(value) => patchDraft("offsetXMm", value)} />
            <NumberField label="Vertical" value={draft.offsetYMm} unit="mm" onChange={(value) => patchDraft("offsetYMm", value)} />
            <NumberField label="Afastamento" value={draft.offsetZMm} unit="mm" onChange={(value) => patchDraft("offsetZMm", value)} />
            <NumberField label="Rotação X" value={draft.rotationXDeg} unit="°" onChange={(value) => patchDraft("rotationXDeg", value)} />
            <NumberField label="Rotação Y" value={draft.rotationYDeg} unit="°" onChange={(value) => patchDraft("rotationYDeg", value)} />
            <NumberField label="Rotação Z" value={draft.rotationZDeg} unit="°" onChange={(value) => patchDraft("rotationZDeg", value)} />
          </div>
          <label>Face externa
            <select value={draft.outwardFace} onChange={(event) => patchDraft("outwardFace", event.currentTarget.value as PlacementDraft["outwardFace"])}>
              <option value="normal">Face normal</option>
              <option value="flipped">Inverter face</option>
            </select>
          </label>
        </details>

        <div className="body-position-actions">
          {explicitPlacement ? (
            <button type="button" onClick={() => setPanelInstanceArrangement(piece.id, safeCopyIndex, null)}>Usar padrão da peça</button>
          ) : null}
          {piece.bodyPlacement?.status === "confirmed" || piece.previewPlacements?.length ? (
            <button type="button" onClick={() => {
              clearBodyArrangement(piece.id);
              setDraft(draftFromPlacement(createUnclassifiedBodyPlacement(draft.includeIn3D)));
            }}>Remover posicionamento</button>
          ) : null}
          <button type="button" className="primary-button" disabled={!draft.anchorId} onClick={confirm}>Aplicar à instância</button>
        </div>
      </details>
    </section>
  );
});

function draftFromPiece(piece: PatternPiece, copyIndex: number): PlacementDraft {
  const instanceId = createPanelInstanceId(piece.id, copyIndex);
  const explicit = piece.previewPlacements?.find((placement) => placement.id === instanceId);
  const base = draftFromPlacement(piece.bodyPlacement ?? createUnclassifiedBodyPlacement());
  if (!explicit) return base;
  return {
    ...base,
    anchorId: explicit.bodyAnchorId ?? "",
    offsetXMm: explicit.offsetXMm,
    offsetYMm: explicit.offsetYMm,
    offsetZMm: explicit.offsetZMm,
    rotationZDeg: explicit.rotationDeg,
    outwardFace: explicit.mirrorX ? "flipped" : base.outwardFace,
  };
}

function draftFromPlacement(placement: PatternBodyPlacement): PlacementDraft {
  return {
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

function NumberField({ label, value, unit, onChange }: { label: string; value: number; unit: string; onChange(value: number): void }) {
  return <label>{label}<span className="input-with-unit"><input type="number" step="0.1" value={value} onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onChange(next); }} /><span>{unit}</span></span></label>;
}
