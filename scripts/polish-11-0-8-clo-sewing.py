from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


# -----------------------------------------------------------------------------
# SewingViewportOverlay: CLO-like untangled display + buffer reuse.
# Physical constraints remain untouched. Only rendering pairing is reordered.
# -----------------------------------------------------------------------------
overlay_path = Path("apps/web/src/viewport/SewingViewportOverlay.ts")
overlay = overlay_path.read_text(encoding="utf-8")

overlay = replace_once(
    overlay,
    "  secondReference: GlobalPointReference;\n",
    "  secondReference: GlobalPointReference;\n  canonicalSecondReference: GlobalPointReference;\n",
    "thread canonical reference field",
)

overlay = replace_once(
    overlay,
    "        secondReference: cloneReference(constraint.b),\n",
    "        secondReference: cloneReference(constraint.b),\n        canonicalSecondReference: cloneReference(constraint.b),\n",
    "thread canonical reference init",
)

new_resample = r'''function resampleCanonicalThreads(segments: readonly ThreadSegment[]): ThreadSegment[] {
  const grouped = new Map<string, ThreadSegment[]>();
  for (const segment of segments) {
    const key = `${segment.proposal ? "proposal" : segment.inactive ? "inactive" : "confirmed"}/${segment.seamId}/${segment.firstMesh.key}/${segment.secondMesh.key}`;
    const group = grouped.get(key) ?? [];
    group.push(segment);
    grouped.set(key, group);
  }

  const result: ThreadSegment[] = [];
  for (const group of grouped.values()) {
    const ordered = [...group].sort((left, right) => left.progress - right.progress);
    const sampled = densifyCanonicalThreadGroup(ordered);
    result.push(...untangleVisualThreadGroup(sampled));
  }
  return result;
}

function densifyCanonicalThreadGroup(ordered: readonly ThreadSegment[]): ThreadSegment[] {
  if (ordered.length < 2) {
    return ordered.map((segment) => ({
      ...segment,
      firstReference: cloneReference(segment.firstReference),
      canonicalSecondReference: cloneReference(segment.canonicalSecondReference),
      secondReference: cloneReference(segment.canonicalSecondReference),
    }));
  }

  const targetCount = Math.min(
    MAX_VISUAL_THREADS_PER_PAIR,
    Math.max(MIN_VISUAL_THREADS_PER_PAIR, ordered.length),
  );
  const result: ThreadSegment[] = [];
  for (let sampleIndex = 0; sampleIndex < targetCount; sampleIndex += 1) {
    const u = targetCount === 1 ? 0 : sampleIndex / (targetCount - 1);
    const scaled = u * (ordered.length - 1);
    const lowerIndex = Math.floor(scaled);
    const upperIndex = Math.min(ordered.length - 1, Math.ceil(scaled));
    const alpha = scaled - lowerIndex;
    const lower = ordered[lowerIndex];
    const upper = ordered[upperIndex];
    const canonicalSecondReference = interpolateReference(
      lower.canonicalSecondReference,
      upper.canonicalSecondReference,
      alpha,
    );
    result.push({
      ...lower,
      firstReference: interpolateReference(lower.firstReference, upper.firstReference, alpha),
      canonicalSecondReference,
      secondReference: cloneReference(canonicalSecondReference),
      progress: lower.progress + (upper.progress - lower.progress) * alpha,
    });
  }
  return result;
}

/**
 * Rendering-only de-crossing, inspired by CLO's readable sewing relationship
 * lines. The canonical stitch correspondence stays untouched in
 * canonicalSecondReference and in GarmentAssembly constraints. For display we
 * choose the B-side ordering with the shorter total rung length, which avoids
 * the giant X/fan when panels face opposite local directions.
 */
function untangleVisualThreadGroup(group: readonly ThreadSegment[]): ThreadSegment[] {
  if (group.length < 2) return [...group];
  const firstPoints = group.map((segment) => referenceWorldPoint(
    segment.firstMesh,
    segment.firstParticleStart,
    segment.firstReference,
  ).toArray() as [number, number, number]);
  const secondPoints = group.map((segment) => referenceWorldPoint(
    segment.secondMesh,
    segment.secondParticleStart,
    segment.canonicalSecondReference,
  ).toArray() as [number, number, number]);
  const reverse = shouldReverseVisualSewingSide(firstPoints, secondPoints);
  return group.map((segment, index) => ({
    ...segment,
    secondReference: cloneReference(
      reverse
        ? group[group.length - 1 - index].canonicalSecondReference
        : segment.canonicalSecondReference,
    ),
  }));
}

export function shouldReverseVisualSewingSide(
  firstPoints: readonly [number, number, number][],
  secondPoints: readonly [number, number, number][],
): boolean {
  if (firstPoints.length < 2 || firstPoints.length !== secondPoints.length) return false;
  let directScore = 0;
  let reversedScore = 0;
  for (let index = 0; index < firstPoints.length; index += 1) {
    directScore += pointDistanceSquared(firstPoints[index], secondPoints[index]);
    reversedScore += pointDistanceSquared(firstPoints[index], secondPoints[firstPoints.length - 1 - index]);
  }
  return reversedScore + 1e-10 < directScore;
}

function pointDistanceSquared(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const dx = first[0] - second[0];
  const dy = first[1] - second[1];
  const dz = first[2] - second[2];
  return dx * dx + dy * dy + dz * dz;
}

'''
overlay = replace_between(
    overlay,
    "function resampleCanonicalThreads(",
    "function buildDirectionNotches(",
    new_resample,
    "replace visual resampling",
)

