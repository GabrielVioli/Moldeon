import fs from "node:fs";
import { chromium } from "playwright-core";

const executablePath = process.env.MOLDEON_CHROME
  ?? [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error("CHROMIUM_EXECUTABLE_NOT_FOUND");

const baseURL = process.env.MOLDEON_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.stack ?? error.message));
page.on("dialog", (dialog) => dialog.accept("Painel browser 11.0.7"));

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.reload({ waitUntil: "networkidle" });

const bodyText = (await page.locator("body").innerText()).trim();
if (!bodyText) throw new Error("BLANK_PAGE");
if (await page.locator(".vite-error-overlay, [data-nextjs-dialog]").count()) throw new Error("ERROR_OVERLAY");

await page.evaluate(async () => {
  const [{ useEditorStore }, { createBlankGarment }, { createDefaultFabricSource }] = await Promise.all([
    import("/src/state/editorStore.ts"),
    import("/src/domain/blankGarment.ts"),
    import("/src/domain/fabric.ts"),
  ]);
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  useEditorStore.getState().loadGarment({
    ...blank,
    name: "Gate browser 11.0.7",
    fabrics: [fabric],
    pieces: [{
      id: "browser-panel",
      name: "Painel browser",
      seamAllowanceMm: 0,
      cutQuantity: 1,
      cutOnFold: false,
      fabricId: fabric.id,
      points: [
        { id: "browser-a", xMm: 0, yMm: 0 },
        { id: "browser-b", xMm: 240, yMm: 0 },
        { id: "browser-c", xMm: 240, yMm: 360 },
        { id: "browser-d", xMm: 0, yMm: 360 },
      ],
    }],
  });
});
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Montar", exact: true }).click();
const viewport = page.locator('[data-testid="dressed-avatar-viewport"]');
try {
  await viewport.waitFor({ state: "visible", timeout: 10_000 });
} catch (error) {
  await page.screenshot({ path: "docs/progress/RECOVERY_11_0_7_BROWSER_FAILURE.png", fullPage: true });
  const debug = await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 2_000),
    html: document.body.innerHTML.slice(0, 2_000),
    workspace: document.querySelector(".workspace")?.className,
    patternCanvas: Boolean(document.querySelector("canvas.pattern-canvas")),
    previewPlaceholder: document.querySelector(".viewport-placeholder")?.textContent,
  }));
  throw new Error(`VIEWPORT_NOT_VISIBLE ${JSON.stringify({ debug, consoleErrors })}`, { cause: error });
}
await page.waitForFunction(() => {
  const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
  return host?.dataset.assemblyStatus === "ready";
}, undefined, { timeout: 30_000 });
await page.screenshot({ path: "docs/progress/RECOVERY_11_0_7_DESKTOP.png", fullPage: true });

const initial = await page.evaluate(() => {
  const bridge = window.__MOLDEON_VIEWPORT_DEV__;
  const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
  const workspace = document.querySelector(".workspace");
  const toolbar = host?.querySelector(".viewport-arrangement-controls");
  const viewportRect = host?.getBoundingClientRect();
  const workspaceRect = workspace?.getBoundingClientRect();
  return {
    panel: bridge?.instanceScreenPosition("browser-panel:panel:1") ?? null,
    body: bridge?.bodyScreenPosition() ?? null,
    viewportWidth: viewportRect?.width ?? 0,
    viewportHeight: viewportRect?.height ?? 0,
    workspaceWidth: workspaceRect?.width ?? 0,
    workspaceHeight: workspaceRect?.height ?? 0,
    toolbarClientWidth: toolbar?.clientWidth ?? 0,
    toolbarScrollWidth: toolbar?.scrollWidth ?? 0,
    canvasCount: document.querySelectorAll("canvas.three-canvas").length,
  };
});
if (!initial.panel || !initial.body) throw new Error(`ARRANGEMENT_POINTS_UNAVAILABLE ${JSON.stringify(initial)}`);
if (initial.viewportWidth < initial.workspaceWidth * 0.94 || initial.viewportHeight < initial.workspaceHeight * 0.94) {
  throw new Error(`MONTAR_NOT_PRIMARY_WORKSPACE ${JSON.stringify(initial)}`);
}
if (initial.toolbarScrollWidth > initial.toolbarClientWidth + 2) {
  throw new Error(`ARRANGEMENT_TOOLBAR_OVERFLOW ${JSON.stringify(initial)}`);
}
if (initial.canvasCount !== 1) throw new Error(`WEBGL_CANVAS_COUNT ${initial.canvasCount}`);

