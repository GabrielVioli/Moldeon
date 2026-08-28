import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { projectAvatarBody2D, type BodyProjectionPoint2D, type BodyProjectionView } from "../avatar/BodyProjection2D";
import { bodyAnchorSpecification, placementFieldsForAnchor } from "../domain/bodyArrangement";
import { createUnclassifiedBodyPlacement, type BodyAnchorId, type PatternPreviewPlacement } from "../domain/pattern";
import { samplePatternContour } from "../domain/polygonGeometry";
import { createPanelInstanceId } from "../domain/patternDocumentV3";
import type { Camera2D } from "../editor/camera";
import { worldToScreen } from "../editor/coordinates";
import { localBoundsFromPoints } from "../editor/editorCoreMath";
import { useEditorStore } from "../state/editorStore";

const VIEW_LABELS: Record<BodyProjectionView, string> = {
  front: "Frente",
  back: "Costas",
  left: "Lado E",
  right: "Lado D",
};

export const BodyReference2D = memo(function BodyReference2D({ camera }: { camera: Camera2D | null }) {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const confirmPanelInstanceArrangement = useEditorStore((state) => state.confirmPanelInstanceArrangement);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<BodyProjectionView>("front");
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [copyIndex, setCopyIndex] = useState(0);
  const piece = garment.pieces.find((candidate) => candidate.id === activePieceId);
  const instanceCount = Math.max(1, piece?.cutQuantity ?? 1);
  const safeCopyIndex = Math.min(copyIndex, instanceCount - 1);
  const avatar = useMemo(() => visible ? buildAvatarParametricModel(
    garment.measurements,
    garment.bodyType,
    { profile: garment.measurementProfile },
  ) : null, [garment.bodyType, garment.measurementProfile, garment.measurements, visible]);
  const projection = useMemo(() => avatar ? projectAvatarBody2D(avatar, view) : null, [avatar, view]);
  const workspace = garment.workspaceStates?.find((entry) => entry.pieceId === activePieceId);
  const transform = workspace?.transform
    ?? garment.workspaceTransforms?.find((entry) => entry.pieceId === activePieceId)
    ?? { pieceId: activePieceId, xMm: 0, yMm: 0, rotationDeg: 0 };
  const pieceBounds = piece ? localBoundsFromPoints(samplePatternContour(piece.points)) : undefined;
  const originWorld = {
    xMm: transform.xMm + ((pieceBounds?.minX ?? 0) + (pieceBounds?.maxX ?? 0)) * 0.5,
    yMm: transform.yMm + (pieceBounds?.minY ?? 0),
  };
  const toScreen = (point: BodyProjectionPoint2D) => camera && projection ? worldToScreen({
    xMm: originWorld.xMm + point.xMm,
    yMm: originWorld.yMm + point.yMm - projection.boundsMm.minY,
  }, camera) : { x: 0, y: 0 };
  const silhouettePath = camera && projection
    ? projection.silhouette.map((segment) => {
        const start = toScreen(segment.start);
        const end = toScreen(segment.end);
        return `M${start.x.toFixed(2)} ${start.y.toFixed(2)}L${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
      }).join("")
    : "";
  const selectedAnchorId = piece?.previewPlacements?.find(
    (placement) => placement.id === createPanelInstanceId(piece.id, safeCopyIndex),
  )?.bodyAnchorId ?? piece?.bodyPlacement?.anchorId;

  const applyAnchor = (anchorId: BodyAnchorId) => {
    if (!piece) return;
    const specification = bodyAnchorSpecification(anchorId);
    const fields = placementFieldsForAnchor(anchorId);
    const current = piece.bodyPlacement ?? createUnclassifiedBodyPlacement();
    const paired = instanceCount > 1 && (specification.bodySide === "left" || specification.bodySide === "right");
    const instanceId = createPanelInstanceId(piece.id, safeCopyIndex);
    const placement: PatternPreviewPlacement = {
      id: instanceId,
      pieceId: piece.id,
      region: specification.region,
      surface: specification.surface,
      bodySide: specification.bodySide,
      bodyAnchorId: anchorId,
      rotationDeg: current.rotationZDeg,
      offsetXMm: current.offsetXMm,
      offsetYMm: current.offsetYMm,
      offsetZMm: current.offsetZMm,
      scale: 1,
      mirrorX: current.outwardFace === "flipped" || (instanceCount > 1 && safeCopyIndex % 2 === 1),
    };
    confirmPanelInstanceArrangement(piece.id, safeCopyIndex, {
      ...current,
      status: "confirmed",
      ...fields,
      bodySide: paired ? "paired" : fields.bodySide,
      anchorId,
      source: "manual",
    }, placement);
  };
  const applyAnchorFromKeyboard = (event: KeyboardEvent<SVGGElement>, anchorId: BodyAnchorId) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    applyAnchor(anchorId);
  };

  return (
    <div className="body-reference-2d" data-testid="body-reference-2d" data-view={view} data-source-topology={projection?.sourceTopologySignature ?? "hidden"}>
      <div className="body-reference-controls" role="toolbar" aria-label="Referência corporal 2D">
        <label><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.currentTarget.checked)} /> Corpo 2D</label>
        {visible ? (
          <>
            <select aria-label="Vista corporal 2D" value={view} onChange={(event) => setView(event.currentTarget.value as BodyProjectionView)}>
              {(Object.keys(VIEW_LABELS) as BodyProjectionView[]).map((option) => <option key={option} value={option}>{VIEW_LABELS[option]}</option>)}
            </select>
            {instanceCount > 1 ? (
              <select aria-label="Instância para posicionar" value={safeCopyIndex} onChange={(event) => setCopyIndex(Number(event.currentTarget.value))}>
                {Array.from({ length: instanceCount }, (_, index) => <option key={index} value={index}>Instância {index + 1}</option>)}
              </select>
            ) : null}
            <label><input type="checkbox" checked={showLandmarks} onChange={(event) => setShowLandmarks(event.currentTarget.checked)} /> Landmarks</label>
          </>
        ) : null}
      </div>
      {camera && projection ? (
        <svg className="body-reference-svg" aria-label={`Manequim 2D · ${VIEW_LABELS[view]}`}>
          <path className="body-reference-silhouette" d={silhouettePath} />
          {showLandmarks ? (
            <>
              {projection.regions.map((region) => {
                const point = toScreen(region);
                return <g className="body-reference-region" key={region.id} transform={`translate(${point.x} ${point.y})`}><circle r={2.5} /><text x={5} y={-3}>{region.id}</text></g>;
              })}
              {projection.landmarks.map((landmark) => {
                const point = toScreen(landmark);
                return <circle className="body-reference-landmark" key={landmark.id} cx={point.x} cy={point.y} r={2}><title>{landmark.id}</title></circle>;
              })}
            </>
          ) : null}
          {projection.anchors.map((anchor) => {
            const point = toScreen(anchor);
            const selected = anchor.id === selectedAnchorId;
            return (
              <g
                aria-label={`Usar ${bodyAnchorSpecification(anchor.id).label}`}
                className={`body-reference-anchor${selected ? " is-selected" : ""}`}
                key={anchor.id}
                onClick={() => applyAnchor(anchor.id)}
                onKeyDown={(event) => applyAnchorFromKeyboard(event, anchor.id)}
                role="button"
                tabIndex={0}
                transform={`translate(${point.x} ${point.y})`}
              >
                <circle r={selected ? 7 : 5} />
                <title>{bodyAnchorSpecification(anchor.id).label}</title>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
});
