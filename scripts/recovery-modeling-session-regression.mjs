import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4173";
const executablePath = process.env.CHROME_PATH
  ?? (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "/usr/bin/google-chrome");

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 820 }, locale: "pt-BR" });
const page = await context.newPage();
const report = { errors: [], consoleErrors: [] };
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") report.consoleErrors.push(message.text());
});

try {
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 60_000 });
  await chooseBlankWorkspace(page);
  await chooseTemplate(page, "Saia reta");
  await page.locator(".pieces-item").filter({ hasText: "Frente" }).waitFor();
  await page.locator(".pieces-item").filter({ hasText: "Costas" }).waitFor();

  report.measurement = await editWaistMeasurement(page);
  report.seam = await exerciseSeam(page);

  await selectOnly(page, "Frente");
  await page.getByRole("button", { name: "Enquadrar seleção", exact: true }).click();
  report.curveDimension = await editSegmentDimension(page, true);
  await page.getByRole("button", { name: "Enquadrar seleção", exact: true }).click();
  report.straightDimension = await editSegmentDimension(page, false);
  report.pointDrag = await dragContourPoint(page);
  report.duplicateMirror = await exerciseDuplicateAndMirror(page);
  report.pleat = await exercisePleat(page);
  report.dart = await exerciseDart(page);

  await page.getByRole("checkbox", { name: "Selecionar Frente" }).check();
  await page.getByRole("checkbox", { name: "Selecionar Costas" }).check();
  report.selectionBeforeCut = await editorState(page);
  await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
  const stroke = await crossPieceStroke(page);

  await page.getByRole("button", { name: "Recortar", exact: true }).click();
  report.selectionAfterTool = await editorState(page);

  await page.mouse.click(stroke.start.x, stroke.start.y);
  await page.mouse.click(stroke.middle.x, stroke.middle.y);
  await page.mouse.click(stroke.end.x, stroke.end.y);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(120);

  report.cutBeforeApply = await cutState(page);
  const apply = page.getByRole("button", { name: /Aplicar corte/ });
  report.applyButton = {
    count: await apply.count(),
    enabled: await apply.count() ? await apply.isEnabled() : false,
    label: await apply.count() ? await apply.textContent() : null,
  };

  if (report.applyButton.enabled) {
    await apply.click();
    await page.waitForTimeout(100);
    report.afterApply = await editorState(page);
    await page.getByRole("button", { name: "Desfazer" }).click();
    report.afterUndo = await editorState(page);
    await page.getByRole("button", { name: "Refazer" }).click();
    report.afterRedo = await editorState(page);
    report.editAfterCut = await dragContourPoint(page);
  }

  report.touch = await exerciseTouchCut(browser);
} finally {
  await browser.close();
}

const passed = report.errors.length === 0
  && report.consoleErrors.length === 0
  && report.selectionBeforeCut.selectedPieceIds.length === 2
  && report.selectionAfterTool.selectedPieceIds.length === 2
  && report.applyButton.enabled
  && report.applyButton.label === "Aplicar corte em 2 peças"
  && report.measurement.changed
  && report.seam.toggled
  && report.curveDimension.changed
  && report.curveDimension.undoRedo
  && report.straightDimension.changed
  && report.straightDimension.undoRedo
  && report.pointDrag.changed
  && report.pointDrag.undoRedo
  && report.duplicateMirror.duplicateUndoRedo
  && report.duplicateMirror.mirrorUndo
  && report.pleat.created
  && report.pleat.undoRedo
  && report.dart.created
  && report.dart.undoRedo
  && report.afterApply?.pieceCount === 4
  && report.afterUndo?.pieceCount === 2
  && report.afterRedo?.pieceCount === 4
  && report.editAfterCut.changed
  && report.touch.passed;

console.log(JSON.stringify({ passed, ...report }, null, 2));
if (!passed) process.exitCode = 1;

async function chooseBlankWorkspace(currentPage) {
  await currentPage.getByRole("button", { name: "Moldes", exact: true }).click();
  await currentPage.getByRole("button", { name: /Bancada vazia/i }).click();
  await currentPage.getByRole("button", { name: "Criar bancada vazia", exact: true }).click();
  await currentPage.getByText("A bancada está vazia", { exact: true }).waitFor();
}

