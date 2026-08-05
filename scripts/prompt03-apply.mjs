import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const source = await readFile(path, "utf8");
  const result = transform(source);
  if (result === source) throw new Error(`Nenhuma alteração aplicada em ${path}`);
  await writeFile(path, result);
  console.log(`updated ${path}`);
}

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Trecho não encontrado: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Trecho ambíguo: ${label}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function replaceAllChecked(source, before, after, minimum, label) {
  const count = source.split(before).length - 1;
  if (count < minimum) throw new Error(`Ocorrências insuficientes em ${label}: ${count}`);
  return source.split(before).join(after);
}

await edit("apps/web/src/domain/pattern.ts", (source) => {
  let next = replaceOnce(
    source,
    `  treatment?: SeamTreatment;\n}`,
    `  treatment?: SeamTreatment;\n  active?: boolean;\n}`,
    "Seam.active",
  );
  next = replaceOnce(
    next,
    `      const treatment = s.treatment === undefined\n        ? (type === "standard" ? "standard" : "intentional-mismatch")\n        : readEnum(s.treatment, ["standard", "ease", "gather", "stretch", "intentional-mismatch"] as const, \`O tratamento da costura \${i + 1}\`);\n      if (!seamIds.has(id)) {\n        seams.push({ id, first, second, direction, easeRatio, type, name, treatment });`,
    `      const treatment = s.treatment === undefined\n        ? (type === "standard" ? "standard" : "intentional-mismatch")\n        : readEnum(s.treatment, ["standard", "ease", "gather", "stretch", "intentional-mismatch"] as const, \`O tratamento da costura \${i + 1}\`);\n      const active = s.active === undefined\n        ? true\n        : readBoolean(s.active, \`O estado da costura \${i + 1}\`);\n      if (!seamIds.has(id)) {\n        seams.push({ id, first, second, direction, easeRatio, type, name, treatment, active });`,
    "parse seam active",
  );
  next = replaceOnce(
    next,
    `        seams.push({ id, first, second, direction, easeRatio: 0, type: "standard" });`,
    `        seams.push({ id, first, second, direction, easeRatio: 0, type: "standard", active: true });`,
    "legacy seam active",
  );
  return next;
});

await edit("apps/web/src/domain/assembly.ts", (source) =>
  replaceOnce(
    source,
    `  for (const seam of garment.seams ?? []) {\n    if (rangesAreIdentical(seam.first, seam.second)) {`,
    `  for (const seam of garment.seams ?? []) {\n    if (seam.active === false) continue;\n    if (rangesAreIdentical(seam.first, seam.second)) {`,
    "inactive seam in assembly graph",
  ),
);

for (const path of [
  "apps/web/src/garment3d/StitchConstraintBuilder.ts",
  "apps/web/src/garment3d/GarmentAssembly.ts",
]) {
  await edit(path, (source) =>
    replaceOnce(
      source,
      `  for (const seam of garment.seams ?? []) {`,
      `  for (const seam of garment.seams ?? []) {\n    if (seam.active === false) continue;`,
      `${path} inactive seam`,
    ),
  );
}

