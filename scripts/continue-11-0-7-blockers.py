from pathlib import Path
import re
import subprocess


def sub_once(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}")
    file.write_text(next_text)


history = "apps/web/src/state/documentCommandHistory.ts"
sub_once(
    history,
    r'  undo\(\): EditorDocumentState \| null \{',
    '''  recordImmutable(
    type: DocumentCommandType,
    label: string,
    before: EditorDocumentState,
    after: EditorDocumentState,
  ): boolean {
    if (this.transaction
      || (before.garment === after.garment && before.activePieceId === after.activePieceId)) return false;
    const command = createImmutableCommand(type, label, before, after);
    this.past.push(command);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    return true;
  }

  undo(): EditorDocumentState | null {''',
)
sub_once(
    history,
    r'function cloneState\(state: EditorDocumentState\): EditorDocumentState \{',
    '''function createImmutableCommand(
  type: DocumentCommandType,
  label: string,
  before: EditorDocumentState,
  after: EditorDocumentState,
): DocumentCommand {
  return {
    type,
    label,
    before,
    after,
    undo: () => before,
    redo: () => after,
  };
}

function cloneState(state: EditorDocumentState): EditorDocumentState {''',
)

store = "apps/web/src/state/editorStore.ts"
sub_once(
    store,
    r'  setPanelInstanceArrangements: \(updates\) => \{.*?\n  \},\n  confirmPanelInstanceArrangement:',
    '''  setPanelInstanceArrangements: (updates) => {
    if (updates.length === 0) return;
    const state = get();
    const validPieceIds = new Set(state.garment.pieces.map((piece) => piece.id));
    const byPiece = new Map<string, Map<string, PatternPreviewPlacement>>();
    for (const update of updates) {
      if (!validPieceIds.has(update.pieceId)) continue;
      const instanceId = createPanelInstanceId(update.pieceId, update.copyIndex);
      const placements = byPiece.get(update.pieceId) ?? new Map<string, PatternPreviewPlacement>();
      placements.set(instanceId, {
        ...structuredClone(update.placement),
        id: instanceId,
        pieceId: update.pieceId,
        scale: 1,
        presentationMode: "authored",
      });
      byPiece.set(update.pieceId, placements);
    }
    if (byPiece.size === 0) return;

    const pieces = state.garment.pieces.map((piece) => {
      const updatesForPiece = byPiece.get(piece.id);
      if (!updatesForPiece) return piece;
      const placements = (piece.previewPlacements ?? [])
        .filter((candidate) => !updatesForPiece.has(candidate.id));
      placements.push(...updatesForPiece.values());
      placements.sort((left, right) => left.id.localeCompare(right.id));
      return { ...piece, previewPlacements: placements };
    });
    const garment = { ...state.garment, pieces };
    history.recordImmutable(
      "placement",
      "Posicionar instância(s) no 3D",
      { garment: state.garment, activePieceId: state.activePieceId },
      { garment, activePieceId: state.activePieceId },
    );
    const previousActivePiece = state.garment.pieces.find((piece) => piece.id === state.activePieceId);
    const nextActivePiece = pieces.find((piece) => piece.id === state.activePieceId);
    set({
      garment,
      ...(previousActivePiece && nextActivePiece && previousActivePiece !== nextActivePiece
        ? { snapshot: { ...state.snapshot, piece: { ...state.snapshot.piece, previewPlacements: nextActivePiece.previewPlacements } } }
        : {}),
      ...historyAvailability(),
    });
  },
  confirmPanelInstanceArrangement:''',
)

viewport = "apps/web/src/viewport/GlobalThreeViewport.ts"
sub_once(
    viewport,
    r'  updateWorkspaceArrangement\(input: ResolvedAssemblyInput\): void \{\n    this\.currentInput = input;\n    if \(this\.viewportMode !== "assembly"\) return;',
    '''  updateWorkspaceArrangement(
    input: ResolvedAssemblyInput,
    options: { transformOnly?: boolean } = {},
  ): void {
    this.currentInput = input;
    if (this.viewportMode !== "assembly") return;
    if (options.transformOnly) {
      this.host.dataset.arrangementRevision = input.arrangementRevision;
      this.host.dataset.arrangementXpbdInitializations = "0";
      this.host.dataset.arrangementCommitPath = "transform-only";
      this.requestRender();
      return;
    }
    delete this.host.dataset.arrangementCommitPath;''',
)