async function chooseTemplate(currentPage, name) {
  await currentPage.getByRole("button", { name: "Moldes", exact: true }).click();
  await currentPage.getByRole("button", { name: new RegExp(name, "i") }).first().click();
  await currentPage.getByRole("button", { name: "Criar molde", exact: true }).click();
  await currentPage.getByRole("dialog").waitFor({ state: "detached", timeout: 15_000 });
}

async function selectOnly(currentPage, name) {
  for (const candidate of ["Frente", "Costas"]) {
    const checkbox = currentPage.getByRole("checkbox", { name: `Selecionar ${candidate}` });
    if (candidate === name) await checkbox.check();
    else await checkbox.uncheck();
  }
  await currentPage.locator(".pieces-item").filter({ hasText: name }).locator(".pieces-name").click();
}

async function editWaistMeasurement(currentPage) {
  const details = currentPage.locator(".measurement-panel-section details");
  await details.locator("summary").first().click();
  const input = currentPage.getByRole("spinbutton", { name: "Cintura em cm", exact: true });
  const before = Number(await input.inputValue());
  const desired = before + 1;
  await input.fill(String(desired));
  await input.press("Enter");
  await currentPage.waitForTimeout(120);
  const after = await currentPage.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.measurements.waistMm;
  });
  return { before, afterMm: after, changed: Math.abs(after - desired * 10) < 0.1 };
}

async function exerciseSeam(currentPage) {
  const button = currentPage.getByRole("button", { name: /Mesmo sentido|Sentido oposto/ }).first();
  if (!await button.count()) return { toggled: false, reason: "A saia não expôs uma costura." };
  const before = await seamDirection(currentPage);
  await button.click();
  const after = await seamDirection(currentPage);
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  const undo = await seamDirection(currentPage);
  await currentPage.getByRole("button", { name: "Refazer" }).click();
  const redo = await seamDirection(currentPage);
  return { before, after, undo, redo, toggled: before !== after && undo === before && redo === after };
}

async function seamDirection(currentPage) {
  return currentPage.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.seams?.[0]?.direction ?? null;
  });
}

async function editSegmentDimension(currentPage, curved) {
  const target = await segmentTarget(currentPage, curved);
  await currentPage.mouse.dblclick(target.x, target.y);
  const input = currentPage.getByLabel("Comprimento do segmento em milímetros");
  await input.waitFor({ state: "visible" });
  const desired = Number((target.length * 1.08).toFixed(1));
  await input.fill(String(desired));
  await input.press("Enter");
  await currentPage.waitForTimeout(100);
  const after = await segmentLength(currentPage, target);
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  const undo = await segmentLength(currentPage, target);
  await currentPage.getByRole("button", { name: "Refazer" }).click();
  const redo = await segmentLength(currentPage, target);
  return {
    before: target.length,
    desired,
    after,
    changed: Math.abs(after - desired) < 0.25,
    undoRedo: Math.abs(undo - target.length) < 0.25 && Math.abs(redo - after) < 0.25,
  };
}

async function segmentTarget(currentPage, curved) {
  return currentPage.evaluate(async (wantCurve) => {
    const [storeModule, polygon, cameraModule, coordinates] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!piece || !(canvas instanceof HTMLCanvasElement)) throw new Error("Peça ativa ou Canvas ausente.");
    const points = piece.points;
    const index = points.findIndex((start, candidateIndex) => {
      const end = points[(candidateIndex + 1) % points.length];
      return Boolean(start.handleOut || end.handleIn) === wantCurve;
    });
    if (index < 0) throw new Error(`Nenhum segmento ${wantCurve ? "curvo" : "reto"} encontrado.`);
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const transform = state.garment.workspaceStates?.find((item) => item.pieceId === piece.id)?.transform
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const contour = polygon.samplePatternContour(points).map((point) => coordinates.pieceLocalToWorld(point, transform));
    const bounds = {
      minX: Math.min(...contour.map((point) => point.xMm)), minY: Math.min(...contour.map((point) => point.yMm)),
      maxX: Math.max(...contour.map((point) => point.xMm)), maxY: Math.max(...contour.map((point) => point.yMm)),
    };
    const rect = canvas.getBoundingClientRect();
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 70);
    const midpoint = coordinates.pieceLocalToWorld({ xMm: (start.xMm + end.xMm) / 2, yMm: (start.yMm + end.yMm) / 2 }, transform);
    const screen = coordinates.worldToScreen(midpoint, camera);
    const sampled = polygon.samplePatternSegment(start, end);
    const length = sampled.slice(1).reduce((sum, point, sampleIndex) => sum + Math.hypot(point.xMm - sampled[sampleIndex].xMm, point.yMm - sampled[sampleIndex].yMm), 0);
    return { pieceId: piece.id, startId: start.id, endId: end.id, length, x: rect.left + screen.x, y: rect.top + screen.y };
  }, curved);
}

