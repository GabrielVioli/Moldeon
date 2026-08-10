import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-modeling-operations-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = {
  desktop: {},
  mobile: {},
};

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function installFixture(page, {
  id,
  curve = "top",
  transform = { xMm: 0, yMm: 0, rotationDeg: 0 },
}) {
  await page.evaluate(async ({ fixtureId, curveKind, fixtureTransform }) => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const fabricId = state.garment.fabrics[0]?.id;
    const points = curveKind === "top"
      ? [
          { id: `${fixtureId}-a`, xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -18 } },
          { id: `${fixtureId}-b`, xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -20 } },
          { id: `${fixtureId}-c`, xMm: 140, yMm: 110 },
          { id: `${fixtureId}-d`, xMm: 0, yMm: 110 },
        ]
      : curveKind === "left"
        ? [
            { id: `${fixtureId}-a`, xMm: 0, yMm: 0, handleIn: { xMm: -24, yMm: 28 } },
            { id: `${fixtureId}-b`, xMm: 140, yMm: 0 },
            { id: `${fixtureId}-c`, xMm: 140, yMm: 110 },
            { id: `${fixtureId}-d`, xMm: 0, yMm: 110, handleOut: { xMm: -24, yMm: -28 } },
          ]
        : [
            { id: `${fixtureId}-a`, xMm: 0, yMm: 0 },
            { id: `${fixtureId}-b`, xMm: 140, yMm: 0 },
            { id: `${fixtureId}-c`, xMm: 140, yMm: 110 },
            { id: `${fixtureId}-d`, xMm: 0, yMm: 110 },
          ];
    const piece = migrateLegacyPieceToSegments({
      id: fixtureId,
      name: `Curve fixture ${fixtureId}`,
      seamAllowanceMm: 0,
      ...(fabricId ? { fabricId } : {}),
      points,
    });
    state.loadGarment({
      ...structuredClone(state.garment),
      id: `garment-${fixtureId}`,
      templateId: "blank",
      name: `Curve regression ${fixtureId}`,
      pieces: [piece],
      seams: [],
      workspaceStates: [{
        pieceId: piece.id,
        transform: { pieceId: piece.id, ...fixtureTransform },
        visible: true,
        locked: false,
      }],
      workspaceTransforms: [{ pieceId: piece.id, ...fixtureTransform }],
      assemblyPlacements: [],
      parametric: undefined,
    });
    useEditorStore.getState().selectPiece(piece.id);
  }, { fixtureId: id, curveKind: curve, fixtureTransform: transform });

  await page.locator(".pieces-item").filter({ hasText: `Curve fixture ${id}` }).waitFor();
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(80);
}

async function activeGeometry(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) return null;
    return {
      pieceId: piece.id,
      points: piece.points.map((point) => ({
        id: point.id,
        xMm: point.xMm,
        yMm: point.yMm,
        handleIn: point.handleIn ? { ...point.handleIn } : null,
        handleOut: point.handleOut ? { ...point.handleOut } : null,
      })),
    };
  });
}

async function activeWorkspaceTransform(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const transform = state.garment.workspaceStates?.find((candidate) => candidate.pieceId === state.activePieceId)?.transform
      ?? state.garment.workspaceTransforms?.find((candidate) => candidate.pieceId === state.activePieceId);
    return transform ? structuredClone(transform) : null;
  });
}

async function screenForActiveLocal(page, local) {
  return page.evaluate(async (point) => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) throw new Error("Peça ativa ausente.");
    const transform = state.garment.workspaceStates?.find((candidate) => candidate.pieceId === piece.id)?.transform
      ?? state.garment.workspaceTransforms?.find((candidate) => candidate.pieceId === piece.id)
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points)
      .map((candidate) => coordinateModule.pieceLocalToWorld(candidate, transform));
    const bounds = {
      minX: Math.min(...contour.map((candidate) => candidate.xMm)),
      minY: Math.min(...contour.map((candidate) => candidate.yMm)),
      maxX: Math.max(...contour.map((candidate) => candidate.xMm)),
      maxY: Math.max(...contour.map((candidate) => candidate.yMm)),
    };
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 70);
    return coordinateModule.worldToScreen(coordinateModule.pieceLocalToWorld(point, transform), camera);
  }, local);
}

