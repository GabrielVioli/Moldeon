import { chromium } from "playwright";
import { createHash } from "node:crypto";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const result = { errors: [], console: [] };
page.on("pageerror", (error) => result.errors.push(error.message));
page.on("console", (message) => {
  if (["warning", "error"].includes(message.type())) result.console.push({ type: message.type(), text: message.text() });
});

try {
  await page.goto(process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4173", { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByRole("button", { name: /Camiseta b.sica/i }).first().click();
  await page.getByRole("button", { name: "Criar molde", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15_000 });
  await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
  await page.getByRole("button", { name: /Vestir no manequim/i }).click();
  await page.locator("canvas.three-canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(600);

  const canvas3d = page.locator("canvas.three-canvas");
  const beforeHash = hash(await canvas3d.screenshot());
  const target = await page.evaluate(async () => {
    const [storeModule, polygonModule, cameraModule, coordinateModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/polygonGeometry.ts"),
      import("/src/editor/camera.ts"),
      import("/src/editor/coordinates.ts"),
    ]);
    const state = storeModule.useEditorStore.getState();
    const active = state.garment.pieces.find((piece) => piece.id === state.activePieceId) ?? state.garment.pieces[0];
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!active || !(canvas instanceof HTMLCanvasElement)) throw new Error("Peça ativa ou canvas 2D indisponível.");
    const workspaceFor = (piece) => state.garment.workspaceStates?.find((candidate) => candidate.pieceId === piece.id)
      ?? { visible: true, transform: state.garment.workspaceTransforms?.find((candidate) => candidate.pieceId === piece.id) ?? { pieceId: piece.id, xMm: 0, yMm: 0, rotationDeg: 0 } };
    const all = [];
    for (const piece of state.garment.pieces) {
      const workspace = workspaceFor(piece);
      if (workspace.visible === false) continue;
      const allowance = Math.max(0, piece.seamAllowanceMm ?? 0);
      for (const local of polygonModule.samplePatternContour(piece.points)) {
        const world = coordinateModule.pieceLocalToWorld(local, workspace.transform);
        all.push({ xMm: world.xMm - allowance, yMm: world.yMm - allowance });
        all.push({ xMm: world.xMm + allowance, yMm: world.yMm + allowance });
      }
    }
    const bounds = {
      minX: Math.min(...all.map((point) => point.xMm)), minY: Math.min(...all.map((point) => point.yMm)),
      maxX: Math.max(...all.map((point) => point.xMm)), maxY: Math.max(...all.map((point) => point.yMm)),
    };
    const rect = canvas.getBoundingClientRect();
    const camera = cameraModule.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 54);
    const point = active.points[0];
    const world = coordinateModule.pieceLocalToWorld(point, workspaceFor(active).transform);
    const screen = coordinateModule.worldToScreen(world, camera);
    return {
      x: rect.left + screen.x,
      y: rect.top + screen.y,
      pieceId: active.id,
      pointId: point.id,
      before: { xMm: point.xMm, yMm: point.yMm },
      simulateVersion: state.simulateVersion,
    };
  });

  const started = performance.now();
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 32, target.y + 18, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const latencyMs = Math.round(performance.now() - started);
  const after = await page.evaluate(async ({ pieceId, pointId }) => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const point = state.garment.pieces.find((piece) => piece.id === pieceId)?.points.find((candidate) => candidate.id === pointId);
    return { point: point ? { xMm: point.xMm, yMm: point.yMm } : null, simulateVersion: state.simulateVersion };
  }, target);
  const afterHash = hash(await canvas3d.screenshot());
  result.directManipulation = {
    target,
    after,
    pointChanged: Boolean(after.point && (after.point.xMm !== target.before.xMm || after.point.yMm !== target.before.yMm)),
    threeVisualChanged: beforeHash !== afterHash,
    latencyMs,
  };

  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await page.waitForTimeout(400);
  const undone = await page.evaluate(async ({ pieceId, pointId }) => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const state = useEditorStore.getState();
    const point = state.garment.pieces.find((piece) => piece.id === pieceId)?.points.find((candidate) => candidate.id === pointId);
    return point ? { xMm: point.xMm, yMm: point.yMm } : null;
  }, target);
  result.directManipulation.undoRestored = Boolean(undone && undone.xMm === target.before.xMm && undone.yMm === target.before.yMm);
  result.directManipulation.undone = undone;
} finally {
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
