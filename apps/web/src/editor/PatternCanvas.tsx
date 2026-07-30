import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  createSeamAllowanceContour,
  samplePatternContour,
  samplePatternSegment,
} from "../domain/polygonGeometry";
import { PatternPoint, PatternSnapshot, distanceMm } from "../domain/pattern";
import { findNearestPatternSegment } from "../domain/patternEditing";
import {
  Camera2D,
  ScreenPoint,
  cameraFromGesture,
  cameraToFitBounds,
  clampZoom,
} from "./camera";

interface PatternCanvasProps {
  snapshot: PatternSnapshot;
  tool: EditorTool;
  selectedPointId: string | null;
  onSelectPoint(pointId: string | null): void;
  onEditStart(label: string): void;
  onEditEnd(): void;
  onMovePoint(pointId: string, xMm: number, yMm: number): void;
  onMoveHandle(
    pointId: string,
    handle: "in" | "out",
    xMm: number,
    yMm: number,
  ): void;
  onInsertPoint(startPointId: string, t: number): void;
}

export type EditorTool = "select" | "point";

const POINT_RADIUS_PX = 7;
const INITIAL_CAMERA: Camera2D = { zoom: 0.72, panX: 105, panY: 70 };
const MOBILE_QUERY = "(max-width: 760px)";

interface PointerPosition {
  clientX: number;
  clientY: number;
}

type PendingGeometryMove =
  | { type: "point"; pointId: string; xMm: number; yMm: number }
  | {
      type: "handle";
      pointId: string;
      handle: "in" | "out";
      xMm: number;
      yMm: number;
    };

