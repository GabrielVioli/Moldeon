from pathlib import Path
import re

ROOT = Path(".")


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    found = source.count(old)
    if found < count:
        raise SystemExit(f"{path}: expected {count} occurrences, found {found}: {old[:140]!r}")
    target.write_text(source.replace(old, new, count), encoding="utf-8")


def regex(path: str, pattern: str, replacement: str, count: int = 1) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    updated, matches = re.subn(pattern, replacement, source, count=count, flags=re.S)
    if matches != count:
        raise SystemExit(f"{path}: expected {count} regex matches, found {matches}: {pattern[:140]!r}")
    target.write_text(updated, encoding="utf-8")


# Correct complete connector interval pairing and include body structure seams.
SLEEVE = "apps/web/src/domain/sleeveSystem.ts"
regex(
    SLEEVE,
    r'function buildGuidedSleeveSeams\(.*?\n\}\n\nfunction buildLandmarkPairs',
    r'''function buildGuidedSleeveSeams(
  body: ResolvedSleeveBody,
  sleeve: PatternPiece,
  compatibility: SleeveCompatibility,
): Seam[] {
  const frontBodyIntervals = partitionRoleIntervals(body.front, "frontArmhole", [body.frontNotchPosition]);
  const frontSleeveIntervals = partitionRoleIntervals(
    sleeve,
    "sleeveCapFront",
    [connectorBoundaryPosition(sleeve, "sleeveCapFront", 0.60)],
  ).reverse();
  const backBodyIntervals = partitionRoleIntervals(body.back, "backArmhole", body.backNotchPositions);
  const backSleeveIntervals = partitionRoleIntervals(
    sleeve,
    "sleeveCapBack",
    connectorInternalBoundaryPositions(sleeve, "sleeveCapBack"),
  );
  const seams: Seam[] = [];

  appendConnectorIntervalSeams(
    seams,
    body.front,
    frontBodyIntervals,
    sleeve,
    frontSleeveIntervals,
    "guided-sleeve:front-armhole",
    "Cava frontal",
    "opposite",
  );
  appendConnectorIntervalSeams(
    seams,
    body.back,
    backBodyIntervals,
    sleeve,
    backSleeveIntervals,
    "guided-sleeve:back-armhole",
    "Cava traseira",
    "same",
  );

  const sideEdges = edgesWithRole(sleeve, "sideSeam");
  if (sideEdges.length >= 2) {
    seams.push(seam(
      "guided-sleeve:underarm",
      "guided-sleeve:underarm",
      "Costura inferior das mangas",
      fullRange(sleeve.id, sideEdges[0].id),
      fullRange(sleeve.id, sideEdges[1].id),
      "opposite",
      "standard",
    ));
  }

  const frontShoulder = firstEdge(body.front, "shoulder");
  const backShoulder = firstEdge(body.back, "shoulder");
  if (frontShoulder && backShoulder) {
    seams.push(seam(
      "guided-sleeve:body-shoulder",
      "guided-sleeve:body-shoulder",
      "Ombros do corpo",
      fullRange(body.front.id, frontShoulder.id),
      fullRange(body.back.id, backShoulder.id),
      "same",
      "standard",
    ));
  }
  const frontSide = firstEdge(body.front, "sideSeam");
  const backSide = firstEdge(body.back, "sideSeam");
  if (frontSide && backSide) {
    seams.push(seam(
      "guided-sleeve:body-side",
      "guided-sleeve:body-side",
      "Laterais do corpo",
      fullRange(body.front.id, frontSide.id),
      fullRange(body.back.id, backSide.id),
      "same",
      "standard",
    ));
  }

  return seams.map((current) => ({
    ...current,
    easeRatio: current.treatment === "ease"
      ? Math.abs(compatibility.totalDifferenceMm) / Math.max(compatibility.totalArmholeMm, 1)
      : 0,
  }));
}

function appendConnectorIntervalSeams(
  target: Seam[],
  firstPiece: PatternPiece,
  firstIntervals: readonly EdgeRange[][],
  secondPiece: PatternPiece,
  secondIntervals: readonly EdgeRange[][],
  groupId: string,
  label: string,
  direction: Seam["direction"],
): void {
  let sequence = 0;
  const intervalCount = Math.min(firstIntervals.length, secondIntervals.length);
  for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
    const pairs = alignRangeLists(
      firstPiece,
      firstIntervals[intervalIndex],
      secondPiece,
      secondIntervals[intervalIndex],
    );
    for (const [first, second] of pairs) {
      sequence += 1;
      target.push(seam(
        `${groupId}:${sequence}`,
        groupId,
        `${label} · trecho ${sequence}`,
        first,
        second,
        direction,
        "ease",
      ));
    }
  }
}

function alignRangeLists(
  firstPiece: PatternPiece,
  firstRanges: readonly EdgeRange[],
  secondPiece: PatternPiece,
  secondRanges: readonly EdgeRange[],
): Array<[EdgeRange, EdgeRange]> {
  if (firstRanges.length === 0 || secondRanges.length === 0) return [];
  const firstLengths = firstRanges.map((range) => edgeRangeLength(firstPiece, range));
  const secondLengths = secondRanges.map((range) => edgeRangeLength(secondPiece, range));
  const firstTotal = firstLengths.reduce((sum, value) => sum + value, 0);
  const secondTotal = secondLengths.reduce((sum, value) => sum + value, 0);
  if (firstTotal <= 0 || secondTotal <= 0) return [];
  const boundaries = new Set<number>([0, 1]);
  cumulativeFractions(firstLengths, firstTotal).forEach((value) => boundaries.add(roundRatio(value)));
  cumulativeFractions(secondLengths, secondTotal).forEach((value) => boundaries.add(roundRatio(value)));
  const ordered = [...boundaries].sort((left, right) => left - right);
  const pairs: Array<[EdgeRange, EdgeRange]> = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (end - start < 1e-7) continue;
    const first = sliceRangeList(firstRanges, firstLengths, firstTotal, start, end);
    const second = sliceRangeList(secondRanges, secondLengths, secondTotal, start, end);
    if (first && second) pairs.push([first, second]);
  }
  return pairs;
}

function cumulativeFractions(lengths: readonly number[], total: number): number[] {
  let cursor = 0;
  return lengths.slice(0, -1).map((length) => {
    cursor += length;
    return cursor / total;
  });
}

function sliceRangeList(
  ranges: readonly EdgeRange[],
  lengths: readonly number[],
  total: number,
  startFraction: number,
  endFraction: number,
): EdgeRange | undefined {
  const midpoint = ((startFraction + endFraction) / 2) * total;
  let cursor = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const length = lengths[index];
    const next = cursor + length;
    if (midpoint <= next + 1e-7) {
      const source = ranges[index];
      const sourceSpan = source.endT - source.startT;
      const localStart = clamp((startFraction * total - cursor) / Math.max(length, 1e-9), 0, 1);
      const localEnd = clamp((endFraction * total - cursor) / Math.max(length, 1e-9), 0, 1);
      return {
        ...source,
        startT: roundRatio(source.startT + sourceSpan * localStart),
        endT: roundRatio(source.startT + sourceSpan * localEnd),
      };
    }
    cursor = next;
  }
  return undefined;
}

function buildLandmarkPairs''',
)
regex(
    SLEEVE,
    r'function partitionRole\(.*?\n\}\n\nfunction connectorBoundaryPosition',
    r'''function partitionRoleIntervals(
  piece: PatternPiece,
  role: SegmentRole,
  cutPositions: readonly number[],
): EdgeRange[][] {
  const edges = edgesWithRole(piece, role);
  const lengths = edges.map((edge) => edgeLength(piece, edge));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (edges.length === 0 || total <= 0) return [];
  const boundaries = [0, ...cutPositions.map((value) => clamp(value, 0.001, 0.999)).sort((a, b) => a - b), 1];
  const intervals: EdgeRange[][] = [];
  for (let intervalIndex = 0; intervalIndex < boundaries.length - 1; intervalIndex += 1) {
    const startDistance = boundaries[intervalIndex] * total;
    const endDistance = boundaries[intervalIndex + 1] * total;
    const ranges: EdgeRange[] = [];
    let cursor = 0;
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex];
      const length = lengths[edgeIndex];
      const edgeStart = cursor;
      const edgeEnd = cursor + length;
      const overlapStart = Math.max(startDistance, edgeStart);
      const overlapEnd = Math.min(endDistance, edgeEnd);
      if (overlapEnd - overlapStart > 1e-5) {
        ranges.push({
          pieceId: piece.id,
          edgeId: edge.id,
          startT: roundRatio((overlapStart - edgeStart) / Math.max(length, 1e-9)),
          endT: roundRatio((overlapEnd - edgeStart) / Math.max(length, 1e-9)),
        });
      }
      cursor = edgeEnd;
    }
    intervals.push(ranges);
  }
  return intervals;
}

function connectorBoundaryPosition''',
)

