import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const source = await readFile(path, "utf8");
  const result = transform(source);
  if (result === source) throw new Error(`Nenhuma alteração aplicada em ${path}`);
  await writeFile(path, result);
  console.log(`updated ${path}`);
}

function replaceRequired(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: esperado 1 trecho, encontrado ${count}`);
  return source.replace(before, after);
}

await edit("apps/web/src/domain/patternDocumentV3.ts", (source) => {
  let next = replaceRequired(
    source,
    `  const seams = document.seamGroups\n    .filter((group) => group.active)\n    .map((group) => ({`,
    `  const seams = document.seamGroups\n    .map((group) => ({`,
    "project all seam groups",
  );
  next = replaceRequired(
    next,
    `      treatment: legacyTreatment(group),\n    }));`,
    `      treatment: legacyTreatment(group),\n      active: group.active,\n    }));`,
    "project seam active state",
  );
  next = replaceRequired(
    next,
    `    active: true,\n    compatibility: {\n      legacyEaseRatio: seam.easeRatio,`,
    `    active: seam.active !== false,\n    compatibility: {\n      legacyEaseRatio: seam.easeRatio,`,
    "migrate seam active state",
  );
  next = replaceRequired(
    next,
    `  for (const group of document.seamGroups) {\n    if (!group.active) {\n      throw new PatternDocumentCompatibilityError(\n        \`A costura \${group.id} está desativada e o runtime legado não preserva esse estado.\`,\n        group.id,\n      );\n    }\n    if (group.first.length !== 1 || group.second.length !== 1) {`,
    `  for (const group of document.seamGroups) {\n    if (group.first.length !== 1 || group.second.length !== 1) {`,
    "allow inactive seam projection",
  );
  return next;
});

await edit("apps/web/src/state/editorStore.ts", (source) => {
  let next = replaceRequired(
    source,
    `set({ selectedPieceIds, activePieceId: activePiece.id, snapshot: restoreSnapshot(activePiece), pieceSelectionActive: selectedPieceIds.length > 0, selectedPointId: null, selectedEdgeId: null });`,
    `set({ selectedPieceIds, activePieceId: activePiece.id, snapshot: restoreSnapshot(activePiece), pieceSelectionActive: selectedPieceIds.length > 0, selectedPointId: null, selectedEdgeId: null, selectedSeamId: null });`,
    "toggle piece clears seam",
  );
  next = replaceRequired(
    next,
    `set({ selectedPieceIds, pieceSelectionActive: selectedPieceIds.length > 0, ...(piece ? { activePieceId, snapshot: restoreSnapshot(piece) } : {}), selectedPointId: null, selectedEdgeId: null });`,
    `set({ selectedPieceIds, pieceSelectionActive: selectedPieceIds.length > 0, ...(piece ? { activePieceId, snapshot: restoreSnapshot(piece) } : {}), selectedPointId: null, selectedEdgeId: null, selectedSeamId: null });`,
    "box selection clears seam",
  );
  next = replaceRequired(
    next,
    `  selectAllPieces: () => set((state) => ({ selectedPieceIds: state.garment.pieces.filter((piece) => workspaceStateFor(state.garment, piece.id).visible).map((piece) => piece.id), pieceSelectionActive: true })),`,
    `  selectAllPieces: () => set((state) => ({ selectedPieceIds: state.garment.pieces.filter((piece) => workspaceStateFor(state.garment, piece.id).visible).map((piece) => piece.id), pieceSelectionActive: true, selectedPointId: null, selectedEdgeId: null, selectedSeamId: null })),`,
    "select all clears seam",
  );
  return next;
});

await edit("apps/web/src/dev/phase0AuditBridge.ts", (source) => {
  let next = replaceRequired(
    source,
    `  selectedEdgeId: string | null;\n  seamCount: number;`,
    `  selectedEdgeId: string | null;\n  selectedSeamId: string | null;\n  seamCount: number;\n  seams: Array<{ id: string; name: string; direction: string; active: boolean }>;`,
    "audit seam state interface",
  );
  next = replaceRequired(
    next,
    `      selectedEdgeId: current.selectedEdgeId,\n      seamCount: current.garment.seams?.length ?? 0,`,
    `      selectedEdgeId: current.selectedEdgeId,\n      selectedSeamId: current.selectedSeamId,\n      seamCount: current.garment.seams?.length ?? 0,\n      seams: (current.garment.seams ?? []).map((seam) => ({\n        id: seam.id,\n        name: seam.name ?? seam.id,\n        direction: seam.direction,\n        active: seam.active !== false,\n      })),`,
    "audit seam state",
  );
  return next;
});

await edit("apps/web/src/domain/patternDocumentV3.test.ts", (source) =>
  replaceRequired(
    source,
    `  it("keeps the projected PatternPiece accepted by the fallback engine", () => {`,
    `  it("round trips inactive seams without discarding their state", () => {\n    const garment = createBaselineFixture("equal-length-seam");\n    garment.seams = garment.seams?.map((seam) => ({ ...seam, active: false }));\n    const document = garmentDraftToPatternDocumentV3(garment);\n\n    expect(document.seamGroups[0].active).toBe(false);\n    const restored = patternDocumentV3ToGarmentDraft(document);\n    expect(restored.seams?.[0].active).toBe(false);\n  });\n\n  it("keeps the projected PatternPiece accepted by the fallback engine", () => {`,
    "inactive seam round trip test",
  ),
);

console.log("Prompt 03 compatibility polish completed");