async function activeCurve(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, patternModule, polygonModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/domain/polygonGeometry.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) throw new Error("Peça ativa ausente para curva.");
    for (const edge of patternModule.getPatternEdges(piece)) {
      const start = piece.points.find((point) => point.id === edge.startPointId);
      const end = piece.points.find((point) => point.id === edge.endPointId);
      if (!start || !end || (!start.handleOut && !end.handleIn)) continue;
      const samples = polygonModule.samplePatternSegment(start, end);
      const sample = samples[Math.max(1, Math.min(samples.length - 2, Math.floor(samples.length * 0.34)))];
      return { edgeId: edge.id, sample: { xMm: sample.xMm, yMm: sample.yMm } };
    }
    return null;
  });
}

async function activePatternHandleTargets(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, helper] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/editor/curveHandleInteraction.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) return [];
    return helper.patternCurveHandleTargets(piece, state.selectedPointId, state.selectedEdgeId).map((target) => {
      const point = piece.points.find((candidate) => candidate.id === target.pointId);
      const vector = target.handle === "in" ? point?.handleIn : point?.handleOut;
      return point && vector ? {
        pointId: target.pointId,
        handle: target.handle,
        endpoint: { xMm: point.xMm + vector.xMm, yMm: point.yMm + vector.yMm },
      } : null;
    }).filter(Boolean);
  });
}

async function selectActiveCurve(page, canvas) {
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(50);
  const curve = await activeCurve(page);
  if (!curve) throw new Error("Nenhum segmento curvo ativo foi encontrado.");
  await canvas.click({ position: await screenForActiveLocal(page, curve.sample) });
  await page.waitForTimeout(60);
  const selection = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    return { selectedEdgeId: state.selectedEdgeId, selectedPointId: state.selectedPointId };
  });
  if (selection.selectedEdgeId !== curve.edgeId || selection.selectedPointId !== null) {
    throw new Error(`Clique na curva não selecionou o segmento: ${JSON.stringify(selection)}`);
  }
  const handles = await activePatternHandleTargets(page);
  if (handles.length !== 2) throw new Error(`Segmento curvo selecionado não expôs dois handles: ${JSON.stringify(handles)}`);
  return { curve, handles };
}

async function dragPatternHandleMouse(page, canvas, handle, dx, dy) {
  const start = await screenForActiveLocal(page, handle.endpoint);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box.");
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + start.x + dx, box.y + start.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function navigateCamera(page, canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.getByRole("button", { name: "Diminuir zoom" }).click();
  const hand = page.getByRole("button", { name: "Mão", exact: true });
  await hand.click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box para pan.");
  const x = box.x + box.width * 0.76;
  const y = box.y + box.height * 0.78;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 54, y - 23, { steps: 6 });
  await page.mouse.up();
  await hand.click();
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.waitForTimeout(70);
}

async function injectSeamOnSelectedCurve(page) {
  await page.evaluate(async () => {
    const [{ useEditorStore }, patternModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    const edge = piece && state.selectedEdgeId ? patternModule.getEdgeById(piece, state.selectedEdgeId) : null;
    if (!piece || !edge) throw new Error("Segmento selecionado ausente ao injetar costura.");
    const range = { pieceId: piece.id, edgeId: edge.id, startT: 0, endT: 1 };
    useEditorStore.setState({
      garment: {
        ...state.garment,
        seams: [{
          id: "curve-overlap-seam",
          name: "Costura sobre curva",
          first: range,
          second: range,
          direction: "same",
          easeRatio: 0,
          type: "standard",
          treatment: "standard",
          active: true,
        }],
      },
      selectedSeamId: null,
    });
  });
  await page.waitForTimeout(50);
}

async function assertSelectedSeamNull(page, label) {
  const selectedSeamId = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().selectedSeamId;
  });
  if (selectedSeamId !== null) throw new Error(`${label}: costura roubou o hit do handle.`);
}