overlay = replace_once(
    overlay,
    "      secondStart: cloneReference(first.secondReference),\n      secondEnd: cloneReference(last.secondReference),\n",
    "      secondStart: cloneReference(first.canonicalSecondReference),\n      secondEnd: cloneReference(last.canonicalSecondReference),\n",
    "notches keep canonical direction",
)

overlay = overlay.replace("resetGeometry(", "ensureGeometryCapacity(")

old_capacity = r'''function ensureGeometryCapacity(geometry: THREE.BufferGeometry, segmentCount: number): void {
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segmentCount * 6), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(segmentCount * 6), 3));
  geometry.setDrawRange(0, segmentCount * 2);
}
'''
new_capacity = r'''function ensureGeometryCapacity(geometry: THREE.BufferGeometry, segmentCount: number): void {
  const requiredVertices = segmentCount * 2;
  const currentPosition = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const currentColor = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!currentPosition || !currentColor || currentPosition.count < requiredVertices || currentColor.count < requiredVertices) {
    const previousCapacity = Math.max(currentPosition?.count ?? 0, currentColor?.count ?? 0);
    const grownCapacity = previousCapacity > 0 ? Math.ceil(previousCapacity * 1.5) : 16;
    const capacity = Math.max(requiredVertices, grownCapacity);
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  }
  geometry.setDrawRange(0, requiredVertices);
}
'''
overlay = replace_once(overlay, old_capacity, new_capacity, "reuse overlay geometry buffers")
overlay_path.write_text(overlay, encoding="utf-8")


# -----------------------------------------------------------------------------
# AssemblyPanel: explicit Free Sewing guidance + clearer proposal + less churn.
# -----------------------------------------------------------------------------
panel_path = Path("apps/web/src/components/AssemblyPanel.tsx")
panel = panel_path.read_text(encoding="utf-8")

panel = replace_once(
    panel,
    "  const seamFreeStart = useEditorStore((state) => state.seamFreeStart);\n",
    "  const seamFreeStart = useEditorStore((state) => state.seamFreeStart);\n  const seamFirstEdge = useEditorStore((state) => state.seamFirstEdge);\n",
    "subscribe free sewing side",
)

panel = replace_once(
    panel,
    "  const [seamNameDrafts, setSeamNameDrafts] = useState<Record<string, string>>({});\n",
    "  const [seamNameDrafts, setSeamNameDrafts] = useState<Record<string, string>>({});\n  const freeCurrentSide = seamChainMode\n    ? (seamDraft?.activeSide ?? \"first\")\n    : seamFirstEdge ? \"second\" : \"first\";\n  const freeCurrentSideLabel = freeCurrentSide === \"first\" ? \"A\" : \"B\";\n  const freeWaitingForEnd = Boolean(seamFreeStart);\n  const proposalAuthoringLabel = seamChainMode\n    ? \"Vários trechos\"\n    : seamAuthoringMode === \"free\" ? \"Livre\" : \"Segmento\";\n",
    "free sewing derived state",
)

panel = replace_once(
    panel,
    "          compatibility={proposal.compatibility}\n          onCancel={cancelProposal}\n",
    "          compatibility={proposal.compatibility}\n          authoringLabel={proposalAuthoringLabel}\n          firstRangeCount={proposal.firstRanges?.length ?? 1}\n          secondRangeCount={proposal.secondRanges?.length ?? 1}\n          onCancel={cancelProposal}\n",
    "proposal authoring summary props",
)

