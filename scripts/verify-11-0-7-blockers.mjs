import { chromium } from "playwright-core";

const executablePath = process.env.MOLDEON_CHROME;
if (!executablePath) throw new Error("CHROME_NOT_FOUND");
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("dialog", (dialog) => dialog.accept());
await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: "networkidle" });
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
    name: "11.0.7 blocker smoke",
    fabrics: [fabric],
    pieces: [{
      id: "smoke-panel",
      name: "Smoke panel",
      seamAllowanceMm: 0,
      cutQuantity: 1,
      cutOnFold: false,
      fabricId: fabric.id,
      points: [
        { id: "a", xMm: 0, yMm: 0 },
        { id: "b", xMm: 220, yMm: 0 },
        { id: "c", xMm: 220, yMm: 320 },
        { id: "d", xMm: 0, yMm: 320 },
      ],
    }],
  });
});
await page.waitForTimeout(100);
await page.getByRole("button", { name: "Montar", exact: true }).click();
const viewport = page.locator('[data-testid="dressed-avatar-viewport"]');
await viewport.waitFor({ state: "visible", timeout: 10_000 });
await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.assemblyStatus === "ready", undefined, { timeout: 30_000 });

async function layout(label) {
  const metrics = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
    const workspace = document.querySelector(".workspace");
    const canvas = host?.querySelector("canvas.three-canvas");
    if (!host || !workspace || !canvas) return null;
    const h = host.getBoundingClientRect();
    const w = workspace.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    return {
      host: [h.width, h.height],
      workspace: [w.width, w.height],
      canvas: [c.width, c.height],
      role: host.dataset.viewportWorkspaceRole,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  if (!metrics) throw new Error(`${label}_LAYOUT_MISSING`);
  if (metrics.role !== "primary-3d") throw new Error(`${label}_NOT_PRIMARY ${JSON.stringify(metrics)}`);
  if (metrics.host[0] < metrics.workspace[0] * 0.9 || metrics.host[1] < metrics.workspace[1] * 0.9) throw new Error(`${label}_VIEWPORT_SMALL ${JSON.stringify(metrics)}`);
  if (metrics.canvas[0] < metrics.host[0] * 0.98 || metrics.canvas[1] < metrics.host[1] * 0.98) throw new Error(`${label}_CANVAS_SMALL ${JSON.stringify(metrics)}`);
  if (metrics.horizontalOverflow > 2) throw new Error(`${label}_HORIZONTAL_OVERFLOW ${JSON.stringify(metrics)}`);
  return metrics;
}

const desktop = await layout("DESKTOP");
const before = await viewport.evaluate((host) => ({
  solves: Number(host.dataset.arrangementAssemblySolves ?? 0),
  commits: Number(host.dataset.arrangementGestureCommits ?? 0),
  revision: host.dataset.arrangementRevision ?? "",
}));
const panelPoint = await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.instanceScreenPosition("smoke-panel:panel:1") ?? null);
if (!panelPoint) throw new Error("PANEL_POINT_MISSING");
await page.mouse.move(panelPoint[0], panelPoint[1]);
await page.mouse.down();
await page.mouse.move(panelPoint[0] + 70, panelPoint[1] + 35, { steps: 10 });
const releasedAt = Date.now();
await page.mouse.up();
await page.waitForFunction((previous) => {
  const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
  return Number(host?.dataset.arrangementGestureCommits ?? 0) === previous + 1
    && host?.dataset.arrangementCommitPath === "transform-only";
}, before.commits, { timeout: 3_000 });
const releaseLatencyMs = Date.now() - releasedAt;
if (releaseLatencyMs > 1500) throw new Error(`POST_DRAG_FREEZE ${releaseLatencyMs}ms`);
await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const after = await viewport.evaluate((host) => ({
  solves: Number(host.dataset.arrangementAssemblySolves ?? 0),
  commits: Number(host.dataset.arrangementGestureCommits ?? 0),
  xpbd: Number(host.dataset.arrangementXpbdInitializations ?? 0),
  path: host.dataset.arrangementCommitPath,
  revision: host.dataset.arrangementRevision ?? "",
}));
if (after.solves !== before.solves) throw new Error(`ASSEMBLY_SOLVE_ON_DROP ${before.solves}->${after.solves}`);
if (after.xpbd !== 0) throw new Error(`XPBD_ON_DROP ${after.xpbd}`);
if (after.commits !== before.commits + 1) throw new Error(`COMMIT_COUNT ${before.commits}->${after.commits}`);
if (!after.revision || after.revision === before.revision) throw new Error(`ARRANGEMENT_REVISION_NOT_COMMITTED ${JSON.stringify({ before, after })}`);
await page.getByRole("button", { name: "Girar", exact: true }).click();
await page.getByRole("button", { name: "Mover", exact: true }).click();

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const mobile = await layout("MOBILE");
const targetSizes = await viewport.locator(".viewport-arrangement-actions button").evaluateAll((buttons) => buttons.map((button) => {
  const rect = button.getBoundingClientRect();
  return [rect.width, rect.height];
}));
if (targetSizes.some(([width, height]) => width < 44 || height < 44)) throw new Error(`MOBILE_TARGET_TOO_SMALL ${JSON.stringify(targetSizes)}`);
if (errors.length) throw new Error(`BROWSER_ERRORS ${JSON.stringify(errors)}`);
console.log(JSON.stringify({ desktop, mobile, before, after, releaseLatencyMs, targetSizes }, null, 2));
await browser.close();