function PatternCanvasComponent({
  snapshot,
  tool,
  selectedPointId,
  onSelectPoint,
  onEditStart,
  onEditEnd,
  onMovePoint,
  onMoveHandle,
  onInsertPoint,
}: PatternCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const cameraRef = useRef<Camera2D>(INITIAL_CAMERA);
  const snapshotRef = useRef(snapshot);
  const selectedPointIdRef = useRef(selectedPointId);
  const toolRef = useRef(tool);
  const onEditStartRef = useRef(onEditStart);
  const onEditEndRef = useRef(onEditEnd);
  const onMovePointRef = useRef(onMovePoint);
  const onMoveHandleRef = useRef(onMoveHandle);
  const onInsertPointRef = useRef(onInsertPoint);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const hasFittedCameraRef = useRef(false);
  const drawFrameRef = useRef<number | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<PendingGeometryMove | null>(null);
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const dragRef = useRef<
    | { type: "point"; pointerId: number; pointId: string }
    | {
        type: "handle";
        pointerId: number;
        pointId: string;
        handle: "in" | "out";
      }
    | {
        type: "pan";
        pointerId: number;
        startX: number;
        startY: number;
        panX: number;
        panY: number;
      }
    | {
        type: "pinch";
        pointerIds: [number, number];
        startDistance: number;
        startCenter: ScreenPoint;
        startCamera: Camera2D;
      }
    | null
  >(null);

  snapshotRef.current = snapshot;
  selectedPointIdRef.current = selectedPointId;
  toolRef.current = tool;
  onEditStartRef.current = onEditStart;
  onEditEndRef.current = onEditEnd;
  onMovePointRef.current = onMovePoint;
  onMoveHandleRef.current = onMoveHandle;
  onInsertPointRef.current = onInsertPoint;

  const drawLatest = useCallback(() => {
    drawFrameRef.current = null;
    const context = contextRef.current;
    if (!context) return;

    const { width, height } = canvasSizeRef.current;
    draw(
      context,
      width,
      height,
      snapshotRef.current,
      selectedPointIdRef.current,
      cameraRef.current,
    );
  }, []);

  const scheduleDraw = useCallback(() => {
    if (drawFrameRef.current !== null) return;
    drawFrameRef.current = window.requestAnimationFrame(drawLatest);
  }, [drawLatest]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    contextRef.current = context;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = preferredCanvasDpr();
      const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
      const pixelHeight = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvasSizeRef.current = { width: rect.width, height: rect.height };
      if (!hasFittedCameraRef.current && rect.width > 0 && rect.height > 0) {
        cameraRef.current = cameraToFitBounds(
          snapshotBounds(snapshotRef.current),
          canvasSizeRef.current,
          rect.width <= 760 ? 34 : 54,
        );
        hasFittedCameraRef.current = true;
      }
      scheduleDraw();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      contextRef.current = null;
      if (drawFrameRef.current !== null) {
        window.cancelAnimationFrame(drawFrameRef.current);
        drawFrameRef.current = null;
      }
      if (moveFrameRef.current !== null) {
        window.cancelAnimationFrame(moveFrameRef.current);
        moveFrameRef.current = null;
      }
    };
  }, [scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [snapshot, selectedPointId, scheduleDraw]);

  function updateCamera(nextCamera: Camera2D) {
    cameraRef.current = nextCamera;
    scheduleDraw();
  }

  function queueGeometryMove(move: PendingGeometryMove) {
    pendingMoveRef.current = move;
    if (moveFrameRef.current !== null) return;

    moveFrameRef.current = window.requestAnimationFrame(() => {
      moveFrameRef.current = null;
      const pending = pendingMoveRef.current;
      pendingMoveRef.current = null;
      if (pending) {
        applyGeometryMove(pending);
      }
    });
  }

  function applyGeometryMove(move: PendingGeometryMove) {
    if (move.type === "point") {
      onMovePointRef.current(move.pointId, move.xMm, move.yMm);
    } else {
      onMoveHandleRef.current(
        move.pointId,
        move.handle,
        move.xMm,
        move.yMm,
      );
    }
  }

  function flushGeometryMove() {
    if (moveFrameRef.current !== null) {
      window.cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (pending) applyGeometryMove(pending);
  }

  function screenToWorld(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return { xMm: 0, yMm: 0 };

    const rect = canvas.getBoundingClientRect();
    const currentCamera = cameraRef.current;
    return {
      xMm: (clientX - rect.left - currentCamera.panX) / currentCamera.zoom,
      yMm: (clientY - rect.top - currentCamera.panY) / currentCamera.zoom,
    };
  }

  function findPoint(clientX: number, clientY: number): PatternPoint | null {
    const world = screenToWorld(clientX, clientY);
    const maxDistanceMm = (POINT_RADIUS_PX + 5) / cameraRef.current.zoom;

    return (
      snapshotRef.current.piece.points.find(
        (point) =>
          Math.hypot(point.xMm - world.xMm, point.yMm - world.yMm) <=
          maxDistanceMm,
      ) ?? null
    );
  }

  function findHandle(
    clientX: number,
    clientY: number,
  ): { pointId: string; handle: "in" | "out" } | null {
    const selected = snapshotRef.current.piece.points.find(
      (point) => point.id === selectedPointIdRef.current,
    );
    if (!selected) return null;

    const world = screenToWorld(clientX, clientY);
    const maxDistanceMm = (POINT_RADIUS_PX + 6) / cameraRef.current.zoom;
    for (const handle of ["in", "out"] as const) {
      const vector =
        handle === "in" ? selected.handleIn : selected.handleOut;
      if (
        vector &&
        Math.hypot(
          selected.xMm + vector.xMm - world.xMm,
          selected.yMm + vector.yMm - world.yMm,
        ) <= maxDistanceMm
      ) {
        return { pointId: selected.id, handle };
      }
    }
    return null;
  }

  function insertPointNear(clientX: number, clientY: number): boolean {
    const world = screenToWorld(clientX, clientY);
    const target = findNearestPatternSegment(
      snapshotRef.current.piece.points,
      world,
    );
    if (
      !target ||
      target.distanceMm > 18 / cameraRef.current.zoom
    ) {
      return false;
    }
    onInsertPointRef.current(target.startPointId, target.t);
    return true;
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch") {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (activePointersRef.current.size >= 2) {
        if (
          dragRef.current?.type === "point" ||
          dragRef.current?.type === "handle"
        ) {
          flushGeometryMove();
          onEditEndRef.current();
        }
        beginPinch();
        return;
      }

      if (toolRef.current === "point") {
        insertPointNear(event.clientX, event.clientY);
        dragRef.current = null;
        return;
      }

      const controlHandle = findHandle(event.clientX, event.clientY);
      if (controlHandle) {
        onEditStartRef.current("Ajustar curva");
        dragRef.current = {
          type: "handle",
          pointerId: event.pointerId,
          ...controlHandle,
        };
        return;
      }

      const point = findPoint(event.clientX, event.clientY);
      onSelectPoint(point?.id ?? null);
      if (point) onEditStartRef.current("Mover ponto");
      dragRef.current = point
        ? { type: "point", pointerId: event.pointerId, pointId: point.id }
        : createPanDrag(event.pointerId, event.clientX, event.clientY);
      return;
    }

    if (event.button === 1 || event.shiftKey) {
      dragRef.current = createPanDrag(
        event.pointerId,
        event.clientX,
        event.clientY,
      );
      return;
    }

    if (toolRef.current === "point") {
      insertPointNear(event.clientX, event.clientY);
      dragRef.current = null;
      return;
    }

    const controlHandle = findHandle(event.clientX, event.clientY);
    if (controlHandle) {
      onEditStartRef.current("Ajustar curva");
      dragRef.current = {
        type: "handle",
        pointerId: event.pointerId,
        ...controlHandle,
      };
      return;
    }

    const point = findPoint(event.clientX, event.clientY);
    onSelectPoint(point?.id ?? null);

    if (point) {
      onEditStartRef.current("Mover ponto");
      dragRef.current = {
        type: "point",
        pointerId: event.pointerId,
        pointId: point.id,
      };
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === "pinch") {
      const [firstId, secondId] = drag.pointerIds;
      const first = activePointersRef.current.get(firstId);
      const second = activePointersRef.current.get(secondId);
      if (!first || !second) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const currentCenter = pointerCenter(first, second, rect.left, rect.top);
      const currentDistance = pointerDistance(first, second);
      updateCamera(
        cameraFromGesture(
          drag.startCamera,
          drag.startCenter,
          currentCenter,
          currentDistance / drag.startDistance,
        ),
      );
      return;
    }

    if (drag.pointerId !== event.pointerId) return;

    if (drag.type === "pan") {
      updateCamera({
        ...cameraRef.current,
        panX: drag.panX + event.clientX - drag.startX,
        panY: drag.panY + event.clientY - drag.startY,
      });
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    if (drag.type === "point") {
      queueGeometryMove({
        type: "point",
        pointId: drag.pointId,
        xMm: Math.round(world.xMm * 10) / 10,
        yMm: Math.round(world.yMm * 10) / 10,
      });
      return;
    }

    const anchor = snapshotRef.current.piece.points.find(
      (point) => point.id === drag.pointId,
    );
    if (!anchor) return;
    queueGeometryMove({
      type: "handle",
      pointId: drag.pointId,
      handle: drag.handle,
      xMm: Math.round((world.xMm - anchor.xMm) * 10) / 10,
      yMm: Math.round((world.yMm - anchor.yMm) * 10) / 10,
    });
  }

  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const currentCamera = cameraRef.current;
    const worldX = (cursorX - currentCamera.panX) / currentCamera.zoom;
    const worldY = (cursorY - currentCamera.panY) / currentCamera.zoom;
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = clampZoom(currentCamera.zoom * factor);

    updateCamera({
      zoom: nextZoom,
      panX: cursorX - worldX * nextZoom,
      panY: cursorY - worldY * nextZoom,
    });
  }

  function createPanDrag(
    pointerId: number,
    clientX: number,
    clientY: number,
  ) {
    return {
      type: "pan" as const,
      pointerId,
      startX: clientX,
      startY: clientY,
      panX: cameraRef.current.panX,
      panY: cameraRef.current.panY,
    };
  }

  function beginPinch() {
    const canvas = canvasRef.current;
    const pointers = [...activePointersRef.current.entries()];
    if (!canvas || pointers.length < 2) return;

    const [[firstId, first], [secondId, second]] = pointers;
    const rect = canvas.getBoundingClientRect();
    dragRef.current = {
      type: "pinch",
      pointerIds: [firstId, secondId],
      startDistance: Math.max(pointerDistance(first, second), 1),
      startCenter: pointerCenter(first, second, rect.left, rect.top),
      startCamera: cameraRef.current,
    };
  }

  function finishPointer(event: PointerEvent<HTMLCanvasElement>) {
    const finishedDrag = dragRef.current;
    activePointersRef.current.delete(event.pointerId);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (activePointersRef.current.size >= 2) {
      beginPinch();
      return;
    }

    if (
      finishedDrag?.type === "point" &&
      finishedDrag.pointerId === event.pointerId
    ) {
      flushGeometryMove();
      onEditEndRef.current();
    }
    if (
      finishedDrag?.type === "handle" &&
      finishedDrag.pointerId === event.pointerId
    ) {
      flushGeometryMove();
      onEditEndRef.current();
    }

    const remaining = [...activePointersRef.current.entries()][0];
    if (remaining) {
      const [pointerId, position] = remaining;
      dragRef.current = createPanDrag(
        pointerId,
        position.clientX,
        position.clientY,
      );
      return;
    }

    dragRef.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`pattern-canvas pattern-canvas-${tool}`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onWheel={handleWheel}
      aria-label="Editor de molde 2D"
    />
  );
}

