import { PointerEvent, WheelEvent, useEffect, useRef, useState } from "react";
import { PatternPoint, PatternSnapshot, distanceMm } from "../domain/pattern";

interface PatternCanvasProps {
  snapshot: PatternSnapshot;
  selectedPointId: string | null;
  onSelectPoint(pointId: string | null): void;
  onMovePoint(pointId: string, xMm: number, yMm: number): void;
}

interface Camera2D {
  zoom: number;
  panX: number;
  panY: number;
}

const POINT_RADIUS_PX = 7;

export function PatternCanvas({
  snapshot,
  selectedPointId,
  onSelectPoint,
  onMovePoint,
}: PatternCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera2D>({ zoom: 0.72, panX: 105, panY: 70 });
  const dragRef = useRef<
    | { type: "point"; pointId: string }
    | { type: "pan"; startX: number; startY: number; panX: number; panY: number }
    | null
  >(null);

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
    return {
      xMm: (clientX - rect.left - camera.panX) / camera.zoom,
      yMm: (clientY - rect.top - camera.panY) / camera.zoom,
    };
  }

  function findPoint(clientX: number, clientY: number): PatternPoint | null {
    const world = screenToWorld(clientX, clientY);
    const maxDistanceMm = (POINT_RADIUS_PX + 5) / camera.zoom;

    return (
      snapshot.piece.points.find(
        (point) => Math.hypot(point.xMm - world.xMm, point.yMm - world.yMm) <= maxDistanceMm,
      ) ?? null
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.button === 1 || event.shiftKey) {
      dragRef.current = {
        type: "pan",
        startX: event.clientX,
        startY: event.clientY,
        panX: camera.panX,
        panY: camera.panY,
      };
      return;
    }

    const point = findPoint(event.clientX, event.clientY);
    onSelectPoint(point?.id ?? null);

    if (point) {
      dragRef.current = { type: "point", pointId: point.id };
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === "pan") {
      setCamera((current) => ({
        ...current,
        panX: drag.panX + event.clientX - drag.startX,
        panY: drag.panY + event.clientY - drag.startY,
      }));
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    onMovePoint(drag.pointId, Math.round(world.xMm * 10) / 10, Math.round(world.yMm * 10) / 10);
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const worldX = (cursorX - camera.panX) / camera.zoom;
    const worldY = (cursorY - camera.panY) / camera.zoom;
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.min(3, Math.max(0.15, camera.zoom * factor));

    setCamera({
      zoom: nextZoom,
      panX: cursorX - worldX * nextZoom,
      panY: cursorY - worldY * nextZoom,
    });
  }

  return (
    <canvas
      ref={canvasRef}
      className="pattern-canvas"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onWheel={handleWheel}
    />
  );
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
