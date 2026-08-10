import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-modeling-operations-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = { desktop: {}, mobile: {} };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function open(page) {
  await page.goto(baseURL, { waitUntil: "networkidle" });
}

async function installPiece(page, id, curve = "top", transform = { xMm: 0, yMm: 0, rotationDeg: 0 }) {
  await page.evaluate(async ({ id, curve, transform }) => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }, { useInternalPathEditorStore }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/state/internalPathEditorStore.ts"),
    ]);
    const state = useEditorStore.getState();
    const points = curve === "top" ? [
      { id: `${id}-a`, xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -18 } },
      { id: `${id}-b`, xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -20 } },
      { id: `${id}-c`, xMm: 140, yMm: 110 },
      { id: `${id}-d`, xMm: 0, yMm: 110 },
    ] : curve === "left" ? [
      { id: `${id}-a`, xMm: 0, yMm: 0, handleIn: { xMm: -24, yMm: 28 } },
      { id: `${id}-b`, xMm: 140, yMm: 0 },
      { id: `${id}-c`, xMm: 140, yMm: 110 },
      { id: `${id}-d`, xMm: 0, yMm: 110, handleOut: { xMm: -24, yMm: -28 } },
    ] : [
      { id: `${id}-a`, xMm: 0, yMm: 0 },
      { id: `${id}-b`, xMm: 140, yMm: 0 },
      { id: `${id}-c`, xMm: 140, yMm: 110 },
      { id: `${id}-d`, xMm: 0, yMm: 110 },
    ];
    const fabricId = state.garment.fabrics[0]?.id;
    const piece = migrateLegacyPieceToSegments({ id, name: `Curve fixture ${id}`, seamAllowanceMm: 0, ...(fabricId ? { fabricId } : {}), points });
    state.loadGarment({
      ...structuredClone(state.garment),
      id: `garment-${id}`,
      templateId: "blank",
      name: `Curve regression ${id}`,
      pieces: [piece],
      seams: [],
      workspaceStates: [{ pieceId: id, transform: { pieceId: id, ...transform }, visible: true, locked: false }],
      workspaceTransforms: [{ pieceId: id, ...transform }],
      assemblyPlacements: [],
      parametric: undefined,
    });
    useInternalPathEditorStore.getState().reset();
    useEditorStore.getState().selectPiece(id);
  }, { id, curve, transform });
  await page.locator(".pieces-item").filter({ hasText: `Curve fixture ${id}` }).waitFor();
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(50);
}

async function currentGeometry(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    return piece ? structuredClone(piece.points) : null;
  });
}

async function currentWorkspace(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return structuredClone(state.garment.workspaceStates?.find((entry) => entry.pieceId === state.activePieceId)?.transform ?? null);
  });
}

async function localToScreen(page, local) {
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

async function curveSample(page) {
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
      const sample = samples[Math.max(1, Math.min(samples.length - 2, Math.floor(samples.length * 0.35)))];
      return { edgeId: edge.id, local: { xMm: sample.xMm, yMm: sample.yMm } };
    }
    return null;
  });
}

async function visibleHandles(page) {
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
  const curve = await curveSample(page);
  if (!curve) throw new Error("Nenhuma curva ativa encontrada.");
  const position = await localToScreen(page, curve.local);
  if (touch) await canvas.tap({ position });
  else await canvas.click({ position });
  await page.waitForTimeout(50);
  const selection = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return { edgeId: state.selectedEdgeId, pointId: state.selectedPointId };
  });
  if (selection.edgeId !== curve.edgeId || selection.pointId !== null) {
    throw new Error(`Clique/toque na curva não selecionou o segmento: ${JSON.stringify(selection)}`);
  }
  const handles = await visibleHandles(page);
  if (handles.length !== 2) throw new Error(`Segmento curvo selecionado expôs ${handles.length} handles.`);
  return handles;
}

