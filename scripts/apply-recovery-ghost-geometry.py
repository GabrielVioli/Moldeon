from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

def regex_once(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")
    return next_text

canvas_path = "apps/web/src/editor/PatternCanvas.tsx"
canvas = read(canvas_path)

canvas = replace_once(
    canvas,
    '  type PatternSnapshot,\n',
    '',
    "remove PatternSnapshot import",
)
canvas = replace_once(
    canvas,
    'import { findEditablePatternPoint, pointInScreenRect, resizeStraightSegment, rotationFromPointer, parsePositiveLength } from "./workspaceInteractions";\n',
    'import { findEditablePatternPoint, pointInScreenRect, resizeStraightSegment, rotationFromPointer, parsePositiveLength } from "./workspaceInteractions";\n'
    'import { createCanvasRenderAudit, filterCanvasPieceIds, filterCanvasSeams, validCanvasActivePieceId, validCanvasPieceDraft } from "./canvasRenderState";\n',
    "add canvas render state import",
)
canvas = replace_once(
    canvas,
    '  snapshot: PatternSnapshot;\n',
    '',
    "remove snapshot prop",
)
canvas = replace_once(
    canvas,
    '  snapshot,\n  tool,\n',
    '  tool,\n',
    "remove snapshot destructure",
)
canvas = replace_once(
    canvas,
    '  const snapshotRef = useRef(snapshot);\n',
    '',
    "remove snapshot ref",
)
canvas = replace_once(
    canvas,
    '  const wheelFrameRef = useRef<number | null>(null);\n',
    '  const wheelFrameRef = useRef<number | null>(null);\n'
    '  const wheelListenerAttachedRef = useRef(false);\n'
    '  const drawLatestRef = useRef<() => void>(() => undefined);\n',
    "add stable draw and listener refs",
)
canvas = replace_once(
    canvas,
    '  snapshotRef.current = snapshot;\n',
    '',
    "remove snapshot ref assignment",
)
canvas = replace_once(
    canvas,
    '  const garment = useEditorStore((s) => s.garment);\n  const activePieceId = useEditorStore((s) => s.activePieceId);\n',
    '  const garment = useEditorStore((s) => s.garment);\n'
    '  const activePieceId = useEditorStore((s) => s.activePieceId);\n'
    '  const pieceIdSignature = garment.pieces.map((piece) => piece.id).join("\\u001f");\n',
    "add piece identity signature",
)
canvas = replace_once(
    canvas,
    '  const [dimensionEditor, setDimensionEditor] = useState<{\n'
    '    startPointId: string;\n'
    '    endPointId: string;\n'
    '    left: number;\n'
    '    top: number;\n'
    '    value: string;\n'
    '    pieceId: string;\n'
    '  } | null>(null);\n',
    '  const [dimensionEditor, setDimensionEditor] = useState<{\n'
    '    startPointId: string;\n'
    '    endPointId: string;\n'
    '    left: number;\n'
    '    top: number;\n'
    '    value: string;\n'
    '    pieceId: string;\n'
    '  } | null>(null);\n'
    '  const hoveredDimensionRef = useRef(hoveredDimension);\n'
    '  const rotationFeedbackRef = useRef(rotationFeedback);\n'
    '  hoveredDimensionRef.current = hoveredDimension;\n'
    '  rotationFeedbackRef.current = rotationFeedback;\n',
    "add local render refs",
)

draw_block_pattern = re.compile(
    r'  const drawLatest = useCallback\(\(\) => \{\n.*?\n  \}, \[activePieceId, cutDraft, dartDraft, draftContour, draftCursor, garment, garmentSeams, hoveredDimension, internalPathAnalysis, measureDraft, pieceSelectionActive, rotationFeedback, seamFirstEdge, selectedDartId, selectedEdgeId, selectedInternalPathId, selectedInternalPathNodeId, selectedPieceIds, selectedSeamId, draftInternalPathId\]\);\n',
    re.S,
)
draw_block_replacement = '''  const drawLatest = useCallback(() => {
    const context = contextRef.current;
    const canvas = canvasRef.current;
    if (!context || !canvas) return;

    const state = useEditorStore.getState();
    const currentGarment = state.garment;
    const currentActivePieceId = validCanvasActivePieceId(
      currentGarment,
      state.activePieceId,
    );
    const currentActivePiece = currentGarment.pieces.find(
      (piece) => piece.id === currentActivePieceId,
    );
    const currentSelectedPointId =
      currentActivePiece
      && state.selectedPointId
      && currentActivePiece.points.some((point) => point.id === state.selectedPointId)
        ? state.selectedPointId
        : null;
    const validSelectedPieceIds = filterCanvasPieceIds(
      currentGarment,
      state.selectedPieceIds,
    );
    const validSeamFirstEdge =
      state.seamFirstEdge
      && currentGarment.pieces.some((piece) => piece.id === state.seamFirstEdge?.pieceId)
        ? state.seamFirstEdge
        : null;
    const validCutDraft = validCanvasPieceDraft(currentGarment, state.cutDraft);
    const validDartDraft = validCanvasPieceDraft(currentGarment, state.dartDraft);
    const validSeams = filterCanvasSeams(currentGarment, currentGarment.seams ?? []);
    const validSelectedSeamId = validSeams.some((seam) => seam.id === state.selectedSeamId)
      ? state.selectedSeamId
      : null;
    const validSelectedDartId = currentGarment.pieces.some((piece) =>
      (piece.darts ?? []).some((dart) => dart.id === state.selectedDartId),
    )
      ? state.selectedDartId
      : null;
    const { width, height } = canvasSizeRef.current;
    const audit = createCanvasRenderAudit(
      currentGarment,
      currentActivePieceId,
      cameraRef.current.zoom,
    );

    draw(
      context,
      width,
      height,
      currentSelectedPointId,
      cameraRef.current,
      currentActivePiece ? snapRef.current : null,
      validSeamFirstEdge ? { first: validSeamFirstEdge } : null,
      validSeams,
      currentGarment,
      currentActivePieceId,
      state.pieceSelectionActive && Boolean(currentActivePieceId),
      state.draftContour,
      state.draftCursor,
      hoveredDimensionRef.current,
      rotationFeedbackRef.current,
      dragRef.current?.type === "box" ? dragRef.current : null,
      currentActivePiece ? state.selectedEdgeId : null,
      validSelectedSeamId,
      validSelectedDartId,
      validSelectedPieceIds,
      validCutDraft,
      validDartDraft,
      currentGarment.pieces.length > 0 ? state.measureDraft : null,
    );

    canvas.dataset.renderedPieceIds = audit.pieceIds.join(",");
    canvas.dataset.renderedPieceCount = String(audit.pieceIds.length);
    canvas.dataset.renderedDimensionPieceIds = audit.dimensionPieceIds.join(",");
    canvas.dataset.renderedGeometryCount = String(
      audit.pieceIds.length + audit.dimensionPieceIds.length,
    );
    canvas.dataset.activeDocumentPieceId = currentActivePieceId;
    canvas.dataset.pendingDrawRaf = "0";
    canvas.dataset.renderSerial = String(
      Number.parseInt(canvas.dataset.renderSerial ?? "0", 10) + 1,
    );
  }, []);
  drawLatestRef.current = drawLatest;
'''
canvas, count = draw_block_pattern.subn(draw_block_replacement, canvas, count=1)
if count != 1:
    raise SystemExit(f"replace drawLatest: expected 1 match, found {count}")

canvas = replace_once(
    canvas,
    '  const scheduleDraw = useCallback(() => {\n'
    '    if (drawFrameRef.current !== null) return;\n'
    '    drawFrameRef.current = window.requestAnimationFrame(drawLatest);\n'
    '  }, [drawLatest]);\n',
    '  const scheduleDraw = useCallback(() => {\n'
    '    if (drawFrameRef.current !== null) return;\n'
    '    const canvas = canvasRef.current;\n'
    '    if (canvas) canvas.dataset.pendingDrawRaf = "1";\n'
    '    drawFrameRef.current = window.requestAnimationFrame(() => {\n'
    '      drawFrameRef.current = null;\n'
    '      drawLatestRef.current();\n'
    '    });\n'
    '  }, []);\n',
    "make scheduler stable",
)

canvas = replace_once(
    canvas,
    '    const context = canvas.getContext("2d");\n'
    '    if (!context) return;\n'
    '    contextRef.current = context;\n'
    '    const nativeWheel = (event: globalThis.WheelEvent) => handleWheel(event);\n'
    '    canvas.addEventListener("wheel", nativeWheel, { passive: false });\n',
    '    const context = canvas.getContext("2d");\n'
    '    if (!context) return;\n'
    '    if (wheelListenerAttachedRef.current) {\n'
    '      throw new Error("PatternCanvas tentou registrar um segundo listener de wheel.");\n'
    '    }\n'
    '    contextRef.current = context;\n'
    '    wheelListenerAttachedRef.current = true;\n'
    '    canvas.dataset.wheelListenerCount = "1";\n'
    '    canvas.dataset.pendingDrawRaf = "0";\n'
    '    canvas.dataset.pendingWheelRaf = "0";\n'
    '    const nativeWheel = (event: globalThis.WheelEvent) => handleWheel(event);\n'
    '    canvas.addEventListener("wheel", nativeWheel, { passive: false });\n',
    "instrument single wheel listener",
)

canvas = replace_once(
    canvas,
    '      canvas.removeEventListener("wheel", nativeWheel);\n'
    '      contextRef.current = null;\n',
    '      canvas.removeEventListener("wheel", nativeWheel);\n'
    '      wheelListenerAttachedRef.current = false;\n'
    '      canvas.dataset.wheelListenerCount = "0";\n'
    '      canvas.dataset.pendingDrawRaf = "0";\n'
    '      canvas.dataset.pendingWheelRaf = "0";\n'
    '      contextRef.current = null;\n',
    "cleanup listener diagnostics",
)
canvas = replace_once(
    canvas,
    '      if (wheelFrameRef.current !== null) {\n'
    '        window.cancelAnimationFrame(wheelFrameRef.current);\n'
    '        wheelFrameRef.current = null;\n'
    '      }\n'
    '    };\n'
    '  }, []);\n\n'
    '  useEffect(() => {\n'
    '    scheduleDraw();\n'
    '  }, [snapshot, selectedPointId, scheduleDraw]);\n',
    '      if (wheelFrameRef.current !== null) {\n'
    '        window.cancelAnimationFrame(wheelFrameRef.current);\n'
    '        wheelFrameRef.current = null;\n'
    '      }\n'
    '      pendingMoveRef.current = null;\n'
    '      pendingWorkspaceRef.current = [];\n'
    '      pendingWheelRef.current = null;\n'
    '      activePointersRef.current.clear();\n'
    '      dragRef.current = null;\n'
    '      snapRef.current = null;\n'
    '    };\n'
    '  }, []);\n\n'
    '  useEffect(() => {\n'
    '    scheduleDraw();\n'
    '  });\n\n'
    '  useEffect(() => {\n'
    '    const validPieceIds = new Set(garment.pieces.map((piece) => piece.id));\n'
    '    if (wheelFrameRef.current !== null) {\n'
    '      window.cancelAnimationFrame(wheelFrameRef.current);\n'
    '      wheelFrameRef.current = null;\n'
    '    }\n'
    '    pendingWheelRef.current = null;\n'
    '    if (moveFrameRef.current !== null) {\n'
    '      window.cancelAnimationFrame(moveFrameRef.current);\n'
    '      moveFrameRef.current = null;\n'
    '    }\n'
    '    pendingMoveRef.current = null;\n'
    '    if (workspaceFrameRef.current !== null) {\n'
    '      window.cancelAnimationFrame(workspaceFrameRef.current);\n'
    '      workspaceFrameRef.current = null;\n'
    '    }\n'
    '    pendingWorkspaceRef.current = [];\n'
    '    const activeDrag = dragRef.current;\n'
    '    if (activeDrag && "pieceId" in activeDrag && !validPieceIds.has(activeDrag.pieceId)) {\n'
    '      dragRef.current = null;\n'
    '    }\n'
    '    if (dimensionEditor && !validPieceIds.has(dimensionEditor.pieceId)) {\n'
    '      setDimensionEditor(null);\n'
    '    }\n'
    '    if (hoveredDimension) {\n'
    '      const hoveredPieceId = hoveredDimension.split(":", 1)[0];\n'
    '      if (!validPieceIds.has(hoveredPieceId)) setHoveredDimension(null);\n'
    '    }\n'
    '    snapRef.current = null;\n'
    '    const canvas = canvasRef.current;\n'
    '    if (canvas) canvas.dataset.pendingWheelRaf = "0";\n'
    '    scheduleDraw();\n'
    '  }, [pieceIdSignature, activePieceId, scheduleDraw]);\n',
    "replace draw effect and invalidate removed geometry",
)

canvas = replace_once(
    canvas,
    '  function findHandle(\n'
    '    clientX: number,\n'
    '    clientY: number,\n'
    '  ): { pointId: string; handle: "in" | "out" } | null {\n'
    '    if (getPieceWorkspaceState(garment, activePieceId).locked) return null;\n'
    '    const selected = snapshotRef.current.piece.points.find(\n'
    '      (point) => point.id === selectedPointIdRef.current,\n'
    '    );\n'
    '    if (!selected) return null;\n',
    '  function findHandle(\n'
    '    clientX: number,\n'
    '    clientY: number,\n'
    '  ): { pointId: string; handle: "in" | "out" } | null {\n'
    '    const currentGarment = garmentRef.current;\n'
    '    const activePiece = currentGarment.pieces.find(\n'
    '      (piece) => piece.id === useEditorStore.getState().activePieceId,\n'
    '    );\n'
    '    if (!activePiece || getPieceWorkspaceState(currentGarment, activePiece.id).locked) return null;\n'
    '    const selected = activePiece.points.find(\n'
    '      (point) => point.id === selectedPointIdRef.current,\n'
    '    );\n'
    '    if (!selected) return null;\n',
    "remove snapshot handle hit target",
)
canvas = replace_once(
    canvas,
    '    const target = findNearestPatternSegment(\n'
    '      snapshotRef.current.piece,\n'
    '      world,\n'
    '    );\n',
    '    const activePiece = garmentRef.current.pieces.find(\n'
    '      (piece) => piece.id === useEditorStore.getState().activePieceId,\n'
    '    );\n'
    '    if (!activePiece) return false;\n'
    '    const target = findNearestPatternSegment(\n'
    '      activePiece,\n'
    '      world,\n'
    '    );\n',
    "remove snapshot insert target",
)
canvas = replace_once(
    canvas,
    '  function activePieceLocalBounds() {\n'
    '    return contourBounds(samplePatternContour(snapshotRef.current.piece.points));\n'
    '  }\n\n'
    '  function rotationHandleWorld() {\n'
    '    const bounds = activePieceLocalBounds();\n'
    '    return pieceLocalToWorld(\n',
    '  function activePieceLocalBounds() {\n'
    '    const activePiece = garmentRef.current.pieces.find(\n'
    '      (piece) => piece.id === useEditorStore.getState().activePieceId,\n'
    '    );\n'
    '    return activePiece\n'
    '      ? contourBounds(samplePatternContour(activePiece.points))\n'
    '      : null;\n'
    '  }\n\n'
    '  function rotationHandleWorld() {\n'
    '    const bounds = activePieceLocalBounds();\n'
    '    if (!bounds) return null;\n'
    '    return pieceLocalToWorld(\n',
    "remove snapshot rotation bounds",
)
canvas = replace_once(
    canvas,
    '    const handle = rotationHandleWorld();\n'
    '    return Math.hypot(world.xMm - handle.xMm, world.yMm - handle.yMm) <= 12 / cameraRef.current.zoom;\n',
    '    const handle = rotationHandleWorld();\n'
    '    if (!handle) return false;\n'
    '    return Math.hypot(world.xMm - handle.xMm, world.yMm - handle.yMm) <= 12 / cameraRef.current.zoom;\n',
    "guard missing rotation handle",
)
canvas = replace_once(
    canvas,
    '      const bounds = activePieceLocalBounds();\n'
    '      const center = pieceLocalToWorld({ xMm: (bounds.minX + bounds.maxX) / 2, yMm: (bounds.minY + bounds.maxY) / 2 }, transform);\n',
    '      const bounds = activePieceLocalBounds();\n'
    '      if (!bounds) return;\n'
    '      const center = pieceLocalToWorld({ xMm: (bounds.minX + bounds.maxX) / 2, yMm: (bounds.minY + bounds.maxY) / 2 }, transform);\n',
    "guard missing rotation bounds",
)
canvas = replace_once(
    canvas,
    '    const anchor = snapshotRef.current.piece.points.find(\n'
    '      (point) => point.id === drag.pointId,\n'
    '    );\n'
    '    if (!anchor) return;\n',
    '    const activePiece = garmentRef.current.pieces.find(\n'
    '      (piece) => piece.id === useEditorStore.getState().activePieceId,\n'
    '    );\n'
    '    const anchor = activePiece?.points.find(\n'
    '      (point) => point.id === drag.pointId,\n'
    '    );\n'
    '    if (!activePiece || !anchor) return;\n',
    "remove snapshot handle anchor",
)
canvas = replace_once(
    canvas,
    '    for (const other of snapshotRef.current.piece.points) {\n',
    '    for (const other of activePiece.points) {\n',
    "remove snapshot handle snapping",
)

canvas = replace_once(
    canvas,
    '    if (wheelFrameRef.current !== null) return;\n'
    '    wheelFrameRef.current = window.requestAnimationFrame(() => {\n'
    '      wheelFrameRef.current = null;\n'
    '      const pending = pendingWheelRef.current;\n'
    '      pendingWheelRef.current = null;\n'
    '      if (pending) updateCamera(applyWheelNavigation(cameraRef.current, pending.navigation, pending.cursor));\n'
    '    });\n',
    '    if (wheelFrameRef.current !== null) return;\n'
    '    canvas.dataset.pendingWheelRaf = "1";\n'
    '    wheelFrameRef.current = window.requestAnimationFrame(() => {\n'
    '      wheelFrameRef.current = null;\n'
    '      canvas.dataset.pendingWheelRaf = "0";\n'
    '      const pending = pendingWheelRef.current;\n'
    '      pendingWheelRef.current = null;\n'
    '      if (pending) updateCamera(applyWheelNavigation(cameraRef.current, pending.navigation, pending.cursor));\n'
    '    });\n',
    "instrument wheel RAF",
)

canvas = replace_once(
    canvas,
    'function draw(\n'
    '  context: CanvasRenderingContext2D,\n'
    '  width: number,\n'
    '  height: number,\n'
    '  snapshot: PatternSnapshot,\n',
    'function draw(\n'
    '  context: CanvasRenderingContext2D,\n'
    '  width: number,\n'
    '  height: number,\n',
    "remove snapshot draw argument",
)
canvas = replace_once(
    canvas,
    '  drawGrid(context, width, height, camera);\n\n'
    '  const activePiece = garment.pieces.find((piece) => piece.id === activePieceId);\n',
    '  drawGrid(context, width, height, camera);\n\n'
    '  if (garment.pieces.length === 0 && !draftContour) return;\n\n'
    '  const activePiece = garment.pieces.find((piece) => piece.id === activePieceId);\n',
    "empty canvas early return",
)
canvas = replace_once(
    canvas,
    '  if (snapOverlay) {\n',
    '  if (snapOverlay && activePiece) {\n',
    "guard snap overlay by document piece",
)

write(canvas_path, canvas)

app_path = "apps/web/src/App.tsx"
app = read(app_path)
app = regex_once(
    app,
    r'\n\s*snapshot=\{snapshot\}\n',
    '\n',
    "remove PatternCanvas snapshot prop",
)
write(app_path, app)

render_state = r'''import type {
  EdgeRange,
  GarmentDraft,
  Seam,
} from "../domain/pattern";

interface PieceDraftReference {
  pieceId: string;
}

export interface CanvasRenderAudit {
  pieceIds: string[];
  dimensionPieceIds: string[];
}

function canvasPieceIdSet(garment: GarmentDraft): Set<string> {
  return new Set(garment.pieces.map((piece) => piece.id));
}

export function validCanvasActivePieceId(
  garment: GarmentDraft,
  activePieceId: string,
): string {
  return garment.pieces.some((piece) => piece.id === activePieceId)
    ? activePieceId
    : "";
}

export function filterCanvasPieceIds(
  garment: GarmentDraft,
  pieceIds: readonly string[],
): string[] {
  const validIds = canvasPieceIdSet(garment);
  return [...new Set(pieceIds)].filter((pieceId) => validIds.has(pieceId));
}

export function filterCanvasSeams(
  garment: GarmentDraft,
  seams: readonly Seam[],
): Seam[] {
  const validIds = canvasPieceIdSet(garment);
  return seams.filter(
    (seam) =>
      validIds.has(seam.first.pieceId)
      && validIds.has(seam.second.pieceId),
  );
}

export function validCanvasEdgeRange(
  garment: GarmentDraft,
  range: EdgeRange | null,
): EdgeRange | null {
  return range && canvasPieceIdSet(garment).has(range.pieceId) ? range : null;
}

export function validCanvasPieceDraft<T extends PieceDraftReference>(
  garment: GarmentDraft,
  draft: T | null,
): T | null {
  return draft && canvasPieceIdSet(garment).has(draft.pieceId) ? draft : null;
}

export function createCanvasRenderAudit(
  garment: GarmentDraft,
  activePieceId: string,
  zoom: number,
): CanvasRenderAudit {
  const pieceIds = garment.pieces
    .filter((piece) => {
      const workspace = garment.workspaceStates?.find(
        (state) => state.pieceId === piece.id,
      );
      return workspace?.visible !== false;
    })
    .map((piece) => piece.id);
  const validActivePieceId = validCanvasActivePieceId(garment, activePieceId);
  const dimensionPieceIds =
    validActivePieceId
    && pieceIds.includes(validActivePieceId)
    && zoom >= 0.32
      ? [validActivePieceId]
      : [];
  return { pieceIds, dimensionPieceIds };
}
'''
write("apps/web/src/editor/canvasRenderState.ts", render_state)

render_state_test = r'''import { describe, expect, it } from "vitest";
import type { GarmentDraft, PatternPiece, Seam } from "../domain/pattern";
import {
  createCanvasRenderAudit,
  filterCanvasPieceIds,
  filterCanvasSeams,
  validCanvasActivePieceId,
  validCanvasEdgeRange,
  validCanvasPieceDraft,
} from "./canvasRenderState";

function piece(id: string): PatternPiece {
  return {
    id,
    name: id,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 100, yMm: 0 },
      { id: `${id}-c`, xMm: 100, yMm: 100 },
    ],
    seamAllowanceMm: 10,
  };
}

function garment(ids: string[]): GarmentDraft {
  return {
    id: "garment-test",
    name: "Teste",
    description: "",
    units: "mm",
    pieces: ids.map(piece),
    seams: [],
    workspaceTransforms: [],
    workspaceStates: ids.map((pieceId) => ({
      pieceId,
      transform: { pieceId, xMm: 0, yMm: 0, rotationDeg: 0 },
      visible: true,
      locked: false,
    })),
  } as GarmentDraft;
}

function seam(id: string, firstPieceId: string, secondPieceId: string): Seam {
  return {
    id,
    name: id,
    first: {
      pieceId: firstPieceId,
      edgeId: `${firstPieceId}-a:${firstPieceId}-b`,
      startT: 0,
      endT: 1,
    },
    second: {
      pieceId: secondPieceId,
      edgeId: `${secondPieceId}-a:${secondPieceId}-b`,
      startT: 0,
      endT: 1,
    },
  };
}

describe("canvas render state", () => {
  it("renders no geometry or dimensions for an empty document even with a stale active id", () => {
    expect(createCanvasRenderAudit(garment([]), "legacy-piece", 2)).toEqual({
      pieceIds: [],
      dimensionPieceIds: [],
    });
    expect(validCanvasActivePieceId(garment([]), "legacy-piece")).toBe("");
  });

  it("renders exactly the pieces that exist in the document", () => {
    expect(createCanvasRenderAudit(garment(["one"]), "one", 1)).toEqual({
      pieceIds: ["one"],
      dimensionPieceIds: ["one"],
    });
    expect(createCanvasRenderAudit(garment(["one", "two"]), "two", 1)).toEqual({
      pieceIds: ["one", "two"],
      dimensionPieceIds: ["two"],
    });
  });

  it("does not emit dimensions when the active id is absent or below the dimension zoom", () => {
    expect(createCanvasRenderAudit(garment(["one"]), "missing", 1).dimensionPieceIds).toEqual([]);
    expect(createCanvasRenderAudit(garment(["one"]), "one", 0.2).dimensionPieceIds).toEqual([]);
  });

  it("excludes hidden pieces from the render audit", () => {
    const draft = garment(["one", "two"]);
    draft.workspaceStates![1].visible = false;
    expect(createCanvasRenderAudit(draft, "two", 1)).toEqual({
      pieceIds: ["one"],
      dimensionPieceIds: [],
    });
  });

  it("filters selections, seams, edge ranges and drafts that reference absent piece ids", () => {
    const draft = garment(["one", "two"]);
    expect(filterCanvasPieceIds(draft, ["one", "ghost", "two", "one"])).toEqual(["one", "two"]);
    expect(filterCanvasSeams(draft, [
      seam("valid", "one", "two"),
      seam("ghost", "one", "ghost"),
    ]).map((item) => item.id)).toEqual(["valid"]);
    expect(validCanvasEdgeRange(draft, {
      pieceId: "ghost",
      edgeId: "ghost-edge",
      startT: 0,
      endT: 1,
    })).toBeNull();
    expect(validCanvasPieceDraft(draft, { pieceId: "ghost", phase: "placing" })).toBeNull();
  });
});
'''
write("apps/web/src/editor/canvasRenderState.test.ts", render_state_test)

deferred = r'''# Recovery 9.5 deferred gates

Recorded during `recovery/9.5-03-empty-workspace`. These items are deliberately
not corrected in this gate:

- camiseta, blusa, calça e jaqueta ainda estão tecnicamente incorretas;
- **Fechar pence** reduz a pence a uma linha reta;
- o manequim ainda é geométrico;
- a montagem 3D permanece desconectada.

This gate remains limited to eliminating non-document 2D geometry after zoom,
including stale snapshot, animation-frame, wheel and pinch paths.
'''
write("docs/progress/RECOVERY_9_5_DEFERRED_ISSUES.md", deferred)

visual = r'''import { cp, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-empty-workspace";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function canvasAudit(page, expectedPieces, label) {
  await settle(page);
  const audit = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas.pattern-canvas")];
    const canvas = canvases[0];
    if (!(canvas instanceof HTMLCanvasElement)) {
      return { canvasCount: canvases.length };
    }
    const parseIds = (value) => value ? value.split(",").filter(Boolean) : [];
    return {
      canvasCount: canvases.length,
      renderedPieceIds: parseIds(canvas.dataset.renderedPieceIds),
      renderedPieceCount: Number(canvas.dataset.renderedPieceCount ?? "-1"),
      dimensionPieceIds: parseIds(canvas.dataset.renderedDimensionPieceIds),
      geometryCount: Number(canvas.dataset.renderedGeometryCount ?? "-1"),
      activeDocumentPieceId: canvas.dataset.activeDocumentPieceId ?? "",
      wheelListenerCount: Number(canvas.dataset.wheelListenerCount ?? "-1"),
      pendingDrawRaf: Number(canvas.dataset.pendingDrawRaf ?? "-1"),
      pendingWheelRaf: Number(canvas.dataset.pendingWheelRaf ?? "-1"),
      panelPieceCount: document.querySelectorAll(".pieces-item").length,
      documentPieceIds: [...document.querySelectorAll(".pieces-item")].map(
        (item) => item.querySelector(".pieces-name span")?.textContent?.trim() ?? "",
      ),
      emptyVisible: Boolean(document.querySelector(".empty-workspace")),
    };
  });
  if (audit.canvasCount !== 1) throw new Error(`${label}: canvas duplicado ou ausente: ${JSON.stringify(audit)}`);
  if (audit.renderedPieceCount !== expectedPieces || audit.renderedPieceIds?.length !== expectedPieces) {
    throw new Error(`${label}: contagem renderizada inválida: ${JSON.stringify(audit)}`);
  }
  if (audit.panelPieceCount !== expectedPieces) {
    throw new Error(`${label}: painel e render divergiram: ${JSON.stringify(audit)}`);
  }
  if (audit.wheelListenerCount !== 1 || audit.pendingDrawRaf !== 0 || audit.pendingWheelRaf !== 0) {
    throw new Error(`${label}: listener ou RAF duplicado/pendente: ${JSON.stringify(audit)}`);
  }
  const renderedIds = new Set(audit.renderedPieceIds ?? []);
  for (const dimensionPieceId of audit.dimensionPieceIds ?? []) {
    if (!renderedIds.has(dimensionPieceId)) {
      throw new Error(`${label}: dimensão de ID ausente: ${JSON.stringify(audit)}`);
    }
  }
  if (expectedPieces === 0) {
    if (audit.geometryCount !== 0 || audit.dimensionPieceIds?.length !== 0 || audit.activeDocumentPieceId !== "" || !audit.emptyVisible) {
      throw new Error(`${label}: bancada vazia contém geometria fantasma: ${JSON.stringify(audit)}`);
    }
  }
  return audit;
}

async function zoomControls(page, canvas, expectedPieces, prefix) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  const plus = await canvasAudit(page, expectedPieces, `${prefix}: controle +`);
  await page.getByRole("button", { name: "Diminuir zoom" }).click();
  const minus = await canvasAudit(page, expectedPieces, `${prefix}: controle -`);

  const box = await canvas.boundingBox();
  if (!box) throw new Error(`${prefix}: canvas sem bounding box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -260);
  const wheelIn = await canvasAudit(page, expectedPieces, `${prefix}: roda zoom in`);
  await page.mouse.wheel(0, 260);
  const wheelOut = await canvasAudit(page, expectedPieces, `${prefix}: roda zoom out`);
  return { plus, minus, wheelIn, wheelOut };
}

async function pinch(page, context, canvas, expectedPieces, prefix) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error(`${prefix}: canvas sem bounding box para pinch`);
  const client = await context.newCDPSession(page);
  const y = box.y + Math.min(box.height * 0.45, 220);
  const left = box.x + box.width * 0.40;
  const right = box.x + box.width * 0.60;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: left, y, radiusX: 2, radiusY: 2, force: 1, id: 1 },
      { x: right, y, radiusX: 2, radiusY: 2, force: 1, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: left - 35, y, radiusX: 2, radiusY: 2, force: 1, id: 1 },
      { x: right + 35, y, radiusX: 2, radiusY: 2, force: 1, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return canvasAudit(page, expectedPieces, `${prefix}: pinch mobile`);
}

async function drawFirstPiece(page, canvas) {
  await page.getByRole("button", { name: "Desenhar primeira peça" }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas não encontrado");
  const left = Math.max(40, Math.min(box.width - 180, box.width * 0.25));
  const right = Math.max(left + 130, Math.min(box.width - 35, box.width * 0.70));
  const top = Math.max(80, Math.min(box.height - 190, box.height * 0.25));
  const bottom = Math.max(top + 130, Math.min(box.height - 45, box.height * 0.68));
  await canvas.click({ position: { x: left, y: top } });
  await canvas.click({ position: { x: right, y: top } });
  await canvas.click({ position: { x: right - 25, y: bottom } });
  await canvas.click({ position: { x: left, y: bottom - 20 } });
  await page.keyboard.press("Enter");
  await page.locator(".pieces-item").filter({ hasText: "Peça teste" }).first().waitFor({ state: "visible" });
}

const report = [];
try {
  for (const scenario of [
    { name: "desktop", viewport: { width: 1366, height: 768 }, mobile: false },
    { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      hasTouch: scenario.mobile,
      isMobile: scenario.mobile,
    });
    const page = await context.newPage();
    const errors = [];
    const steps = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") await dialog.accept("Peça teste");
      else await dialog.accept();
    });

    await page.goto(baseURL, { waitUntil: "networkidle" });
    const canvas = page.locator("canvas.pattern-canvas");
    await canvas.waitFor({ state: "visible" });
    steps.push({ step: "carregar aplicação", result: "ok" });

    await page.getByRole("button", { name: "Moldes" }).click();
    await page.getByRole("button", { name: /Bancada vazia/ }).click();
    await page.getByRole("button", { name: "Criar bancada vazia" }).click();
    await page.locator(".empty-workspace").waitFor({ state: "visible" });
    steps.push({
      step: "iniciar bancada vazia",
      result: "ok",
      evidence: await canvasAudit(page, 0, `${scenario.name}: vazio inicial`),
    });

    await page.getByRole("button", { name: "Moldes" }).click();
    await page.getByRole("button", { name: "Fechar biblioteca" }).click();
    steps.push({
      step: "abrir e fechar biblioteca antes do zoom",
      result: "ok",
      evidence: await canvasAudit(page, 0, `${scenario.name}: biblioteca fechada`),
    });

    steps.push({
      step: "zoom vazio por controles e roda",
      result: "ok",
      evidence: await zoomControls(page, canvas, 0, `${scenario.name}: vazio`),
    });
    if (scenario.mobile) {
      steps.push({
        step: "pinch vazio no mobile",
        result: "ok",
        evidence: await pinch(page, context, canvas, 0, `${scenario.name}: vazio`),
      });
    }
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-empty-after-zoom.png`, fullPage: true });

    await drawFirstPiece(page, canvas);
    steps.push({
      step: "criar uma peça e renderizar uma única geometria",
      result: "ok",
      evidence: await canvasAudit(page, 1, `${scenario.name}: uma peça`),
    });
    steps.push({
      step: "zoom com uma peça",
      result: "ok",
      evidence: await zoomControls(page, canvas, 1, `${scenario.name}: uma peça`),
    });
    if (scenario.mobile) {
      await pinch(page, context, canvas, 1, `${scenario.name}: uma peça`);
    }

    await page.getByRole("button", { name: "Mais ações para Peça teste" }).click();
    await page.getByRole("menuitem", { name: "Duplicar", exact: true }).click();
    await page.locator(".pieces-item").nth(1).waitFor({ state: "visible" });
    steps.push({
      step: "criar duas peças e renderizar somente duas",
      result: "ok",
      evidence: await canvasAudit(page, 2, `${scenario.name}: duas peças`),
    });
    await zoomControls(page, canvas, 2, `${scenario.name}: duas peças`);

    await page.locator(".pieces-item .pieces-more").nth(1).click();
    await page.getByRole("menuitem", { name: "Excluir" }).click();
    await canvasAudit(page, 1, `${scenario.name}: remover duplicata`);

    await page.getByRole("button", { name: "Mais ações para Peça teste" }).click();
    await page.getByRole("menuitem", { name: "Excluir" }).click();
    await page.locator(".empty-workspace").waitFor({ state: "visible" });
    steps.push({
      step: "excluir todas as peças e aplicar zoom",
      result: "ok",
      evidence: await zoomControls(page, canvas, 0, `${scenario.name}: após excluir todas`),
    });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-deleted-after-zoom.png`, fullPage: true });

    await page.keyboard.press("Control+z");
    await page.locator(".pieces-item").waitFor({ state: "visible" });
    steps.push({
      step: "desfazer, aplicar zoom e manter uma peça",
      result: "ok",
      evidence: await zoomControls(page, canvas, 1, `${scenario.name}: undo`),
    });

    await page.keyboard.press("Control+y");
    await page.locator(".empty-workspace").waitFor({ state: "visible" });
    steps.push({
      step: "refazer, aplicar zoom e manter zero peças",
      result: "ok",
      evidence: await zoomControls(page, canvas, 0, `${scenario.name}: redo`),
    });
    if (scenario.mobile) {
      await pinch(page, context, canvas, 0, `${scenario.name}: redo`);
    }
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-redo-after-zoom.png`, fullPage: true });

    if (errors.length) throw new Error(`${scenario.name}: erros no navegador: ${errors.join(" | ")}`);
    steps.push({ step: "canvas único, listener único, RAFs zerados e dimensões válidas", result: "ok" });
    steps.push({ step: "console e page errors", result: "ok", errors: [] });
    report.push({ scenario: scenario.name, viewport: scenario.viewport, steps });
    await context.close();
  }
} finally {
  await browser.close();
}

await cp("apps/web/dist", `${artifactDir}/dist`, { recursive: true });
console.log(JSON.stringify(report, null, 2));
'''
write("scripts/recovery-empty-workspace-visual.mjs", visual)

print("Applied recovery ghost-geometry fix.")