old_help = r'''          <small className="sewing-authoring-help">
            {seamAuthoringMode === "free"
              ? seamFreeStart
                ? `Início marcado em ${Math.round(seamFreeStart.t * 100)}%. Toque novamente na mesma borda para fechar a faixa.`
                : "Livre: dois toques na mesma borda definem início e fim do EdgeRange."
              : "Segmento: um toque seleciona a borda material inteira."}
          </small>
'''
new_help = r'''          {seamAuthoringMode === "free" ? (
            <div className="free-sewing-guide" role="status" aria-live="polite">
              <div className="free-sewing-guide-title">
                <strong>Costura livre = só um trecho da borda</strong>
                <span>Lado {freeCurrentSideLabel} · passo {freeWaitingForEnd ? "2/2" : "1/2"}</span>
              </div>
              <div className="free-sewing-mini-diagram" aria-hidden="true">
                <span>●</span><i /><span>●</span>
              </div>
              <p>
                {freeWaitingForEnd
                  ? `Início marcado em ${Math.round((seamFreeStart?.t ?? 0) * 100)}%. Agora clique no FIM, na MESMA borda.`
                  : `Clique uma vez no INÍCIO do trecho do lado ${freeCurrentSideLabel}.`}
              </p>
              <small>Não arraste. São dois cliques/toques na mesma borda: início e fim.</small>
            </div>
          ) : (
            <small className="sewing-authoring-help">
              Segmento: um toque seleciona a borda material inteira.
            </small>
          )}
'''
panel = replace_once(panel, old_help, new_help, "free sewing guidance")

panel = replace_once(
    panel,
    "  compatibility,\n  onCancel,\n",
    "  compatibility,\n  authoringLabel,\n  firstRangeCount,\n  secondRangeCount,\n  onCancel,\n",
    "proposal form args",
)
panel = replace_once(
    panel,
    "  compatibility: SeamCompatibility;\n  onCancel(): void;\n",
    "  compatibility: SeamCompatibility;\n  authoringLabel: string;\n  firstRangeCount: number;\n  secondRangeCount: number;\n  onCancel(): void;\n",
    "proposal form prop types",
)

panel = replace_once(
    panel,
    "      <h3>Proposta de costura</h3>\n",
    "      <h3>Proposta de costura</h3>\n      <div className=\"seam-proposal-summary\">\n        <strong>{authoringLabel}</strong>\n        <span>Lado A: {firstRangeCount} trecho(s)</span>\n        <span>Lado B: {secondRangeCount} trecho(s)</span>\n        <span>Direção: {direction === \"same\" ? \"mesmo sentido\" : \"sentidos opostos\"}</span>\n        <span>Tratamento: {TREATMENTS.find((candidate) => candidate.value === treatment)?.label ?? treatment}</span>\n      </div>\n",
    "proposal summary",
)

old_ratio = r'''                <input
                  aria-label="Proporção alvo da costura"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={representative.targetRatio ?? Math.max(0.01, 1 + representative.easeRatio)}
                  onChange={(event) => {
                    const targetRatio = Math.max(0.01, event.currentTarget.valueAsNumber || 1);
                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { targetRatio } })));
                  }}
                />
'''
new_ratio = r'''                <input
                  key={`${relationKey}/ratio/${representative.targetRatio ?? Math.max(0.01, 1 + representative.easeRatio)}`}
                  aria-label="Proporção alvo da costura"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={representative.targetRatio ?? Math.max(0.01, 1 + representative.easeRatio)}
                  onBlur={(event) => {
                    const targetRatio = Math.max(0.01, event.currentTarget.valueAsNumber || 1);
                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { targetRatio } })));
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
'''
panel = replace_once(panel, old_ratio, new_ratio, "defer target ratio commit")

old_slack = r'''                <input
                  aria-label="Folga da costura em milímetros"
                  type="number"
                  min="0"
                  step="0.5"
                  value={representative.slackMm ?? 0}
                  onChange={(event) => {
                    const slackMm = Math.max(0, event.currentTarget.valueAsNumber || 0);
                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { slackMm } })));
                  }}
                />
'''
new_slack = r'''                <input
                  key={`${relationKey}/slack/${representative.slackMm ?? 0}`}
                  aria-label="Folga da costura em milímetros"
                  type="number"
                  min="0"
                  step="0.5"
                  defaultValue={representative.slackMm ?? 0}
                  onBlur={(event) => {
                    const slackMm = Math.max(0, event.currentTarget.valueAsNumber || 0);
                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { slackMm } })));
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
'''
panel = replace_once(panel, old_slack, new_slack, "defer slack commit")
panel_path.write_text(panel, encoding="utf-8")