# Preserve explicit guided seams during runtime semantic resolution.
SEAMS = "apps/web/src/domain/templateAssemblySeams.ts"
replace(
    SEAMS,
    'export function resolveTemplateAssemblyGarment(\n  garment: GarmentDraft,\n): GarmentDraft {\n  const canonical = buildTemplateAssemblySeams(garment);\n',
    'export function resolveTemplateAssemblyGarment(\n  garment: GarmentDraft,\n): GarmentDraft {\n  if ((garment.seams ?? []).some((seam) => seam.groupId?.startsWith("guided-sleeve:"))) {\n    return garment;\n  }\n  const canonical = buildTemplateAssemblySeams(garment);\n',
)

# Improve canonical V3 sleeve connectors and landmarks.
DOC = "apps/web/src/domain/patternDocumentV3.ts"
old_connector = '''function migrateSemanticConnectors(piece: PatternPiece): PatternConnectorV3[] {
  const grouped = new Map<ConnectorRoleV3, NonNullable<PatternPiece["segments"]>>();
  for (const segment of piece.segments ?? []) {
    const role = CONNECTOR_ROLE_BY_SEGMENT_ROLE[segment.role];
'''
new_connector = '''function migrateSemanticConnectors(piece: PatternPiece): PatternConnectorV3[] {
  const grouped = new Map<ConnectorRoleV3, NonNullable<PatternPiece["segments"]>>();
  const sleeveDefinition = (piece.segments ?? []).some((segment) => segment.role === "sleeveCapFront")
    && (piece.segments ?? []).some((segment) => segment.role === "sleeveCapBack");
  for (const segment of piece.segments ?? []) {
    const role = sleeveDefinition && segment.role === "sideSeam"
      ? "underarm"
      : CONNECTOR_ROLE_BY_SEGMENT_ROLE[segment.role];
'''
replace(DOC, old_connector, new_connector)
replace(
    DOC,
    '  if (role === "shoulder") {\n',
    '''  if (role === "front-armhole" || role === "back-armhole") {
    landmarks.push({
      id: `${pieceId}:${role}:shoulder-balance`,
      kind: "balance",
      rangeIndex: 0,
      t: 0,
      label: "Marca de ombro",
    });
  }
  if (role === "sleeve-cap-front") {
    landmarks.push({
      id: `${pieceId}:${role}:apex`,
      kind: "apex",
      rangeIndex: lastRange,
      t: 1,
      label: "Ápice da manga",
    });
  }
  if (role === "sleeve-cap-back") {
    landmarks.push({
      id: `${pieceId}:${role}:apex`,
      kind: "apex",
      rangeIndex: 0,
      t: 0,
      label: "Ápice da manga",
    });
  }
  if (role === "shoulder") {
''',
)

