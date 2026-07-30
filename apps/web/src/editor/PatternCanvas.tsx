import { PointerEvent, WheelEvent, useEffect, useRef, useState } from "react";
import { PatternPoint, PatternSnapshot, distanceMm } from "../domain/pattern";
import { Camera2D, ScreenPoint, cameraFromGesture, clampZoom } from "./camera";

interface PatternCanvasProps {
  snapshot: PatternSnapshot;
  selectedPointId: string | null;
  onSelectPoint(pointId: string | null): void;
  onMovePoint(pointId: string, xMm: number, yMm: number): void;
}

const POINT_RADIUS_PX = 7;
const INITIAL_CAMERA: Camera2D = { zoom: 0.72, panX: 105, panY: 70 };

interface PointerPosition {
  clientX: number;
  clientY: number;
}

export function PatternCanvas({
  snapshot,
  selectedPointId,
  onSelectPoint,
  onMovePoint,
}: PatternCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera2D>(INITIAL_CAMERA);
  const cameraRef = useRef<Camera2D>(INITIAL_CAMERA);
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const dragRef = useRef<
    | { type: "point"; pointerId: number; pointId: string }
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

  function updateCamera(nextCamera: Camera2D) {
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(context, rect.width, rect.height, snapshot, selectedPointId, camera);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => observer.disconnect();
  }, [snapshot, selectedPointId, camera]);

  function screenToWorld(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
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
      snapshot.piece.points.find(
        (point) => Math.hypot(point.xMm - world.xMm, point.yMm - world.yMm) <= maxDistanceMm,
      ) ?? null
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch") {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (activePointersRef.current.size >= 2) {
        beginPinch();
        return;
      }

      const point = findPoint(event.clientX, event.clientY);
      onSelectPoint(point?.id ?? null);
      dragRef.current = point
        ? { type: "point", pointerId: event.pointerId, pointId: point.id }
        : createPanDrag(event.pointerId, event.clientX, event.clientY);
      return;
    }

    if (event.button === 1 || event.shiftKey) {
      dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);
      return;
    }

    const point = findPoint(event.clientX, event.clientY);
    onSelectPoint(point?.id ?? null);

    if (point) {
      dragRef.current = { type: "point", pointerId: event.pointerId, pointId: point.id };
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
    onMovePoint(drag.pointId, Math.round(world.xMm * 10) / 10, Math.round(world.yMm * 10) / 10);
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    finishPointer(event);
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

  function createPanDrag(pointerId: number, clientX: number, clientY: number) {
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
    activePointersRef.current.delete(event.pointerId);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (activePointersRef.current.size >= 2) {
      beginPinch();
      return;
    }

    const remaining = [...activePointersRef.current.entries()][0];
    if (remaining) {
      const [pointerId, position] = remaining;
      dragRef.current = createPanDrag(pointerId, position.clientX, position.clientY);
      return;
    }

    dragRef.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="pattern-canvas"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={finishPointer}
      onWheel={handleWheel}
      aria-label="Editor de molde 2D"
    />
  );
}

function pointerDistance(first: PointerPosition, second: PointerPosition): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
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

  context.save();
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);

  context.beginPath();
  context.moveTo(points[0].xMm, points[0].yMm);
  for (const point of points.slice(1)) {
    context.lineTo(point.xMm, point.yMm);
  }
  context.closePath();
  context.fillStyle = "rgba(32, 33, 36, 0.08)";
  context.fill();
  context.strokeStyle = "#202124";
  context.lineWidth = 2 / camera.zoom;
  context.stroke();


  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const middleX = (point.xMm + next.xMm) / 2;
    const middleY = (point.yMm + next.yMm) / 2;
    const length = distanceMm(point, next);

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

  for (const point of points) {
    const selected = point.id === selectedPointId;
    context.beginPath();
    context.arc(point.xMm, point.yMm, (selected ? 7 : 5) / camera.zoom, 0, Math.PI * 2);
    context.fillStyle = selected ? "#111214" : "#ffffff";
    context.fill();
    context.strokeStyle = "#111214";
    context.lineWidth = 2 / camera.zoom;
    context.stroke();
  }

  context.restore();
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
