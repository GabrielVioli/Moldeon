import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.PROMPT09_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.PROMPT09_ARTIFACT_DIR ?? "artifacts/prompt09-avatar-assembly";
const executablePath = "/usr/bin/google-chrome";

await fs.mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});

const scenarios = [
  { label: "desktop-tshirt", template: "Camiseta básica", viewport: { width: 1440, height: 1000 } },
  { label: "desktop-skirt", template: "Saia reta", viewport: { width: 1440, height: 1000 } },
  { label: "mobile-trousers", template: "Calça reta", viewport: { width: 390, height: 844 } },
];

const report = [];

for (const scenario of scenarios) {
  const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Moldes" }).click();

  const templateCard = page.getByRole("button", { name: scenario.template, exact: false }).first();
  await templateCard.waitFor({ state: "visible" });
  await templateCard.evaluate((element) => element.click());
  await page.locator(".pattern-library-dialog").waitFor({ state: "detached", timeout: 10_000 });
  const projectName = (await page.locator(".brand span:last-child").textContent())?.trim() ?? "";
  if (!projectName.includes(scenario.template)) {
    throw new Error(`${scenario.label}: template não foi aplicado; projeto atual: ${projectName}`);
  }

  const previewTab = page.getByRole("tab", { name: "Manequim 3D" });
  if (await previewTab.isVisible()) await previewTab.evaluate((element) => element.click());
  else {
    const dressButton = page.getByRole("button", { name: "Vestir no manequim" });
    await dressButton.waitFor({ state: "visible" });
    await dressButton.evaluate((element) => element.click());
  }

  await page.waitForTimeout(2500);
  const canvas = page.locator("canvas.three-canvas");
  const inspection = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.three-canvas");
    const host = document.querySelector("[data-testid='dressed-avatar-viewport']");
    const box = canvas?.getBoundingClientRect();
    const hostBox = host?.getBoundingClientRect();
    const diagnostics = [...document.querySelectorAll(".viewport-diagnostics li, .viewport-warnings span")].map((node) => node.textContent?.trim() ?? "");
    const bodyText = document.body.innerText;
    return {
      canvasBox: box ? { width: box.width, height: box.height, top: box.top, bottom: box.bottom } : null,
      hostBox: hostBox ? { width: hostBox.width, height: hostBox.height, top: hostBox.top, bottom: hostBox.bottom } : null,
      hostDataset: host instanceof HTMLElement ? { ...host.dataset } : null,
      diagnostics,
      viewportError: document.querySelector(".viewport-error")?.textContent?.trim() ?? null,
      placeholder: document.querySelector(".viewport-placeholder")?.textContent?.trim() ?? null,
      workspaceClass: document.querySelector(".workspace")?.className ?? null,
      hasExploded: /Explodida|explodido/i.test(bodyText),
      hasHideBody: /Ocultar corpo|Mostrar corpo/i.test(bodyText),
      hasCanvas: Boolean(canvas),
    };
  });

  if (!inspection.hasCanvas) {
    throw new Error(`${scenario.label}: canvas 3D ausente (${JSON.stringify({ inspection, consoleErrors })})`);
  }
  await canvas.waitFor({ state: "visible", timeout: 10_000 });
  if (!inspection.canvasBox || inspection.canvasBox.width < 240 || inspection.canvasBox.height < 300) {
    throw new Error(`${scenario.label}: canvas sem área adequada (${JSON.stringify(inspection)})`);
  }
  if (inspection.hasExploded) throw new Error(`${scenario.label}: modo explodido ainda visível`);
  if (inspection.hasHideBody) throw new Error(`${scenario.label}: controle público para ocultar corpo ainda visível`);
  if (consoleErrors.length > 0) throw new Error(`${scenario.label}: erros no console: ${consoleErrors.join(" | ")}`);

  const screenshot = path.join(artifactDir, `${scenario.label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  report.push({ ...scenario, inspection, consoleErrors, screenshot });
  await context.close();
}

await fs.writeFile(path.join(artifactDir, "audit.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