# Store command and one-step undo/redo.
STORE = "apps/web/src/state/editorStore.ts"
replace(
    STORE,
    'import { validatePatternContour } from "../domain/polygonGeometry";\n',
    'import { validatePatternContour } from "../domain/polygonGeometry";\nimport {\n  draftGuidedSleeve,\n  isSleevePiece,\n  type SleeveDraftSettings,\n} from "../domain/sleeveSystem";\n',
)
replace(
    STORE,
    '  setGarmentEase(region: "bustMm" | "waistMm" | "hipMm" | "sleeveMm", valueMm: number): void;\n',
    '''  setGarmentEase(region: "bustMm" | "waistMm" | "hipMm" | "sleeveMm", valueMm: number): void;
  addGuidedSleeve(options: {
    frontPieceId: string;
    backPieceId: string;
    settings: SleeveDraftSettings;
    replaceExisting: boolean;
  }): { accepted: boolean; message?: string };
''',
)
insert_action = '''
  addGuidedSleeve: (options) => {
    const state = get();
    const existingSleeves = state.garment.pieces.filter(isSleevePiece);
    if (existingSleeves.length > 0 && !options.replaceExisting) {
      return {
        accepted: false,
        message: "O projeto já possui manga. Confirme a substituição explícita no assistente.",
      };
    }
    let guided;
    try {
      guided = draftGuidedSleeve(
        state.garment,
        options.frontPieceId,
        options.backPieceId,
        options.settings,
      );
    } catch (reason) {
      return {
        accepted: false,
        message: reason instanceof Error ? reason.message : "Não foi possível criar a manga.",
      };
    }
    if (guided.compatibility.status === "error") {
      return {
        accepted: false,
        message: guided.compatibility.diagnostics.map((diagnostic) => diagnostic.message).join(" "),
      };
    }
    const sleeveId = guided.sleevePiece.id;
    const removableIds = new Set([
      ...existingSleeves.map((piece) => piece.id),
      ...(state.garment.pieces.some((piece) => piece.id === sleeveId) ? [sleeveId] : []),
    ]);
    changeDocument(
      set,
      get,
      "piece-create",
      existingSleeves.length > 0 ? "Substituir sistema de manga" : "Adicionar sistema de manga",
      (document) => {
        const retainedPieces = document.garment.pieces.filter((piece) => !removableIds.has(piece.id));
        const retainedStates = (document.garment.workspaceStates ?? []).filter((entry) => !removableIds.has(entry.pieceId));
        const rightmost = retainedPieces.reduce((maximum, piece) => {
          const workspace = workspaceStateFor(document.garment, piece.id);
          return Math.max(maximum, workspace.transform.xMm + pieceWidth(piece));
        }, 0);
        const workspace: PieceWorkspaceState = {
          pieceId: sleeveId,
          transform: {
            pieceId: sleeveId,
            xMm: rightmost + 100,
            yMm: 0,
            rotationDeg: 0,
          },
          visible: true,
          locked: false,
        };
        const retainedSeams = (document.garment.seams ?? []).filter((seam) =>
          !seam.groupId?.startsWith("guided-sleeve:")
          && !removableIds.has(seam.first.pieceId)
          && !removableIds.has(seam.second.pieceId),
        );
        const retainedPlacements = (document.garment.assemblyPlacements ?? []).filter(
          (placement) => !removableIds.has(placement.pieceId),
        );
        return {
          activePieceId: sleeveId,
          garment: syncLegacyTransforms({
            ...document.garment,
            pieces: [...retainedPieces, guided.sleevePiece],
            seams: [...retainedSeams, ...guided.seams],
            workspaceStates: [...retainedStates, workspace],
            assemblyPlacements: [
              ...retainedPlacements,
              {
                pieceId: sleeveId,
                role: "sleeve",
                outwardSide: "front",
                positionMm: [0, 0, 0],
                rotationDeg: [0, 0, guided.settings.rotationDeg],
                flipped: false,
                source: "manual",
              },
            ],
          }),
        };
      },
      {
        selectedPieceIds: [sleeveId],
        pieceSelectionActive: true,
      },
    );
    return { accepted: true };
  },

'''
replace(STORE, '  startDraft: (name) => set({\n', insert_action + '  startDraft: (name) => set({\n')

