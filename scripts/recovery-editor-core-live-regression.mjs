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
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

async function installFixture() {
  await page.evaluate(async () => {
    const [{ useEditorStore }, { getPatternEdges }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = {
      id: "recovery-live-piece",
      name: "Regressão 9.5-04",
      seamAllowanceMm: 0,
      points: [
        { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 34, yMm: -28 } },
        { id: "b", xMm: 180, yMm: 0, handleIn: { xMm: -34, yMm: -28 } },
        { id: "c", xMm: 180, yMm: 140 },
        { id: "d", xMm: 0, yMm: 140 },
      ],
    };
    const edges = getPatternEdges(piece);
    const garment = {
      ...structuredClone(state.garment),
      id: "recovery-live-garment",
      name: "Regressão 9.5-04",
      pieces: [piece],
      seams: [
        {
          id: "recovery-live-seam",
          name: "Costura de regressão",
          first: { pieceId: piece.id, edgeId: edges[0].id, startT: 0, endT: 1 },
          second: { pieceId: piece.id, edgeId: edges[2].id, startT: 0, endT: 1 },
          direction: "same",
          easeRatio: 0,
          type: "standard",
          treatment: "standard",
          active: true,
        },
      ],
      workspaceTransforms: [],
      workspaceStates: [
        {
          pieceId: piece.id,
          transform: { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 },
          visible: true,
          locked: false,
        },
      ],
      assemblyPlacements: [],
      parametric: undefined,
    };
    state.loadGarment(garment);
  });
  await page.locator(".pieces-item").filter({ hasText: "Regressão 9.5-04" }).waitFor();
}

async function geometry() {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces.map((piece) => ({
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

async function fitAll() {
  await page.getByRole("button", { name: "Enquadrar tudo" }).click();
  await page.waitForTimeout(60);
}

async function screenPosition(target) {
  return page.evaluate(async (requested) => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const garment = state.garment;
    const piece = garment.pieces[0];
    const workspace = garment.workspaceStates?.find((item) => item.pieceId === piece.id);
    const transform = workspace?.transform ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points).map((point) =>
      coordinateModule.pieceLocalToWorld(point, transform),
    );
    const bounds = {
      minX: Math.min(...contour.map((point) => point.xMm)),
      minY: Math.min(...contour.map((point) => point.yMm)),
      maxX: Math.max(...contour.map((point) => point.xMm)),
      maxY: Math.max(...contour.map((point) => point.yMm)),
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
    } else {
      local = { xMm: (bounds.minX + bounds.maxX) / 2, yMm: (bounds.minY + bounds.maxY) / 2 };
    }
    const world = coordinateModule.pieceLocalToWorld(local, transform);
    return coordinateModule.worldToScreen(world, camera);
  }, target);
}

async function realEmptyPosition() {
  return page.evaluate(async () => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const piece = state.garment.pieces[0];
    const transform = state.garment.workspaceStates?.[0]?.transform ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points).map((point) => coordinateModule.pieceLocalToWorld(point, transform));
    const bounds = {
      minX: Math.min(...contour.map((point) => point.xMm)),
      minY: Math.min(...contour.map((point) => point.yMm)),
      maxX: Math.max(...contour.map((point) => point.xMm)),
      maxY: Math.max(...contour.map((point) => point.yMm)),
    };
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    const screenContour = contour.map((point) => coordinateModule.worldToScreen(point, camera));
    const pieceBox = {
      left: Math.min(...screenContour.map((point) => point.x)) - 22,
      right: Math.max(...screenContour.map((point) => point.x)) + 22,
      top: Math.min(...screenContour.map((point) => point.y)) - 22,
      bottom: Math.max(...screenContour.map((point) => point.y)) + 22,
    };
    const candidates = [
      { x: 42, y: rect.height * 0.78 },
      { x: 42, y: rect.height * 0.5 },
      { x: rect.width - 42, y: rect.height * 0.5 },
      { x: rect.width * 0.5, y: rect.height - 42 },
    ];
    for (const candidate of candidates) {
      const topElement = document.elementFromPoint(rect.left + candidate.x, rect.top + candidate.y);
      const outsidePiece = candidate.x < pieceBox.left || candidate.x > pieceBox.right || candidate.y < pieceBox.top || candidate.y > pieceBox.bottom;
      if (topElement === canvas && outsidePiece) return candidate;
    }
    throw new Error("Nenhum ponto vazio real e descoberto foi encontrado no Canvas.");
  });
}

async function assertNoSelection(label) {
  const state = await page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/state/internalPathEditorStore.ts"),
    ]);
    const editor = useEditorStore.getState();
    const internal = useInternalPathEditorStore.getState();
    return {
      selectedPointId: editor.selectedPointId,
      selectedEdgeId: editor.selectedEdgeId,
      selectedSeamId: editor.selectedSeamId,
      selectedDartId: editor.selectedDartId,
      selectedPieceIds: editor.selectedPieceIds,
      pieceSelectionActive: editor.pieceSelectionActive,
      seamFirstEdge: editor.seamFirstEdge,
      seamProposal: editor.seamProposal,
      nearbySeamSuggestion: editor.nearbySeamSuggestion,
      selectedPathId: internal.selectedPathId,
      selectedNodeId: internal.selectedNodeId,
      selectedSegmentId: internal.selectedSegmentId,
    };
  });
  const values = Object.values(state);
  const dirty = values.some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
  if (dirty) throw new Error(`${label}: seleção persistiu: ${JSON.stringify(state)}`);
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
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box.");
  const x = box.x + box.width * 0.48;
  const y = box.y + box.height * 0.74;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 62, y - 31, { steps: 8 });
  await page.mouse.up();
  await hand.click();
  await page.waitForTimeout(60);
}