component = "apps/web/src/viewport/GarmentViewport.tsx"
sub_once(
    component,
    r'  const arrangementCommitRef = useRef\(onArrangementCommit\);',
    '''  const arrangementCommitRef = useRef(onArrangementCommit);
  const pendingArrangementCommitsRef = useRef<ArrangementCommit[] | null>(null);''',
)
sub_once(
    component,
    r'        viewport\.setArrangementInteractionHandlers\(\n          \(commits\) => arrangementCommitRef\.current\?\.\(commits\),',
    '''        viewport.setArrangementInteractionHandlers(
          (commits) => {
            const handler = arrangementCommitRef.current;
            if (!handler || commits.length === 0) return;
            pendingArrangementCommitsRef.current = commits;
            handler(commits);
          },''',
)
sub_once(
    component,
    r'  useEffect\(\(\) => \{\n    if \(!active \|\| displayMode !== "side-preview"\) return;\n    viewportRef\.current\?\.updateWorkspaceArrangement\(assemblyInput\);\n  \}, \[active, assemblyInput\.arrangementRevision, displayMode\]\);',
    '''  useEffect(() => {
    if (!active || displayMode !== "side-preview") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pending = pendingArrangementCommitsRef.current;
    pendingArrangementCommitsRef.current = null;
    viewport.updateWorkspaceArrangement(assemblyInput, {
      transformOnly: Boolean(pending && arrangementCommitsMatchInput(assemblyInput, pending)),
    });
  }, [active, assemblyInput.arrangementRevision, displayMode]);''',
)
sub_once(
    component,
    r'  useEffect\(\(\) => \{\n    if \(!active\) return;\n    const frame = window\.requestAnimationFrame\(\(\) => viewportRef\.current\?\.refresh\(\)\);\n    return \(\) => window\.cancelAnimationFrame\(frame\);\n  \}, \[active, displayMode\]\);',
    '''  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => viewportRef.current?.refresh());
    return () => window.cancelAnimationFrame(frame);
  }, [active, displayMode]);

  useEffect(() => {
    const host = hostRef.current;
    const workspace = host?.closest(".workspace") as HTMLElement | null;
    if (!host || !workspace || !active) return;
    let frame: number | null = null;
    const syncWorkspaceLayout = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const primary3D = workspace.classList.contains("mode-assembly")
          || workspace.classList.contains("mode-fitting");
        host.dataset.viewportWorkspaceRole = primary3D ? "primary-3d" : "side-preview";
        viewportRef.current?.refresh();
      });
    };
    syncWorkspaceLayout();
    const observer = new MutationObserver(syncWorkspaceLayout);
    observer.observe(workspace, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [active]);''',
)
sub_once(
    component,
    r'function formatMetric\(value: number \| undefined\): string \{',
    '''function arrangementCommitsMatchInput(
  input: ResolvedAssemblyInput,
  commits: readonly ArrangementCommit[],
): boolean {
  const instances = new Map(input.panelInstances.map((instance) => [instance.id, instance] as const));
  return commits.every((commit) => {
    const anchor = instances.get(commit.instanceId)?.arrangementAnchor;
    return tupleClose(anchor?.positionMm, commit.positionMm)
      && tupleClose(anchor?.orientationDeg, commit.orientationDeg);
  });
}

function tupleClose(
  left: readonly number[] | undefined,
  right: readonly number[],
  epsilon = 1e-4,
): boolean {
  return Boolean(left
    && left.length === right.length
    && left.every((value, index) => Math.abs(value - right[index]) <= epsilon));
}

function formatMetric(value: number | undefined): string {''',
)

allowed = {
    "apps/web/src/state/documentCommandHistory.ts",
    "apps/web/src/state/editorStore.ts",
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    "apps/web/src/viewport/GarmentViewport.tsx",
}
changed = set(subprocess.check_output(["git", "diff", "--name-only"], text=True).splitlines())
if changed != allowed:
    raise SystemExit(f"unexpected changed files: {sorted(changed)}")