# Toolbar button.
TOOLBAR = "apps/web/src/components/Toolbar.tsx"
replace(
    TOOLBAR,
    '  onOpenLibrary(): void;\n  onPrepareLibrary(): void;\n',
    '  onOpenLibrary(): void;\n  onPrepareLibrary(): void;\n  onOpenSleeveWizard(): void;\n  onPrepareSleeveWizard(): void;\n  canAddSleeve: boolean;\n',
)
replace(
    TOOLBAR,
    '  onOpenLibrary,\n  onPrepareLibrary,\n',
    '  onOpenLibrary,\n  onPrepareLibrary,\n  onOpenSleeveWizard,\n  onPrepareSleeveWizard,\n  canAddSleeve,\n',
)
replace(
    TOOLBAR,
    '      <div className="toolbar-actions">\n        <button\n          className="library-button"\n',
    '''      <div className="toolbar-actions">
        <button
          className="sleeve-button"
          type="button"
          disabled={!canAddSleeve}
          onFocus={onPrepareSleeveWizard}
          onPointerEnter={onPrepareSleeveWizard}
          onClick={onOpenSleeveWizard}
          title={canAddSleeve ? "Gerar manga a partir das cavas" : "Adicione frente e costas com cavas semânticas"}
          data-testid="open-sleeve-wizard"
        >
          Adicionar manga
        </button>
        <button
          className="library-button"
''',
)

