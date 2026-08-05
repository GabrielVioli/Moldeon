from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    path.write_text(source.replace(old, new), encoding="utf-8")


def replace_regex_once(path: Path, pattern: str, replacement: str, flags: int = 0) -> None:
    source = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{path}: regex expected one occurrence, found {count}: {pattern[:100]!r}")
    path.write_text(updated, encoding="utf-8")


canvas = ROOT / "apps/web/src/editor/PatternCanvas.tsx"
app = ROOT / "apps/web/src/App.tsx"
viewport = ROOT / "apps/web/src/viewport/GarmentViewport.tsx"
styles = ROOT / "apps/web/src/styles.css"

replace_once(canvas, 'import { buildAssemblyGraph } from "../domain/assembly";\n', '')
replace_once(
    canvas,
    '  createGestureOrigin,\n  finishGesture,\n  shouldInsertPointFromTap,\n  shouldStartBoxSelection,\n  type GestureOrigin,\n',
    '  claimGesture,\n  createGestureOrigin,\n  finishGesture,\n  isInteractiveGestureOwner,\n  shouldInsertPointFromTap,\n  shouldStartBoxSelection,\n  shouldStartDrag,\n  type GestureOrigin,\n  type GestureOwnership,\n',
)
replace_once(
    canvas,
    '} from "./camera";\n',
    '} from "./camera";\nimport { applyWheelNavigation, mergeWheelNavigation, normalizeWheelNavigation, type NormalizedWheelNavigation } from "./canvasWheelNavigation";\n',
)
replace_once(
    canvas,
    '  const pointTapRef = useRef<GestureOrigin | null>(null);\n',
    '  const pointTapRef = useRef<GestureOrigin | null>(null);\n  const gestureOwnershipRef = useRef<GestureOwnership | null>(null);\n  const dragOriginRef = useRef<GestureOrigin | null>(null);\n  const dragStartedRef = useRef(false);\n  const wheelFrameRef = useRef<number | null>(null);\n  const pendingWheelRef = useRef<{ navigation: NormalizedWheelNavigation; cursor: ScreenPoint } | null>(null);\n',
)
replace_once(
    canvas,
    '      if (workspaceFrameRef.current !== null) {\n        window.cancelAnimationFrame(workspaceFrameRef.current);\n        workspaceFrameRef.current = null;\n      }\n',
    '      if (workspaceFrameRef.current !== null) {\n        window.cancelAnimationFrame(workspaceFrameRef.current);\n        workspaceFrameRef.current = null;\n      }\n      if (wheelFrameRef.current !== null) {\n        window.cancelAnimationFrame(wheelFrameRef.current);\n        wheelFrameRef.current = null;\n      }\n',
)
replace_once(
    canvas,
    '  function updateCamera(nextCamera: Camera2D) {\n',
    '  function ownGesture(pointerId: number, owner: GestureOwnership["owner"]) {\n    gestureOwnershipRef.current = claimGesture(gestureOwnershipRef.current, pointerId, owner);\n  }\n\n  function updateCamera(nextCamera: Camera2D) {\n',
)
replace_regex_once(
    canvas,
    r'  function piecesMovingWith\(pieceId: string\): string\[\] \{.*?\n  \}\n\n  function isRotationHandleAt',
    '''  function piecesMovingWith(pieceId: string): string[] {
    const state = useEditorStore.getState();
    if (!state.selectedPieceIds.includes(pieceId) || state.selectedPieceIds.length <= 1) {
      return [pieceId];
    }
    return state.selectedPieceIds.filter((id) => {
      const workspace = getPieceWorkspaceState(state.garment, id);
      return workspace.visible && !workspace.locked;
    });
  }

  function isRotationHandleAt''',
    flags=re.S,
)

# Internal path hits explicitly own their gesture before any later background logic can run.
source = canvas.read_text(encoding="utf-8")
start = source.index('  function handleInternalPathPointerDown')
end = source.index('  function insertPointNear', start)
block = source[start:end]
block = block.replace('      return true;', '      ownGesture(event.pointerId, "internal-path");\n      return true;')
block = block.replace('      scheduleDraw();\n      return true;', '      scheduleDraw();\n      ownGesture(event.pointerId, "internal-path");\n      return true;')
source = source[:start] + block + source[end:]
canvas.write_text(source, encoding="utf-8")

