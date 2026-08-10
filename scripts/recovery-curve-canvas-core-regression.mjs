import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-modeling-operations-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = { desktop: {}, mobile: {} };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function installCurveFixture(page, id, transform = { xMm: 0, yMm: 0, rotationDeg: 0 }) {
  await page.evaluate(async ({ id, transform }) => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }, { useInternalPathEditorStore }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/state/internalPathEditorStore.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = migrateLegacyPieceToSegments({
      id,
      name: `Curve ${id}`,
      seamAllowanceMm: 0,
      points: [
        { id: `${id}-a`, xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -20 } },
        { id: `${id}-b`, xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -18 } },
        { id: `${id}-c`, xMm: 140, yMm: 110 },
        { id: `${id}-d`, xMm: 0, yMm: 110 },
      ],
    });
    state.loadGarment({
      ...structuredClone(state.garment),
      id: `garment-${id}`,
      templateId: "blank",
      name: `Curve canvas ${id}`,
      pieces: [piece],
      seams: [],
      workspaceStates: [{ pieceId: id, transform: { pieceId: id, ...transform }, visible: true, locked: false }],
      workspaceTransforms: [{ pieceId: id, ...transform }],
      assemblyPlacements: [],
      parametric: undefined,
    });
    useInternalPathEditorStore.getState().reset();
    useEditorStore.getState().selectPiece(id);
  }, { id, transform });
  await page.locator(".pieces-item").filter({ hasText: `Curve ${id}` }).waitFor();
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(60);
}

async function activeGeometry(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    return piece ? structuredClone(piece.points) : null;
  });
}

async function activeWorkspace(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return structuredClone(state.garment.workspaceStates?.find((entry) => entry.pieceId === state.activePieceId)?.transform ?? null);
  });
}

async function screenForLocal(page, local) {
  return page.evaluate(async (local) => {
    const [{ useEditorStore }, polygon, camera, coordinates] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) throw new Error("Peça ativa ausente.");
    const transform = state.garment.workspaceStates?.find((entry) => entry.pieceId === piece.id)?.transform
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygon.samplePatternContour(piece.points).map((point) => coordinates.pieceLocalToWorld(point, transform));
    const bounds = {
      minX: Math.min(...contour.map((point) => point.xMm)),
      minY: Math.min(...contour.map((point) => point.yMm)),
      maxX: Math.max(...contour.map((point) => point.xMm)),
      maxY: Math.max(...contour.map((point) => point.yMm)),
    };
    const fit = camera.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 70);
    return coordinates.worldToScreen(coordinates.pieceLocalToWorld(local, transform), fit);
  }, local);
}

async function curveSelectionTarget(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, pattern, polygon] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/domain/polygonGeometry.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) return null;
    for (const edge of pattern.getPatternEdges(piece)) {
      const start = piece.points.find((point) => point.id === edge.startPointId);
      const end = piece.points.find((point) => point.id === edge.endPointId);
      if (!start || !end || (!start.handleOut && !end.handleIn)) continue;
      const samples = polygon.samplePatternSegment(start, end);
      const sample = samples[Math.floor(samples.length / 2)];
      return { edgeId: edge.id, local: { xMm: sample.xMm, yMm: sample.yMm } };
    }
    return null;
  });
}

async function handleTargets(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, interaction] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/editor/curveHandleInteraction.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) return [];
    return interaction.patternCurveHandleTargets(piece, state.selectedPointId, state.selectedEdgeId).flatMap((target) => {
      const point = piece.points.find((candidate) => candidate.id === target.pointId);
      const vector = target.handle === "in" ? point?.handleIn : point?.handleOut;
      return point && vector ? [{
        pointId: point.id,
        handle: target.handle,
        local: { xMm: point.xMm + vector.xMm, yMm: point.yMm + vector.yMm },
      }] : [];
    });
  });
}

async function selectCurve(page, canvas, touch = false) {
  if (touch) await page.getByRole("button", { name: "Enquadrar seleção" }).tap();
  else await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(40);
  const target = await curveSelectionTarget(page);
  if (!target) throw new Error("Curva ativa não encontrada.");
  const position = await screenForLocal(page, target.local);
  if (touch) await canvas.tap({ position });
  else await canvas.click({ position });
  await page.waitForTimeout(50);
  const selection = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return { edgeId: state.selectedEdgeId, pointId: state.selectedPointId };
  });
  if (selection.edgeId !== target.edgeId || selection.pointId !== null) {
    throw new Error(`Curva não selecionou seu segmento: ${JSON.stringify(selection)}`);
  }
  const handles = await handleTargets(page);
  if (handles.length !== 2) throw new Error(`Curva selecionada expôs ${handles.length} handles.`);
  return handles;
}

