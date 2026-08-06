from pathlib import Path

store_path = Path("apps/web/src/state/editorStore.ts")
store = store_path.read_text(encoding="utf-8")

replacements = [
("""  loadGarment: (garment) => {
    history.clear();
    const normalized = migrateLegacyDocument(garment);
    const activePiece = normalized.pieces[0];
    if (!activePiece) return;
    applyDocumentState(set, get, { garment: normalized, activePieceId: activePiece.id });
    set({ baselinePieces: clonePieces(normalized.pieces), ...historyAvailability() });
  },""",
"""  loadGarment: (garment) => {
    history.clear();
    const normalized = migrateLegacyDocument(garment);
    const activePiece = normalized.pieces[0];
    if (!activePiece) {
      set({
        garment: ensureWorkspaceState(normalized),
        baselinePieces: [],
        activePieceId: "",
        selectedPointId: null,
        selectedEdgeId: null,
        selectedSeamId: null,
        selectedDartId: null,
        selectedPieceIds: [],
        pieceSelectionActive: false,
        seamIssues: [],
        seamProposal: null,
        seamFirstEdge: null,
        nearbySeamSuggestion: null,
        cutDraft: null,
        dartDraft: null,
        measureDraft: null,
        draftContour: null,
        draftCursor: null,
        draftError: null,
        ...historyAvailability(),
      });
      return;
    }
    applyDocumentState(set, get, { garment: normalized, activePieceId: activePiece.id });
    set({ baselinePieces: clonePieces(normalized.pieces), ...historyAvailability() });
  },"""),
("""    if (removable.length === 0 || removable.length >= state.garment.pieces.length) return;
    changeDocument(set, get, "piece-delete", "Excluir peças selecionadas", (document) => {
      const pieces = document.garment.pieces.filter((piece) => !removable.includes(piece.id));
      return { activePieceId: pieces[0].id, garment: syncLegacyTransforms({ ...document.garment, pieces, seams: (document.garment.seams ?? []).filter((seam) => !removable.includes(seam.first.pieceId) && !removable.includes(seam.second.pieceId)), workspaceStates: (document.garment.workspaceStates ?? []).filter((item) => !removable.includes(item.pieceId)) }) };
    }, { selectedPieceIds: [], pieceSelectionActive: false });""",
"""    if (removable.length === 0) return;
    changeDocument(set, get, "piece-delete", "Excluir peças selecionadas", (document) => {
      const pieces = document.garment.pieces.filter((piece) => !removable.includes(piece.id));
      return { activePieceId: pieces[0]?.id ?? "", garment: syncLegacyTransforms({ ...document.garment, pieces, seams: (document.garment.seams ?? []).filter((seam) => !removable.includes(seam.first.pieceId) && !removable.includes(seam.second.pieceId)), workspaceStates: (document.garment.workspaceStates ?? []).filter((item) => !removable.includes(item.pieceId)) }) };
    }, { selectedPieceIds: [], pieceSelectionActive: false });"""),
("""  deletePiece: (pieceId) => {
    if (get().garment.pieces.length <= 1) return;
    changeDocument(set, get, "piece-delete", "Excluir peça", (document) => {
      const pieces = document.garment.pieces.filter((piece) => piece.id !== pieceId);
      const activePieceId = document.activePieceId === pieceId ? pieces[0].id : document.activePieceId;""",
"""  deletePiece: (pieceId) => {
    if (!get().garment.pieces.some((piece) => piece.id === pieceId)) return;
    changeDocument(set, get, "piece-delete", "Excluir peça", (document) => {
      const pieces = document.garment.pieces.filter((piece) => piece.id !== pieceId);
      const activePieceId = document.activePieceId === pieceId ? (pieces[0]?.id ?? "") : document.activePieceId;"""),
("""  const piece = garment.pieces.find((candidate) => candidate.id === document.activePieceId) ?? garment.pieces[0];
  if (!piece) return;
  const snapshot = restoreSnapshot(piece);""",
"""  const piece = garment.pieces.find((candidate) => candidate.id === document.activePieceId) ?? garment.pieces[0];
  if (!piece) {
    set({
      garment,
      activePieceId: "",
      selectedPointId: null,
      selectedEdgeId: null,
      selectedSeamId: null,
      selectedDartId: null,
      selectedPieceIds: [],
      pieceSelectionActive: false,
      seamIssues: [],
      seamProposal: null,
      seamFirstEdge: null,
      nearbySeamSuggestion: null,
      cutDraft: null,
      dartDraft: null,
      measureDraft: null,
      ...historyAvailability(),
      ...additional,
    });
    return;
  }
  const snapshot = restoreSnapshot(piece);"""),
]

