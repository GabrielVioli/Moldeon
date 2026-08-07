import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useEditorStore } from "../state/editorStore";
import {
  handleVectorFromPolar,
  handleVectorToPolar,
} from "./editorCoreMath";
import { PatternCanvas as LegacyPatternCanvas } from "./PatternCanvasLegacy";

export type { EditorTool } from "./PatternCanvasLegacy";

type PatternCanvasProps = ComponentProps<typeof LegacyPatternCanvas>;
type HandleKind = "in" | "out";

export function canvasDocumentGenerationKey(
  pieceIds: readonly string[],
  activePieceId: string,
): string {
  return `${pieceIds.join("\u001f")}\u001e${activePieceId}`;
}

function PatternCanvasGuard(props: PatternCanvasProps) {
  const generationKey = useEditorStore((state) =>
    canvasDocumentGenerationKey(
      state.garment.pieces.map((piece) => piece.id),
      state.activePieceId,
    ),
  );

  return (
    <div className="editor-core-canvas-shell" data-editor-core-gate="9.5-04">
      <LegacyPatternCanvas key={generationKey} {...props} />
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
  const [selectedHandle, setSelectedHandle] = useState<HandleKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const piece = garment.pieces.find((candidate) => candidate.id === activePieceId);
  const point = piece?.points.find((candidate) => candidate.id === selectedPointId);
  const segment = selectedEdgeId
    ? piece?.segments?.find((candidate) => candidate.id === selectedEdgeId)
    : undefined;

  useEffect(() => {
    if (!point) {
      setSelectedHandle(null);
      setError(null);
      return;
    }
    if (
      (selectedHandle === "in" && !point.handleIn)
      || (selectedHandle === "out" && !point.handleOut)
    ) {
      setSelectedHandle(null);
    }
  }, [point, selectedHandle]);

  useEffect(() => {
    const clearTransientSelection = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedHandle(null);
        setError(null);
      }
    };
    window.addEventListener("keydown", clearTransientSelection);
    return () => window.removeEventListener("keydown", clearTransientSelection);
  }, []);

  if (!piece || (!point && !segment)) return null;

  const handleVector =
    selectedHandle === "in"
      ? point?.handleIn
      : selectedHandle === "out"
        ? point?.handleOut
        : undefined;
  const polar = handleVector ? handleVectorToPolar(handleVector) : null;

  const begin = (label: string) => {
    setError(null);
    onEditStart(label);
  };

  const cancel = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
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
      !point
      || !selectedHandle
      || !Number.isFinite(nextX)
      || !Number.isFinite(nextY)
    ) {
      return;
    }
    onMoveHandle(point.id, selectedHandle, nextX, nextY);
  };

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
              aria-pressed={selectedHandle === null}
              onClick={() => setSelectedHandle(null)}
            >
              Nó
            </button>
            <button
              type="button"
              aria-pressed={selectedHandle === "in"}
              disabled={!point.handleIn}
              onClick={() => setSelectedHandle("in")}
            >
              Handle entrada
            </button>
            <button
              type="button"
              aria-pressed={selectedHandle === "out"}
              disabled={!point.handleOut}
              onClick={() => setSelectedHandle("out")}
            >
              Handle saída
            </button>
          </div>

          {selectedHandle === null ? (
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
          ) : handleVector && polar ? (
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
        </>
      ) : null}

      {segment ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ marginRight: "auto" }}>
            Segmento · {segment.kind === "cubic" ? "cúbico" : "reta"}
          </strong>
          <button
            type="button"
            onClick={() =>
              convertSelectedSegment(segment.kind === "cubic" ? "line" : "cubic")
            }
          >
            Converter
          </button>
          <button type="button" onClick={splitSelectedSegment}>
            Dividir
          </button>
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