async function mouseDrag(page, canvas, target, dx, dy) {
  const position = await screenForLocal(page, target.local);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box.");
  await page.mouse.move(box.x + position.x, box.y + position.y);
  await page.mouse.down();
  await page.mouse.move(box.x + position.x + dx, box.y + position.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(70);
}

async function cameraRoundTrip(page, canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.getByRole("button", { name: "Diminuir zoom" }).click();
  const hand = page.getByRole("button", { name: "Mão", exact: true });
  await hand.click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box para pan.");
  const x = box.x + box.width * 0.74;
  const y = box.y + box.height * 0.76;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 52, y - 20, { steps: 6 });
  await page.mouse.up();
  await hand.click();
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.waitForTimeout(60);
}

async function addOverlappingSeam(page) {
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece || !state.selectedEdgeId) throw new Error("Segmento curvo não selecionado para seam priority.");
    const range = { pieceId: piece.id, edgeId: state.selectedEdgeId, startT: 0, endT: 1 };
    useEditorStore.setState({
      garment: {
        ...state.garment,
        seams: [{ id: "curve-seam", name: "Curve seam", first: range, second: range, direction: "same", easeRatio: 0, type: "standard", treatment: "standard", active: true }],
      },
      selectedSeamId: null,
    });
  });
  await page.waitForTimeout(40);
}

