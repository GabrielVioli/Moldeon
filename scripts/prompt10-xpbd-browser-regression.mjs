import { chromium } from "playwright-core";

const baseURL = process.env.PROMPT10_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.PROMPT10_ARTIFACT_DIR ?? "artifacts/prompt10-xpbd-regression";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const scenarios = [
  { label: "desktop-tshirt-xpbd", template: "Camiseta básica", viewport: { width: 1440, height: 1000 } },
  { label: "mobile-trousers-xpbd", template: "Calça reta", viewport: { width: 390, height: 844 } },
];

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = [];

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedResponses = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
    });

    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Moldes" }).click();
    const card = page.getByRole("button", { name: scenario.template, exact: false }).first();
    await card.waitFor({ state: "visible" });
    await card.evaluate((element) => element.click());
    await page.locator(".pattern-library-dialog").waitFor({ state: "detached", timeout: 10_000 });

    const previewTab = page.getByRole("tab", { name: "Manequim 3D" });
    if (await previewTab.isVisible()) {
      await previewTab.evaluate((element) => element.click());
    }
    const dressButton = page.getByRole("button", { name: "Vestir no manequim" });
    if (await dressButton.isVisible()) await dressButton.evaluate((element) => element.click());

    const host = page.locator("[data-testid='dressed-avatar-viewport']");
    await host.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForFunction(() => {
      const element = document.querySelector("[data-testid='dressed-avatar-viewport']");
      return element instanceof HTMLElement
        && element.dataset.simulationBackend === "worker-xpbd"
        && Number(element.dataset.simulationFrame ?? 0) >= 3;
    }, undefined, { timeout: 20_000 });
    await page.waitForTimeout(500);

    const inspection = await page.evaluate(() => {
      const host = document.querySelector("[data-testid='dressed-avatar-viewport']");
      const canvas = document.querySelector("canvas.three-canvas");
      const canvasBox = canvas?.getBoundingClientRect();
      return {
        dataset: host instanceof HTMLElement ? { ...host.dataset } : null,
        canvas: canvasBox ? { width: canvasBox.width, height: canvasBox.height, top: canvasBox.top, bottom: canvasBox.bottom } : null,
        statusText: document.querySelector(".simulation-status-label")?.textContent?.trim() ?? null,
        toolbarButtons: [...document.querySelectorAll(".simulation-toolbar button")].map((button) => button.textContent?.trim()),
        documentWidth: document.documentElement.scrollWidth,
      };
    });

    const details = JSON.stringify({ scenario, inspection, consoleErrors, failedResponses });
    if (!inspection.dataset || !inspection.canvas) throw new Error(`${scenario.label}: viewport incompleto: ${details}`);
    if (inspection.dataset.simulationBackend !== "worker-xpbd") throw new Error(`${scenario.label}: backend incorreto: ${details}`);
    if (Number(inspection.dataset.simulationFrame) < 3) throw new Error(`${scenario.label}: Worker não avançou: ${details}`);
    if (inspection.dataset.simulationStatus === "error") throw new Error(`${scenario.label}: Worker falhou: ${details}`);
    if (inspection.dataset.simulationUnstable === "true") throw new Error(`${scenario.label}: cenário canônico ficou instável: ${details}`);
    if (!inspection.toolbarButtons.includes("Pausar") && !inspection.toolbarButtons.includes("Continuar")) {
      throw new Error(`${scenario.label}: controles de ciclo ausentes: ${details}`);
    }
    if (!inspection.toolbarButtons.includes("Passo") || !inspection.toolbarButtons.includes("Reiniciar")) {
      throw new Error(`${scenario.label}: controles de passo/reset ausentes: ${details}`);
    }
    if (inspection.documentWidth > scenario.viewport.width + 1) throw new Error(`${scenario.label}: overflow horizontal: ${details}`);
    if (inspection.canvas.bottom > scenario.viewport.height + 1 || inspection.canvas.top < -1) {
      throw new Error(`${scenario.label}: canvas fora da viewport: ${details}`);
    }
    if (consoleErrors.length > 0 || failedResponses.length > 0) throw new Error(`${scenario.label}: navegador registrou falhas: ${details}`);

    const screenshot = `${artifactDir}/${scenario.label}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    report.push({ scenario, inspection, screenshot });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ scenarios: report }, null, 2));
