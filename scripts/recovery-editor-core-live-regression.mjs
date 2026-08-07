import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-editor-core-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function openBlank(page) {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByText("Bancada vazia", { exact: true }).click();
  await page.getByRole("button", { name: "Criar bancada vazia" }).click();
  await page.locator(".empty-workspace").waitFor({ state: "visible" });
}

async function drawPiece(page) {
  page.once("dialog", (dialog) => dialog.accept("Regressão 9.5-04"));
  await page.getByRole("button", { name: "Desenhar primeira peça" }).click();
  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box.");
  const points = [
    [box.width * 0.28, box.height * 0.28],
    [box.width * 0.62, box.height * 0.28],
    [box.width * 0.62, box.height * 0.64],
    [box.width * 0.28, box.height * 0.64],
  ];
  for (const [x, y] of points) await canvas.click({ position: { x, y } });
  await page.keyboard.press("Enter");
  await page.locator(".pieces-item").filter({ hasText: "Regressão 9.5-04" }).waitFor();
  return canvas;
}

async function geometry(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return state.garment.pieces.map((piece) => ({
      id: piece.id,
      points: piece.points.map((point) => ({
        id: point.id,
        xMm: point.xMm,
        yMm: point.yMm,
        handleIn: point.handleIn ? { ...point.handleIn } : null,
        handleOut: point.handleOut ? { ...point.handleOut } : null,
      })),
    }));
  });
}

async function activePointIds(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces[0].points.map((point) => point.id);
  });
}

async function installSeamOnFirstPiece(page) {
  await page.evaluate(async () => {
    const [{ useEditorStore }, { getPatternEdges }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const garment = structuredClone(state.garment);
    const piece = garment.pieces[0];
    const edges = getPatternEdges(piece);
    garment.seams = [
      {
        id: "recovery-seam",
        name: "Costura de regressão",
        first: { pieceId: piece.id, edgeId: edges[0].id, startT: 0, endT: 1 },
        second: { pieceId: piece.id, edgeId: edges[2].id, startT: 0, endT: 1 },
        direction: "same",
        easeRatio: 0,
        type: "standard",
        treatment: "standard",
        active: true,
      },
    ];
    state.loadGarment(garment);
  });
  await page.waitForTimeout(80);
}

async function fitAll(page) {
  await page.getByRole("button", { name: "Enquadrar tudo" }).click();
  await page.waitForTimeout(60);
}

async function fittedScreenPosition(page, resolver) {
  return page.evaluate(async (source) => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const garment = state.garment;
    const piece = garment.pieces.find((candidate) => candidate.id === state.activePieceId) ?? garment.pieces[0];
    if (!piece) throw new Error("Peça ativa ausente.");
    const workspace = garment.workspaceStates?.find((item) => item.pieceId === piece.id);
    const transform = workspace?.transform
      ?? garment.workspaceTransforms?.find((item) => item.pieceId === piece.id)
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points).map((point) =>
      coordinateModule.pieceLocalToWorld(point, transform),
    );
    const allowance = Math.max(0, piece.seamAllowanceMm);
    const bounds = {
      minX: Math.min(...contour.map((point) => point.xMm)) - allowance,
      minY: Math.min(...contour.map((point) => point.yMm)) - allowance,
      maxX: Math.max(...contour.map((point) => point.xMm)) + allowance,
      maxY: Math.max(...contour.map((point) => point.yMm)) + allowance,
    };
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    let local;
    if (source.kind === "point") {
      const point = piece.points.find((candidate) => candidate.id === source.pointId);
      if (!point) throw new Error(`Ponto ${source.pointId} ausente.`);
      local = { xMm: point.xMm, yMm: point.yMm };
    } else {
      const start = piece.points.find((candidate) => candidate.id === source.startPointId);
      const end = piece.points.find((candidate) => candidate.id === source.endPointId);
      if (!start || !end) throw new Error("Segmento solicitado ausente.");
      local = { xMm: (start.xMm + end.xMm) / 2, yMm: (start.yMm + end.yMm) / 2 };
    }
    const world = coordinateModule.pieceLocalToWorld(local, transform);
    return coordinateModule.worldToScreen(world, camera);
  }, resolver);
}

