from pathlib import Path


def replace_required(source, before, after, label, count=1):
    actual = source.count(before)
    if actual != count:
        raise SystemExit(f"{label}: expected {count}, found {actual}")
    return source.replace(before, after)

path = Path('apps/web/src/editor/PatternCanvas.tsx')
source = path.read_text()
source = replace_required(source,
'''  type PieceWorkspaceTransform,
} from "../domain/pattern";''',
'''  type PieceWorkspaceTransform,
  isInternalPath,
  type InternalPath,
  type InternalPathNode,
} from "../domain/pattern";''', 'pattern imports')
source = replace_required(source,
'''import { sampleInternalPath } from "../domain/internalPaths";
import { useEditorStore } from "../state/editorStore";''',
'''import { findNearestInternalPathSegment, sampleInternalPath } from "../domain/internalPaths";
import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";''', 'internal path imports')
source = replace_required(source,
'''    | PieceDragState
    | { type: "segment"; pointerId: number; edgeId: string; lastWorldX: number; lastWorldY: number }''',
'''    | PieceDragState
    | { type: "internal-node"; pointerId: number; nodeId: string }
    | { type: "internal-handle"; pointerId: number; nodeId: string; handle: "in" | "out" }
    | { type: "segment"; pointerId: number; edgeId: string; lastWorldX: number; lastWorldY: number }''', 'drag types')
source = replace_required(source,
'''  const measureDraft = useEditorStore((s) => s.measureDraft);
  const garmentRef = useRef(garment);''',
'''  const measureDraft = useEditorStore((s) => s.measureDraft);
  const selectedInternalPathId = useInternalPathEditorStore((s) => s.selectedPathId);
  const selectedInternalPathNodeId = useInternalPathEditorStore((s) => s.selectedNodeId);
  const draftInternalPathId = useInternalPathEditorStore((s) => s.draftPathId);
  const internalPathAnalysis = useInternalPathEditorStore((s) => s.analysis);
  const garmentRef = useRef(garment);''', 'path selectors')
source = replace_required(source,
'''  }, [activePieceId, cutDraft, dartDraft, draftContour, draftCursor, garment, garmentSeams, hoveredDimension, measureDraft, pieceSelectionActive, rotationFeedback, seamFirstEdge, selectedDartId, selectedEdgeId, selectedPieceIds, selectedSeamId]);''',
'''  }, [activePieceId, cutDraft, dartDraft, draftContour, draftCursor, garment, garmentSeams, hoveredDimension, internalPathAnalysis, measureDraft, pieceSelectionActive, rotationFeedback, seamFirstEdge, selectedDartId, selectedEdgeId, selectedInternalPathId, selectedInternalPathNodeId, selectedPieceIds, selectedSeamId, draftInternalPathId]);''', 'draw dependencies')

marker = '''  function insertPointNear(clientX: number, clientY: number): boolean {'''
helpers = '''  function internalPathsForActivePiece(): InternalPath[] {
    const piece = garmentRef.current.pieces.find((candidate) => candidate.id === activePieceId);
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

  function findInternalPathHandleAt(clientX: number, clientY: number): { path: InternalPath; node: InternalPathNode; handle: "in" | "out" } | null {
    const state = useInternalPathEditorStore.getState();
    const path = internalPathsForActivePiece().find((candidate) => candidate.id === state.selectedPathId);
    const node = path?.nodes.find((candidate) => candidate.id === state.selectedNodeId);
    if (!path || !node || path.locked) return null;
    const local = screenToActivePieceLocal(clientX, clientY);
    const threshold = (POINT_RADIUS_PX + 6) / cameraRef.current.zoom;
    for (const handle of ["in", "out"] as const) {
      const vector = handle === "in" ? node.handleIn : node.handleOut;
      if (vector && Math.hypot(node.xMm + vector.xMm - local.xMm, node.yMm + vector.yMm - local.yMm) <= threshold) {
        return { path, node, handle };
      }
    }
    return null;
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
    const session = useInternalPathEditorStore.getState();
    const handleHit = findInternalPathHandleAt(event.clientX, event.clientY);
    if (handleHit) {
      session.selectPath(handleHit.path.id);
      session.selectNode(handleHit.node.id);
      session.beginGeometryEdit("Ajustar curva interna");
      dragRef.current = { type: "internal-handle", pointerId: event.pointerId, nodeId: handleHit.node.id, handle: handleHit.handle };
      return true;
    }
    const nodeHit = findInternalPathNodeAt(event.clientX, event.clientY);
    if (nodeHit && !nodeHit.path.locked) {
      session.selectPath(nodeHit.path.id);
      session.selectNode(nodeHit.node.id);
      session.beginGeometryEdit("Mover nó interno");
      dragRef.current = { type: "internal-node", pointerId: event.pointerId, nodeId: nodeHit.node.id };
      return true;
    }
    const segmentHit = findInternalPathSegmentAt(event.clientX, event.clientY);
    if (segmentHit && !session.draftPathId) {
      session.selectPath(segmentHit.path.id, segmentHit.segmentId);
      dragRef.current = null;
      return true;
    }
    if (toolRef.current === "cut" || toolRef.current === "dart") {
      const local = screenToActivePieceLocal(event.clientX, event.clientY);
      if (session.draftPathId) session.appendDraftPoint(local);
      else session.startPath(activePieceId, toolRef.current === "dart" ? "dart" : "cut", local);
      dragRef.current = null;
      scheduleDraw();
      return true;
    }
    return false;
  }

'''
source = replace_required(source, marker, helpers + marker, 'insert path helpers')
source = replace_required(source,
'''      if (handleIntentClick(event.clientX, event.clientY)) {''',
'''      if (handleInternalPathPointerDown(event)) return;

      if (handleIntentClick(event.clientX, event.clientY)) {''', 'touch internal path dispatch', count=1)