async function runDesktop() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await context.newPage();
  const canvas = page.locator("canvas.pattern-canvas");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseURL, { waitUntil: "networkidle" });

  await installCurveFixture(page, "desktop-out", { xMm: 42, yMm: 28, rotationDeg: 17 });
  let handles = await selectCurve(page, canvas);
  report.desktop.selectCurveShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-core-desktop-selected.png`, fullPage: true });
  await addOverlappingSeam(page);
  const beforeOut = await activeGeometry(page);
  const inBefore = beforeOut.find((point) => point.id === handles.find((handle) => handle.handle === "in")?.pointId)?.handleIn;
  const output = handles.find((handle) => handle.handle === "out");
  if (!output) throw new Error("Handle de saída ausente.");
  await mouseDrag(page, canvas, output, 34, -17);
  const afterOut = await activeGeometry(page);
  if (same(beforeOut, afterOut)) throw new Error("Arraste do handle de saída não alterou a curva.");
  const inAfter = afterOut.find((point) => point.id === handles.find((handle) => handle.handle === "in")?.pointId)?.handleIn;
  if (!same(inBefore, inAfter)) throw new Error("Arraste do handle de saída alterou o handle de entrada.");
  const selectedSeamId = await page.evaluate(async () => (await import("/src/state/editorStore.ts")).useEditorStore.getState().selectedSeamId);
  if (selectedSeamId !== null) throw new Error("Costura roubou hit do handle.");
  report.desktop.outputHandleDrag = report.desktop.seamDoesNotStealHandle = true;

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(50);
  if (!same(await activeGeometry(page), beforeOut)) throw new Error("Um undo não restaurou exatamente o drag.");
  await cameraRoundTrip(page, canvas);
  if (!same(await activeGeometry(page), beforeOut)) throw new Error("Zoom/pan alterou estado restaurado por undo.");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(50);
  if (!same(await activeGeometry(page), afterOut)) throw new Error("Redo não reaplicou exatamente o drag.");
  await cameraRoundTrip(page, canvas);
  if (!same(await activeGeometry(page), afterOut)) throw new Error("Zoom/pan alterou estado reaplicado por redo.");
  report.desktop.oneDragOneUndo = report.desktop.undoRedoCameraStable = true;

  await installCurveFixture(page, "desktop-in", { xMm: 18, yMm: 24, rotationDeg: -13 });
  handles = await selectCurve(page, canvas);
  const beforeIn = await activeGeometry(page);
  const input = handles.find((handle) => handle.handle === "in");
  if (!input) throw new Error("Handle de entrada ausente.");
  await mouseDrag(page, canvas, input, -28, 19);
  const afterIn = await activeGeometry(page);
  if (same(beforeIn, afterIn)) throw new Error("Arraste do handle de entrada não alterou a curva.");
  await cameraRoundTrip(page, canvas);
  if (!same(await activeGeometry(page), afterIn)) throw new Error("Câmera alterou a curva editada.");
  report.desktop.inputHandleDrag = report.desktop.editedGeometryCameraStable = true;

  await installCurveFixture(page, "desktop-numeric");
  await selectCurve(page, canvas);
  const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  await numeric.getByRole("button", { name: "Handle saída" }).click();
  for (const [label, delta] of [["Handle X", 4], ["Handle Y", -3], ["Comprimento", 5], ["Ângulo", 7]]) {
    const field = numeric.getByLabel(label);
    const current = Number(await field.inputValue());
    await field.fill(String(label === "Comprimento" ? Math.max(1, current + delta) : current + delta));
    await field.press("Enter");
    await page.waitForTimeout(25);
  }
  report.desktop.numericXYLengthAngle = true;
  await page.screenshot({ path: `${artifactDir}/curve-core-desktop-numeric.png`, fullPage: true });

  if (errors.length) throw new Error(errors.join(" | "));
  await context.close();
}

async function touchDrag(cdp, start, end) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: start.x, y: start.y, radiusX: 7, radiusY: 7, force: 1 }],
  });
  for (let step = 1; step <= 7; step += 1) {
    const progress = step / 7;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        radiusX: 7,
        radiusY: 7,
        force: 1,
      }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function runMobile() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const canvas = page.locator("canvas.pattern-canvas");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installCurveFixture(page, "mobile", { xMm: 38, yMm: 24, rotationDeg: 12 });
  const handles = await selectCurve(page, canvas, true);
  report.mobile.tapCurveShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-core-mobile-selected.png`, fullPage: true });
  const before = await activeGeometry(page);
  const workspaceBefore = await activeWorkspace(page);
  const target = handles.find((handle) => handle.handle === "out") ?? handles[0];
  const position = await screenForLocal(page, target.local);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas mobile sem bounding box.");
  const start = { x: box.x + position.x + 16, y: box.y + position.y };
  const end = { x: start.x + 31, y: start.y - 14 };
  await touchDrag(cdp, start, end);
  await page.waitForTimeout(80);
  const after = await activeGeometry(page);
  if (same(before, after)) throw new Error("Touch dentro da hit area ampliada não arrastou o handle.");
  if (!same(workspaceBefore, await activeWorkspace(page))) throw new Error("Touch do handle iniciou movimento de peça/pan.");
  report.mobile.expandedHitAreaDrag = report.mobile.noAccidentalPan = true;
  await page.getByRole("button", { name: "Desfazer" }).tap();
  await page.waitForTimeout(50);
  if (!same(await activeGeometry(page), before)) throw new Error("Undo touch não restaurou a curva.");
  await page.getByRole("button", { name: "Refazer" }).tap();
  await page.waitForTimeout(50);
  if (!same(await activeGeometry(page), after)) throw new Error("Redo touch não reaplicou a curva.");
  report.mobile.undoRedoTouch = true;

  const stable = await activeGeometry(page);
  const zoomBefore = await page.locator(".zoom-indicator").textContent();
  const y = box.y + Math.max(45, box.height - 34);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: box.x + 92, y, radiusX: 7, radiusY: 7, force: 1 },
    { x: box.x + 188, y, radiusX: 7, radiusY: 7, force: 1 },
  ] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    { x: box.x + 70, y, radiusX: 7, radiusY: 7, force: 1 },
    { x: box.x + 210, y, radiusX: 7, radiusY: 7, force: 1 },
  ] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
  const zoomAfter = await page.locator(".zoom-indicator").textContent();
  if (zoomBefore === zoomAfter) throw new Error("Pinch fora dos handles não alterou o zoom.");
  if (!same(await activeGeometry(page), stable)) throw new Error("Pinch alterou geometria da curva.");
  report.mobile.pinchWorks = report.mobile.pinchPreservesGeometry = true;
  await page.screenshot({ path: `${artifactDir}/curve-core-mobile-after-touch.png`, fullPage: true });

  if (errors.length) throw new Error(errors.join(" | "));
  await context.close();
}

try {
  await runDesktop();
  await runMobile();
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