# -----------------------------------------------------------------------------
# Store: skip no-op seam history writes and keep canonical treatment in sync.
# -----------------------------------------------------------------------------
store_path = Path("apps/web/src/state/editorStore.ts")
store = store_path.read_text(encoding="utf-8")
old_update = r'''  updateSeams: (updates) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map(({ seamId, update }) => [seamId, update] as const));
    const selectedSeamId = get().selectedSeamId;
    changeDocument(set, get, "seam", updates.length === 1 ? "Editar costura" : "Editar grupo de costura", (document) => ({
      ...document,
      garment: {
        ...document.garment,
        seams: (document.garment.seams ?? []).map((seam) => {
          const update = byId.get(seam.id);
          return update
            ? { ...seam, ...update, ...(update.treatment ? { type: update.treatment } : {}) }
            : seam;
        }),
      },
    }), { selectedSeamId });
  },
'''
new_update = r'''  updateSeams: (updates) => {
    if (updates.length === 0) return;
    const state = get();
    const byId = new Map(updates.map(({ seamId, update }) => [seamId, update] as const));
    const hasChanges = (state.garment.seams ?? []).some((seam) => {
      const update = byId.get(seam.id);
      if (!update) return false;
      const canonicalTreatment = update.treatment === undefined
        ? seam.canonicalTreatment
        : update.treatment === "stretch" ? "elastic" : update.treatment;
      return (update.name !== undefined && update.name !== seam.name)
        || (update.direction !== undefined && update.direction !== seam.direction)
        || (update.treatment !== undefined && (update.treatment !== seam.treatment || canonicalTreatment !== seam.canonicalTreatment))
        || (update.distribution !== undefined && update.distribution !== seam.distribution)
        || (update.targetRatio !== undefined && update.targetRatio !== seam.targetRatio)
        || (update.slackMm !== undefined && update.slackMm !== seam.slackMm)
        || (update.active !== undefined && update.active !== (seam.active !== false));
    });
    if (!hasChanges) return;
    const selectedSeamId = state.selectedSeamId;
    changeDocument(set, get, "seam", updates.length === 1 ? "Editar costura" : "Editar grupo de costura", (document) => ({
      ...document,
      garment: {
        ...document.garment,
        seams: (document.garment.seams ?? []).map((seam) => {
          const update = byId.get(seam.id);
          if (!update) return seam;
          const canonicalTreatment = update.treatment === undefined
            ? seam.canonicalTreatment
            : update.treatment === "stretch" ? "elastic" : update.treatment;
          return {
            ...seam,
            ...update,
            ...(update.treatment ? {
              type: update.treatment,
              canonicalTreatment,
            } : {}),
          };
        }),
      },
    }), { selectedSeamId });
  },
'''
store = replace_once(store, old_update, new_update, "store seam edit refinement")
store_path.write_text(store, encoding="utf-8")


# -----------------------------------------------------------------------------
# Tests: visual pairing + capacity-aware draw range.
# -----------------------------------------------------------------------------
history_path = Path("apps/web/src/state/assemblyHistory.test.ts")
history = history_path.read_text(encoding="utf-8")
old_assert = '''    expect(overlay.threadLines.geometry.getAttribute("position").count)\n      .toBe(overlay.visualThreadCount * 2);'''
new_assert = '''    expect(overlay.threadLines.geometry.drawRange.count)\n      .toBe(overlay.visualThreadCount * 2);'''
history = replace_once(history, old_assert, new_assert, "thread draw range assertion")
history_path.write_text(history, encoding="utf-8")

visual_test_path = Path("apps/web/src/viewport/SewingVisualPairing.test.ts")
visual_test_path.write_text(r'''import { describe, expect, it } from "vitest";
import { shouldReverseVisualSewingSide } from "./SewingViewportOverlay";

describe("11.0.8 CLO-like sewing relationship display", () => {
  it("keeps already parallel visual rungs in their current order", () => {
    expect(shouldReverseVisualSewingSide(
      [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
      [[1, 0, 0], [1, 1, 0], [1, 2, 0]],
    )).toBe(false);
  });

  it("reverses only the display side when direct pairing would form a giant X", () => {
    expect(shouldReverseVisualSewingSide(
      [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
      [[1, 2, 0], [1, 1, 0], [1, 0, 0]],
    )).toBe(true);
  });

  it("does not guess when point counts differ", () => {
    expect(shouldReverseVisualSewingSide(
      [[0, 0, 0], [0, 1, 0]],
      [[1, 1, 0]],
    )).toBe(false);
  });
});
''', encoding="utf-8")


