from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

RESOLVED = ROOT / "apps/web/src/garment3d/ResolvedAssemblyInput.ts"
GLOBAL = ROOT / "apps/web/src/viewport/GlobalThreeViewport.ts"
GARMENT_VIEWPORT = ROOT / "apps/web/src/viewport/GarmentViewport.tsx"
OVERLAY = ROOT / "apps/web/src/viewport/SewingViewportOverlay.ts"
STORE = ROOT / "apps/web/src/state/editorStore.ts"
PANEL = ROOT / "apps/web/src/components/AssemblyPanel.tsx"
STYLES = ROOT / "apps/web/src/styles.css"
RESOLVED_TEST = ROOT / "apps/web/src/garment3d/ResolvedAssemblyInput.test.ts"
HISTORY_TEST = ROOT / "apps/web/src/state/assemblyHistory.test.ts"
DOC = ROOT / "docs/modifications-11.0.8.md"

for path in (RESOLVED, GLOBAL, GARMENT_VIEWPORT, OVERLAY, STORE, PANEL, STYLES, RESOLVED_TEST, HISTORY_TEST, DOC):
    if not path.exists():
        raise SystemExit(f"missing expected file: {path}")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1) Split geometry / sewing revisions so seam authoring does not rebuild 3D.
# ---------------------------------------------------------------------------
text = read(RESOLVED)
text = replace_once(
    text,
    '''  geometryRevision: string;\n  arrangementRevision: string;\n  simulationRevision: string;''',
    '''  geometryRevision: string;\n  /** Changes only when canonical sewing relationships change. */\n  sewingRevision: string;\n  arrangementRevision: string;\n  simulationRevision: string;''',
    "ResolvedAssemblyInput sewingRevision interface",
)
text = replace_once(
    text,
    '''  const simulationRevision = stableHash(JSON.stringify({\n    arrangementRevision,\n    simulationInstances: simulationPanelInstances.map((instance) => instance.id),\n    seams: input.seamGroups,''',
    '''  const simulationRevision = stableHash(JSON.stringify({\n    arrangementRevision,\n    sewingRevision: input.sewingRevision,\n    simulationInstances: simulationPanelInstances.map((instance) => instance.id),''',
    "arrangement update simulation sewing revision",
)
text = replace_once(
    text,
    '''  const seamGroups = document.seamGroups.filter((group) =>\n    group.active\n    && [...group.first, ...group.second].every((range) => definitionIds.has(range.pieceId)),\n  );''',
    '''  // Keep inactive SeamGroupV3 relations in the resolved authoring document.\n  // Physical compilers already honor `active`; dropping them here made Edit Sewing\n  // unable to render/select an inactive relationship and coupled visibility to physics.\n  const seamGroups = document.seamGroups.filter((group) =>\n    [...group.first, ...group.second].every((range) => definitionIds.has(range.pieceId)),\n  );''',
    "keep inactive seam groups",
)
text = replace_once(
    text,
    '''  const geometryRevision = stableHash(JSON.stringify({\n    geometry: [...geometrySignatures.entries()],\n    instances: includedInstances.map((instance) => ({\n      id: instance.id,\n      sourcePatternId: instance.sourcePatternId,\n      copyIndex: instance.copyIndex,\n      mirrored: instance.mirrored,\n    })),\n    seams: seamGroups,\n    fabrics: document.fabrics.map((fabric) => ({ id: fabric.id })),\n  }));\n  const arrangementRevision = stableHash(JSON.stringify({''',
    '''  const geometryRevision = stableHash(JSON.stringify({\n    geometry: [...geometrySignatures.entries()],\n    instances: includedInstances.map((instance) => ({\n      id: instance.id,\n      sourcePatternId: instance.sourcePatternId,\n      copyIndex: instance.copyIndex,\n      mirrored: instance.mirrored,\n    })),\n    fabrics: document.fabrics.map((fabric) => ({ id: fabric.id })),\n  }));\n  const sewingRevision = stableHash(JSON.stringify({\n    geometryRevision,\n    seams: seamGroups,\n  }));\n  const arrangementRevision = stableHash(JSON.stringify({''',
    "separate geometry and sewing revisions",
)
text = replace_once(
    text,
    '''  const simulationRevision = stableHash(JSON.stringify({\n    arrangementRevision,\n    simulationInstances: simulationInstances.map((instance) => instance.id),\n    seams: seamGroups,''',
    '''  const simulationRevision = stableHash(JSON.stringify({\n    arrangementRevision,\n    sewingRevision,\n    simulationInstances: simulationInstances.map((instance) => instance.id),''',
    "final simulation revision",
)
text = replace_once(
    text,
    '''    geometryRevision,\n    arrangementRevision,\n    simulationRevision,''',
    '''    geometryRevision,\n    sewingRevision,\n    arrangementRevision,\n    simulationRevision,''',
    "resolved return sewingRevision",
)
write(RESOLVED, text)