async function dragMouse(page, canvas, target, dx, dy) {
  const position = await localToScreen(page, target.local);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box.");
  await page.mouse.move(box.x + position.x, box.y + position.y);
  await page.mouse.down();
  await page.mouse.move(box.x + position.x + dx, box.y + position.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

async function cameraRoundTrip(page, canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.getByRole("button", { name: "Diminuir zoom" }).click();
  const hand = page.getByRole("button", { name: "Mão", exact: true });
  await hand.click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box para pan.");
  const x = box.x + box.width * 0.72;
  const y = box.y + box.height * 0.76;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 48, y - 22, { steps: 6 });
  await page.mouse.up();
  await hand.click();
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.waitForTimeout(50);
}

async function desktopExistingAndHistory(page, canvas) {
  await installPiece(page, "existing", "top", { xMm: 48, yMm: 32, rotationDeg: 17 });
  let handles = await selectCurve(page, canvas);
  report.desktop.selectCurveShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-handles-desktop.png`, fullPage: true });
  const before = await currentGeometry(page);
  const out = handles.find((handle) => handle.handle === "out");
  if (!out) throw new Error("Handle de saída ausente.");
  await dragMouse(page, canvas, out, 34, -17);
  const after = await currentGeometry(page);
  if (same(before, after)) throw new Error("Arraste do handle de saída não alterou a curva.");
  report.desktop.outputHandleDrag = true;
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(50);
  if (!same(await currentGeometry(page), before)) throw new Error("Um undo não restaurou a curva anterior.");
  await cameraRoundTrip(page, canvas);
  if (!same(await currentGeometry(page), before)) throw new Error("Zoom/pan alterou o estado de undo.");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(50);
  if (!same(await currentGeometry(page), after)) throw new Error("Redo não reaplicou a curva.");
  await cameraRoundTrip(page, canvas);
  if (!same(await currentGeometry(page), after)) throw new Error("Zoom/pan alterou o estado de redo.");
  report.desktop.singleUndoRedoCameraStable = true;

  await installPiece(page, "input", "top", { xMm: 22, yMm: 18, rotationDeg: -11 });
  handles = await selectCurve(page, canvas);
  const beforeInput = await currentGeometry(page);
  const input = handles.find((handle) => handle.handle === "in");
  if (!input) throw new Error("Handle de entrada ausente.");
  await dragMouse(page, canvas, input, -28, 18);
  const afterInput = await currentGeometry(page);
  if (same(beforeInput, afterInput)) throw new Error("Arraste do handle de entrada não alterou a curva.");
  await cameraRoundTrip(page, canvas);
  if (!same(await currentGeometry(page), afterInput)) throw new Error("Câmera alterou curva depois do drag de entrada.");
  report.desktop.inputHandleDrag = report.desktop.editedGeometryCameraStable = true;
}

async function desktopSeamPriority(page, canvas) {
  await installPiece(page, "seam-priority", "top");
  const handles = await selectCurve(page, canvas);
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece || !state.selectedEdgeId) throw new Error("Segmento selecionado ausente.");
    const range = { pieceId: piece.id, edgeId: state.selectedEdgeId, startT: 0, endT: 1 };
    useEditorStore.setState({
      garment: { ...state.garment, seams: [{ id: "overlap", name: "Overlap", first: range, second: range, direction: "same", easeRatio: 0, type: "standard", treatment: "standard", active: true }] },
      selectedSeamId: null,
    });
  });
  const before = await currentGeometry(page);
  await dragMouse(page, canvas, handles.find((handle) => handle.handle === "out") ?? handles[0], 26, -12);
  if (same(await currentGeometry(page), before)) throw new Error("Costura sobreposta impediu drag do handle.");
  const selectedSeam = await page.evaluate(async () => (await import("/src/state/editorStore.ts")).useEditorStore.getState().selectedSeamId);
  if (selectedSeam !== null) throw new Error("Costura roubou hit do handle.");
  report.desktop.seamDoesNotStealHandle = true;
}

async function desktopNumericAndOrigins(page, canvas) {
  await installPiece(page, "numeric", "top");
  await selectCurve(page, canvas);
  const panel = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  await panel.getByRole("button", { name: "Handle saída" }).click();
  for (const [label, delta] of [["Handle X", 4], ["Handle Y", -3], ["Comprimento", 5], ["Ângulo", 7]]) {
    const field = panel.getByLabel(label);
    const current = Number(await field.inputValue());
    await field.fill(String(label === "Comprimento" ? Math.max(1, current + delta) : current + delta));
    await field.press("Enter");
    await page.waitForTimeout(20);
  }
  report.desktop.numericXYLengthAngle = true;

  await installPiece(page, "manual", "none");
  await canvas.click({ position: await localToScreen(page, { xMm: 50, yMm: 0 }) });
  await page.waitForTimeout(40);
  await page.getByRole("region", { name: "Edição numérica do editor 2D" }).getByRole("button", { name: "Converter" }).click();
  await page.waitForTimeout(50);
  const manualHandles = await selectCurve(page, canvas);
  const manualBefore = await currentGeometry(page);
  await dragMouse(page, canvas, manualHandles[0], 22, -12);
  if (same(await currentGeometry(page), manualBefore)) throw new Error("Curva criada manualmente não ficou editável.");
  report.desktop.manualCurveEditable = true;

  await installPiece(page, "duplicate", "top");
  await page.getByRole("button", { name: "Duplicar", exact: true }).click();
  await page.waitForTimeout(60);
  const duplicateHandles = await selectCurve(page, canvas);
  const duplicateBefore = await currentGeometry(page);
  await dragMouse(page, canvas, duplicateHandles[0], 20, -11);
  if (same(await currentGeometry(page), duplicateBefore)) throw new Error("Curva duplicada não ficou editável.");
  report.desktop.duplicatedCurveEditable = true;

  await installPiece(page, "mirror", "top");
  await page.getByRole("button", { name: "Espelhar no eixo vertical" }).click();
  await page.waitForTimeout(60);
  const mirrorHandles = await selectCurve(page, canvas);
  const mirrorBefore = await currentGeometry(page);
  await dragMouse(page, canvas, mirrorHandles[0], -20, 12);
  if (same(await currentGeometry(page), mirrorBefore)) throw new Error("Curva espelhada não ficou editável.");
  report.desktop.mirroredCurveEditable = true;
}

async function desktopCutAndJoin(page, canvas) {
  await installPiece(page, "cut", "left");
  await page.getByRole("button", { name: "Recortar" }).click();
  await canvas.click({ position: await localToScreen(page, { xMm: 70, yMm: 1 }) });
  await canvas.click({ position: await localToScreen(page, { xMm: 70, yMm: 109 }) });
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Aplicar corte" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Aplicar corte" }).click();
  await page.waitForTimeout(90);
  const curvedResult = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.points.some((point) => point.handleIn || point.handleOut));
    if (!piece) return null;
    useEditorStore.getState().selectPiece(piece.id);
    return piece.id;
  });
  if (!curvedResult) throw new Error("Recorte não preservou uma curva de contorno.");
  const cutHandles = await selectCurve(page, canvas);
  const cutBefore = await currentGeometry(page);
  await dragMouse(page, canvas, cutHandles[0], 20, -11);
  if (same(await currentGeometry(page), cutBefore)) throw new Error("Curva preservada após recorte não ficou editável.");
  report.desktop.cutPreservedCurveEditable = true;

  await page.evaluate(async () => {
    const [{ useEditorStore }, pattern, modeling] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/domain/modelingOperations.ts"),
    ]);
    const state = useEditorStore.getState();
    const make = (id, curved) => pattern.migrateLegacyPieceToSegments({
      id,
      name: id,
      seamAllowanceMm: 0,
      points: [
        { id: `${id}-a`, xMm: 0, yMm: 0, ...(curved ? { handleIn: { xMm: -20, yMm: 20 } } : {}) },
        { id: `${id}-b`, xMm: 100, yMm: 0 },
        { id: `${id}-c`, xMm: 100, yMm: 80 },
        { id: `${id}-d`, xMm: 0, yMm: 80, ...(curved ? { handleOut: { xMm: -20, yMm: -20 } } : {}) },
      ],
    });
    const first = make("join-left", true);
    const second = make("join-right", false);
    const garment = {
      ...structuredClone(state.garment),
      pieces: [first, second],
      seams: [],
      workspaceStates: [
        { pieceId: first.id, transform: { pieceId: first.id, xMm: 0, yMm: 0, rotationDeg: 0 }, visible: true, locked: false },
        { pieceId: second.id, transform: { pieceId: second.id, xMm: 200, yMm: 80, rotationDeg: 180 }, visible: true, locked: false },
      ],
      workspaceTransforms: [
        { pieceId: first.id, xMm: 0, yMm: 0, rotationDeg: 0 },
        { pieceId: second.id, xMm: 200, yMm: 80, rotationDeg: 180 },
      ],
    };
    const result = modeling.joinModelingPieces(garment, [first.id, second.id]);
    if (!result.ok) throw new Error(result.diagnostics.join(" | "));
    state.loadGarment(result.garment);
    useEditorStore.getState().selectPiece(result.activePieceId);
  });
  await page.waitForTimeout(80);
  const joinedCurve = await curveSample(page);
  if (!joinedCurve) throw new Error("União com curva não preservou curva editável.");
  const joinedHandles = await selectCurve(page, canvas);
  const joinedBefore = await currentGeometry(page);
  await dragMouse(page, canvas, joinedHandles[0], 18, -10);
  if (same(await currentGeometry(page), joinedBefore)) throw new Error("Curva preservada após união não ficou editável.");
  report.desktop.joinPreservedCurveEditable = true;
}

async function desktopInternalCubic(page, canvas) {
  await installPiece(page, "internal", "none");
  await page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/state/internalPathEditorStore.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) throw new Error("Peça interna ausente.");
    const path = {
      id: "internal-cubic",
      pieceId: piece.id,
      name: "Internal cubic",
      purpose: "reference",
      visible: true,
      locked: false,
      metadata: {},
      nodes: [
        { id: "ia", xMm: 30, yMm: 52, handleOut: { xMm: 24, yMm: -24 } },
        { id: "ib", xMm: 108, yMm: 58, handleIn: { xMm: -22, yMm: 22 } },
      ],
      segments: [{ id: "is", startNodeId: "ia", endNodeId: "ib", kind: "cubic" }],
    };
    useEditorStore.setState({ garment: { ...state.garment, pieces: state.garment.pieces.map((candidate) => candidate.id === piece.id ? { ...candidate, internalLines: [path] } : candidate) } });
    useInternalPathEditorStore.getState().reset();
  });
  const sample = await page.evaluate(async () => {
    const [{ useEditorStore }, { sampleInternalPath }] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/internalPaths.ts")]);
    const path = useEditorStore.getState().garment.pieces[0].internalLines[0];
    const samples = sampleInternalPath(path);
    const point = samples[Math.floor(samples.length / 2)];
    return { xMm: point.xMm, yMm: point.yMm };
  });
  await canvas.click({ position: await localToScreen(page, sample) });
  await page.waitForTimeout(60);
  const handles = await page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }, interaction] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/state/internalPathEditorStore.ts"), import("/src/editor/curveHandleInteraction.ts"),
    ]);
    const editor = useEditorStore.getState();
    const internal = useInternalPathEditorStore.getState();
    const path = editor.garment.pieces[0].internalLines[0];
    return interaction.internalCurveHandleTargets(path, internal.selectedNodeId, internal.selectedSegmentId).flatMap((target) => {
      const node = path.nodes.find((candidate) => candidate.id === target.nodeId);
      const vector = target.handle === "in" ? node?.handleIn : node?.handleOut;
      return node && vector ? [{ local: { xMm: node.xMm + vector.xMm, yMm: node.yMm + vector.yMm } }] : [];
    });
  });
  if (handles.length !== 2) throw new Error(`Curva interna selecionada expôs ${handles.length} handles.`);
  await page.screenshot({ path: `${artifactDir}/curve-internal-handles-desktop.png`, fullPage: true });
  const before = await page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].internalLines[0]));
  const position = await localToScreen(page, handles[0].local);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + position.x, box.y + position.y);
  await page.mouse.down();
  await page.mouse.move(box.x + position.x + 25, box.y + position.y - 14, { steps: 7 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const after = await page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].internalLines[0]));
  if (same(before, after)) throw new Error("Handle do caminho interno cúbico não alterou a curva.");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(50);
  const undo = await page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].internalLines[0]));
  if (!same(before, undo)) throw new Error("Undo do caminho interno não restaurou sua curva.");
  report.desktop.internalCubicEditable = true;
}

async function touchDrag(cdp, start, end) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x, y: start.y, radiusX: 7, radiusY: 7, force: 1 }] });
  for (let step = 1; step <= 7; step += 1) {
    const progress = step / 7;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress, radiusX: 7, radiusY: 7, force: 1 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function runDesktop() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await context.newPage();
  const canvas = page.locator("canvas.pattern-canvas");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await open(page);
  await desktopExistingAndHistory(page, canvas);
  await desktopSeamPriority(page, canvas);
  await desktopNumericAndOrigins(page, canvas);
  await desktopCutAndJoin(page, canvas);
  await desktopInternalCubic(page, canvas);
  if (errors.length) throw new Error(errors.join(" | "));
  await context.close();
}

async function runMobile() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const canvas = page.locator("canvas.pattern-canvas");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await open(page);
  await installPiece(page, "mobile", "top", { xMm: 42, yMm: 26, rotationDeg: 13 });
  const handles = await selectCurve(page, canvas, true);
  report.mobile.tapCurveShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-handles-mobile.png`, fullPage: true });
  const before = await currentGeometry(page);
  const workspaceBefore = await currentWorkspace(page);
  const target = handles.find((handle) => handle.handle === "out") ?? handles[0];
  const position = await localToScreen(page, target.local);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas mobile sem bounding box.");
  const start = { x: box.x + position.x + 16, y: box.y + position.y };
  const end = { x: start.x + 31, y: start.y - 14 };
  await touchDrag(cdp, start, end);
  await page.waitForTimeout(80);
  const after = await currentGeometry(page);
  if (same(before, after)) throw new Error("Área touch ampliada não arrastou o handle.");
  if (!same(workspaceBefore, await currentWorkspace(page))) throw new Error("Arraste touch do handle virou movimento da peça.");
  report.mobile.expandedHitAreaHandleDrag = report.mobile.noAccidentalPiecePan = true;
  await page.getByRole("button", { name: "Desfazer" }).tap();
  await page.waitForTimeout(50);
  if (!same(await currentGeometry(page), before)) throw new Error("Undo touch não restaurou a curva.");
  await page.getByRole("button", { name: "Refazer" }).tap();
  await page.waitForTimeout(50);
  if (!same(await currentGeometry(page), after)) throw new Error("Redo touch não reaplicou a curva.");
  report.mobile.undoRedoTouch = true;

  const stable = await currentGeometry(page);
  const zoomBefore = await page.locator(".zoom-indicator").textContent();
  const y = box.y + Math.max(45, box.height - 35);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: box.x + 90, y, radiusX: 7, radiusY: 7, force: 1 },
    { x: box.x + 185, y, radiusX: 7, radiusY: 7, force: 1 },
  ] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    { x: box.x + 70, y, radiusX: 7, radiusY: 7, force: 1 },
    { x: box.x + 207, y, radiusX: 7, radiusY: 7, force: 1 },
  ] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
  const zoomAfter = await page.locator(".zoom-indicator").textContent();
  if (zoomBefore === zoomAfter) throw new Error("Pinch fora do handle não alterou zoom.");
  if (!same(await currentGeometry(page), stable)) throw new Error("Pinch alterou geometria da curva.");
  report.mobile.pinchWorksAndPreservesGeometry = true;
  await page.screenshot({ path: `${artifactDir}/curve-handles-mobile-after-touch.png`, fullPage: true });
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
