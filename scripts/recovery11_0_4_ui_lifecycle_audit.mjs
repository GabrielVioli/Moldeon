import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MOLDEON_UI_AUDIT_URL ?? "http://127.0.0.1:4182";
const outputDir = process.env.MOLDEON_UI_AUDIT_DIR ?? "artifacts/ui-responsive-audit";
const executablePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl", "--use-angle=swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });

await context.addInitScript(() => {
  const state = {
    workersCreated: 0,
    workersActive: 0,
    workersTerminated: 0,
    resizeObserversCreated: 0,
    resizeObserversActive: 0,
    rafPending: new Set(),
  };

  const NativeWorker = window.Worker;
  window.Worker = class AuditedWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      state.workersCreated += 1;
      state.workersActive += 1;
      const nativeTerminate = this.terminate.bind(this);
      let terminated = false;
      this.terminate = () => {
        if (!terminated) {
          terminated = true;
          state.workersTerminated += 1;
          state.workersActive -= 1;
        }
        nativeTerminate();
      };
    }
  };

  const NativeResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class AuditedResizeObserver extends NativeResizeObserver {
    constructor(callback) {
      super(callback);
      state.resizeObserversCreated += 1;
      state.resizeObserversActive += 1;
      const nativeDisconnect = this.disconnect.bind(this);
      let disconnected = false;
      this.disconnect = () => {
        if (!disconnected) {
          disconnected = true;
          state.resizeObserversActive -= 1;
        }
        nativeDisconnect();
      };
    }
  };

  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    let id = 0;
    id = nativeRequestAnimationFrame((time) => {
      state.rafPending.delete(id);
      callback(time);
    });
    state.rafPending.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    state.rafPending.delete(id);
    nativeCancelAnimationFrame(id);
  };

  window.__moldeonLifecycleAudit = () => ({
    workersCreated: state.workersCreated,
    workersActive: state.workersActive,
    workersTerminated: state.workersTerminated,
    resizeObserversCreated: state.resizeObserversCreated,
    resizeObserversActive: state.resizeObserversActive,
    rafPending: state.rafPending.size,
    viewportCanvases: document.querySelectorAll("[data-testid='dressed-avatar-viewport'] canvas").length,
    allCanvases: document.querySelectorAll("canvas").length,
  });
});

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("straight-skirt-standard"));
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  const region = page.getByRole("button", { name: /Parte inferior/ });
  if (await region.isVisible().catch(() => false)) await region.click();
  const host = page.locator("[data-testid='dressed-avatar-viewport']");
  await host.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-testid='dressed-avatar-viewport']");
    return element?.getAttribute("data-assembly-status") === "ready"
      && Boolean(element.querySelector("canvas"));
  }, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);

  const snapshots = [{ label: "baseline-1366x768", ...(await snapshot()) }];
  const sizes = [
    [390, 844],
    [1920, 1080],
    [768, 1024],
    [1366, 768],
    [390, 844],
    [1366, 768],
  ];

  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    if (width <= 1180) {
      const editorTab = page.getByRole("tab", { name: "Molde 2D" });
      const previewTab = page.getByRole("tab", { name: "Manequim 3D" });
      await editorTab.click();
      await previewTab.click();
      await editorTab.click();
      await previewTab.click();
    }
    await page.waitForTimeout(350);
    snapshots.push({ label: `${width}x${height}`, ...(await snapshot()) });
  }

  const baseline = snapshots[0];
  const final = snapshots.at(-1);
  const stable = {
    workerCount: final.workersCreated === baseline.workersCreated && final.workersActive === baseline.workersActive,
    resizeObserverCount:
      final.resizeObserversCreated === baseline.resizeObserversCreated
      && final.resizeObserversActive === baseline.resizeObserversActive,
    canvasCount: snapshots.every((entry) => entry.viewportCanvases === 1),
    rafCount: final.rafPending <= baseline.rafPending + 1,
    console: consoleErrors.length === 0,
  };
  const report = { stable, baseline, final, snapshots, consoleErrors };
  if (Object.values(stable).some((value) => !value)) {
    throw new Error(`Lifecycle instável: ${JSON.stringify(report)}`);
  }
  await page.screenshot({ path: `${outputDir}/lifecycle-final.png`, fullPage: false });
  await writeFile(`${outputDir}/lifecycle-report.json`, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
}

async function snapshot() {
  return page.evaluate(() => window.__moldeonLifecycleAudit?.());
}
