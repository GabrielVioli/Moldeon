import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-editor-core-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

async function installFixture() {
  await page.evaluate(async () => {
    const [{ useEditorStore }, { getPatternEdges }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = {
      id: "recovery-live-piece", name: "Regressão 9.5-04", seamAllowanceMm: 0,
      points: [
        { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 34, yMm: -28 } },
        { id: "b", xMm: 180, yMm: 0, handleIn: { xMm: -34, yMm: -28 } },
        { id: "c", xMm: 180, yMm: 140 }, { id: "d", xMm: 0, yMm: 140 },
      ],
    };
    const edges = getPatternEdges(piece);
    state.loadGarment({
      ...structuredClone(state.garment), id: "recovery-live-garment", name: "Regressão 9.5-04",
      pieces: [piece],
      seams: [{
        id: "recovery-live-seam", name: "Costura de regressão",
        first: { pieceId: piece.id, edgeId: edges[0].id, startT: 0, endT: 1 },
        second: { pieceId: piece.id, edgeId: edges[2].id, startT: 0, endT: 1 },
        direction: "same", easeRatio: 0, type: "standard", treatment: "standard", active: true,
      }],
      workspaceTransforms: [],
      workspaceStates: [{ pieceId: piece.id, transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 }, visible: true, locked: false }],
      assemblyPlacements: [], parametric: undefined,
    });
  });
  await page.locator(".pieces-item").filter({ hasText: "Regressão 9.5-04" }).waitFor();
}

async function geometry() {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces.map((piece) => ({
      id: piece.id,
      points: piece.points.map((point) => ({
        id: point.id, xMm: point.xMm, yMm: point.yMm,
        handleIn: point.handleIn ? { ...point.handleIn } : null,
        handleOut: point.handleOut ? { ...point.handleOut } : null,
      })),
    }));
  });
}

async function fitAll() {
  await page.getByRole("button", { name: "Enquadrar tudo" }).click();
  await page.waitForTimeout(60);
}

async function screenPosition(target) {
  return page.evaluate(async (requested) => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const garment = state.garment; const piece = garment.pieces[0];
    const transform = garment.workspaceStates?.[0]?.transform ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points).map((point) => coordinateModule.pieceLocalToWorld(point, transform));
    const bounds = {
      minX: Math.min(...contour.map((p) => p.xMm)), minY: Math.min(...contour.map((p) => p.yMm)),
      maxX: Math.max(...contour.map((p) => p.xMm)), maxY: Math.max(...contour.map((p) => p.yMm)),
    };
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    let local;
    if (requested.kind === "point") {
      const point = piece.points.find((candidate) => candidate.id === requested.id);
      if (!point) throw new Error(`Ponto ${requested.id} ausente.`);
      local = { xMm: point.xMm, yMm: point.yMm };
    } else if (requested.kind === "segment") {
      const start = piece.points.find((candidate) => candidate.id === requested.start);
      const end = piece.points.find((candidate) => candidate.id === requested.end);
      if (!start || !end) throw new Error("Segmento ausente.");
      local = { xMm: (start.xMm + end.xMm) / 2, yMm: (start.yMm + end.yMm) / 2 };
    } else local = { xMm: (bounds.minX + bounds.maxX) / 2, yMm: (bounds.minY + bounds.maxY) / 2 };
    return coordinateModule.worldToScreen(coordinateModule.pieceLocalToWorld(local, transform), camera);
  }, target);
}