export const PatternCanvas = memo(PatternCanvasComponent);

function preferredCanvasDpr(): number {
  const compact = window.matchMedia(MOBILE_QUERY).matches;
  const lowPower = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  return Math.min(window.devicePixelRatio || 1, compact || lowPower ? 1.5 : 2);
}

function snapshotBounds(snapshot: PatternSnapshot) {
  const contour = samplePatternContour(snapshot.piece.points);
  const allowance = Math.max(0, snapshot.piece.seamAllowanceMm);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of contour) {
    minX = Math.min(minX, point.xMm);
    minY = Math.min(minY, point.yMm);
    maxX = Math.max(maxX, point.xMm);
    maxY = Math.max(maxY, point.yMm);
  }

  return {
    minX: minX - allowance,
    minY: minY - allowance,
    maxX: maxX + allowance,
    maxY: maxY + allowance,
  };
}

function pointerDistance(
  first: PointerPosition,
  second: PointerPosition,
): number {
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY,
  );
}

function pointerCenter(
  first: PointerPosition,
  second: PointerPosition,
  offsetX: number,
  offsetY: number,
): ScreenPoint {
  return {
    x: (first.clientX + second.clientX) / 2 - offsetX,
    y: (first.clientY + second.clientY) / 2 - offsetY,
  };
}

