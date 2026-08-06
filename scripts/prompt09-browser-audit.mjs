import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROMPT09_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.PROMPT09_ARTIFACT_DIR ?? "artifacts/prompt09-avatar-assembly";
await mkdir(artifactDir, { recursive: true });

const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader"],
});

const scenarios = [
  { label: "desktop-tshirt", template: "Camiseta básica", viewport: { width: 1440, height: 960 }, expectedInstances: 6 },
  { label: "desktop-skirt", template: "Saia reta", viewport: { width: 1440, height: 960 }, expectedInstances: 4 },
  { label: "mobile-trousers", template: "Calça reta", viewport: { width: 390, height: 844 }, expectedInstances: 4, mobile: true },
];

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
      const text = message.text();
      const location = message.location();
      if (text.includes("404") && location.url.endsWith("/favicon.ico")) return;
      consoleErrors.push(`${text} @ ${location.url || "unknown"}`);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.url().endsWith("/favicon.ico")) return;
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await chooseTemplate(page, scenario.template);
    const dressedButton = page.getByRole("button", { name: "Vestir no manequim" });
    await dressedButton.waitFor({ state: "visible" });
    if (await dressedButton.isDisabled()) throw new Error(`${scenario.label}: botão de vestir desabilitado`);
    await dressedButton.click();

    const host = page.getByTestId("dressed-avatar-viewport");
    await host.waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.getAttribute("data-avatar-visible") === "true", undefined, { timeout: 20_000 });
    await page.waitForTimeout(700);

    const inspection = await host.evaluate((element) => {
      const hostElement = element;
      const canvas = hostElement.querySelector("canvas");
      const hostBox = hostElement.getBoundingClientRect();
      const canvasBox = canvas?.getBoundingClientRect();
      return {
        dataset: { ...hostElement.dataset },
        hostBox: { x: hostBox.x, y: hostBox.y, width: hostBox.width, height: hostBox.height },
        canvasBox: canvasBox ? { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height } : null,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        forbiddenExploded: [...document.querySelectorAll("button")].some((button) => /Explodida|Montada/.test(button.textContent ?? "")),
        bodyToggle: [...document.querySelectorAll("button, input, label")].some((node) => /ocultar corpo|mostrar corpo/i.test(node.textContent ?? "")),
      };
    });

    const instanceCount = Number(inspection.dataset.garmentInstanceCount);
    const errorCount = Number(inspection.dataset.arrangementErrorCount);
    if (inspection.dataset.avatarVisible !== "true") throw new Error(`${scenario.label}: avatar não marcado como visível`);
    if (inspection.dataset.frameTarget !== "avatar-and-garment") throw new Error(`${scenario.label}: enquadramento não usa avatar e roupa`);
    if (instanceCount !== scenario.expectedInstances) throw new Error(`${scenario.label}: ${instanceCount} instâncias, esperado ${scenario.expectedInstances}`);
    if (errorCount !== 0) throw new Error(`${scenario.label}: ${errorCount} diagnósticos de erro`);
    if (!inspection.canvasBox || inspection.canvasBox.width < 240 || inspection.canvasBox.height < 300) throw new Error(`${scenario.label}: canvas sem área adequada`);
    if (inspection.bodyWidth > inspection.viewportWidth + 1) throw new Error(`${scenario.label}: overflow horizontal ${inspection.bodyWidth - inspection.viewportWidth}px`);
    if (inspection.forbiddenExploded) throw new Error(`${scenario.label}: modo montado/explodido ainda visível`);
    if (inspection.bodyToggle) throw new Error(`${scenario.label}: controle público de corpo ainda visível`);
    if (consoleErrors.length || pageErrors.length || failedRequests.length) {
      throw new Error(`${scenario.label}: erros ${JSON.stringify({ consoleErrors, pageErrors, failedRequests })}`);
    }

    const screenshot = `${scenario.label}.png`;
    await page.screenshot({ path: `${artifactDir}/${screenshot}`, fullPage: false });
    results.push({
      ...scenario,
      status: "passed",
      inspection,
      consoleErrors,
      pageErrors,
      failedRequests,
      screenshot,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const report = {
  browserVersion: await chromium.executablePath?.(),
  baseUrl,
  physicalDeviceValidated: false,
  physicalDrapeClaimed: false,
  results,
};
await writeFile(`${artifactDir}/prompt09-browser-audit.json`, JSON.stringify(report, null, 2));
await writeFile(`${artifactDir}/prompt09-browser-audit.md`, [
  "# Auditoria do manequim vestido",
  "",
  "| Cenário | Template | Viewport | Avatar | Instâncias | Erros de arranjo | Overflow |",
  "|---|---|---:|---:|---:|---:|---:|",
  ...results.map((result) => `| ${result.label} | ${result.template} | ${result.viewport.width}×${result.viewport.height} | ${result.inspection.dataset.avatarVisible} | ${result.inspection.dataset.garmentInstanceCount} | ${result.inspection.dataset.arrangementErrorCount} | ${Math.max(0, result.inspection.bodyWidth - result.inspection.viewportWidth)} px |`),
  "",
  "O fluxo abriu um molde-base, solicitou Vestir no manequim e validou avatar, instâncias, enquadramento, ausência de controles explodidos/corpo ocultável e ausência de erros de navegador.",
  "A inspeção mobile usa emulação Chromium. Não houve aparelho físico, Safari, XPBD ou validação de caimento.",
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
