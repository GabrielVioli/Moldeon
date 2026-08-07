import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";

/**
 * Single authoritative path for clearing persistent editor selection.
 *
 * This deliberately does not cancel modeling drafts or change the active tool.
 * Callers decide whether a temporary operation must be cancelled first, then
 * converge here so every selection domain is cleared consistently.
 */
export function clearEditorSelection(): void {
  const editor = useEditorStore.getState();
  editor.clearSelection();
  editor.selectDart(null);
  editor.cancelSeamProposal();
  editor.setNearbySeamSuggestion(null);
  useInternalPathEditorStore.getState().selectPath(null);
}

export function hasEditorSelection(): boolean {
  const editor = useEditorStore.getState();
  const internal = useInternalPathEditorStore.getState();
  return Boolean(
    editor.selectedPointId
      || editor.selectedEdgeId
      || editor.selectedSeamId
      || editor.selectedDartId
      || editor.pieceSelectionActive
      || editor.selectedPieceIds.length > 0
      || editor.seamFirstEdge
      || editor.seamProposal
      || editor.nearbySeamSuggestion
      || internal.selectedPathId
      || internal.selectedNodeId
      || internal.selectedSegmentId,
  );
}
