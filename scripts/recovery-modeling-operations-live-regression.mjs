import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-modeling-operations-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1366, height: 820 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

async function installFixture(id, transform = { xMm: 0, yMm: 0, rotationDeg: 0 }) {
  await page.evaluate(async ({ fixtureId, fixtureTransform }) => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const fabricId = state.garment.fabrics[0]?.id;
    const piece = migrateLegacyPieceToSegments({
      id: fixtureId,
      name: `Fixture ${fixtureId}`,
      seamAllowanceMm: 10,
      ...(fabricId ? { fabricId } : {}),
      points: [
        { id: `${fixtureId}-a`, xMm: 0, yMm: 0 },
        { id: `${fixtureId}-b`, xMm: 120, yMm: 0 },
        { id: `${fixtureId}-c`, xMm: 120, yMm: 100 },
        { id: `${fixtureId}-d`, xMm: 0, yMm: 100 },
      ],
    });
    state.loadGarment({
      ...structuredClone(state.garment),
      id: `garment-${fixtureId}`,
      templateId: "blank",
      name: `Recovery 9.5-05 ${fixtureId}`,
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
  }, { fixtureId: id, fixtureTransform: transform });
  await page.locator(".pieces-item").filter({ hasText: `Fixture ${id}` }).waitFor();
  await page.getByRole("button", { name: "Enquadrar tudo" }).click();
  await page.waitForTimeout(80);
}

async function screenForLocal(local) {
  return page.evaluate(async (point) => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId) ?? state.garment.pieces[0];
    const transform = state.garment.workspaceStates?.find((candidate) => candidate.pieceId === piece.id)?.transform
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas não encontrado.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points).map((candidate) => coordinateModule.pieceLocalToWorld(candidate, transform));
    const bounds = {
      minX: Math.min(...contour.map((candidate) => candidate.xMm)),
      minY: Math.min(...contour.map((candidate) => candidate.yMm)),
      maxX: Math.max(...contour.map((candidate) => candidate.xMm)),
      maxY: Math.max(...contour.map((candidate) => candidate.yMm)),
    };
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    return coordinateModule.worldToScreen(coordinateModule.pieceLocalToWorld(point, transform), camera);
  }, local);
}

async function currentInternalPath() {
  return page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }, { isInternalPath }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/state/internalPathEditorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const selectedPathId = useInternalPathEditorStore.getState().selectedPathId;
    const path = useEditorStore.getState().garment.pieces
      .flatMap((piece) => piece.internalLines ?? [])
      .find((line) => line.id === selectedPathId && isInternalPath(line));
    return path ? structuredClone(path) : null;
  });
}

async function currentPieceCount() {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces.length;
  });
}

async function navigateCamera(canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.getByRole("button", { name: "Aumentar zoom" }).click();
  await page.getByRole("button", { name: "Diminuir zoom" }).click();
  const hand = page.getByRole("button", { name: "Mão", exact: true });
  await hand.click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box para pan.");
  const x = box.x + box.width * 0.65;
  const y = box.y + box.height * 0.72;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 78, y - 36, { steps: 8 });
  await page.mouse.up();
  await hand.click();
  await page.waitForTimeout(80);
}