await edit("apps/web/src/state/editorStore.ts", (source) => {
  let next = replaceOnce(
    source,
    `import { insertPatternPoint, removePatternPoint } from "../domain/patternEditing";`,
    `import {\n  insertPatternPoint,\n  remapSeamsAfterSegmentSplit,\n  removePatternPoint,\n} from "../domain/patternEditing";`,
    "store pattern editing import",
  );
  next = replaceOnce(
    next,
    `  selectedPointId: string | null;\n  selectedEdgeId: string | null;`,
    `  selectedPointId: string | null;\n  selectedEdgeId: string | null;\n  selectedSeamId: string | null;`,
    "selected seam state",
  );
  next = replaceOnce(
    next,
    `  selectPoint(pointId: string | null): void;\n  selectEdge(edgeId: string | null): void;\n  clearSelection(): void;`,
    `  selectPoint(pointId: string | null): void;\n  selectEdge(edgeId: string | null): void;\n  selectSeam(seamId: string | null): void;\n  clearSelection(): void;`,
    "selected seam action",
  );
  next = replaceOnce(
    next,
    `  removeSeam(seamId: string): void;\n  toggleSeamDirection(seamId: string): void;`,
    `  removeSeam(seamId: string): void;\n  toggleSeamDirection(seamId: string): void;\n  toggleSeamActive(seamId: string): void;`,
    "toggle seam active declaration",
  );
  next = replaceOnce(
    next,
    `  updateSeam(seamId: string, update: { name?: string; direction?: SeamDirection; treatment?: SeamTreatment }): void;`,
    `  updateSeam(seamId: string, update: { name?: string; direction?: SeamDirection; treatment?: SeamTreatment; active?: boolean }): void;`,
    "update seam active declaration",
  );
  next = replaceOnce(
    next,
    `  selectedPointId: null,\n  selectedEdgeId: null,\n  pieceSelectionActive: false,`,
    `  selectedPointId: null,\n  selectedEdgeId: null,\n  selectedSeamId: null,\n  pieceSelectionActive: false,`,
    "initial selected seam",
  );
  next = replaceAllChecked(
    next,
    `      selectedPointId: null,\n      selectedEdgeId: null,\n      pieceSelectionActive:`,
    `      selectedPointId: null,\n      selectedEdgeId: null,\n      selectedSeamId: null,\n      pieceSelectionActive:`,
    2,
    "selection resets",
  );
  next = replaceOnce(
    next,
    `  selectPoint: (selectedPointId) => set({\n    selectedPointId,\n    selectedEdgeId: null,\n    pieceSelectionActive: false,\n  }),\n  selectEdge: (selectedEdgeId) => set({\n    selectedEdgeId,\n    selectedPointId: null,\n    pieceSelectionActive: false,\n  }),\n  clearSelection: () => set({\n    selectedPointId: null,\n    selectedEdgeId: null,\n    pieceSelectionActive: false,\n    selectedPieceIds: [],\n  }),`,
    `  selectPoint: (selectedPointId) => set({\n    selectedPointId,\n    selectedEdgeId: null,\n    selectedSeamId: null,\n    pieceSelectionActive: false,\n  }),\n  selectEdge: (selectedEdgeId) => set({\n    selectedEdgeId,\n    selectedPointId: null,\n    selectedSeamId: null,\n    pieceSelectionActive: false,\n  }),\n  selectSeam: (selectedSeamId) => set({\n    selectedSeamId,\n    selectedPointId: null,\n    selectedEdgeId: null,\n    selectedDartId: null,\n    pieceSelectionActive: false,\n    selectedPieceIds: [],\n  }),\n  clearSelection: () => set({\n    selectedPointId: null,\n    selectedEdgeId: null,\n    selectedSeamId: null,\n    pieceSelectionActive: false,\n    selectedPieceIds: [],\n  }),`,
    "selection action implementations",
  );
  next = replaceOnce(
    next,
    `  insertPoint: (startPointId, t) => {\n    const insertion = insertPatternPoint(get().snapshot.piece, startPointId, t);\n    if (!insertion) return;\n    const before = captureDocument(get);\n    applyGeometrySnapshot(set, get, currentEngine().restorePiece(insertion.piece), {\n      selectedPointId: insertion.pointId,\n    });\n    recordIfStandalone(set, get, "geometry", "Adicionar ponto", before);\n  },`,
    `  insertPoint: (startPointId, t) => {\n    const state = get();\n    const insertion = insertPatternPoint(state.snapshot.piece, startPointId, t);\n    if (!insertion) return;\n    const before = captureDocument(get);\n    const rawSnapshot = currentEngine().restorePiece(insertion.piece);\n    const snapshot = preservePieceMetadata(rawSnapshot, insertion.piece);\n    const garment = replacePiece(\n      {\n        ...state.garment,\n        seams: remapSeamsAfterSegmentSplit(\n          state.garment.seams ?? [],\n          insertion.split,\n        ),\n      },\n      snapshot.piece,\n    );\n    set({\n      garment,\n      snapshot,\n      selectedPointId: insertion.pointId,\n      selectedEdgeId: null,\n      selectedSeamId: null,\n    });\n    recordIfStandalone(set, get, "geometry", "Adicionar ponto", before);\n  },`,
    "canonical store insertion",
  );
  next = replaceOnce(
    next,
    `  removeSeam: (seamId) => changeDocument(set, get, "seam", "Remover costura", (document) => ({\n    ...document,\n    garment: {\n      ...document.garment,\n      seams: (document.garment.seams ?? []).filter((seam) => seam.id !== seamId),\n    },\n  })),`,
    `  removeSeam: (seamId) => changeDocument(set, get, "seam", "Remover costura", (document) => ({\n    ...document,\n    garment: {\n      ...document.garment,\n      seams: (document.garment.seams ?? []).filter((seam) => seam.id !== seamId),\n    },\n  }), { selectedSeamId: null }),`,
    "remove selected seam",
  );
  next = replaceOnce(
    next,
    `  toggleSeamDirection: (seamId) => changeDocument(set, get, "seam", "Inverter costura", (document) => ({\n    ...document,\n    garment: {\n      ...document.garment,\n      seams: (document.garment.seams ?? []).map((seam) =>\n        seam.id === seamId\n          ? { ...seam, direction: seam.direction === "same" ? "opposite" : "same" }\n          : seam,\n      ),\n    },\n  })),`,
    `  toggleSeamDirection: (seamId) => changeDocument(set, get, "seam", "Inverter costura", (document) => ({\n    ...document,\n    garment: {\n      ...document.garment,\n      seams: (document.garment.seams ?? []).map((seam) =>\n        seam.id === seamId\n          ? { ...seam, direction: seam.direction === "same" ? "opposite" : "same" }\n          : seam,\n      ),\n    },\n  }), { selectedSeamId: seamId }),\n  toggleSeamActive: (seamId) => changeDocument(set, get, "seam", "Alterar estado da costura", (document) => ({\n    ...document,\n    garment: {\n      ...document.garment,\n      seams: (document.garment.seams ?? []).map((seam) =>\n        seam.id === seamId ? { ...seam, active: seam.active === false } : seam,\n      ),\n    },\n  }), { selectedSeamId: seamId }),`,
    "toggle seam active implementation",
  );
  next = replaceOnce(
    next,
    `  selectDart: (selectedDartId) => set({ selectedDartId, selectedPointId: null, selectedEdgeId: null, pieceSelectionActive: false }),`,
    `  selectDart: (selectedDartId) => set({ selectedDartId, selectedPointId: null, selectedEdgeId: null, selectedSeamId: null, pieceSelectionActive: false }),`,
    "dart clears seam",
  );
  next = replaceOnce(
    next,
    `    selectedPointId: null,\n    selectedEdgeId: null,\n    seamIssues:`,
    `    selectedPointId: null,\n    selectedEdgeId: null,\n    selectedSeamId: null,\n    seamIssues:`,
    "undo clears seam",
  );
  return next;
});