async function segmentLength(currentPage, target) {
  return currentPage.evaluate(async ({ pieceId, startId, endId }) => {
    const [storeModule, polygon] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts")]);
    const piece = storeModule.useEditorStore.getState().garment.pieces.find((candidate) => candidate.id === pieceId);
    const points = piece?.points ?? [];
    const start = points.find((point) => point.id === startId);
    const end = points.find((point) => point.id === endId);
    if (!start || !end) throw new Error("Segmento não foi preservado.");
    const sampled = polygon.samplePatternSegment(start, end);
    return sampled.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.xMm - sampled[index].xMm, point.yMm - sampled[index].yMm), 0);
  }, target);
}

async function dragContourPoint(currentPage) {
  await currentPage.getByRole("button", { name: "Selecionar", exact: true }).click();
  await currentPage.getByRole("button", { name: "Enquadrar seleção", exact: true }).click();
  const target = await pointTarget(currentPage);
  await currentPage.mouse.move(target.x, target.y);
  await currentPage.mouse.down();
  await currentPage.mouse.move(target.x + 18, target.y + 10, { steps: 6 });
  await currentPage.mouse.up();
  await currentPage.waitForTimeout(80);
  const after = await pointCoordinates(currentPage, target);
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  const undo = await pointCoordinates(currentPage, target);
  await currentPage.getByRole("button", { name: "Refazer" }).click();
  const redo = await pointCoordinates(currentPage, target);
  const changed = Math.hypot(after.xMm - target.xMm, after.yMm - target.yMm) > 0.5;
  const undoRedo = Math.hypot(undo.xMm - target.xMm, undo.yMm - target.yMm) < 0.1
    && Math.hypot(redo.xMm - after.xMm, redo.yMm - after.yMm) < 0.1;
  return { changed, undoRedo };
}

async function pointTarget(currentPage) {
  return currentPage.evaluate(async () => {
    const [storeModule, polygon, cameraModule, coordinates] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!piece || !(canvas instanceof HTMLCanvasElement)) throw new Error("Peça ativa ou Canvas ausente.");
    const points = piece.points;
    const point = points[Math.min(1, points.length - 1)];
    const transform = state.garment.workspaceStates?.find((item) => item.pieceId === piece.id)?.transform
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const contour = polygon.samplePatternContour(points).map((item) => coordinates.pieceLocalToWorld(item, transform));
    const bounds = { minX: Math.min(...contour.map((item) => item.xMm)), minY: Math.min(...contour.map((item) => item.yMm)), maxX: Math.max(...contour.map((item) => item.xMm)), maxY: Math.max(...contour.map((item) => item.yMm)) };
    const rect = canvas.getBoundingClientRect();
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 70);
    const screen = coordinates.worldToScreen(coordinates.pieceLocalToWorld(point, transform), camera);
    return { pieceId: piece.id, pointId: point.id, xMm: point.xMm, yMm: point.yMm, x: rect.left + screen.x, y: rect.top + screen.y };
  });
}

async function pointCoordinates(currentPage, target) {
  return currentPage.evaluate(async ({ pieceId, pointId }) => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const piece = useEditorStore.getState().garment.pieces.find((candidate) => candidate.id === pieceId);
    const point = piece?.points.find((candidate) => candidate.id === pointId) ?? null;
    if (!point) throw new Error("Ponto arrastado deixou de existir.");
    return { xMm: point.xMm, yMm: point.yMm };
  }, target);
}

async function exerciseDuplicateAndMirror(currentPage) {
  const before = (await editorState(currentPage)).pieceCount;
  await currentPage.getByRole("button", { name: "Duplicar", exact: true }).click();
  const duplicated = (await editorState(currentPage)).pieceCount;
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  const duplicateUndo = (await editorState(currentPage)).pieceCount;
  await currentPage.getByRole("button", { name: "Refazer" }).click();
  const duplicateRedo = (await editorState(currentPage)).pieceCount;
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  await selectOnly(currentPage, "Frente");
  await currentPage.getByText("Espelhar e organizar", { exact: true }).click();
  await currentPage.getByRole("button", { name: "Espelhar no eixo vertical", exact: true }).click();
  const mirrored = (await editorState(currentPage)).pieceCount;
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  const mirrorUndo = (await editorState(currentPage)).pieceCount;
  await selectOnly(currentPage, "Frente");
  return {
    duplicateUndoRedo: duplicated === before + 1 && duplicateUndo === before && duplicateRedo === before + 1,
    mirrorUndo: mirrored === before + 1 && mirrorUndo === before,
  };
}

