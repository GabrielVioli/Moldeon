import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  createSeamAllowanceContour,
  samplePatternContour,
  samplePatternSegment,
} from "../domain/polygonGeometry";
import {
  type PatternPoint,
  type PatternSnapshot,
  distanceMm,
  type EdgeRange,
  getEdgeById,
  getPatternEdges,
  edgeRangeLength,
  type Seam,
  type PatternPiece,
  type GarmentDraft,
  type PieceWorkspaceTransform,
} from "../domain/pattern";
import { findNearbySeamCandidates } from "../domain/patternOperations";
import { buildAssemblyGraph } from "../domain/assembly";
import { findNearestPatternSegment } from "../domain/patternEditing";
import {
  Camera2D,
  ScreenPoint,
  cameraFromGesture,
  cameraToFitBounds,
  zoomCameraAtPoint,
} from "./camera";
import { useEditorStore } from "../state/editorStore";
import {
  pieceLocalToWorld,
  pieceWorldToLocal,
  screenToWorld as cameraScreenToWorld,
  worldToScreen,
} from "./coordinates";
import { pointInScreenRect, resizeStraightSegment, rotationFromPointer, parsePositiveLength } from "./workspaceInteractions";

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
  onToolChange(tool: EditorTool): void;
}

export type EditorTool = "select" | "point" | "seam" | "draft" | "cut" | "dart" | "measure" | "hand";