replace_once(
    canvas,
    '  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {\n    event.currentTarget.focus({ preventScroll: true });\n    event.currentTarget.setPointerCapture(event.pointerId);\n',
    '  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {\n    event.stopPropagation();\n    event.currentTarget.focus({ preventScroll: true });\n    event.currentTarget.setPointerCapture(event.pointerId);\n    gestureOwnershipRef.current = null;\n    ownGesture(event.pointerId, "empty");\n    dragOriginRef.current = createGestureOrigin(event.pointerId, event.pointerType, event.clientX, event.clientY);\n    dragStartedRef.current = false;\n',
)
# Remove duplicate internal path dispatch introduced during Prompt 4.
replace_once(
    canvas,
    '      if (handleInternalPathPointerDown(event)) return;\n\n      if (handleInternalPathPointerDown(event)) return;\n',
    '      if (handleInternalPathPointerDown(event)) return;\n',
)
# Mark immediate hand/middle pans as already started.
replace_once(
    canvas,
    '        dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);\n        setIsPanning(true);\n',
    '        dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);\n        dragStartedRef.current = true;\n        setIsPanning(true);\n',
)
replace_once(
    canvas,
    '      dragRef.current = createPanDrag(\n        event.pointerId,\n        event.clientX,\n        event.clientY,\n      );\n      setIsPanning(true);\n',
    '      dragRef.current = createPanDrag(\n        event.pointerId,\n        event.clientX,\n        event.clientY,\n      );\n      dragStartedRef.current = true;\n      setIsPanning(true);\n',
)
# Explicit owner markers for the principal interactive targets.
source = canvas.read_text(encoding="utf-8")
source = source.replace('        dragRef.current = {\n          type: "handle",', '        ownGesture(event.pointerId, "handle");\n        dragRef.current = {\n          type: "handle",')
source = source.replace('      dragRef.current = {\n        type: "handle",', '      ownGesture(event.pointerId, "handle");\n      dragRef.current = {\n        type: "handle",')
source = source.replace('        dragRef.current = { type: "point",', '        ownGesture(event.pointerId, "point");\n        dragRef.current = { type: "point",')
source = source.replace('      dragRef.current = {\n        type: "point",', '      ownGesture(event.pointerId, "point");\n      dragRef.current = {\n        type: "point",')
source = source.replace('          dragRef.current = { type: "segment",', '          ownGesture(event.pointerId, "segment");\n          dragRef.current = { type: "segment",')
source = source.replace('        dragRef.current = { type: "segment",', '        ownGesture(event.pointerId, "segment");\n        dragRef.current = { type: "segment",')
source = source.replace('      dragRef.current = {\n        type: "rotate",', '      ownGesture(event.pointerId, "rotation");\n      dragRef.current = {\n        type: "rotate",')
source = source.replace('        touchPieceCandidateRef.current = {', '        ownGesture(event.pointerId, "piece");\n        touchPieceCandidateRef.current = {')
source = source.replace('      onEditStartRef.current("Mover peça");\n      dragRef.current = {\n        type: "piece",', '      onEditStartRef.current("Mover peça");\n      ownGesture(event.pointerId, "piece");\n      dragRef.current = {\n        type: "piece",')
canvas.write_text(source, encoding="utf-8")