# App lazy loading and wiring.
APP = "apps/web/src/App.tsx"
replace(
    APP,
    'import { evaluateGarment3DEligibility, shouldLoadThreeViewport, type WorkspaceMode } from "./domain/assembly";\n',
    'import { evaluateGarment3DEligibility, shouldLoadThreeViewport, type WorkspaceMode } from "./domain/assembly";\nimport { canAddGuidedSleeve } from "./domain/sleeveSystem";\n',
)
replace(
    APP,
    'const loadFittingRoom = () => import("./components/FittingRoomDialog");\n',
    'const loadFittingRoom = () => import("./components/FittingRoomDialog");\nconst loadSleeveWizard = () => import("./components/SleeveWizardDialog");\n',
)
replace(
    APP,
    'const LazyFittingRoomDialog = lazy(async () => {\n  const module = await loadFittingRoom();\n  return { default: module.FittingRoomDialog };\n});\n',
    '''const LazyFittingRoomDialog = lazy(async () => {
  const module = await loadFittingRoom();
  return { default: module.FittingRoomDialog };
});
const LazySleeveWizardDialog = lazy(async () => {
  const module = await loadSleeveWizard();
  return { default: module.SleeveWizardDialog };
});
''',
)
replace(
    APP,
    '  const simulate = useEditorStore((state) => state.simulate);\n',
    '  const simulate = useEditorStore((state) => state.simulate);\n  const addGuidedSleeve = useEditorStore((state) => state.addGuidedSleeve);\n',
)
replace(
    APP,
    '  const [fittingOpen, setFittingOpen] = useState(false);\n',
    '  const [fittingOpen, setFittingOpen] = useState(false);\n  const [sleeveWizardOpen, setSleeveWizardOpen] = useState(false);\n',
)
replace(
    APP,
    '  const eligibility = useMemo(() => evaluateGarment3DEligibility(garment), [garment]);\n',
    '  const eligibility = useMemo(() => evaluateGarment3DEligibility(garment), [garment]);\n  const canAddSleeve = useMemo(() => canAddGuidedSleeve(garment.pieces), [garment.pieces]);\n',
)
replace(
    APP,
    '  const handleInsertPoint = useCallback(\n',
    '''  const handleConfirmSleeve = useCallback((options: Parameters<typeof addGuidedSleeve>[0]) => {
    const result = addGuidedSleeve(options);
    if (!result.accepted) {
      window.alert(result.message ?? "Não foi possível criar a manga.");
      return;
    }
    setSleeveWizardOpen(false);
    setActiveTool("select");
    setWorkspaceMode("modeling");
    if (isCompactWorkspace) setMobileView("editor");
  }, [addGuidedSleeve, isCompactWorkspace]);
  const handleInsertPoint = useCallback(
''',
)
replace(
    APP,
    '        onOpenLibrary={() => setLibraryOpen(true)}\n        onPrepareLibrary={() => {\n          void loadPatternLibrary();\n        }}\n',
    '''        onOpenLibrary={() => setLibraryOpen(true)}
        onPrepareLibrary={() => {
          void loadPatternLibrary();
        }}
        onOpenSleeveWizard={() => setSleeveWizardOpen(true)}
        onPrepareSleeveWizard={() => {
          if (canAddSleeve) void loadSleeveWizard();
        }}
        canAddSleeve={canAddSleeve}
''',
)
replace(
    APP,
    '      {fittingOpen ? (\n',
    '''      {sleeveWizardOpen ? (
        <Suspense fallback={<DialogPlaceholder label="Preparando assistente de manga" />}>
          <LazySleeveWizardDialog
            garment={garment}
            onClose={() => setSleeveWizardOpen(false)}
            onConfirm={handleConfirmSleeve}
          />
        </Suspense>
      ) : null}

      {fittingOpen ? (
''',
)

