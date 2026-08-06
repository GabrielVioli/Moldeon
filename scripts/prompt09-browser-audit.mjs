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
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-webgl"],
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
  await templateCard.click({ force: true });

  const createButton = page.getByRole("button", { name: "Criar molde", exact: false }).first();
  await createButton.waitFor({ state: "visible" });
  await createButton.click({ force: true });

  const previewTab = page.getByRole("tab", { name: "Prévia 3D" });
  if (await previewTab.isVisible()) await previewTab.click();
  else await page.getByRole("button", { name: "Montar no 3D" }).click();

  const canvas = page.locator("canvas.three-canvas");
  await canvas.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1800);

  const inspection = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.three-canvas");
    const box = canvas?.getBoundingClientRect();
    const diagnostics = [...document.querySelectorAll(".viewport-diagnostics li")].map((node) => node.textContent?.trim() ?? "");
    const bodyText = document.body.innerText;
    return {
      canvasBox: box ? { width: box.width, height: box.height, top: box.top, bottom: box.bottom } : null,
      diagnostics,
      hasExploded: /Explodida|explodido/i.test(bodyText),
      hasHideBody: /Ocultar corpo|Mostrar corpo/i.test(bodyText),
      hasCanvas: Boolean(canvas),
    };
  });

  if (!inspection.hasCanvas) throw new Error(`${scenario.label}: canvas 3D ausente`);
  if (!inspection.canvasBox || inspection.canvasBox.width < 240 || inspection.canvasBox.height < 300) {
    throw new Error(`${scenario.label}: canvas sem área adequada (${JSON.stringify(inspection.canvasBox)})`);
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