const grab = [initial.panel[0] + 14, initial.panel[1] - 10];
await page.mouse.move(grab[0], grab[1]);
await page.mouse.down();
await page.mouse.move(grab[0] + 2, grab[1] + 1);
const afterTinyMove = await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.instanceScreenPosition("browser-panel:panel:1") ?? null);
if (!afterTinyMove) throw new Error("PANEL_POSITION_LOST_DURING_DRAG");
const tinyScreenDelta = Math.hypot(afterTinyMove[0] - initial.panel[0], afterTinyMove[1] - initial.panel[1]);
if (tinyScreenDelta > 18) throw new Error(`DRAG_INITIAL_JUMP ${tinyScreenDelta.toFixed(2)}px`);

await page.mouse.move(initial.body[0], initial.body[1], { steps: 12 });
const candidateDuringDrag = await viewport.evaluate((host) => host.dataset.arrangementSurfaceCandidate ?? null);
if (!candidateDuringDrag) throw new Error("SURFACE_CANDIDATE_MISSING");
await page.mouse.up();
await page.waitForFunction(() => {
  const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
  return Number(host?.dataset.arrangementGestureCommits ?? 0) >= 1
    && host?.dataset.arrangementStates?.includes("AJUSTADO");
}, undefined, { timeout: 10_000 });
await page.screenshot({ path: "docs/progress/RECOVERY_11_0_7_DESKTOP_ADJUSTED.png", fullPage: true });

await page.getByRole("button", { name: "Ajustar", exact: true }).click();
await page.waitForTimeout(100);
const conformDiagnostics = await viewport.evaluate((host) => {
  const raw = host.dataset.arrangementConformDiagnostics;
  return raw ? JSON.parse(raw) : null;
});
if (!conformDiagnostics) throw new Error("CONFORM_DIAGNOSTICS_MISSING");
for (const result of Object.values(conformDiagnostics)) {
  if ((result?.minimumClearanceMm ?? 0) <= 0) throw new Error(`CONFORM_INSIDE_BODY ${JSON.stringify(result)}`);
  if ((result?.metricDistortionMax ?? 0) > 0.0085 && result?.conformed) {
    throw new Error(`CONFORM_METRIC_GATE_FAILED ${JSON.stringify(result)}`);
  }
}

await page.getByRole("button", { name: "Girar", exact: true }).click();
const rotatePoint = await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.instanceScreenPosition("browser-panel:panel:1") ?? null);
if (!rotatePoint) throw new Error("ROTATE_POINT_MISSING");
const commitsBeforeRotate = Number(await viewport.getAttribute("data-arrangement-gesture-commits") ?? 0);
await page.mouse.move(rotatePoint[0], rotatePoint[1]);
await page.mouse.down();
await page.mouse.move(rotatePoint[0] + 80, rotatePoint[1], { steps: 8 });
await page.mouse.up();
const commitsAfterRotate = Number(await viewport.getAttribute("data-arrangement-gesture-commits") ?? 0);
if (commitsAfterRotate !== commitsBeforeRotate + 1) {
  throw new Error(`ROTATE_COMMIT_COUNT ${commitsBeforeRotate}->${commitsAfterRotate}`);
}
await page.getByRole("button", { name: "Mover", exact: true }).click();