const POINT_RADIUS_PX = 7;
const INITIAL_CAMERA: Camera2D = { zoom: 0.72, panX: 105, panY: 70 };
let sessionCamera: Camera2D | null = null;
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
  groupStarts?: PieceWorkspaceTransform[];
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
  onToolChange,
}: PatternCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const cameraRef = useRef<Camera2D>(sessionCamera ?? INITIAL_CAMERA);
  const snapshotRef = useRef(snapshot);
  const selectedPointIdRef = useRef(selectedPointId);
  const toolRef = useRef(tool);
  const onEditStartRef = useRef(onEditStart);
  const onEditEndRef = useRef(onEditEnd);
  const onMovePointRef = useRef(onMovePoint);
  const onMoveHandleRef = useRef(onMoveHandle);
  const onInsertPointRef = useRef(onInsertPoint);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const hasFittedCameraRef = useRef(sessionCamera !== null);
  const drawFrameRef = useRef<number | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<PendingGeometryMove | null>(null);
  const workspaceFrameRef = useRef<number | null>(null);
  const pendingWorkspaceRef = useRef<PieceWorkspaceTransform[]>([]);
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
    | { type: "segment"; pointerId: number; edgeId: string; lastWorldX: number; lastWorldY: number }
    | {
        type: "rotate";
        pointerId: number;
        pieceId: string;
        centerWorldX: number;
        centerWorldY: number;
        startPointerAngle: number;
        startRotationDeg: number;
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
    | {
        type: "box";
        pointerId: number;
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        additive: boolean;
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
  const intentPointerRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  const garment = useEditorStore((s) => s.garment);
  const activePieceId = useEditorStore((s) => s.activePieceId);
  const garmentSeams = garment.seams ?? [];
  const selectPiece = useEditorStore((s) => s.selectPiece);
  const movePieceInWorkspace = useEditorStore((s) => s.movePieceInWorkspace);
  const setPieceWorkspaceTransforms = useEditorStore((s) => s.setPieceWorkspaceTransforms);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const draftContour = useEditorStore((s) => s.draftContour);
  const draftCursor = useEditorStore((s) => s.draftCursor);
  const addDraftPoint = useEditorStore((s) => s.addDraftPoint);
  const updateDraftCursor = useEditorStore((s) => s.updateDraftCursor);
  const closeDraft = useEditorStore((s) => s.closeDraft);
  const pieceSelectionActive = useEditorStore((s) => s.pieceSelectionActive);
  const selectedEdgeId = useEditorStore((s) => s.selectedEdgeId);
  const selectedDartId = useEditorStore((s) => s.selectedDartId);
  const seamFirstEdge = useEditorStore((s) => s.seamFirstEdge);
  const selectedPieceIds = useEditorStore((s) => s.selectedPieceIds);
  const cutDraft = useEditorStore((s) => s.cutDraft);
  const dartDraft = useEditorStore((s) => s.dartDraft);
  const measureDraft = useEditorStore((s) => s.measureDraft);
  const garmentRef = useRef(garment);
  garmentRef.current = garment;
  const scheduleDrawRef = useRef<() => void>(() => undefined);
  const spacePressedRef = useRef(false);
  const [spaceHandActive, setSpaceHandActive] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(cameraRef.current.zoom);
  const [zoomEditing, setZoomEditing] = useState(false);
  const [zoomValue, setZoomValue] = useState("");
  const [isPanning, setIsPanning] = useState(false);
  const [rotationFeedback, setRotationFeedback] = useState<number | null>(null);
  const [hoveredDimension, setHoveredDimension] = useState<string | null>(null);
  const [dimensionError, setDimensionError] = useState<string | null>(null);
  const dimensionFinishingRef = useRef(false);
  const dimensionCancelRef = useRef(false);
  const [dimensionEditor, setDimensionEditor] = useState<{
    startPointId: string;
    endPointId: string;
    left: number;
    top: number;
    value: string;
    pieceId: string;
  } | null>(null);

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
      seamFirstEdge ? { first: seamFirstEdge } : null,
      garmentSeams,
      garment,
      activePieceId,
      pieceSelectionActive,
      draftContour,
      draftCursor,
      hoveredDimension,
      rotationFeedback,
      dragRef.current?.type === "box" ? dragRef.current : null,
      selectedEdgeId,
      selectedDartId,
      selectedPieceIds,
      cutDraft,
      dartDraft,
      measureDraft,
    );
  }, [activePieceId, cutDraft, dartDraft, draftContour, draftCursor, garment, garmentSeams, hoveredDimension, measureDraft, pieceSelectionActive, rotationFeedback, seamFirstEdge, selectedDartId, selectedEdgeId, selectedPieceIds]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isEditableTarget(event.target)) {
        event.preventDefault();
        spacePressedRef.current = event.type === "keydown";
        setSpaceHandActive(event.type === "keydown");
      }
      if (event.type !== "keydown" || isEditableTarget(event.target)) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        fitSelection();
      }
      if ((event.key === "[" || event.key === "]") && activePieceId) {
        event.preventDefault();
        useEditorStore.getState().rotatePieceInWorkspace(
          activePieceId,
          (event.key === "[" ? -1 : 1) * (event.shiftKey ? 90 : 15),
        );
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
    };
  }, [activePieceId, garment]);

  const scheduleDraw = useCallback(() => {
    if (drawFrameRef.current !== null) return;
    drawFrameRef.current = window.requestAnimationFrame(drawLatest);
  }, [drawLatest]);
  scheduleDrawRef.current = scheduleDraw;

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
          garmentBounds(garmentRef.current),
          canvasSizeRef.current,
          rect.width <= 760 ? 34 : 54,
        );
        hasFittedCameraRef.current = true;
      }
      scheduleDrawRef.current();
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
      if (workspaceFrameRef.current !== null) {
        window.cancelAnimationFrame(workspaceFrameRef.current);
        workspaceFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    scheduleDraw();
  }, [snapshot, selectedPointId, scheduleDraw]);

  function updateCamera(nextCamera: Camera2D) {
    cameraRef.current = nextCamera;
    sessionCamera = nextCamera;
    setCameraZoom(nextCamera.zoom);
    scheduleDraw();
  }

  function fitAll() {
    updateCamera(cameraToFitBounds(garmentBounds(garment), canvasSizeRef.current, 54));
  }

  function fitSelection() {
    const piece = garment.pieces.find((candidate) => candidate.id === activePieceId);
    if (!piece) return;
    const transform = getPieceWorkspaceTransform(garment, piece.id);
    const points = samplePatternContour(piece.points).map((point) => pieceLocalToWorld(point, transform));
    updateCamera(cameraToFitBounds(contourBounds(points), canvasSizeRef.current, 70));
  }

  function zoomFromCenter(multiplier: number) {
    const size = canvasSizeRef.current;
    updateCamera(zoomCameraAtPoint(cameraRef.current, { x: size.width / 2, y: size.height / 2 }, cameraRef.current.zoom * multiplier));
  }

  function applyZoomPercent() {
    const percent = Number.parseFloat(zoomValue.replace(",", "."));
    if (!Number.isFinite(percent)) {
      setZoomEditing(false);
      return;
    }
    const size = canvasSizeRef.current;
    updateCamera(zoomCameraAtPoint(cameraRef.current, { x: size.width / 2, y: size.height / 2 }, percent / 100));
    setZoomEditing(false);
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

  function queueWorkspaceTransforms(transforms: PieceWorkspaceTransform[]) {
    pendingWorkspaceRef.current = transforms;
    if (workspaceFrameRef.current !== null) return;
    workspaceFrameRef.current = window.requestAnimationFrame(() => {
      workspaceFrameRef.current = null;
      const pending = pendingWorkspaceRef.current;
      pendingWorkspaceRef.current = [];
      setPieceWorkspaceTransforms(pending);
    });
  }

  function flushWorkspaceTransforms() {
    if (workspaceFrameRef.current !== null) {
      window.cancelAnimationFrame(workspaceFrameRef.current);
      workspaceFrameRef.current = null;
    }
    const pending = pendingWorkspaceRef.current;
    pendingWorkspaceRef.current = [];
    setPieceWorkspaceTransforms(pending);
  }

  function screenToWorld(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return { xMm: 0, yMm: 0 };

    const rect = canvas.getBoundingClientRect();
    return cameraScreenToWorld(
      { x: clientX - rect.left, y: clientY - rect.top },
      cameraRef.current,
    );
  }

  function screenToActivePieceLocal(clientX: number, clientY: number) {
    const world = screenToWorld(clientX, clientY);
    return pieceWorldToLocal(world, activeTransform());
  }

  function activeTransform(): PieceWorkspaceTransform {
    return getPieceWorkspaceTransform(garment, activePieceId);
  }

  function findPoint(clientX: number, clientY: number): PatternPoint | null {
    if (getPieceWorkspaceState(garment, activePieceId).locked) return null;
    const world = screenToActivePieceLocal(clientX, clientY);
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

    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      const piece = pieces[index];
      const workspace = getPieceWorkspaceState(garment, piece.id);
      if (!workspace.visible) continue;
      const local = pieceWorldToLocal({ xMm, yMm }, workspace.transform);
      if (isPointInsideLocalPiece(local.xMm, local.yMm, piece.points)) {
        return piece;
      }
    }
    return null;
  }

  function findHandle(
    clientX: number,
    clientY: number,
  ): { pointId: string; handle: "in" | "out" } | null {
    if (getPieceWorkspaceState(garment, activePieceId).locked) return null;
    const selected = snapshotRef.current.piece.points.find(
      (point) => point.id === selectedPointIdRef.current,
    );
    if (!selected) return null;

    const world = screenToActivePieceLocal(clientX, clientY);
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
    if (getPieceWorkspaceState(garment, activePieceId).locked) return false;
    const world = screenToActivePieceLocal(clientX, clientY);
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

  function findEdgeRangeAt(clientX: number, clientY: number): EdgeRange | null {
    const world = screenToWorld(clientX, clientY);
    let nearest: { piece: PatternPiece; target: ReturnType<typeof findNearestPatternSegment> } | null = null;
    for (const piece of garment.pieces) {
      if (!getPieceWorkspaceState(garment, piece.id).visible) continue;
      const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(garment, piece.id));
      const target = findNearestPatternSegment(piece.points, local);
      if (!target || target.distanceMm > 18 / cameraRef.current.zoom) continue;
      if (!nearest || target.distanceMm < nearest.target!.distanceMm) nearest = { piece, target };
    }
    if (!nearest?.target) return null;
    const { piece, target } = nearest;
    const startIndex = piece.points.findIndex((point) => point.id === target.startPointId);
    if (startIndex < 0) return null;
    const end = piece.points[(startIndex + 1) % piece.points.length];
    const persistentEdge = getPatternEdges(piece).find((edge) => edge.startPointId === target.startPointId && edge.endPointId === end.id);
    if (!persistentEdge) return null;
    return {
      pieceId: piece.id,
      edgeId: persistentEdge.id,
      startT: 0,
      endT: 1,
    };
  }

  function activePieceLocalBounds() {
    return contourBounds(samplePatternContour(snapshotRef.current.piece.points));
  }

  function rotationHandleWorld() {
    const bounds = activePieceLocalBounds();
    return pieceLocalToWorld(
      { xMm: bounds.maxX + 24 / cameraRef.current.zoom, yMm: bounds.minY - 24 / cameraRef.current.zoom },
      activeTransform(),
    );
  }

  function piecesMovingWith(pieceId: string): string[] {
    const state = useEditorStore.getState();
    const stitched = buildAssemblyGraph(state.garment).connectedComponents.find((component) => component.includes(pieceId)) ?? [pieceId];
    return [...new Set([...stitched, ...(state.selectedPieceIds.includes(pieceId) ? state.selectedPieceIds : [])])];
  }

  function isRotationHandleAt(clientX: number, clientY: number): boolean {
    if (!pieceSelectionActive || getPieceWorkspaceState(garment, activePieceId).locked) return false;
    const world = screenToWorld(clientX, clientY);
    const handle = rotationHandleWorld();
    return Math.hypot(world.xMm - handle.xMm, world.yMm - handle.yMm) <= 12 / cameraRef.current.zoom;
  }

  function handleIntentClick(clientX: number, clientY: number): boolean {
    const currentTool = toolRef.current;
    if (currentTool !== "cut" && currentTool !== "dart" && currentTool !== "measure") return false;
    const state = useEditorStore.getState();
    const world = screenToWorld(clientX, clientY);
    if (currentTool === "measure") {
      state.setMeasureDraft(state.measureDraft ? { ...state.measureDraft, end: world } : { start: world, end: world });
      return true;
    }
    if (currentTool === "cut" && state.cutDraft?.phase === "ready") return true;
    if (currentTool === "cut" && state.cutDraft?.phase === "placing") {
      const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(garment, state.cutDraft.pieceId));
      state.setCutDraft({ ...state.cutDraft, end: local });
      state.freezeCutDraft();
      return true;
    }
    const piece = findPieceAtWorld(world.xMm, world.yMm);
    if (!piece) return false;
    if (piece.id !== activePieceId) selectPiece(piece.id);
    const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(garment, piece.id));
    if (currentTool === "cut") state.setCutDraft({ pieceId: piece.id, start: local, end: local, phase: "placing" });
    else {
      if (state.dartDraft?.phase === "ready") return true;
      if (state.dartDraft?.phase === "placing") { state.setDartDraft({ ...state.dartDraft, apex: local }); state.freezeDartDraft(); return true; }
      if (!findEdgeRangeAt(clientX, clientY)) return false;
      state.setDartDraft({ pieceId: piece.id, edgePoint: local, apex: local, phase: "placing" });
    }
    return true;
  }

  function dimensionAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || cameraRef.current.zoom < 0.32) return null;
    const rect = canvas.getBoundingClientRect();
    const screen = { x: clientX - rect.left, y: clientY - rect.top };
    const piece = garment.pieces.find((candidate) => candidate.id === activePieceId);
    if (!piece) return null;
    const transform = getPieceWorkspaceTransform(garment, piece.id);
    for (let index = 0; index < piece.points.length; index += 1) {
      const start = piece.points[index];
      const end = piece.points[(index + 1) % piece.points.length];
      const middle = pieceLocalToWorld({ xMm: (start.xMm + end.xMm) / 2, yMm: (start.yMm + end.yMm) / 2 }, transform);
      const label = worldToScreen(middle, cameraRef.current);
      if (pointInScreenRect(screen, { left: label.x - 40, top: label.y - 14, width: 80, height: 28 })) {
        return { piece, start, end, key: `${piece.id}:${start.id}` , label };
      }
    }
    return null;
  }

  function findDartAt(clientX: number, clientY: number): string | null {
    const world = screenToWorld(clientX, clientY); let best: { id: string; distance: number } | null = null;
    for (const piece of garment.pieces) {
      const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(garment, piece.id));
      for (const dart of piece.darts ?? []) {
        const distance = Math.min(distanceToLine(local, dart.legA, dart.apex), distanceToLine(local, dart.legB, dart.apex), Math.hypot(local.xMm - dart.apex.xMm, local.yMm - dart.apex.yMm));
        if (distance <= 12 / cameraRef.current.zoom && (!best || distance < best.distance)) best = { id: dart.id, distance };
      }
    }
    return best?.id ?? null;
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);

    if (
      draftContour &&
      event.button !== 1 &&
      !event.shiftKey &&
      !spacePressedRef.current
    ) {
      const point = snapDraftWorld(screenToWorld(event.clientX, event.clientY), garment, draftContour.points.at(-1));
      const first = draftContour.points[0];
      const closeDistance = 12 / cameraRef.current.zoom;
      if (
        first &&
        draftContour.points.length >= 3 &&
        Math.hypot(first.xMm - point.xMm, first.yMm - point.yMm) <= closeDistance
      ) {
        closeDraft();
      } else {
        addDraftPoint(point.xMm, point.yMm);
      }
      dragRef.current = null;
      return;
    }

    if (event.pointerType === "touch") {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (activePointersRef.current.size >= 2) {
        if (
          dragRef.current?.type === "point" ||
          dragRef.current?.type === "handle" ||
          dragRef.current?.type === "piece" ||
          dragRef.current?.type === "rotate"
        ) {
          flushGeometryMove();
          onEditEndRef.current();
        }
        beginPinch();
        return;
      }

      if (toolRef.current === "hand" || spacePressedRef.current) {
        dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);
        setIsPanning(true);
        return;
      }

      if (toolRef.current === "point") {
        insertPointNear(event.clientX, event.clientY);
        dragRef.current = null;
        return;
      }

      if (handleIntentClick(event.clientX, event.clientY)) {
        const state = useEditorStore.getState();
        if (state.cutDraft?.phase === "placing" || state.dartDraft?.phase === "placing") intentPointerRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
        dragRef.current = null; return;
      }

      if (toolRef.current === "seam") {
        const edge = findEdgeRangeAt(event.clientX, event.clientY);
        if (!edge) {
          const world = screenToWorld(event.clientX, event.clientY);
          const piece = findPieceAtWorld(world.xMm, world.yMm);
          if (piece) selectPiece(piece.id);
          dragRef.current = null;
          return;
        }
        const first = useEditorStore.getState().seamFirstEdge;
        if (!first) {
          useEditorStore.getState().selectFirstSeamEdge(edge);
          scheduleDraw();
          return;
        }
        try { useEditorStore.getState().proposeSeam(first, edge); } catch (e) { console.warn("Falha ao criar costura", e); }
        scheduleDraw();
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

      if (toolRef.current === "select") {
        const edge = findEdgeRangeAt(event.clientX, event.clientY);
        if (edge) {
          selectPiece(edge.pieceId); onSelectPoint(null); useEditorStore.getState().selectEdge(edge.edgeId);
          const world = screenToWorld(event.clientX, event.clientY); onEditStartRef.current("Mover borda");
          dragRef.current = { type: "segment", pointerId: event.pointerId, edgeId: edge.edgeId, lastWorldX: world.xMm, lastWorldY: world.yMm };
          return;
        }
      }

      const world = screenToWorld(event.clientX, event.clientY);
      const piece = findPieceAtWorld(world.xMm, world.yMm);
      if (piece) {
        selectPiece(piece.id);
        onSelectPoint(null);
        const workspace = getPieceWorkspaceState(garment, piece.id);
        if (workspace.locked) {
          dragRef.current = null;
          return;
        }
        onEditStartRef.current("Mover peça");
        dragRef.current = {
          type: "piece",
          pointerId: event.pointerId,
          pieceId: piece.id,
          startWorldX: world.xMm,
          startWorldY: world.yMm,
          startX: workspace.transform.xMm,
          startY: workspace.transform.yMm,
          groupStarts: piecesMovingWith(piece.id).map((id) => ({ ...getPieceWorkspaceTransform(garment, id) })),
        };
        return;
      }

      dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);
      return;
    }

    if (event.button === 1 || spacePressedRef.current || toolRef.current === "hand") {
      dragRef.current = createPanDrag(
        event.pointerId,
        event.clientX,
        event.clientY,
      );
      setIsPanning(true);
      return;
    }

    if (toolRef.current === "select" && isRotationHandleAt(event.clientX, event.clientY)) {
      const transform = activeTransform();
      const bounds = activePieceLocalBounds();
      const center = pieceLocalToWorld({ xMm: (bounds.minX + bounds.maxX) / 2, yMm: (bounds.minY + bounds.maxY) / 2 }, transform);
      const pointer = screenToWorld(event.clientX, event.clientY);
      onEditStartRef.current("Rotacionar peça");
      dragRef.current = {
        type: "rotate",
        pointerId: event.pointerId,
        pieceId: activePieceId,
        centerWorldX: center.xMm,
        centerWorldY: center.yMm,
        startPointerAngle: Math.atan2(pointer.yMm - center.yMm, pointer.xMm - center.xMm),
        startRotationDeg: transform.rotationDeg,
      };
      setRotationFeedback(transform.rotationDeg);
      return;
    }

    if (toolRef.current === "point") {
      insertPointNear(event.clientX, event.clientY);
      dragRef.current = null;
      return;
    }

    if (toolRef.current === "select") {
      const dartId = findDartAt(event.clientX, event.clientY);
      if (dartId) { useEditorStore.getState().selectDart(dartId); dragRef.current = null; return; }
    }

    if (handleIntentClick(event.clientX, event.clientY)) {
      const state = useEditorStore.getState();
      if (state.cutDraft?.phase === "placing" || state.dartDraft?.phase === "placing") intentPointerRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
      dragRef.current = null; return;
    }

    if (toolRef.current === "seam") {
      const edge = findEdgeRangeAt(event.clientX, event.clientY);
      if (!edge) {
        const world = screenToWorld(event.clientX, event.clientY);
        const piece = findPieceAtWorld(world.xMm, world.yMm);
        if (piece) event.shiftKey ? useEditorStore.getState().togglePieceSelection(piece.id) : selectPiece(piece.id);
        dragRef.current = null;
        return;
      }
      const first = useEditorStore.getState().seamFirstEdge;
      if (!first) {
        useEditorStore.getState().selectFirstSeamEdge(edge);
        scheduleDraw();
        return;
      }
      try { useEditorStore.getState().proposeSeam(first, edge); } catch (e) { console.warn("Falha ao criar costura", e); }
      scheduleDraw();
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

    if (toolRef.current === "select") {
      const edge = findEdgeRangeAt(event.clientX, event.clientY);
      if (edge) {
        selectPiece(edge.pieceId); onSelectPoint(null); useEditorStore.getState().selectEdge(edge.edgeId);
        const world = screenToWorld(event.clientX, event.clientY); onEditStartRef.current("Mover borda");
        dragRef.current = { type: "segment", pointerId: event.pointerId, edgeId: edge.edgeId, lastWorldX: world.xMm, lastWorldY: world.yMm };
        return;
      }
    }

    const world = screenToWorld(event.clientX, event.clientY);
    const piece = findPieceAtWorld(world.xMm, world.yMm);
    if (piece) {
      if (event.shiftKey) useEditorStore.getState().togglePieceSelection(piece.id);
      else selectPiece(piece.id);
      onSelectPoint(null);
      const workspace = getPieceWorkspaceState(garment, piece.id);
      if (workspace.locked) {
        dragRef.current = null;
        return;
      }
      onEditStartRef.current("Mover peça");
      dragRef.current = {
        type: "piece",
        pointerId: event.pointerId,
        pieceId: piece.id,
        startWorldX: world.xMm,
        startWorldY: world.yMm,
        startX: workspace.transform.xMm,
        startY: workspace.transform.yMm,
        groupStarts: piecesMovingWith(piece.id).map((id) => ({ ...getPieceWorkspaceTransform(garment, id) })),
      };
      return;
    }
    if (toolRef.current === "select") {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left; const y = event.clientY - rect.top;
      dragRef.current = { type: "box", pointerId: event.pointerId, startX: x, startY: y, currentX: x, currentY: y, additive: event.shiftKey };
      scheduleDraw();
    } else clearSelection();
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (draftContour && !dragRef.current) {
      const point = snapDraftWorld(screenToWorld(event.clientX, event.clientY), garment, draftContour.points.at(-1));
      updateDraftCursor(point.xMm, point.yMm);
      scheduleDraw();
    }
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }

    const drag = dragRef.current;
    if (!drag) {
      const state = useEditorStore.getState();
      const world = screenToWorld(event.clientX, event.clientY);
      if (toolRef.current === "cut" && state.cutDraft?.phase === "placing") state.setCutDraft({ ...state.cutDraft, end: pieceWorldToLocal(world, getPieceWorkspaceTransform(garment, state.cutDraft.pieceId)) });
      if (toolRef.current === "dart" && state.dartDraft?.phase === "placing") state.setDartDraft({ ...state.dartDraft, apex: pieceWorldToLocal(world, getPieceWorkspaceTransform(garment, state.dartDraft.pieceId)) });
      if (toolRef.current === "measure" && state.measureDraft) state.setMeasureDraft({ ...state.measureDraft, end: world });
      const dimension = dimensionAt(event.clientX, event.clientY);
      setHoveredDimension(dimension?.key ?? null);
      return;
    }

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
      const deltaX = world.xMm - drag.startWorldX;
      const deltaY = world.yMm - drag.startWorldY;
      const nextX = drag.startX + deltaX;
      const nextY = drag.startY + deltaY;
      if (drag.groupStarts && drag.groupStarts.length > 1) {
        queueWorkspaceTransforms(drag.groupStarts.map((start) => ({ ...start, xMm: start.xMm + deltaX, yMm: start.yMm + deltaY })));
        return;
      }
      const current = getPieceWorkspaceState(garment, drag.pieceId).transform;
      queueWorkspaceTransforms([{
        pieceId: drag.pieceId,
        xMm: nextX,
        yMm: nextY,
        rotationDeg: current.rotationDeg,
      }]);
      return;
    }

    if (drag.type === "segment") {
      const world = screenToWorld(event.clientX, event.clientY);
      useEditorStore.getState().moveSelectedSegment(world.xMm - drag.lastWorldX, world.yMm - drag.lastWorldY);
      drag.lastWorldX = world.xMm; drag.lastWorldY = world.yMm; return;
    }

    if (drag.type === "box") {
      const rect = event.currentTarget.getBoundingClientRect();
      drag.currentX = event.clientX - rect.left; drag.currentY = event.clientY - rect.top;
      scheduleDraw();
      return;
    }

    if (drag.type === "rotate") {
      const pointer = screenToWorld(event.clientX, event.clientY);
      const angle = Math.atan2(pointer.yMm - drag.centerWorldY, pointer.xMm - drag.centerWorldX);
      const rotationDeg = rotationFromPointer(drag.startRotationDeg, drag.startPointerAngle, angle, event.shiftKey);
      const current = getPieceWorkspaceState(garment, drag.pieceId).transform;
      queueWorkspaceTransforms([{ ...current, rotationDeg }]);
      setRotationFeedback(rotationDeg);
      return;
    }

    const world = screenToActivePieceLocal(event.clientX, event.clientY);
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
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    updateCamera(zoomCameraAtPoint(cameraRef.current, { x: cursorX, y: cursorY }, cameraRef.current.zoom * factor));
  }

  function handleDoubleClick(event: MouseEvent<HTMLCanvasElement>) {
    useEditorStore.getState().cancelIntent();
    const dimension = dimensionAt(event.clientX, event.clientY);
    if (!dimension) return;
    selectPiece(dimension.piece.id);
    if (dimension.start.handleOut || dimension.end.handleIn) {
      setDimensionError("A edição numérica exata de curvas ainda não está disponível.");
      return;
    }
    setDimensionError(null);
    dimensionFinishingRef.current = false;
    dimensionCancelRef.current = false;
    setDimensionEditor({
      pieceId: dimension.piece.id,
      startPointId: dimension.start.id,
      endPointId: dimension.end.id,
      left: event.clientX,
      top: event.clientY,
      value: distanceMm(dimension.start, dimension.end).toFixed(1),
    });
  }

  function confirmDimensionEdit() {
    if (!dimensionEditor) return;
    if (dimensionCancelRef.current || dimensionFinishingRef.current) return;
    if (dimensionEditor.value.trim() === "") {
      setDimensionEditor(null);
      return;
    }
    const desiredLength = parsePositiveLength(dimensionEditor.value);
    if (desiredLength === null) {
      setDimensionError("Informe uma medida maior que zero.");
      return;
    }
    const piece = useEditorStore.getState().garment.pieces.find((candidate) => candidate.id === dimensionEditor.pieceId);
    const points = piece?.points ?? [];
    const start = points.find((point) => point.id === dimensionEditor.startPointId);
    const end = points.find((point) => point.id === dimensionEditor.endPointId);
    if (!start || !end) return;
    const next = resizeStraightSegment(start, end, desiredLength);
    if (!next) return;
    dimensionFinishingRef.current = true;
    useEditorStore.getState().selectPiece(dimensionEditor.pieceId);
    useEditorStore.getState().beginEdit("Editar comprimento", "geometry");
    useEditorStore.getState().movePoint(end.id, next.xMm, next.yMm);
    useEditorStore.getState().commitEdit();
    setDimensionError(null);
    setDimensionEditor(null);
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
    const intentPointer = intentPointerRef.current;
    if (intentPointer?.pointerId === event.pointerId) {
      const moved = Math.hypot(event.clientX - intentPointer.startX, event.clientY - intentPointer.startY);
      if (moved >= 4) {
        const state = useEditorStore.getState();
        if (state.cutDraft?.phase === "placing") state.freezeCutDraft();
        if (state.dartDraft?.phase === "placing") state.freezeDartDraft();
      }
      intentPointerRef.current = null;
    }
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
    if (
      finishedDrag?.type === "piece" &&
      finishedDrag.pointerId === event.pointerId
    ) {
      flushWorkspaceTransforms();
      onEditEndRef.current();
      const state = useEditorStore.getState();
      const piece = state.garment.pieces.find((candidate) => candidate.id === finishedDrag.pieceId);
      const transforms = (state.garment.workspaceStates ?? []).map((item) => item.transform);
      let suggestion: { first: EdgeRange; second: EdgeRange } | null = null;
      for (const edge of piece ? getPatternEdges(piece) : []) {
        const first = { pieceId: finishedDrag.pieceId, edgeId: edge.id, startT: 0, endT: 1 };
        const second = findNearbySeamCandidates(state.garment, first, transforms, 32)[0];
        if (second) { suggestion = { first, second }; break; }
      }
      state.setNearbySeamSuggestion(suggestion);
    }
    if (finishedDrag?.type === "segment" && finishedDrag.pointerId === event.pointerId) onEditEndRef.current();
    if (
      finishedDrag?.type === "rotate" &&
      finishedDrag.pointerId === event.pointerId
    ) {
      flushWorkspaceTransforms();
      onEditEndRef.current();
      setRotationFeedback(null);
    }
    if (finishedDrag?.type === "box" && finishedDrag.pointerId === event.pointerId) {
      const moved = Math.hypot(finishedDrag.currentX - finishedDrag.startX, finishedDrag.currentY - finishedDrag.startY);
      if (moved < 4) {
        clearSelection();
        useEditorStore.getState().selectDart(null);
        useEditorStore.getState().setNearbySeamSuggestion(null);
      } else {
      const left = Math.min(finishedDrag.startX, finishedDrag.currentX); const right = Math.max(finishedDrag.startX, finishedDrag.currentX);
      const top = Math.min(finishedDrag.startY, finishedDrag.currentY); const bottom = Math.max(finishedDrag.startY, finishedDrag.currentY);
      const hits = garment.pieces.filter((piece) => getPieceWorkspaceState(garment, piece.id).visible).filter((piece) => {
        const transform = getPieceWorkspaceTransform(garment, piece.id);
        const points = samplePatternContour(piece.points).map((point) => worldToScreen(pieceLocalToWorld(point, transform), cameraRef.current));
        const bounds = { left: Math.min(...points.map((point) => point.x)), right: Math.max(...points.map((point) => point.x)), top: Math.min(...points.map((point) => point.y)), bottom: Math.max(...points.map((point) => point.y)) };
        return bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom;
      }).map((piece) => piece.id);
      const previous = useEditorStore.getState().selectedPieceIds;
      useEditorStore.getState().setPieceSelection(finishedDrag.additive ? [...previous, ...hits] : hits);
      }
    }
    if (finishedDrag?.type === "pan") setIsPanning(false);

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

  const readyIntent = cutDraft?.phase === "ready"
    ? { kind: "cut" as const, point: cutDraft.end }
    : dartDraft?.phase === "ready"
      ? { kind: "dart" as const, point: dartDraft.apex }
      : null;
  const intentPosition = (() => {
    if (!readyIntent) return null;
    const local = worldToScreen(readyIntent.point, cameraRef.current);
    return { left: local.x, top: local.y - 42 };
  })();

  return (
    <>
      <div className="canvas-navigation" role="toolbar" aria-label="Navegação da prancheta">
        <button type="button" aria-label="Diminuir zoom" onClick={() => zoomFromCenter(0.9)}>−</button>
        {zoomEditing ? <input aria-label="Zoom em porcentagem" autoFocus value={zoomValue} onChange={(event) => setZoomValue(event.currentTarget.value)} onBlur={applyZoomPercent} onKeyDown={(event) => { if (event.key === "Enter") applyZoomPercent(); if (event.key === "Escape") setZoomEditing(false); }} /> : <button type="button" className="zoom-indicator" onClick={() => { setZoomValue(String(Math.round(cameraZoom * 100))); setZoomEditing(true); }}>{Math.round(cameraZoom * 100)}%</button>}
        <button type="button" aria-label="Aumentar zoom" onClick={() => zoomFromCenter(1.1)}>+</button>
        <button type="button" onClick={fitAll}>Enquadrar tudo</button>
        <button type="button" onClick={fitSelection}>Enquadrar seleção</button>
        <button type="button" aria-pressed={tool === "hand"} className={tool === "hand" ? "active" : ""} onClick={() => onToolChange(tool === "hand" ? "select" : "hand")}>Mão</button>
      </div>
      <canvas
        ref={canvasRef}
        className={`pattern-canvas pattern-canvas-${tool}${spaceHandActive ? " is-space-hand" : ""}${isPanning ? " is-panning" : ""}${hoveredDimension ? " is-dimension-hovered" : ""}`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        aria-label="Editor de molde 2D"
      />
      {readyIntent && intentPosition ? (
        <div className="canvas-intent-actions" style={intentPosition} role="toolbar" aria-label={readyIntent.kind === "cut" ? "Confirmar recorte" : "Confirmar pence"}>
          <button className="primary-button" type="button" onClick={() => {
            const state = useEditorStore.getState();
            if (readyIntent.kind === "cut") state.confirmCut(false);
            else state.confirmDart();
            onToolChange("select");
          }}>{readyIntent.kind === "cut" ? "Recortar" : "Criar pence"}</button>
          <button type="button" onClick={() => { useEditorStore.getState().cancelIntent(); onToolChange("select"); }}>Cancelar</button>
        </div>
      ) : null}
      {dimensionEditor ? (
        <div className="dimension-editor" style={{ left: dimensionEditor.left, top: dimensionEditor.top }}>
          <span className="dimension-anchor-note">Início fixo</span>
          <div><input aria-label="Comprimento do segmento em milímetros" autoFocus inputMode="decimal" value={dimensionEditor.value} onFocus={(event) => event.currentTarget.select()} onBlur={confirmDimensionEdit} onChange={(event) => { const value = event.currentTarget.value; setDimensionError(null); setDimensionEditor((current) => current ? { ...current, value } : null); }} onKeyDown={(event) => { if (event.key === "Enter") confirmDimensionEdit(); if (event.key === "Escape") { dimensionCancelRef.current = true; setDimensionEditor(null); } }} /><span>mm</span></div>
        </div>
      ) : null}
      {dimensionError ? <div className="dimension-error" role="alert">{dimensionError}</div> : null}
      {hoveredDimension && !dimensionEditor ? <div className="dimension-tooltip">Duplo clique para editar</div> : null}
      {rotationFeedback !== null ? <div className="rotation-feedback">{rotationFeedback.toFixed(1)}°</div> : null}
    </>
  );
}

export const PatternCanvas = memo(PatternCanvasComponent);

function getPieceWorkspaceState(garment: GarmentDraft, pieceId: string) {
  return (
    garment.workspaceStates?.find((state) => state.pieceId === pieceId) ?? {
      pieceId,
      transform:
        garment.workspaceTransforms?.find((transform) => transform.pieceId === pieceId) ??
        { pieceId, xMm: 0, yMm: 0, rotationDeg: 0 },
      visible: true,
      locked: false,
    }
  );
}

function getPieceWorkspaceTransform(garment: GarmentDraft, pieceId: string) {
  return getPieceWorkspaceState(garment, pieceId).transform;
}

function transformPatternPoint(
  point: PatternPoint,
  transform: PieceWorkspaceTransform,
): PatternPoint {
  const world = pieceLocalToWorld(point, transform);
  const transformHandle = (handle: PatternPoint["handleIn"]) => {
    if (!handle) return undefined;
    const endpoint = pieceLocalToWorld(
      { xMm: point.xMm + handle.xMm, yMm: point.yMm + handle.yMm },
      transform,
    );
    return { xMm: endpoint.xMm - world.xMm, yMm: endpoint.yMm - world.yMm };
  };
  return {
    ...point,
    ...world,
    handleIn: transformHandle(point.handleIn),
    handleOut: transformHandle(point.handleOut),
  };
}

function isPointInsideLocalPiece(
  xMm: number,
  yMm: number,
  points: readonly PatternPoint[],
): boolean {
  if (points.length < 3) return false;
  const transformed = samplePatternContour(points);
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
    const workspace = getPieceWorkspaceState(garment, piece.id);
    if (!workspace.visible) continue;
    const contour = samplePatternContour(piece.points);
    const transform = workspace.transform;
    const allowance = Math.max(0, piece.seamAllowanceMm);
    for (const point of contour) {
      const transformed = pieceLocalToWorld(point, transform);
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
  pieceSelectionActive: boolean,
  draftContour: import("../domain/pattern").DraftContour | null,
  draftCursor: PatternPoint | null,
  hoveredDimension: string | null,
  rotationFeedback: number | null,
  selectionBox: { startX: number; startY: number; currentX: number; currentY: number } | null,
  selectedEdgeId: string | null,
  selectedDartId: string | null,
  selectedPieceIds: string[],
  cutDraft: { pieceId: string; start: import("../domain/pattern").PatternVector; end: import("../domain/pattern").PatternVector } | null,
  dartDraft: { pieceId: string; edgePoint: import("../domain/pattern").PatternVector; apex: import("../domain/pattern").PatternVector } | null,
  measureDraft: { start: import("../domain/pattern").PatternVector; end: import("../domain/pattern").PatternVector } | null,
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

  const activeTransform = getPieceWorkspaceTransform(garment, activePieceId);

  // draw persistent guides (from the active piece metadata)
  if (activePiece.guides) {
    for (const guide of activePiece.guides) {
      const first = pieceLocalToWorld(
        guide.orientation === "vertical"
          ? { xMm: guide.positionMm, yMm: -10000 }
          : { xMm: -10000, yMm: guide.positionMm },
        activeTransform,
      );
      const second = pieceLocalToWorld(
        guide.orientation === "vertical"
          ? { xMm: guide.positionMm, yMm: 10000 }
          : { xMm: 10000, yMm: guide.positionMm },
        activeTransform,
      );
      context.beginPath();
      context.moveTo(first.xMm, first.yMm);
      context.lineTo(second.xMm, second.yMm);
      context.strokeStyle = "rgba(100,120,140,0.45)";
      context.lineWidth = 1 / camera.zoom;
      context.setLineDash([4 / camera.zoom, 6 / camera.zoom]);
      context.stroke();
      context.setLineDash([]);
    }
  }

  for (const piece of garment.pieces) {
    const workspace = getPieceWorkspaceState(garment, piece.id);
    if (!workspace.visible) continue;
    const transform = workspace.transform;
    const transformedPoints = piece.points.map((point) => transformPatternPoint(point, transform));
    const transformedContour = samplePatternContour(piece.points).map((point) => transformPatternPoint(point, transform));
    const isActivePiece = piece.id === activePieceId;
    const isSelectedPiece = selectedPieceIds.includes(piece.id);

    context.save();
    context.globalAlpha = isActivePiece ? 1 : workspace.locked ? 0.35 : 0.55;
    traceContour(context, transformedContour);
    context.fillStyle = isActivePiece ? "rgba(32, 33, 36, 0.08)" : "rgba(32, 33, 36, 0.04)";
    context.fill();
    context.strokeStyle = isActivePiece ? "#202124" : "#4f5458";
    context.lineWidth = isActivePiece ? 2 / camera.zoom : 1.4 / camera.zoom;
    context.stroke();

    if (isSelectedPiece) {
      context.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      context.strokeStyle = "#9a6b16";
      context.lineWidth = 3 / camera.zoom;
      traceContour(context, transformedContour);
      context.stroke();
      context.setLineDash([]);
    }
    if (isActivePiece && selectedEdgeId) drawSeamInterval(context, piece, { pieceId: piece.id, edgeId: selectedEdgeId, startT: 0, endT: 1 }, transform, camera.zoom, "#d06b22");

    for (const line of piece.internalLines ?? []) {
      const points = line.points.map((point) => pieceLocalToWorld(point, transform));
      context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.xMm, point.yMm) : context.moveTo(point.xMm, point.yMm));
      context.setLineDash(line.purpose === "fold" ? [8 / camera.zoom, 5 / camera.zoom] : [3 / camera.zoom, 3 / camera.zoom]);
      context.strokeStyle = "#59636c"; context.lineWidth = 1.5 / camera.zoom; context.stroke(); context.setLineDash([]);
    }
    for (const dart of piece.darts ?? []) {
      const legA = pieceLocalToWorld(dart.legA, transform); const apex = pieceLocalToWorld(dart.apex, transform); const legB = pieceLocalToWorld(dart.legB, transform);
      context.beginPath(); context.moveTo(legA.xMm, legA.yMm); context.lineTo(apex.xMm, apex.yMm); context.lineTo(legB.xMm, legB.yMm);
      context.strokeStyle = dart.id === selectedDartId ? "#d12f78" : dart.closed ? "#8b3f67" : "#b06084"; context.lineWidth = (dart.id === selectedDartId ? 4 : 2) / camera.zoom; context.stroke();
      if (dart.id === selectedDartId) for (const point of [legA, apex, legB]) { context.beginPath(); context.arc(point.xMm, point.yMm, 6 / camera.zoom, 0, Math.PI * 2); context.fillStyle = "#fff"; context.fill(); context.strokeStyle = "#d12f78"; context.stroke(); }
    }

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

    for (const seam of seams) {
      drawSeamInterval(context, piece, seam.first, transform, camera.zoom, "#a23d3d");
      drawSeamInterval(context, piece, seam.second, transform, camera.zoom, "#3d6aa2");
    }

    if (seamSelection?.first) {
      drawSeamInterval(context, piece, seamSelection.first, transform, camera.zoom, "rgba(160,160,60,0.9)");
    }
    if (seamSelection?.second) {
      drawSeamInterval(context, piece, seamSelection.second, transform, camera.zoom, "rgba(60,160,60,0.9)");
    }

    if (isActivePiece) {

      if (camera.zoom >= 0.32) for (let index = 0; index < transformedPoints.length; index += 1) {
        const point = transformedPoints[index];
        const next = transformedPoints[(index + 1) % transformedPoints.length];
        const middleX = (point.xMm + next.xMm) / 2;
        const middleY = (point.yMm + next.yMm) / 2;
        const localPoint = piece.points[index];
        const localNext = piece.points[(index + 1) % piece.points.length];
        const sampledSegment = samplePatternSegment(localPoint, localNext);
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
        const dimensionKey = `${piece.id}:${localPoint.id}`;
        context.fillStyle = dimensionKey === hoveredDimension ? "rgba(232, 212, 147, 0.98)" : "rgba(244, 242, 237, 0.92)";
        context.fillRect(-40, -14, 80, 28);
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

    if (isActivePiece && pieceSelectionActive) {
      const localBounds = contourBounds(samplePatternContour(piece.points));
      const corners = [
        { xMm: localBounds.minX, yMm: localBounds.minY },
        { xMm: localBounds.maxX, yMm: localBounds.minY },
        { xMm: localBounds.maxX, yMm: localBounds.maxY },
        { xMm: localBounds.minX, yMm: localBounds.maxY },
      ].map((point) => pieceLocalToWorld(point, transform));
      context.strokeStyle = "rgba(17, 18, 20, 0.9)";
      context.lineWidth = 1 / camera.zoom;
      context.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
      context.beginPath();
      corners.forEach((corner, index) => index === 0 ? context.moveTo(corner.xMm, corner.yMm) : context.lineTo(corner.xMm, corner.yMm));
      context.closePath();
      context.stroke();
      context.setLineDash([]);
      const topCenter = pieceLocalToWorld({ xMm: localBounds.maxX, yMm: localBounds.minY }, transform);
      const handle = pieceLocalToWorld({ xMm: localBounds.maxX + 24 / camera.zoom, yMm: localBounds.minY - 24 / camera.zoom }, transform);
      context.beginPath();
      context.moveTo(topCenter.xMm, topCenter.yMm);
      context.lineTo(handle.xMm, handle.yMm);
      context.strokeStyle = "#202124";
      context.stroke();
      context.beginPath();
      context.arc(handle.xMm, handle.yMm, 8 / camera.zoom, 0, Math.PI * 2);
      context.fillStyle = rotationFeedback === null ? "#fff" : "#d9b866";
      context.fill();
      context.stroke();
    }

    context.restore();
  }

  if (draftContour) {
    context.save();
    context.strokeStyle = "#975a16";
    context.fillStyle = "#fff8ea";
    context.lineWidth = 2 / camera.zoom;
    context.beginPath();
    draftContour.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.xMm, point.yMm);
      else context.lineTo(point.xMm, point.yMm);
    });
    if (draftCursor && draftContour.points.length > 0) {
      context.lineTo(draftCursor.xMm, draftCursor.yMm);
    }
    context.stroke();
    if (draftCursor && draftContour.points.length > 0) {
      const anchor = draftContour.points.at(-1)!;
      const angle = Math.atan2(draftCursor.yMm - anchor.yMm, draftCursor.xMm - anchor.xMm) * 180 / Math.PI;
      const normalized = Math.round(angle / 45) * 45;
      if (Math.abs(angle - normalized) < 0.01) {
        context.save();
        context.translate((anchor.xMm + draftCursor.xMm) / 2, (anchor.yMm + draftCursor.yMm) / 2);
        context.scale(1 / camera.zoom, 1 / camera.zoom);
        context.fillStyle = "#6e4b12";
        context.font = "bold 11px system-ui, sans-serif";
        context.fillText(`${((normalized % 360) + 360) % 360}°`, 8, -8);
        context.restore();
      }
    }
    for (const point of draftContour.points) {
      context.beginPath();
      context.arc(point.xMm, point.yMm, 6 / camera.zoom, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  const cutTransform = cutDraft ? getPieceWorkspaceTransform(garment, cutDraft.pieceId) : null;
  const dartTransform = dartDraft ? getPieceWorkspaceTransform(garment, dartDraft.pieceId) : null;
  drawIntentLine(context, cutDraft && cutTransform ? pieceLocalToWorld(cutDraft.start, cutTransform) : undefined, cutDraft && cutTransform ? pieceLocalToWorld(cutDraft.end, cutTransform) : undefined, camera.zoom, "#c7532c");
  drawIntentLine(context, dartDraft && dartTransform ? pieceLocalToWorld(dartDraft.edgePoint, dartTransform) : undefined, dartDraft && dartTransform ? pieceLocalToWorld(dartDraft.apex, dartTransform) : undefined, camera.zoom, "#8b3f67");
  drawIntentLine(context, measureDraft?.start, measureDraft?.end, camera.zoom, "#22768a");

  // draw snapping feedback if present
  if (snapOverlay) {
    const snapWorld = pieceLocalToWorld(snapOverlay, activeTransform);
    context.beginPath();
    context.arc(snapWorld.xMm, snapWorld.yMm, 6 / camera.zoom, 0, Math.PI * 2);
    context.fillStyle = "rgba(200,50,150,0.9)";
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 1 / camera.zoom;
    context.stroke();

    if (snapOverlay.type === "hv") {
      context.beginPath();
      context.strokeStyle = "rgba(200,50,150,0.25)";
      context.lineWidth = 1 / camera.zoom;
      context.moveTo(-10000, snapWorld.yMm);
      context.lineTo(10000, snapWorld.yMm);
      context.moveTo(snapWorld.xMm, -10000);
      context.lineTo(snapWorld.xMm, 10000);
      context.stroke();
    }
  }

  context.restore();

  if (selectionBox) {
    const left = Math.min(selectionBox.startX, selectionBox.currentX); const top = Math.min(selectionBox.startY, selectionBox.currentY);
    const boxWidth = Math.abs(selectionBox.currentX - selectionBox.startX); const boxHeight = Math.abs(selectionBox.currentY - selectionBox.startY);
    context.save(); context.fillStyle = "rgba(154, 107, 22, .10)"; context.strokeStyle = "#9a6b16"; context.setLineDash([5, 4]);
    context.fillRect(left, top, boxWidth, boxHeight); context.strokeRect(left, top, boxWidth, boxHeight); context.restore();
  }

  // show seam info overlay in screen space if selection complete
  if (seamSelection?.first && seamSelection?.second) {
    const firstPiece = garment.pieces.find((piece) => piece.id === seamSelection.first?.pieceId);
    const secondPiece = garment.pieces.find((piece) => piece.id === seamSelection.second?.pieceId);
    const firstLength = firstPiece ? edgeRangeLength(firstPiece, seamSelection.first) : 0;
    const secondLength = secondPiece ? edgeRangeLength(secondPiece, seamSelection.second) : 0;
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
  piece: PatternPiece,
  range: EdgeRange,
  transform: PieceWorkspaceTransform,
  zoom: number,
  color: string,
) {
  if (range.pieceId !== piece.id) return;
  const edge = getEdgeById(piece, range.edgeId);
  if (!edge) return;
  const startIndex = piece.points.findIndex((point) => point.id === edge.startPointId);
  if (startIndex < 0) return;
  const p0 = piece.points[startIndex];
  const p1 = piece.points[(startIndex + 1) % piece.points.length];
  const samples = samplePatternSegment(p0, p1);
  if (samples.length < 2) return;
  const totalSteps = samples.length - 1;
  const startIndexF = Math.floor(range.startT * totalSteps);
  const endIndexF = Math.ceil(range.endT * totalSteps);
  const first = pieceLocalToWorld(samples[startIndexF], transform);
  context.beginPath();
  context.moveTo(first.xMm, first.yMm);
  for (let i = startIndexF + 1; i <= endIndexF; i += 1) {
    const point = pieceLocalToWorld(samples[i], transform);
    context.lineTo(point.xMm, point.yMm);
  }
  context.strokeStyle = color;
  context.lineWidth = 3 / zoom;
  context.stroke();
}

function snapDraftWorld(
  point: { xMm: number; yMm: number },
  garment: GarmentDraft,
  anchor?: { xMm: number; yMm: number },
): { xMm: number; yMm: number } {
  const thresholdMm = 8;
  for (const piece of garment.pieces) {
    const workspace = getPieceWorkspaceState(garment, piece.id);
    if (!workspace.visible) continue;
    for (const local of piece.points) {
      const world = pieceLocalToWorld(local, workspace.transform);
      if (Math.hypot(world.xMm - point.xMm, world.yMm - point.yMm) <= thresholdMm) {
        return world;
      }
    }
  }
  if (anchor) {
    const dx = point.xMm - anchor.xMm;
    const dy = point.yMm - anchor.yMm;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      const angle = Math.atan2(dy, dx);
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      if (Math.abs(Math.atan2(Math.sin(angle - snappedAngle), Math.cos(angle - snappedAngle))) <= 5 * Math.PI / 180) {
        return { xMm: anchor.xMm + Math.cos(snappedAngle) * distance, yMm: anchor.yMm + Math.sin(snappedAngle) * distance };
      }
    }
  }
  return {
    xMm: Math.round(point.xMm / 10) * 10,
    yMm: Math.round(point.yMm / 10) * 10,
  };
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

function drawIntentLine(context: CanvasRenderingContext2D, start: { xMm: number; yMm: number } | undefined, end: { xMm: number; yMm: number } | undefined, zoom: number, color: string) {
  if (!start || !end) return;
  context.save(); context.beginPath(); context.moveTo(start.xMm, start.yMm); context.lineTo(end.xMm, end.yMm);
  context.strokeStyle = color; context.lineWidth = 2 / zoom; context.setLineDash([8 / zoom, 5 / zoom]); context.stroke(); context.setLineDash([]);
  for (const point of [start, end]) { context.beginPath(); context.arc(point.xMm, point.yMm, 5 / zoom, 0, Math.PI * 2); context.fillStyle = color; context.fill(); }
  context.restore();
}

function distanceToLine(point: { xMm: number; yMm: number }, start: { xMm: number; yMm: number }, end: { xMm: number; yMm: number }): number {
  const dx = end.xMm - start.xMm; const dy = end.yMm - start.yMm; const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) / length2));
  return Math.hypot(point.xMm - (start.xMm + t * dx), point.yMm - (start.yMm + t * dy));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
}
