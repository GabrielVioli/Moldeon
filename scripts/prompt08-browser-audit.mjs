import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROMPT08_BASE_URL ?? "http://127.0.0.1:4178";
const artifactDirectory = resolve(process.env.PROMPT08_ARTIFACT_DIR ?? "artifacts/prompt08-sleeves");
const executableCandidates = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const executablePath = executableCandidates.find((candidate) => existsSync(candidate));
if (!executablePath) {
  throw new Error(`Nenhum Chrome do sistema encontrado: ${executableCandidates.join(", ")}`);
}

await mkdir(artifactDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];

try {
  for (const scenario of [
    { label: "desktop", viewport: { width: 1440, height: 960 }, sleeveType: "short", mobile: false },
    { label: "mobile", viewport: { width: 390, height: 844 }, sleeveType: "long", mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      deviceScaleFactor: 1,
      hasTouch: scenario.mobile,
      isMobile: scenario.mobile,
      locale: "pt-BR",
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const unexpectedDialogs = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText ?? "falha"}`));
    page.on("dialog", async (dialog) => {
      unexpectedDialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });

    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator(".toolbar").waitFor({ state: "visible" });
    await chooseBodice(page);

    const sleeveButton = page.getByTestId("open-sleeve-wizard");
    await waitForEnabled(sleeveButton, 20_000);
    const sleeveButtonBox = await sleeveButton.boundingBox();
    const buttonInViewport = Boolean(
      sleeveButtonBox &&
      sleeveButtonBox.x >= -1 &&
      sleeveButtonBox.y >= -1 &&
      sleeveButtonBox.x + sleeveButtonBox.width <= scenario.viewport.width + 1 &&
      sleeveButtonBox.y + sleeveButtonBox.height <= scenario.viewport.height + 1,
    );
    if (!buttonInViewport) {
      throw new Error(`${scenario.label}: botão Adicionar manga não está acessível na viewport ${JSON.stringify(sleeveButtonBox)}`);
    }
    await sleeveButton.click();

    const wizard = page.getByTestId("sleeve-wizard");
    await wizard.waitFor({ state: "visible" });
    await assertText(page, "Confirme o corpo e as cavas");
    await assertText(page, "Cava frontal");
    await assertText(page, "Cava traseira");
    await page.screenshot({
      path: resolve(artifactDirectory, `${scenario.label}-wizard-body.png`),
      fullPage: false,
      animations: "disabled",
    });

    const bodyConfirmation = page.getByTestId("sleeve-confirm-body");
    if (!(await bodyConfirmation.isChecked())) await bodyConfirmation.check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await assertText(page, "Escolha o comprimento inicial");
    if (scenario.sleeveType === "long") {
      await page.getByTestId("sleeve-type-long").click();
    } else {
      await page.getByTestId("sleeve-type-short").click();
    }
    await page.getByRole("button", { name: "Configurar" }).click();
    await assertText(page, "Configuração geométrica");

    const bicepField = page.getByTestId("sleeve-bicep");
    const initialBicep = Number(await bicepField.inputValue());
    await bicepField.fill(String(initialBicep + 12));
    await bicepField.blur();
    const compatibilityBeforeFit = await page.locator(".sleeve-compatibility-summary").first().textContent();
    if (!compatibilityBeforeFit || /incompatível/i.test(compatibilityBeforeFit)) {
      throw new Error(`${scenario.label}: configuração padrão ficou incompatível: ${compatibilityBeforeFit}`);
    }
    await page.screenshot({
      path: resolve(artifactDirectory, `${scenario.label}-wizard-settings.png`),
      fullPage: false,
      animations: "disabled",
    });

    await page.getByTestId("sleeve-view-fit").click();
    const fitStep = page.getByTestId("sleeve-fit-step");
    await fitStep.waitFor({ state: "visible" });
    for (const label of [
      "Pique frontal",
      "Primeiro pique traseiro",
      "Segundo pique traseiro",
      "Ombro frontal ↔ ápice",
      "Ombro traseiro ↔ ápice",
    ]) {
      await assertText(page, label);
    }
    const fitDiagram = page.locator(".sleeve-fit-diagram");
    const fitBounds = await fitDiagram.boundingBox();
    if (!fitBounds || fitBounds.width < 260 || fitBounds.height < 250) {
      throw new Error(`${scenario.label}: mini diagrama inválido ${JSON.stringify(fitBounds)}`);
    }
    const fitStatusText = await page.locator(".sleeve-compatibility-summary").textContent();
    const dialogOverflow = await wizard.evaluate((element) => ({
      horizontal: element.scrollWidth - element.clientWidth,
      vertical: element.scrollHeight - element.clientHeight,
    }));
    if (dialogOverflow.horizontal > 2) {
      throw new Error(`${scenario.label}: assistente possui overflow horizontal de ${dialogOverflow.horizontal}px`);
    }
    await page.screenshot({
      path: resolve(artifactDirectory, `${scenario.label}-fit.png`),
      fullPage: false,
      animations: "disabled",
    });

    await page.getByTestId("sleeve-confirm").click();
    await wizard.waitFor({ state: "hidden", timeout: 20_000 });
    const expectedName = scenario.sleeveType === "long" ? "Manga longa guiada" : "Manga curta guiada";
    const createdPiece = page.locator(".pieces-item").filter({ hasText: expectedName }).first();
    await createdPiece.waitFor({ state: "visible", timeout: 20_000 });
    const undoButton = page.locator(".history-button").first();
    if (await undoButton.isDisabled()) {
      throw new Error(`${scenario.label}: criação não habilitou undo`);
    }
    await page.screenshot({
      path: resolve(artifactDirectory, `${scenario.label}-created.png`),
      fullPage: false,
      animations: "disabled",
    });

    const appOverflow = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    if (appOverflow.width > appOverflow.viewport + 2) {
      throw new Error(`${scenario.label}: aplicação excedeu a viewport em ${appOverflow.width - appOverflow.viewport}px`);
    }
    if (consoleErrors.length || pageErrors.length || unexpectedDialogs.length) {
      throw new Error(`${scenario.label}: erros detectados ${JSON.stringify({ consoleErrors, pageErrors, unexpectedDialogs })}`);
    }

    results.push({
      label: scenario.label,
      viewport: scenario.viewport,
      sleeveType: scenario.sleeveType,
      status: "passed",
      sleeveButtonBox,
      buttonInViewport,
      fitBounds,
      fitStatusText: fitStatusText?.replace(/\s+/g, " ").trim(),
      dialogOverflow,
      appOverflow,
      consoleErrors,
      pageErrors,
      failedRequests,
      unexpectedDialogs,
      screenshots: [
        `${scenario.label}-wizard-body.png`,
        `${scenario.label}-wizard-settings.png`,
        `${scenario.label}-fit.png`,
        `${scenario.label}-created.png`,
      ],
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const report = {
  browserVersion: browser.version(),
  browserExecutable: executablePath,
  baseUrl,
  physicalDeviceValidated: false,
  threeDimensionalDrapeUsedAsEvidence: false,
  results,
};
await writeFile(resolve(artifactDirectory, "prompt08-browser-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(artifactDirectory, "prompt08-browser-audit.md"), [
  "# Auditoria de navegador do Prompt 8",
  "",
  `Chrome: ${report.browserVersion}`,
  "",
  "| Cenário | Tipo | Estado | Overflow horizontal | Erros de console |",
  "|---|---|---:|---:|---:|",
  ...results.map((result) => `| ${result.label} | ${result.sleeveType} | ${result.status} | ${result.dialogOverflow.horizontal}px | ${result.consoleErrors.length} |`),
  "",
  "O fluxo real abriu a biblioteca, criou um corpo básico, percorreu as quatro etapas, alterou o bíceps, abriu o encaixe 2D e confirmou a manga.",
  "A inspeção não afirma validação em aparelho físico nem caimento 3D.",
  "",
].join("\n"));

async function chooseBodice(page) {
  const libraryButton = page.getByRole("button", { name: "Moldes" });
  await libraryButton.click();
  const dialog = page.locator(".pattern-library-dialog");
  await dialog.waitFor({ state: "visible" });
  const card = page.locator("button.template-card").filter({ hasText: "Corpo básico" }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
}

async function waitForEnabled(locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  while (Date.now() < deadline) {
    if (!(await locator.isDisabled())) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("O botão Adicionar manga permaneceu desabilitado.");
}

async function assertText(page, text) {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: 15_000 });
}
