import { chromium } from "playwright-core";

const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
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

const dragPoints = await page.evaluate(() => {
  const bridge = window.__MOLDEON_VIEWPORT_DEV__;
  return {
    panel: bridge?.instanceScreenPosition("browser-panel:panel:1") ?? null,
    body: bridge?.bodyScreenPosition() ?? null,
  };
});
if (!dragPoints.panel || !dragPoints.body) throw new Error(`ARRANGEMENT_POINTS_UNAVAILABLE ${JSON.stringify(dragPoints)}`);
await page.mouse.move(dragPoints.panel[0], dragPoints.panel[1]);
await page.mouse.down();
await page.mouse.move(dragPoints.body[0], dragPoints.body[1], { steps: 12 });
await page.mouse.up();
await page.waitForFunction(() => {
  const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
  return Number(host?.dataset.arrangementGestureCommits ?? 0) >= 1
    && host?.dataset.arrangementStates?.includes("AJUSTADO");
}, undefined, { timeout: 10_000 });
await page.screenshot({ path: "docs/progress/RECOVERY_11_0_7_DESKTOP_ADJUSTED.png", fullPage: true });

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
    arrangementControlCount: host.querySelectorAll(".viewport-arrangement-controls button").length,
    simulationControlCount: host.querySelectorAll(".viewport-simulation-controls button").length,
  };
});

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await page.screenshot({ path: "docs/progress/RECOVERY_11_0_7_MOBILE.png", fullPage: true });
const mobile = await viewport.evaluate((host) => ({
  viewportWidth: host.getBoundingClientRect().width,
  viewportHeight: host.getBoundingClientRect().height,
  editorDisplay: getComputedStyle(document.querySelector(".editor-panel")).display,
  buttonSizes: [...host.querySelectorAll(".viewport-arrangement-controls button")].map((button) => {
    const bounds = button.getBoundingClientRect();
    return [Math.round(bounds.width), Math.round(bounds.height)];
  }),
}));

console.log(JSON.stringify({ desktop, mobile, consoleErrors }, null, 2));
await browser.close();
if (consoleErrors.length > 0) process.exitCode = 2;