# ---------------------------------------------------------------------------
# 2) Overlay: visibility split, deterministic colors, inactive relationships,
#    selected relationship, thread-only refresh, and 3D thread hit testing.
# ---------------------------------------------------------------------------
text = read(OVERLAY)
text = replace_once(
    text,
    '''export interface SewingOverlaySelection {\n  first: readonly EdgeRange[];\n  second: readonly EdgeRange[];\n}''',
    '''export interface SewingOverlaySelection {\n  first: readonly EdgeRange[];\n  second: readonly EdgeRange[];\n  selectedSeamId?: string | null;\n}''',
    "overlay selection selected seam",
)
text = replace_once(
    text,
    '''  proposal: boolean;\n  progress: number;\n}''',
    '''  proposal: boolean;\n  inactive: boolean;\n  progress: number;\n}''',
    "thread inactive flag",
)
text = replace_once(
    text,
    '''  secondEnd: GlobalPointReference;\n  proposal: boolean;\n}''',
    '''  secondEnd: GlobalPointReference;\n  seamId: string;\n  inactive: boolean;\n  proposal: boolean;\n}''',
    "notch seam state",
)
text = replace_once(
    text,
    '''const THREAD_COLOR = new THREE.Color(0xff3fb4);\nconst PROPOSAL_THREAD_COLOR = new THREE.Color(0x00f0ff);''',
    '''const CONFIRMED_THREAD_PALETTE = [\n  new THREE.Color(0xff3fb4), // magenta\n  new THREE.Color(0x7c5cff), // violet\n  new THREE.Color(0xff6b4a), // coral\n  new THREE.Color(0x00c2ff), // cyan-blue\n  new THREE.Color(0x5bd68a), // green\n] as const;\nconst PROPOSAL_THREAD_COLOR = new THREE.Color(0x00f0ff);\nconst INACTIVE_THREAD_COLOR = new THREE.Color(0x8f969f);\nconst SELECTED_THREAD_COLOR = new THREE.Color(0xffffff);''',
    "thread color palette",
)
text = replace_once(
    text,
    '''    selection: SewingOverlaySelection,\n    proposalConstraints: readonly AssemblyStitchConstraint[] = [],\n  ): void {\n    this.selection = selection;\n    this.edgeSegments = buildEdgeSegments(meshes);\n    this.threadSegments = state\n      ? buildThreadSegments(meshes, state, proposalConstraints)\n      : [];''',
    '''    selection: SewingOverlaySelection,\n    proposalConstraints: readonly AssemblyStitchConstraint[] = [],\n    inactiveConstraints: readonly AssemblyStitchConstraint[] = [],\n  ): void {\n    this.selection = selection;\n    this.edgeSegments = buildEdgeSegments(meshes);\n    this.threadSegments = state\n      ? buildThreadSegments(meshes, state, proposalConstraints, inactiveConstraints)\n      : [];''',
    "overlay rebuild inactive constraints",
)
text = replace_once(
    text,
    '''  setVisible(visible: boolean): void {\n    this.group.visible = visible;\n  }''',
    '''  setVisibility(edgesVisible: boolean, threadsVisible: boolean): void {\n    this.edgeLines.visible = edgesVisible;\n    this.threadLines.visible = threadsVisible;\n    this.notchLines.visible = threadsVisible;\n    this.group.visible = edgesVisible || threadsVisible;\n  }''',
    "split sewing visibility",
)
text = replace_once(
    text,
    '''  edgeAtIntersection(intersection: THREE.Intersection): { range: EdgeRange; panelInstanceId: string; segmentIndex: number; t: number } | null {\n    if (intersection.object !== this.edgeLines || intersection.index === undefined) return null;\n    const segmentIndex = Math.floor(intersection.index / 2);\n    const segment = this.edgeSegments[segmentIndex];\n    return segment ? {\n      range: { ...segment.edge, startT: 0, endT: 1 },\n      panelInstanceId: segment.mesh.key,\n      segmentIndex,\n      t: edgeIntersectionT(intersection.point, segment),\n    } : null;\n  }\n\n  refreshPositions(): void {\n    writeEdgePositions(this.edgeLines.geometry, this.edgeSegments);\n    writeThreadPositions(this.threadLines.geometry, this.threadSegments);\n    writeDirectionNotches(this.notchLines.geometry, this.directionNotches);\n  }''',
    '''  edgeAtIntersection(intersection: THREE.Intersection): { range: EdgeRange; panelInstanceId: string; segmentIndex: number; t: number } | null {\n    if (intersection.object !== this.edgeLines || intersection.index === undefined) return null;\n    const segmentIndex = Math.floor(intersection.index / 2);\n    const segment = this.edgeSegments[segmentIndex];\n    return segment ? {\n      range: { ...segment.edge, startT: 0, endT: 1 },\n      panelInstanceId: segment.mesh.key,\n      segmentIndex,\n      t: edgeIntersectionT(intersection.point, segment),\n    } : null;\n  }\n\n  threadAtIntersection(intersection: THREE.Intersection): { seamId: string; seamGroupId: string } | null {\n    if (intersection.object !== this.threadLines || intersection.index === undefined) return null;\n    const segment = this.threadSegments[Math.floor(intersection.index / 2)];\n    if (!segment || segment.proposal) return null;\n    return { seamId: segment.seamId, seamGroupId: segment.seamGroupId };\n  }\n\n  refreshPositions(): void {\n    writeEdgePositions(this.edgeLines.geometry, this.edgeSegments);\n    this.refreshThreads();\n  }\n\n  refreshThreads(): void {\n    writeThreadPositions(this.threadLines.geometry, this.threadSegments);\n    writeDirectionNotches(this.notchLines.geometry, this.directionNotches);\n  }''',
    "overlay hit and thread-only refresh",
)
text = replace_once(
    text,
    '''    const threadColors = this.threadLines.geometry.getAttribute("color") as THREE.BufferAttribute;\n    this.threadSegments.forEach((segment, index) => writeSegmentColor(\n      threadColors,\n      index,\n      segment.proposal ? PROPOSAL_THREAD_COLOR : THREAD_COLOR,\n    ));''',
    '''    const threadColors = this.threadLines.geometry.getAttribute("color") as THREE.BufferAttribute;\n    this.threadSegments.forEach((segment, index) => {\n      const color = segment.proposal\n        ? PROPOSAL_THREAD_COLOR\n        : this.selection.selectedSeamId === segment.seamId\n          ? SELECTED_THREAD_COLOR\n          : segment.inactive\n            ? INACTIVE_THREAD_COLOR\n            : confirmedThreadColor(segment.seamGroupId);\n      writeSegmentColor(threadColors, index, color);\n    });''',
    "thread state colors",
)
text = replace_once(
    text,
    '''      for (let offset = 0; offset < 3; offset += 1) {\n        writeSegmentColor(notchColors, base + offset, notch.proposal ? PROPOSAL_THREAD_COLOR : FIRST_COLOR);\n      }\n      for (let offset = 3; offset < 6; offset += 1) {\n        writeSegmentColor(notchColors, base + offset, notch.proposal ? PROPOSAL_THREAD_COLOR : SECOND_COLOR);\n      }''',
    '''      const selected = this.selection.selectedSeamId === notch.seamId;\n      const firstColor = notch.proposal\n        ? PROPOSAL_THREAD_COLOR\n        : selected ? SELECTED_THREAD_COLOR : notch.inactive ? INACTIVE_THREAD_COLOR : FIRST_COLOR;\n      const secondColor = notch.proposal\n        ? PROPOSAL_THREAD_COLOR\n        : selected ? SELECTED_THREAD_COLOR : notch.inactive ? INACTIVE_THREAD_COLOR : SECOND_COLOR;\n      for (let offset = 0; offset < 3; offset += 1) writeSegmentColor(notchColors, base + offset, firstColor);\n      for (let offset = 3; offset < 6; offset += 1) writeSegmentColor(notchColors, base + offset, secondColor);''',
    "notch state colors",
)
text = replace_once(
    text,
    '''function buildThreadSegments(\n  meshes: readonly GarmentAssemblyMeshData[],\n  state: GarmentAssemblyState,\n  proposalConstraints: readonly AssemblyStitchConstraint[],\n): ThreadSegment[] {''',
    '''function buildThreadSegments(\n  meshes: readonly GarmentAssemblyMeshData[],\n  state: GarmentAssemblyState,\n  proposalConstraints: readonly AssemblyStitchConstraint[],\n  inactiveConstraints: readonly AssemblyStitchConstraint[],\n): ThreadSegment[] {''',
    "thread builder inactive arg",
)
text = replace_once(
    text,
    '''  const canonical = [...state.stitchConstraints.map((constraint) => ({ constraint, proposal: false })),\n    ...proposalConstraints.map((constraint) => ({ constraint, proposal: true }))]\n    .flatMap(({ constraint, proposal }) => {''',
    '''  const canonical = [\n    ...state.stitchConstraints.map((constraint) => ({ constraint, proposal: false, inactive: false })),\n    ...proposalConstraints.map((constraint) => ({ constraint, proposal: true, inactive: false })),\n    ...inactiveConstraints.map((constraint) => ({ constraint, proposal: false, inactive: true })),\n  ].flatMap(({ constraint, proposal, inactive }) => {''',
    "thread sources",
)
text = replace_once(
    text,
    '''        proposal,\n        progress: Number.isFinite(constraint.progress) ? constraint.progress! : 0,''',
    '''        proposal,\n        inactive,\n        progress: Number.isFinite(constraint.progress) ? constraint.progress! : 0,''',
    "thread source inactive property",
)
text = replace_once(
    text,
    '''    const key = `${segment.proposal ? "proposal" : "confirmed"}/${segment.seamId}/${segment.firstMesh.key}/${segment.secondMesh.key}`;''',
    '''    const key = `${segment.proposal ? "proposal" : segment.inactive ? "inactive" : "confirmed"}/${segment.seamId}/${segment.firstMesh.key}/${segment.secondMesh.key}`;''',
    "resample group inactive key",
)
# The same grouping expression occurs in buildDirectionNotches; replace its remaining occurrence.
text = replace_once(
    text,
    '''    const key = `${segment.proposal ? "proposal" : "confirmed"}/${segment.seamId}/${segment.firstMesh.key}/${segment.secondMesh.key}`;''',
    '''    const key = `${segment.proposal ? "proposal" : segment.inactive ? "inactive" : "confirmed"}/${segment.seamId}/${segment.firstMesh.key}/${segment.secondMesh.key}`;''',
    "notch group inactive key",
)
text = replace_once(
    text,
    '''      secondStart: cloneReference(first.secondReference),\n      secondEnd: cloneReference(last.secondReference),\n      proposal: first.proposal,''',
    '''      secondStart: cloneReference(first.secondReference),\n      secondEnd: cloneReference(last.secondReference),\n      seamId: first.seamId,\n      inactive: first.inactive,\n      proposal: first.proposal,''',
    "notch seam state values",
)
# Add deterministic palette helper before reference interpolation.
text = replace_once(
    text,
    '''function interpolateReference(\n  first: GlobalPointReference,''',
    '''function confirmedThreadColor(seamGroupId: string): THREE.Color {\n  let hash = 2166136261;\n  for (let index = 0; index < seamGroupId.length; index += 1) {\n    hash ^= seamGroupId.charCodeAt(index);\n    hash = Math.imul(hash, 16777619);\n  }\n  return CONFIRMED_THREAD_PALETTE[(hash >>> 0) % CONFIRMED_THREAD_PALETTE.length];\n}\n\nfunction interpolateReference(\n  first: GlobalPointReference,''',
    "deterministic thread palette helper",
)
write(OVERLAY, text)


