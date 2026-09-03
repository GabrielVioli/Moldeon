from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EDITOR = ROOT / "apps/web/src/state/editorStore.ts"
CANVAS = ROOT / "apps/web/src/editor/PatternCanvasLegacy.tsx"
OVERLAY = ROOT / "apps/web/src/viewport/SewingViewportOverlay.ts"
VIEWPORT = ROOT / "apps/web/src/viewport/GlobalThreeViewport.ts"
GARMENT_VIEWPORT = ROOT / "apps/web/src/viewport/GarmentViewport.tsx"
ASSEMBLY_PANEL = ROOT / "apps/web/src/components/AssemblyPanel.tsx"
TOOLBAR = ROOT / "apps/web/src/components/Toolbar.tsx"
STYLES = ROOT / "apps/web/src/styles.css"
HISTORY_TEST = ROOT / "apps/web/src/state/assemblyHistory.test.ts"
ARC_TEST = ROOT / "apps/web/src/domain/sewingArcLengthAuthoring.test.ts"
DOC = ROOT / "docs/modifications-11.0.8.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return next_text


# ---------------------------------------------------------------------------
# editorStore: canonical transient authoring state for Segment / Free / chains.
# ---------------------------------------------------------------------------
text = EDITOR.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  seamDraft: {\n    first: EdgeRange[];\n    second: EdgeRange[];\n    activeSide: "first" | "second";\n    firstPanelInstanceIds?: string[];\n    secondPanelInstanceIds?: string[];\n  } | null;\n  seamFirstEdge: EdgeRange | null;\n''',
    '''  seamDraft: {\n    first: EdgeRange[];\n    second: EdgeRange[];\n    activeSide: "first" | "second";\n    firstPanelInstanceIds?: string[];\n    secondPanelInstanceIds?: string[];\n  } | null;\n  seamAuthoringMode: "segment" | "free";\n  seamChainMode: boolean;\n  seamFreeStart: { edge: EdgeRange; t: number; panelInstanceId?: string } | null;\n  seamFirstEdge: EdgeRange | null;\n''',
    "editor state sewing authoring fields",
)
text = replace_once(
    text,
    '''  proposeSeam(first: EdgeRange | EdgeRange[], second: EdgeRange | EdgeRange[]): void;\n  selectSeamRange(edge: EdgeRange, panelInstanceId?: string): void;\n  addSeamDraftRange(edge: EdgeRange): void;\n''',
    '''  proposeSeam(first: EdgeRange | EdgeRange[], second: EdgeRange | EdgeRange[]): void;\n  setSeamAuthoringMode(mode: "segment" | "free"): void;\n  setSeamChainMode(enabled: boolean): void;\n  selectSeamRange(edge: EdgeRange, panelInstanceId?: string, hitT?: number): void;\n  addSeamDraftRange(edge: EdgeRange, panelInstanceId?: string): void;\n''',
    "editor state sewing actions",
)
text = replace_once(
    text,
    '''  seamProposal: null,\n  seamDraft: null,\n  seamFirstEdge: null,\n''',
    '''  seamProposal: null,\n  seamDraft: null,\n  seamAuthoringMode: "segment",\n  seamChainMode: false,\n  seamFreeStart: null,\n  seamFirstEdge: null,\n''',
    "initial sewing authoring state",
)
text = replace_once(
    text,
    '''  restoreGarment: (garment, requestedPieceId, backend) => {\n    history.clear();\n''',
    '''  restoreGarment: (garment, requestedPieceId, backend) => {\n    history.clear();\n    set({ seamAuthoringMode: "segment", seamChainMode: false, seamFreeStart: null });\n''',
    "restore resets sewing authoring mode",
)
text = replace_once(
    text,
    '''  loadGarment: (garment) => {\n    history.clear();\n''',
    '''  loadGarment: (garment) => {\n    history.clear();\n    set({ seamAuthoringMode: "segment", seamChainMode: false, seamFreeStart: null });\n''',
    "load resets sewing authoring mode",
)
# Reset only the in-progress free endpoint whenever document state is reconstructed.
text = text.replace('        seamDraft: null,\n        seamFirstEdge: null,', '        seamDraft: null,\n        seamFreeStart: null,\n        seamFirstEdge: null,')
text = text.replace('    seamDraft: null,\n    seamFirstEdge: null,', '    seamDraft: null,\n    seamFreeStart: null,\n    seamFirstEdge: null,')

new_sewing_block = r'''  proposeSeam: (first, second) => set((state) => {
    const firstRanges = (Array.isArray(first) ? first : [first]).map((range) => ({ ...range }));
    const secondRanges = (Array.isArray(second) ? second : [second]).map((range) => ({ ...range }));
    if (!firstRanges[0] || !secondRanges[0]) return {};
    const physicalBindings = inferSeamProposalBindings(state.garment, firstRanges, secondRanges);
    return {
      seamProposal: {
        first: { ...firstRanges[0] },
        second: { ...secondRanges[0] },
        firstRanges,
        secondRanges,
        ...(physicalBindings ? { physicalBindings } : {}),
        compatibility: analyzeSeamCompatibility(state.garment, firstRanges, secondRanges),
      },
      seamIssues: [],
      seamDraft: null,
      seamFreeStart: null,
      seamFirstEdge: null,
    };
  }),
  setSeamAuthoringMode: (mode) => set((state) => state.seamAuthoringMode === mode ? {} : {
    seamAuthoringMode: mode,
    seamProposal: null,
    seamDraft: null,
    seamFreeStart: null,
    seamFirstEdge: null,
    seamIssues: [],
  }),
  setSeamChainMode: (enabled) => set((state) => state.seamChainMode === enabled ? {} : ({
    seamChainMode: enabled,
    seamProposal: null,
    seamDraft: null,
    seamFreeStart: null,
    seamFirstEdge: null,
    seamIssues: [],
  })),
  selectSeamRange: (edge, panelInstanceId, hitT) => set((state) => {
    if (state.seamAuthoringMode === "free") {
      const t = Math.max(0, Math.min(1, hitT ?? ((edge.startT + edge.endT) * 0.5)));
      const pending = state.seamFreeStart;
      const sameMaterialEdge = Boolean(
        pending
        && pending.edge.pieceId === edge.pieceId
        && pending.edge.edgeId === edge.edgeId
        && (!pending.panelInstanceId || !panelInstanceId || pending.panelInstanceId === panelInstanceId),
      );
      if (!pending || !sameMaterialEdge) {
        return {
          seamFreeStart: {
            edge: { ...edge, startT: t, endT: t },
            t,
            ...(panelInstanceId ? { panelInstanceId } : {}),
          },
          seamProposal: null,
          seamIssues: [],
        };
      }
      if (Math.abs(t - pending.t) <= 1e-4) return {};
      const completed: EdgeRange = {
        pieceId: edge.pieceId,
        edgeId: edge.edgeId,
        startT: Math.min(pending.t, t),
        endT: Math.max(pending.t, t),
      };
      return completeSeamRangeSelection(
        state,
        completed,
        pending.panelInstanceId ?? panelInstanceId,
        { seamFreeStart: null },
      );
    }
    return completeSeamRangeSelection(
      state,
      { ...edge, startT: 0, endT: 1 },
      panelInstanceId,
      { seamFreeStart: null },
    );
  }),
  addSeamDraftRange: (edge, panelInstanceId) => set((state) => {
    const next = appendRangeToSeamDraft(state.seamDraft, edge, panelInstanceId);
    if (next === state.seamDraft) return {};
    return {
      seamDraft: next,
      seamFirstEdge: next.first[0] ?? null,
      seamProposal: null,
      seamFreeStart: null,
      seamIssues: [],
    };
  }),
  finishSeamDraftSide: () => set((state) => {
    if (!state.seamDraft || state.seamDraft.first.length === 0 || state.seamDraft.activeSide !== "first") return {};
    return { seamDraft: { ...state.seamDraft, activeSide: "second" }, seamFreeStart: null, seamIssues: [] };
  }),
  reviewSeamDraft: () => set((state) => {
    const draft = state.seamDraft;
    if (!draft || draft.first.length === 0 || draft.second.length === 0) return {};
    const physicalBindings = inferSeamProposalBindings(
      state.garment,
      draft.first,
      draft.second,
      draft.firstPanelInstanceIds,
      draft.secondPanelInstanceIds,
    );
    return {
      seamProposal: {
        first: { ...draft.first[0] },
        second: { ...draft.second[0] },
        firstRanges: structuredClone(draft.first),
        secondRanges: structuredClone(draft.second),
        ...(physicalBindings ? { physicalBindings } : {}),
        compatibility: analyzeSeamCompatibility(state.garment, draft.first, draft.second),
      },
      seamDraft: null,
      seamFreeStart: null,
      seamFirstEdge: null,
      seamIssues: [],
    };
  }),
'''
text = regex_replace_once(
    text,
    r'  proposeSeam: \(first, second\) => set\(\(state\) => \{.*?\n  selectFirstSeamEdge:',
    new_sewing_block + '  selectFirstSeamEdge:',
    "replace sewing authoring implementation",
)
text = replace_once(
    text,
    '''  selectFirstSeamEdge: (seamFirstEdge) => set({\n    seamFirstEdge,\n    seamDraft: seamFirstEdge ? { first: [{ ...seamFirstEdge }], second: [], activeSide: "first" } : null,\n    seamProposal: null,\n  }),\n''',
    '''  selectFirstSeamEdge: (seamFirstEdge) => set({\n    seamFirstEdge,\n    seamDraft: seamFirstEdge ? { first: [{ ...seamFirstEdge }], second: [], activeSide: "first" } : null,\n    seamProposal: null,\n    seamFreeStart: null,\n  }),\n''',
    "select first seam edge clears free endpoint",
)
text = replace_once(
    text,
    '  cancelSeamProposal: () => set({ seamProposal: null, seamDraft: null, seamFirstEdge: null }),\n',
    '  cancelSeamProposal: () => set({ seamProposal: null, seamDraft: null, seamFreeStart: null, seamFirstEdge: null }),\n',
    "cancel seam proposal clears free endpoint",
)
text = replace_once(
    text,
    '  cancelIntent: () => set({ seamProposal: null, seamDraft: null, seamFirstEdge: null, nearbySeamSuggestion: null, seamIssues: [], cutDraft: null, dartDraft: null, measureDraft: null }),\n',
    '  cancelIntent: () => set({ seamProposal: null, seamDraft: null, seamFreeStart: null, seamFirstEdge: null, nearbySeamSuggestion: null, seamIssues: [], cutDraft: null, dartDraft: null, measureDraft: null }),\n',
    "cancel intent clears free endpoint",
)
helper_block = r'''
function completeSeamRangeSelection(
  state: EditorState,
  edge: EdgeRange,
  panelInstanceId?: string,
  additional: Partial<EditorState> = {},
): Partial<EditorState> {
  if (state.seamChainMode) {
    const next = appendRangeToSeamDraft(state.seamDraft, edge, panelInstanceId);
    return {
      ...additional,
      seamDraft: next,
      seamFirstEdge: next.first[0] ?? null,
      seamProposal: null,
      seamIssues: [],
    };
  }

  const draft = state.seamDraft;
  if (!draft) {
    return {
      ...additional,
      seamDraft: {
        first: [{ ...edge }],
        second: [],
        activeSide: "second",
        ...(panelInstanceId ? { firstPanelInstanceIds: [panelInstanceId] } : {}),
      },
      seamFirstEdge: { ...edge },
      seamProposal: null,
      seamIssues: [],
    };
  }
  if (draft.activeSide !== "second" || draft.first.length === 0) return additional;
  const secondRanges = [{ ...edge }];
  const secondPanelInstanceIds = panelInstanceId ? [panelInstanceId] : undefined;
  const physicalBindings = inferSeamProposalBindings(
    state.garment,
    draft.first,
    secondRanges,
    draft.firstPanelInstanceIds,
    secondPanelInstanceIds,
  );
  return {
    ...additional,
    seamProposal: {
      first: { ...draft.first[0] },
      second: { ...edge },
      firstRanges: structuredClone(draft.first),
      secondRanges,
      ...(physicalBindings ? { physicalBindings } : {}),
      compatibility: analyzeSeamCompatibility(state.garment, draft.first, secondRanges),
    },
    seamIssues: [],
    seamDraft: null,
    seamFirstEdge: null,
  };
}

function appendRangeToSeamDraft(
  draft: EditorState["seamDraft"],
  edge: EdgeRange,
  panelInstanceId?: string,
): NonNullable<EditorState["seamDraft"]> {
  const base = draft ?? { first: [], second: [], activeSide: "first" as const };
  if (base.activeSide === "first") {
    if (base.first.some((range) => sameEdgeRange(range, edge))) return base;
    const firstPanelInstanceIds = appendAlignedInstanceId(
      base.first,
      base.firstPanelInstanceIds,
      panelInstanceId,
    );
    return {
      ...base,
      first: [...base.first, { ...edge }],
      ...(firstPanelInstanceIds ? { firstPanelInstanceIds } : {}),
    };
  }
  if (base.second.some((range) => sameEdgeRange(range, edge))) return base;
  const secondPanelInstanceIds = appendAlignedInstanceId(
    base.second,
    base.secondPanelInstanceIds,
    panelInstanceId,
  );
  return {
    ...base,
    second: [...base.second, { ...edge }],
    ...(secondPanelInstanceIds ? { secondPanelInstanceIds } : {}),
  };
}

function appendAlignedInstanceId(
  ranges: readonly EdgeRange[],
  current: readonly string[] | undefined,
  panelInstanceId: string | undefined,
): string[] | undefined {
  if (!current && !panelInstanceId) return undefined;
  const result = ranges.map((_, index) => current?.[index] ?? "");
  result.push(panelInstanceId ?? "");
  return result;
}
'''
text = replace_once(
    text,
    '''function inferSeamProposalBindings(\n''',
    helper_block + '\nfunction inferSeamProposalBindings(\n',
    "insert sewing authoring helpers",
)
EDITOR.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# 2D canvas: pass the exact edge-local t to Free Sewing.
# ---------------------------------------------------------------------------
text = CANVAS.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  function findEdgeRangeAt(clientX: number, clientY: number): EdgeRange | null {\n    const currentGarment = useEditorStore.getState().garment;\n    return findNearestEdgeHit(\n      currentGarment,\n      screenToWorld(clientX, clientY),\n      18 / cameraRef.current.zoom,\n    )?.range ?? null;\n  }\n''',
    '''  function findEdgeHitAt(clientX: number, clientY: number) {\n    const currentGarment = useEditorStore.getState().garment;\n    return findNearestEdgeHit(\n      currentGarment,\n      screenToWorld(clientX, clientY),\n      18 / cameraRef.current.zoom,\n    );\n  }\n\n  function findEdgeRangeAt(clientX: number, clientY: number): EdgeRange | null {\n    return findEdgeHitAt(clientX, clientY)?.range ?? null;\n  }\n''',
    "2D exact edge hit helper",
)
text = replace_once(
    text,
    '''    if (toolRef.current === "seam") {\n      const edge = findEdgeRangeAt(event.clientX, event.clientY);\n      if (!edge) {\n        const world = screenToWorld(event.clientX, event.clientY);\n        const piece = findPieceAtWorld(world.xMm, world.yMm);\n        if (piece) event.shiftKey ? useEditorStore.getState().togglePieceSelection(piece.id) : selectPiece(piece.id);\n        dragRef.current = null;\n        return;\n      }\n      useEditorStore.getState().selectSeamRange(edge);\n      scheduleDraw();\n      return;\n    }\n''',
    '''    if (toolRef.current === "seam") {\n      const edgeHit = findEdgeHitAt(event.clientX, event.clientY);\n      if (!edgeHit) {\n        const world = screenToWorld(event.clientX, event.clientY);\n        const piece = findPieceAtWorld(world.xMm, world.yMm);\n        if (piece) event.shiftKey ? useEditorStore.getState().togglePieceSelection(piece.id) : selectPiece(piece.id);\n        dragRef.current = null;\n        return;\n      }\n      useEditorStore.getState().selectSeamRange(edgeHit.range, undefined, edgeHit.t);\n      scheduleDraw();\n      return;\n    }\n''',
    "2D seam selection passes t",
)
CANVAS.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# 3D overlay: resolve exact t from the hit point without changing material ID.
# ---------------------------------------------------------------------------
text = OVERLAY.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  edgeAtIntersection(intersection: THREE.Intersection): { range: EdgeRange; panelInstanceId: string; segmentIndex: number } | null {\n    if (intersection.object !== this.edgeLines || intersection.index === undefined) return null;\n    const segmentIndex = Math.floor(intersection.index / 2);\n    const segment = this.edgeSegments[segmentIndex];\n    return segment ? {\n      range: { ...segment.edge, startT: 0, endT: 1 },\n      panelInstanceId: segment.mesh.key,\n      segmentIndex,\n    } : null;\n  }\n''',
    '''  edgeAtIntersection(intersection: THREE.Intersection): { range: EdgeRange; panelInstanceId: string; segmentIndex: number; t: number } | null {\n    if (intersection.object !== this.edgeLines || intersection.index === undefined) return null;\n    const segmentIndex = Math.floor(intersection.index / 2);\n    const segment = this.edgeSegments[segmentIndex];\n    return segment ? {\n      range: { ...segment.edge, startT: 0, endT: 1 },\n      panelInstanceId: segment.mesh.key,\n      segmentIndex,\n      t: edgeIntersectionT(intersection.point, segment),\n    } : null;\n  }\n''',
    "3D edge hit includes t",
)
edge_hit_helper = r'''
function edgeIntersectionT(point: THREE.Vector3, segment: EdgeSegment): number {
  segment.mesh.mesh.updateMatrixWorld(true);
  const source = segment.mesh.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const first = new THREE.Vector3()
    .fromBufferAttribute(source, segment.firstVertex)
    .applyMatrix4(segment.mesh.mesh.matrixWorld);
  const second = new THREE.Vector3()
    .fromBufferAttribute(source, segment.secondVertex)
    .applyMatrix4(segment.mesh.mesh.matrixWorld);
  const delta = second.clone().sub(first);
  const denominator = delta.lengthSq();
  const alpha = denominator <= 1e-12
    ? 0
    : THREE.MathUtils.clamp(point.clone().sub(first).dot(delta) / denominator, 0, 1);
  return segment.edge.startT + (segment.edge.endT - segment.edge.startT) * alpha;
}

'''
text = replace_once(
    text,
    'function writeEdgePositions(geometry: THREE.BufferGeometry, segments: readonly EdgeSegment[]): void {\n',
    edge_hit_helper + 'function writeEdgePositions(geometry: THREE.BufferGeometry, segments: readonly EdgeSegment[]): void {\n',
    "insert 3D edge hit interpolation",
)
OVERLAY.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Viewport bridge: preserve t through 3D -> editorStore.
# ---------------------------------------------------------------------------
text = VIEWPORT.read_text(encoding="utf-8")
text = replace_once(
    text,
    '  private sewingEdgeSelectHandler?: (range: EdgeRange, panelInstanceId: string) => void;\n',
    '  private sewingEdgeSelectHandler?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void;\n',
    "viewport sewing handler type",
)
text = replace_once(
    text,
    '    onEdgeSelect?: (range: EdgeRange, panelInstanceId: string) => void,\n',
    '    onEdgeSelect?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void,\n',
    "setSewingState handler type",
)
text = replace_once(
    text,
    '        this.sewingEdgeSelectHandler?.(edge.range, edge.panelInstanceId);\n',
    '        this.sewingEdgeSelectHandler?.(edge.range, edge.panelInstanceId, edge.t);\n',
    "3D edge selection forwards t",
)
VIEWPORT.write_text(text, encoding="utf-8")

text = GARMENT_VIEWPORT.read_text(encoding="utf-8")
text = text.replace(
    '(range, panelInstanceId) => useEditorStore.getState().selectSeamRange(range, panelInstanceId)',
    '(range, panelInstanceId, hitT) => useEditorStore.getState().selectSeamRange(range, panelInstanceId, hitT)',
)
if text.count('selectSeamRange(range, panelInstanceId, hitT)') != 2:
    raise RuntimeError("GarmentViewport expected two 3D sewing callbacks")
GARMENT_VIEWPORT.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Toolbar exit is also a clean cancel of transient sewing authoring.
# ---------------------------------------------------------------------------
text = TOOLBAR.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''    if (tool === "seam" && activeTool === "seam") {\n      onSelectTool("select");\n      return;\n    }\n''',
    '''    if (tool === "seam" && activeTool === "seam") {\n      useEditorStore.getState().cancelSeamProposal();\n      onSelectTool("select");\n      return;\n    }\n''',
    "sewing exit clears transient draft",
)
TOOLBAR.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# AssemblyPanel: compact Segment/Free + multi-range chain controls.
# ---------------------------------------------------------------------------
text = ASSEMBLY_PANEL.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  getPatternEdges,\n  type SeamDistribution,\n''',
    '''  edgeRangeSequenceLength,\n  getPatternEdges,\n  type SeamDistribution,\n''',
    "AssemblyPanel arc length import",
)
text = replace_once(
    text,
    '''  const cancelProposal = useEditorStore((state) => state.cancelSeamProposal);\n  const confirmProposal = useEditorStore((state) => state.confirmSeamProposal);\n''',
    '''  const cancelProposal = useEditorStore((state) => state.cancelSeamProposal);\n  const confirmProposal = useEditorStore((state) => state.confirmSeamProposal);\n  const seamDraft = useEditorStore((state) => state.seamDraft);\n  const seamAuthoringMode = useEditorStore((state) => state.seamAuthoringMode);\n  const seamChainMode = useEditorStore((state) => state.seamChainMode);\n  const seamFreeStart = useEditorStore((state) => state.seamFreeStart);\n  const setSeamAuthoringMode = useEditorStore((state) => state.setSeamAuthoringMode);\n  const setSeamChainMode = useEditorStore((state) => state.setSeamChainMode);\n  const finishSeamDraftSide = useEditorStore((state) => state.finishSeamDraftSide);\n  const reviewSeamDraft = useEditorStore((state) => state.reviewSeamDraft);\n''',
    "AssemblyPanel sewing state selectors",
)
text = replace_once(
    text,
    '''  const seamGroups = groupSeamsByRelation(garment.seams);\n\n  return (\n''',
    '''  const seamGroups = groupSeamsByRelation(garment.seams);\n  const firstDraftLengthMm = seamDraft ? edgeRangeSequenceLength(garment.pieces, seamDraft.first) : 0;\n  const secondDraftLengthMm = seamDraft ? edgeRangeSequenceLength(garment.pieces, seamDraft.second) : 0;\n\n  return (\n''',
    "AssemblyPanel draft length metrics",
)
authoring_ui = r'''
      {!proposal ? (
        <section className="sewing-authoring-strip" aria-label="Configuração da ferramenta Costurar">
          <div className="sewing-authoring-modes" role="group" aria-label="Tipo de seleção de costura">
            <button
              type="button"
              className={seamAuthoringMode === "segment" ? "active" : ""}
              aria-pressed={seamAuthoringMode === "segment"}
              onClick={() => setSeamAuthoringMode("segment")}
            >Segmento</button>
            <button
              type="button"
              className={seamAuthoringMode === "free" ? "active" : ""}
              aria-pressed={seamAuthoringMode === "free"}
              onClick={() => setSeamAuthoringMode("free")}
            >Livre</button>
            <button
              type="button"
              className={seamChainMode ? "active" : ""}
              aria-pressed={seamChainMode}
              onClick={() => setSeamChainMode(!seamChainMode)}
            >Vários trechos</button>
          </div>
          <small className="sewing-authoring-help">
            {seamAuthoringMode === "free"
              ? seamFreeStart
                ? `Início marcado em ${Math.round(seamFreeStart.t * 100)}%. Toque novamente na mesma borda para fechar a faixa.`
                : "Livre: dois toques na mesma borda definem início e fim do EdgeRange."
              : "Segmento: um toque seleciona a borda material inteira."}
          </small>
          {seamChainMode ? (
            <div className="sewing-chain-status" role="status">
              <span>
                Lado A: {seamDraft?.first.length ?? 0} trecho(s) · {(firstDraftLengthMm / 10).toFixed(1)} cm
              </span>
              <span>
                Lado B: {seamDraft?.second.length ?? 0} trecho(s) · {(secondDraftLengthMm / 10).toFixed(1)} cm
              </span>
              <div>
                {seamDraft?.activeSide === "first" || !seamDraft ? (
                  <button type="button" disabled={!seamDraft?.first.length} onClick={finishSeamDraftSide}>
                    Concluir lado A
                  </button>
                ) : (
                  <button type="button" disabled={!seamDraft.second.length} onClick={reviewSeamDraft}>
                    Revisar costura
                  </button>
                )}
                <button type="button" onClick={cancelProposal}>Cancelar seleção</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

'''
text = replace_once(
    text,
    '''      <section className="assembly-section">\n        <h3>Costuras</h3>\n''',
    authoring_ui + '      <section className="assembly-section">\n        <h3>Costuras</h3>\n',
    "insert sewing authoring controls",
)
ASSEMBLY_PANEL.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Styling: compact controls, mobile-safe hit targets without covering canvas.
# ---------------------------------------------------------------------------
styles = STYLES.read_text(encoding="utf-8")
marker = "/* 11.0.8 sewing F-H authoring controls */"
if marker not in styles:
    styles += r'''

/* 11.0.8 sewing F-H authoring controls */
.sewing-authoring-strip {
  display: grid;
  gap: 8px;
  margin: 8px 0 12px;
  padding: 10px;
  border: 1px solid #c9c1b6;
  border-radius: 10px;
  background: #f8f5f0;
}
.sewing-authoring-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sewing-authoring-modes button {
  min-height: 34px;
  padding: 6px 10px;
}
.sewing-authoring-modes button.active {
  border-color: #4f6678;
  background: #e8eef2;
  box-shadow: inset 0 0 0 1px #4f6678;
}
.sewing-authoring-help {
  color: #5f5850;
  line-height: 1.35;
}
.sewing-chain-status {
  display: grid;
  gap: 5px;
  padding-top: 7px;
  border-top: 1px solid #d9d1c6;
  font-size: 12px;
}
.sewing-chain-status > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
@media (max-width: 760px) {
  .sewing-authoring-strip {
    margin: 6px 0 9px;
    padding: 8px;
  }
  .sewing-authoring-modes button,
  .sewing-chain-status button {
    min-height: 44px;
    flex: 1 1 auto;
  }
  .sewing-authoring-help {
    font-size: 11px;
  }
}
'''
STYLES.write_text(styles, encoding="utf-8")


# ---------------------------------------------------------------------------
# Focused regression tests: Free Sewing and chain 1:N / N:M authoring.
# ---------------------------------------------------------------------------
history = HISTORY_TEST.read_text(encoding="utf-8")
insert_at = history.rfind("\n});")
if insert_at < 0:
    raise RuntimeError("assemblyHistory.test.ts describe terminator not found")
new_tests = r'''

  it("authors equal-length partial ranges with Free Sewing two-tap selection", () => {
    const state = useEditorStore.getState();
    const firstEdge = getPatternEdges(state.garment.pieces[0])[0];
    const secondEdge = getPatternEdges(state.garment.pieces[1])[0];
    const first = { pieceId: "a", edgeId: firstEdge.id, startT: 0, endT: 1 };
    const second = { pieceId: "b", edgeId: secondEdge.id, startT: 0, endT: 1 };
    const firstInstance = createPanelInstanceId("a", 0);
    const secondInstance = createPanelInstanceId("b", 0);

    state.setSeamAuthoringMode("free");
    useEditorStore.getState().selectSeamRange(first, firstInstance, 0.2);
    expect(useEditorStore.getState().seamFreeStart?.t).toBeCloseTo(0.2);
    useEditorStore.getState().selectSeamRange(first, firstInstance, 0.8);
    expect(useEditorStore.getState().seamDraft).toMatchObject({
      first: [{ pieceId: "a", edgeId: firstEdge.id, startT: 0.2, endT: 0.8 }],
      activeSide: "second",
    });

    useEditorStore.getState().selectSeamRange(second, secondInstance, 0.1);
    useEditorStore.getState().selectSeamRange(second, secondInstance, 0.7);
    const proposal = useEditorStore.getState().seamProposal;
    expect(proposal?.firstRanges?.[0]).toMatchObject({ startT: 0.2, endT: 0.8 });
    expect(proposal?.secondRanges?.[0]).toMatchObject({ startT: 0.1, endT: 0.7 });
    expect(proposal?.compatibility.firstLengthMm).toBeCloseTo(60, 5);
    expect(proposal?.compatibility.secondLengthMm).toBeCloseTo(60, 5);

    useEditorStore.getState().confirmSeamProposal({ name: "Livre", direction: "same", treatment: "standard" });
    const seam = useEditorStore.getState().garment.seams?.[0];
    expect(seamSideRanges(seam!, "first")[0]).toMatchObject({ startT: 0.2, endT: 0.8 });
    expect(seamSideRanges(seam!, "second")[0]).toMatchObject({ startT: 0.1, endT: 0.7 });
    expect(seam?.physicalBindings?.[0]).toMatchObject({
      first: [{ patternId: "a", panelInstanceId: firstInstance }],
      second: [{ patternId: "b", panelInstanceId: secondInstance }],
    });
  });

  it("authors an ordered N:M chain through the shared click flow", () => {
    const state = useEditorStore.getState();
    const firstEdges = getPatternEdges(state.garment.pieces[0]);
    const secondEdges = getPatternEdges(state.garment.pieces[1]);
    const firstInstance = createPanelInstanceId("a", 0);
    const secondInstance = createPanelInstanceId("b", 0);

    state.setSeamChainMode(true);
    useEditorStore.getState().selectSeamRange({ pieceId: "a", edgeId: firstEdges[0].id, startT: 0, endT: 1 }, firstInstance);
    useEditorStore.getState().selectSeamRange({ pieceId: "a", edgeId: firstEdges[1].id, startT: 0, endT: 1 }, firstInstance);
    expect(useEditorStore.getState().seamDraft?.first).toHaveLength(2);
    useEditorStore.getState().finishSeamDraftSide();
    useEditorStore.getState().selectSeamRange({ pieceId: "b", edgeId: secondEdges[2].id, startT: 0, endT: 1 }, secondInstance);
    useEditorStore.getState().selectSeamRange({ pieceId: "b", edgeId: secondEdges[3].id, startT: 0, endT: 1 }, secondInstance);
    useEditorStore.getState().reviewSeamDraft();

    expect(useEditorStore.getState().seamProposal?.firstRanges).toHaveLength(2);
    expect(useEditorStore.getState().seamProposal?.secondRanges).toHaveLength(2);
    useEditorStore.getState().confirmSeamProposal({ name: "N:M", direction: "opposite", treatment: "standard" });
    const seam = useEditorStore.getState().garment.seams?.[0];
    expect(seamSideRanges(seam!, "first").map((range) => range.edgeId)).toEqual([firstEdges[0].id, firstEdges[1].id]);
    expect(seamSideRanges(seam!, "second").map((range) => range.edgeId)).toEqual([secondEdges[2].id, secondEdges[3].id]);
  });

  it("authors a length-matched 1:N chain by combining Free Sewing with multiple ranges", () => {
    const state = useEditorStore.getState();
    const firstEdge = getPatternEdges(state.garment.pieces[0])[0];
    const secondEdges = getPatternEdges(state.garment.pieces[1]);
    const firstInstance = createPanelInstanceId("a", 0);
    const secondInstance = createPanelInstanceId("b", 0);

    state.setSeamAuthoringMode("free");
    useEditorStore.getState().setSeamChainMode(true);
    useEditorStore.getState().selectSeamRange({ pieceId: "a", edgeId: firstEdge.id, startT: 0, endT: 1 }, firstInstance, 0);
    useEditorStore.getState().selectSeamRange({ pieceId: "a", edgeId: firstEdge.id, startT: 0, endT: 1 }, firstInstance, 1);
    useEditorStore.getState().finishSeamDraftSide();
    for (const edge of [secondEdges[2], secondEdges[3]]) {
      const range = { pieceId: "b", edgeId: edge.id, startT: 0, endT: 1 };
      useEditorStore.getState().selectSeamRange(range, secondInstance, 0);
      useEditorStore.getState().selectSeamRange(range, secondInstance, 0.5);
    }
    useEditorStore.getState().reviewSeamDraft();
    const proposal = useEditorStore.getState().seamProposal;
    expect(proposal?.firstRanges).toHaveLength(1);
    expect(proposal?.secondRanges).toHaveLength(2);
    expect(proposal?.compatibility.firstLengthMm).toBeCloseTo(100, 5);
    expect(proposal?.compatibility.secondLengthMm).toBeCloseTo(100, 5);
  });
'''
history = history[:insert_at] + new_tests + history[insert_at:]
HISTORY_TEST.write_text(history, encoding="utf-8")

ARC_TEST.write_text(r'''import { describe, expect, it } from "vitest";
import {
  edgeRangeSequenceLength,
  getPatternEdges,
  resolveEdgeRangeSequenceProgress,
  type PatternPiece,
} from "./pattern";

function square(): PatternPiece {
  return {
    id: "piece",
    name: "Quadrado",
    seamAllowanceMm: 10,
    points: [
      { id: "a", xMm: 0, yMm: 0 },
      { id: "b", xMm: 100, yMm: 0 },
      { id: "c", xMm: 100, yMm: 100 },
      { id: "d", xMm: 0, yMm: 100 },
    ],
  };
}

describe("11.0.8 sewing arc-length authoring", () => {
  it("measures only the authored partial range", () => {
    const piece = square();
    const edge = getPatternEdges(piece)[0];
    expect(edgeRangeSequenceLength([piece], [{
      pieceId: piece.id,
      edgeId: edge.id,
      startT: 0.25,
      endT: 0.75,
    }])).toBeCloseTo(50, 5);
  });

  it("resolves progress over the accumulated material length of an ordered chain", () => {
    const piece = square();
    const edges = getPatternEdges(piece);
    const ranges = [
      { pieceId: piece.id, edgeId: edges[0].id, startT: 0.25, endT: 0.75 },
      { pieceId: piece.id, edgeId: edges[1].id, startT: 0, endT: 1 },
    ];
    expect(edgeRangeSequenceLength([piece], ranges)).toBeCloseTo(150, 5);
    const inFirst = resolveEdgeRangeSequenceProgress([piece], ranges, 1 / 6);
    expect(inFirst?.rangeIndex).toBe(0);
    expect(inFirst?.t).toBeCloseTo(0.5, 5);
    const inSecond = resolveEdgeRangeSequenceProgress([piece], ranges, 2 / 3);
    expect(inSecond?.rangeIndex).toBe(1);
    expect(inSecond?.t).toBeCloseTo(0.5, 5);
  });

  it("maps same and opposite correspondence from the same global progress", () => {
    const piece = square();
    const edge = getPatternEdges(piece)[0];
    const ranges = [{ pieceId: piece.id, edgeId: edge.id, startT: 0.1, endT: 0.9 }];
    const progress = 0.25;
    const same = resolveEdgeRangeSequenceProgress([piece], ranges, progress);
    const opposite = resolveEdgeRangeSequenceProgress([piece], ranges, 1 - progress);
    expect(same?.t).toBeCloseTo(0.3, 5);
    expect(opposite?.t).toBeCloseTo(0.7, 5);
  });
});
''', encoding="utf-8")


# ---------------------------------------------------------------------------
# Handoff: record that F-H are implemented but awaiting a visual/manual gate.
# ---------------------------------------------------------------------------
doc = DOC.read_text(encoding="utf-8")
section = r'''

## Fases F–H implementadas para gate manual

Após a aceitação visual da Fase E, o authoring foi ampliado sem tocar `physics/**`:

- **Fase F — arc-length + ranges parciais:** o hit 2D e o hit 3D agora preservam o parâmetro `t` exato da borda material; ranges parciais continuam usando `EdgeRange(startT/endT)` e o compiler físico existente continua resolvendo a correspondência pelo comprimento acumulado da chain.
- **Fase G — Free Sewing:** modo `Livre` usa dois toques/clicks na mesma borda para marcar início e fim. O range resultante é canônico, funciona em 2D ou 3D e preserva `PanelInstanceV3` quando a seleção veio do 3D.
- **Fase H — 1:N / N:M:** modo `Vários trechos` mantém Side A aberto até `Concluir lado A`, acumula Side B e usa `Revisar costura` antes do commit. Ordem autoral dos `EdgeRange[]` é preservada e os bindings físicos permanecem explícitos.
- Segment Sewing rápido 1:1 continua sendo o caminho padrão e não ganhou passos extras.
- Sair de `Costurar` agora também limpa draft/proposal/free-endpoint transitórios, sem alterar seams já confirmadas.
- UI mostra comprimento material acumulado de A/B durante chains e feedback do primeiro endpoint no Free Sewing.

Gate humano necessário antes de Fase I/J:

1. Segmento 1:1 continua funcionando em dois clicks/taps.
2. Livre: dois pontos na mesma borda produzem apenas o subrange entre eles.
3. Testar Livre 2D→3D e 3D→2D.
4. `Vários trechos`: 1:N e N:M preservam a ordem visual e geram threads coerentes.
5. `same/opposite` e `Inverter direção` continuam coerentes após ranges parciais/chains.
6. Threads não aparecem fora dos ranges selecionados.
7. Painéis costurados continuam se movendo juntos; componentes não relacionados continuam independentes.
8. Costurar continua com XPBD OFF.

Não iniciar STEP-0 antes deste gate.
'''
if "## Fases F–H implementadas para gate manual" not in doc:
    doc += section
DOC.write_text(doc, encoding="utf-8")

print("Applied Moldeon 11.0.8 phases F-H: partial arc-length authoring, Free Sewing and ordered chains")
