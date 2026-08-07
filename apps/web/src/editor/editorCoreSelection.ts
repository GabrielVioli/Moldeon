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
  // `activePieceId` is document/editing context, but the legacy canvas also uses
  // it to render the full point + dimension overlay. Leaving it populated after
  // a clear made an unselected piece look selected. Empty it here so Escape and
  // a true background click have one visual and semantic result. The next hit
  // on a point, edge or piece selects/activates that piece again normally.
  useEditorStore.setState({ activePieceId: "" });
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