await edit("apps/web/src/components/Inspector.tsx", (source) => {
  let next = replaceOnce(
    source,
    `import { memo } from "react";\nimport { edgeRangeLength, type PatternSnapshot } from "../domain/pattern";`,
    `import { memo } from "react";\nimport { edgeRangeLength, type PatternSnapshot } from "../domain/pattern";\nimport { BodyMeasurementsForm } from "./BodyMeasurementsForm";`,
    "Inspector measurement import",
  );
  next = replaceOnce(
    next,
    `  const removeSeam = useEditorStore((state) => state.removeSeam);\n  const toggleSeamDirection = useEditorStore((state) => state.toggleSeamDirection);`,
    `  const removeSeam = useEditorStore((state) => state.removeSeam);\n  const toggleSeamDirection = useEditorStore((state) => state.toggleSeamDirection);\n  const toggleSeamActive = useEditorStore((state) => state.toggleSeamActive);\n  const selectedSeamId = useEditorStore((state) => state.selectedSeamId);\n  const selectSeam = useEditorStore((state) => state.selectSeam);\n  const setBodyType = useEditorStore((state) => state.setBodyType);\n  const setBodyMeasurement = useEditorStore((state) => state.setBodyMeasurement);`,
    "Inspector seam and measurement actions",
  );
  next = replaceOnce(
    next,
    `      <section>\n        <div className="section-eyebrow">Ponto selecionado</div>`,
    `      <section className="measurement-panel-section">\n        <details>\n          <summary>Medidas corporais</summary>\n          <BodyMeasurementsForm\n            compact\n            bodyType={garment.bodyType}\n            measurements={garment.measurements}\n            onBodyTypeChange={setBodyType}\n            onMeasurementChange={setBodyMeasurement}\n            onEditStart={() => onEditStart("Alterar medidas")}\n            onEditEnd={onEditEnd}\n            onEditCancel={onEditCancel}\n          />\n        </details>\n      </section>\n\n      <section>\n        <div className="section-eyebrow">Ponto selecionado</div>`,
    "Inspector compact measurements",
  );
  next = replaceOnce(
    next,
    `            return <li key={seam.id}><strong>{firstPiece?.name ?? "Peça ausente"} ↔ {secondPiece?.name ?? "Peça ausente"}</strong><small>{firstLength.toFixed(1)} / {secondLength.toFixed(1)} mm · Δ {Math.abs(firstLength - secondLength).toFixed(1)} mm</small>{issue ? <span>{issue.message}</span> : null}<div><button type="button" onClick={() => toggleSeamDirection(seam.id)}>{seam.direction === "same" ? "Mesmo sentido" : "Sentido oposto"}</button><button type="button" onClick={() => removeSeam(seam.id)}>Remover</button></div></li>;`,
    `            return <li key={seam.id} className={\`\${selectedSeamId === seam.id ? "is-selected " : ""}\${seam.active === false ? "is-inactive" : ""}\`} onClick={() => selectSeam(seam.id)}><strong>{seam.name ?? `${firstPiece?.name ?? "Peça ausente"} ↔ ${secondPiece?.name ?? "Peça ausente"}`}</strong><small>{firstPiece?.name ?? "Peça ausente"} ↔ {secondPiece?.name ?? "Peça ausente"} · {firstLength.toFixed(1)} / {secondLength.toFixed(1)} mm · Δ {Math.abs(firstLength - secondLength).toFixed(1)} mm</small>{issue ? <span>{issue.message}</span> : null}<div><button type="button" onClick={(event) => { event.stopPropagation(); toggleSeamActive(seam.id); }}>{seam.active === false ? "Reativar" : "Desativar"}</button><button type="button" onClick={(event) => { event.stopPropagation(); toggleSeamDirection(seam.id); }}>{seam.direction === "same" ? "Mesmo sentido" : "Sentido oposto"}</button><button type="button" onClick={(event) => { event.stopPropagation(); removeSeam(seam.id); }}>Remover</button></div></li>;`,
    "Inspector seam CRUD",
  );
  return next;
});

