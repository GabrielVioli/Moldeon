import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROMPT09_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.PROMPT09_ARTIFACT_DIR ?? "artifacts/prompt09-avatar-surface";
await mkdir(artifactDir, { recursive: true });

const scenarios = [
  { label: "desktop-tshirt", template: "Camiseta básica", viewport: { width: 1440, height: 960 }, expectedInstances: 6 },
  { label: "desktop-skirt", template: "Saia reta", viewport: { width: 1440, height: 960 }, expectedInstances: 4 },
  { label: "mobile-trousers", template: "Calça reta", viewport: { width: 390, height: 844 }, expectedInstances: 4, mobile: true },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
});
const results = [];

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: 1,
      isMobile: Boolean(scenario.mobile),
      hasTouch: Boolean(scenario.mobile),
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location();
      if (message.text().includes("404") && location.url.endsWith("/favicon.ico")) return;
      consoleErrors.push(`${message.text()} @ ${location.url || "unknown"}`);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      if (!request.url().endsWith("/favicon.ico")) failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await chooseTemplate(page, scenario.template);
    const dressButton = page.getByRole("button", { name: "Vestir no manequim" });
    await dressButton.waitFor({ state: "visible" });
    await dressButton.click();
    const host = page.getByTestId("dressed-avatar-viewport");
    await host.waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.getAttribute("data-avatar-visible") === "true", undefined, { timeout: 20_000 });
    await page.waitForTimeout(900);

    const inspection = await host.evaluate((element) => {
      const canvas = element.querySelector("canvas");
      const canvasBox = canvas?.getBoundingClientRect();
      return {
        dataset: { ...element.dataset },
        canvasBox: canvasBox ? { width: canvasBox.width, height: canvasBox.height } : null,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        forbiddenExploded: [...document.querySelectorAll("button")].some((button) => /Explodida|Montada/.test(button.textContent ?? "")),
        bodyToggle: [...document.querySelectorAll("button, input, label")].some((node) => /ocultar corpo|mostrar corpo/i.test(node.textContent ?? "")),
      };
    });
    const screenshot = `${scenario.label}.png`;
    await page.screenshot({ path: `${artifactDir}/${screenshot}`, fullPage: false });

    if (inspection.dataset.avatarVisible !== "true") throw new Error(`${scenario.label}: avatar invisível`);
    if (inspection.dataset.frameTarget !== "avatar-and-garment") throw new Error(`${scenario.label}: enquadramento incorreto`);
    if (Number(inspection.dataset.garmentInstanceCount) !== scenario.expectedInstances) throw new Error(`${scenario.label}: quantidade de instâncias incorreta`);
    if (Number(inspection.dataset.arrangementErrorCount) !== 0) throw new Error(`${scenario.label}: diagnóstico de erro`);
    if (!inspection.canvasBox || inspection.canvasBox.width < 240 || inspection.canvasBox.height < 300) throw new Error(`${scenario.label}: canvas pequeno ${JSON.stringify(inspection.canvasBox)}`);
    if (inspection.bodyWidth > inspection.viewportWidth + 1) throw new Error(`${scenario.label}: overflow horizontal`);
    if (inspection.forbiddenExploded || inspection.bodyToggle) throw new Error(`${scenario.label}: controle legado visível`);
    if (consoleErrors.length || pageErrors.length || failedRequests.length) throw new Error(`${scenario.label}: erros ${JSON.stringify({ consoleErrors, pageErrors, failedRequests })}`);

    results.push({ ...scenario, status: "passed", inspection, screenshot });
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(`${artifactDir}/prompt09-surface-audit.json`, JSON.stringify({ baseUrl, physicalDeviceValidated: false, physicalDrapeClaimed: false, results }, null, 2));
await writeFile(`${artifactDir}/prompt09-surface-audit.md`, [
  "# Auditoria final das superfícies vestidas",
  "",
  "| Cenário | Template | Viewport | Instâncias | Erros |",
  "|---|---|---:|---:|---:|",
  ...results.map((result) => `| ${result.label} | ${result.template} | ${result.viewport.width}×${result.viewport.height} | ${result.inspection.dataset.garmentInstanceCount} | ${result.inspection.dataset.arrangementErrorCount} |`),
  "",
  "A auditoria foi executada após tesselação adaptativa por comprimento máximo de aresta. As capturas precisam de revisão visual direta antes do encerramento.",
  "",
].join("\n"));

async function chooseTemplate(page, templateName) {
  await page.getByRole("button", { name: "Moldes" }).click();
  const dialog = page.locator(".pattern-library-dialog");
  await dialog.waitFor({ state: "visible" });
  const card = page.locator("button.template-card").filter({ hasText: templateName }).first();
  await card.waitFor({ state: "visible" });
  await card.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
}