# Plain primary drag on empty space pans. Shift + drag keeps box selection.
replace_once(
    canvas,
    '    if (toolRef.current === "select") {\n      const rect = event.currentTarget.getBoundingClientRect();\n      const x = event.clientX - rect.left; const y = event.clientY - rect.top;\n      dragRef.current = { type: "box", pointerId: event.pointerId, startX: x, startY: y, currentX: x, currentY: y, additive: event.shiftKey };\n      scheduleDraw();\n    } else clearSelection();\n',
    '    if (toolRef.current === "select" && event.shiftKey) {\n      const rect = event.currentTarget.getBoundingClientRect();\n      const x = event.clientX - rect.left; const y = event.clientY - rect.top;\n      ownGesture(event.pointerId, "box");\n      dragRef.current = { type: "box", pointerId: event.pointerId, startX: x, startY: y, currentX: x, currentY: y, additive: true };\n    } else if (toolRef.current === "select") {\n      dragRef.current = createPanDrag(event.pointerId, event.clientX, event.clientY);\n    } else clearSelection();\n',
)
# Gesture-specific thresholds are applied before any mutation or camera movement.
replace_once(
    canvas,
    '    if (drag.pointerId !== event.pointerId) return;\n\n    if (drag.type === "pan") {\n',
    '    if (drag.pointerId !== event.pointerId) return;\n\n    const thresholdIntent = drag.type === "piece" ? "piece" : drag.type === "point" ? "point" : drag.type === "handle" ? "handle" : drag.type === "pan" ? "pan" : drag.type === "box" ? "box" : null;\n    if (!dragStartedRef.current && thresholdIntent && dragOriginRef.current) {\n      if (!shouldStartDrag(dragOriginRef.current, event.clientX, event.clientY, thresholdIntent)) return;\n      dragStartedRef.current = true;\n      if (drag.type === "pan") setIsPanning(true);\n    }\n\n    if (drag.type === "pan") {\n',
)
# Touch piece candidate has already crossed its touch threshold when promoted.
replace_once(
    canvas,
    '      dragRef.current = {\n        type: "piece",\n        pointerId: event.pointerId,\n        pieceId: touchCandidate.pieceId,\n',
    '      dragStartedRef.current = true;\n      dragRef.current = {\n        type: "piece",\n        pointerId: event.pointerId,\n        pieceId: touchCandidate.pieceId,\n',
)
# Wheel navigation: data-based trackpad pan, discrete wheel zoom, rAF batching and owner guard.
replace_regex_once(
    canvas,
    r'  function handleWheel\(event: WheelEvent<HTMLCanvasElement>\) \{.*?\n  \}\n\n  function handleDoubleClick',
    '''  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {
    const owner = gestureOwnershipRef.current?.owner ?? "empty";
    if (isInteractiveGestureOwner(owner)) {
      event.preventDefault();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
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

  function handleDoubleClick''',
    flags=re.S,
)
# createPanDrag itself claims pan ownership.
replace_once(
    canvas,
    '  function createPanDrag(\n    pointerId: number,\n    clientX: number,\n    clientY: number,\n  ) {\n    return {\n',
    '  function createPanDrag(\n    pointerId: number,\n    clientX: number,\n    clientY: number,\n  ) {\n    ownGesture(pointerId, "pan");\n    return {\n',
)
replace_once(
    canvas,
    '    touchPieceCandidateRef.current = null;\n    const canvas = canvasRef.current;\n',
    '    touchPieceCandidateRef.current = null;\n    const canvas = canvasRef.current;\n',
)
replace_once(
    canvas,
    '    dragRef.current = {\n      type: "pinch",\n',
    '    gestureOwnershipRef.current = { pointerId: firstId, owner: "pinch" };\n    dragStartedRef.current = true;\n    dragRef.current = {\n      type: "pinch",\n',
)
# A click on genuinely empty space clears selection; only started drags commit history.
replace_once(
    canvas,
    '    if (\n      finishedDrag?.type === "piece" &&\n      finishedDrag.pointerId === event.pointerId\n    ) {\n',
    '    if (\n      finishedDrag?.type === "piece" &&\n      finishedDrag.pointerId === event.pointerId &&\n      dragStartedRef.current\n    ) {\n',
)
replace_once(
    canvas,
    '    if (finishedDrag?.type === "pan") setIsPanning(false);\n',
    '    if (finishedDrag?.type === "pan") {\n      if (!dragStartedRef.current && toolRef.current === "select") {\n        clearSelection();\n        useEditorStore.getState().selectDart(null);\n      }\n      setIsPanning(false);\n    }\n',
)
replace_once(
    canvas,
    '    snapRef.current = null;\n    scheduleDraw();\n    dragRef.current = null;\n',
    '    snapRef.current = null;\n    scheduleDraw();\n    dragRef.current = null;\n    dragOriginRef.current = null;\n    dragStartedRef.current = false;\n    if (gestureOwnershipRef.current?.pointerId === event.pointerId) gestureOwnershipRef.current = null;\n',
)
# Existing box test now uses the pointer-specific threshold.
replace_once(
    canvas,
    '      if (!shouldStartBoxSelection(moved)) {',
    '      if (!shouldStartBoxSelection(moved, dragOriginRef.current?.pointerType ?? "mouse")) {',
)