source = replace_required(source,
'''    if (handleIntentClick(event.clientX, event.clientY)) {''',
'''    if (handleInternalPathPointerDown(event)) return;

    if (handleIntentClick(event.clientX, event.clientY)) {''', 'mouse internal path dispatch', count=1)
source = replace_required(source,
'''    const drag = dragRef.current;
    if (!drag) {
      const state = useEditorStore.getState();''',
'''    const drag = dragRef.current;
    if (!drag && useInternalPathEditorStore.getState().draftPathId) {
      useInternalPathEditorStore.getState().updateDraftCursor(screenToActivePieceLocal(event.clientX, event.clientY));
      scheduleDraw();
    }
    if (!drag) {
      const state = useEditorStore.getState();''', 'draft cursor move')
source = replace_required(source,
'''    if (drag.type === "piece") {''',
'''    if (drag.type === "internal-node") {
      useInternalPathEditorStore.getState().moveSelectedNode(screenToActivePieceLocal(event.clientX, event.clientY));
      scheduleDraw();
      return;
    }

    if (drag.type === "internal-handle") {
      const local = screenToActivePieceLocal(event.clientX, event.clientY);
      const state = useInternalPathEditorStore.getState();
      const path = internalPathsForActivePiece().find((candidate) => candidate.id === state.selectedPathId);
      const node = path?.nodes.find((candidate) => candidate.id === drag.nodeId);
      if (node) state.moveSelectedHandle(drag.handle, { xMm: local.xMm - node.xMm, yMm: local.yMm - node.yMm });
      scheduleDraw();
      return;
    }

    if (drag.type === "piece") {''', 'internal drag move')
source = replace_required(source,
'''    if (
      finishedDrag?.type === "point" &&''',
'''    if ((finishedDrag?.type === "internal-node" || finishedDrag?.type === "internal-handle") && finishedDrag.pointerId === event.pointerId) {
      useInternalPathEditorStore.getState().commitGeometryEdit();
    }
    if (
      finishedDrag?.type === "point" &&''', 'internal drag finish')

old_loop = '''    for (const line of piece.internalLines ?? []) {
      const points = ("points" in line ? line.points : sampleInternalPath(line)).map((point) => pieceLocalToWorld(point, transform));
      context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.xMm, point.yMm) : context.moveTo(point.xMm, point.yMm));
      context.setLineDash(line.purpose === "fold" ? [8 / camera.zoom, 5 / camera.zoom] : [3 / camera.zoom, 3 / camera.zoom]);
      context.strokeStyle = "#59636c"; context.lineWidth = 1.5 / camera.zoom; context.stroke(); context.setLineDash([]);
    }'''
