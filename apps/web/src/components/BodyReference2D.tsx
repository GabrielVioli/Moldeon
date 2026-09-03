import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { isAnchorOnProjectionHemisphere, projectAvatarBody2D, projectPoint, selectBodyReferenceSeedAnchor, shouldApplyBodyReferenceSeed, type BodyProjectionPoint2D, type BodyProjectionView } from "../avatar/BodyProjection2D";
import { bodyAnchorSpecification, placementFieldsForAnchor } from "../domain/bodyArrangement";
import { createUnclassifiedBodyPlacement, type BodyAnchorId, type PatternPreviewPlacement, type PreviewBodySide, type PreviewSurface } from "../domain/pattern";
import { samplePatternContour } from "../domain/polygonGeometry";
import { createPanelInstanceId } from "../domain/patternDocumentV3";
import type { Camera2D } from "../editor/camera";
import { pieceLocalToWorld, worldToScreen } from "../editor/coordinates";
import { localBoundsFromPoints } from "../editor/editorCoreMath";
import { useEditorStore } from "../state/editorStore";

const VIEW_LABELS: Record<BodyProjectionView, string> = {
  front: "Frente",
  back: "Costas",
  left: "Lado E",
  right: "Lado D",
};

/**
 * Presentation-only origin for the canonical body projection.
 *
 * It deliberately does not depend on the active PatternDefinition, its bounds,
 * selection state or arrangement. The body therefore stays on the workbench
 * while pieces move independently around it.
 */
export const BODY_REFERENCE_ORIGIN_WORLD = { xMm: 0, yMm: 0 } as const;