async function assertGeometry(expected, label) {
  const actual = await geometry();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: zoom/pan alterou a geometria autoritativa.`);
  }
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture();
  const canvas = page.locator("canvas.pattern-canvas");
  await fitAll();

  // Peça -> fundo real -> nenhuma seleção.
  await canvas.click({ position: await screenPosition({ kind: "piece" }) });
  await page.getByRole("button", { name: "Girar peça selecionada" }).waitFor({ state: "visible" });
  await canvas.click({ position: await realEmptyPosition() });
  await page.waitForTimeout(60);
  await assertNoSelection("clique vazio");

  // Ponto -> Escape -> mesma ação autoritativa.
  await clickPoint(canvas, "a");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(40);
  await assertNoSelection("Escape em ponto");

  // Handle -> Escape -> mesma ação autoritativa.
  await clickPoint(canvas, "a");
  const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  await numeric.getByRole("button", { name: "Handle saída" }).click();
  await numeric.getByLabel("Handle X").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(40);
  await assertNoSelection("Escape em handle");

  // O ponto está exatamente sobre uma borda costurada e ainda precisa vencer o hit da costura.
  await clickPoint(canvas, "a");
  if (!(await numeric.getByLabel("X").isVisible())) throw new Error("Ponto de borda costurada não foi selecionado.");

  // X e Y do ponto sobrevivem a zoom e pan.
  const xField = numeric.getByLabel("X");
  const yField = numeric.getByLabel("Y");
  await xField.fill("14");
  await xField.press("Enter");
  await yField.fill("9");
  await yField.press("Enter");
  await page.waitForTimeout(50);
  const pointEdited = await geometry();
  await navigateCamera(canvas);
  await assertGeometry(pointEdited, "X/Y do ponto");

  // Todos os campos numéricos do handle participam do fluxo real e sobrevivem à câmera.
  await fitAll();
  await clickPoint(canvas, "a");
  await numeric.getByRole("button", { name: "Handle saída" }).click();
  for (const [label, value] of [["Handle X", "42"], ["Handle Y", "-17"], ["Comprimento", "58"], ["Ângulo", "-22"]]) {
    const field = numeric.getByLabel(label);
    await field.fill(value);
    await field.press("Enter");
  }
  await page.waitForTimeout(50);
  const handleEdited = await geometry();
  await navigateCamera(canvas);
  await assertGeometry(handleEdited, "handle numérico");

  // Undo e redo também precisam continuar autoritativos durante movimentos de câmera.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(50);
  const undoHandle = await geometry();
  if (JSON.stringify(undoHandle) === JSON.stringify(handleEdited)) throw new Error("Undo do handle não alterou a geometria.");
  await navigateCamera(canvas);
  await assertGeometry(undoHandle, "undo do handle");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(50);
  const redoHandle = await geometry();
  if (JSON.stringify(redoHandle) !== JSON.stringify(handleEdited)) throw new Error("Redo do handle não reaplicou a geometria.");
  await navigateCamera(canvas);
  await assertGeometry(redoHandle, "redo do handle");

  // Comprimento exato de uma reta -> zoom/pan -> permanece; undo/redo idem.
  await fitAll();
  const beforeLength = await geometry();
  await canvas.dblclick({ position: await screenPosition({ kind: "segment", start: "b", end: "c" }), delay: 50 });
  const lengthField = page.getByLabel("Comprimento do segmento em milímetros");
  await lengthField.waitFor({ state: "visible" });
  const oldLength = Number(await lengthField.inputValue());
  await lengthField.fill((oldLength * 1.2).toFixed(2));
  await lengthField.press("Enter");
  await page.waitForTimeout(50);
  const lengthEdited = await geometry();
  if (JSON.stringify(lengthEdited) === JSON.stringify(beforeLength)) throw new Error("Edição de comprimento não alterou a geometria.");
  await navigateCamera(canvas);
  await assertGeometry(lengthEdited, "comprimento editado");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(50);
  const undoLength = await geometry();
  if (JSON.stringify(undoLength) !== JSON.stringify(beforeLength)) throw new Error("Undo do comprimento não restaurou o estado anterior.");
  await navigateCamera(canvas);
  await assertGeometry(undoLength, "undo do comprimento");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(50);
  const redoLength = await geometry();
  if (JSON.stringify(redoLength) !== JSON.stringify(lengthEdited)) throw new Error("Redo do comprimento não restaurou o estado editado.");
  await navigateCamera(canvas);
  await assertGeometry(redoLength, "redo do comprimento");

  await page.screenshot({ path: `${artifactDir}/editor-core-live-regression.png`, fullPage: true });
  if (errors.length) throw new Error(errors.join(" | "));
  console.log(JSON.stringify({
    emptyClickClearsSelection: true,
    escapeClearsPoint: true,
    escapeClearsHandle: true,
    sewnEdgePointSelectable: true,
    pointXYSurvivesZoomPan: true,
    handleXYLengthAngleSurviveZoomPan: true,
    lengthEditSurvivesZoomPan: true,
    undoSurvivesZoomPan: true,
    redoSurvivesZoomPan: true,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