const desktop = await viewport.evaluate((host) => {
  const canvas = host.querySelector("canvas.three-canvas");
  const editor = document.querySelector(".editor-panel");
  const workspace = document.querySelector(".workspace");
  return {
    workspaceClass: workspace?.className ?? "",
    editorDisplay: editor ? getComputedStyle(editor).display : "missing",
    viewportWidth: host.getBoundingClientRect().width,
    viewportHeight: host.getBoundingClientRect().height,
    canvasWidth: canvas?.getBoundingClientRect().width ?? 0,
    canvasHeight: canvas?.getBoundingClientRect().height ?? 0,
    garmentInstanceCount: host.dataset.garmentInstanceCount,
    garmentInstanceIds: host.dataset.garmentInstanceIds,
    assemblyStatus: host.dataset.assemblyStatus,
    simulationStatus: host.dataset.simulationStatus,
    xpbdInitializations: host.dataset.arrangementXpbdInitializations,
    assemblySolves: host.dataset.arrangementAssemblySolves,
    arrangementStates: host.dataset.arrangementStates,
    transientFrames: host.dataset.arrangementTransientFrames,
    gestureCommits: host.dataset.arrangementGestureCommits,
    conformDiagnostics: host.dataset.arrangementConformDiagnostics,
    viewportSize: host.dataset.viewportSize,
    arrangementControlCount: host.querySelectorAll(".viewport-arrangement-controls button").length,
    simulationControlCount: host.querySelectorAll(".viewport-simulation-controls button").length,
  };
});
if (desktop.simulationStatus !== "disabled-in-montar") throw new Error(`MONTAR_SIMULATION_STATE ${desktop.simulationStatus}`);
if (Number(desktop.xpbdInitializations ?? "0") !== 0) throw new Error(`MONTAR_XPBD_INIT ${desktop.xpbdInitializations}`);

for (let cycle = 0; cycle < 10; cycle += 1) {
  await page.getByRole("button", { name: "Modelar", exact: true }).click();
  await page.getByRole("button", { name: "Montar", exact: true }).click();
}
await viewport.waitFor({ state: "visible" });
await page.waitForTimeout(100);
const lifecycle = await page.evaluate(() => ({
  canvasCount: document.querySelectorAll("canvas.three-canvas").length,
  viewportCount: document.querySelectorAll('[data-testid="dressed-avatar-viewport"]').length,
}));
if (lifecycle.canvasCount !== 1 || lifecycle.viewportCount !== 1) {
  throw new Error(`VIEWPORT_RESOURCE_DUPLICATION ${JSON.stringify(lifecycle)}`);
}

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await page.screenshot({ path: "docs/progress/RECOVERY_11_0_7_MOBILE.png", fullPage: true });
const mobile = await viewport.evaluate((host) => {
  const toolbar = host.querySelector(".viewport-arrangement-controls");
  return {
    viewportWidth: host.getBoundingClientRect().width,
    viewportHeight: host.getBoundingClientRect().height,
    editorDisplay: getComputedStyle(document.querySelector(".editor-panel")).display,
    toolbarClientWidth: toolbar?.clientWidth ?? 0,
    toolbarScrollWidth: toolbar?.scrollWidth ?? 0,
    buttonSizes: [...host.querySelectorAll(".viewport-arrangement-controls button")].map((button) => {
      const bounds = button.getBoundingClientRect();
      return [Math.round(bounds.width), Math.round(bounds.height)];
    }),
  };
});
if (mobile.toolbarScrollWidth > mobile.toolbarClientWidth + 2) throw new Error(`MOBILE_TOOLBAR_OVERFLOW ${JSON.stringify(mobile)}`);
if (mobile.buttonSizes.some(([width, height]) => width < 44 || height < 44)) {
  throw new Error(`MOBILE_TOUCH_TARGET ${JSON.stringify(mobile.buttonSizes)}`);
}

console.log(JSON.stringify({ desktop, mobile, lifecycle, tinyScreenDelta, candidateDuringDrag, consoleErrors }, null, 2));
await browser.close();
if (consoleErrors.length > 0) process.exitCode = 2;
