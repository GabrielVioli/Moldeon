import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { samplePatternContour } from "../domain/polygonGeometry";
import { getEdgeById, type PieceWorkspaceTransform } from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";
import { BodyReference2D } from "../components/BodyReference2D";
import type { Camera2D } from "./camera";
import { pieceLocalToWorld, screenToWorld } from "./coordinates";
import {
  handleVectorFromPolar,
  handleVectorToPolar,
  localBoundsFromPoints,
  rotateWorkspaceTransformAroundPivot,
  rotationHandleScreenPosition,
} from "./editorCoreMath";
import { PatternCanvas as LegacyPatternCanvas } from "./PatternCanvasLegacy";
import { rotationFromPointer } from "./workspaceInteractions";

export type { EditorTool } from "./PatternCanvasLegacy";

type PatternCanvasProps = ComponentProps<typeof LegacyPatternCanvas>;
type HandleKind = "in" | "out";
type HandleTarget = { pointId: string; handle: HandleKind };

export function canvasDocumentGenerationKey(
  pieceIds: readonly string[],
  activePieceId: string,
): string {
  return `${pieceIds.join("\u001f")}\u001e${activePieceId}`;
}

function PatternCanvasGuard(props: PatternCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const generationKey = useEditorStore((state) =>
    canvasDocumentGenerationKey(
      state.garment.pieces.map((piece) => piece.id),
      state.activePieceId,
    ),
  );
  const camera = useLegacyCanvasCamera(shellRef, generationKey);

  return (
    <div
      ref={shellRef}
      className="editor-core-canvas-shell"
      data-editor-core-gate="9.5-04"
      style={{ position: "relative", minWidth: 0, minHeight: 0 }}
    >
      <LegacyPatternCanvas key={generationKey} {...props} />
      <BodyReference2D camera={camera} />
      <EditorCoreRotationHandle
        shellRef={shellRef}
        camera={camera}
        onEditStart={props.onEditStart}
        onEditEnd={props.onEditEnd}
      />
      <EditorCoreNumericPanel
        onEditStart={props.onEditStart}
        onEditEnd={props.onEditEnd}
        onEditCancel={() => useEditorStore.getState().cancelEdit()}
        onMovePoint={props.onMovePoint}
        onMoveHandle={props.onMoveHandle}
      />
    </div>
  );
}

/**
 * Transitional bridge for the legacy bitmap Canvas. It observes only the
 * camera translate/scale pair applied by draw(), without changing geometry or
 * gesture semantics. The rotation control can therefore remain a real DOM UI
 * element in screen coordinates instead of becoming part of the pattern.
 */
function useLegacyCanvasCamera(
  shellRef: RefObject<HTMLDivElement | null>,
  generationKey: string,
): Camera2D | null {
  const [camera, setCamera] = useState<Camera2D | null>(null);
  const [, setLayoutRevision] = useState(0);

  useLayoutEffect(() => {
    const canvas = shellRef.current?.querySelector<HTMLCanvasElement>("canvas.pattern-canvas");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const originalTranslate = context.translate;
    const originalScale = context.scale;
    let candidatePan: { panX: number; panY: number } | null = null;

    const currentDpr = () => {
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 ? canvas.width / rect.width : 1;
    };

    const patchedTranslate = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
    ) {
      const matrix = this.getTransform();
      const dpr = currentDpr();
      const startsCameraTransform =
        Math.abs(matrix.a - dpr) < 0.05
        && Math.abs(matrix.d - dpr) < 0.05
        && Math.abs(matrix.b) < 0.001
        && Math.abs(matrix.c) < 0.001
        && Math.abs(matrix.e) < 0.1
        && Math.abs(matrix.f) < 0.1;
      if (startsCameraTransform) candidatePan = { panX: x, panY: y };
      return originalTranslate.call(this, x, y);
    };

    const patchedScale = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
    ) {
      const pan = candidatePan;
      const result = originalScale.call(this, x, y);
      candidatePan = null;
      if (pan && Math.abs(x - y) < 0.0001 && x >= 0.15 && x <= 3) {
        const next = { zoom: x, panX: pan.panX, panY: pan.panY };
        setCamera((current) =>
          current
          && Math.abs(current.zoom - next.zoom) < 0.00001
          && Math.abs(current.panX - next.panX) < 0.00001
          && Math.abs(current.panY - next.panY) < 0.00001
            ? current
            : next,
        );
      }
      return result;
    };

    context.translate = patchedTranslate;
    context.scale = patchedScale;

    const observer = new ResizeObserver(() => setLayoutRevision((value) => value + 1));
    observer.observe(canvas);
    if (shellRef.current) observer.observe(shellRef.current);

    return () => {
      observer.disconnect();
      if (context.translate === patchedTranslate) context.translate = originalTranslate;
      if (context.scale === patchedScale) context.scale = originalScale;
    };
  }, [generationKey, shellRef]);

  return camera;
}