# ---------------------------------------------------------------------------
# 3) ThreeViewport: incremental sewing compile, stale-overlay ordering fix,
#    no full buffer rewrite on hover, selectable 3D threads, cheap drag updates.
# ---------------------------------------------------------------------------
text = read(GLOBAL)
text = replace_once(
    text,
    '''export interface SewingViewportState extends SewingOverlaySelection {\n  active: boolean;\n  proposal: Seam | null;\n}''',
    '''export interface SewingViewportState extends SewingOverlaySelection {\n  active: boolean;\n  showThreads: boolean;\n  selectedSeamId: string | null;\n  proposal: Seam | null;\n}''',
    "viewport sewing state flags",
)
text = replace_once(
    text,
    '''  private sewingState: SewingViewportState = { active: false, first: [], second: [], proposal: null };\n  private sewingEdgeSelectHandler?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void;''',
    '''  private sewingState: SewingViewportState = {\n    active: false,\n    showThreads: true,\n    selectedSeamId: null,\n    first: [],\n    second: [],\n    proposal: null,\n  };\n  private sewingEdgeSelectHandler?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void;\n  private sewingSeamSelectHandler?: (seamId: string) => void;''',
    "viewport sewing handlers",
)
text = replace_once(
    text,
    '''  setSewingState(\n    state: SewingViewportState,\n    onEdgeSelect?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void,\n  ): void {\n    this.sewingState = {\n      active: state.active,\n      first: state.first.map((range) => ({ ...range })),\n      second: state.second.map((range) => ({ ...range })),\n      proposal: state.proposal ? structuredClone(state.proposal) : null,\n    };\n    this.sewingEdgeSelectHandler = onEdgeSelect;''',
    '''  setSewingState(\n    state: SewingViewportState,\n    onEdgeSelect?: (range: EdgeRange, panelInstanceId: string, hitT: number) => void,\n    onSeamSelect?: (seamId: string) => void,\n  ): void {\n    this.sewingState = {\n      active: state.active,\n      showThreads: state.showThreads,\n      selectedSeamId: state.selectedSeamId,\n      first: state.first.map((range) => ({ ...range })),\n      second: state.second.map((range) => ({ ...range })),\n      proposal: state.proposal ? structuredClone(state.proposal) : null,\n    };\n    this.sewingEdgeSelectHandler = onEdgeSelect;\n    this.sewingSeamSelectHandler = onSeamSelect;''',
    "setSewingState callbacks",
)
# Add incremental relationship update after transform-only arrangement method.
needle = '''  rotateArrangementSelection(axis: Exclude<ArrangementAxis, "free">, deltaDeg: number): void {'''
insertion = '''  updateSewingRelationships(input: ResolvedAssemblyInput): void {\n    this.currentInput = input;\n    this.host.dataset.sewingRevision = input.sewingRevision;\n    if (this.viewportMode !== "assembly" || !this.assemblyState) {\n      this.requestRender();\n      return;\n    }\n\n    const warnings: string[] = [];\n    const dartConstraints = this.assemblyState.stitchConstraints.filter((constraint) =>\n      constraint.seamGroupId.startsWith("dart:"),\n    );\n    const sewingConstraints = buildGlobalStitchConstraints(\n      this.assemblyState.instances,\n      input.garmentProjection.seams ?? [],\n      warnings,\n    );\n    this.assemblyState.stitchConstraints = [...sewingConstraints, ...dartConstraints];\n    this.host.dataset.sewingIncrementalUpdates = String(\n      Number(this.host.dataset.sewingIncrementalUpdates ?? "0") + 1,\n    );\n    this.host.dataset.sewingIncrementalWarnings = JSON.stringify(warnings);\n    this.host.dataset.sewingActiveConstraintCount = String(sewingConstraints.length);\n    this.refreshSewingOverlay();\n    this.requestRender();\n  }\n\n'''
text = replace_once(text, needle, insertion + needle, "incremental sewing method")
# Cheap thread refresh for explicit arrangement operations.
text = replace_once(
    text,
    '''    this.commitSelectedArrangement(attachmentById, true);\n    this.updateArrangementGizmo();\n    this.requestRender();\n  }\n\n  flipArrangementSelection(): void {''',
    '''    this.commitSelectedArrangement(attachmentById, true);\n    this.updateArrangementGizmo();\n    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();\n    this.requestRender();\n  }\n\n  flipArrangementSelection(): void {''',
    "rotate selection thread refresh",
)
text = replace_once(
    text,
    '''    this.commitSelectedArrangement(attachmentById, true);\n    this.updateArrangementGizmo();\n    this.requestRender();\n  }\n\n  focusArrangementSelection(): void {''',
    '''    this.commitSelectedArrangement(attachmentById, true);\n    this.updateArrangementGizmo();\n    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();\n    this.requestRender();\n  }\n\n  focusArrangementSelection(): void {''',
    "flip selection thread refresh",
)
text = replace_once(
    text,
    '''    if (commits.length > 0) {\n      this.arrangementCommitHandler?.(commits);\n      this.updateArrangementGizmo();\n      this.requestRender();\n    }''',
    '''    if (commits.length > 0) {\n      this.arrangementCommitHandler?.(commits);\n      this.updateArrangementGizmo();\n      if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();\n      this.requestRender();\n    }''',
    "adjust threads refresh",
)
# Worker response must not rebuild overlay before authored transforms are applied.
text = replace_once(
    text,
    '''      this.assemblyState = state;\n      this.assemblyRevision = response.revision;\n      this.pendingAssemblyRevision = null;\n      this.refreshSewingOverlay();\n      this.host.dataset.simulationGeometryRevision = response.revision;''',
    '''      this.assemblyState = state;\n      this.assemblyRevision = response.revision;\n      this.pendingAssemblyRevision = null;\n      this.host.dataset.simulationGeometryRevision = response.revision;''',
    "remove stale pre-arrangement overlay rebuild",
)
text = replace_once(
    text,
    '''        this.proceduralAvatarGroup.visible = true;\n        this.applyWorkspaceArrangement(input, avatarModel);\n        this.bodyRegistrationStatus = "body-placement-required";''',
    '''        this.proceduralAvatarGroup.visible = true;\n        this.applyWorkspaceArrangement(input, avatarModel);\n        // The worker may have started before a seam-only edit. Compile the\n        // latest relationships after authored transforms, without rebuilding\n        // topology or meshes.\n        this.updateSewingRelationships(this.currentInput ?? input);\n        this.bodyRegistrationStatus = "body-placement-required";''',
    "post-arrangement sewing rebuild",
)
# Thread click selection outside authoring comes before arrangement picking.
text = replace_once(
    text,
    '''    if (this.sewingState.active && event.button === 0) {\n      const edge = this.raycastSewingEdge(event);\n      if (edge) {\n        this.sewingEdgeSelectHandler?.(edge.range, edge.panelInstanceId, edge.t);\n        event.preventDefault();\n        event.stopImmediatePropagation();\n      }\n      return;\n    }\n    if (event.button === 2) {''',
    '''    if (this.sewingState.active && event.button === 0) {\n      const edge = this.raycastSewingEdge(event);\n      if (edge) {\n        this.sewingEdgeSelectHandler?.(edge.range, edge.panelInstanceId, edge.t);\n        event.preventDefault();\n        event.stopImmediatePropagation();\n      }\n      return;\n    }\n    if (!this.sewingState.active && this.sewingState.showThreads && event.button === 0) {\n      const thread = this.raycastSewingThread(event);\n      if (thread) {\n        this.sewingSeamSelectHandler?.(thread.seamId);\n        event.preventDefault();\n        event.stopImmediatePropagation();\n        return;\n      }\n    }\n    if (event.button === 2) {''',
    "3D thread selection",
)
# Hover over a thread outside Costurar should show pointer and avoid arrangement hover only on hit.
text = replace_once(
    text,
    '''      if (this.sewingState.active && this.viewportMode === "assembly" && event.buttons === 0) {\n        const edge = this.raycastSewingEdge(event);\n        this.sewingOverlay.setHovered(edge?.segmentIndex ?? null);\n        this.renderer.domElement.style.cursor = edge ? "pointer" : "grab";\n        this.requestRender();\n        return;\n      }\n      if (this.viewportMode === "assembly" && event.buttons === 0) this.updateArrangementHover(event);''',
    '''      if (this.sewingState.active && this.viewportMode === "assembly" && event.buttons === 0) {\n        const edge = this.raycastSewingEdge(event);\n        this.sewingOverlay.setHovered(edge?.segmentIndex ?? null);\n        this.renderer.domElement.style.cursor = edge ? "pointer" : "grab";\n        this.requestRender();\n        return;\n      }\n      if (this.viewportMode === "assembly" && event.buttons === 0 && this.sewingState.showThreads) {\n        const thread = this.raycastSewingThread(event);\n        if (thread) {\n          this.renderer.domElement.style.cursor = "pointer";\n          return;\n        }\n      }\n      if (this.viewportMode === "assembly" && event.buttons === 0) this.updateArrangementHover(event);''',
    "3D thread hover",
)
# Drag: refresh only thread/notch buffers, never all sewing edges.
text = replace_once(
    text,
    '''      this.hideArrangementCandidate();\n      this.updateArrangementGizmo();\n      this.markArrangementTransientFrame();''',
    '''      this.hideArrangementCandidate();\n      this.updateArrangementGizmo();\n      if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();\n      this.markArrangementTransientFrame();''',
    "rotation drag threads",
)
text = replace_once(
    text,
    '''    drag.moved = drag.moved || delta.lengthSq() > 1e-8;\n    this.updateArrangementGizmo();\n    this.markArrangementTransientFrame();''',
    '''    drag.moved = drag.moved || delta.lengthSq() > 1e-8;\n    this.updateArrangementGizmo();\n    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();\n    this.markArrangementTransientFrame();''',
    "translation drag threads",
)
# Pointer release also catches click/reset path.
text = replace_once(
    text,
    '''    delete this.host.dataset.arrangementActiveHandle;\n    this.updateArrangementGizmo();\n    this.arrangementInteractionHandler?.(false);''',
    '''    delete this.host.dataset.arrangementActiveHandle;\n    this.updateArrangementGizmo();\n    if (this.sewingState.showThreads) this.sewingOverlay.refreshThreads();\n    this.arrangementInteractionHandler?.(false);''',
    "release thread refresh",
)
# Remove the all-buffer rewrite from the edge hover hit test and add thread raycast.
text = replace_once(
    text,
    '''  private raycastSewingEdge(event: PointerEvent): ReturnType<SewingViewportOverlay["edgeAtIntersection"]> {\n    this.sewingOverlay.refreshPositions();\n    const raycaster = new THREE.Raycaster();\n    const depth = this.camera.position.distanceTo(this.controls.target);\n    raycaster.params.Line = {\n      threshold: perspectiveWorldUnitsPerPixel(depth, this.camera.fov, this.renderer.domElement.clientHeight) * 22,\n    };\n    raycaster.setFromCamera(this.pointerNdc(event), this.camera);\n    const hit = raycaster.intersectObject(this.sewingOverlay.edgeLines, false)[0];\n    return hit ? this.sewingOverlay.edgeAtIntersection(hit) : null;\n  }\n\n  private refreshSewingOverlay(): void {''',
    '''  private raycastSewingEdge(event: PointerEvent): ReturnType<SewingViewportOverlay["edgeAtIntersection"]> {\n    const raycaster = new THREE.Raycaster();\n    const depth = this.camera.position.distanceTo(this.controls.target);\n    raycaster.params.Line = {\n      threshold: perspectiveWorldUnitsPerPixel(depth, this.camera.fov, this.renderer.domElement.clientHeight) * 22,\n    };\n    raycaster.setFromCamera(this.pointerNdc(event), this.camera);\n    const hit = raycaster.intersectObject(this.sewingOverlay.edgeLines, false)[0];\n    return hit ? this.sewingOverlay.edgeAtIntersection(hit) : null;\n  }\n\n  private raycastSewingThread(event: PointerEvent): ReturnType<SewingViewportOverlay["threadAtIntersection"]> {\n    const raycaster = new THREE.Raycaster();\n    const depth = this.camera.position.distanceTo(this.controls.target);\n    raycaster.params.Line = {\n      threshold: perspectiveWorldUnitsPerPixel(depth, this.camera.fov, this.renderer.domElement.clientHeight) * 14,\n    };\n    raycaster.setFromCamera(this.pointerNdc(event), this.camera);\n    const hit = raycaster.intersectObject(this.sewingOverlay.threadLines, false)[0];\n    return hit ? this.sewingOverlay.threadAtIntersection(hit) : null;\n  }\n\n  private refreshSewingOverlay(): void {''',
    "sewing raycast hot path",
)
# Rebuild proposal + inactive visuals from the exact canonical physical compiler.
text = replace_once(
    text,
    '''  private refreshSewingOverlay(): void {\n    const proposalWarnings: string[] = [];\n    const proposalConstraints = this.assemblyState && this.sewingState.proposal\n      ? buildGlobalStitchConstraints(this.assemblyState.instances, [this.sewingState.proposal], proposalWarnings)\n      : [];\n    this.sewingOverlay.rebuild(this.garmentMeshes, this.assemblyState, this.sewingState, proposalConstraints);\n    this.sewingOverlay.setVisible(this.viewportMode === "assembly" && this.sewingState.active);\n    this.host.dataset.sewingPhysicalThreadCount = String(\n      (this.assemblyState?.stitchConstraints.filter((constraint) => !constraint.seamGroupId.startsWith("dart:")).length ?? 0)\n      + proposalConstraints.length,\n    );\n    this.host.dataset.sewingThreadCount = String(this.sewingOverlay.visualThreadCount);\n    this.host.dataset.sewingDirectionNotchCount = String(this.sewingOverlay.directionNotchCount);\n    this.host.dataset.sewingProposalWarnings = JSON.stringify(proposalWarnings);\n  }''',
    '''  private refreshSewingOverlay(): void {\n    const proposalWarnings: string[] = [];\n    const inactiveWarnings: string[] = [];\n    const proposalConstraints = this.assemblyState && this.sewingState.proposal\n      ? buildGlobalStitchConstraints(this.assemblyState.instances, [this.sewingState.proposal], proposalWarnings)\n      : [];\n    const inactiveSeams = (this.currentInput?.garmentProjection.seams ?? [])\n      .filter((seam) => seam.active === false)\n      .map((seam) => ({ ...seam, active: true }));\n    const inactiveConstraints = this.assemblyState && inactiveSeams.length > 0\n      ? buildGlobalStitchConstraints(this.assemblyState.instances, inactiveSeams, inactiveWarnings)\n      : [];\n    this.sewingOverlay.rebuild(\n      this.garmentMeshes,\n      this.assemblyState,\n      this.sewingState,\n      proposalConstraints,\n      inactiveConstraints,\n    );\n    const assemblyVisible = this.viewportMode === "assembly";\n    this.sewingOverlay.setVisibility(\n      assemblyVisible && this.sewingState.active,\n      assemblyVisible && this.sewingState.showThreads,\n    );\n    this.host.dataset.sewingPhysicalThreadCount = String(\n      (this.assemblyState?.stitchConstraints.filter((constraint) => !constraint.seamGroupId.startsWith("dart:")).length ?? 0)\n      + proposalConstraints.length,\n    );\n    this.host.dataset.sewingInactiveVisualConstraintCount = String(inactiveConstraints.length);\n    this.host.dataset.sewingThreadCount = String(this.sewingOverlay.visualThreadCount);\n    this.host.dataset.sewingDirectionNotchCount = String(this.sewingOverlay.directionNotchCount);\n    this.host.dataset.sewingProposalWarnings = JSON.stringify(proposalWarnings);\n    this.host.dataset.sewingInactiveWarnings = JSON.stringify(inactiveWarnings);\n  }''',
    "sewing overlay canonical inactive visuals",
)
write(GLOBAL, text)


