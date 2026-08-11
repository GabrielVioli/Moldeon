import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4173";
const executablePath = process.env.CHROME_PATH
  ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/google-chrome");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1366, height: 820 }, locale: "pt-BR" });
const report = { errors: [], consoleErrors: [] };
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });

try {
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByRole("button", { name: /Bancada vazia/i }).click();
  await page.getByRole("button", { name: "Criar bancada vazia", exact: true }).click();
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByRole("button", { name: /Saia reta/i }).first().click();
  await page.getByRole("button", { name: "Criar molde", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("checkbox", { name: "Selecionar Frente" }).check();
  await page.getByRole("checkbox", { name: "Selecionar Costas" }).check();
  await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
  const stroke = await crossPieceStroke(page);
  report.stroke = stroke;
  await page.getByRole("button", { name: "Recortar", exact: true }).click();

  await page.mouse.move(stroke.start.x, stroke.start.y);
  await page.mouse.down();
  await page.mouse.move(stroke.end.x, stroke.end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  report.afterDrag = await cutState(page);
  report.applyVisible = await page.getByRole("button", { name: /Aplicar corte em 2 peças/ }).count() > 0;
  report.finishVisible = await page.getByRole("button", { name: "Concluir caminho" }).count() > 0;
  if (report.applyVisible) {
    await page.getByRole("button", { name: /Aplicar corte em 2 peças/ }).click();
    report.pieceCountAfterApply = await pieceCount(page);
    await page.getByRole("button", { name: "Desfazer" }).click();
    report.pieceCountAfterUndo = await pieceCount(page);
  }
} finally {
  await browser.close();
}

const passed = report.errors.length === 0
  && report.consoleErrors.length === 0
  && report.afterDrag.selectedPieceIds.length === 2
  && report.afterDrag.confirmed
  && report.afterDrag.targetPieceIds.length === 2
  && report.applyVisible
  && report.pieceCountAfterApply === 4
  && report.pieceCountAfterUndo === 2;
console.log(JSON.stringify({ passed, ...report }, null, 2));
if (!passed) process.exitCode = 1;

async function cutState(currentPage) {
  return currentPage.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }, { analyzeMultiPieceCut }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"), import("/src/domain/modelingCut.ts"),
    ]);
    const state = useEditorStore.getState();
    const source = state.garment.pieces.find((piece) => piece.id === state.activePieceId);
    const path = source?.internalLines?.filter(isInternalPath).at(-1);
    const analysis = source && path
      ? analyzeMultiPieceCut(state.garment, source.id, path, state.selectedPieceIds)
      : null;
    return {
      selectedPieceIds: [...state.selectedPieceIds],
      confirmed: path?.metadata.draft === false,
      nodeCount: path?.nodes.length ?? 0,
      nodes: path?.nodes ?? [],
      targetPieceIds: analysis?.targetPieceIds ?? [],
      diagnostics: analysis?.diagnostics ?? [],
    };
  });
}

async function pieceCount(currentPage) {
  return currentPage.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces.length;
  });
}

async function crossPieceStroke(currentPage) {
  return currentPage.evaluate(async () => {
    const [storeModule, polygon, cameraModule, coordinates] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const selected = state.garment.pieces.filter((piece) => state.selectedPieceIds.includes(piece.id));
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement) || selected.length !== 2) throw new Error("Duas peças selecionadas e Canvas são necessários.");
    const boxes = selected.map((piece) => {
      const transform = state.garment.workspaceStates?.find((item) => item.pieceId === piece.id)?.transform
        ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
      const points = polygon.samplePatternContour(piece.points).map((point) => coordinates.pieceLocalToWorld(point, transform));
      return { minX: Math.min(...points.map((point) => point.xMm)), minY: Math.min(...points.map((point) => point.yMm)), maxX: Math.max(...points.map((point) => point.xMm)), maxY: Math.max(...points.map((point) => point.yMm)) };
    });
    const bounds = { minX: Math.min(...boxes.map((box) => box.minX - 18)), minY: Math.min(...boxes.map((box) => box.minY - 10)), maxX: Math.max(...boxes.map((box) => box.maxX + 18)), maxY: Math.max(...boxes.map((box) => box.maxY + 10)) };
    const overlapTop = Math.max(...boxes.map((box) => box.minY));
    const overlapBottom = Math.min(...boxes.map((box) => box.maxY));
    const yMm = (overlapTop + overlapBottom) / 2;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    const client = (point) => { const screen = coordinates.worldToScreen(point, camera); return { x: rect.left + screen.x, y: rect.top + screen.y }; };
    return { start: client({ xMm: bounds.minX, yMm }), end: client({ xMm: bounds.maxX, yMm }), bounds, boxes, yMm };
  });
}