async function assertPathUnchanged(expected, label) {
  const actual = await currentInternalPath();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: zoom/pan alterou o caminho interno ou suas referências topológicas.`);
  }
}

async function resetPage() {
  await page.goto(baseURL, { waitUntil: "networkidle" });
}

try {
  await resetPage();
  await installFixture("v-cut", { xMm: 135, yMm: 72, rotationDeg: 27 });
  const canvas = page.locator("canvas.pattern-canvas");
  await page.getByRole("button", { name: "Recortar" }).click();
  await canvas.click({ position: await screenForLocal({ xMm: 20, yMm: 3 }) });
  await canvas.click({ position: await screenForLocal({ xMm: 58, yMm: 58 }) });
  await canvas.click({ position: await screenForLocal({ xMm: 96, yMm: 4 }) });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);

  const vPath = await currentInternalPath();
  if (!vPath) throw new Error("O V de corte não foi confirmado no fluxo real do Canvas.");
  if (Math.abs(vPath.nodes[0].yMm) > 0.01 || Math.abs(vPath.nodes.at(-1).yMm) > 0.01) {
    throw new Error("As extremidades do V não fizeram snapping real ao contorno.");
  }
  if (typeof vPath.metadata.cutStartEdgeId !== "string" || typeof vPath.metadata.cutStartT !== "number"
      || typeof vPath.metadata.cutEndEdgeId !== "string" || typeof vPath.metadata.cutEndT !== "number") {
    throw new Error("O V não persistiu segmentId+t nas duas extremidades.");
  }
  const liveAnalysis = await page.evaluate(async () => {
    const { useInternalPathEditorStore } = await import("/src/state/internalPathEditorStore.ts");
    return structuredClone(useInternalPathEditorStore.getState().analysis);
  });
  if (!liveAnalysis?.valid || liveAnalysis.intersections.length !== 2) {
    throw new Error(`V válido rejeitado: ${JSON.stringify(liveAnalysis)}`);
  }
  await page.getByLabel("Prévia das duas regiões do corte").waitFor({ state: "visible" });

  await navigateCamera(canvas);
  await assertPathUnchanged(vPath, "V transformado");
  const analysisAfterCamera = await page.evaluate(async () => {
    const { useInternalPathEditorStore } = await import("/src/state/internalPathEditorStore.ts");
    return useInternalPathEditorStore.getState().analysis;
  });
  if (!analysisAfterCamera?.valid) throw new Error("Zoom/pan invalidou o V ancorado.");

  await page.getByRole("button", { name: "Aplicar corte" }).click();
  await page.waitForTimeout(100);
  if (await currentPieceCount() !== 2) throw new Error("Aplicar V não gerou exatamente duas peças.");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(80);
  if (await currentPieceCount() !== 1) throw new Error("Undo do V não restaurou a peça única.");
  const restoredPath = await currentInternalPath();
  if (!restoredPath || restoredPath.id !== vPath.id) throw new Error("Undo do V não restaurou o caminho aplicado.");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(80);
  if (await currentPieceCount() !== 2) throw new Error("Redo do V não reaplicou o corte.");

  await resetPage();
  await installFixture("dart", { xMm: 55, yMm: 30, rotationDeg: -18 });
  const dartCanvas = page.locator("canvas.pattern-canvas");
  await page.getByRole("button", { name: "Pence" }).click();
  await dartCanvas.click({ position: await screenForLocal({ xMm: 60, yMm: 1 }) });
  await dartCanvas.click({ position: await screenForLocal({ xMm: 60, yMm: 54 }) });
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Fechar pence" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Fechar pence" }).click();
  await page.waitForTimeout(100);
  const dartState = await page.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"),
    ]);
    const piece = useEditorStore.getState().garment.pieces[0];
    const dart = piece.darts?.[0];
    const path = (piece.internalLines ?? []).find((line) => dart?.pathId === line.id && isInternalPath(line));
    return { dart: structuredClone(dart), path: path ? structuredClone(path) : null };
  });
  if (dartState.dart?.closure?.kind !== "paired-legs" || dartState.dart?.closure?.state !== "closed") {
    throw new Error("Fechar pence não criou relação estrutural paired-legs.");
  }
  if (dartState.path?.segments?.length !== 3 || dartState.path?.nodes?.length !== 4) {
    throw new Error("A pence fechada foi reduzida a uma linha decorativa.");
  }
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(60);
  const afterDartUndo = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces[0].darts?.length ?? 0;
  });
  if (afterDartUndo !== 0) throw new Error("Undo da pence não restaurou a geometria anterior.");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(60);
  const afterDartRedo = await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces[0].darts?.[0]?.closure?.state;
  });
  if (afterDartRedo !== "closed") throw new Error("Redo da pence não reaplicou o fechamento estrutural.");

  await resetPage();
  await installFixture("pleat");
  const depth = page.getByLabel("Profundidade da prega");
  const direction = page.getByLabel("Direção da prega");
  await depth.fill("28");
  await direction.fill("90");
  await page.getByLabel("Sentido da prega").selectOption("outward");
  await page.getByRole("button", { name: "Criar prega simples" }).click();
  await page.waitForTimeout(80);
  const pleatState = await page.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"),
    ]);
    return (useEditorStore.getState().garment.pieces[0].internalLines ?? [])
      .filter(isInternalPath)
      .filter((path) => path.metadata.pleatId)
      .map((path) => structuredClone(path.metadata));
  });
  if (pleatState.length !== 2 || pleatState.some((metadata) => metadata.pleatDepthMm !== 28 || metadata.pleatConsumptionMm !== 56 || metadata.pleatSense !== "outward")) {
    throw new Error(`Prega simples não persistiu duas dobras/consumo: ${JSON.stringify(pleatState)}`);
  }
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(60);
  const pleatAfterUndo = await page.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"),
    ]);
    return (useEditorStore.getState().garment.pieces[0].internalLines ?? []).filter(isInternalPath).filter((path) => path.metadata.pleatId).length;
  });
  if (pleatAfterUndo !== 0) throw new Error("Undo da prega não removeu as duas linhas de dobra.");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(60);
  const pleatAfterRedo = await page.evaluate(async () => {
    const [{ useEditorStore }, { isInternalPath }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"),
    ]);
    return (useEditorStore.getState().garment.pieces[0].internalLines ?? []).filter(isInternalPath).filter((path) => path.metadata.pleatId).length;
  });
  if (pleatAfterRedo !== 2) throw new Error("Redo da prega não restaurou as duas linhas de dobra.");

  await page.screenshot({ path: `${artifactDir}/modeling-operations-live.png`, fullPage: true });
  if (errors.length) throw new Error(errors.join(" | "));
  console.log(JSON.stringify({
    vCutOnTransformedPiece: true,
    endpointAnchors: true,
    cutPreview: true,
    zoomPanPreservesCut: true,
    cutUndoRedo: true,
    structuralDart: true,
    dartUndoRedo: true,
    simplePleat: true,
    pleatUndoRedo: true,
  }));
} finally {
  await browser.close();
}