# ---------------------------------------------------------------------------
# 4) React viewport: selected seam bridge, show/hide preference, incremental
#    sewing effect, compact relationship visibility affordance.
# ---------------------------------------------------------------------------
text = read(GARMENT_VIEWPORT)
text = replace_once(
    text,
    '''import type { Seam } from "../domain/pattern";''',
    '''import { seamSideRanges, type Seam } from "../domain/pattern";''',
    "GarmentViewport seamSideRanges import",
)
text = replace_once(
    text,
    '''  const [touchMultiSelect, setTouchMultiSelect] = useState(false);\n  const arrangementToolRef = useRef<ArrangementTool>(arrangementTool);''',
    '''  const [touchMultiSelect, setTouchMultiSelect] = useState(false);\n  const [showSewingConnections, setShowSewingConnections] = useState(() => {\n    try {\n      return window.localStorage.getItem("moldeon.showSewingConnections") !== "false";\n    } catch {\n      return true;\n    }\n  });\n  const previousSewingActiveRef = useRef(sewingActive);\n  const arrangementToolRef = useRef<ArrangementTool>(arrangementTool);''',
    "show sewing connections state",
)
text = replace_once(
    text,
    '''  const seamDraft = useEditorStore((state) => state.seamDraft);\n  const seamProposal = useEditorStore((state) => state.seamProposal);''',
    '''  const seamDraft = useEditorStore((state) => state.seamDraft);\n  const seamProposal = useEditorStore((state) => state.seamProposal);\n  const selectedSeamId = useEditorStore((state) => state.selectedSeamId);\n  const selectedSeam = useMemo(\n    () => assemblyInput.garmentProjection.seams?.find((seam) => seam.id === selectedSeamId) ?? null,\n    [assemblyInput.garmentProjection.seams, selectedSeamId],\n  );\n  const sewingFirstRanges = seamProposal?.firstRanges\n    ?? seamDraft?.first\n    ?? (selectedSeam ? seamSideRanges(selectedSeam, "first") : []);\n  const sewingSecondRanges = seamProposal?.secondRanges\n    ?? seamDraft?.second\n    ?? (selectedSeam ? seamSideRanges(selectedSeam, "second") : []);''',
    "selected seam bridge",
)
# Initial setSewingState call.
text = replace_once(
    text,
    '''        viewport.setSewingState({\n          active: sewingActive,\n          first: seamProposal?.firstRanges ?? seamDraft?.first ?? [],\n          second: seamProposal?.secondRanges ?? seamDraft?.second ?? [],\n          proposal: proposalSeam,\n        }, (range, panelInstanceId, hitT) => useEditorStore.getState().selectSeamRange(range, panelInstanceId, hitT));''',
    '''        viewport.setSewingState({\n          active: sewingActive,\n          showThreads: showSewingConnections,\n          selectedSeamId,\n          first: sewingFirstRanges,\n          second: sewingSecondRanges,\n          proposal: proposalSeam,\n        },\n        (range, panelInstanceId, hitT) => useEditorStore.getState().selectSeamRange(range, panelInstanceId, hitT),\n        (seamId) => useEditorStore.getState().selectSeam(seamId));''',
    "initial viewport sewing bridge",
)
# Separate seam-only revision effect after arrangement revision effect.
marker = '''  useEffect(() => {\n    if (!active) return;\n    const frame = window.requestAnimationFrame(() => viewportRef.current?.refresh());'''
sewing_effect = '''  useEffect(() => {\n    if (!active || displayMode !== "side-preview") return;\n    viewportRef.current?.updateSewingRelationships(assemblyInput);\n  }, [active, assemblyInput.sewingRevision, displayMode]);\n\n'''
text = replace_once(text, marker, sewing_effect + marker, "sewing revision React effect")
# Persist visibility and default ON on each Costurar entry.
marker = '''  useEffect(() => {\n    arrangementToolRef.current = arrangementTool;'''
visibility_effects = '''  useEffect(() => {\n    if (sewingActive && !previousSewingActiveRef.current) setShowSewingConnections(true);\n    previousSewingActiveRef.current = sewingActive;\n  }, [sewingActive]);\n\n  useEffect(() => {\n    try {\n      window.localStorage.setItem("moldeon.showSewingConnections", String(showSewingConnections));\n    } catch {\n      // Storage may be unavailable in private/restricted contexts; visibility\n      // remains a local UI preference and never affects SeamGroupV3.active.\n    }\n  }, [showSewingConnections]);\n\n'''
text = replace_once(text, marker, visibility_effects + marker, "sewing visibility effects")
# Reactive setSewingState call.
text = replace_once(
    text,
    '''  useEffect(() => {\n    viewportRef.current?.setSewingState({\n      active: sewingActive,\n      first: seamProposal?.firstRanges ?? seamDraft?.first ?? [],\n      second: seamProposal?.secondRanges ?? seamDraft?.second ?? [],\n      proposal: proposalSeam,\n    }, (range, panelInstanceId, hitT) => useEditorStore.getState().selectSeamRange(range, panelInstanceId, hitT));\n  }, [proposalSeam, seamDraft, seamProposal, sewingActive]);''',
    '''  useEffect(() => {\n    viewportRef.current?.setSewingState({\n      active: sewingActive,\n      showThreads: showSewingConnections,\n      selectedSeamId,\n      first: sewingFirstRanges,\n      second: sewingSecondRanges,\n      proposal: proposalSeam,\n    },\n    (range, panelInstanceId, hitT) => useEditorStore.getState().selectSeamRange(range, panelInstanceId, hitT),\n    (seamId) => useEditorStore.getState().selectSeam(seamId));\n  }, [proposalSeam, seamDraft, seamProposal, sewingActive, showSewingConnections, selectedSeamId, selectedSeam]);''',
    "reactive viewport sewing bridge",
)
# Compact show/hide control after viewport label.
text = replace_once(
    text,
    '''      <div className="viewport-label">\n        {import.meta.env.DEV\n          ? `Manequim procedural DEV · ${assemblyInput.document.body.type}`\n          : approvedAvatar\n            ? `Manequim aprovado · ${approvedAvatar.assetId}`\n            : AVATAR_NOT_CONFIGURED_MESSAGE}\n      </div>\n      {displayMode === "side-preview" && !sewingActive ? (''',
    '''      <div className="viewport-label">\n        {import.meta.env.DEV\n          ? `Manequim procedural DEV · ${assemblyInput.document.body.type}`\n          : approvedAvatar\n            ? `Manequim aprovado · ${approvedAvatar.assetId}`\n            : AVATAR_NOT_CONFIGURED_MESSAGE}\n      </div>\n      {displayMode === "side-preview" ? (\n        <button\n          type="button"\n          className="viewport-sewing-visibility"\n          aria-pressed={showSewingConnections}\n          onClick={() => setShowSewingConnections((visible) => !visible)}\n        >\n          {showSewingConnections ? "Ocultar conexões" : "Mostrar conexões"}\n        </button>\n      ) : null}\n      {displayMode === "side-preview" && !sewingActive ? (''',
    "show hide sewing button",
)
write(GARMENT_VIEWPORT, text)