async function realEmptyPosition() {
  return page.evaluate(async () => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState(); const piece = state.garment.pieces[0];
    const transform = state.garment.workspaceStates?.[0]?.transform ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points).map((point) => coordinateModule.pieceLocalToWorld(point, transform));
    const bounds = { minX: Math.min(...contour.map((p) => p.xMm)), minY: Math.min(...contour.map((p) => p.yMm)), maxX: Math.max(...contour.map((p) => p.xMm)), maxY: Math.max(...contour.map((p) => p.yMm)) };
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    const screenContour = contour.map((point) => coordinateModule.worldToScreen(point, camera));
    const box = { left: Math.min(...screenContour.map((p) => p.x)) - 22, right: Math.max(...screenContour.map((p) => p.x)) + 22, top: Math.min(...screenContour.map((p) => p.y)) - 22, bottom: Math.max(...screenContour.map((p) => p.y)) + 22 };
    const candidates = [{ x: 42, y: rect.height * .78 }, { x: 42, y: rect.height * .5 }, { x: rect.width - 42, y: rect.height * .5 }, { x: rect.width * .5, y: rect.height - 42 }];
    for (const c of candidates) {
      const top = document.elementFromPoint(rect.left + c.x, rect.top + c.y);
      const outside = c.x < box.left || c.x > box.right || c.y < box.top || c.y > box.bottom;
      if (top === canvas && outside) return c;
    }
    throw new Error("Nenhum ponto vazio real e descoberto foi encontrado no Canvas.");
  });
}

async function assertNoSelection(label) {
  const state = await page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/state/internalPathEditorStore.ts"),
    ]);
    const e = useEditorStore.getState(); const i = useInternalPathEditorStore.getState();
    return { selectedPointId: e.selectedPointId, selectedEdgeId: e.selectedEdgeId, selectedSeamId: e.selectedSeamId, selectedDartId: e.selectedDartId, selectedPieceIds: e.selectedPieceIds, pieceSelectionActive: e.pieceSelectionActive, seamFirstEdge: e.seamFirstEdge, seamProposal: e.seamProposal, nearbySeamSuggestion: e.nearbySeamSuggestion, selectedPathId: i.selectedPathId, selectedNodeId: i.selectedNodeId, selectedSegmentId: i.selectedSegmentId };
  });
  if (Object.values(state).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))) throw new Error(`${label}: seleção persistiu: ${JSON.stringify(state)}`);
}

async function clickPoint(canvas, id) {
  await fitAll();
  await canvas.click({ position: await screenPosition({ kind: "point", id }) });
  await page.getByRole("region", { name: "Edição numérica do editor 2D" }).waitFor({ state: "visible" });
}

async function navigateCamera(canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  const hand = page.getByRole("button", { name: "Mão", exact: true });
  await hand.click();
  const box = await canvas.boundingBox(); if (!box) throw new Error("Canvas sem bounding box.");
  const x = box.x + box.width * .48; const y = box.y + box.height * .74;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 62, y - 31, { steps: 8 }); await page.mouse.up();
  await hand.click(); await page.waitForTimeout(60);
}