async function exercisePleat(currentPage) {
  await currentPage.getByText("Criar prega", { exact: true }).click();
  await currentPage.getByLabel("Profundidade da prega").fill("24");
  await currentPage.getByRole("button", { name: "Criar prega simples" }).click();
  const created = await pleatPathCount(currentPage);
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  const undo = await pleatPathCount(currentPage);
  await currentPage.getByRole("button", { name: "Refazer" }).click();
  const redo = await pleatPathCount(currentPage);
  return { created: created === 2, undoRedo: undo === 0 && redo === 2 };
}

async function pleatPathCount(currentPage) {
  return currentPage.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts")]);
    const piece = useEditorStore.getState().garment.pieces.find((candidate) => candidate.id === useEditorStore.getState().activePieceId);
    return (piece?.internalLines ?? []).filter(isInternalPath).filter((path) => path.metadata.pleatId).length;
  });
}

async function exerciseDart(currentPage) {
  const before = await dartCount(currentPage);
  await currentPage.getByRole("button", { name: "Pence", exact: true }).click();
  const points = await dartTargets(currentPage);
  await currentPage.mouse.click(points.start.x, points.start.y);
  await currentPage.mouse.click(points.apex.x, points.apex.y);
  await currentPage.keyboard.press("Enter");
  const apply = currentPage.getByRole("button", { name: "Fechar pence" });
  await apply.waitFor({ state: "visible" });
  await apply.click();
  const after = await dartCount(currentPage);
  await currentPage.getByRole("button", { name: "Desfazer" }).click();
  const undo = await dartCount(currentPage);
  await currentPage.getByRole("button", { name: "Refazer" }).click();
  const redo = await dartCount(currentPage);
  return { created: after === before + 1, undoRedo: undo === before && redo === after };
}

async function dartCount(currentPage) {
  return currentPage.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return state.garment.pieces.find((piece) => piece.id === state.activePieceId)?.darts?.length ?? 0;
  });
}

async function dartTargets(currentPage) {
  return currentPage.evaluate(async () => {
    const [storeModule, polygon, cameraModule, coordinates] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts")]);
    const state = storeModule.useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!piece || !(canvas instanceof HTMLCanvasElement)) throw new Error("Peça ativa ou Canvas ausente.");
    const points = piece.points;
    const transform = state.garment.workspaceStates?.find((item) => item.pieceId === piece.id)?.transform ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const contour = polygon.samplePatternContour(points);
    const bounds = { minX: Math.min(...contour.map((item) => item.xMm)), minY: Math.min(...contour.map((item) => item.yMm)), maxX: Math.max(...contour.map((item) => item.xMm)), maxY: Math.max(...contour.map((item) => item.yMm)) };
    const rect = canvas.getBoundingClientRect();
    const worldContour = contour.map((item) => coordinates.pieceLocalToWorld(item, transform));
    const worldBounds = { minX: Math.min(...worldContour.map((item) => item.xMm)), minY: Math.min(...worldContour.map((item) => item.yMm)), maxX: Math.max(...worldContour.map((item) => item.xMm)), maxY: Math.max(...worldContour.map((item) => item.yMm)) };
    const camera = cameraModule.cameraToFitBounds(worldBounds, { width: rect.width, height: rect.height }, 70);
    const startLocal = contour.reduce((best, item) => item.yMm < best.yMm ? item : best, contour[0]);
    const apexLocal = { xMm: (bounds.minX + bounds.maxX) / 2, yMm: bounds.minY + (bounds.maxY - bounds.minY) * 0.35 };
    const toClient = (local) => { const screen = coordinates.worldToScreen(coordinates.pieceLocalToWorld(local, transform), camera); return { x: rect.left + screen.x, y: rect.top + screen.y }; };
    return { start: toClient(startLocal), apex: toClient(apexLocal) };
  });
}