# ---------------------------------------------------------------------------
# 5) Store: one-history-entry group editing and explicit canonical defaults.
# ---------------------------------------------------------------------------
text = read(STORE)
text = replace_once(
    text,
    '''export interface EditorState {''',
    '''export interface SeamEditUpdate {\n  name?: string;\n  direction?: SeamDirection;\n  treatment?: SeamTreatment;\n  distribution?: SeamDistribution;\n  targetRatio?: number;\n  slackMm?: number;\n  active?: boolean;\n}\n\nexport interface EditorState {''',
    "SeamEditUpdate type",
)
text = replace_once(
    text,
    '''  updateSeam(seamId: string, update: {\n    name?: string;\n    direction?: SeamDirection;\n    treatment?: SeamTreatment;\n    distribution?: SeamDistribution;\n    targetRatio?: number;\n    slackMm?: number;\n    active?: boolean;\n  }): void;\n  removeSeam(seamId: string): void;''',
    '''  updateSeam(seamId: string, update: SeamEditUpdate): void;\n  updateSeams(updates: readonly { seamId: string; update: SeamEditUpdate }[]): void;\n  removeSeam(seamId: string): void;\n  removeSeams(seamIds: readonly string[]): void;''',
    "store batch seam action types",
)
# Explicit defaults on legacy simple seam action.
text = replace_once(
    text,
    '''      name: `Costura ${(state.garment.seams?.length ?? 0) + 1}`,\n      treatment: "standard",\n    };''',
    '''      name: `Costura ${(state.garment.seams?.length ?? 0) + 1}`,\n      treatment: "standard",\n      distribution: "uniform",\n      targetRatio: 1,\n      slackMm: 0,\n      active: true,\n    };''',
    "simple seam explicit defaults",
)
# Replace remove/toggle group with batch-aware definitions, preserving legacy public methods.
text = replace_once(
    text,
    '''  removeSeam: (seamId) => changeDocument(set, get, "seam", "Remover costura", (document) => ({\n    ...document,\n    garment: {\n      ...document.garment,\n      seams: (document.garment.seams ?? []).filter((seam) => seam.id !== seamId),\n    },\n  }), { selectedSeamId: null }),''',
    '''  removeSeam: (seamId) => get().removeSeams([seamId]),\n  removeSeams: (seamIds) => {\n    const ids = new Set(seamIds);\n    if (ids.size === 0) return;\n    const selectedSeamId = get().selectedSeamId;\n    changeDocument(set, get, "seam", ids.size === 1 ? "Remover costura" : "Remover grupo de costura", (document) => ({\n      ...document,\n      garment: {\n        ...document.garment,\n        seams: (document.garment.seams ?? []).filter((seam) => !ids.has(seam.id)),\n      },\n    }), { selectedSeamId: selectedSeamId && !ids.has(selectedSeamId) ? selectedSeamId : null });\n  },''',
    "batch seam removal",
)
# Confirm proposal canonical defaults.
text = replace_once(
    text,
    '''      direction: options.direction,\n      treatment: options.treatment,\n      type: options.treatment,\n      easeRatio: proposal.compatibility.differencePercent / 100,\n    };''',
    '''      direction: options.direction,\n      treatment: options.treatment,\n      type: options.treatment,\n      distribution: options.treatment === "ease" || options.treatment === "gather" ? "proportional" : "uniform",\n      targetRatio: Math.max(0.000001, 1 + proposal.compatibility.differencePercent / 100),\n      slackMm: 0,\n      active: true,\n      easeRatio: proposal.compatibility.differencePercent / 100,\n    };''',
    "confirmed seam explicit defaults",
)
text = replace_once(
    text,
    '''    set({ seamProposal: null, seamDraft: null, seamFirstEdge: null, seamIssues: [], nearbySeamSuggestion: null });''',
    '''    set({ seamProposal: null, seamDraft: null, seamFreeStart: null, seamFirstEdge: null, seamIssues: [], nearbySeamSuggestion: null });''',
    "confirmed seam draft cleanup",
)
# Replace updateSeam with a single/batch implementation that preserves selection.
text = replace_once(
    text,
    '''  updateSeam: (seamId, update) => changeDocument(set, get, "seam", "Editar costura", (document) => ({\n    ...document,\n    garment: {\n      ...document.garment,\n      seams: (document.garment.seams ?? []).map((seam) => seam.id === seamId\n        ? { ...seam, ...update, ...(update.treatment ? { type: update.treatment } : {}) }\n        : seam),\n    },\n  })),''',
    '''  updateSeam: (seamId, update) => get().updateSeams([{ seamId, update }]),\n  updateSeams: (updates) => {\n    if (updates.length === 0) return;\n    const byId = new Map(updates.map(({ seamId, update }) => [seamId, update] as const));\n    const selectedSeamId = get().selectedSeamId;\n    changeDocument(set, get, "seam", updates.length === 1 ? "Editar costura" : "Editar grupo de costura", (document) => ({\n      ...document,\n      garment: {\n        ...document.garment,\n        seams: (document.garment.seams ?? []).map((seam) => {\n          const update = byId.get(seam.id);\n          return update\n            ? { ...seam, ...update, ...(update.treatment ? { type: update.treatment } : {}) }\n            : seam;\n        }),\n      },\n    }), { selectedSeamId });\n  },''',
    "batch seam updates",
)
write(STORE, text)


