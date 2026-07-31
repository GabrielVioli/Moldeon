import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  createSeamAllowanceContour,
  samplePatternContour,
  samplePatternSegment,
} from "../domain/polygonGeometry";
import { PatternPoint, PatternSnapshot, distanceMm, type EdgeRange, getEdgeById, type Seam, type PatternPiece, type GarmentDraft } from "../domain/pattern";
import { findNearestPatternSegment } from "../domain/patternEditing";
import {
  Camera2D,
  ScreenPoint,
  cameraFromGesture,
  cameraToFitBounds,
  clampZoom,
} from "./camera";
import { useEditorStore } from "../state/editorStore";

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

export type EditorTool = "select" | "point" | "seam";

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

interface PieceDragState {
  type: "piece";
  pointerId: number;
  pieceId: string;
  startWorldX: number;
  startWorldY: number;
  startX: number;
  startY: number;
}

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
    | PieceDragState
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

  const snapRef = useRef<{ xMm: number; yMm: number; type: string } | null>(null);
  const seamSelectionRef = useRef<{ first?: EdgeRange; second?: EdgeRange } | null>(null);

  const garment = useEditorStore((s) => s.garment);
  const activePieceId = useEditorStore((s) => s.activePieceId);
  const garmentSeams = garment.seams ?? [];
  const selectPiece = useEditorStore((s) => s.selectPiece);
  const movePieceInWorkspace = useEditorStore((s) => s.movePieceInWorkspace);
  const setPieceWorkspaceTransform = useEditorStore((s) => s.setPieceWorkspaceTransform);

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
      snapRef.current,
      seamSelectionRef.current,
      garmentSeams,
      garment,
      activePieceId,
    );
  }, [activePieceId, garment, garmentSeams]);

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
          garmentBounds(garment),
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
  }, [scheduleDraw, garment]);

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

  function findPieceAtWorld(xMm: number, yMm: number): PatternPiece | null {
    const pieces = garment.pieces;
    const transforms = garment.workspaceTransforms ?? [];

    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      const piece = pieces[index];
      const transform = getPieceWorkspaceTransform(transforms, piece.id);
      if (isPointInsidePiece(xMm, yMm, piece.points, transform)) {
        return piece;
      }
    }
    return null;
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

      if (toolRef.current === "seam") {
        const world = screenToWorld(event.clientX, event.clientY);
        const target = findNearestPatternSegment(
          snapshotRef.current.piece.points,
          world,
        );
        if (!target || target.distanceMm > 18 / cameraRef.current.zoom) {
          dragRef.current = null;
          return;
        }
        const edge = { startPointId: target.startPointId, t0: 0, t1: 1 } as any;
        const selection = seamSelectionRef.current ?? (seamSelectionRef.current = {});
        if (!selection.first) {
          selection.first = edge;
          scheduleDraw();
          return;
        }
        if (!selection.second) {
          selection.second = edge;
          try {
            useEditorStore.getState().addSeam(selection.first!, selection.second!, "forward");
          } catch (e) {
            console.warn("Falha ao criar costura", e);
          }
          seamSelectionRef.current = null;
          scheduleDraw();
          return;
        }
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
      if (point) {
        onSelectPoint(point.id);
        onEditStartRef.current("Mover ponto");
        dragRef.current = { type: "point", pointerId: event.pointerId, pointId: point.id };
        return;
      }

      const world = screenToWorld(event.clientX, event.clientY);
      const piece = findPieceAtWorld(world.xMm, world.yMm);
      if (piece) {
        selectPiece(piece.id);
        onSelectPoint(null);
        dragRef.current = {
          type: "piece",
          pointerId: event.pointerId,
          pieceId: piece.id,
          startWorldX: world.xMm,
          startWorldY: world.yMm,
          startX: getPieceWorkspaceTransform(garment.workspaceTransforms ?? [], piece.id)?.xMm ?? 0,
          startY: getPieceWorkspaceTransform(garment.workspaceTransforms ?? [], piece.id)?.yMm ?? 0,
        };
        return;
      }

      dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);
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

    if (toolRef.current === "seam") {
      const world = screenToWorld(event.clientX, event.clientY);
      const target = findNearestPatternSegment(
        snapshotRef.current.piece.points,
        world,
      );
      if (!target || target.distanceMm > 18 / cameraRef.current.zoom) {
        dragRef.current = null;
        return;
      }
      const edge = { startPointId: target.startPointId, t0: 0, t1: 1 } as any;
      const selection = seamSelectionRef.current ?? (seamSelectionRef.current = {});
      if (!selection.first) {
        selection.first = edge;
        scheduleDraw();
        return;
      }
      if (!selection.second) {
        selection.second = edge;
        try {
          useEditorStore.getState().addSeam(selection.first!, selection.second!, "forward");
        } catch (e) {
          console.warn("Falha ao criar costura", e);
        }
        seamSelectionRef.current = null;
        scheduleDraw();
        return;
      }
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
    if (point) {
      onSelectPoint(point.id);
      onEditStartRef.current("Mover ponto");
      dragRef.current = {
        type: "point",
        pointerId: event.pointerId,
        pointId: point.id,
      };
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    const piece = findPieceAtWorld(world.xMm, world.yMm);
    if (piece) {
      selectPiece(piece.id);
      onSelectPoint(null);
      dragRef.current = {
        type: "piece",
        pointerId: event.pointerId,
        pieceId: piece.id,
        startWorldX: world.xMm,
        startWorldY: world.yMm,
        startX: getPieceWorkspaceTransform(garment.workspaceTransforms ?? [], piece.id)?.xMm ?? 0,
        startY: getPieceWorkspaceTransform(garment.workspaceTransforms ?? [], piece.id)?.yMm ?? 0,
      };
      return;
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

    if (drag.type === "piece") {
      const world = screenToWorld(event.clientX, event.clientY);
      const nextX = drag.startX + (world.xMm - drag.startWorldX);
      const nextY = drag.startY + (world.yMm - drag.startWorldY);
      setPieceWorkspaceTransform(drag.pieceId, {
        pieceId: drag.pieceId,
        xMm: nextX,
        yMm: nextY,
        rotationDeg: 0,
      });
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    if (drag.type === "point") {
      // snapping logic
      const snapPx = 10; // pixels
      const thresholdMm = snapPx / cameraRef.current.zoom;
      let snapped = null as { xMm: number; yMm: number; type: string } | null;
      // snap to other points
      for (const other of snapshotRef.current.piece.points) {
        if (other.id === drag.pointId) continue;
        const d = Math.hypot(other.xMm - world.xMm, other.yMm - world.yMm);
        if (d <= thresholdMm) {
          snapped = { xMm: other.xMm, yMm: other.yMm, type: "point" };
          break;
        }
      }
      // snap to midpoint of segments
      if (!snapped) {
        for (let i = 0; i < snapshotRef.current.piece.points.length; i += 1) {
          const a = snapshotRef.current.piece.points[i];
          const b = snapshotRef.current.piece.points[(i + 1) % snapshotRef.current.piece.points.length];
          const mx = (a.xMm + b.xMm) / 2;
          const my = (a.yMm + b.yMm) / 2;
          const d = Math.hypot(mx - world.xMm, my - world.yMm);
          if (d <= thresholdMm) {
            snapped = { xMm: mx, yMm: my, type: "midpoint" };
            break;
          }
        }
      }
      // snap to horizontal/vertical alignment with other points
      if (!snapped) {
        for (const other of snapshotRef.current.piece.points) {
          if (other.id === drag.pointId) continue;
          if (Math.abs(other.xMm - world.xMm) <= thresholdMm) {
            snapped = { xMm: other.xMm, yMm: world.yMm, type: "hv" };
            break;
          }
          if (Math.abs(other.yMm - world.yMm) <= thresholdMm) {
            snapped = { xMm: world.xMm, yMm: other.yMm, type: "hv" };
            break;
          }
        }
      }
      // snap to grid (10mm)
      if (!snapped) {
        const gx = Math.round(world.xMm / 10) * 10;
        const gy = Math.round(world.yMm / 10) * 10;
        if (Math.hypot(gx - world.xMm, gy - world.yMm) <= thresholdMm) {
          snapped = { xMm: gx, yMm: gy, type: "grid" };
        }
      }

      if (snapped) {
        snapRef.current = snapped;
        scheduleDraw();
        queueGeometryMove({
          type: "point",
          pointId: drag.pointId,
          xMm: Math.round(snapped.xMm * 10) / 10,
          yMm: Math.round(snapped.yMm * 10) / 10,
        });
        return;
      }

      snapRef.current = null;
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

    // snapping for handles respects anchor position (only grid/hv/points)
    const snapPx = 10;
    const thresholdMm = snapPx / cameraRef.current.zoom;
    let snappedHandle = null as { xMm: number; yMm: number; type: string } | null;
    for (const other of snapshotRef.current.piece.points) {
      if (Math.abs(other.xMm - (world.xMm)) <= thresholdMm) {
        snappedHandle = { xMm: other.xMm - anchor.xMm, yMm: world.yMm - anchor.yMm, type: "hv" };
        break;
      }
      if (Math.abs(other.yMm - (world.yMm)) <= thresholdMm) {
        snappedHandle = { xMm: world.xMm - anchor.xMm, yMm: other.yMm - anchor.yMm, type: "hv" };
        break;
      }
    }
    if (!snappedHandle) {
      const gx = Math.round(world.xMm / 10) * 10;
      const gy = Math.round(world.yMm / 10) * 10;
      if (Math.hypot(gx - world.xMm, gy - world.yMm) <= thresholdMm) {
        snappedHandle = { xMm: gx - anchor.xMm, yMm: gy - anchor.yMm, type: "grid" };
      }
    }

    if (snappedHandle) {
      snapRef.current = { xMm: anchor.xMm + snappedHandle.xMm, yMm: anchor.yMm + snappedHandle.yMm, type: snappedHandle.type };
      scheduleDraw();
      queueGeometryMove({
        type: "handle",
        pointId: drag.pointId,
        handle: drag.handle,
        xMm: Math.round(snappedHandle.xMm * 10) / 10,
        yMm: Math.round(snappedHandle.yMm * 10) / 10,
      });
      return;
    }

    snapRef.current = null;
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

  function handleDoubleClick(event: MouseEvent<HTMLCanvasElement>) {
    if (toolRef.current === "point" || toolRef.current === "seam") return;
    const world = screenToWorld(event.clientX, event.clientY);
    const piece = findPieceAtWorld(world.xMm, world.yMm);
    if (!piece) return;

    const sourcePoint = piece.points.find((candidate) => candidate.id === selectedPointIdRef.current);
    if (sourcePoint) {
      const points = piece.points;
      const nearestSegment = points
        .map((point, index) => {
          const next = points[(index + 1) % points.length];
          const middleX = (point.xMm + next.xMm) / 2;
          const middleY = (point.yMm + next.yMm) / 2;
          return {
            point,
            next,
            distanceMm: Math.hypot(middleX - world.xMm, middleY - world.yMm),
          };
        })
        .sort((left, right) => left.distanceMm - right.distanceMm)[0];
      if (nearestSegment && nearestSegment.distanceMm <= 12 / cameraRef.current.zoom) {
        if (nearestSegment.point.handleOut || nearestSegment.next.handleIn) {
          window.alert("Edição numérica de comprimento curvo ainda não está implementada.");
          return;
        }
        const input = window.prompt("Novo comprimento em mm", "300");
        if (input === null) return;
        const desiredLength = Number.parseFloat(input);
        if (!Number.isFinite(desiredLength) || desiredLength <= 0) {
          window.alert("Informe um valor positivo.");
          return;
        }
        const start = nearestSegment.point;
        const end = nearestSegment.next;
        const directionX = end.xMm - start.xMm;
        const directionY = end.yMm - start.yMm;
        const length = Math.hypot(directionX, directionY);
        if (length <= 0) return;
        const nextEnd = {
          xMm: start.xMm + (directionX / length) * desiredLength,
          yMm: start.yMm + (directionY / length) * desiredLength,
        };
        useEditorStore.getState().beginEdit("Editar comprimento");
        useEditorStore.getState().movePoint(end.id, nextEnd.xMm, nextEnd.yMm);
        useEditorStore.getState().commitEdit();
      }
      return;
    }

    const points = piece.points;
    const nearestSegment = points
      .map((point, index) => {
        const next = points[(index + 1) % points.length];
        const middleX = (point.xMm + next.xMm) / 2;
        const middleY = (point.yMm + next.yMm) / 2;
        return {
          point,
          next,
          distanceMm: Math.hypot(middleX - world.xMm, middleY - world.yMm),
        };
      })
      .sort((left, right) => left.distanceMm - right.distanceMm)[0];
    if (nearestSegment && nearestSegment.distanceMm <= 12 / cameraRef.current.zoom) {
      if (nearestSegment.point.handleOut || nearestSegment.next.handleIn) {
        window.alert("Edição numérica de comprimento curvo ainda não está implementada.");
        return;
      }
      const input = window.prompt("Novo comprimento em mm", "300");
      if (input === null) return;
      const desiredLength = Number.parseFloat(input);
      if (!Number.isFinite(desiredLength) || desiredLength <= 0) {
        window.alert("Informe um valor positivo.");
        return;
      }
      const start = nearestSegment.point;
      const end = nearestSegment.next;
      const directionX = end.xMm - start.xMm;
      const directionY = end.yMm - start.yMm;
      const length = Math.hypot(directionX, directionY);
      if (length <= 0) return;
      const nextEnd = {
        xMm: start.xMm + (directionX / length) * desiredLength,
        yMm: start.yMm + (directionY / length) * desiredLength,
      };
      useEditorStore.getState().beginEdit("Editar comprimento");
      useEditorStore.getState().movePoint(end.id, nextEnd.xMm, nextEnd.yMm);
      useEditorStore.getState().commitEdit();
    }
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

    snapRef.current = null;
    scheduleDraw();
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
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      aria-label="Editor de molde 2D"
    />
  );
}

export const PatternCanvas = memo(PatternCanvasComponent);

function getPieceWorkspaceTransform(
  transforms: readonly { pieceId: string; xMm: number; yMm: number; rotationDeg: number }[],
  pieceId: string,
) {
  return transforms.find((transform) => transform.pieceId === pieceId);
}

function applyPieceTransform(
  point: PatternPoint,
  transform: { pieceId: string; xMm: number; yMm: number; rotationDeg: number } | undefined,
): PatternPoint {
  if (!transform) return point;
  const rotationRad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const rotatedX = point.xMm * cos - point.yMm * sin;
  const rotatedY = point.xMm * sin + point.yMm * cos;
  return {
    ...point,
    xMm: rotatedX + transform.xMm,
    yMm: rotatedY + transform.yMm,
  };
}

function isPointInsidePiece(
  xMm: number,
  yMm: number,
  points: readonly PatternPoint[],
  transform: { pieceId: string; xMm: number; yMm: number; rotationDeg: number } | undefined,
): boolean {
  if (points.length < 3) return false;
  const contour = samplePatternContour(points);
  const transformed = contour.map((point) => applyPieceTransform(point, transform));
  let inside = false;
  for (let i = 0, j = transformed.length - 1; i < transformed.length; j = i++) {
    const xi = transformed[i].xMm;
    const yi = transformed[i].yMm;
    const xj = transformed[j].xMm;
    const yj = transformed[j].yMm;
    const intersects =
      yi > yMm !== yj > yMm &&
      xMm < ((xj - xi) * (yMm - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function contourBounds(points: readonly { xMm: number; yMm: number }[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.xMm);
    minY = Math.min(minY, point.yMm);
    maxX = Math.max(maxX, point.xMm);
    maxY = Math.max(maxY, point.yMm);
  }
  return {
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    maxX: Number.isFinite(maxX) ? maxX : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
  };
}

function preferredCanvasDpr(): number {
  const compact = window.matchMedia(MOBILE_QUERY).matches;
  const lowPower = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  return Math.min(window.devicePixelRatio || 1, compact || lowPower ? 1.5 : 2);
}

function garmentBounds(garment: GarmentDraft) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const piece of garment.pieces) {
    const contour = samplePatternContour(piece.points);
    const transform = getPieceWorkspaceTransform(
      garment.workspaceTransforms ?? [],
      piece.id,
    );
    const allowance = Math.max(0, piece.seamAllowanceMm);
    for (const point of contour) {
      const transformed = applyPieceTransform(point, transform);
      minX = Math.min(minX, transformed.xMm - allowance);
      minY = Math.min(minY, transformed.yMm - allowance);
      maxX = Math.max(maxX, transformed.xMm + allowance);
      maxY = Math.max(maxY, transformed.yMm + allowance);
    }
  }

  return {
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    maxX: Number.isFinite(maxX) ? maxX : 120,
    maxY: Number.isFinite(maxY) ? maxY : 120,
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
  snapOverlay: { xMm: number; yMm: number; type: string } | null,
  seamSelection: | { first?: EdgeRange; second?: EdgeRange } | null,
  seams: Seam[],
  garment: GarmentDraft,
  activePieceId: string,
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f4f2ed";
  context.fillRect(0, 0, width, height);

  // draw rulers in screen space
  drawRulers(context, width, height, camera);

  drawGrid(context, width, height, camera);

  const activePiece = garment.pieces.find((piece) => piece.id === activePieceId) ?? snapshot.piece;
  const activePoints = activePiece.points;
  if (activePoints.length < 3) return;
  const sampledContour = samplePatternContour(activePoints);

  context.save();
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);

  // draw persistent guides (from the active piece metadata)
  if (activePiece.guides) {
    for (const guide of activePiece.guides) {
      context.beginPath();
      if (guide.orientation === "vertical") {
        context.moveTo(guide.positionMm, -10000);
        context.lineTo(guide.positionMm, 10000);
      } else {
        context.moveTo(-10000, guide.positionMm);
        context.lineTo(10000, guide.positionMm);
      }
      context.strokeStyle = "rgba(100,120,140,0.45)";
      context.lineWidth = 1 / camera.zoom;
      context.setLineDash([4 / camera.zoom, 6 / camera.zoom]);
      context.stroke();
      context.setLineDash([]);
    }
  }

  for (const piece of garment.pieces) {
    const transform = getPieceWorkspaceTransform(garment.workspaceTransforms ?? [], piece.id);
    const transformedPoints = piece.points.map((point) => applyPieceTransform(point, transform));
    const transformedContour = samplePatternContour(piece.points).map((point) => applyPieceTransform(point, transform));
    const isActivePiece = piece.id === activePieceId;

    context.save();
    context.globalAlpha = isActivePiece ? 1 : 0.55;
    traceContour(context, transformedContour);
    context.fillStyle = isActivePiece ? "rgba(32, 33, 36, 0.08)" : "rgba(32, 33, 36, 0.04)";
    context.fill();
    context.strokeStyle = isActivePiece ? "#202124" : "#4f5458";
    context.lineWidth = isActivePiece ? 2 / camera.zoom : 1.4 / camera.zoom;
    context.stroke();

    const seamPoints = createSeamAllowanceContour(
      transformedContour,
      piece.seamAllowanceMm,
    );
    if (seamPoints && piece.seamAllowanceMm > 0) {
      traceContour(context, seamPoints);
      context.setLineDash([7 / camera.zoom, 5 / camera.zoom]);
      context.strokeStyle = isActivePiece ? "#777a75" : "#9aa0a6";
      context.lineWidth = 1.25 / camera.zoom;
      context.stroke();
      context.setLineDash([]);
    }

    if (isActivePiece) {
      for (const seam of seams) {
        try {
          const f: any = seam.first as any;
          const s: any = seam.second as any;
          if ((f.pieceId && f.pieceId === piece.id) || f.startPointId) {
            drawSeamIntervalAny(context, piece, f, camera.zoom, "#a23d3d");
          }
          if ((s.pieceId && s.pieceId === piece.id) || s.startPointId) {
            drawSeamIntervalAny(context, piece, s, camera.zoom, "#3d6aa2");
          }
        } catch (e) {
          // ignore malformed seams
        }
      }

      if (seamSelection?.first) {
        drawSeamIntervalAny(context, piece, seamSelection.first as any, camera.zoom, "rgba(160,160,60,0.9)");
      }
      if (seamSelection?.second) {
        drawSeamIntervalAny(context, piece, seamSelection.second as any, camera.zoom, "rgba(60,160,60,0.9)");
      }

      for (let index = 0; index < transformedPoints.length; index += 1) {
        const point = transformedPoints[index];
        const next = transformedPoints[(index + 1) % transformedPoints.length];
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

      const selectedPoint = transformedPoints.find((point) => point.id === selectedPointId);
      if (selectedPoint) {
        drawControlHandle(context, selectedPoint, "in", camera.zoom);
        drawControlHandle(context, selectedPoint, "out", camera.zoom);
      }

      for (const point of transformedPoints) {
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
    }

    if (isActivePiece) {
      const bounds = contourBounds(transformedContour);
      context.strokeStyle = "rgba(17, 18, 20, 0.9)";
      context.lineWidth = 1 / camera.zoom;
      context.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
      context.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      context.setLineDash([]);
    }

    context.restore();
  }

  // draw snapping feedback if present
  if (snapOverlay) {
    context.beginPath();
    context.arc(snapOverlay.xMm, snapOverlay.yMm, 6 / camera.zoom, 0, Math.PI * 2);
    context.fillStyle = "rgba(200,50,150,0.9)";
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 1 / camera.zoom;
    context.stroke();

    if (snapOverlay.type === "hv") {
      context.beginPath();
      context.strokeStyle = "rgba(200,50,150,0.25)";
      context.lineWidth = 1 / camera.zoom;
      context.moveTo(-10000, snapOverlay.yMm);
      context.lineTo(10000, snapOverlay.yMm);
      context.moveTo(snapOverlay.xMm, -10000);
      context.lineTo(snapOverlay.xMm, 10000);
      context.stroke();
    }
  }

  context.restore();

  // show seam info overlay in screen space if selection complete
  if (seamSelection?.first && seamSelection?.second) {
    const pointsArr = snapshot.piece.points;
    const firstLength = computeIntervalLength(pointsArr, seamSelection.first);
    const secondLength = computeIntervalLength(pointsArr, seamSelection.second);
    const diff = Math.abs(firstLength - secondLength);

    context.save();
    context.font = "13px system-ui, sans-serif";
    context.fillStyle = "rgba(32,33,36,0.9)";
    const lines = [
      `A: ${firstLength.toFixed(1)} mm`,
      `B: ${secondLength.toFixed(1)} mm`,
      `Diferença: ${diff.toFixed(1)} mm`,
    ];
    const padding = 8;
    const boxWidth = 200;
    const boxHeight = lines.length * 18 + padding * 2;
    context.fillStyle = "rgba(244,242,237,0.95)";
    context.fillRect(12, 12, boxWidth, boxHeight);
    context.fillStyle = "#404247";
    for (let i = 0; i < lines.length; i += 1) {
      context.fillText(lines[i], 20, 12 + padding + 16 * (i + 1));
    }
    context.restore();
  }
}

function drawRulers(context: CanvasRenderingContext2D, width: number, height: number, camera: Camera2D) {
  // top ruler
  const rulerSize = 28;
  context.save();
  context.fillStyle = "#e9e7e2";
  context.fillRect(0, 0, width, rulerSize);
  context.fillRect(0, 0, rulerSize, height);
  context.strokeStyle = "#d0cdc9";
  context.beginPath();
  context.moveTo(0, rulerSize - 0.5);
  context.lineTo(width, rulerSize - 0.5);
  context.moveTo(rulerSize - 0.5, 0);
  context.lineTo(rulerSize - 0.5, height);
  context.stroke();

  context.fillStyle = "#505258";
  context.font = "11px system-ui, sans-serif";
  context.textBaseline = "top";

  const minorPx = 10 * camera.zoom;
  const majorPx = 50 * camera.zoom;
  // draw ticks along top using camera pan offset
  for (let x = ((camera.panX % minorPx) + minorPx) % minorPx; x < width; x += minorPx) {
    const isMajor = Math.abs((x - (camera.panX % majorPx + majorPx) % majorPx)) < 0.0001 || (x % majorPx === 0);
    const tickHeight = isMajor ? 10 : 6;
    context.beginPath();
    context.moveTo(x + 0.5, rulerSize - 1);
    context.lineTo(x + 0.5, rulerSize - 1 - tickHeight);
    context.stroke();
    if (isMajor) {
      // compute world coordinate at this screen x
      const worldX = (x - camera.panX) / camera.zoom;
      context.fillText(`${Math.round(worldX)} mm`, x + 4, 2);
    }
  }

  // left ticks
  context.textAlign = "left";
  for (let y = ((camera.panY % minorPx) + minorPx) % minorPx; y < height; y += minorPx) {
    const isMajor = Math.abs((y - (camera.panY % majorPx + majorPx) % majorPx)) < 0.0001 || (y % majorPx === 0);
    const tickWidth = isMajor ? 10 : 6;
    context.beginPath();
    context.moveTo(rulerSize - 1, y + 0.5);
    context.lineTo(rulerSize - 1 - tickWidth, y + 0.5);
    context.stroke();
    if (isMajor) {
      const worldY = (y - camera.panY) / camera.zoom;
      context.fillText(`${Math.round(worldY)} mm`, 4, y + 2);
    }
  }

  context.restore();
}

function drawSeamInterval(
  context: CanvasRenderingContext2D,
  points: readonly PatternPoint[],
  startPointId: string,
  t0: number,
  t1: number,
  zoom: number,
  color: string,
) {
  const startIndex = points.findIndex((p) => p.id === startPointId);
  if (startIndex < 0) return;
  const p0 = points[startIndex];
  const p1 = points[(startIndex + 1) % points.length];
  const samples = samplePatternSegment(p0, p1);
  if (samples.length < 2) return;
  const totalSteps = samples.length - 1;
  const startIndexF = Math.floor(t0 * totalSteps);
  const endIndexF = Math.ceil(t1 * totalSteps);
  context.beginPath();
  context.moveTo(samples[startIndexF].xMm, samples[startIndexF].yMm);
  for (let i = startIndexF + 1; i <= endIndexF; i += 1) {
    context.lineTo(samples[i].xMm, samples[i].yMm);
  }
  context.strokeStyle = color;
  context.lineWidth = 3 / zoom;
  context.stroke();
}

function drawSeamIntervalAny(
  context: CanvasRenderingContext2D,
  piece: PatternPiece,
  range: any,
  zoom: number,
  color: string,
) {
  // support legacy range { startPointId, t0, t1 } and new range { pieceId, edgeId, startT, endT }
  if (range.startPointId !== undefined) {
    drawSeamInterval(context, piece.points, range.startPointId, range.t0, range.t1, zoom, color);
    return;
  }
  if (range.pieceId !== piece.id) return; // range references another piece
  // try to resolve edgeId to startPointId
  const edge = getEdgeById(piece, range.edgeId);
  if (!edge) return;
  drawSeamInterval(context, piece.points, edge.startPointId, range.startT, range.endT, zoom, color);
}

function computeIntervalLength(points: readonly PatternPoint[], range: any): number {
  // support legacy { startPointId, t0, t1 } and new { pieceId, edgeId, startT, endT }
  if (range.startPointId !== undefined) {
    const startIndex = points.findIndex((p) => p.id === range.startPointId);
    if (startIndex < 0) return 0;
    const p0 = points[startIndex];
    const p1 = points[(startIndex + 1) % points.length];
    const samples = samplePatternSegment(p0, p1);
    if (samples.length < 2) return 0;
    const totalSteps = samples.length - 1;
    const startIndexF = Math.floor(range.t0 * totalSteps);
    const endIndexF = Math.ceil(range.t1 * totalSteps);
    let length = 0;
    for (let i = startIndexF; i < endIndexF; i += 1) {
      length += distanceMm(samples[i], samples[i + 1]);
    }
    return length;
  }
  // new shape expected to be handled elsewhere; if edgeId present we cannot compute here
  return 0;
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
