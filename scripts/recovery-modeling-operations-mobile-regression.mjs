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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

async function resetPage() {
  await page.goto(baseURL, { waitUntil: "networkidle" });
}

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
  await page.getByRole("button", { name: "Enquadrar tudo" }).tap();
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
    const piece = state.garment.pieces.find((candidate) => candidate.id === state.activePieceId)
      ?? state.garment.pieces[0];
    if (!piece) throw new Error("Peça ativa não encontrada no teste mobile.");
    const transform = state.garment.workspaceStates?.find((candidate) => candidate.pieceId === piece.id)?.transform
      ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas não encontrado.");
    const rect = canvas.getBoundingClientRect();
    const contour = polygonModule.samplePatternContour(piece.points)
      .map((candidate) => coordinateModule.pieceLocalToWorld(candidate, transform));
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

async function pieceCount() {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    return useEditorStore.getState().garment.pieces.length;
  });
}

async function selectedPath() {
  return page.evaluate(async () => {
    const [{ useEditorStore }, { useInternalPathEditorStore }, { isInternalPath }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/state/internalPathEditorStore.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const pathId = useInternalPathEditorStore.getState().selectedPathId;
    const paths = useEditorStore.getState().garment.pieces
      .flatMap((piece) => piece.internalLines ?? [])
      .filter(isInternalPath);
    const path = paths.find((line) => line.id === pathId) ?? paths.at(-1);
    return path ? structuredClone(path) : null;
  });
}

async function assertNoViewportOverflow(label) {
  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    canvasCount: document.querySelectorAll("canvas.pattern-canvas").length,
    canvasRect: (() => {
      const canvas = document.querySelector("canvas.pattern-canvas");
      return canvas instanceof HTMLCanvasElement
        ? { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height }
        : null;
    })(),
  }));
  if (layout.scrollWidth > layout.innerWidth + 1) {
    throw new Error(`${label}: overflow horizontal mobile (${layout.scrollWidth}px > ${layout.innerWidth}px).`);
  }
  if (layout.canvasCount !== 1) throw new Error(`${label}: esperado exatamente um Canvas, obtido ${layout.canvasCount}.`);
  if (!layout.canvasRect || layout.canvasRect.width <= 0 || layout.canvasRect.height <= 0) {
    throw new Error(`${label}: Canvas mobile não está visível: ${JSON.stringify(layout.canvasRect)}.`);
  }
  return layout;
}

try {
  await resetPage();
  await installFixture("mobile-duplicate");
  const initialLayout = await assertNoViewportOverflow("estado inicial");

  await page.getByRole("button", { name: "Duplicar", exact: true }).tap();
  await page.waitForTimeout(80);
  if (await pieceCount() !== 2) throw new Error("Duplicar por toque não gerou duas peças no mobile.");

  await page.getByRole("button", { name: "Desfazer" }).tap();
  await page.waitForTimeout(60);
  if (await pieceCount() !== 1) throw new Error("Undo por toque não restaurou uma peça no mobile.");
  await page.getByRole("button", { name: "Refazer" }).tap();
  await page.waitForTimeout(60);
  if (await pieceCount() !== 2) throw new Error("Redo por toque não restaurou a duplicação no mobile.");

  await resetPage();
  await installFixture("mobile-v-cut", { xMm: 82, yMm: 46, rotationDeg: 19 });
  await assertNoViewportOverflow("antes do V");

  const canvas = page.locator("canvas.pattern-canvas");
  await page.getByRole("button", { name: "Recortar" }).tap();
  await canvas.tap({ position: await screenForLocal({ xMm: 20, yMm: 3 }) });
  await canvas.tap({ position: await screenForLocal({ xMm: 58, yMm: 58 }) });
  await canvas.tap({ position: await screenForLocal({ xMm: 96, yMm: 4 }) });
  await page.getByRole("button", { name: "Concluir caminho" }).tap();
  await page.waitForTimeout(100);

  const vPath = await selectedPath();
  if (!vPath) throw new Error("O V de corte não foi confirmado por toque no mobile.");
  if (Math.abs(vPath.nodes[0].yMm) > 0.01 || Math.abs(vPath.nodes.at(-1).yMm) > 0.01) {
    throw new Error("As extremidades do V mobile não fizeram snapping real ao contorno.");
  }
  if (typeof vPath.metadata.cutStartEdgeId !== "string" || typeof vPath.metadata.cutStartT !== "number"
      || typeof vPath.metadata.cutEndEdgeId !== "string" || typeof vPath.metadata.cutEndT !== "number") {
    throw new Error("O V mobile não persistiu segmentId+t nas duas extremidades.");
  }

  await page.getByLabel("Prévia das duas regiões do corte").waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Aumentar zoom" }).tap();
  await page.getByRole("button", { name: "Aumentar zoom" }).tap();
  await page.getByRole("button", { name: "Diminuir zoom" }).tap();
  await page.waitForTimeout(80);
  const afterZoom = await selectedPath();
  if (JSON.stringify(afterZoom) !== JSON.stringify(vPath)) {
    throw new Error("Zoom por toque alterou a geometria ou as referências topológicas do V no mobile.");
  }

  await page.getByRole("button", { name: "Aplicar corte" }).tap();
  await page.waitForTimeout(100);
  if (await pieceCount() !== 2) throw new Error("Aplicar V por toque não gerou exatamente duas peças no mobile.");

  await page.getByRole("button", { name: "Desfazer" }).tap();
  await page.waitForTimeout(60);
  if (await pieceCount() !== 1) throw new Error("Undo do recorte mobile não restaurou a peça única.");
  await page.getByRole("button", { name: "Refazer" }).tap();
  await page.waitForTimeout(60);
  if (await pieceCount() !== 2) throw new Error("Redo do recorte mobile não reaplicou o corte.");

  const finalLayout = await assertNoViewportOverflow("depois do V");
  await page.screenshot({ path: `${artifactDir}/modeling-operations-mobile.png`, fullPage: true });

  if (errors.length) throw new Error(errors.join(" | "));
  console.log(JSON.stringify({
    viewport: "390x844",
    touchEnabled: true,
    noHorizontalOverflow: true,
    singleCanvas: true,
    canvasInitial: initialLayout.canvasRect,
    canvasFinal: finalLayout.canvasRect,
    duplicateTouch: true,
    duplicateUndoRedoTouch: true,
    vCutTouch: true,
    endpointAnchorsTouch: true,
    cutPreviewMobile: true,
    zoomTouchPreservesCut: true,
    cutUndoRedoTouch: true,
  }));
} finally {
  await browser.close();
}