# ---------------------------------------------------------------------------
# 6) Assembly panel: compact metrics + batch edits, no history clone per keypress.
# ---------------------------------------------------------------------------
text = read(PANEL)
text = replace_once(
    text,
    '''  edgeRangeSequenceLength,\n  getPatternEdges,''',
    '''  edgeRangeSequenceLength,\n  getPatternEdges,\n  seamSideRanges,''',
    "AssemblyPanel seamSideRanges import",
)
text = replace_once(
    text,
    '''  const updateSeam = useEditorStore((state) => state.updateSeam);\n  const removeSeam = useEditorStore((state) => state.removeSeam);''',
    '''  const updateSeams = useEditorStore((state) => state.updateSeams);\n  const removeSeams = useEditorStore((state) => state.removeSeams);''',
    "AssemblyPanel batch store actions",
)
# Toggle functions are no longer used directly by group controls.
text = replace_once(
    text,
    '''  const toggleSeamDirection = useEditorStore((state) => state.toggleSeamDirection);\n  const toggleSeamActive = useEditorStore((state) => state.toggleSeamActive);\n  const setGarmentEase''',
    '''  const setGarmentEase''',
    "remove per-seam toggles from panel",
)
text = replace_once(
    text,
    '''  const secondDraftLengthMm = seamDraft ? edgeRangeSequenceLength(garment.pieces, seamDraft.second) : 0;\n\n  return (''',
    '''  const secondDraftLengthMm = seamDraft ? edgeRangeSequenceLength(garment.pieces, seamDraft.second) : 0;\n  const [seamNameDrafts, setSeamNameDrafts] = useState<Record<string, string>>({});\n\n  return (''',
    "seam name local drafts",
)
# Add derived relation metrics in map.
text = replace_once(
    text,
    '''            const representative = group[0];\n            const selected = group.some((seam) => seam.id === selectedSeamId);\n            const inactive = group.every((seam) => seam.active === false);\n            return (\n            <div className={`assembly-row seam-editor-row${selected ? " is-selected" : ""}${inactive ? " is-inactive" : ""}`} key={representative.groupId ?? representative.id} onClick={() => selectSeam(representative.id)}>''',
    '''            const representative = group[0];\n            const relationKey = representative.groupId ?? representative.id;\n            const relationLabel = seamRelationLabel(group);\n            const selected = group.some((seam) => seam.id === selectedSeamId);\n            const inactive = group.every((seam) => seam.active === false);\n            const firstRanges = group.flatMap((seam) => seamSideRanges(seam, "first"));\n            const secondRanges = group.flatMap((seam) => seamSideRanges(seam, "second"));\n            const firstLengthMm = edgeRangeSequenceLength(garment.pieces, firstRanges);\n            const secondLengthMm = edgeRangeSequenceLength(garment.pieces, secondRanges);\n            const deltaMm = secondLengthMm - firstLengthMm;\n            const deltaPercent = Math.abs(deltaMm) / Math.max(firstLengthMm, secondLengthMm, 1) * 100;\n            return (\n            <div className={`assembly-row seam-editor-row${selected ? " is-selected" : ""}${inactive ? " is-inactive" : ""}`} key={relationKey} onClick={() => selectSeam(representative.id)}>''',
    "relation metrics",
)
# Replace name input and insert length summary.
text = replace_once(
    text,
    '''              <input\n                aria-label="Nome da costura"\n                value={seamRelationLabel(group)}\n                onClick={(event) => event.stopPropagation()}\n                onChange={(event) => {\n                  const label = event.currentTarget.value;\n                  group.forEach((seam, index) => updateSeam(seam.id, {\n                    name: group.length > 1 ? `${label} · trecho ${index + 1}` : label,\n                  }));\n                }}\n              />\n              <select''',
    '''              <input\n                aria-label="Nome da costura"\n                value={seamNameDrafts[relationKey] ?? relationLabel}\n                onClick={(event) => event.stopPropagation()}\n                onChange={(event) => setSeamNameDrafts((current) => ({\n                  ...current,\n                  [relationKey]: event.currentTarget.value,\n                }))}\n                onBlur={(event) => {\n                  const label = event.currentTarget.value.trim() || relationLabel;\n                  updateSeams(group.map((seam, index) => ({\n                    seamId: seam.id,\n                    update: { name: group.length > 1 ? `${label} · trecho ${index + 1}` : label },\n                  })));\n                  setSeamNameDrafts((current) => {\n                    const next = { ...current };\n                    delete next[relationKey];\n                    return next;\n                  });\n                }}\n                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}\n              />\n              <div className={`seam-length-summary${deltaPercent > 2 ? " has-mismatch" : ""}`} aria-label="Comprimentos materiais da costura">\n                <span>A {firstLengthMm.toFixed(1)} mm</span>\n                <span>B {secondLengthMm.toFixed(1)} mm</span>\n                <strong>Δ {deltaMm >= 0 ? "+" : ""}{deltaMm.toFixed(1)} mm · {deltaPercent.toFixed(1)}%</strong>\n              </div>\n              <select''',
    "name edit and length summary",
)
# Batch treatment.
text = replace_once(
    text,
    '''                onChange={(event) => {\n                  for (const seam of group) updateSeam(seam.id, {\n                    treatment: event.currentTarget.value as SeamTreatment,\n                  });\n                }}''',
    '''                onChange={(event) => {\n                  const treatment = event.currentTarget.value as SeamTreatment;\n                  updateSeams(group.map((seam) => ({ seamId: seam.id, update: { treatment } })));\n                }}''',
    "batch treatment",
)
# Batch distribution.
text = replace_once(
    text,
    '''                  const distribution = event.currentTarget.value as SeamDistribution;\n                  for (const seam of group) updateSeam(seam.id, { distribution });''',
    '''                  const distribution = event.currentTarget.value as SeamDistribution;\n                  updateSeams(group.map((seam) => ({ seamId: seam.id, update: { distribution } })));''',
    "batch distribution",
)
# Batch ratio/slack.
text = replace_once(
    text,
    '''                    const targetRatio = Math.max(0.01, event.currentTarget.valueAsNumber || 1);\n                    for (const seam of group) updateSeam(seam.id, { targetRatio });''',
    '''                    const targetRatio = Math.max(0.01, event.currentTarget.valueAsNumber || 1);\n                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { targetRatio } })));''',
    "batch target ratio",
)
text = replace_once(
    text,
    '''                    const slackMm = Math.max(0, event.currentTarget.valueAsNumber || 0);\n                    for (const seam of group) updateSeam(seam.id, { slackMm });''',
    '''                    const slackMm = Math.max(0, event.currentTarget.valueAsNumber || 0);\n                    updateSeams(group.map((seam) => ({ seamId: seam.id, update: { slackMm } })));''',
    "batch slack",
)
# Batch active/reverse/delete.
text = replace_once(
    text,
    '''              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) if ((seam.active === false) === inactive) toggleSeamActive(seam.id); }}>\n                {inactive ? "Reativar" : "Desativar"}\n              </button>\n              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) toggleSeamDirection(seam.id); }}>\n                Inverter direção\n              </button>\n              <button type="button" onClick={(event) => { event.stopPropagation(); for (const seam of group) removeSeam(seam.id); }}>\n                Excluir\n              </button>''',
    '''              <button type="button" onClick={(event) => {\n                event.stopPropagation();\n                updateSeams(group.map((seam) => ({ seamId: seam.id, update: { active: inactive } })));\n              }}>\n                {inactive ? "Reativar" : "Desativar"}\n              </button>\n              <button type="button" onClick={(event) => {\n                event.stopPropagation();\n                updateSeams(group.map((seam) => ({\n                  seamId: seam.id,\n                  update: { direction: seam.direction === "same" ? "opposite" : "same" },\n                })));\n              }}>\n                Inverter direção\n              </button>\n              <button type="button" onClick={(event) => {\n                event.stopPropagation();\n                removeSeams(group.map((seam) => seam.id));\n              }}>\n                Excluir\n              </button>''',
    "batch seam row buttons",
)
# Proposal review: explicit material metrics and signed delta.
text = replace_once(
    text,
    '''      <p>\n        {(compatibility.firstLengthMm / 10).toFixed(1)} cm ↔{" "}\n        {(compatibility.secondLengthMm / 10).toFixed(1)} cm\n      </p>\n      <p>{compatibility.message}</p>''',
    '''      <div className={`seam-proposal-metrics${compatibility.differencePercent > 2 ? " has-mismatch" : ""}`}>\n        <span>Lado A <strong>{compatibility.firstLengthMm.toFixed(1)} mm</strong></span>\n        <span>Lado B <strong>{compatibility.secondLengthMm.toFixed(1)} mm</strong></span>\n        <span>Δ <strong>{(compatibility.secondLengthMm - compatibility.firstLengthMm) >= 0 ? "+" : ""}{(compatibility.secondLengthMm - compatibility.firstLengthMm).toFixed(1)} mm · {compatibility.differencePercent.toFixed(1)}%</strong></span>\n      </div>\n      <p>{compatibility.message}</p>''',
    "proposal metrics",
)
write(PANEL, text)


