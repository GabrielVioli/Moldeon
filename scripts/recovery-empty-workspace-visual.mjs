import { cp, mkdir } from "node:fs/promises";
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
    { name: "desktop", viewport: { width: 1366, height: 768 } },
    { name: "mobile", viewport: { width: 390, height: 844 } },
  ]) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    const page = await context.newPage();
    const errors = [];
    const steps = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") await dialog.accept("Peça teste");
      else await dialog.accept();
    });

    await page.goto(baseURL, { waitUntil: "networkidle" });
    steps.push({ step: "carregar aplicação", result: "ok" });

    await page.getByRole("button", { name: "Moldes" }).click();
    await page.getByRole("button", { name: /Bancada vazia/ }).click();
    await page.getByRole("button", { name: "Criar bancada vazia" }).click();
    const empty = page.locator(".empty-workspace");
    await empty.waitFor({ state: "visible" });

    const emptyState = await page.evaluate(() => ({
      title: document.querySelector(".panel-titlebar strong")?.textContent?.trim(),
      pieceItems: document.querySelectorAll(".pieces-item").length,
      activePieceItems: document.querySelectorAll(".pieces-item.is-active").length,
      selectedPieceInputs: document.querySelectorAll(".pieces-item input:checked").length,
      emptyVisible: Boolean(document.querySelector(".empty-workspace")),
      inspectorHeading: document.querySelector(".empty-inspector strong")?.textContent?.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    if (
      emptyState.title !== "Bancada vazia · milímetros"
      || emptyState.pieceItems !== 0
      || emptyState.activePieceItems !== 0
      || emptyState.selectedPieceInputs !== 0
      || !emptyState.emptyVisible
      || emptyState.inspectorHeading !== "Nenhuma peça selecionada"
      || emptyState.horizontalOverflow
    ) {
      throw new Error(`${scenario.name}: estado vazio inválido: ${JSON.stringify(emptyState)}`);
    }
    steps.push({ step: "criar bancada vazia sem peça ou seleção fantasma", result: "ok", evidence: emptyState });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-empty.png`, fullPage: true });

    await page.getByRole("button", { name: "Desenhar primeira peça" }).click();
    const canvas = page.locator("canvas.pattern-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`${scenario.name}: Canvas não encontrado`);
    const left = Math.max(40, Math.min(box.width - 180, box.width * 0.25));
    const right = Math.max(left + 130, Math.min(box.width - 35, box.width * 0.70));
    const top = Math.max(80, Math.min(box.height - 190, box.height * 0.25));
    const bottom = Math.max(top + 130, Math.min(box.height - 45, box.height * 0.68));
    await canvas.click({ position: { x: left, y: top } });
    await canvas.click({ position: { x: right, y: top } });
    await canvas.click({ position: { x: right - 25, y: bottom } });
    await canvas.click({ position: { x: left, y: bottom - 20 } });
    await page.keyboard.press("Enter");

    const pieceItem = page.locator(".pieces-item").filter({ hasText: "Peça teste" }).first();
    await pieceItem.waitFor({ state: "visible" });
    steps.push({ step: "desenhar primeira peça", result: "ok" });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-drawn.png`, fullPage: true });

    await page.getByRole("button", { name: "Mais ações para Peça teste" }).click();
    await page.getByRole("menuitem", { name: "Excluir" }).click();
    await empty.waitFor({ state: "visible" });
    const deletedState = await page.evaluate(() => ({
      pieceItems: document.querySelectorAll(".pieces-item").length,
      activePieceItems: document.querySelectorAll(".pieces-item.is-active").length,
      selectedPieceInputs: document.querySelectorAll(".pieces-item input:checked").length,
      emptyVisible: Boolean(document.querySelector(".empty-workspace")),
    }));
    if (
      deletedState.pieceItems !== 0
      || deletedState.activePieceItems !== 0
      || deletedState.selectedPieceInputs !== 0
      || !deletedState.emptyVisible
    ) {
      throw new Error(`${scenario.name}: exclusão deixou estado fantasma: ${JSON.stringify(deletedState)}`);
    }
    steps.push({ step: "excluir a última peça", result: "ok", evidence: deletedState });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-deleted.png`, fullPage: true });

    await page.keyboard.press("Control+z");
    await pieceItem.waitFor({ state: "visible" });
    steps.push({ step: "desfazer exclusão", result: "ok" });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-undone.png`, fullPage: true });

    await page.keyboard.press("Control+y");
    await empty.waitFor({ state: "visible" });
    const redoneState = await page.evaluate(() => ({
      pieceItems: document.querySelectorAll(".pieces-item").length,
      activePieceItems: document.querySelectorAll(".pieces-item.is-active").length,
      selectedPieceInputs: document.querySelectorAll(".pieces-item input:checked").length,
      emptyVisible: Boolean(document.querySelector(".empty-workspace")),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    if (
      redoneState.pieceItems !== 0
      || redoneState.activePieceItems !== 0
      || redoneState.selectedPieceInputs !== 0
      || !redoneState.emptyVisible
      || redoneState.horizontalOverflow
    ) {
      throw new Error(`${scenario.name}: refazer deixou estado fantasma: ${JSON.stringify(redoneState)}`);
    }
    steps.push({ step: "refazer exclusão e retornar ao vazio", result: "ok", evidence: redoneState });
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-redone-empty.png`, fullPage: true });

    if (errors.length) throw new Error(`${scenario.name}: erros no navegador: ${errors.join(" | ")}`);
    steps.push({ step: "console e page errors", result: "ok", errors: [] });
    report.push({ scenario: scenario.name, viewport: scenario.viewport, steps });
    await context.close();
  }
} finally {
  await browser.close();
}

await cp("apps/web/dist", `${artifactDir}/dist`, { recursive: true });
console.log(JSON.stringify(report, null, 2));