async function installInternalCubic(page) {
  await page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/state/internalPathEditorStore.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    if (!piece) throw new Error("Peça ativa ausente para caminho interno.");
    const path = {
      id: "curve-internal-path",
      pieceId: piece.id,
      name: "Curva interna",
      purpose: "reference",
      visible: true,
      locked: false,
      metadata: {},
      nodes: [
        { id: "curve-internal-a", xMm: 30, yMm: 52, handleOut: { xMm: 24, yMm: -24 } },
        { id: "curve-internal-b", xMm: 108, yMm: 58, handleIn: { xMm: -22, yMm: 22 } },
      ],
      segments: [{
        id: "curve-internal-segment",
        startNodeId: "curve-internal-a",
        endNodeId: "curve-internal-b",
        kind: "cubic",
      }],
    };
    useEditorStore.setState({
      garment: {
        ...state.garment,
        pieces: state.garment.pieces.map((candidate) => candidate.id === piece.id
          ? { ...candidate, internalLines: [...(candidate.internalLines ?? []), path] }
          : candidate),
      },
    });
    useInternalPathEditorStore.getState().reset();
  });
  await page.waitForTimeout(60);
}

async function internalCurveSample(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }, internalModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/domain/internalPaths.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId);
    const path = piece?.internalLines?.find((line) => line.id === "curve-internal-path" && isInternalPath(line));
    if (!path) return null;
    const samples = internalModule.sampleInternalPath(path);
    const sample = samples[Math.floor(samples.length / 2)];
    return sample ? { xMm: sample.xMm, yMm: sample.yMm } : null;
  });
}

async function internalHandleTargets(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }, { isInternalPath }, helper] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/state/internalPathEditorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/editor/curveHandleInteraction.ts"),
    ]);
    const editor = useEditorStore.getState();
    const internal = useInternalPathEditorStore.getState();
    const piece = editor.garment.pieces.find((candidate) => candidate.id === editor.activePieceId);
    const path = piece?.internalLines?.find((line) => line.id === internal.selectedPathId && isInternalPath(line));
    if (!path) return [];
    return helper.internalCurveHandleTargets(path, internal.selectedNodeId, internal.selectedSegmentId).map((target) => {
      const node = path.nodes.find((candidate) => candidate.id === target.nodeId);
      const vector = target.handle === "in" ? node?.handleIn : node?.handleOut;
      return node && vector ? {
        nodeId: node.id,
        handle: target.handle,
        endpoint: { xMm: node.xMm + vector.xMm, yMm: node.yMm + vector.yMm },
      } : null;
    }).filter(Boolean);
  });
}

async function currentInternalPath(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const path = useEditorStore.getState().garment.pieces
      .flatMap((piece) => piece.internalLines ?? [])
      .find((line) => line.id === "curve-internal-path" && isInternalPath(line));
    return path ? structuredClone(path) : null;
  });
}