export const BodyReference2D = memo(function BodyReference2D({ camera }: { camera: Camera2D | null }) {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const confirmPanelInstanceArrangement = useEditorStore((state) => state.confirmPanelInstanceArrangement);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<BodyProjectionView>("front");
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [copyIndex, setCopyIndex] = useState(0);
  const spatialTransformRef = useRef<{ pieceId: string; signature: string } | null>(null);
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
  const selectedAnchorId = piece?.previewPlacements?.find(
    (placement) => placement.id === createPanelInstanceId(piece.id, safeCopyIndex),
  )?.bodyAnchorId ?? piece?.bodyPlacement?.anchorId;
  const toScreen = (point: BodyProjectionPoint2D) => camera && projection ? worldToScreen({
    xMm: BODY_REFERENCE_ORIGIN_WORLD.xMm + point.xMm,
    yMm: BODY_REFERENCE_ORIGIN_WORLD.yMm + point.yMm,
  }, camera) : { x: 0, y: 0 };
  const silhouettePath = camera && projection
    ? projection.silhouette.map((segment) => {
        const start = toScreen(segment.start);
        const end = toScreen(segment.end);
        return `M${start.x.toFixed(2)} ${start.y.toFixed(2)}L${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
      }).join("")
    : "";

  useEffect(() => {
    if (!visible || !projection || !avatar || !piece) {
      spatialTransformRef.current = null;
      return;
    }

    const signature = `${transform.xMm.toFixed(6)}:${transform.yMm.toFixed(6)}:${transform.rotationDeg.toFixed(6)}`;
    const previous = spatialTransformRef.current;
    spatialTransformRef.current = { pieceId: piece.id, signature };

    // Showing the body, switching the active piece or changing body view is not
    // authoring. Only a subsequent explicit workspace move/rotation can author.
    if (!previous || previous.pieceId !== piece.id || previous.signature === signature) return;

    const contour = samplePatternContour(piece.points);
    if (contour.length === 0) return;
    const localBounds = localBoundsFromPoints(contour);
    const centerWorld = pieceLocalToWorld({
      xMm: (localBounds.minX + localBounds.maxX) * 0.5,
      yMm: (localBounds.minY + localBounds.maxY) * 0.5,
    }, transform);
    const worldPoints = contour.map((point) => pieceLocalToWorld(point, transform));
    const pieceBounds = {
      minX: Math.min(...worldPoints.map((point) => point.xMm)),
      maxX: Math.max(...worldPoints.map((point) => point.xMm)),
      minY: Math.min(...worldPoints.map((point) => point.yMm)),
      maxY: Math.max(...worldPoints.map((point) => point.yMm)),
    };
    const bodyBounds = {
      minX: BODY_REFERENCE_ORIGIN_WORLD.xMm + projection.boundsMm.minX,
      maxX: BODY_REFERENCE_ORIGIN_WORLD.xMm + projection.boundsMm.maxX,
      minY: BODY_REFERENCE_ORIGIN_WORLD.yMm + projection.boundsMm.minY,
      maxY: BODY_REFERENCE_ORIGIN_WORLD.yMm + projection.boundsMm.maxY,
    };
    const overlapsBodyBounds = !(
      pieceBounds.maxX < bodyBounds.minX
      || pieceBounds.minX > bodyBounds.maxX
      || pieceBounds.maxY < bodyBounds.minY
      || pieceBounds.minY > bodyBounds.maxY
    );
    const instanceId = createPanelInstanceId(piece.id, safeCopyIndex);
    const existingPlacement = piece.previewPlacements?.find((placement) => placement.id === instanceId);
    if (!shouldApplyBodyReferenceSeed(existingPlacement)) return;
    const alreadyRelatedToBody = Boolean(existingPlacement?.bodyAnchorId ?? piece.bodyPlacement?.anchorId);

    const bodyPoint = {
      xMm: centerWorld.xMm - BODY_REFERENCE_ORIGIN_WORLD.xMm,
      yMm: centerWorld.yMm - BODY_REFERENCE_ORIGIN_WORLD.yMm,
    };
    const nearest = selectBodyReferenceSeedAnchor(avatar, projection, bodyPoint);
    if (!nearest) return;

    const panelHalfDiagonalMm = Math.hypot(
      localBounds.maxX - localBounds.minX,
      localBounds.maxY - localBounds.minY,
    ) * 0.5;
    const freshAuthoringRadiusMm = Math.max(180, panelHalfDiagonalMm + 140);
    if (!alreadyRelatedToBody && (!overlapsBodyBounds || nearest.distanceMm > freshAuthoringRadiusMm)) return;

    const anchorId = nearest.anchor.id;
    const specification = bodyAnchorSpecification(anchorId);
    const avatarAnchor = avatar.anchors.find((candidate) => candidate.id === anchorId);
    if (!avatarAnchor) return;
    const fields = placementFieldsForAnchor(anchorId);
    const current = piece.bodyPlacement ?? createUnclassifiedBodyPlacement();
    const deltaX = bodyPoint.xMm - nearest.anchor.xMm;
    const deltaY = bodyPoint.yMm - nearest.anchor.yMm;
    const projectedBasis = (direction: readonly [number, number, number]) => {
      const stepM = 0.1;
      const endpoint = projectPoint([
        avatarAnchor.position[0] + direction[0] * stepM,
        avatarAnchor.position[1] + direction[1] * stepM,
        avatarAnchor.position[2] + direction[2] * stepM,
      ], view);
      return {
        x: (endpoint.xMm - nearest.anchor.xMm) / (stepM * 1000),
        y: (endpoint.yMm - nearest.anchor.yMm) / (stepM * 1000),
      };
    };
    const tangent = projectedBasis(avatarAnchor.tangent);
    const axis = projectedBasis(avatarAnchor.axis);
    const determinant = tangent.x * axis.y - tangent.y * axis.x;
    const offsetXMm = Math.abs(determinant) > 1e-6
      ? (deltaX * axis.y - deltaY * axis.x) / determinant
      : deltaX;
    const offsetYMm = Math.abs(determinant) > 1e-6
      ? (tangent.x * deltaY - tangent.y * deltaX) / determinant
      : deltaY;

    let authoredSurface: PreviewSurface = specification.surface;
    let authoredBodySide: PreviewBodySide = specification.bodySide;
    if (view === "front" || view === "back") {
      authoredSurface = view;
      const visualSide = Math.abs(bodyPoint.xMm) < 35
        ? "center"
        : bodyPoint.xMm < 0 ? "left" : "right";
      authoredBodySide = view === "back"
        ? visualSide === "left" ? "right" : visualSide === "right" ? "left" : "center"
        : visualSide;
    } else {
      authoredSurface = "side";
      authoredBodySide = view;
    }

    const paired = instanceCount > 1 && (authoredBodySide === "left" || authoredBodySide === "right");
    const placement: PatternPreviewPlacement = {
      id: instanceId,
      pieceId: piece.id,
      region: specification.region,
      surface: authoredSurface,
      bodySide: authoredBodySide,
      bodyAnchorId: anchorId,
      rotationDeg: transform.rotationDeg,
      offsetXMm,
      offsetYMm,
      offsetZMm: current.offsetZMm,
      scale: 1,
      mirrorX: current.outwardFace === "flipped" || (instanceCount > 1 && safeCopyIndex % 2 === 1),
    };
    confirmPanelInstanceArrangement(piece.id, safeCopyIndex, {
      ...current,
      status: "confirmed",
      ...fields,
      region: specification.region,
      surface: authoredSurface,
      bodySide: paired ? "paired" : authoredBodySide,
      anchorId,
      offsetXMm,
      offsetYMm,
      rotationZDeg: transform.rotationDeg,
      source: "manual",
    }, placement);
  }, [
    avatar,
    confirmPanelInstanceArrangement,
    instanceCount,
    piece,
    projection,
    safeCopyIndex,
    transform.rotationDeg,
    transform.xMm,
    transform.yMm,
    view,
    visible,
  ]);

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
      {camera && projection && avatar ? (
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
          {projection.anchors.filter((anchor) => view === "front" || view === "back"
            ? isAnchorOnProjectionHemisphere(avatar, anchor, view)
            : anchor.facing >= -0.05).map((anchor) => {
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