for old, new in replacements:
    if old not in store:
        raise SystemExit(f"store marker not found: {old[:80]!r}")
    store = store.replace(old, new, 1)
store_path.write_text(store, encoding="utf-8")

app_path = Path("apps/web/src/App.tsx")
app = app_path.read_text(encoding="utf-8")
app = app.replace(
    "  const selectedPointIndex = snapshot.piece.points.findIndex(",
    "  const hasPieces = garment.pieces.length > 0;\n  const selectedPointIndex = hasPieces ? snapshot.piece.points.findIndex(",
    1,
)
app = app.replace(
    "    (point) => point.id === selectedPointId,\n  );",
    "    (point) => point.id === selectedPointId,\n  ) : -1;",
    1,
)
app = app.replace(
    "              <strong>{snapshot.piece.name} · milímetros</strong>",
    "              <strong>{hasPieces ? `${snapshot.piece.name} · milímetros` : \"Bancada vazia · milímetros\"}</strong>",
    1,
)
old_canvas = """              <PatternCanvas
                snapshot={snapshot}
                tool={activeTool}
                selectedPointId={selectedPointId}
                onSelectPoint={selectPoint}
                onEditStart={beginEdit}
                onEditEnd={commitEdit}
                onMovePoint={movePoint}
                onMoveHandle={moveHandle}
                onInsertPoint={handleInsertPoint}
                onToolChange={setActiveTool}
              />"""
new_canvas = """              {hasPieces ? (
                <PatternCanvas
                  snapshot={snapshot}
                  tool={activeTool}
                  selectedPointId={selectedPointId}
                  onSelectPoint={selectPoint}
                  onEditStart={beginEdit}
                  onEditEnd={commitEdit}
                  onMovePoint={movePoint}
                  onMoveHandle={moveHandle}
                  onInsertPoint={handleInsertPoint}
                  onToolChange={setActiveTool}
                />
              ) : (
                <div className="empty-workspace" role="status">
                  <strong>A bancada está vazia</strong>
                  <span>Abra Moldes para escolher uma base ou use Desenhar para criar uma peça do zero.</span>
                  <button type="button" onClick={() => setLibraryOpen(true)}>Abrir moldes</button>
                </div>
              )}"""
if old_canvas not in app:
    raise SystemExit("PatternCanvas marker not found")
app = app.replace(old_canvas, new_canvas, 1)
app_path.write_text(app, encoding="utf-8")

css_path = Path("apps/web/src/recovery.css")
css = css_path.read_text(encoding="utf-8")
css += """

.empty-workspace {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 24px;
  color: #555650;
  text-align: center;
  background-color: #f3f1ec;
  background-image: linear-gradient(#dedbd4 1px, transparent 1px), linear-gradient(90deg, #dedbd4 1px, transparent 1px);
  background-size: 20px 20px;
}
.empty-workspace strong { color: #202124; font: 700 28px/1.1 Georgia, serif; }
.empty-workspace span { max-width: 470px; padding: 8px 12px; border-radius: 8px; background: rgb(243 241 236 / 88%); }
.empty-workspace button { min-height: 44px; padding: 0 18px; border-radius: 8px; background: #282a2d; color: #fff; cursor: pointer; }
"""
css_path.write_text(css, encoding="utf-8")