# ---------------------------------------------------------------------------
# 7) Compact visual polish, including mobile-safe 44px control.
# ---------------------------------------------------------------------------
text = read(STYLES)
css = r'''

/* 11.0.8 sewing relationship refinement */
.viewport-sewing-visibility {
  position: absolute;
  z-index: 9;
  top: 10px;
  right: 10px;
  min-height: 36px;
  border: 1px solid rgba(72, 67, 61, .42);
  border-radius: 9px;
  background: rgba(250, 248, 244, .92);
  backdrop-filter: blur(8px);
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 750;
  color: #302c27;
}

.viewport-sewing-visibility[aria-pressed="true"] {
  border-color: rgba(183, 42, 128, .66);
  box-shadow: 0 0 0 2px rgba(183, 42, 128, .1);
}

.seam-length-summary,
.seam-proposal-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 9px;
  align-items: center;
  font-size: 11px;
  color: #5c554d;
}

.seam-length-summary {
  grid-column: 1 / -1;
  padding: 6px 8px;
  border-radius: 7px;
  background: #f3f0eb;
}

.seam-length-summary strong,
.seam-proposal-metrics strong {
  color: #302b26;
}

.seam-length-summary.has-mismatch,
.seam-proposal-metrics.has-mismatch {
  background: #fff0ec;
  color: #8c332b;
}

.seam-proposal-metrics {
  margin: 6px 0 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f3f0eb;
}

.seam-editor-row.is-inactive .seam-length-summary {
  opacity: .72;
}

@media (max-width: 760px), (pointer: coarse) {
  .viewport-sewing-visibility {
    min-height: 44px;
    top: calc(8px + env(safe-area-inset-top));
    right: calc(8px + env(safe-area-inset-right));
    padding-inline: 11px;
  }

  .seam-length-summary,
  .seam-proposal-metrics {
    font-size: 10px;
    gap: 4px 7px;
  }
}
'''
if "/* 11.0.8 sewing relationship refinement */" not in text:
    text += css