# App: one explicit source of truth for the right panel.
replace_once(
    app,
    '  const [previewRequested, setPreviewRequested] = useState(false);\n',
    '  const [previewRequested, setPreviewRequested] = useState(false);\n  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);\n',
)
replace_once(
    app,
    '  const handleSimulate = useCallback(() => {\n    setWorkspaceMode("assembly");\n    setPreviewRequested(true);\n',
    '  const handleSimulate = useCallback(() => {\n    setWorkspaceMode("assembly");\n    setPreviewRequested(true);\n    setIsRightPanelOpen(true);\n',
)
replace_once(
    app,
    '  const handleDressBody = useCallback(() => {\n    setWorkspaceMode("fitting");\n    setPreviewRequested(true);\n',
    '  const handleDressBody = useCallback(() => {\n    setWorkspaceMode("fitting");\n    setPreviewRequested(true);\n    setIsRightPanelOpen(true);\n',
)
replace_once(
    app,
    '  const handleExportSvg = useCallback(() => {\n',
    '  const closeRightPanel = useCallback(() => {\n    setIsRightPanelOpen(false);\n    if (isMobile) setMobileView("editor");\n  }, [isMobile]);\n  const openRightPanel = useCallback((view: WorkspaceView = "preview") => {\n    setIsRightPanelOpen(true);\n    if (isMobile) setMobileView(view);\n  }, [isMobile]);\n  const handleExportSvg = useCallback(() => {\n',
)
replace_once(
    app,
    '      <main className={`workspace mode-${workspaceMode}`}>\n',
    '      <main className={`workspace mode-${workspaceMode}${isRightPanelOpen ? "" : " is-right-panel-closed"}`}>\n',
)
# Tabs reopen the panel instead of only changing the mobile view.
replace_once(
    app,
    '              if (eligibility.canPreviewGarment) setPreviewRequested(true);\n              setMobileView("preview");\n',
    '              if (eligibility.canPreviewGarment) setPreviewRequested(true);\n              openRightPanel("preview");\n',
)
replace_once(
    app,
    '            onSelect={() => setMobileView("inspector")}\n',
    '            onSelect={() => openRightPanel("inspector")}\n',
)
# Titlebar toggle and updated navigation hint.
replace_once(
    app,
    '            <span className="hint desktop-hint">Shift + arrastar: mover tela · roda: zoom</span>\n            <span className="hint mobile-hint">Arraste pontos · fundo move · pinça aproxima</span>\n',
    '            <div className="panel-title-actions">\n              <span className="hint desktop-hint">Fundo: pan · Shift + arrastar: selecionar · roda/trackpad: navegar</span>\n              <span className="hint mobile-hint">Arraste pontos · fundo move · pinça aproxima</span>\n              <button\n                type="button"\n                className="right-panel-toggle"\n                aria-expanded={isRightPanelOpen}\n                aria-controls="workspace-right-panel"\n                title={isRightPanelOpen ? "Recolher painel direito" : "Mostrar painel direito"}\n                onClick={() => isRightPanelOpen ? closeRightPanel() : openRightPanel("preview")}\n              >\n                <span aria-hidden="true">{isRightPanelOpen ? "›" : "‹"}</span>\n                <span>{isRightPanelOpen ? "Recolher painel" : "Mostrar painel"}</span>\n              </button>\n            </div>\n',
)
# Wrap all right-side content without changing its grid participation.
replace_once(
    app,
    '        <section\n          className={`preview-panel workspace-view${mobileView === "preview" ? " is-mobile-active" : ""}`}\n',
    '        <div id="workspace-right-panel" className="workspace-right-panel" hidden={!isRightPanelOpen} aria-hidden={!isRightPanelOpen}>\n        <section\n          className={`preview-panel workspace-view${mobileView === "preview" ? " is-mobile-active" : ""}`}\n',
)
replace_once(
    app,
    '          aria-labelledby="preview-tab"\n        >\n          {showViewport ? (\n',
    '          aria-labelledby="preview-tab"\n        >\n          <button\n            type="button"\n            className="right-panel-close"\n            aria-expanded={isRightPanelOpen}\n            aria-controls="workspace-right-panel"\n            title={isMobile ? "Voltar à bancada 2D" : "Recolher painel direito"}\n            onClick={closeRightPanel}\n          >\n            <span aria-hidden="true">×</span>\n            <span>{isMobile ? "Voltar à bancada" : "Recolher"}</span>\n          </button>\n          {showViewport ? (\n',
)
replace_once(
    app,
    '                active={!isMobile || mobileView === "preview"}\n',
    '                active={isRightPanelOpen && (!isMobile || mobileView === "preview")}\n',
)
replace_once(
    app,
    '        /> : workspaceMode === "fitting" ? <PreviewPlacementPanel /> : <Inspector\n',
    '        /> : workspaceMode === "fitting" ? <PreviewPlacementPanel /> : <Inspector\n',
)
# Close wrapper after the contextual panel expression.
replace_once(
    app,
    '          onSeamAllowanceChange={setSeamAllowance}\n        />}\n      </main>\n',
    '          onSeamAllowanceChange={setSeamAllowance}\n        />}\n        </div>\n      </main>\n',
)