new_loop = '''    for (const line of piece.internalLines ?? []) {
      const richPath = isInternalPath(line) ? line : null;
      if (richPath?.visible === false) continue;
      const points = ("points" in line ? line.points : sampleInternalPath(line)).map((point) => pieceLocalToWorld(point, transform));
      if (points.length < 2) continue;
      context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.xMm, point.yMm) : context.moveTo(point.xMm, point.yMm));
      context.setLineDash(line.purpose === "fold" ? [8 / camera.zoom, 5 / camera.zoom] : line.purpose === "reference" ? [3 / camera.zoom, 3 / camera.zoom] : []);
      const selectedPath = richPath?.id === useInternalPathEditorStore.getState().selectedPathId;
      context.strokeStyle = line.purpose === "dart" ? "#b06084" : line.purpose === "cut" || line.purpose === "cut-and-sew" ? "#b3442e" : "#59636c";
      context.lineWidth = (selectedPath ? 3 : 1.5) / camera.zoom; context.stroke(); context.setLineDash([]);
      if (selectedPath && richPath) {
        const selectedNodeId = useInternalPathEditorStore.getState().selectedNodeId;
        for (const node of richPath.nodes) {
          const point = pieceLocalToWorld(node, transform);
          const selectedNode = node.id === selectedNodeId;
          context.beginPath(); context.arc(point.xMm, point.yMm, (selectedNode ? 7 : 5) / camera.zoom, 0, Math.PI * 2);
          context.fillStyle = selectedNode ? "#fff" : "#f6d8cc"; context.fill(); context.strokeStyle = "#b3442e"; context.lineWidth = 2 / camera.zoom; context.stroke();
          if (selectedNode) for (const handle of ["in", "out"] as const) {
            const vector = handle === "in" ? node.handleIn : node.handleOut;
            if (!vector) continue;
            const endpoint = pieceLocalToWorld({ xMm: node.xMm + vector.xMm, yMm: node.yMm + vector.yMm }, transform);
            context.beginPath(); context.moveTo(point.xMm, point.yMm); context.lineTo(endpoint.xMm, endpoint.yMm); context.strokeStyle = "#8a6d63"; context.lineWidth = 1 / camera.zoom; context.stroke();
            context.beginPath(); context.arc(endpoint.xMm, endpoint.yMm, 4 / camera.zoom, 0, Math.PI * 2); context.fillStyle = "#fff"; context.fill(); context.strokeStyle = "#8a6d63"; context.stroke();
          }
        }
        for (const hit of useInternalPathEditorStore.getState().analysis?.intersections ?? []) {
          const point = pieceLocalToWorld(hit, transform);
          context.beginPath(); context.arc(point.xMm, point.yMm, 6 / camera.zoom, 0, Math.PI * 2); context.fillStyle = hit.tangent ? "#d9a400" : "#b51f1f"; context.fill();
        }
      }
    }'''
source = replace_required(source, old_loop, new_loop, 'internal path render loop')
path.write_text(source)

path = Path('apps/web/src/App.tsx')
source = path.read_text()
source = replace_required(source,
'''import { useEditorStore } from "./state/editorStore";''',
'''import { useEditorStore } from "./state/editorStore";
import { useInternalPathEditorStore } from "./state/internalPathEditorStore";''', 'App store import')
source = replace_required(source,
'''      if (event.key === "Escape" && !isEditableTarget(event.target)) {
        const state = useEditorStore.getState();''',
'''      if (event.key === "Escape" && !isEditableTarget(event.target)) {
        const pathState = useInternalPathEditorStore.getState();
        if (pathState.draftPathId) {
          pathState.cancelDraft();
          setActiveTool("select");
          return;
        }
        const state = useEditorStore.getState();''', 'App Escape')
source = replace_required(source,
'''      if (!isEditableTarget(event.target) && useEditorStore.getState().draftContour) {''',
'''      if (!isEditableTarget(event.target) && useInternalPathEditorStore.getState().draftPathId) {
        const pathState = useInternalPathEditorStore.getState();
        if (event.key === "Enter") {
          event.preventDefault();
          if (pathState.confirmDraft()) setActiveTool("select");
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          pathState.removeLastDraftPoint();
          return;
        }
      }
      if (!isEditableTarget(event.target) && useEditorStore.getState().draftContour) {''', 'App path shortcuts')
path.write_text(source)

path = Path('apps/web/src/styles.css')
source = path.read_text()
source += '''\n\n/* Prompt 04: caminhos internos */\n.context-bar label { display: inline-flex; align-items: center; gap: 5px; }\n.context-bar select { min-height: 30px; padding: 0 7px; border: 1px solid #b9b3a8; border-radius: 6px; background: #fff; }\n.context-shortcuts { color: #6d675d; font-size: 10px; }\n.context-diagnostic { max-width: 360px; color: #76570f; }\n'''
path.write_text(source)