interface RotationHandleProps {
  shellRef: RefObject<HTMLDivElement | null>;
  camera: Camera2D | null;
  onEditStart(label: string): void;
  onEditEnd(): void;
}

interface RotationSession {
  pointerId: number;
  pieceId: string;
  startTransform: PieceWorkspaceTransform;
  pivotLocal: { xMm: number; yMm: number };
  centerWorld: { xMm: number; yMm: number };
  startPointerAngle: number;
  moved: boolean;
}

function EditorCoreRotationHandle({
  shellRef,
  camera,
  onEditStart,
  onEditEnd,
}: RotationHandleProps) {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const pieceSelectionActive = useEditorStore((state) => state.pieceSelectionActive);
  const selectedPieceIds = useEditorStore((state) => state.selectedPieceIds);
  const selectedPointId = useEditorStore((state) => state.selectedPointId);
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId);
  const selectedSeamId = useEditorStore((state) => state.selectedSeamId);
  const selectedDartId = useEditorStore((state) => state.selectedDartId);
  const selectedInternalPathId = useInternalPathEditorStore((state) => state.selectedPathId);
  const sessionRef = useRef<RotationSession | null>(null);
  const [feedback, setFeedback] = useState<number | null>(null);

  const piece = garment.pieces.find((candidate) => candidate.id === activePieceId);
  const workspace = garment.workspaceStates?.find((candidate) => candidate.pieceId === activePieceId);
  const transform = workspace?.transform
    ?? garment.workspaceTransforms?.find((candidate) => candidate.pieceId === activePieceId)
    ?? (activePieceId
      ? { pieceId: activePieceId, xMm: 0, yMm: 0, rotationDeg: 0 }
      : null);
  const locked = workspace?.locked === true;
  const canRotate = Boolean(
    camera
      && piece
      && transform
      && pieceSelectionActive
      && selectedPieceIds.length === 1
      && selectedPieceIds[0] === activePieceId
      && !locked
      && !selectedPointId
      && !selectedEdgeId
      && !selectedSeamId
      && !selectedDartId
      && !selectedInternalPathId,
  );

  useEffect(() => {
    if (!canRotate && sessionRef.current) {
      sessionRef.current = null;
      setFeedback(null);
    }
  }, [canRotate]);

  if (!canRotate || !piece || !transform || !camera) return null;
  const shell = shellRef.current;
  const canvas = shell?.querySelector<HTMLCanvasElement>("canvas.pattern-canvas");
  if (!shell || !canvas) return null;

  const bounds = localBoundsFromPoints(samplePatternContour(piece.points));
  const handleScreen = rotationHandleScreenPosition(bounds, transform, camera, 24);
  const canvasRect = canvas.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  const left = canvasRect.left - shellRect.left + handleScreen.x;
  const top = canvasRect.top - shellRect.top + handleScreen.y;

  const pointerWorld = (clientX: number, clientY: number) =>
    screenToWorld(
      { x: clientX - canvasRect.left, y: clientY - canvasRect.top },
      camera,
    );

  const startRotation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const latest = useEditorStore.getState();
    const latestPiece = latest.garment.pieces.find((candidate) => candidate.id === activePieceId);
    const latestWorkspace = latest.garment.workspaceStates?.find((candidate) => candidate.pieceId === activePieceId);
    const latestTransform = latestWorkspace?.transform
      ?? latest.garment.workspaceTransforms?.find((candidate) => candidate.pieceId === activePieceId)
      ?? transform;
    if (!latestPiece || !latestTransform || latestWorkspace?.locked) return;

    const latestBounds = localBoundsFromPoints(samplePatternContour(latestPiece.points));
    const pivotLocal = {
      xMm: (latestBounds.minX + latestBounds.maxX) / 2,
      yMm: (latestBounds.minY + latestBounds.maxY) / 2,
    };
    const centerWorld = pieceLocalToWorld(pivotLocal, latestTransform);
    const pointer = pointerWorld(event.clientX, event.clientY);
    onEditStart("Rotacionar peça");
    sessionRef.current = {
      pointerId: event.pointerId,
      pieceId: latestPiece.id,
      startTransform: { ...latestTransform },
      pivotLocal,
      centerWorld,
      startPointerAngle: Math.atan2(
        pointer.yMm - centerWorld.yMm,
        pointer.xMm - centerWorld.xMm,
      ),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setFeedback(latestTransform.rotationDeg);
  };

  const moveRotation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = pointerWorld(event.clientX, event.clientY);
    const pointerAngle = Math.atan2(
      pointer.yMm - session.centerWorld.yMm,
      pointer.xMm - session.centerWorld.xMm,
    );
    const rotationDeg = rotationFromPointer(
      session.startTransform.rotationDeg,
      session.startPointerAngle,
      pointerAngle,
      event.shiftKey,
    );
    const next = rotateWorkspaceTransformAroundPivot(
      session.startTransform,
      session.pivotLocal,
      rotationDeg,
    );
    useEditorStore.getState().setPieceWorkspaceTransform(session.pieceId, next);
    session.moved = session.moved || Math.abs(rotationDeg - session.startTransform.rotationDeg) > 0.001;
    setFeedback(rotationDeg);
  };

  const finishRotation = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled || !session.moved) useEditorStore.getState().cancelEdit();
    else onEditEnd();
    sessionRef.current = null;
    setFeedback(null);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Girar peça selecionada"
        title="Arraste para girar · Shift encaixa em 15°"
        data-editor-core-rotation-handle="true"
        data-rotation-deg={transform.rotationDeg.toFixed(3)}
        onPointerDown={startRotation}
        onPointerMove={moveRotation}
        onPointerUp={(event) => finishRotation(event, false)}
        onPointerCancel={(event) => finishRotation(event, true)}
        style={{
          position: "absolute",
          left,
          top,
          zIndex: 9,
          width: 44,
          height: 44,
          transform: "translate(-50%, -50%)",
          border: 0,
          padding: 0,
          background: "transparent",
          display: "grid",
          placeItems: "center",
          cursor: feedback === null ? "grab" : "grabbing",
          touchAction: "none",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 25,
            height: 25,
            borderRadius: "50%",
            border: "1.5px solid #202124",
            background: feedback === null ? "#fff" : "#d9b866",
            color: "#202124",
            display: "grid",
            placeItems: "center",
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1,
            boxShadow: "0 1px 4px rgba(0,0,0,.16)",
          }}
        >
          ↻
        </span>
      </button>
      {feedback !== null ? (
        <div
          role="status"
          aria-label="Ângulo de rotação"
          style={{
            position: "absolute",
            left: left + 28,
            top: top - 12,
            zIndex: 10,
            padding: "3px 6px",
            borderRadius: 5,
            background: "rgba(32,33,36,.9)",
            color: "white",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          {feedback.toFixed(1)}°
        </div>
      ) : null}
    </>
  );
}