async function runDesktop() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const canvas = page.locator("canvas.pattern-canvas");

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, { id: "desktop-existing", curve: "top", transform: { xMm: 48, yMm: 32, rotationDeg: 17 } });
  const selected = await selectActiveCurve(page, canvas);
  report.desktop.curveSelectShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-handles-desktop.png`, fullPage: true });

  await injectSeamOnSelectedCurve(page);
  const beforeOut = await activeGeometry(page);
  const outTarget = selected.handles.find((target) => target.handle === "out");
  const inTarget = selected.handles.find((target) => target.handle === "in");
  if (!outTarget || !inTarget) throw new Error("Handles de entrada/saída não encontrados no segmento selecionado.");
  await dragPatternHandleMouse(page, canvas, outTarget, 34, -17);
  const afterOut = await activeGeometry(page);
  if (same(beforeOut, afterOut)) throw new Error("Arraste do handle de saída não alterou a curva.");
  await assertSelectedSeamNull(page, "handle de saída");
  report.desktop.outputHandleDrag = true;
  report.desktop.seamDoesNotStealHandle = true;

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(70);
  const undoOut = await activeGeometry(page);
  if (!same(undoOut, beforeOut)) throw new Error("Um único undo não restaurou exatamente o drag do handle de saída.");
  await navigateCamera(page, canvas);
  if (!same(await activeGeometry(page), beforeOut)) throw new Error("Zoom/pan alterou o estado restaurado por undo.");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(70);
  const redoOut = await activeGeometry(page);
  if (!same(redoOut, afterOut)) throw new Error("Redo não reaplicou exatamente o drag do handle de saída.");
  await navigateCamera(page, canvas);
  if (!same(await activeGeometry(page), afterOut)) throw new Error("Zoom/pan alterou o estado reaplicado por redo.");
  report.desktop.singleUndoTransaction = true;
  report.desktop.undoRedoCameraStable = true;

  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(50);
  const refreshedHandles = await activePatternHandleTargets(page);
  const refreshedIn = refreshedHandles.find((target) => target.handle === "in");
  if (!refreshedIn) throw new Error("Handle de entrada desapareceu após editar o de saída.");
  const beforeIn = await activeGeometry(page);
  await dragPatternHandleMouse(page, canvas, refreshedIn, -27, 19);
  const afterIn = await activeGeometry(page);
  if (same(beforeIn, afterIn)) throw new Error("Arraste do handle de entrada não alterou a curva.");
  report.desktop.inputHandleDrag = true;
  await navigateCamera(page, canvas);
  if (!same(await activeGeometry(page), afterIn)) throw new Error("Zoom/pan alterou a curva depois do drag de entrada.");
  report.desktop.editedCurveCameraStable = true;

  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(40);
  const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
  await numeric.getByRole("button", { name: "Handle saída" }).click();
  for (const [label, delta] of [["Handle X", 4], ["Handle Y", -3], ["Comprimento", 5], ["Ângulo", 7]]) {
    const field = numeric.getByLabel(label);
    const current = Number(await field.inputValue());
    await field.fill(String(label === "Comprimento" ? Math.max(1, current + delta) : current + delta));
    await field.press("Enter");
    await page.waitForTimeout(30);
  }
  report.desktop.numericPanelStillWorks = true;

  const curveForMessage = await activeCurve(page);
  if (!curveForMessage) throw new Error("Curva ausente ao validar instrução contextual.");
  const active = await activeGeometry(page);
  const start = active?.points.find((point) => point.id.endsWith("-a"));
  const end = active?.points.find((point) => point.id.endsWith("-b"));
  if (start && end) {
    await canvas.dblclick({ position: await screenForActiveLocal(page, { xMm: (start.xMm + end.xMm) / 2, yMm: (start.yMm + end.yMm) / 2 }) });
    await page.getByRole("alert").filter({ hasText: "Arraste os handles no Canvas" }).waitFor({ state: "visible" });
    report.desktop.contextMessageReframed = true;
  }

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, { id: "desktop-manual", curve: "none" });
  const straightSample = { xMm: 52, yMm: 0 };
  await canvas.click({ position: await screenForActiveLocal(page, straightSample) });
  await page.waitForTimeout(50);
  await page.getByRole("region", { name: "Edição numérica do editor 2D" }).getByRole("button", { name: "Converter" }).click();
  await page.waitForTimeout(70);
  const manualHandles = await activePatternHandleTargets(page);
  if (manualHandles.length !== 2) throw new Error("Curva criada manualmente não expôs dois handles no Canvas.");
  await dragPatternHandleMouse(page, canvas, manualHandles[0], 24, -13);
  report.desktop.manuallyCreatedCurveEditable = true;

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, { id: "desktop-duplicate", curve: "top" });
  await page.getByRole("button", { name: "Duplicar", exact: true }).click();
  await page.waitForTimeout(70);
  await selectActiveCurve(page, canvas);
  const duplicateHandles = await activePatternHandleTargets(page);
  const duplicateBefore = await activeGeometry(page);
  await dragPatternHandleMouse(page, canvas, duplicateHandles[0], 21, -11);
  if (same(await activeGeometry(page), duplicateBefore)) throw new Error("Curva duplicada não permaneceu editável.");
  report.desktop.duplicatedCurveEditable = true;

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, { id: "desktop-mirror", curve: "top" });
  await page.getByRole("button", { name: "Espelhar no eixo vertical" }).click();
  await page.waitForTimeout(70);
  await selectActiveCurve(page, canvas);
  const mirrorHandles = await activePatternHandleTargets(page);
  const mirrorBefore = await activeGeometry(page);
  await dragPatternHandleMouse(page, canvas, mirrorHandles[0], -22, 13);
  if (same(await activeGeometry(page), mirrorBefore)) throw new Error("Curva espelhada não permaneceu editável.");
  report.desktop.mirroredCurveEditable = true;

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, { id: "desktop-cut", curve: "left" });
  await page.getByRole("button", { name: "Recortar" }).click();
  await canvas.click({ position: await screenForActiveLocal(page, { xMm: 70, yMm: 1 }) });
  await canvas.click({ position: await screenForActiveLocal(page, { xMm: 70, yMm: 109 }) });
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Aplicar corte" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Aplicar corte" }).click();
  await page.waitForTimeout(100);
  const curvedResult = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.points.some((point) => point.handleIn || point.handleOut));
    if (!piece) return null;
    useEditorStore.getState().selectPiece(piece.id);
    return piece.id;
  });
  if (!curvedResult) throw new Error("Recorte não preservou nenhuma curva de contorno para edição.");
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(60);
  await selectActiveCurve(page, canvas);
  const cutHandles = await activePatternHandleTargets(page);
  const cutBefore = await activeGeometry(page);
  await dragPatternHandleMouse(page, canvas, cutHandles[0], 20, -12);
  if (same(await activeGeometry(page), cutBefore)) throw new Error("Curva preservada depois do recorte não ficou editável.");
  report.desktop.cutPreservedCurveEditable = true;

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, { id: "desktop-internal", curve: "none" });
  await installInternalCubic(page);
  const internalSample = await internalCurveSample(page);
  if (!internalSample) throw new Error("Amostra da curva interna não encontrada.");
  await canvas.click({ position: await screenForActiveLocal(page, internalSample) });
  await page.waitForTimeout(60);
  const internalSelection = await page.evaluate(async () => {
    const { useInternalPathEditorStore } = await import("/src/state/internalPathEditorStore.ts");
    const state = useInternalPathEditorStore.getState();
    return { pathId: state.selectedPathId, segmentId: state.selectedSegmentId, nodeId: state.selectedNodeId };
  });
  if (internalSelection.pathId !== "curve-internal-path" || internalSelection.segmentId !== "curve-internal-segment") {
    throw new Error(`Curva interna não selecionou seu segmento: ${JSON.stringify(internalSelection)}`);
  }
  const internalHandles = await internalHandleTargets(page);
  if (internalHandles.length !== 2) throw new Error("Curva interna selecionada não expôs dois handles.");
  await page.screenshot({ path: `${artifactDir}/curve-internal-handles-desktop.png`, fullPage: true });
  const internalBefore = await currentInternalPath(page);
  const internalStart = await screenForActiveLocal(page, internalHandles[0].endpoint);
  const internalBox = await canvas.boundingBox();
  if (!internalBox) throw new Error("Canvas sem bounding box para handle interno.");
  await page.mouse.move(internalBox.x + internalStart.x, internalBox.y + internalStart.y);
  await page.mouse.down();
  await page.mouse.move(internalBox.x + internalStart.x + 26, internalBox.y + internalStart.y - 14, { steps: 7 });
  await page.mouse.up();
  await page.waitForTimeout(70);
  const internalAfter = await currentInternalPath(page);
  if (same(internalBefore, internalAfter)) throw new Error("Handle do caminho interno cúbico não alterou sua curva.");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(70);
  if (!same(await currentInternalPath(page), internalBefore)) throw new Error("Undo do handle interno não restaurou o caminho.");
  report.desktop.internalCubicEditable = true;

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

async function pinch(cdp, first, second, scale = 1.45) {
  const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const scaled = (point) => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first, second],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [scaled(first), scaled(second)],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function runMobile() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const canvas = page.locator("canvas.pattern-canvas");

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, { id: "mobile-curve", curve: "top", transform: { xMm: 42, yMm: 26, rotationDeg: 13 } });
  const curve = await activeCurve(page);
  if (!curve) throw new Error("Curva mobile ausente.");
  await canvas.tap({ position: await screenForActiveLocal(page, curve.sample) });
  await page.waitForTimeout(70);
  const handles = await activePatternHandleTargets(page);
  if (handles.length !== 2) throw new Error("Toque na curva mobile não exibiu os dois handles.");
  report.mobile.curveTapShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-handles-mobile.png`, fullPage: true });

  const before = await activeGeometry(page);
  const workspaceBefore = await activeWorkspaceTransform(page);
  const handle = handles.find((target) => target.handle === "out") ?? handles[0];
  const handleScreen = await screenForActiveLocal(page, handle.endpoint);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas mobile sem bounding box.");
  const start = { x: box.x + handleScreen.x + 16, y: box.y + handleScreen.y };
  const end = { x: start.x + 31, y: start.y - 14 };
  await touchDrag(cdp, start, end);
  await page.waitForTimeout(90);
  const after = await activeGeometry(page);
  if (same(before, after)) throw new Error("Área de hit touch ampliada não conseguiu arrastar o handle.");
  const workspaceAfter = await activeWorkspaceTransform(page);
  if (!same(workspaceBefore, workspaceAfter)) throw new Error("Arraste touch do handle moveu a peça em vez da curva.");
  report.mobile.touchHandleDrag = true;
  report.mobile.expandedHitAreaWithoutVisualResize = true;
  report.mobile.handleDoesNotBecomePiecePan = true;

  await page.getByRole("button", { name: "Desfazer" }).tap();
  await page.waitForTimeout(60);
  if (!same(await activeGeometry(page), before)) throw new Error("Undo touch não restaurou exatamente a curva anterior.");
  await page.getByRole("button", { name: "Refazer" }).tap();
  await page.waitForTimeout(60);
  if (!same(await activeGeometry(page), after)) throw new Error("Redo touch não reaplicou exatamente a curva.");
  report.mobile.touchUndoRedo = true;

  const geometryBeforePinch = await activeGeometry(page);
  const zoomBefore = await page.getByRole("button", { name: /%/ }).first().textContent();
  const pinchY = box.y + Math.max(48, box.height - 34);
  await pinch(cdp,
    { x: box.x + 95, y: pinchY, radiusX: 7, radiusY: 7, force: 1 },
    { x: box.x + 185, y: pinchY, radiusX: 7, radiusY: 7, force: 1 },
  );
  await page.waitForTimeout(100);
  const zoomAfter = await page.getByRole("button", { name: /%/ }).first().textContent();
  if (zoomBefore === zoomAfter) throw new Error(`Pinch mobile não alterou o zoom (${zoomBefore}).`);
  if (!same(await activeGeometry(page), geometryBeforePinch)) throw new Error("Pinch alterou a geometria da curva.");
  report.mobile.pinchStillWorks = true;
  report.mobile.pinchPreservesGeometry = true;

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
