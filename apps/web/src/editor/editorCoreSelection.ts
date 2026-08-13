import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";

/**
 * Single authoritative path for clearing persistent editor selection.
 *
 * This deliberately does not cancel modeling drafts or change the active tool.
 * Callers decide whether a temporary operation must be cancelled first, then
 * converge here so every selection domain is cleared consistently.
 */
export function clearEditorSelection(options: { preservePieces?: boolean } = {}): void {
  const editor = useEditorStore.getState();
  const selectedPieceIds = options.preservePieces
    ? editor.selectedPieceIds.filter((pieceId) => editor.garment.pieces.some((piece) => piece.id === pieceId))
    : [];
  const activePieceId = options.preservePieces && editor.activePieceId
    ? editor.activePieceId
    : selectedPieceIds.at(-1) ?? "";
  editor.clearSelection();
  editor.selectDart(null);
  editor.cancelSeamProposal();
  editor.setNearbySeamSuggestion(null);
  useInternalPathEditorStore.getState().selectPath(null);
  // `activePieceId` is document/editing context, but the legacy canvas also uses
  // it to render the full point + dimension overlay. Leaving it populated after
  // a clear made an unselected piece look selected. Empty it here so Escape and
  // a true background click have one visual and semantic result. The next hit
  // on a point, edge or piece selects/activates that piece again normally.
  useEditorStore.setState(options.preservePieces && selectedPieceIds.length > 0
    ? { activePieceId, selectedPieceIds, pieceSelectionActive: true }
    : { activePieceId: "" });
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
      || editor.seamDraft
      || editor.seamProposal
      || editor.nearbySeamSuggestion
      || internal.selectedPathId
      || internal.selectedNodeId
      || internal.selectedSegmentId,
  );
}
