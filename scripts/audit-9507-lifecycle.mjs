import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5178";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-07-lifecycle");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--js-flags=--expose-gc"],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));

await page.addInitScript(() => {
  const stats = { activeRafs: 0, activeResizeObservers: 0 };
  Object.defineProperty(window, "__moldeonLifecycleAudit", { value: stats });
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Set();
  window.requestAnimationFrame = (callback) => {
    let id = 0;
    id = nativeRaf((time) => {
      if (pending.delete(id)) stats.activeRafs = pending.size;
      callback(time);
    });
    pending.add(id);
    stats.activeRafs = pending.size;
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    pending.delete(id);
    stats.activeRafs = pending.size;
    nativeCancel(id);
  };
  const NativeResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends NativeResizeObserver {
    constructor(callback) {
      super(callback);
      this.auditActive = true;
      stats.activeResizeObservers += 1;
    }
    disconnect() {
      if (this.auditActive) {
        this.auditActive = false;
        stats.activeResizeObservers -= 1;
      }
      return super.disconnect();
    }
  };
});

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const stats = () => page.evaluate(() => ({
  ...window.__moldeonLifecycleAudit,
  canvases: document.querySelectorAll("canvas.three-canvas").length,
  avatarRoots: document.querySelectorAll('[data-testid="dressed-avatar-viewport"] [data-avatar-visible="true"]').length,
  heap: performance.memory?.usedJSHeapSize ?? null,
}));

await page.goto(baseUrl, { waitUntil: "networkidle" });
page.once("dialog", (dialog) => dialog.accept("Painel de lifecycle"));
await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).click();
const canvas = page.locator("canvas.pattern-canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("Canvas 2D indisponível.");
for (const point of [
  { x: box.width * 0.30, y: box.height * 0.26 },
  { x: box.width * 0.64, y: box.height * 0.26 },
  { x: box.width * 0.64, y: box.height * 0.68 },
  { x: box.width * 0.30, y: box.height * 0.68 },
]) await canvas.click({ position: point });
await page.keyboard.press("Enter");
await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
await page.getByLabel("Função da peça").selectOption("custom");
await page.getByLabel("Região corporal").selectOption("torso");
await page.getByLabel("Superfície").selectOption("front");
await page.getByLabel("Lado corporal").selectOption("center");
await page.getByLabel("Posição", { exact: true }).selectOption("torso-front");
await page.getByRole("button", { name: "Confirmar posição", exact: true }).click();
await page.getByText("Pronta para vestir", { exact: true }).waitFor();
await page.waitForTimeout(200);
await page.evaluate(() => globalThis.gc?.());
const baseline = await stats();

const cycles = [];
for (let index = 0; index < 20; index += 1) {
  if (index === 0) {
    await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
  } else {
    await page.locator("button.right-panel-toggle").click();
  }
  await page.locator("canvas.three-canvas").waitFor();
  await page.getByText("Manequim humano ainda não configurado.", { exact: true }).first().waitFor();
  const open = await stats();
  const viewportData = await page.locator('[data-testid="dressed-avatar-viewport"]').evaluate((element) => ({
    avatarVisible: element.dataset.avatarVisible,
    avatarStatus: element.dataset.avatarStatus,
    garmentInstanceCount: element.dataset.garmentInstanceCount,
  }));
  assert(open.canvases === 1, `Ciclo ${index + 1}: quantidade de canvases aberta inválida.`);
  assert(viewportData.avatarVisible === "false", `Ciclo ${index + 1}: avatar procedural/indevido ficou visível.`);
  assert(viewportData.avatarStatus === "not-configured", `Ciclo ${index + 1}: estado do asset incorreto.`);
  await page.locator("button.right-panel-close").click();
  await page.locator("canvas.three-canvas").waitFor({ state: "detached" });
  await page.waitForTimeout(50);
  await page.evaluate(() => globalThis.gc?.());
  const closed = await stats();
  assert(closed.canvases === 0, `Ciclo ${index + 1}: canvas não foi removido.`);
  assert(closed.activeResizeObservers === baseline.activeResizeObservers, `Ciclo ${index + 1}: ResizeObserver acumulou.`);
  cycles.push({ cycle: index + 1, open, closed, viewportData });
}

await page.waitForTimeout(250);
await page.evaluate(() => globalThis.gc?.());
const final = await stats();
assert(final.activeResizeObservers === baseline.activeResizeObservers, "ResizeObservers não retornaram ao baseline.");
assert(final.canvases === 0, "Canvas permaneceu depois do fechamento final.");
assert(errors.length === 0, `Erros de console: ${errors.join(" | ")}`);

const report = { baseline, final, cycles, consoleErrors: errors };
writeFileSync(resolve(outputDir, "lifecycle-20x.json"), JSON.stringify(report, null, 2), "utf8");
process.stdout.write(JSON.stringify({ baseline, final, cycleCount: cycles.length, consoleErrors: errors }, null, 2));
await browser.close();
