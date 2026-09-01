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
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(error.stack ?? error.message));
page.on("dialog", (dialog) => dialog.accept("Painel browser 11.0.7"));
await page.goto(baseURL, { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.reload({ waitUntil: "networkidle" });
if (!(await page.locator("body").innerText()).trim()) throw new Error("BLANK_PAGE");
if (await page.locator(".vite-error-overlay, [data-nextjs-dialog]").count()) throw new Error("ERROR_OVERLAY");
await page.evaluate(async () => {
  const [{ useEditorStore }, { createBlankGarment }, { createDefaultFabricSource }] = await Promise.all([
    import("/src/state/editorStore.ts"), import("/src/domain/blankGarment.ts"), import("/src/domain/fabric.ts"),
  ]);
  const blank = createBlankGarment(); const fabric = createDefaultFabricSource();
  useEditorStore.getState().loadGarment({ ...blank, name: "Gate browser 11.0.7", fabrics: [fabric], pieces: [{
    id: "browser-panel", name: "Painel browser", seamAllowanceMm: 0, cutQuantity: 1, cutOnFold: false, fabricId: fabric.id,
    points: [{ id: "browser-a", xMm: 0, yMm: 0 }, { id: "browser-b", xMm: 240, yMm: 0 }, { id: "browser-c", xMm: 240, yMm: 360 }, { id: "browser-d", xMm: 0, yMm: 360 }],
  }] });
});
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Montar", exact: true }).click();
const viewport = page.locator('[data-testid="dressed-avatar-viewport"]');
await viewport.waitFor({ state: "visible", timeout: 10_000 });
await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.assemblyStatus === "ready", undefined, { timeout: 30_000 });
const initial = await page.evaluate(() => {
  const bridge = window.__MOLDEON_VIEWPORT_DEV__;
  const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
  const workspace = document.querySelector(".workspace");
  const toolbar = host?.querySelector(".viewport-arrangement-controls");
  const viewportRect = host?.getBoundingClientRect(); const workspaceRect = workspace?.getBoundingClientRect();
  const toolbarRect = toolbar?.getBoundingClientRect();
  const descendants = toolbar ? [...toolbar.querySelectorAll("*")].map((node) => {
    const r = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return { tag: node.tagName, className: node.className || "", text: (node.textContent || "").trim().slice(0, 50), left: r.left, right: r.right, width: r.width, display: style.display, position: style.position, overflowX: style.overflowX };
  }).filter((item) => item.right > (toolbarRect?.right ?? Infinity) + 1 || item.left < (toolbarRect?.left ?? -Infinity) - 1) : [];
  return {
    panel: bridge?.instanceScreenPosition("browser-panel:panel:1") ?? null, body: bridge?.bodyScreenPosition() ?? null,
    viewportWidth: viewportRect?.width ?? 0, viewportHeight: viewportRect?.height ?? 0, workspaceWidth: workspaceRect?.width ?? 0, workspaceHeight: workspaceRect?.height ?? 0,
    toolbarClientWidth: toolbar?.clientWidth ?? 0, toolbarScrollWidth: toolbar?.scrollWidth ?? 0, toolbarRect: toolbarRect ? { left: toolbarRect.left, right: toolbarRect.right, width: toolbarRect.width } : null,
    overflowDescendants: descendants, canvasCount: document.querySelectorAll("canvas.three-canvas").length,
    assemblySolves: Number(host?.dataset.arrangementAssemblySolves ?? 0), xpbdInitializations: Number(host?.dataset.arrangementXpbdInitializations ?? 0),
  };
});
if (!initial.panel || !initial.body) throw new Error(`ARRANGEMENT_POINTS_UNAVAILABLE ${JSON.stringify(initial)}`);
if (initial.viewportWidth < initial.workspaceWidth * 0.94 || initial.viewportHeight < initial.workspaceHeight * 0.94) throw new Error(`MONTAR_NOT_PRIMARY_WORKSPACE ${JSON.stringify(initial)}`);
if (initial.toolbarScrollWidth > initial.toolbarClientWidth + 2) throw new Error(`ARRANGEMENT_TOOLBAR_OVERFLOW ${JSON.stringify(initial)}`);
if (initial.canvasCount !== 1) throw new Error(`WEBGL_CANVAS_COUNT ${initial.canvasCount}`);

const latencies = [];
for (let index = 0; index < 10; index += 1) {
  const point = await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.instanceScreenPosition("browser-panel:panel:1") ?? null);
  if (!point) throw new Error(`PANEL_POSITION_MISSING_${index}`);
  const targetX = initial.body[0] + ((index % 2 === 0) ? 35 : -35); const targetY = initial.body[1] + ((index % 3) - 1) * 42;
  await page.mouse.move(point[0], point[1]); await page.mouse.down(); await page.mouse.move(targetX, targetY, { steps: 8 });
  const start = Date.now(); await page.mouse.up(); await page.waitForTimeout(0); latencies.push(Date.now() - start);
}
const afterDrags = await viewport.evaluate((host) => ({ commits: Number(host.dataset.arrangementGestureCommits ?? 0), assemblySolves: Number(host.dataset.arrangementAssemblySolves ?? 0), xpbdInitializations: Number(host.dataset.arrangementXpbdInitializations ?? 0), commitPath: host.dataset.arrangementCommitPath ?? null, simulationStatus: host.dataset.simulationStatus ?? null }));
if (afterDrags.commits < 10) throw new Error(`DRAG_COMMIT_COUNT ${afterDrags.commits}`);
if (afterDrags.assemblySolves !== initial.assemblySolves) throw new Error(`ASSEMBLY_SOLVE_DURING_DRAG ${initial.assemblySolves}->${afterDrags.assemblySolves}`);
if (afterDrags.xpbdInitializations !== 0) throw new Error(`MONTAR_XPBD_INIT ${afterDrags.xpbdInitializations}`);
if (afterDrags.simulationStatus !== "disabled-in-montar") throw new Error(`MONTAR_SIMULATION_STATE ${afterDrags.simulationStatus}`);
await page.getByRole("button", { name: "Ajustar", exact: true }).click(); await page.waitForTimeout(100);
const conformDiagnostics = await viewport.evaluate((host) => { const raw = host.dataset.arrangementConformDiagnostics; return raw ? JSON.parse(raw) : null; });
if (!conformDiagnostics) throw new Error("CONFORM_DIAGNOSTICS_MISSING");
for (const result of Object.values(conformDiagnostics)) { if ((result?.minimumClearanceMm ?? 0) <= 0) throw new Error(`CONFORM_INSIDE_BODY ${JSON.stringify(result)}`); if ((result?.metricDistortionMax ?? 0) > 0.0085 && result?.conformed) throw new Error(`CONFORM_METRIC_GATE_FAILED ${JSON.stringify(result)}`); }
await page.getByRole("button", { name: "Girar", exact: true }).click();
for (const axis of ["X", "Y", "Z"]) { await page.getByRole("button", { name: axis, exact: true }).click(); const rotatePoint = await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.instanceScreenPosition("browser-panel:panel:1") ?? null); if (!rotatePoint) throw new Error(`ROTATE_POINT_MISSING_${axis}`); const before = Number(await viewport.getAttribute("data-arrangement-gesture-commits") ?? 0); await page.mouse.move(rotatePoint[0], rotatePoint[1]); await page.mouse.down(); await page.mouse.move(rotatePoint[0] + 60, rotatePoint[1] + 10, { steps: 6 }); await page.mouse.up(); const after = Number(await viewport.getAttribute("data-arrangement-gesture-commits") ?? 0); if (after !== before + 1) throw new Error(`ROTATE_COMMIT_COUNT_${axis} ${before}->${after}`); }
await page.getByRole("button", { name: "Virar face", exact: true }).click(); await page.getByRole("button", { name: "Mover", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
const mobile = await viewport.evaluate((host) => { const toolbar = host.querySelector(".viewport-arrangement-controls"); return { viewportWidth: host.getBoundingClientRect().width, viewportHeight: host.getBoundingClientRect().height, toolbarClientWidth: toolbar?.clientWidth ?? 0, toolbarScrollWidth: toolbar?.scrollWidth ?? 0, buttonSizes: [...host.querySelectorAll(".viewport-arrangement-controls button")].map((button) => { const bounds = button.getBoundingClientRect(); return [Math.round(bounds.width), Math.round(bounds.height)]; }) }; });
if (mobile.toolbarScrollWidth > mobile.toolbarClientWidth + 2) throw new Error(`MOBILE_TOOLBAR_OVERFLOW ${JSON.stringify(mobile)}`);
if (mobile.buttonSizes.some(([width, height]) => width < 44 || height < 44)) throw new Error(`MOBILE_TOUCH_TARGET ${JSON.stringify(mobile.buttonSizes)}`);
const sorted = [...latencies].sort((a, b) => a - b); const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
console.log(JSON.stringify({ drags: latencies.length, pointerUpNextTaskMs: { p95: percentile(0.95), p99: percentile(0.99), max: Math.max(...latencies) }, afterDrags, mobile, consoleErrors }, null, 2));
await browser.close(); if (consoleErrors.length > 0) process.exitCode = 2;