function draw(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: PatternSnapshot,
  selectedPointId: string | null,
  camera: Camera2D,
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f4f2ed";
  context.fillRect(0, 0, width, height);

  drawGrid(context, width, height, camera);

  const points = snapshot.piece.points;
  if (points.length < 3) return;
  const sampledContour = samplePatternContour(points);

  context.save();
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);

  tracePatternContour(context, points);
  context.fillStyle = "rgba(32, 33, 36, 0.08)";
  context.fill();
  context.strokeStyle = "#202124";
  context.lineWidth = 2 / camera.zoom;
  context.stroke();

  const seamPoints = createSeamAllowanceContour(
    sampledContour,
    snapshot.piece.seamAllowanceMm,
  );
  if (seamPoints && snapshot.piece.seamAllowanceMm > 0) {
    traceContour(context, seamPoints);
    context.setLineDash([7 / camera.zoom, 5 / camera.zoom]);
    context.strokeStyle = "#777a75";
    context.lineWidth = 1.25 / camera.zoom;
    context.stroke();
    context.setLineDash([]);
  }

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const middleX = (point.xMm + next.xMm) / 2;
    const middleY = (point.yMm + next.yMm) / 2;
    const sampledSegment = samplePatternSegment(point, next);
    const length = sampledSegment
      .slice(0, -1)
      .reduce(
        (total, current, segmentIndex) =>
          total + distanceMm(current, sampledSegment[segmentIndex + 1]),
        0,
      );

    context.save();
    context.translate(middleX, middleY);
    context.scale(1 / camera.zoom, 1 / camera.zoom);
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(244, 242, 237, 0.92)";
    context.fillRect(-34, -10, 68, 20);
    context.fillStyle = "#505258";
    context.fillText(`${length.toFixed(1)} mm`, 0, 0);
    context.restore();
  }

  const selectedPoint = points.find((point) => point.id === selectedPointId);
  if (selectedPoint) {
    drawControlHandle(context, selectedPoint, "in", camera.zoom);
    drawControlHandle(context, selectedPoint, "out", camera.zoom);
  }

  for (const point of points) {
    const selected = point.id === selectedPointId;
    context.beginPath();
    context.arc(
      point.xMm,
      point.yMm,
      (selected ? 7 : 5) / camera.zoom,
      0,
      Math.PI * 2,
    );
    context.fillStyle = selected ? "#111214" : "#ffffff";
    context.fill();
    context.strokeStyle = "#111214";
    context.lineWidth = 2 / camera.zoom;
    context.stroke();
  }

  context.restore();
}