await edit("apps/web/src/components/AssemblyPanel.tsx", (source) => {
  let next = replaceOnce(
    source,
    `  const updateSeam = useEditorStore((state) => state.updateSeam);\n  const removeSeam = useEditorStore((state) => state.removeSeam);`,
    `  const updateSeam = useEditorStore((state) => state.updateSeam);\n  const removeSeam = useEditorStore((state) => state.removeSeam);\n  const selectedSeamId = useEditorStore((state) => state.selectedSeamId);\n  const selectSeam = useEditorStore((state) => state.selectSeam);\n  const toggleSeamDirection = useEditorStore((state) => state.toggleSeamDirection);\n  const toggleSeamActive = useEditorStore((state) => state.toggleSeamActive);`,
    "AssemblyPanel seam actions",
  );
  next = replaceOnce(
    next,
    `            <div className="assembly-row" key={seam.id}>`,
    `            <div className={\`assembly-row seam-editor-row\${selectedSeamId === seam.id ? " is-selected" : ""}\${seam.active === false ? " is-inactive" : ""}\`} key={seam.id} onClick={() => selectSeam(seam.id)}>`,
    "AssemblyPanel selected row",
  );
  next = replaceOnce(
    next,
    `              <button type="button" onClick={() => removeSeam(seam.id)}>\n                Excluir\n              </button>`,
    `              <button type="button" onClick={(event) => { event.stopPropagation(); toggleSeamActive(seam.id); }}>\n                {seam.active === false ? "Reativar" : "Desativar"}\n              </button>\n              <button type="button" onClick={(event) => { event.stopPropagation(); toggleSeamDirection(seam.id); }}>\n                Inverter\n              </button>\n              <button type="button" onClick={(event) => { event.stopPropagation(); removeSeam(seam.id); }}>\n                Excluir\n              </button>`,
    "AssemblyPanel seam buttons",
  );
  next = next.replace(
    `onChange={(event) =>\n                  updateSeam(seam.id, { name: event.currentTarget.value })\n                }`,
    `onClick={(event) => event.stopPropagation()}\n                onChange={(event) =>\n                  updateSeam(seam.id, { name: event.currentTarget.value })\n                }`,
  );
  return next;
});