async function exerciseTouchCut(currentBrowser) {
  const touchContext = await currentBrowser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
  const touchPage = await touchContext.newPage();
  const errors = [];
  touchPage.on("pageerror", (error) => errors.push(error.message));
  try {
    await touchPage.goto(baseURL, { waitUntil: "networkidle", timeout: 60_000 });
    await chooseBlankWorkspace(touchPage);
    await chooseTemplate(touchPage, "Saia reta");
    await touchPage.getByRole("checkbox", { name: "Selecionar Frente" }).check();
    await touchPage.getByRole("checkbox", { name: "Selecionar Costas" }).check();
    await touchPage.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
    const stroke = await crossPieceStroke(touchPage);
    await touchPage.getByRole("button", { name: "Recortar", exact: true }).click();
    await touchPage.touchscreen.tap(stroke.start.x, stroke.start.y);
    await touchPage.touchscreen.tap(stroke.middle.x, stroke.middle.y);
    await touchPage.touchscreen.tap(stroke.end.x, stroke.end.y);
    await touchPage.keyboard.press("Enter");
    const apply = touchPage.getByRole("button", { name: /Aplicar corte em 2 peças/ });
    await apply.waitFor({ state: "visible" });
    await apply.click();
    const count = (await editorState(touchPage)).pieceCount;
    return { passed: count === 4 && errors.length === 0, pieceCount: count, errors };
  } finally {
    await touchContext.close();
  }
}

async function editorState(currentPage) {
  return currentPage.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return {
      activePieceId: state.activePieceId,
      selectedPieceIds: [...state.selectedPieceIds],
      pieceCount: state.garment.pieces.length,
      pieceNames: state.garment.pieces.map((piece) => piece.name),
    };
  });
}

async function cutState(currentPage) {
  return currentPage.evaluate(async () => {
    const [{ useInternalPathEditorStore }, { useEditorStore }] = await Promise.all([
      import("/src/state/internalPathEditorStore.ts"),
      import("/src/state/editorStore.ts"),
    ]);
    const path = useInternalPathEditorStore.getState();
    return {
      selectedPathId: path.selectedPathId,
      analysisValid: path.analysis?.valid ?? false,
      multiCutTargetIds: [...(path.multiCutAnalysis?.targetPieceIds ?? [])],
      diagnostics: path.multiCutAnalysis?.diagnostics ?? path.analysis?.diagnostics ?? [],
      selectedPieceIds: [...useEditorStore.getState().selectedPieceIds],
    };
  });
}

async function crossPieceStroke(currentPage) {
  return currentPage.evaluate(async () => {
    const [storeModule, polygon, cameraModule, coordinates] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const selected = state.garment.pieces.filter((piece) => state.selectedPieceIds.includes(piece.id));
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement) || selected.length !== 2) {
      throw new Error("Duas peças selecionadas e Canvas são necessários.");
    }
    const boxes = selected.map((piece) => {
      const workspace = state.garment.workspaceStates?.find((item) => item.pieceId === piece.id);
      const transform = workspace?.transform
        ?? state.garment.workspaceTransforms?.find((item) => item.pieceId === piece.id)
        ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
      const points = polygon.samplePatternContour(piece.points).map((point) => coordinates.pieceLocalToWorld(point, transform));
      return {
        minX: Math.min(...points.map((point) => point.xMm)),
        minY: Math.min(...points.map((point) => point.yMm)),
        maxX: Math.max(...points.map((point) => point.xMm)),
        maxY: Math.max(...points.map((point) => point.yMm)),
      };
    });
    const bounds = {
      minX: Math.min(...boxes.map((box) => box.minX - 10)),
      minY: Math.min(...boxes.map((box) => box.minY - 10)),
      maxX: Math.max(...boxes.map((box) => box.maxX + 10)),
      maxY: Math.max(...boxes.map((box) => box.maxY + 10)),
    };
    const overlapTop = Math.max(...boxes.map((box) => box.minY));
    const overlapBottom = Math.min(...boxes.map((box) => box.maxY));
    const yMm = overlapTop < overlapBottom
      ? (overlapTop + overlapBottom) / 2
      : boxes.reduce((sum, box) => sum + (box.minY + box.maxY) / 2, 0) / boxes.length;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    const screen = (point) => {
      const value = coordinates.worldToScreen(point, camera);
      return { x: rect.left + value.x, y: rect.top + value.y };
    };
    const startWorld = { xMm: bounds.minX - 8, yMm };
    const endWorld = { xMm: bounds.maxX + 8, yMm };
    return {
      start: screen(startWorld),
      middle: screen({ xMm: (startWorld.xMm + endWorld.xMm) / 2, yMm }),
      end: screen(endWorld),
    };
  });
}