interface NumericPanelProps {
  onEditStart(label: string): void;
  onEditEnd(): void;
  onEditCancel(): void;
  onMovePoint(pointId: string, xMm: number, yMm: number): void;
  onMoveHandle(
    pointId: string,
    handle: HandleKind,
    xMm: number,
    yMm: number,
  ): void;
}

function EditorCoreNumericPanel({
  onEditStart,
  onEditEnd,
  onEditCancel,
  onMovePoint,
  onMoveHandle,
}: NumericPanelProps) {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const selectedPointId = useEditorStore((state) => state.selectedPointId);
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId);
  const convertSelectedSegment = useEditorStore(
    (state) => state.convertSelectedSegment,
  );
  const splitSelectedSegment = useEditorStore(
    (state) => state.splitSelectedSegment,
  );
  const [handleTarget, setHandleTarget] = useState<HandleTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelNextBlurRef = useRef(false);

  const piece = garment.pieces.find((candidate) => candidate.id === activePieceId);
  const point = piece?.points.find((candidate) => candidate.id === selectedPointId);
  const selectedEdge = piece && selectedEdgeId ? getEdgeById(piece, selectedEdgeId) : undefined;
  const segment = selectedEdgeId
    ? piece?.segments?.find((candidate) => candidate.id === selectedEdgeId)
    : undefined;
  const edgeStart = selectedEdge
    ? piece?.points.find((candidate) => candidate.id === selectedEdge.startPointId)
    : undefined;
  const edgeEnd = selectedEdge
    ? piece?.points.find((candidate) => candidate.id === selectedEdge.endPointId)
    : undefined;
  const targetPoint = handleTarget
    ? piece?.points.find((candidate) => candidate.id === handleTarget.pointId)
    : undefined;
  const handleVector = handleTarget?.handle === "in"
    ? targetPoint?.handleIn
    : handleTarget?.handle === "out"
      ? targetPoint?.handleOut
      : undefined;
  const polar = handleVector ? handleVectorToPolar(handleVector) : null;

  useEffect(() => {
    if (!handleTarget) return;
    const target = piece?.points.find((candidate) => candidate.id === handleTarget.pointId);
    const vector = handleTarget.handle === "in" ? target?.handleIn : target?.handleOut;
    if (!target || !vector) {
      setHandleTarget(null);
      setError(null);
    }
  }, [handleTarget, piece]);

  useEffect(() => {
    setHandleTarget(null);
    setError(null);
  }, [activePieceId, selectedEdgeId, selectedPointId]);

  if (!piece || (!point && !selectedEdge)) return null;

  const begin = (label: string) => {
    cancelNextBlurRef.current = false;
    setError(null);
    onEditStart(label);
  };

  const cancel = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelNextBlurRef.current = true;
      onEditCancel();
      setError(null);
      event.currentTarget.blur();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  const finish = (event: FocusEvent<HTMLInputElement>) => {
    if (cancelNextBlurRef.current) {
      cancelNextBlurRef.current = false;
      return;
    }
    if (!Number.isFinite(event.currentTarget.valueAsNumber)) {
      setError("Informe um número válido.");
      onEditCancel();
      return;
    }
    onEditEnd();
  };

  const movePointCoordinate = (axis: "x" | "y", value: number) => {
    if (!point || !Number.isFinite(value)) return;
    onMovePoint(
      point.id,
      axis === "x" ? value : point.xMm,
      axis === "y" ? value : point.yMm,
    );
  };

  const moveHandleVector = (nextX: number, nextY: number) => {
    if (
      !handleTarget
      || !targetPoint
      || !Number.isFinite(nextX)
      || !Number.isFinite(nextY)
    ) {
      return;
    }
    onMoveHandle(targetPoint.id, handleTarget.handle, nextX, nextY);
  };

  const pointHandleTarget = (handle: HandleKind): HandleTarget | null => {
    if (!point) return null;
    const vector = handle === "in" ? point.handleIn : point.handleOut;
    return vector ? { pointId: point.id, handle } : null;
  };
  const edgeOutTarget = edgeStart?.handleOut
    ? { pointId: edgeStart.id, handle: "out" as const }
    : null;
  const edgeInTarget = edgeEnd?.handleIn
    ? { pointId: edgeEnd.id, handle: "in" as const }
    : null;

  return (
    <div
      className="editor-core-numeric-panel"
      role="region"
      aria-label="Edição numérica do editor 2D"
      style={{
        position: "absolute",
        right: 12,
        bottom: 54,
        zIndex: 8,
        width: "min(330px, calc(100% - 24px))",
        padding: 10,
        border: "1px solid rgba(70,70,70,.22)",
        borderRadius: 10,
        background: "rgba(250,249,246,.96)",
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        display: "grid",
        gap: 8,
      }}
    >
      {point ? (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ marginRight: "auto" }}>Nó selecionado</strong>
            <button
              type="button"
              aria-pressed={handleTarget === null}
              onClick={() => setHandleTarget(null)}
            >
              Nó
            </button>
            <button
              type="button"
              aria-pressed={handleTarget?.pointId === point.id && handleTarget.handle === "in"}
              disabled={!point.handleIn}
              onClick={() => setHandleTarget(pointHandleTarget("in"))}
            >
              Handle entrada
            </button>
            <button
              type="button"
              aria-pressed={handleTarget?.pointId === point.id && handleTarget.handle === "out"}
              disabled={!point.handleOut}
              onClick={() => setHandleTarget(pointHandleTarget("out"))}
            >
              Handle saída
            </button>
          </div>

          {handleTarget === null ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <NumericField
                label="X"
                unit="mm"
                value={point.xMm}
                onFocus={() => begin("Editar X do ponto")}
                onBlur={finish}
                onKeyDown={cancel}
                onChange={(value) => movePointCoordinate("x", value)}
              />
              <NumericField
                label="Y"
                unit="mm"
                value={point.yMm}
                onFocus={() => begin("Editar Y do ponto")}
                onBlur={finish}
                onKeyDown={cancel}
                onChange={(value) => movePointCoordinate("y", value)}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {selectedEdge ? (
        <div style={{ display: "grid", gap: 7 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ marginRight: "auto" }}>
              Segmento · {segment?.kind === "cubic" || edgeOutTarget || edgeInTarget ? "cúbico" : "reta"}
            </strong>
            <button
              type="button"
              onClick={() =>
                convertSelectedSegment(segment?.kind === "cubic" ? "line" : "cubic")
              }
            >
              Converter
            </button>
            <button type="button" onClick={splitSelectedSegment}>
              Dividir
            </button>
          </div>
          {edgeOutTarget || edgeInTarget ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                aria-pressed={Boolean(
                  edgeOutTarget
                    && handleTarget?.pointId === edgeOutTarget.pointId
                    && handleTarget.handle === edgeOutTarget.handle,
                )}
                disabled={!edgeOutTarget}
                onClick={() => setHandleTarget(edgeOutTarget)}
              >
                Handle saída
              </button>
              <button
                type="button"
                aria-pressed={Boolean(
                  edgeInTarget
                    && handleTarget?.pointId === edgeInTarget.pointId
                    && handleTarget.handle === edgeInTarget.handle,
                )}
                disabled={!edgeInTarget}
                onClick={() => setHandleTarget(edgeInTarget)}
              >
                Handle entrada
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {handleTarget && handleVector && polar ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <NumericField
            label="Handle X"
            unit="mm"
            value={handleVector.xMm}
            onFocus={() => begin("Editar handle numericamente")}
            onBlur={finish}
            onKeyDown={cancel}
            onChange={(value) => moveHandleVector(value, handleVector.yMm)}
          />
          <NumericField
            label="Handle Y"
            unit="mm"
            value={handleVector.yMm}
            onFocus={() => begin("Editar handle numericamente")}
            onBlur={finish}
            onKeyDown={cancel}
            onChange={(value) => moveHandleVector(handleVector.xMm, value)}
          />
          <NumericField
            label="Comprimento"
            unit="mm"
            min={0}
            value={polar.lengthMm}
            onFocus={() => begin("Editar comprimento do handle")}
            onBlur={finish}
            onKeyDown={cancel}
            onChange={(value) => {
              if (value < 0) {
                setError("O comprimento do handle não pode ser negativo.");
                return;
              }
              const next = handleVectorFromPolar(value, polar.angleDeg);
              moveHandleVector(next.xMm, next.yMm);
            }}
          />
          <NumericField
            label="Ângulo"
            unit="°"
            value={polar.angleDeg}
            onFocus={() => begin("Editar ângulo do handle")}
            onBlur={finish}
            onKeyDown={cancel}
            onChange={(value) => {
              const next = handleVectorFromPolar(polar.lengthMm, value);
              moveHandleVector(next.xMm, next.yMm);
            }}
          />
        </div>
      ) : null}

      {error ? (
        <div role="alert" style={{ fontSize: 12, color: "#8b2f26" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

interface NumericFieldProps {
  label: string;
  unit: string;
  value: number;
  min?: number;
  onFocus(): void;
  onBlur(event: FocusEvent<HTMLInputElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  onChange(value: number): void;
}

function NumericField({
  label,
  unit,
  value,
  min,
  onFocus,
  onBlur,
  onKeyDown,
  onChange,
}: NumericFieldProps) {
  return (
    <label style={{ display: "grid", gap: 3, fontSize: 12 }}>
      <span>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min={min}
          value={Number.isFinite(value) ? roundForInput(value) : ""}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(next);
          }}
          style={{ minWidth: 0, width: "100%" }}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}

function roundForInput(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export const PatternCanvas = memo(PatternCanvasGuard);