await edit("apps/web/src/App.tsx", (source) => {
  let next = replaceOnce(
    source,
    `        } else if (state.selectedPointId || state.selectedEdgeId || state.selectedDartId || state.pieceSelectionActive || state.selectedPieceIds.length > 1) {`,
    `        } else if (state.selectedPointId || state.selectedEdgeId || state.selectedSeamId || state.selectedDartId || state.pieceSelectionActive || state.selectedPieceIds.length > 1) {`,
    "Escape selected seam",
  );
  next = replaceOnce(
    next,
    `      const currentSelectedPointId =\n        useEditorStore.getState().selectedPointId;\n      const currentPieceId = useEditorStore.getState().activePieceId;\n      event.preventDefault();\n      if (currentSelectedPointId) {`,
    `      const currentState = useEditorStore.getState();\n      const currentSelectedPointId = currentState.selectedPointId;\n      const currentPieceId = currentState.activePieceId;\n      event.preventDefault();\n      if (currentState.selectedSeamId) {\n        currentState.removeSeam(currentState.selectedSeamId);\n        return;\n      }\n      if (currentSelectedPointId) {`,
    "Delete selected seam",
  );
  next = replaceOnce(
    next,
    `              selectedPieceIds={selectedPieceIds}\n              onSelect={selectPiece}`,
    `              selectedPieceIds={selectedPieceIds}\n              dismissKey={`${activeTool}:${mobileView}:${workspaceMode}`}\n              onSelect={selectPiece}`,
    "piece popover dismiss key",
  );
  return next;
});