write(STYLES, text)


# ---------------------------------------------------------------------------
# 8) Focused regressions for revision isolation / inactive persistence / batch edit.
# ---------------------------------------------------------------------------
text = read(RESOLVED_TEST)
append = r'''

describe("11.0.8 sewing revision isolation", () => {
  it("changes sewing and simulation revisions without invalidating geometry or arrangement", () => {
    const first = square("sew-a", placement("torso", "front", "center", "torso-front"));
    const second = square("sew-b", placement("torso", "back", "center", "torso-back"));
    const garment = draft([first, second]);
    garment.seams = [{
      id: "sew-revision",
      name: "Revision seam",
      first: { pieceId: first.id, edgeId: getPatternEdges(first)[0].id, startT: 0, endT: 1 },
      second: { pieceId: second.id, edgeId: getPatternEdges(second)[0].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      distribution: "uniform",
      targetRatio: 1,
      slackMm: 0,
      active: true,
    }];

    const original = buildResolvedAssemblyInput(garment);
    const reversedGarment = structuredClone(garment);
    reversedGarment.seams![0].direction = "same";
    const reversed = buildResolvedAssemblyInput(reversedGarment);

    expect(reversed.geometryRevision).toBe(original.geometryRevision);
    expect(reversed.arrangementRevision).toBe(original.arrangementRevision);
    expect(reversed.sewingRevision).not.toBe(original.sewingRevision);
    expect(reversed.simulationRevision).not.toBe(original.simulationRevision);

    const inactiveGarment = structuredClone(reversedGarment);
    inactiveGarment.seams![0].active = false;
    const inactive = buildResolvedAssemblyInput(inactiveGarment);
    expect(inactive.geometryRevision).toBe(original.geometryRevision);
    expect(inactive.arrangementRevision).toBe(original.arrangementRevision);
    expect(inactive.sewingRevision).not.toBe(reversed.sewingRevision);
    expect(inactive.seamGroups).toHaveLength(1);
    expect(inactive.seamGroups[0].active).toBe(false);
    expect(inactive.assemblyDocument.seamGroups[0].active).toBe(false);
    const inactiveAssembly = buildResolvedGarmentAssembly(inactive);
    expect(inactiveAssembly.stitchConstraints.filter((constraint) =>
      !constraint.seamGroupId.startsWith("dart:"),
    )).toHaveLength(0);
  });
});
'''
if 'describe("11.0.8 sewing revision isolation"' not in text:
    text += append
write(RESOLVED_TEST, text)

text = read(HISTORY_TEST)
append = r'''

describe("11.0.8 batched seam editing", () => {
  beforeEach(() => useEditorStore.getState().loadGarment(draft()));

  it("commits a grouped edit as one undoable document command", () => {
    const seamId = createSeam("Batch seam");
    const before = structuredClone(useEditorStore.getState().garment.seams![0]);
    useEditorStore.getState().selectSeam(seamId);
    useEditorStore.getState().updateSeams([{ seamId, update: {
      name: "Batch edited",
      direction: "same",
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 3.5,
      active: false,
    } }]);

    expect(useEditorStore.getState().garment.seams![0]).toMatchObject({
      name: "Batch edited",
      direction: "same",
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 3.5,
      active: false,
    });
    expect(useEditorStore.getState().selectedSeamId).toBe(seamId);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().garment.seams![0]).toEqual(before);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().garment.seams![0]).toMatchObject({
      name: "Batch edited",
      direction: "same",
      active: false,
    });
  });
});
'''
if 'describe("11.0.8 batched seam editing"' not in text:
    text += append
# Strengthen the existing overlay test with independent edge/thread visibility.
text = replace_once(
    text,
    '''    expect(overlay.directionNotchCount).toBeGreaterThan(0);\n\n    overlay.dispose();''',
    '''    expect(overlay.directionNotchCount).toBeGreaterThan(0);\n    overlay.setVisibility(false, true);\n    expect(overlay.edgeLines.visible).toBe(false);\n    expect(overlay.threadLines.visible).toBe(true);\n    expect(overlay.notchLines.visible).toBe(true);\n\n    overlay.dispose();''',
    "overlay visibility regression",
)
write(HISTORY_TEST, text)


# ---------------------------------------------------------------------------
# 9) Handoff update. This is a refinement checkpoint, not FINAL and not STEP-0.
# ---------------------------------------------------------------------------
text = read(DOC)
section = r'''

---

## Refinement checkpoint after Phase H (11.0.8 authoring polish)

This pass audits the Phase A-H implementation before the next manual gate. It deliberately does **not** start Phase J STEP-0 and does not touch `physics/**`.

### Revision isolation

`ResolvedAssemblyInput` now owns a dedicated `sewingRevision`.

- `geometryRevision` contains geometry/physical-instance identity only.
- `sewingRevision` contains canonical SeamGroup changes.
- `arrangementRevision` remains placement/body-measurement driven.
- `simulationRevision` includes `sewingRevision`, so Provar still rebuilds when sewing changes.

In Montar/Costurar a seam-only edit no longer invalidates geometry or asks the Assembly Worker to rebuild topology/meshes. `ThreeViewport.updateSewingRelationships()` recompiles only stitch correspondence against the already-built PanelInstances.

### Edit Sewing and inactive relationships

Inactive SeamGroups stay in the resolved authoring document. The physical compiler continues to skip `active=false`, while the 3D overlay may render the same canonical correspondence in gray for editing. This separates semantic existence from physics participation.

3D relationship threads are now selectable outside the Costurar tool and bridge back to the shared `selectedSeamId`. The selected relationship receives a high-contrast overlay; confirmed groups use a deterministic vertex-color palette without allocating one material per group.

### Show / hide connections

The 3D viewport has a compact `Mostrar conexões` / `Ocultar conexões` control. Thread visibility is a UI preference and never changes `SeamGroupV3.active`. Entering Costurar turns relationships on by default; the preference may remain outside the tool.

### Hot-path cleanup

Sewing edge hover no longer rewrites every edge/thread/notch BufferGeometry on each pointermove. Edge hit testing uses the cached world-space overlay. During authored 3D movement only thread/notch positions are refreshed, so relationship lines follow panels without remeshing or invoking the worker.

The stale ordering in the initial assembly response was also removed: authored arrangement transforms are applied before sewing overlays are finalized.

### Editor transaction cleanup

Group edits now use `updateSeams()` / `removeSeams()` so a multi-part relation is one history command instead of N full document clones. The seam name field keeps an in-UI draft and commits on blur/Enter instead of creating a history snapshot on every keystroke.

Confirmed seams also persist explicit canonical defaults (`distribution`, `targetRatio`, `slackMm`, `active`) rather than depending on projection defaults.

### Material length visibility

Existing seam rows and the proposal review show canonical 2D material lengths for Side A/Side B plus signed delta in mm and percentage. A mismatch receives visual emphasis but remains authorable.

### Focused regressions added

- seam reverse/active changes keep `geometryRevision` and `arrangementRevision` stable;
- `sewingRevision` and `simulationRevision` change;
- inactive SeamGroup remains persisted but produces zero active physical stitch constraints;
- grouped seam editing is one undoable transaction;
- edge visibility and thread visibility are independent.

### Manual gate still required

This checkpoint must still be validated manually for Segment, Free, mixed 2D/3D, N:M, direction, inactive visualization, 3D thread selection and mobile portrait/landscape. Phase J STEP-0 remains intentionally pending until that interaction gate is accepted.
'''
if "## Refinement checkpoint after Phase H (11.0.8 authoring polish)" not in text:
    text += section
write(DOC, text)

print("Applied 11.0.8 sewing refinement candidate.")
for path in (RESOLVED, GLOBAL, GARMENT_VIEWPORT, OVERLAY, STORE, PANEL, STYLES, RESOLVED_TEST, HISTORY_TEST, DOC):
    print(f"  {path.relative_to(ROOT)}")