async function assertGeometry(expected, label) {
  const actual = await geometry();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: zoom/pan alterou a geometria autoritativa.`);
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture();
  const canvas = page.locator("canvas.pattern-canvas"); await fitAll();

  await page.evaluate(async () => { const { useEditorStore } = await import("/src/state/editorStore.ts"); useEditorStore.getState().selectPiece("recovery-live-piece"); });
  const selected = await page.evaluate(async () => { const { useEditorStore } = await import("/src/state/editorStore.ts"); return useEditorStore.getState().pieceSelectionActive; });
  if (!selected) throw new Error("Fixture não conseguiu selecionar a peça antes do teste de fundo.");
  await canvas.click({ position: await realEmptyPosition() }); await page.waitForTimeout(60); await assertNoSelection("clique vazio");

  await clickPoint(canvas, "a"); await page.keyboard.press("Escape"); await page.waitForTimeout(40); await assertNoSelection("Escape em ponto");

  await clickPoint(canvas, "a");
  const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  await numeric.getByRole("button", { name: "Handle saída" }).click(); await numeric.getByLabel("Handle X").waitFor({ state: "visible" });
  await page.keyboard.press("Escape"); await page.waitForTimeout(40); await assertNoSelection("Escape em handle");

  await clickPoint(canvas, "a");
  if (!(await numeric.getByLabel("X").isVisible())) throw new Error("Ponto de borda costurada não foi selecionado.");

  const xField = numeric.getByLabel("X"); const yField = numeric.getByLabel("Y");
  await xField.fill("14"); await xField.press("Enter"); await yField.fill("9"); await yField.press("Enter"); await page.waitForTimeout(50);
  const pointEdited = await geometry(); await navigateCamera(canvas); await assertGeometry(pointEdited, "X/Y do ponto");

  await fitAll(); await clickPoint(canvas, "a"); await numeric.getByRole("button", { name: "Handle saída" }).click();
  for (const [label, value] of [["Handle X", "42"], ["Handle Y", "-17"], ["Comprimento", "58"], ["Ângulo", "-22"]]) {
    const field = numeric.getByLabel(label); await field.fill(value); await field.press("Enter");
  }
  await page.waitForTimeout(50); const handleEdited = await geometry(); await navigateCamera(canvas); await assertGeometry(handleEdited, "handle numérico");

  await page.keyboard.press("Control+z"); await page.waitForTimeout(50); const undoHandle = await geometry();
  if (JSON.stringify(undoHandle) === JSON.stringify(handleEdited)) throw new Error("Undo do handle não alterou a geometria.");
  await navigateCamera(canvas); await assertGeometry(undoHandle, "undo do handle");
  await page.keyboard.press("Control+y"); await page.waitForTimeout(50); const redoHandle = await geometry();
  if (JSON.stringify(redoHandle) !== JSON.stringify(handleEdited)) throw new Error("Redo do handle não reaplicou a geometria.");
  await navigateCamera(canvas); await assertGeometry(redoHandle, "redo do handle");

  await fitAll(); const beforeLength = await geometry();
  await canvas.dblclick({ position: await screenPosition({ kind: "segment", start: "b", end: "c" }), delay: 50 });
  const lengthField = page.getByLabel("Comprimento do segmento em milímetros"); await lengthField.waitFor({ state: "visible" });
  const oldLength = Number(await lengthField.inputValue()); await lengthField.fill((oldLength * 1.2).toFixed(2)); await lengthField.press("Enter"); await page.waitForTimeout(50);
  const lengthEdited = await geometry(); if (JSON.stringify(lengthEdited) === JSON.stringify(beforeLength)) throw new Error("Edição de comprimento não alterou a geometria.");
  await navigateCamera(canvas); await assertGeometry(lengthEdited, "comprimento editado");
  await page.keyboard.press("Control+z"); await page.waitForTimeout(50); const undoLength = await geometry();
  if (JSON.stringify(undoLength) !== JSON.stringify(beforeLength)) throw new Error("Undo do comprimento não restaurou o estado anterior.");
  await navigateCamera(canvas); await assertGeometry(undoLength, "undo do comprimento");
  await page.keyboard.press("Control+y"); await page.waitForTimeout(50); const redoLength = await geometry();
  if (JSON.stringify(redoLength) !== JSON.stringify(lengthEdited)) throw new Error("Redo do comprimento não restaurou o estado editado.");
  await navigateCamera(canvas); await assertGeometry(redoLength, "redo do comprimento");

  await page.screenshot({ path: `${artifactDir}/editor-core-live-regression.png`, fullPage: true });
  if (errors.length) throw new Error(errors.join(" | "));
  console.log(JSON.stringify({ emptyClickClearsSelection: true, escapeClearsPoint: true, escapeClearsHandle: true, sewnEdgePointSelectable: true, pointXYSurvivesZoomPan: true, handleXYLengthAngleSurviveZoomPan: true, lengthEditSurvivesZoomPan: true, undoSurvivesZoomPan: true, redoSurvivesZoomPan: true }, null, 2));
} finally { await context.close(); await browser.close(); }