await edit("apps/web/src/editor/PatternCanvas.tsx", (source) => {
  let next = replaceOnce(
    source,
    `import { findNearestPatternSegment } from "../domain/patternEditing";`,
    `import { findNearestPatternSegment } from "../domain/patternEditing";\nimport {\n  createGestureOrigin,\n  finishGesture,\n  shouldInsertPointFromTap,\n  shouldStartBoxSelection,\n  type GestureOrigin,\n} from "./canvasGestures";\nimport { findNearestEdgeHit, findNearestSeamHit } from "./canvasHitTesting";`,
    "PatternCanvas extracted controllers",
  );
  next = replaceOnce(
    next,
    `  const activePointersRef = useRef(new Map<number, PointerPosition>());`,
    `  const activePointersRef = useRef(new Map<number, PointerPosition>());\n  const pointTapRef = useRef<GestureOrigin | null>(null);\n  const touchPieceCandidateRef = useRef<(GestureOrigin & {\n    pieceId: string;\n    startWorldX: number;\n    startWorldY: number;\n    startX: number;\n    startY: number;\n    groupStarts: PieceWorkspaceTransform[];\n  }) | null>(null);`,
    "PatternCanvas gesture refs",
  );
  next = replaceOnce(
    next,
    `  const selectedEdgeId = useEditorStore((s) => s.selectedEdgeId);\n  const selectedDartId = useEditorStore((s) => s.selectedDartId);`,
    `  const selectedEdgeId = useEditorStore((s) => s.selectedEdgeId);\n  const selectedSeamId = useEditorStore((s) => s.selectedSeamId);\n  const selectedDartId = useEditorStore((s) => s.selectedDartId);`,
    "PatternCanvas selected seam",
  );
  next = replaceOnce(
    next,
    `      selectedEdgeId,\n      selectedDartId,`,
    `      selectedEdgeId,\n      selectedSeamId,\n      selectedDartId,`,
    "draw selected seam argument",
  );
  next = replaceOnce(
    next,
    `  }, [activePieceId, cutDraft, dartDraft, draftContour, draftCursor, garment, garmentSeams, hoveredDimension, measureDraft, pieceSelectionActive, rotationFeedback, seamFirstEdge, selectedDartId, selectedEdgeId, selectedPieceIds]);`,
    `  }, [activePieceId, cutDraft, dartDraft, draftContour, draftCursor, garment, garmentSeams, hoveredDimension, measureDraft, pieceSelectionActive, rotationFeedback, seamFirstEdge, selectedDartId, selectedEdgeId, selectedPieceIds, selectedSeamId]);`,
    "draw dependencies",
  );
  next = replaceOnce(
    next,
    `      snapshotRef.current.piece.points,\n      world,`,
    `      snapshotRef.current.piece,\n      world,`,
    "point insertion canonical source",
  );
  const oldFindEdge = `  function findEdgeRangeAt(clientX: number, clientY: number): EdgeRange | null {\n    const world = screenToWorld(clientX, clientY);\n    let nearest: { piece: PatternPiece; target: ReturnType<typeof findNearestPatternSegment> } | null = null;\n    for (const piece of garment.pieces) {\n      if (!getPieceWorkspaceState(garment, piece.id).visible) continue;\n      const local = pieceWorldToLocal(world, getPieceWorkspaceTransform(garment, piece.id));\n      const target = findNearestPatternSegment(piece.points, local);\n      if (!target || target.distanceMm > 18 / cameraRef.current.zoom) continue;\n      if (!nearest || target.distanceMm < nearest.target!.distanceMm) nearest = { piece, target };\n    }\n    if (!nearest?.target) return null;\n    const { piece, target } = nearest;\n    const startIndex = piece.points.findIndex((point) => point.id === target.startPointId);\n    if (startIndex < 0) return null;\n    const end = piece.points[(startIndex + 1) % piece.points.length];\n    const persistentEdge = getPatternEdges(piece).find((edge) => edge.startPointId === target.startPointId && edge.endPointId === end.id);\n    if (!persistentEdge) return null;\n    return {\n      pieceId: piece.id,\n      edgeId: persistentEdge.id,\n      startT: 0,\n      endT: 1,\n    };\n  }`;
  next = replaceOnce(
    next,
    oldFindEdge,
    `  function findEdgeRangeAt(clientX: number, clientY: number): EdgeRange | null {\n    return findNearestEdgeHit(\n      garment,\n      screenToWorld(clientX, clientY),\n      18 / cameraRef.current.zoom,\n    )?.range ?? null;\n  }`,
    "extracted edge hit testing",
  );
  next = replaceOnce(
    next,
    `  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {\n    event.currentTarget.setPointerCapture(event.pointerId);`,
    `  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {\n    event.currentTarget.focus({ preventScroll: true });\n    event.currentTarget.setPointerCapture(event.pointerId);`,
    "focus canvas",
  );
  next = replaceOnce(
    next,
    `      if (toolRef.current === "point") {\n        insertPointNear(event.clientX, event.clientY);\n        dragRef.current = null;\n        return;\n      }`,
    `      if (toolRef.current === "point") {\n        pointTapRef.current = createGestureOrigin(\n          event.pointerId,\n          event.pointerType,\n          event.clientX,\n          event.clientY,\n        );\n        dragRef.current = null;\n        return;\n      }`,
    "defer touch point insertion",
  );
  next = replaceOnce(
    next,
    `      const world = screenToWorld(event.clientX, event.clientY);\n      const piece = findPieceAtWorld(world.xMm, world.yMm);\n      if (piece) {\n        selectPiece(piece.id);\n        onSelectPoint(null);\n        const workspace = getPieceWorkspaceState(garment, piece.id);\n        if (workspace.locked) {\n          dragRef.current = null;\n          return;\n        }\n        onEditStartRef.current("Mover peça");\n        dragRef.current = {\n          type: "piece",\n          pointerId: event.pointerId,\n          pieceId: piece.id,\n          startWorldX: world.xMm,\n          startWorldY: world.yMm,\n          startX: workspace.transform.xMm,\n          startY: workspace.transform.yMm,\n          groupStarts: piecesMovingWith(piece.id).map((id) => ({ ...getPieceWorkspaceTransform(garment, id) })),\n        };\n        return;\n      }`,
    `      const world = screenToWorld(event.clientX, event.clientY);\n      const piece = findPieceAtWorld(world.xMm, world.yMm);\n      if (piece) {\n        selectPiece(piece.id);\n        onSelectPoint(null);\n        const workspace = getPieceWorkspaceState(garment, piece.id);\n        if (workspace.locked) {\n          dragRef.current = null;\n          return;\n        }\n        touchPieceCandidateRef.current = {\n          ...createGestureOrigin(event.pointerId, event.pointerType, event.clientX, event.clientY),\n          pieceId: piece.id,\n          startWorldX: world.xMm,\n          startWorldY: world.yMm,\n          startX: workspace.transform.xMm,\n          startY: workspace.transform.yMm,\n          groupStarts: piecesMovingWith(piece.id).map((id) => ({ ...getPieceWorkspaceTransform(garment, id) })),\n        };\n        dragRef.current = null;\n        return;\n      }`,
    "defer touch piece movement",
  );
  next = replaceOnce(
    next,
    `    if (toolRef.current === "point") {\n      insertPointNear(event.clientX, event.clientY);\n      dragRef.current = null;\n      return;\n    }`,
    `    if (toolRef.current === "point") {\n      pointTapRef.current = createGestureOrigin(\n        event.pointerId,\n        event.pointerType,\n        event.clientX,\n        event.clientY,\n      );\n      dragRef.current = null;\n      return;\n    }`,
    "defer mouse point insertion",
  );
  next = replaceOnce(
    next,
    `    if (toolRef.current === "select") {\n      const dartId = findDartAt(event.clientX, event.clientY);`,
    `    if (toolRef.current === "select") {\n      const seamHit = findNearestSeamHit(\n        garment,\n        screenToWorld(event.clientX, event.clientY),\n        12 / cameraRef.current.zoom,\n      );\n      if (seamHit) {\n        useEditorStore.getState().selectSeam(seamHit.seam.id);\n        dragRef.current = null;\n        scheduleDraw();\n        return;\n      }\n      const dartId = findDartAt(event.clientX, event.clientY);`,
    "select seam on canvas",
  );
  next = replaceOnce(
    next,
    `  function beginPinch() {\n    const canvas = canvasRef.current;`,
    `  function beginPinch() {\n    pointTapRef.current = null;\n    touchPieceCandidateRef.current = null;\n    const canvas = canvasRef.current;`,
    "pinch cancels pending gestures",
  );
  next = replaceOnce(
    next,
    `    const drag = dragRef.current;\n    if (!drag) {`,
    `    const touchCandidate = touchPieceCandidateRef.current;\n    if (\n      !dragRef.current &&\n      touchCandidate?.pointerId === event.pointerId &&\n      !finishGesture(touchCandidate, event.clientX, event.clientY).isClick\n    ) {\n      onEditStartRef.current("Mover peça");\n      dragRef.current = {\n        type: "piece",\n        pointerId: event.pointerId,\n        pieceId: touchCandidate.pieceId,\n        startWorldX: touchCandidate.startWorldX,\n        startWorldY: touchCandidate.startWorldY,\n        startX: touchCandidate.startX,\n        startY: touchCandidate.startY,\n        groupStarts: touchCandidate.groupStarts,\n      };\n      touchPieceCandidateRef.current = null;\n    }\n\n    const drag = dragRef.current;\n    if (!drag) {`,
    "promote touch piece drag",
  );
  next = replaceOnce(
    next,
    `  function finishPointer(event: PointerEvent<HTMLCanvasElement>) {\n    const finishedDrag = dragRef.current;\n    const intentPointer = intentPointerRef.current;`,
    `  function finishPointer(event: PointerEvent<HTMLCanvasElement>) {\n    const finishedDrag = dragRef.current;\n    const pointerCountBeforeRelease = Math.max(1, activePointersRef.current.size);\n    const pendingPointTap = pointTapRef.current;\n    if (pendingPointTap?.pointerId === event.pointerId) {\n      const finish = finishGesture(\n        pendingPointTap,\n        event.clientX,\n        event.clientY,\n      );\n      pointTapRef.current = null;\n      if (\n        shouldInsertPointFromTap(\n          pendingPointTap,\n          finish,\n          pointerCountBeforeRelease,\n        )\n      ) {\n        insertPointNear(event.clientX, event.clientY);\n      }\n    }\n    if (touchPieceCandidateRef.current?.pointerId === event.pointerId) {\n      touchPieceCandidateRef.current = null;\n    }\n    const intentPointer = intentPointerRef.current;`,
    "finish deferred gestures",
  );
  next = replaceOnce(
    next,
    `      if (moved < 4) {`,
    `      if (!shouldStartBoxSelection(moved)) {`,
    "box threshold",
  );
  next = replaceOnce(
    next,
    `      <canvas\n        ref={canvasRef}`, 
    `      <canvas\n        ref={canvasRef}\n        tabIndex={0}`,
    "focusable canvas",
  );
  next = replaceOnce(
    next,
    `      {readyIntent && intentPosition ? (`,
    `      {selectedSeamId ? (\n        <div className="canvas-seam-label" role="status">\n          {garmentSeams.find((seam) => seam.id === selectedSeamId)?.name ?? "Costura selecionada"}\n        </div>\n      ) : null}\n      {readyIntent && intentPosition ? (`,
    "selected seam name",
  );
  next = replaceOnce(
    next,
    `  selectedEdgeId: string | null,\n  selectedDartId: string | null,`,
    `  selectedEdgeId: string | null,\n  selectedSeamId: string | null,\n  selectedDartId: string | null,`,
    "draw selected seam signature",
  );
  next = replaceOnce(
    next,
    `    for (const seam of seams) {\n      drawSeamInterval(context, piece, seam.first, transform, camera.zoom, "#a23d3d");\n      drawSeamInterval(context, piece, seam.second, transform, camera.zoom, "#3d6aa2");\n    }`,
    `    for (const seam of seams) {\n      const selected = seam.id === selectedSeamId;\n      const inactive = seam.active === false;\n      if (inactive) context.setLineDash([5 / camera.zoom, 5 / camera.zoom]);\n      drawSeamInterval(context, piece, seam.first, transform, camera.zoom, selected ? "#ff7a00" : inactive ? "#9b7d7d" : "#a23d3d", selected ? 5 : 3);\n      drawSeamInterval(context, piece, seam.second, transform, camera.zoom, selected ? "#ffb000" : inactive ? "#7d899b" : "#3d6aa2", selected ? 5 : 3);\n      if (inactive) context.setLineDash([]);\n    }`,
    "draw selected inactive seams",
  );
  next = replaceOnce(
    next,
    `function drawSeamInterval(\n  context: CanvasRenderingContext2D,\n  piece: PatternPiece,\n  range: EdgeRange,\n  transform: PieceWorkspaceTransform,\n  zoom: number,\n  color: string,\n) {`,
    `function drawSeamInterval(\n  context: CanvasRenderingContext2D,\n  piece: PatternPiece,\n  range: EdgeRange,\n  transform: PieceWorkspaceTransform,\n  zoom: number,\n  color: string,\n  widthPx = 3,\n) {`,
    "seam draw width",
  );
  next = replaceOnce(
    next,
    `  context.lineWidth = 3 / zoom;`,
    `  context.lineWidth = widthPx / zoom;`,
    "seam line width",
  );
  return next;
});