function tracePatternContour(
  context: CanvasRenderingContext2D,
  points: readonly PatternPoint[],
) {
  context.beginPath();
  context.moveTo(points[0].xMm, points[0].yMm);
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current.handleOut || next.handleIn) {
      context.bezierCurveTo(
        current.xMm + (current.handleOut?.xMm ?? 0),
        current.yMm + (current.handleOut?.yMm ?? 0),
        next.xMm + (next.handleIn?.xMm ?? 0),
        next.yMm + (next.handleIn?.yMm ?? 0),
        next.xMm,
        next.yMm,
      );
    } else {
      context.lineTo(next.xMm, next.yMm);
    }
  }
  context.closePath();
}

function traceContour(
  context: CanvasRenderingContext2D,
  points: readonly PatternPoint[],
) {
  context.beginPath();
  context.moveTo(points[0].xMm, points[0].yMm);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].xMm, points[index].yMm);
  }
  context.closePath();
}

function drawControlHandle(
  context: CanvasRenderingContext2D,
  point: PatternPoint,
  handle: "in" | "out",
  zoom: number,
) {
  const vector = handle === "in" ? point.handleIn : point.handleOut;
  if (!vector) return;

  const xMm = point.xMm + vector.xMm;
  const yMm = point.yMm + vector.yMm;
  context.beginPath();
  context.moveTo(point.xMm, point.yMm);
  context.lineTo(xMm, yMm);
  context.strokeStyle = "#4a6990";
  context.lineWidth = 1 / zoom;
  context.stroke();

  context.beginPath();
  context.arc(xMm, yMm, 5 / zoom, 0, Math.PI * 2);
  context.fillStyle = "#f4f2ed";
  context.fill();
  context.strokeStyle = "#31577f";
  context.lineWidth = 2 / zoom;
  context.stroke();
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera2D,
) {
  const minor = 10 * camera.zoom;
  const major = 50 * camera.zoom;

  context.lineWidth = 1;

  if (minor >= 6) {
    context.strokeStyle = "rgba(30, 31, 33, 0.045)";
    context.beginPath();
    for (let x = camera.panX % minor; x < width; x += minor) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    for (let y = camera.panY % minor; y < height; y += minor) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.stroke();
  }

  context.strokeStyle = "rgba(30, 31, 33, 0.1)";
  context.beginPath();
  for (let x = camera.panX % major; x < width; x += major) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = camera.panY % major; y < height; y += major) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}
