import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
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
  isInternalPath,
  type InternalPath,
  type InternalPathNode,
} from "../domain/pattern";
import { findNearbySeamCandidates } from "../domain/patternOperations";
import { findNearestPatternSegment } from "../domain/patternEditing";
import {
  claimGesture,
  createGestureOrigin,
  finishGesture,
  isInteractiveGestureOwner,
  shouldInsertPointFromTap,
  shouldStartBoxSelection,
  shouldStartDrag,
  type GestureOrigin,
  type GestureOwnership,
} from "./canvasGestures";
import { findNearestEdgeHit, findNearestSeamHit } from "./canvasHitTesting";
import {
  Camera2D,
  ScreenPoint,
  cameraFromGesture,
  cameraToFitBounds,
  zoomCameraAtPoint,
} from "./camera";
import { applyWheelNavigation, mergeWheelNavigation, normalizeWheelNavigation, type NormalizedWheelNavigation } from "./canvasWheelNavigation";
import { findNearestInternalPathSegment, sampleInternalPath } from "../domain/internalPaths";
import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";
import {
  pieceLocalToWorld,
  pieceWorldToLocal,
  screenToWorld as cameraScreenToWorld,
  worldToScreen,
} from "./coordinates";
import { clearEditorSelection } from "./editorCoreSelection";
import {
  curveHandleGrabOffset,
  curveHandleHitRadiusPx,
  findNearestInternalCurveHandle,
  findNearestPatternCurveHandle,
  internalCurveHandleTargets,
  patternCurveHandleTargets,
} from "./curveHandleInteraction";
import { findEditablePatternPoint, pointInScreenRect, resizeStraightSegment, rotationFromPointer, parsePositiveLength } from "./workspaceInteractions";

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
  const drawLatestRef = useRef<() => void>(() => undefined);
  const handleWheelRef = useRef<(event: globalThis.WheelEvent) => void>(() => undefined);
  const moveFrameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<PendingGeometryMove | null>(null);
  const workspaceFrameRef = useRef<number | null>(null);
  const pendingWorkspaceRef = useRef<PieceWorkspaceTransform[]>([]);
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const pointTapRef = useRef<GestureOrigin | null>(null);
  const gestureOwnershipRef = useRef<GestureOwnership | null>(null);
  const dragOriginRef = useRef<GestureOrigin | null>(null);
  const dragStartedRef = useRef(false);
  const wheelFrameRef = useRef<number | null>(null);
  const pendingWheelRef = useRef<{ navigation: NormalizedWheelNavigation; cursor: ScreenPoint } | null>(null);
  const touchPieceCandidateRef = useRef<(GestureOrigin & {
    pieceId: string;
    startWorldX: number;
    startWorldY: number;
    startX: number;
    startY: number;
    groupStarts: PieceWorkspaceTransform[];
  }) | null>(null);
  const dragRef = useRef<
    | { type: "point"; pointerId: number; pieceId: string; pointId: string }
    | {
        type: "handle";
        pointerId: number;
        pointId: string;
        handle: "in" | "out";
        grabOffsetXMm: number;
        grabOffsetYMm: number;
      }
    | PieceDragState
    | { type: "internal-node"; pointerId: number; nodeId: string }
    | {
        type: "internal-handle";
        pointerId: number;
        nodeId: string;
        handle: "in" | "out";
        grabOffsetXMm: number;
        grabOffsetYMm: number;
      }
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
  const draftContour = useEditorStore((s) => s.draftContour);
  const draftCursor = useEditorStore((s) => s.draftCursor);
  const addDraftPoint = useEditorStore((s) => s.addDraftPoint);
  const updateDraftCursor = useEditorStore((s) => s.updateDraftCursor);
  const closeDraft = useEditorStore((s) => s.closeDraft);
  const pieceSelectionActive = useEditorStore((s) => s.pieceSelectionActive);
  const selectedEdgeId = useEditorStore((s) => s.selectedEdgeId);
  const selectedSeamId = useEditorStore((s) => s.selectedSeamId);
  const selectedDartId = useEditorStore((s) => s.selectedDartId);
  const seamFirstEdge = useEditorStore((s) => s.seamFirstEdge);
  const selectedPieceIds = useEditorStore((s) => s.selectedPieceIds);
  const cutDraft = useEditorStore((s) => s.cutDraft);
  const dartDraft = useEditorStore((s) => s.dartDraft);
  const measureDraft = useEditorStore((s) => s.measureDraft);
  const selectedInternalPathId = useInternalPathEditorStore((s) => s.selectedPathId);
  const selectedInternalPathNodeId = useInternalPathEditorStore((s) => s.selectedNodeId);
  const selectedInternalPathSegmentId = useInternalPathEditorStore((s) => s.selectedSegmentId);
  const draftInternalPathId = useInternalPathEditorStore((s) => s.draftPathId);
  const internalPathAnalysis = useInternalPathEditorStore((s) => s.analysis);
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
    const context = contextRef.current;
    if (!context) return;

    const editor = useEditorStore.getState();
    const currentGarment = editor.garment;
    const { width, height } = canvasSizeRef.current;
    draw(
      context,
      width,
      height,
      snapshotRef.current,
      editor.selectedPointId,
      cameraRef.current,
      snapRef.current,
      editor.seamFirstEdge ? { first: editor.seamFirstEdge } : null,
      currentGarment.seams ?? [],
      currentGarment,
      editor.activePieceId,
      editor.pieceSelectionActive,
      editor.draftContour,
      editor.draftCursor,
      hoveredDimension,
      rotationFeedback,
      dragRef.current?.type === "box" ? dragRef.current : null,
      editor.selectedEdgeId,
      editor.selectedSeamId,
      editor.selectedDartId,
      editor.selectedPieceIds,
      editor.cutDraft,
      editor.dartDraft,
      editor.measureDraft,
    );
  }, [hoveredDimension, rotationFeedback, internalPathAnalysis, selectedInternalPathId, selectedInternalPathNodeId, selectedInternalPathSegmentId, draftInternalPathId]);
  drawLatestRef.current = drawLatest;

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
    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawFrameRef.current = null;
      drawLatestRef.current();
    });
  }, []);
  scheduleDrawRef.current = scheduleDraw;
  handleWheelRef.current = handleWheel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    contextRef.current = context;
    const nativeWheel = (event: globalThis.WheelEvent) => handleWheelRef.current(event);
    canvas.addEventListener("wheel", nativeWheel, { passive: false });

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
      canvas.removeEventListener("wheel", nativeWheel);
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
      if (wheelFrameRef.current !== null) {
        window.cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    scheduleDraw();
  }, [garment, snapshot, selectedPointId, selectedEdgeId, selectedSeamId, selectedDartId, selectedPieceIds, pieceSelectionActive, seamFirstEdge, cutDraft, dartDraft, measureDraft, draftContour, draftCursor, scheduleDraw]);

  function ownGesture(pointerId: number, owner: GestureOwnership["owner"]) {
    gestureOwnershipRef.current = claimGesture(gestureOwnershipRef.current, pointerId, owner);
  }

  function updateCamera(nextCamera: Camera2D) {
    cameraRef.current = nextCamera;
    sessionCamera = nextCamera;
    setCameraZoom(nextCamera.zoom);
    scheduleDraw();
  }

  function fitAll() {
    const currentGarment = useEditorStore.getState().garment;
    updateCamera(cameraToFitBounds(garmentBounds(currentGarment), canvasSizeRef.current, 54));
  }

  function fitSelection() {
    const editor = useEditorStore.getState();
    const piece = editor.garment.pieces.find((candidate) => candidate.id === editor.activePieceId);
    if (!piece) return;
    const transform = getPieceWorkspaceTransform(editor.garment, piece.id);
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
    const editor = useEditorStore.getState();
    return getPieceWorkspaceTransform(editor.garment, editor.activePieceId);
  }

  function currentActivePiece(): PatternPiece | null {
    const editor = useEditorStore.getState();
    return editor.garment.pieces.find((piece) => piece.id === editor.activePieceId) ?? null;
  }

  function findPoint(clientX: number, clientY: number) {
    const world = screenToWorld(clientX, clientY);
    const maxDistanceMm = (POINT_RADIUS_PX + 5) / cameraRef.current.zoom;
    return findEditablePatternPoint(garmentRef.current, world, maxDistanceMm);
  }

  function findPieceAtWorld(xMm: number, yMm: number): PatternPiece | null {
    const currentGarment = garmentRef.current;
    const pieces = currentGarment.pieces;

    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      const piece = pieces[index];
      const workspace = getPieceWorkspaceState(currentGarment, piece.id);
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
    pointerType?: string,
  ): { pointId: string; handle: "in" | "out" } | null {
    const editor = useEditorStore.getState();
    const piece = editor.garment.pieces.find((candidate) => candidate.id === editor.activePieceId);
    if (!piece || getPieceWorkspaceState(editor.garment, piece.id).locked) return null;
    const local = screenToActivePieceLocal(clientX, clientY);
    const hit = findNearestPatternCurveHandle(
      piece,
      editor.selectedPointId,
      editor.selectedEdgeId,
      local,
      curveHandleHitRadiusPx(pointerType) / cameraRef.current.zoom,
    );
    return hit ? { pointId: hit.pointId, handle: hit.handle } : null;
  }

  function internalPathsForActivePiece(): InternalPath[] {
    const editor = useEditorStore.getState();
    const piece = editor.garment.pieces.find((candidate) => candidate.id === editor.activePieceId);
    return (piece?.internalLines ?? []).filter(isInternalPath);
  }

  function findInternalPathNodeAt(clientX: number, clientY: number): { path: InternalPath; node: InternalPathNode } | null {
    const local = screenToActivePieceLocal(clientX, clientY);
    const threshold = (POINT_RADIUS_PX + 6) / cameraRef.current.zoom;
    for (const path of [...internalPathsForActivePiece()].reverse()) {
      if (!path.visible) continue;
      for (const node of path.nodes) {
        if (Math.hypot(node.xMm - local.xMm, node.yMm - local.yMm) <= threshold) return { path, node };
      }
    }
    return null;
  }

  function findInternalPathHandleAt(
    clientX: number,
    clientY: number,
    pointerType?: string,
  ): { path: InternalPath; node: InternalPathNode; handle: "in" | "out" } | null {
    const state = useInternalPathEditorStore.getState();
    const path = internalPathsForActivePiece().find((candidate) => candidate.id === state.selectedPathId);
    if (!path || path.locked) return null;
    const local = screenToActivePieceLocal(clientX, clientY);
    const hit = findNearestInternalCurveHandle(
      path,
      state.selectedNodeId,
      state.selectedSegmentId,
      local,
      curveHandleHitRadiusPx(pointerType) / cameraRef.current.zoom,
    );
    return hit ? { path, node: hit.node, handle: hit.handle } : null;
  }

  function findInternalPathSegmentAt(clientX: number, clientY: number): { path: InternalPath; segmentId: string } | null {
    const local = screenToActivePieceLocal(clientX, clientY);
    const threshold = 14 / cameraRef.current.zoom;
    let best: { path: InternalPath; segmentId: string; distanceMm: number } | null = null;
    for (const path of internalPathsForActivePiece()) {
      if (!path.visible) continue;
      const hit = findNearestInternalPathSegment(path, local);
      if (hit && hit.distanceMm <= threshold && (!best || hit.distanceMm < best.distanceMm)) {
        best = { path, segmentId: hit.segmentId, distanceMm: hit.distanceMm };
      }
    }
    return best ? { path: best.path, segmentId: best.segmentId } : null;
  }

  function handleInternalPathPointerDown(event: PointerEvent<HTMLCanvasElement>): boolean {
    if (event.button === 1 || spacePressedRef.current || toolRef.current === "hand") return false;
    if (toolRef.current === "select") {
      if (findHandle(event.clientX, event.clientY, event.pointerType)) return false;
      if (findPoint(event.clientX, event.clientY)) return false;
      if (findEdgeRangeAt(event.clientX, event.clientY)) return false;
    }
    const session = useInternalPathEditorStore.getState();
    if ((toolRef.current === "cut" || toolRef.current === "dart") && session.draftPathId) {
      session.appendDraftPoint(screenToActivePieceLocal(event.clientX, event.clientY));
      dragRef.current = null;
      scheduleDraw();
      ownGesture(event.pointerId, "internal-path");
      return true;
    }
    const handleHit = findInternalPathHandleAt(event.clientX, event.clientY, event.pointerType);
    if (handleHit) {
      session.selectPath(handleHit.path.id, session.selectedSegmentId);
      session.selectNode(handleHit.node.id);
      session.beginGeometryEdit("Ajustar curva interna");
      const pointerLocal = screenToActivePieceLocal(event.clientX, event.clientY);
      const offset = curveHandleGrabOffset(handleHit.node, handleHit.handle, pointerLocal);
      dragRef.current = {
        type: "internal-handle",
        pointerId: event.pointerId,
        nodeId: handleHit.node.id,
        handle: handleHit.handle,
        grabOffsetXMm: offset.xMm,
        grabOffsetYMm: offset.yMm,
      };
      ownGesture(event.pointerId, "internal-path");
      return true;
    }
    const nodeHit = findInternalPathNodeAt(event.clientX, event.clientY);
    if (nodeHit && !nodeHit.path.locked) {
      session.selectPath(nodeHit.path.id);
      session.selectNode(nodeHit.node.id);
      session.beginGeometryEdit("Mover nó interno");
      dragRef.current = { type: "internal-node", pointerId: event.pointerId, nodeId: nodeHit.node.id };
      ownGesture(event.pointerId, "internal-path");
      return true;
    }
    const segmentHit = findInternalPathSegmentAt(event.clientX, event.clientY);
    if (segmentHit && !session.draftPathId) {
      session.selectPath(segmentHit.path.id, segmentHit.segmentId);
      dragRef.current = null;
      ownGesture(event.pointerId, "internal-path");
      return true;
    }
    if (toolRef.current === "cut" || toolRef.current === "dart") {
      const editor = useEditorStore.getState();
      const local = screenToActivePieceLocal(event.clientX, event.clientY);
      session.startPath(editor.activePieceId, toolRef.current === "dart" ? "dart" : "cut", local);
      dragRef.current = null;
      scheduleDraw();
      ownGesture(event.pointerId, "internal-path");
      return true;
    }
    return false;
  }

  function insertPointNear(clientX: number, clientY: number): boolean {
    const editor = useEditorStore.getState();
    const piece = editor.garment.pieces.find((candidate) => candidate.id === editor.activePieceId);
    if (!piece || getPieceWorkspaceState(editor.garment, piece.id).locked) return false;
    const world = screenToActivePieceLocal(clientX, clientY);
    const target = findNearestPatternSegment(piece, world);
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
    const currentGarment = useEditorStore.getState().garment;
    return findNearestEdgeHit(
      currentGarment,
      screenToWorld(clientX, clientY),
      18 / cameraRef.current.zoom,
    )?.range ?? null;
  }

  function activePieceLocalBounds() {
    const piece = currentActivePiece();
    return contourBounds(samplePatternContour(piece?.points ?? []));
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
    if (!state.selectedPieceIds.includes(pieceId) || state.selectedPieceIds.length <= 1) {
      return [pieceId];
    }
    return state.selectedPieceIds.filter((id) => {
      const workspace = getPieceWorkspaceState(state.garment, id);
      return workspace.visible && !workspace.locked;
    });
  }

  function isRotationHandleAt(clientX: number, clientY: number): boolean {
    const editor = useEditorStore.getState();
    if (!editor.pieceSelectionActive || !editor.activePieceId || getPieceWorkspaceState(editor.garment, editor.activePieceId).locked) return false;
    const world = screenToWorld(clientX, clientY);
    const handle = rotationHandleWorld();
    return Math.hypot(world.xMm - handle.xMm, world.yMm - handle.yMm) <= 12 / cameraRef.current.zoom;
  }

  function handleIntentClick(clientX: number, clientY: number): boolean {
    const currentTool = toolRef.current;
    if (currentTool !== "cut" && currentTool !== "dart" && currentTool !== "measure") return false;
    const state = useEditorStore.getState();
    const currentGarment = state.garment;
    const world = screenToWorld(clientX, clientY);
    if (currentTool === "measure") {
      state.setMeasureDraft(state.measureDraft ? { ...state.measureDraft, end: world } : { start: world, end: world });
      return true;
    }
    if (currentTool === "cut" && state.cutDraft?.phase === "ready") return true;
    if (currentTool === "cut" && state.cutDraft?.phase === "placing") {
      const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(currentGarment, state.cutDraft.pieceId));
      state.setCutDraft({ ...state.cutDraft, end: local });
      state.freezeCutDraft();
      return true;
    }
    const piece = findPieceAtWorld(world.xMm, world.yMm);
    if (!piece) return false;
    if (piece.id !== state.activePieceId) selectPiece(piece.id);
    const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(currentGarment, piece.id));
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
    const editor = useEditorStore.getState();
    const piece = editor.garment.pieces.find((candidate) => candidate.id === editor.activePieceId);
    if (!piece) return null;
    const transform = getPieceWorkspaceTransform(editor.garment, piece.id);
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
    const currentGarment = useEditorStore.getState().garment;
    for (const piece of currentGarment.pieces) {
      const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(currentGarment, piece.id));
      for (const dart of piece.darts ?? []) {
        const distance = Math.min(distanceToLine(local, dart.legA, dart.apex), distanceToLine(local, dart.legB, dart.apex), Math.hypot(local.xMm - dart.apex.xMm, local.yMm - dart.apex.yMm));
        if (distance <= 12 / cameraRef.current.zoom && (!best || distance < best.distance)) best = { id: dart.id, distance };
      }
    }
    return best?.id ?? null;
  }

  function startPatternHandleDrag(
    event: PointerEvent<HTMLCanvasElement>,
    controlHandle: { pointId: string; handle: "in" | "out" },
  ) {
    const piece = currentActivePiece();
    const anchor = piece?.points.find((point) => point.id === controlHandle.pointId);
    if (!anchor) return;
    const pointerLocal = screenToActivePieceLocal(event.clientX, event.clientY);
    const offset = curveHandleGrabOffset(anchor, controlHandle.handle, pointerLocal);
    onEditStartRef.current("Ajustar curva");
    ownGesture(event.pointerId, "handle");
    dragRef.current = {
      type: "handle",
      pointerId: event.pointerId,
      ...controlHandle,
      grabOffsetXMm: offset.xMm,
      grabOffsetYMm: offset.yMm,
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureOwnershipRef.current = null;
    ownGesture(event.pointerId, "empty");
    dragOriginRef.current = createGestureOrigin(event.pointerId, event.pointerType, event.clientX, event.clientY);
    dragStartedRef.current = false;

    const editorAtPointerDown = useEditorStore.getState();
    const currentGarment = editorAtPointerDown.garment;

    if (
      editorAtPointerDown.draftContour &&
      event.button !== 1 &&
      !event.shiftKey &&
      !spacePressedRef.current
    ) {
      const point = snapDraftWorld(screenToWorld(event.clientX, event.clientY), currentGarment, editorAtPointerDown.draftContour.points.at(-1));
      const first = editorAtPointerDown.draftContour.points[0];
      const closeDistance = 12 / cameraRef.current.zoom;
      if (
        first &&
        editorAtPointerDown.draftContour.points.length >= 3 &&
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
        dragStartedRef.current = true;
        setIsPanning(true);
        return;
      }

      if (toolRef.current === "point") {
        pointTapRef.current = createGestureOrigin(
          event.pointerId,
          event.pointerType,
          event.clientX,
          event.clientY,
        );
        dragRef.current = null;
        return;
      }

      if (handleInternalPathPointerDown(event)) return;

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

      const controlHandle = findHandle(event.clientX, event.clientY, event.pointerType);
      if (controlHandle) {
        startPatternHandleDrag(event, controlHandle);
        return;
      }

      const pointHit = findPoint(event.clientX, event.clientY);
      if (pointHit) {
        if (pointHit.pieceId !== editorAtPointerDown.activePieceId) selectPiece(pointHit.pieceId);
        onSelectPoint(pointHit.point.id);
        onEditStartRef.current("Mover ponto");
        ownGesture(event.pointerId, "point");
        dragRef.current = { type: "point", pointerId: event.pointerId, pieceId: pointHit.pieceId, pointId: pointHit.point.id };
        return;
      }

      if (toolRef.current === "select") {
        const edge = findEdgeRangeAt(event.clientX, event.clientY);
        if (edge) {
          selectPiece(edge.pieceId); onSelectPoint(null); useEditorStore.getState().selectEdge(edge.edgeId);
          const world = screenToWorld(event.clientX, event.clientY); onEditStartRef.current("Mover borda");
          ownGesture(event.pointerId, "segment");
          dragRef.current = { type: "segment", pointerId: event.pointerId, edgeId: edge.edgeId, lastWorldX: world.xMm, lastWorldY: world.yMm };
          return;
        }
      }

      const world = screenToWorld(event.clientX, event.clientY);
      const piece = findPieceAtWorld(world.xMm, world.yMm);
      if (piece) {
        const selectedIds = useEditorStore.getState().selectedPieceIds;
        if (!selectedIds.includes(piece.id)) selectPiece(piece.id);
        onSelectPoint(null);
        const workspace = getPieceWorkspaceState(currentGarment, piece.id);
        if (workspace.locked) {
          dragRef.current = null;
          return;
        }
        ownGesture(event.pointerId, "piece");
        touchPieceCandidateRef.current = {
          ...createGestureOrigin(event.pointerId, event.pointerType, event.clientX, event.clientY),
          pieceId: piece.id,
          startWorldX: world.xMm,
          startWorldY: world.yMm,
          startX: workspace.transform.xMm,
          startY: workspace.transform.yMm,
          groupStarts: piecesMovingWith(piece.id).map((id) => ({ ...getPieceWorkspaceTransform(currentGarment, id) })),
        };
        dragRef.current = null;
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
      dragStartedRef.current = true;
      setIsPanning(true);
      return;
    }

    if (toolRef.current === "select" && isRotationHandleAt(event.clientX, event.clientY)) {
      const state = useEditorStore.getState();
      const transform = activeTransform();
      const bounds = activePieceLocalBounds();
      const center = pieceLocalToWorld({ xMm: (bounds.minX + bounds.maxX) / 2, yMm: (bounds.minY + bounds.maxY) / 2 }, transform);
      const pointer = screenToWorld(event.clientX, event.clientY);
      onEditStartRef.current("Rotacionar peça");
      ownGesture(event.pointerId, "rotation");
      dragRef.current = {
        type: "rotate",
        pointerId: event.pointerId,
        pieceId: state.activePieceId,
        centerWorldX: center.xMm,
        centerWorldY: center.yMm,
        startPointerAngle: Math.atan2(pointer.yMm - center.yMm, pointer.xMm - center.xMm),
        startRotationDeg: transform.rotationDeg,
      };
      setRotationFeedback(transform.rotationDeg);
      return;
    }

    if (toolRef.current === "point") {
      pointTapRef.current = createGestureOrigin(
        event.pointerId,
        event.pointerType,
        event.clientX,
        event.clientY,
      );
      dragRef.current = null;
      return;
    }

    if (toolRef.current === "select") {
      const protectedHandle = findHandle(event.clientX, event.clientY, event.pointerType)
        || findInternalPathHandleAt(event.clientX, event.clientY, event.pointerType);
      const protectedPoint = findPoint(event.clientX, event.clientY);
      if (!protectedHandle && !protectedPoint) {
        const seamHit = findNearestSeamHit(
          currentGarment,
          screenToWorld(event.clientX, event.clientY),
          12 / cameraRef.current.zoom,
        );
        if (seamHit) {
          useEditorStore.getState().selectSeam(seamHit.seam.id);
          dragRef.current = null;
          scheduleDraw();
          return;
        }
        const dartId = findDartAt(event.clientX, event.clientY);
        if (dartId) { useEditorStore.getState().selectDart(dartId); dragRef.current = null; return; }
      }
    }

    if (handleInternalPathPointerDown(event)) return;

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

    const controlHandle = findHandle(event.clientX, event.clientY, event.pointerType);
    if (controlHandle) {
      startPatternHandleDrag(event, controlHandle);
      return;
    }

    const pointHit = findPoint(event.clientX, event.clientY);
    if (pointHit) {
      if (pointHit.pieceId !== editorAtPointerDown.activePieceId) selectPiece(pointHit.pieceId);
      onSelectPoint(pointHit.point.id);
      onEditStartRef.current("Mover ponto");
      ownGesture(event.pointerId, "point");
      dragRef.current = {
        type: "point",
        pointerId: event.pointerId,
        pieceId: pointHit.pieceId,
        pointId: pointHit.point.id,
      };
      return;
    }

    if (toolRef.current === "select") {
      const edge = findEdgeRangeAt(event.clientX, event.clientY);
      if (edge) {
        selectPiece(edge.pieceId); onSelectPoint(null); useEditorStore.getState().selectEdge(edge.edgeId);
        const world = screenToWorld(event.clientX, event.clientY); onEditStartRef.current("Mover borda");
        ownGesture(event.pointerId, "segment");
        dragRef.current = { type: "segment", pointerId: event.pointerId, edgeId: edge.edgeId, lastWorldX: world.xMm, lastWorldY: world.yMm };
        return;
      }
    }

    const world = screenToWorld(event.clientX, event.clientY);
    const piece = findPieceAtWorld(world.xMm, world.yMm);
    if (piece) {
      const selectedIds = useEditorStore.getState().selectedPieceIds;
      if (event.shiftKey) useEditorStore.getState().togglePieceSelection(piece.id);
      else if (!selectedIds.includes(piece.id)) selectPiece(piece.id);
      onSelectPoint(null);
      const workspace = getPieceWorkspaceState(currentGarment, piece.id);
      if (workspace.locked) {
        dragRef.current = null;
        return;
      }
      onEditStartRef.current("Mover peça");
      ownGesture(event.pointerId, "piece");
      dragRef.current = {
        type: "piece",
        pointerId: event.pointerId,
        pieceId: piece.id,
        startWorldX: world.xMm,
        startWorldY: world.yMm,
        startX: workspace.transform.xMm,
        startY: workspace.transform.yMm,
        groupStarts: piecesMovingWith(piece.id).map((id) => ({ ...getPieceWorkspaceTransform(currentGarment, id) })),
      };
      return;
    }
    if (toolRef.current === "select" && event.shiftKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left; const y = event.clientY - rect.top;
      ownGesture(event.pointerId, "box");
      dragRef.current = { type: "box", pointerId: event.pointerId, startX: x, startY: y, currentX: x, currentY: y, additive: true };
    } else if (toolRef.current === "select") {
      dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);
    } else clearEditorSelection();
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const editor = useEditorStore.getState();
    const currentGarment = editor.garment;
    if (editor.draftContour && !dragRef.current) {
      const point = snapDraftWorld(screenToWorld(event.clientX, event.clientY), currentGarment, editor.draftContour.points.at(-1));
      updateDraftCursor(point.xMm, point.yMm);
      scheduleDraw();
    }
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }

    const touchCandidate = touchPieceCandidateRef.current;
    if (
      !dragRef.current &&
      touchCandidate?.pointerId === event.pointerId &&
      !finishGesture(touchCandidate, event.clientX, event.clientY).isClick
    ) {
      onEditStartRef.current("Mover peça");
      ownGesture(event.pointerId, "piece");
      dragStartedRef.current = true;
      dragRef.current = {
        type: "piece",
        pointerId: event.pointerId,
        pieceId: touchCandidate.pieceId,
        startWorldX: touchCandidate.startWorldX,
        startWorldY: touchCandidate.startWorldY,
        startX: touchCandidate.startX,
        startY: touchCandidate.startY,
        groupStarts: touchCandidate.groupStarts,
      };
      touchPieceCandidateRef.current = null;
    }

    const drag = dragRef.current;
    if (!drag && useInternalPathEditorStore.getState().draftPathId) {
      useInternalPathEditorStore.getState().updateDraftCursor(screenToActivePieceLocal(event.clientX, event.clientY));
      scheduleDraw();
    }
    if (!drag) {
      const state = useEditorStore.getState();
      const latestGarment = state.garment;
      const world = screenToWorld(event.clientX, event.clientY);
      if (toolRef.current === "cut" && state.cutDraft?.phase === "placing") state.setCutDraft({ ...state.cutDraft, end: pieceWorldToLocal(world, getPieceWorkspaceTransform(latestGarment, state.cutDraft.pieceId)) });
      if (toolRef.current === "dart" && state.dartDraft?.phase === "placing") state.setDartDraft({ ...state.dartDraft, apex: pieceWorldToLocal(world, getPieceWorkspaceTransform(latestGarment, state.dartDraft.pieceId)) });
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

    const thresholdIntent = drag.type === "piece" ? "piece" : drag.type === "point" ? "point" : drag.type === "handle" ? "handle" : drag.type === "pan" ? "pan" : drag.type === "box" ? "box" : null;
    if (!dragStartedRef.current && thresholdIntent && dragOriginRef.current) {
      if (!shouldStartDrag(dragOriginRef.current, event.clientX, event.clientY, thresholdIntent)) return;
      dragStartedRef.current = true;
      if (drag.type === "pan") setIsPanning(true);
    }

    if (drag.type === "pan") {
      updateCamera({
        ...cameraRef.current,
        panX: drag.panX + event.clientX - drag.startX,
        panY: drag.panY + event.clientY - drag.startY,
      });
      return;
    }

    if (drag.type === "internal-node") {
      useInternalPathEditorStore.getState().moveSelectedNode(screenToActivePieceLocal(event.clientX, event.clientY));
      scheduleDraw();
      return;
    }

    if (drag.type === "internal-handle") {
      const pointerLocal = screenToActivePieceLocal(event.clientX, event.clientY);
      const local = {
        xMm: pointerLocal.xMm + drag.grabOffsetXMm,
        yMm: pointerLocal.yMm + drag.grabOffsetYMm,
      };
      const state = useInternalPathEditorStore.getState();
      const path = internalPathsForActivePiece().find((candidate) => candidate.id === state.selectedPathId);
      const node = path?.nodes.find((candidate) => candidate.id === drag.nodeId);
      if (node) state.moveSelectedHandle(drag.handle, { xMm: local.xMm - node.xMm, yMm: local.yMm - node.yMm });
      scheduleDraw();
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
      const latest = useEditorStore.getState().garment;
      const current = getPieceWorkspaceState(latest, drag.pieceId).transform;
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
      const latest = useEditorStore.getState().garment;
      const current = getPieceWorkspaceState(latest, drag.pieceId).transform;
      queueWorkspaceTransforms([{ ...current, rotationDeg }]);
      setRotationFeedback(rotationDeg);
      return;
    }

    if (drag.type === "point") {
      const currentGarment = garmentRef.current;
      const draggedPiece = currentGarment.pieces.find((piece) => piece.id === drag.pieceId);
      if (!draggedPiece) return;
      const world = pieceWorldToLocal(
        screenToWorld(event.clientX, event.clientY),
        getPieceWorkspaceTransform(currentGarment, drag.pieceId),
      );
      const snapPx = 10;
      const thresholdMm = snapPx / cameraRef.current.zoom;
      let snapped = null as { xMm: number; yMm: number; type: string } | null;
      for (const other of draggedPiece.points) {
        if (other.id === drag.pointId) continue;
        const d = Math.hypot(other.xMm - world.xMm, other.yMm - world.yMm);
        if (d <= thresholdMm) {
          snapped = { xMm: other.xMm, yMm: other.yMm, type: "point" };
          break;
        }
      }
      if (!snapped) {
        for (let i = 0; i < draggedPiece.points.length; i += 1) {
          const a = draggedPiece.points[i];
          const b = draggedPiece.points[(i + 1) % draggedPiece.points.length];
          const mx = (a.xMm + b.xMm) / 2;
          const my = (a.yMm + b.yMm) / 2;
          const d = Math.hypot(mx - world.xMm, my - world.yMm);
          if (d <= thresholdMm) {
            snapped = { xMm: mx, yMm: my, type: "midpoint" };
            break;
          }
        }
      }
      if (!snapped) {
        for (const other of draggedPiece.points) {
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

    const pointerLocal = screenToActivePieceLocal(event.clientX, event.clientY);
    const world = {
      xMm: pointerLocal.xMm + drag.grabOffsetXMm,
      yMm: pointerLocal.yMm + drag.grabOffsetYMm,
    };
    const piece = currentActivePiece();
    const anchor = piece?.points.find(
      (point) => point.id === drag.pointId,
    );
    if (!piece || !anchor) return;

    const snapPx = 10;
    const thresholdMm = snapPx / cameraRef.current.zoom;
    let snappedHandle = null as { xMm: number; yMm: number; type: string } | null;
    for (const other of piece.points) {
      if (Math.abs(other.xMm - world.xMm) <= thresholdMm) {
        snappedHandle = { xMm: other.xMm - anchor.xMm, yMm: world.yMm - anchor.yMm, type: "hv" };
        break;
      }
      if (Math.abs(other.yMm - world.yMm) <= thresholdMm) {
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

  function handleWheel(event: globalThis.WheelEvent) {
    const owner = gestureOwnershipRef.current?.owner ?? "empty";
    if (isInteractiveGestureOwner(owner)) {
      event.preventDefault();
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const navigation = normalizeWheelNavigation({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      viewportHeight: rect.height,
    });
    event.preventDefault();
    pendingWheelRef.current = {
      navigation: mergeWheelNavigation(pendingWheelRef.current?.navigation ?? null, navigation),
      cursor,
    };
    if (wheelFrameRef.current !== null) return;
    wheelFrameRef.current = window.requestAnimationFrame(() => {
      wheelFrameRef.current = null;
      const pending = pendingWheelRef.current;
      pendingWheelRef.current = null;
      if (pending) updateCamera(applyWheelNavigation(cameraRef.current, pending.navigation, pending.cursor));
    });
  }

  function handleDoubleClick(event: MouseEvent<HTMLCanvasElement>) {
    useEditorStore.getState().cancelIntent();
    const dimension = dimensionAt(event.clientX, event.clientY);
    if (!dimension) return;
    selectPiece(dimension.piece.id);
    if (dimension.start.handleOut || dimension.end.handleIn) {
      setDimensionError("Arraste os handles no Canvas ou use o painel numérico para valores exatos.");
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
    ownGesture(pointerId, "pan");
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
    pointTapRef.current = null;
    touchPieceCandidateRef.current = null;
    const canvas = canvasRef.current;
    const pointers = [...activePointersRef.current.entries()];
    if (!canvas || pointers.length < 2) return;

    const [[firstId, first], [secondId, second]] = pointers;
    const rect = canvas.getBoundingClientRect();
    gestureOwnershipRef.current = { pointerId: firstId, owner: "pinch" };
    dragStartedRef.current = true;
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
    const pointerCountBeforeRelease = Math.max(1, activePointersRef.current.size);
    const pendingPointTap = pointTapRef.current;
    if (pendingPointTap?.pointerId === event.pointerId) {
      const finish = finishGesture(
        pendingPointTap,
        event.clientX,
        event.clientY,
      );
      pointTapRef.current = null;
      if (
        shouldInsertPointFromTap(
          pendingPointTap,
          finish,
          pointerCountBeforeRelease,
        )
      ) {
        insertPointNear(event.clientX, event.clientY);
      }
    }
    if (touchPieceCandidateRef.current?.pointerId === event.pointerId) {
      touchPieceCandidateRef.current = null;
    }
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

    if ((finishedDrag?.type === "internal-node" || finishedDrag?.type === "internal-handle") && finishedDrag.pointerId === event.pointerId) {
      useInternalPathEditorStore.getState().commitGeometryEdit();
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
      finishedDrag.pointerId === event.pointerId &&
      dragStartedRef.current
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
      if (!shouldStartBoxSelection(moved, dragOriginRef.current?.pointerType ?? "mouse")) {
        clearEditorSelection();
      } else {
        const currentGarment = useEditorStore.getState().garment;
        const left = Math.min(finishedDrag.startX, finishedDrag.currentX); const right = Math.max(finishedDrag.startX, finishedDrag.currentX);
        const top = Math.min(finishedDrag.startY, finishedDrag.currentY); const bottom = Math.max(finishedDrag.startY, finishedDrag.currentY);
        const hits = currentGarment.pieces.filter((piece) => getPieceWorkspaceState(currentGarment, piece.id).visible).filter((piece) => {
          const transform = getPieceWorkspaceTransform(currentGarment, piece.id);
          const points = samplePatternContour(piece.points).map((point) => worldToScreen(pieceLocalToWorld(point, transform), cameraRef.current));
          const bounds = { left: Math.min(...points.map((point) => point.x)), right: Math.max(...points.map((point) => point.x)), top: Math.min(...points.map((point) => point.y)), bottom: Math.max(...points.map((point) => point.y)) };
          return bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom;
        }).map((piece) => piece.id);
        const previous = useEditorStore.getState().selectedPieceIds;
        useEditorStore.getState().setPieceSelection(finishedDrag.additive ? [...previous, ...hits] : hits);
      }
    }
    if (finishedDrag?.type === "pan") {
      if (!dragStartedRef.current && toolRef.current === "select") {
        clearEditorSelection();
      }
      setIsPanning(false);
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
    dragOriginRef.current = null;
    dragStartedRef.current = false;
    if (gestureOwnershipRef.current?.pointerId === event.pointerId) gestureOwnershipRef.current = null;
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
        tabIndex={0}
        className={`pattern-canvas pattern-canvas-${tool}${spaceHandActive ? " is-space-hand" : ""}${isPanning ? " is-panning" : ""}${hoveredDimension ? " is-dimension-hovered" : ""}`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onDoubleClick={handleDoubleClick}
        aria-label="Editor de molde 2D"
      />
      {selectedSeamId ? (
        <div className="canvas-seam-label" role="status">
          {garmentSeams.find((seam) => seam.id === selectedSeamId)?.name ?? "Costura selecionada"}
        </div>
      ) : null}
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
  _snapshot: PatternSnapshot,
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
  selectedSeamId: string | null,
  selectedDartId: string | null,
  selectedPieceIds: string[],
  cutDraft: { pieceId: string; start: import("../domain/pattern").PatternVector; end: import("../domain/pattern").PatternVector } | null,
  dartDraft: { pieceId: string; edgePoint: import("../domain/pattern").PatternVector; apex: import("../domain/pattern").PatternVector } | null,
  measureDraft: { start: import("../domain/pattern").PatternVector; end: import("../domain/pattern").PatternVector } | null,
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f4f2ed";
  context.fillRect(0, 0, width, height);

  drawRulers(context, width, height, camera);
  drawGrid(context, width, height, camera);

  const activePiece = garment.pieces.find((piece) => piece.id === activePieceId);

  context.save();
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);

  const activeTransform = activePiece
    ? getPieceWorkspaceTransform(garment, activePieceId)
    : { pieceId: "empty-workspace", xMm: 0, yMm: 0, rotationDeg: 0 };

  if (activePiece?.guides) {
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
      const richPath = isInternalPath(line) ? line : null;
      if (richPath?.visible === false) continue;
      const points = ("points" in line ? line.points : sampleInternalPath(line)).map((point) => pieceLocalToWorld(point, transform));
      if (points.length < 2) continue;
      context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.xMm, point.yMm) : context.moveTo(point.xMm, point.yMm));
      context.setLineDash(line.purpose === "fold" ? [8 / camera.zoom, 5 / camera.zoom] : line.purpose === "reference" ? [3 / camera.zoom, 3 / camera.zoom] : []);
      const internalState = useInternalPathEditorStore.getState();
      const selectedPath = richPath?.id === internalState.selectedPathId;
      context.strokeStyle = line.purpose === "dart" ? "#b06084" : line.purpose === "cut" || line.purpose === "cut-and-sew" ? "#b3442e" : "#59636c";
      context.lineWidth = (selectedPath ? 3 : 1.5) / camera.zoom; context.stroke(); context.setLineDash([]);
      if (selectedPath && richPath) {
        const selectedNodeId = internalState.selectedNodeId;
        const selectedSegmentId = internalState.selectedSegmentId;
        const visibleHandles = internalCurveHandleTargets(richPath, selectedNodeId, selectedSegmentId);
        for (const node of richPath.nodes) {
          const point = pieceLocalToWorld(node, transform);
          const selectedNode = node.id === selectedNodeId;
          context.beginPath(); context.arc(point.xMm, point.yMm, (selectedNode ? 7 : 5) / camera.zoom, 0, Math.PI * 2);
          context.fillStyle = selectedNode ? "#fff" : "#f6d8cc"; context.fill(); context.strokeStyle = "#b3442e"; context.lineWidth = 2 / camera.zoom; context.stroke();
        }
        for (const target of visibleHandles) {
          const node = richPath.nodes.find((candidate) => candidate.id === target.nodeId);
          if (!node) continue;
          const vector = target.handle === "in" ? node.handleIn : node.handleOut;
          if (!vector) continue;
          const point = pieceLocalToWorld(node, transform);
          const endpoint = pieceLocalToWorld({ xMm: node.xMm + vector.xMm, yMm: node.yMm + vector.yMm }, transform);
          context.beginPath(); context.moveTo(point.xMm, point.yMm); context.lineTo(endpoint.xMm, endpoint.yMm); context.strokeStyle = "#8a6d63"; context.lineWidth = 1 / camera.zoom; context.stroke();
          context.beginPath(); context.arc(endpoint.xMm, endpoint.yMm, 4 / camera.zoom, 0, Math.PI * 2); context.fillStyle = "#fff"; context.fill(); context.strokeStyle = "#8a6d63"; context.stroke();
        }
        for (const hit of internalState.analysis?.intersections ?? []) {
          const point = pieceLocalToWorld(hit, transform);
          context.beginPath(); context.arc(point.xMm, point.yMm, 6 / camera.zoom, 0, Math.PI * 2); context.fillStyle = hit.tangent ? "#d9a400" : "#b51f1f"; context.fill();
        }
      }
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
      const selected = seam.id === selectedSeamId;
      const inactive = seam.active === false;
      if (inactive) context.setLineDash([5 / camera.zoom, 5 / camera.zoom]);
      drawSeamInterval(context, piece, seam.first, transform, camera.zoom, selected ? "#ff7a00" : inactive ? "#9b7d7d" : "#a23d3d", selected ? 5 : 3);
      drawSeamInterval(context, piece, seam.second, transform, camera.zoom, selected ? "#ffb000" : inactive ? "#7d899b" : "#3d6aa2", selected ? 5 : 3);
      if (inactive) context.setLineDash([]);
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

      for (const target of patternCurveHandleTargets(piece, selectedPointId, selectedEdgeId)) {
        const point = transformedPoints.find((candidate) => candidate.id === target.pointId);
        if (point) drawControlHandle(context, point, target.handle, camera.zoom);
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
    } else if (!workspace.locked) {
      for (const point of transformedPoints) {
        context.beginPath();
        context.arc(point.xMm, point.yMm, 3.5 / camera.zoom, 0, Math.PI * 2);
        context.fillStyle = "rgba(255, 255, 255, 0.88)";
        context.fill();
        context.strokeStyle = "rgba(79, 84, 88, 0.78)";
        context.lineWidth = 1.25 / camera.zoom;
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
  for (let x = ((camera.panX % minorPx) + minorPx) % minorPx; x < width; x += minorPx) {
    const isMajor = Math.abs((x - (camera.panX % majorPx + majorPx) % majorPx)) < 0.0001 || (x % majorPx === 0);
    const tickHeight = isMajor ? 10 : 6;
    context.beginPath();
    context.moveTo(x + 0.5, rulerSize - 1);
    context.lineTo(x + 0.5, rulerSize - 1 - tickHeight);
    context.stroke();
    if (isMajor) {
      const worldX = (x - camera.panX) / camera.zoom;
      context.fillText(`${Math.round(worldX)} mm`, x + 4, 2);
    }
  }

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
  widthPx = 3,
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
  context.lineWidth = widthPx / zoom;
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
  if (points.length === 0) return;
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