await edit("apps/web/src/styles.css", (source) => `${source}\n\n/* Prompt 03: editor interaction reliability */\n.pieces-more { border: 0; background: transparent; min-width: 32px; min-height: 32px; font-size: 1.2rem; cursor: pointer; }\n.pieces-popover { z-index: 80; width: min(210px, calc(100vw - 16px)); display: grid; padding: 6px; border: 1px solid #c9c5ba; border-radius: 10px; background: #fffdf8; box-shadow: 0 14px 34px rgba(27, 29, 31, 0.2); }\n.pieces-popover button { width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; }\n.pieces-popover button:hover, .pieces-popover button:focus-visible { background: #ece8df; outline: 2px solid #87621b; outline-offset: -2px; }\n.seam-list li.is-selected, .seam-editor-row.is-selected { outline: 2px solid #cf7a00; outline-offset: 2px; background: #fff5df; }\n.seam-list li.is-inactive, .seam-editor-row.is-inactive { opacity: 0.62; }\n.canvas-seam-label { position: absolute; z-index: 5; top: 58px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 32px); padding: 6px 12px; border-radius: 999px; background: rgba(32, 33, 36, 0.9); color: white; font-size: 0.82rem; pointer-events: none; }\n.measurement-panel-section > details > summary, .measurement-groups summary { cursor: pointer; font-weight: 700; }\n.measurement-groups { display: grid; gap: 6px; }\n.measurement-groups details { border: 1px solid #d8d4c9; border-radius: 8px; padding: 6px 8px; }\n.body-form.is-compact .body-measurement-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }\n.body-form.is-compact .body-measurement-grid label { gap: 2px; font-size: 0.78rem; }\n.body-form.is-compact input { min-width: 0; width: 100%; }\n.inspector { resize: horizontal; overflow: auto; min-width: 260px; max-width: 440px; }\n.pattern-canvas:focus-visible { outline: 3px solid #9a6b16; outline-offset: -3px; }\n@media (max-width: 760px) {\n  .inspector.workspace-view.is-mobile-active { position: fixed; z-index: 45; left: 0; right: 0; bottom: 0; top: auto; width: 100%; min-width: 0; max-width: none; max-height: min(68vh, 620px); border-radius: 18px 18px 0 0; box-shadow: 0 -18px 40px rgba(30, 32, 34, 0.22); resize: none; overflow: auto; }\n  .body-form.is-compact .body-measurement-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .measurement-input input { font-size: 16px; }\n  .editor-body, .canvas-stack { min-width: 0; }\n  .canvas-stack { min-height: 48vh; }\n}\n`);

console.log("Prompt 03 integration patch completed");
