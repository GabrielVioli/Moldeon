from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(path: str, marker: str, content: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if marker in text:
        return
    target.write_text(text.rstrip() + "\n\n" + content.strip() + "\n", encoding="utf-8")


# Domain: an empty project is a valid garment document.
replace_once(
    "apps/web/src/domain/pattern.ts",
    '''  if (!Array.isArray(value.pieces) || value.pieces.length === 0) {
    throw new TypeError("O projeto precisa ter pelo menos uma peça.");
  }''',
    '''  if (!Array.isArray(value.pieces)) {
    throw new TypeError("A lista de peças do projeto é inválida.");
  }''',
)

replace_once(
    "apps/web/src/domain/patternDocumentV3.ts",
    '''function parsePatternDefinitions(value: unknown): PatternDefinitionV3[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("O documento precisa ter ao menos uma definição de molde.");
  }
  return value.map(parsePatternDefinition);
}''',
    '''function parsePatternDefinitions(value: unknown): PatternDefinitionV3[] {
  if (!Array.isArray(value)) {
    throw new TypeError("As definições de molde do documento são inválidas.");
  }
  return value.map(parsePatternDefinition);
}''',
)

# Autosave: omit an active pattern when there are no pieces and accept that state on restore.
replace_once(
    "apps/web/src/storage/opfs.ts",
    '''  const document = garmentDraftToPatternDocumentV3(garment, {
    activePatternId: activePieceId,
  });
  const serialized = JSON.stringify({
    version: 3,
    document,
    activePatternId: activePieceId,
    savedAt: new Date().toISOString(),
  });''',
    '''  const document = garmentDraftToPatternDocumentV3(garment, {
    ...(activePieceId ? { activePatternId: activePieceId } : {}),
  });
  const serialized = JSON.stringify({
    version: 3,
    document,
    ...(activePieceId ? { activePatternId: activePieceId } : {}),
    savedAt: new Date().toISOString(),
  });''',
)

replace_once(
    "apps/web/src/storage/opfs.ts",
    '''  if (value.version === 3) {
    const document = parsePatternDocumentV3(value.document);
    const activePieceId =
      value.activePatternId === undefined
        ? document.workspace.activePatternId ?? document.patternDefinitions[0]?.id
        : readString(value.activePatternId, "A peça ativa do autosave V3");
    if (!activePieceId) {
      throw new AutosaveParseError(
        "O autosave V3 não possui uma definição de molde ativa.",
      );
    }
    const garment = patternDocumentV3ToGarmentDraft(document);
    assertActivePattern(garment, activePieceId);
    return {
      kind: "garment",
      garment,
      activePieceId,
      patternDocument: document,
      sourceVersion: 3,
      migrationWarnings: [],
    };
  }''',
    '''  if (value.version === 3) {
    const document = parsePatternDocumentV3(value.document);
    const activePieceId =
      value.activePatternId === undefined
        ? document.workspace.activePatternId ?? document.patternDefinitions[0]?.id ?? ""
        : readString(value.activePatternId, "A peça ativa do autosave V3");
    const garment = patternDocumentV3ToGarmentDraft(document);
    if (activePieceId) {
      assertActivePattern(garment, activePieceId);
    } else if (garment.pieces.length > 0) {
      throw new AutosaveParseError(
        "O autosave V3 possui peças, mas nenhuma definição ativa.",
      );
    }
    return {
      kind: "garment",
      garment,
      activePieceId,
      patternDocument: document,
      sourceVersion: 3,
      migrationWarnings: [],
    };
  }''',
)

# Store: load, restore, delete, undo and redo must all understand zero pieces.
replace_once(
    "apps/web/src/state/editorStore.ts",
    '''  restoreGarment: (garment, requestedPieceId, backend) => {
    history.clear();
    const normalized = migrateLegacyDocument(garment);
    const activePiece = normalized.pieces.find((piece) => piece.id === requestedPieceId) ?? normalized.pieces[0];
    if (!activePiece) return;
    const snapshot = restoreSnapshot(activePiece);
    set({
      garment: replacePiece(normalized, snapshot.piece),
      baselinePieces: clonePieces(normalized.pieces),
      activePieceId: activePiece.id,
      snapshot,
      engineBackend: backend,
      selectedPointId: null,
      selectedEdgeId: null,
      selectedSeamId: null,
      pieceSelectionActive: false,
      selectedPieceIds: [],
      draftContour: null,
      draftCursor: null,
      draftError: null,
      seamIssues: collectSeamIssues(normalized),
      seamProposal: null,
      seamFirstEdge: null,
      nearbySeamSuggestion: null,
      cutDraft: null,
      dartDraft: null,
      selectedDartId: null,
      measureDraft: null,
      ...historyAvailability(),
    });
  },''',
    '''  restoreGarment: (garment, requestedPieceId, backend) => {
    history.clear();
    const normalized = migrateLegacyDocument(garment);
    const activePiece = normalized.pieces.find((piece) => piece.id === requestedPieceId) ?? normalized.pieces[0];
    if (!activePiece) {
      set({
        garment: ensureWorkspaceState(normalized),
        baselinePieces: [],
        activePieceId: "",
        engineBackend: backend,
        selectedPointId: null,
        selectedEdgeId: null,
        selectedSeamId: null,
        selectedDartId: null,
        pieceSelectionActive: false,
        selectedPieceIds: [],
        draftContour: null,
        draftCursor: null,
        draftError: null,
        seamIssues: [],
        seamProposal: null,
        seamFirstEdge: null,
        nearbySeamSuggestion: null,
        cutDraft: null,
        dartDraft: null,
        measureDraft: null,
        ...historyAvailability(),
      });
      return;
    }
    const snapshot = restoreSnapshot(activePiece);
    set({
      garment: replacePiece(normalized, snapshot.piece),
      baselinePieces: clonePieces(normalized.pieces),
      activePieceId: activePiece.id,
      snapshot,
      engineBackend: backend,
      selectedPointId: null,
      selectedEdgeId: null,
      selectedSeamId: null,
      pieceSelectionActive: false,
      selectedPieceIds: [],
      draftContour: null,
      draftCursor: null,
      draftError: null,
      seamIssues: collectSeamIssues(normalized),
      seamProposal: null,
      seamFirstEdge: null,
      nearbySeamSuggestion: null,
      cutDraft: null,
      dartDraft: null,
      selectedDartId: null,
      measureDraft: null,
      ...historyAvailability(),
    });
  },''',
)

replace_once(
    "apps/web/src/state/editorStore.ts",
    '''  loadGarment: (garment) => {
    history.clear();
    const normalized = migrateLegacyDocument(garment);
    const activePiece = normalized.pieces[0];
    if (!activePiece) return;
    applyDocumentState(set, get, { garment: normalized, activePieceId: activePiece.id });
    set({ baselinePieces: clonePieces(normalized.pieces), ...historyAvailability() });
  },''',
    '''  loadGarment: (garment) => {
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
  },''',
)

replace_once(
    "apps/web/src/state/editorStore.ts",
    '''  selectAllPieces: () => set((state) => ({ selectedPieceIds: state.garment.pieces.filter((piece) => workspaceStateFor(state.garment, piece.id).visible).map((piece) => piece.id), pieceSelectionActive: true, selectedPointId: null, selectedEdgeId: null, selectedSeamId: null })),''',
    '''  selectAllPieces: () => set((state) => {
    const selectedPieceIds = state.garment.pieces
      .filter((piece) => workspaceStateFor(state.garment, piece.id).visible)
      .map((piece) => piece.id);
    return {
      selectedPieceIds,
      pieceSelectionActive: selectedPieceIds.length > 0,
      selectedPointId: null,
      selectedEdgeId: null,
      selectedSeamId: null,
    };
  }),''',
)

replace_once(
    "apps/web/src/state/editorStore.ts",
    '''    if (removable.length === 0 || removable.length >= state.garment.pieces.length) return;
    changeDocument(set, get, "piece-delete", "Excluir peças selecionadas", (document) => {
      const pieces = document.garment.pieces.filter((piece) => !removable.includes(piece.id));
      return { activePieceId: pieces[0].id, garment: syncLegacyTransforms({ ...document.garment, pieces, seams: (document.garment.seams ?? []).filter((seam) => !removable.includes(seam.first.pieceId) && !removable.includes(seam.second.pieceId)), workspaceStates: (document.garment.workspaceStates ?? []).filter((item) => !removable.includes(item.pieceId)) }) };
    }, { selectedPieceIds: [], pieceSelectionActive: false });''',
    '''    if (removable.length === 0) return;
    changeDocument(set, get, "piece-delete", "Excluir peças selecionadas", (document) => {
      const pieces = document.garment.pieces.filter((piece) => !removable.includes(piece.id));
      return {
        activePieceId: pieces[0]?.id ?? "",
        garment: syncLegacyTransforms({
          ...document.garment,
          pieces,
          seams: (document.garment.seams ?? []).filter(
            (seam) => !removable.includes(seam.first.pieceId) && !removable.includes(seam.second.pieceId),
          ),
          workspaceStates: (document.garment.workspaceStates ?? []).filter(
            (item) => !removable.includes(item.pieceId),
          ),
        }),
      };
    }, { selectedPieceIds: [], pieceSelectionActive: false });''',
)

replace_once(
    "apps/web/src/state/editorStore.ts",
    '''  deletePiece: (pieceId) => {
    if (get().garment.pieces.length <= 1) return;
    changeDocument(set, get, "piece-delete", "Excluir peça", (document) => {
      const pieces = document.garment.pieces.filter((piece) => piece.id !== pieceId);
      const activePieceId = document.activePieceId === pieceId ? pieces[0].id : document.activePieceId;''',
    '''  deletePiece: (pieceId) => {
    if (!get().garment.pieces.some((piece) => piece.id === pieceId)) return;
    changeDocument(set, get, "piece-delete", "Excluir peça", (document) => {
      const pieces = document.garment.pieces.filter((piece) => piece.id !== pieceId);
      const activePieceId = document.activePieceId === pieceId
        ? (pieces[0]?.id ?? "")
        : document.activePieceId;''',
)

replace_once(
    "apps/web/src/state/editorStore.ts",
    '''  const piece = garment.pieces.find((candidate) => candidate.id === document.activePieceId) ?? garment.pieces[0];
  if (!piece) return;
  const snapshot = restoreSnapshot(piece);''',
    '''  const piece = garment.pieces.find((candidate) => candidate.id === document.activePieceId) ?? garment.pieces[0];
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
  const snapshot = restoreSnapshot(piece);''',
)

# Canvas: retain the real canvas for drawing from zero, but never render the stale fallback snapshot.
replace_once(
    "apps/web/src/editor/PatternCanvas.tsx",
    '''  const activePiece = garment.pieces.find((piece) => piece.id === activePieceId) ?? snapshot.piece;
  const activePoints = activePiece.points;
  if (activePoints.length < 3) return;
  const sampledContour = samplePatternContour(activePoints);

  context.save();
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);

  const activeTransform = getPieceWorkspaceTransform(garment, activePieceId);

  // draw persistent guides (from the active piece metadata)
  if (activePiece.guides) {''',
    '''  const activePiece = garment.pieces.find((piece) => piece.id === activePieceId);

  context.save();
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);

  const activeTransform = activePiece
    ? getPieceWorkspaceTransform(garment, activePieceId)
    : { pieceId: "empty-workspace", xMm: 0, yMm: 0, rotationDeg: 0 };

  // draw persistent guides (from the active piece metadata)
  if (activePiece?.guides) {''',
)

# App: remove stale-piece UI while keeping the canvas available for a new draft.
replace_once(
    "apps/web/src/App.tsx",
    '''  const selectedPointIndex = snapshot.piece.points.findIndex(
    (point) => point.id === selectedPointId,
  );''',
    '''  const hasPieces = garment.pieces.length > 0;
  const selectedPointIndex = hasPieces
    ? snapshot.piece.points.findIndex((point) => point.id === selectedPointId)
    : -1;''',
)

replace_once(
    "apps/web/src/App.tsx",
    '''              <strong>{snapshot.piece.name} · milímetros</strong>''',
    '''              <strong>{hasPieces ? `${snapshot.piece.name} · milímetros` : "Bancada vazia · milímetros"}</strong>''',
)

replace_once(
    "apps/web/src/App.tsx",
    '''                  disabled={draftContour !== null}
                  onClick={() => setActiveTool(activeTool === "point" ? "select" : "point")}''',
    '''                  disabled={!hasPieces || draftContour !== null}
                  onClick={() => setActiveTool(activeTool === "point" ? "select" : "point")}''',
)

replace_once(
    "apps/web/src/App.tsx",
    '''                  disabled={snapshot.piece.points.length <= 3 || selectedPoint === null}''',
    '''                  disabled={!hasPieces || snapshot.piece.points.length <= 3 || selectedPoint === null}''',
)

replace_once(
    "apps/web/src/App.tsx",
    '''              <PatternCanvas
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
              <ContextBar tool={activeTool} onDone={() => setActiveTool("select")} />''',
    '''              <PatternCanvas
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
              {!hasPieces && draftContour === null ? (
                <div className="empty-workspace" role="status">
                  <strong>A bancada está vazia</strong>
                  <span>Escolha uma base ou desenhe a primeira peça diretamente nesta bancada.</span>
                  <div>
                    <button type="button" onClick={() => setLibraryOpen(true)}>Abrir moldes</button>
                    <button type="button" onClick={handleCreateBlankPiece}>Desenhar primeira peça</button>
                  </div>
                </div>
              ) : null}
              <ContextBar tool={activeTool} onDone={() => setActiveTool("select")} />''',
)

replace_once(
    "apps/web/src/App.tsx",
    '''        {workspaceMode === "assembly" ? <AssemblyPanel
          previewRequested={previewRequested}
          mobileActive={mobileView === "inspector"}
          onRequestPreview={handleSimulate}
          onDressBody={handleDressBody}
        /> : workspaceMode === "fitting" ? <PreviewPlacementPanel /> : <Inspector
          id="inspector-panel"
          labelledBy="inspector-tab"
          mobileActive={mobileView === "inspector"}
          snapshot={snapshot}
          selectedPointId={selectedPointId}
          onEditStart={beginEdit}
          onEditEnd={commitEdit}
          onEditCancel={cancelEdit}
          onMovePoint={movePoint}
          curveActive={selectedCurveActive}
          onToggleCurve={handleToggleCurve}
          onSeamAllowanceChange={setSeamAllowance}
        />}''',
    '''        {workspaceMode === "assembly" ? <AssemblyPanel
          previewRequested={previewRequested}
          mobileActive={mobileView === "inspector"}
          onRequestPreview={handleSimulate}
          onDressBody={handleDressBody}
        /> : workspaceMode === "fitting" ? <PreviewPlacementPanel /> : hasPieces ? <Inspector
          id="inspector-panel"
          labelledBy="inspector-tab"
          mobileActive={mobileView === "inspector"}
          snapshot={snapshot}
          selectedPointId={selectedPointId}
          onEditStart={beginEdit}
          onEditEnd={commitEdit}
          onEditCancel={cancelEdit}
          onMovePoint={movePoint}
          curveActive={selectedCurveActive}
          onToggleCurve={handleToggleCurve}
          onSeamAllowanceChange={setSeamAllowance}
        /> : <EmptyInspector mobileActive={mobileView === "inspector"} />}''',
)

replace_once(
    "apps/web/src/App.tsx",
    '''function ViewportPlaceholder({ loading = false }: { loading?: boolean }) {''',
    '''function EmptyInspector({ mobileActive }: { mobileActive: boolean }) {
  return (
    <aside
      className={`inspector empty-inspector workspace-view${mobileActive ? " is-mobile-active" : ""}`}
      id="inspector-panel"
      aria-labelledby="inspector-tab"
    >
      <span className="section-eyebrow">Propriedades</span>
      <strong>Nenhuma peça selecionada</strong>
      <p>Desenhe uma peça ou abra a biblioteca de moldes para começar.</p>
    </aside>
  );
}

function ViewportPlaceholder({ loading = false }: { loading?: boolean }) {''',
)

append_once(
    "apps/web/src/recovery.css",
    ".empty-workspace {",
    '''.empty-workspace {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 32px;
  color: #555650;
  text-align: center;
  pointer-events: none;
}
.empty-workspace::before {
  content: "";
  position: absolute;
  inset: 42px;
  z-index: -1;
  border: 1px dashed #aaa69d;
  border-radius: 18px;
  background: rgb(243 241 236 / 82%);
  backdrop-filter: blur(2px);
}
.empty-workspace strong { color: #202124; font: 700 clamp(25px, 4vw, 36px)/1.1 Georgia, serif; }
.empty-workspace span { max-width: 520px; }
.empty-workspace > div { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; pointer-events: auto; }
.empty-workspace button { min-height: 44px; padding: 0 16px; border-radius: 8px; background: #282a2d; color: #fff; cursor: pointer; }
.empty-workspace button:first-child { color: #202124; background: #d9b866; }
.empty-inspector { display: grid; align-content: start; gap: 9px; padding: 22px 18px; }
.empty-inspector p { margin: 0; color: #686963; font-size: 12px; line-height: 1.5; }

@media (max-width: 760px) {
  .empty-workspace { padding: 20px; }
  .empty-workspace::before { inset: 18px; }
  .empty-workspace > div { display: grid; width: min(100%, 280px); }
}''',
)

# Focused tests for the complete zero-piece lifecycle.
(ROOT / "apps/web/src/state/emptyWorkspace.test.ts").write_text('''import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import type { GarmentDraft, PatternPiece } from "../domain/pattern";
import { useEditorStore } from "./editorStore";

function makePiece(id: string): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 10,
    points: [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 120, yMm: 0 },
      { id: `${id}-c`, xMm: 80, yMm: 100 },
      { id: `${id}-d`, xMm: 0, yMm: 90 },
    ],
  };
}

function garment(pieces: PatternPiece[]): GarmentDraft {
  const fabric = createDefaultFabricSource();
  return {
    id: "empty-workspace-test",
    templateId: "blank",
    name: "Projeto vazio",
    description: "Teste da bancada vazia",
    bodyType: "feminine",
    measurements: {
      heightMm: 1680,
      bustMm: 920,
      waistMm: 760,
      hipMm: 1000,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    },
    fabrics: [fabric],
    pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })),
    seams: [],
    workspaceStates: pieces.map((piece) => ({
      pieceId: piece.id,
      transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
      visible: true,
      locked: false,
    })),
  };
}

describe("empty workspace recovery", () => {
  beforeEach(() => useEditorStore.getState().loadGarment(garment([])));

  it("loads and keeps a project with zero pieces", () => {
    const state = useEditorStore.getState();
    expect(state.garment.pieces).toEqual([]);
    expect(state.activePieceId).toBe("");
    expect(state.selectedPieceIds).toEqual([]);
    expect(state.pieceSelectionActive).toBe(false);
    state.selectAllPieces();
    expect(useEditorStore.getState().pieceSelectionActive).toBe(false);
  });

  it("deletes the last piece and supports undo and redo", () => {
    useEditorStore.getState().loadGarment(garment([makePiece("only")]));
    useEditorStore.getState().selectPiece("only");
    useEditorStore.getState().deletePiece("only");
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    expect(useEditorStore.getState().activePieceId).toBe("");
    expect(useEditorStore.getState().selectedPieceIds).toEqual([]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces.map((piece) => piece.id)).toEqual(["only"]);
    expect(useEditorStore.getState().activePieceId).toBe("only");

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    expect(useEditorStore.getState().activePieceId).toBe("");
  });

  it("creates the first drawn piece as one reversible command", () => {
    const state = useEditorStore.getState();
    state.startDraft("Primeira peça");
    state.addDraftPoint(10, 10);
    state.addDraftPoint(160, 10);
    state.addDraftPoint(110, 130);
    state.addDraftPoint(10, 100);
    state.closeDraft();

    expect(useEditorStore.getState().garment.pieces).toHaveLength(1);
    expect(useEditorStore.getState().garment.pieces[0].name).toBe("Primeira peça");

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(1);
  });

  it("removes every selected piece and their seams without leaving invalid references", () => {
    const first = makePiece("first");
    const second = makePiece("second");
    const project = garment([first, second]);
    project.seams = [{
      id: "join",
      first: { pieceId: "first", edgeId: "first:edge:first-a->first-b", startT: 0, endT: 1 },
      second: { pieceId: "second", edgeId: "second:edge:second-a->second-b", startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
    }];
    useEditorStore.getState().loadGarment(project);
    useEditorStore.getState().selectAllPieces();
    useEditorStore.getState().deleteSelectedPieces();
    expect(useEditorStore.getState().garment.pieces).toEqual([]);
    expect(useEditorStore.getState().garment.seams ?? []).toEqual([]);
    expect(useEditorStore.getState().garment.workspaceStates ?? []).toEqual([]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.pieces).toHaveLength(2);
    expect(useEditorStore.getState().garment.seams).toHaveLength(1);
  });
});
''', encoding="utf-8")

(ROOT / "apps/web/src/storage/emptyAutosave.test.ts").write_text('''import { describe, expect, it } from "vitest";
import { createDefaultFabricSource } from "../domain/fabric";
import type { GarmentDraft } from "../domain/pattern";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
} from "../domain/patternDocumentV3";
import { parseAutosaveOrThrow } from "./opfs";

function emptyGarment(): GarmentDraft {
  return {
    id: "empty-autosave",
    templateId: "blank",
    name: "Projeto vazio",
    description: "Bancada sem peças",
    bodyType: "feminine",
    measurements: {
      heightMm: 1680,
      bustMm: 920,
      waistMm: 760,
      hipMm: 1000,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    },
    fabrics: [createDefaultFabricSource()],
    pieces: [],
    seams: [],
    workspaceStates: [],
  };
}

describe("empty workspace persistence", () => {
  it("round-trips a V3 document with no pattern definitions", () => {
    const document = garmentDraftToPatternDocumentV3(emptyGarment());
    expect(document.patternDefinitions).toEqual([]);
    expect(document.workspace.activePatternId).toBeUndefined();
    const parsed = parsePatternDocumentV3(JSON.parse(JSON.stringify(document)));
    expect(patternDocumentV3ToGarmentDraft(parsed).pieces).toEqual([]);
  });

  it("restores a V3 autosave without an active pattern", () => {
    const document = garmentDraftToPatternDocumentV3(emptyGarment());
    const restored = parseAutosaveOrThrow(JSON.stringify({
      version: 3,
      document,
      savedAt: "2026-08-06T12:00:00.000Z",
    }));
    expect(restored.kind).toBe("garment");
    if (restored.kind !== "garment") throw new Error("Autosave inesperado");
    expect(restored.activePieceId).toBe("");
    expect(restored.garment.pieces).toEqual([]);
  });
});
''', encoding="utf-8")

(ROOT / "scripts/recovery-empty-workspace-visual.mjs").write_text('''import { mkdir } from "node:fs/promises";
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

const report = [];
try {
  for (const scenario of [
    { name: "desktop", viewport: { width: 1366, height: 768 }, draw: true },
    { name: "mobile", viewport: { width: 390, height: 844 }, draw: false },
  ]) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") await dialog.accept("Peça teste");
      else await dialog.accept();
    });

    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Moldes" }).click();
    await page.getByRole("button", { name: /Bancada vazia/ }).click();
    await page.getByRole("button", { name: "Criar bancada vazia" }).click();
    const empty = page.locator(".empty-workspace");
    await empty.waitFor({ state: "visible" });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-empty.png`, fullPage: true });

    const initial = await page.evaluate(() => ({
      title: document.querySelector(".panel-titlebar strong")?.textContent?.trim(),
      pieceItems: document.querySelectorAll(".pieces-item").length,
      emptyVisible: Boolean(document.querySelector(".empty-workspace")),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    if (initial.pieceItems !== 0 || !initial.emptyVisible || initial.horizontalOverflow) {
      throw new Error(`${scenario.name}: estado vazio inválido: ${JSON.stringify(initial)}`);
    }

    if (scenario.draw) {
      await page.getByRole("button", { name: "Desenhar primeira peça" }).click();
      const canvas = page.locator("canvas.pattern-canvas");
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Canvas não encontrado");
      await canvas.click({ position: { x: Math.max(230, box.width * 0.30), y: Math.max(170, box.height * 0.30) } });
      await canvas.click({ position: { x: Math.min(box.width - 100, box.width * 0.58), y: Math.max(170, box.height * 0.30) } });
      await canvas.click({ position: { x: Math.min(box.width - 100, box.width * 0.55), y: Math.min(box.height - 100, box.height * 0.62) } });
      await canvas.click({ position: { x: Math.max(230, box.width * 0.30), y: Math.min(box.height - 100, box.height * 0.58) } });
      await page.keyboard.press("Enter");
      await page.getByText("Peça teste", { exact: true }).waitFor();
      await page.screenshot({ path: `${artifactDir}/desktop-drawn.png`, fullPage: true });

      await page.keyboard.press("Delete");
      await empty.waitFor({ state: "visible" });
      await page.keyboard.press("Control+z");
      await page.getByText("Peça teste", { exact: true }).waitFor();
      await page.keyboard.press("Control+y");
      await empty.waitFor({ state: "visible" });
      await page.screenshot({ path: `${artifactDir}/desktop-redone-empty.png`, fullPage: true });
    }

    if (errors.length) throw new Error(`${scenario.name}: erros no navegador: ${errors.join(" | ")}`);
    report.push({ scenario: scenario.name, initial, errors });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
''', encoding="utf-8")

(ROOT / "docs/progress/RECOVERY_GATE_BEFORE_PROMPT_10.md").write_text('''# Gate de recuperação antes do Prompt 10

## Regra de execução

O Prompt 10 permanece bloqueado. Cada etapa do Prompt 9.5 é desenvolvida em branch própria, recebe validação automatizada e visual, gera uma URL de preview e só pode ser mesclada após validação manual do usuário.

## Estado-base

- Commit-base da etapa de bancada vazia: `8366656d05cadd841a59a4c20029b5ecb4c0e0f2`.
- Branch: `recovery/9.5-03-empty-workspace`.
- Merge em `main`: pendente de validação manual.

## Etapa 03 — bancada vazia

### Regressão reproduzida

A biblioteca oferecia uma opção visual de projeto vazio, mas `parseGarmentDraft`, o Documento V3, o autosave e o store ainda exigiam pelo menos uma peça. Excluir a última peça também era bloqueado. A correção anterior substituiria o Canvas por uma tela vazia, impedindo desenhar a primeira peça.

### Causa

A invariável histórica “sempre existe uma peça ativa” estava duplicada no domínio, na serialização V3, na restauração, no histórico e na interface. O snapshot do motor era usado como fallback visual mesmo quando já não pertencia ao documento atual.

### Correção

- `pieces: []` e `patternDefinitions: []` passam a ser estados válidos.
- Autosave V3 omite `activePatternId` quando a bancada está vazia e restaura `activePieceId` como string vazia.
- Store carrega e restaura zero peças, limpa referências e permite excluir a última peça.
- Undo e redo atravessam corretamente o estado vazio.
- O Canvas permanece montado para permitir desenhar do zero.
- O snapshot antigo não é desenhado como peça fantasma.
- A interface apresenta estado vazio e ações para abrir moldes ou desenhar.
- O inspetor não exibe propriedades de uma peça inexistente.

### Testes

- `emptyWorkspace.test.ts`: carregamento vazio, seleção, exclusão da última peça, undo/redo, criação da primeira peça e remoção de referências.
- `emptyAutosave.test.ts`: round-trip do Documento V3 vazio e restauração de autosave sem peça ativa.
- `recovery-empty-workspace-visual.mjs`: desktop 1366×768 e mobile 390×844, criação vazia, desenho, exclusão, undo e redo.
- Typecheck, suíte completa e build de produção executados na branch.

### Evidência visual

Os screenshots são publicados como artifact do workflow `Recovery 9.5 Empty Workspace`. Eles apoiam a inspeção técnica, mas não substituem o teste manual do usuário.

### Preview e validação manual

- URL de preview: pendente após o commit validado da branch.
- Status: aguardando conclusão do workflow, inspeção visual e teste manual do usuário.

## Manequim visual — decisão já registrada para etapa futura

A etapa do manequim não será iniciada antes das etapas anteriores serem aprovadas. O visual usará modelos humanos prontos masculino e feminino, GLB ou glTF, com rig e licença fornecida pelo usuário. Cápsulas e elipsoides permanecerão apenas como colisores invisíveis. A arquitetura futura deverá separar malha visual e colisores e preparar `GLTFLoader`, escala, posicionamento, pose e fallback. Nenhum asset será escolhido, baixado ou incorporado sem aprovação explícita.
''', encoding="utf-8")