# Responsive wizard presentation.
STYLES = ROOT / "apps/web/src/styles.css"
styles = STYLES.read_text(encoding="utf-8")
marker = "/* PROMPT08_SLEEVE_WIZARD */"
if marker not in styles:
    styles += r'''

/* PROMPT08_SLEEVE_WIZARD */
.sleeve-button {
  border: 1px solid #6c5b42;
  background: #f5ecdd;
  color: #30271c;
  font-weight: 750;
}
.sleeve-button:disabled { opacity: .45; cursor: not-allowed; }
.sleeve-wizard-backdrop { z-index: 70; }
.sleeve-wizard-dialog {
  width: min(1120px, calc(100vw - 32px));
  max-height: min(900px, calc(100vh - 32px));
  overflow: hidden;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  background: #fbfaf7;
  border: 1px solid #bdb6aa;
  border-radius: 18px;
  box-shadow: 0 24px 80px rgba(22, 20, 17, .32);
}
.sleeve-wizard-header { padding: 22px 24px 16px; }
.sleeve-wizard-header h1 { margin: 3px 0 7px; }
.sleeve-wizard-header p { max-width: 760px; margin: 0; color: #5a554d; }
.sleeve-wizard-steps {
  list-style: none;
  margin: 0;
  padding: 0 24px 16px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.sleeve-wizard-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: #746e65;
  font-size: 13px;
  font-weight: 700;
}
.sleeve-wizard-steps li::after { content: ""; height: 2px; flex: 1; background: #ded8ce; }
.sleeve-wizard-steps li:last-child::after { display: none; }
.sleeve-wizard-steps li span {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border: 1px solid #c9c1b5;
  border-radius: 999px;
  background: #fff;
}
.sleeve-wizard-steps li.active { color: #1f1c18; }
.sleeve-wizard-steps li.active span { background: #2f4b5f; color: #fff; border-color: #2f4b5f; }
.sleeve-wizard-steps li.complete span { background: #e3eee9; border-color: #6f9584; color: #284b3d; }
.sleeve-wizard-content { overflow: auto; padding: 4px 24px 24px; }
.sleeve-wizard-content h2 { margin: 4px 0 6px; font-size: 20px; }
.sleeve-wizard-content p { margin: 0 0 18px; color: #625c54; }
.sleeve-source-grid, .sleeve-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.sleeve-field { display: grid; gap: 6px; font-size: 13px; font-weight: 750; color: #403a32; }
.sleeve-field select, .sleeve-field input {
  width: 100%;
  min-height: 42px;
  border: 1px solid #bdb5a9;
  border-radius: 9px;
  background: #fff;
  color: #211e1a;
  padding: 8px 10px;
  font: inherit;
}
.sleeve-number-control { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 7px; }
.sleeve-number-control small { color: #716a61; }
.sleeve-source-details { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
.sleeve-source-card { border: 1px solid #c8c0b5; border-top-width: 4px; border-radius: 12px; padding: 14px; background: #fff; min-width: 0; }
.sleeve-source-card.front { border-top-color: #b45745; }
.sleeve-source-card.back { border-top-color: #477197; }
.sleeve-source-card > span, .sleeve-source-card > strong, .sleeve-source-card > small { display: block; }
.sleeve-source-card > span { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #69625a; }
.sleeve-source-card > strong { margin-top: 5px; }
.sleeve-source-card > small { margin-top: 3px; color: #625b52; }
.sleeve-source-card dl { margin: 12px 0 0; display: grid; gap: 7px; }
.sleeve-source-card dl div { min-width: 0; }
.sleeve-source-card dt { font-size: 11px; font-weight: 800; color: #777067; }
.sleeve-source-card dd { margin: 2px 0 0; font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.sleeve-confirm-row { display: flex; align-items: flex-start; gap: 10px; margin-top: 15px; padding: 12px; border-radius: 10px; background: #f0eee9; font-size: 13px; line-height: 1.45; }
.sleeve-confirm-row.warning { background: #fff1dc; }
.sleeve-confirm-row.compact { padding: 8px 10px; margin: 8px 0 14px; }
.sleeve-confirm-row input { margin-top: 2px; }
.sleeve-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.sleeve-type-grid button { min-height: 230px; border: 1px solid #c5bdb1; border-radius: 14px; background: #fff; padding: 18px; display: grid; justify-items: center; gap: 9px; color: #29251f; }
.sleeve-type-grid button.active { border-color: #2f4b5f; box-shadow: 0 0 0 3px rgba(47, 75, 95, .14); }
.sleeve-type-grid small { max-width: 270px; color: #696158; }
.sleeve-type-icon { display: block; width: 90px; height: 120px; border: 3px solid #4c4a46; border-top: 0; border-radius: 8px 8px 28px 28px; background: linear-gradient(135deg, #eee3d4, #d9c7af); clip-path: polygon(20% 0, 80% 0, 100% 24%, 82% 100%, 18% 100%, 0 24%); }
.sleeve-type-icon.short { height: 82px; }
.sleeve-settings-grid { margin-top: 16px; }
.sleeve-compatibility-summary { margin-top: 18px; border: 1px solid #c6beb2; border-left-width: 5px; border-radius: 12px; background: #fff; padding: 14px; }
.sleeve-compatibility-summary.compatible { border-left-color: #4f8871; }
.sleeve-compatibility-summary.warning { border-left-color: #b27a2c; }
.sleeve-compatibility-summary.error { border-left-color: #b54c43; }
.sleeve-compatibility-summary header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.sleeve-compatibility-summary header span { font-size: 13px; color: #5f5951; }
.sleeve-metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.sleeve-metric { border-radius: 8px; padding: 9px; background: #f3f0eb; border-top: 3px solid #888; }
.sleeve-metric.front { border-color: #b45745; }
.sleeve-metric.front-cap { border-color: #d88a74; }
.sleeve-metric.back { border-color: #477197; }
.sleeve-metric.back-cap { border-color: #74a2c8; }
.sleeve-metric span, .sleeve-metric strong { display: block; }
.sleeve-metric span { font-size: 11px; color: #6b645c; }
.sleeve-metric strong { margin-top: 3px; font-size: 14px; }
.sleeve-diagnostic { margin-top: 9px; padding: 9px 11px; border-radius: 8px; font-size: 12px; line-height: 1.4; background: #edf1f3; }
.sleeve-diagnostic.warning { background: #fff0d8; color: #65400b; }
.sleeve-diagnostic.error { background: #ffe5e1; color: #74251e; }
.sleeve-fit-step { display: grid; grid-template-columns: minmax(300px, .9fr) minmax(420px, 1.35fr); gap: 20px; align-items: start; }
.sleeve-fit-diagram { width: 100%; min-height: 390px; border: 1px solid #c7bfb4; border-radius: 14px; background: #fff; }
.sleeve-fit-diagram .diagram-title { font: 700 15px Inter, sans-serif; fill: #302b25; }
.sleeve-fit-diagram .fit-armhole, .sleeve-fit-diagram .fit-cap { fill: none; stroke-width: 7; stroke-linecap: round; }
.sleeve-fit-diagram .front, .sleeve-fit-diagram .front-cap { stroke: #b45745; }
.sleeve-fit-diagram .back, .sleeve-fit-diagram .back-cap { stroke: #477197; }
.sleeve-fit-diagram .front-cap, .sleeve-fit-diagram .back-cap { stroke-dasharray: 10 5; }
.sleeve-fit-diagram .fit-label, .sleeve-fit-diagram .fit-caption { font: 12px Inter, sans-serif; fill: #514a42; }
.sleeve-fit-diagram .fit-apex { fill: #292721; }
.sleeve-fit-diagram .fit-notch line { stroke-width: 3; }
.sleeve-fit-diagram .fit-notch text { font: 700 11px Inter, sans-serif; fill: #332f29; }
.sleeve-fit-diagram .fit-guide { stroke: #999087; stroke-width: 1.5; }
.sleeve-landmark-list { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.sleeve-landmark-list > div { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; padding: 8px 10px; border-radius: 8px; background: #f1eee8; }
.sleeve-landmark-list small { grid-column: 2; color: #6f675e; }
.landmark-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; background: #777; }
.landmark-dot.front { background: #b45745; }
.landmark-dot.back { background: #477197; }
.sleeve-wizard-actions { display: flex; justify-content: space-between; gap: 10px; padding: 15px 24px; border-top: 1px solid #d6d0c7; background: #f6f3ee; }
.sleeve-wizard-actions button { min-width: 120px; }

@media (max-width: 760px) {
  .sleeve-wizard-dialog { width: 100vw; max-height: 100dvh; height: 100dvh; border-radius: 0; border: 0; }
  .sleeve-wizard-header { padding: calc(14px + env(safe-area-inset-top)) 16px 10px; }
  .sleeve-wizard-header p { font-size: 12px; }
  .sleeve-wizard-steps { padding: 0 16px 10px; gap: 4px; }
  .sleeve-wizard-steps li { font-size: 0; gap: 4px; }
  .sleeve-wizard-steps li span { font-size: 12px; }
  .sleeve-wizard-content { padding: 4px 16px 18px; }
  .sleeve-source-grid, .sleeve-source-details, .sleeve-settings-grid, .sleeve-type-grid, .sleeve-fit-step { grid-template-columns: 1fr; }
  .sleeve-type-grid button { min-height: 155px; grid-template-columns: auto 1fr; justify-items: start; text-align: left; }
  .sleeve-type-icon { width: 54px; height: 84px; grid-row: 1 / 3; }
  .sleeve-type-icon.short { height: 58px; }
  .sleeve-metric-grid { grid-template-columns: 1fr 1fr; }
  .sleeve-compatibility-summary header { display: grid; }
  .sleeve-fit-diagram { min-height: 300px; }
  .sleeve-landmark-list { grid-template-columns: 1fr; }
  .sleeve-wizard-actions { padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
  .sleeve-wizard-actions button { min-width: 0; flex: 1; }
  .toolbar-actions .sleeve-button { display: none; }
}
'''
    STYLES.write_text(styles, encoding="utf-8")

print("Prompt 8 integration patch applied")
