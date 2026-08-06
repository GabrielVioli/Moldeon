import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-empty-workspace";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = [];
try {
  for (const scenario of [
    { name: "desktop", viewport: { width: 1366, height: 768 }, draw: true },
    { name: "mobile", viewport: { width: 390, height: 844 }, draw: false },
  ]) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") await dialog.accept("Peça teste");
      else await dialog.accept();
    });

    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Moldes" }).click();
    await page.getByRole("button", { name: /Bancada vazia/ }).click();
    await page.getByRole("button", { name: "Criar bancada vazia" }).click();
    const empty = page.locator(".empty-workspace");
    await empty.waitFor({ state: "visible" });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-empty.png`, fullPage: true });

    const initial = await page.evaluate(() => ({
      title: document.querySelector(".panel-titlebar strong")?.textContent?.trim(),
      pieceItems: document.querySelectorAll(".pieces-item").length,
      emptyVisible: Boolean(document.querySelector(".empty-workspace")),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    if (
      initial.title !== "Bancada vazia · milímetros"
      || initial.pieceItems !== 0
      || !initial.emptyVisible
      || initial.horizontalOverflow
    ) {
      throw new Error(`${scenario.name}: estado vazio inválido: ${JSON.stringify(initial)}`);
    }

    if (scenario.draw) {
      await page.getByRole("button", { name: "Desenhar primeira peça" }).click();
      const canvas = page.locator("canvas.pattern-canvas");
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Canvas não encontrado");
      await canvas.click({ position: { x: Math.max(230, box.width * 0.30), y: Math.max(170, box.height * 0.30) } });
      await canvas.click({ position: { x: Math.min(box.width - 100, box.width * 0.58), y: Math.max(170, box.height * 0.30) } });
      await canvas.click({ position: { x: Math.min(box.width - 100, box.width * 0.55), y: Math.min(box.height - 100, box.height * 0.62) } });
      await canvas.click({ position: { x: Math.max(230, box.width * 0.30), y: Math.min(box.height - 100, box.height * 0.58) } });
      await page.keyboard.press("Enter");

      const pieceItem = page.locator(".pieces-item").filter({ hasText: "Peça teste" }).first();
      await pieceItem.waitFor({ state: "visible" });
      await page.screenshot({ path: `${artifactDir}/desktop-drawn.png`, fullPage: true });

      await page.keyboard.press("Delete");
      await empty.waitFor({ state: "visible" });
      await page.screenshot({ path: `${artifactDir}/desktop-deleted.png`, fullPage: true });

      await page.keyboard.press("Control+z");
      await pieceItem.waitFor({ state: "visible" });
      await page.screenshot({ path: `${artifactDir}/desktop-undone.png`, fullPage: true });

      await page.keyboard.press("Control+y");
      await empty.waitFor({ state: "visible" });
      await page.screenshot({ path: `${artifactDir}/desktop-redone-empty.png`, fullPage: true });
    }

    if (errors.length) throw new Error(`${scenario.name}: erros no navegador: ${errors.join(" | ")}`);
    report.push({ scenario: scenario.name, initial, errors });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