async function clickPoint(page, canvas, pointId) {
  await fitAll(page);
  const position = await fittedScreenPosition(page, { kind: "point", pointId });
  await canvas.click({ position });
  await page.getByRole("region", { name: "Edição numérica do editor 2D" }).waitFor({ state: "visible" });
}

async function panCanvas(page, canvas) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box para pan.");
  const startX = box.x + box.width - 38;
  const startY = box.y + box.height - 38;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 64, startY - 32, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

async function navigateCamera(page, canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.waitForTimeout(40);
  await panCanvas(page, canvas);
}

async function assertNoSelection(page, label) {
  const checked = await page.locator('.pieces-item input[type="checkbox"]:checked').count();
  if (checked !== 0) throw new Error(`${label}: seleção de peça permaneceu.`);
  if (await page.getByRole("region", { name: "Edição numérica do editor 2D" }).isVisible().catch(() => false)) {
    throw new Error(`${label}: seleção geométrica permaneceu.`);
  }
  if (await page.getByRole("button", { name: "Girar peça selecionada" }).isVisible().catch(() => false)) {
    throw new Error(`${label}: seleção de peça ainda expõe rotação.`);
  }
}

async function assertGeometry(page, expected, label) {
  const actual = await geometry(page);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: câmera alterou geometria do documento.`);
  }
}

const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

try {
  await openBlank(page);
  const canvas = await drawPiece(page);
  const [a, b, c, d] = await activePointIds(page);

  // Peça selecionada -> clique realmente vazio -> nenhuma seleção.
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Canvas ausente.");
  await canvas.click({ position: { x: canvasBox.width - 30, y: canvasBox.height - 30 } });
  await page.waitForTimeout(60);
  await assertNoSelection(page, "clique vazio");

  // Ponto -> Escape -> mesma ação autoritativa de limpeza.
  await clickPoint(page, canvas, a);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  await assertNoSelection(page, "Escape em ponto");

  // Cria curva pelo fluxo real e testa Escape após escolher o handle numérico.
  await clickPoint(page, canvas, a);
  const curveToggle = page.getByRole("button", { name: "Curvar segmento de saída" });
  if (await curveToggle.isVisible().catch(() => false)) await curveToggle.click();
  const pointNumeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  const handleOutButton = pointNumeric.getByRole("button", { name: "Handle saída" });
  await handleOutButton.waitFor({ state: "visible" });
  await handleOutButton.click();
  await pointNumeric.getByLabel("Handle X").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  await assertNoSelection(page, "Escape em handle");

  // Costura sobre a borda não pode roubar o ponto.
  await installSeamOnFirstPiece(page);
  await clickPoint(page, canvas, a);
  const sewnNumeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  await sewnNumeric.getByLabel("X").waitFor({ state: "visible" });

  // X/Y do ponto permanecem depois de zoom e pan.
  const pointX = sewnNumeric.getByLabel("X");
  const originalX = Number(await pointX.inputValue());
  const editedX = originalX + 24;
  await pointX.fill(String(editedX));
  await pointX.press("Enter");
  await page.waitForTimeout(50);
  const pointEditedGeometry = await geometry(page);
  await navigateCamera(page, canvas);
  await assertGeometry(page, pointEditedGeometry, "X/Y do ponto após zoom/pan");
  if (Math.abs(Number(await sewnNumeric.getByLabel("X").inputValue()) - editedX) > 0.001) {
    throw new Error("Campo X não preservou o valor após zoom/pan.");
  }

  // Handle da curva é acessível a partir do segmento/curva e persiste com a câmera.
  await fitAll(page);
  const topMid = await fittedScreenPosition(page, { kind: "segment", startPointId: a, endPointId: b });
  await canvas.click({ position: topMid });
  const segmentNumeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  await segmentNumeric.waitFor({ state: "visible" });
  const segmentHandleOut = segmentNumeric.getByRole("button", { name: "Handle saída" });
  await segmentHandleOut.waitFor({ state: "visible" });
  await segmentHandleOut.click();
  const handleX = segmentNumeric.getByLabel("Handle X");
  const oldHandleX = Number(await handleX.inputValue());
  const newHandleX = oldHandleX + 13;
  await handleX.fill(String(newHandleX));
  await handleX.press("Enter");
  await page.waitForTimeout(50);
  const handleEditedGeometry = await geometry(page);
  await navigateCamera(page, canvas);
  await assertGeometry(page, handleEditedGeometry, "handle após zoom/pan");
  if (Math.abs(Number(await segmentNumeric.getByLabel("Handle X").inputValue()) - newHandleX) > 0.001) {
    throw new Error("Handle numérico não preservou o valor após zoom/pan.");
  }

  // Undo/redo também são estados geométricos autoritativos diante da câmera.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(50);
  const undoGeometry = await geometry(page);
  if (JSON.stringify(undoGeometry) === JSON.stringify(handleEditedGeometry)) {
    throw new Error("Undo não restaurou a geometria anterior do handle.");
  }
  await navigateCamera(page, canvas);
  await assertGeometry(page, undoGeometry, "undo após zoom/pan");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(50);
  const redoGeometry = await geometry(page);
  if (JSON.stringify(redoGeometry) !== JSON.stringify(handleEditedGeometry)) {
    throw new Error("Redo não reaplicou a geometria do handle.");
  }
  await navigateCamera(page, canvas);
  await assertGeometry(page, redoGeometry, "redo após zoom/pan");

  // Edição exata do comprimento de uma reta e câmera não restauram geometria antiga.
  await fitAll(page);
  const bottomMid = await fittedScreenPosition(page, { kind: "segment", startPointId: c, endPointId: d });
  const beforeLengthGeometry = await geometry(page);
  await canvas.dblclick({ position: bottomMid, delay: 60 });
  const lengthInput = page.getByLabel("Comprimento do segmento em milímetros");
  await lengthInput.waitFor({ state: "visible" });
  const oldLength = Number(await lengthInput.inputValue());
  const newLength = oldLength * 1.22;
  await lengthInput.fill(newLength.toFixed(2));
  await lengthInput.press("Enter");
  await page.waitForTimeout(60);
  const lengthEditedGeometry = await geometry(page);
  if (JSON.stringify(lengthEditedGeometry) === JSON.stringify(beforeLengthGeometry)) {
    throw new Error("Edição de comprimento não alterou a geometria.");
  }
  await navigateCamera(page, canvas);
  await assertGeometry(page, lengthEditedGeometry, "comprimento após zoom/pan");

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(50);
  const lengthUndoGeometry = await geometry(page);
  if (JSON.stringify(lengthUndoGeometry) !== JSON.stringify(beforeLengthGeometry)) {
    throw new Error("Undo do comprimento não restaurou a geometria anterior.");
  }
  await navigateCamera(page, canvas);
  await assertGeometry(page, lengthUndoGeometry, "undo do comprimento após zoom/pan");

  await page.keyboard.press("Control+y");
  await page.waitForTimeout(50);
  const lengthRedoGeometry = await geometry(page);
  if (JSON.stringify(lengthRedoGeometry) !== JSON.stringify(lengthEditedGeometry)) {
    throw new Error("Redo do comprimento não reaplicou a geometria editada.");
  }
  await navigateCamera(page, canvas);
  await assertGeometry(page, lengthRedoGeometry, "redo do comprimento após zoom/pan");

  await page.screenshot({ path: `${artifactDir}/editor-core-live-regression.png`, fullPage: true });
  if (errors.length) throw new Error(errors.join(" | "));

  console.log(JSON.stringify({
    emptyClickClearsSelection: true,
    escapeClearsPoint: true,
    escapeClearsHandle: true,
    sewnEdgePointSelectable: true,
    pointNumericSurvivesCamera: true,
    handleNumericSurvivesCamera: true,
    lengthEditSurvivesCamera: true,
    undoSurvivesCamera: true,
    redoSurvivesCamera: true,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
