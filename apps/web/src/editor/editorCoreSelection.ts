import { useEditorStore } from "../state/editorStore";
import { useInternalPathEditorStore } from "../state/internalPathEditorStore";

type ClearSelectionAction = () => void;

/**
 * Clears every persistent selection domain used by the 2D editor without
 * cancelling an in-progress modeling operation. This is the single clearing
 * path used by real empty-canvas clicks and Escape in recovery gate 9.5-04.
 */
export function clearCompleteEditorSelection(
  baseClear: ClearSelectionAction = useEditorStore.getState().clearSelection,
): void {
  baseClear();
  const editor = useEditorStore.getState();
  editor.selectDart(null);
  editor.selectFirstSeamEdge(null);
  editor.setNearbySeamSuggestion(null);
  useInternalPathEditorStore.getState().selectPath(null);
}

/**
 * Legacy PatternCanvas already calls editorStore.clearSelection for a genuine
 * empty click/tap. Decorate that action for this gate so the legacy gesture
 * detector keeps deciding *when* a click is empty while all selection stores
 * are cleared consistently.
 */
export function installCompleteEditorSelectionClear(): () => void {
  const original = useEditorStore.getState().clearSelection;
  const complete = () => clearCompleteEditorSelection(original);
  useEditorStore.setState({ clearSelection: complete });

  return () => {
    if (useEditorStore.getState().clearSelection === complete) {
      useEditorStore.setState({ clearSelection: original });
    }
  };
}

export function hasCompleteEditorSelection(): boolean {
  const editor = useEditorStore.getState();
  const internal = useInternalPathEditorStore.getState();
  return Boolean(
    editor.selectedPointId
      || editor.selectedEdgeId
      || editor.selectedSeamId
      || editor.selectedDartId
      || editor.pieceSelectionActive
      || editor.selectedPieceIds.length > 0
      || internal.selectedPathId
      || internal.selectedNodeId
      || internal.selectedSegmentId,
  );
}