# Viewport: an active toggle alone must not rebuild the garment or reset the camera.
replace_once(
    viewport,
    '  const lastDressedVersionRef = useRef(0);\n',
    '  const lastDressedVersionRef = useRef(0);\n  const lastAppliedGarmentRef = useRef<GarmentDraft | null>(null);\n  const lastAppliedSnapshotsRef = useRef<PatternSnapshot[] | null>(null);\n  const lastAppliedShowBodyRef = useRef<boolean | null>(null);\n',
)
replace_once(
    viewport,
    '          setWarnings(\n            viewport.updateGarment(\n              latestSnapshotsRef.current,\n              latestGarmentRef.current,\n            ),\n          );\n',
    '          setWarnings(\n            viewport.updateGarment(\n              latestSnapshotsRef.current,\n              latestGarmentRef.current,\n            ),\n          );\n          lastAppliedGarmentRef.current = latestGarmentRef.current;\n          lastAppliedSnapshotsRef.current = latestSnapshotsRef.current;\n          lastAppliedShowBodyRef.current = latestShowBodyRef.current;\n',
)
replace_once(
    viewport,
    '  useEffect(() => {\n    if (!active || updateFrameRef.current !== null) return;\n\n    updateFrameRef.current = window.requestAnimationFrame(() => {\n',
    '  useEffect(() => {\n    if (!active || updateFrameRef.current !== null) return;\n    if (lastAppliedGarmentRef.current === garment && lastAppliedSnapshotsRef.current === snapshots && lastAppliedShowBodyRef.current === showBody) return;\n\n    updateFrameRef.current = window.requestAnimationFrame(() => {\n',
)
replace_once(
    viewport,
    '      setWarnings(\n        viewport.updateGarment(\n          latestSnapshotsRef.current,\n          latestGarmentRef.current,\n        ),\n      );\n',
    '      setWarnings(\n        viewport.updateGarment(\n          latestSnapshotsRef.current,\n          latestGarmentRef.current,\n        ),\n      );\n      lastAppliedGarmentRef.current = latestGarmentRef.current;\n      lastAppliedSnapshotsRef.current = latestSnapshotsRef.current;\n      lastAppliedShowBodyRef.current = latestShowBodyRef.current;\n',
)

# Layout and accessibility styling. Appended as a single scoped block to avoid duplicate sources of truth.
css_block = r'''

/* Post Prompt 04: explicit gesture and right-panel ownership */
.workspace-right-panel { display: contents; }
.workspace-right-panel[hidden] { display: none !important; }
.preview-panel { position: relative; }
.panel-title-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; }
.right-panel-toggle,
.right-panel-close {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid #bdb8ae;
  border-radius: 7px;
  color: #4f514d;
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 10px;
  font-weight: 800;
}
.right-panel-toggle { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.right-panel-toggle > span:first-child { font-size: 20px; line-height: 1; }
.right-panel-close { position: absolute; z-index: 14; top: 10px; right: 10px; display: inline-flex; align-items: center; gap: 6px; }
.right-panel-close > span:first-child { font-size: 18px; line-height: 1; }
.right-panel-toggle:hover,
.right-panel-close:hover { background: #fff; border-color: #77746d; }
.right-panel-toggle:focus-visible,
.right-panel-close:focus-visible { outline: 3px solid #9a6b16; outline-offset: 2px; }
.preview-panel .viewport-inspection { top: 52px; }
.workspace.is-right-panel-closed.mode-modeling,
.workspace.is-right-panel-closed.mode-assembly,
.workspace.is-right-panel-closed.mode-fitting,
.workspace.is-right-panel-closed.mode-preparation {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.workspace.is-right-panel-closed .editor-panel {
  grid-column: 1;
  grid-row: 1;
}

@media (max-width: 760px) {
  .panel-title-actions { gap: 5px; }
  .right-panel-toggle { min-width: 38px; padding: 0 7px; }
  .right-panel-toggle > span:last-child { display: none; }
  .right-panel-close {
    top: calc(8px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
    min-height: 40px;
    padding: 0 12px;
    background: rgba(255, 255, 255, 0.96);
  }
  .preview-panel .viewport-inspection { top: calc(58px + env(safe-area-inset-top)); }
  .workspace.is-right-panel-closed.mode-modeling,
  .workspace.is-right-panel-closed.mode-assembly,
  .workspace.is-right-panel-closed.mode-fitting,
  .workspace.is-right-panel-closed.mode-preparation {
    grid-template-rows: 44px minmax(0, 1fr);
  }
  .workspace.is-right-panel-closed .editor-panel {
    grid-row: 2;
    visibility: visible;
    pointer-events: auto;
  }
}
'''
source = styles.read_text(encoding="utf-8")
if '/* Post Prompt 04: explicit gesture and right-panel ownership */' in source:
    raise SystemExit("styles.css: UI regression block already exists")
styles.write_text(source + css_block, encoding="utf-8")

print("UI regression source patch applied")