# -----------------------------------------------------------------------------
# Styles: make Free Sewing self-explanatory and seam editor fit narrow panels.
# -----------------------------------------------------------------------------
styles_path = Path("apps/web/src/styles.css")
styles = styles_path.read_text(encoding="utf-8")
styles += r'''

/* 11.0.8 CLO-like sewing polish */
.free-sewing-guide {
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid #94b9c4;
  border-radius: 8px;
  background: #eef9fc;
  color: #2f454c;
}
.free-sewing-guide-title {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 8px;
  align-items: baseline;
}
.free-sewing-guide-title span {
  font-size: 11px;
  font-weight: 800;
  color: #456a75;
}
.free-sewing-guide p,
.free-sewing-guide small {
  margin: 0;
  line-height: 1.35;
}
.free-sewing-mini-diagram {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 4px;
  align-items: center;
  color: #0d9fc5;
}
.free-sewing-mini-diagram i {
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, #0d9fc5, #55ca93);
}
.seam-proposal-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 7px;
  margin: 5px 0 7px;
}
.seam-proposal-summary > * {
  padding: 4px 7px;
  border-radius: 999px;
  background: #ece8e1;
  font-size: 10px;
  line-height: 1.2;
}
.seam-proposal-summary strong {
  background: #ddeff4;
  color: #294a55;
}
.assembly-panel .seam-editor-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  min-width: 0;
}
.assembly-panel .seam-editor-row > .seam-select-button {
  grid-column: 1;
  grid-row: 1;
}
.assembly-panel .seam-editor-row > input[aria-label="Nome da costura"] {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  width: 100%;
}
.assembly-panel .seam-editor-row > .seam-length-summary,
.assembly-panel .seam-editor-row > select,
.assembly-panel .seam-editor-row > .seam-number-field,
.assembly-panel .seam-editor-row > button:not(.seam-select-button) {
  grid-column: 1 / -1;
  min-width: 0;
  width: 100%;
}
.assembly-panel .seam-number-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(70px, .8fr);
  gap: 6px;
  align-items: center;
}
.assembly-panel .seam-number-field input {
  min-width: 0;
  width: 100%;
}
@media (max-width: 760px), (pointer: coarse) {
  .free-sewing-guide {
    padding: 8px;
  }
  .free-sewing-guide-title {
    display: grid;
  }
  .assembly-panel .seam-editor-row > button:not(.seam-select-button),
  .assembly-panel .seam-editor-row > select {
    min-height: 44px;
  }
}
'''
styles_path.write_text(styles, encoding="utf-8")


# -----------------------------------------------------------------------------
# Handoff notes.
# -----------------------------------------------------------------------------
doc_path = Path("docs/modifications-11.0.8.md")
doc = doc_path.read_text(encoding="utf-8")
doc += r'''

## CLO-like sewing polish after manual gate

Manual feedback showed that canonical sewing relationships were correct, but
opposite-oriented panels rendered as giant X-shaped fans. This pass keeps the
physical A(u) <-> B(u)/B(1-u) correspondence untouched and introduces a
rendering-only pairing that chooses the shorter B-side display order. Direction
continues to be communicated by canonical notches/arrows, never by mutating the
physical bindings.

Free Sewing UX is now explicit: it states that only a subrange is being sewn,
shows the current side A/B and step 1/2 or 2/2, and instructs the user to click
start and end on the same edge without dragging. Proposal review now reports
Segmento/Livre/Vários trechos, range counts, direction, treatment and material
length delta before confirmation.

Additional polish in the same checkpoint:
- overlay BufferAttributes reuse capacity and rely on drawRange;
- seam editor controls stack in the narrow side panel instead of forcing
  horizontal scrolling;
- target ratio and slack commit on blur/Enter rather than every keystroke;
- no-op grouped seam edits are ignored;
- treatment edits keep the legacy field and canonicalTreatment synchronized
  (`stretch` projects canonically as `elastic`).

No XPBD, physics/**, garment-specific inference or STEP-0 behavior was added.
'''
doc_path.write_text(doc, encoding="utf-8")

print("Applied CLO-like 11.0.8 sewing polish")
