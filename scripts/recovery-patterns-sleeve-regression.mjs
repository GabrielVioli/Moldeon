import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4173";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-9-5-06";
const executablePath = process.env.CHROME_PATH
  ?? (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "/usr/bin/google-chrome");

await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const report = { passed: false, desktop: {}, mobile: {}, errors: [] };

try {
  report.desktop = await desktopJourney(browser);
  report.mobile = await mobileJourney(browser);
  report.passed = report.errors.length === 0
    && report.desktop.library?.passed
    && report.desktop.cancel?.passed
    && report.desktop.template?.passed
    && report.desktop.wizard?.passed
    && report.desktop.history?.passed
    && report.desktop.persistence?.passed
    && report.mobile?.passed;
} catch (error) {
  report.errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

async function desktopJourney(currentBrowser) {
  const context = await currentBrowser.newContext({ viewport: { width: 1440, height: 980 }, locale: "pt-BR" });
  const page = await context.newPage();
  const consoleErrors = collectErrors(page);
  const result = {};

  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Moldes essenciais" });
  await dialog.waitFor();
  const jacket = page.getByRole("button", { name: /Jaqueta básica/ });
  const tshirt = page.getByRole("button", { name: /Camiseta básica/ });
  result.library = {
    heading: await dialog.getByRole("heading", { name: "Moldes essenciais" }).isVisible(),
    cardCount: await dialog.locator(".template-card").count(),
    jacketDisabled: await jacket.isDisabled(),
    jacketExplainsWhy: /Indisponível|bloco próprio/i.test(await jacket.innerText()),
    tshirtConfidence: /Validado geometricamente/i.test(await tshirt.innerText()),
    tshirtVersion: /tshirt@3/i.test(await tshirt.innerText()),
    noHorizontalOverflow: await noHorizontalOverflow(page),
  };
  result.library.passed = Object.values(result.library).every(Boolean);
  await page.screenshot({ path: `${artifactDir}/desktop-library.png`, fullPage: true });

  await tshirt.click();
  const contract = dialog.locator(".template-contract");
  await contract.waitFor();
  result.library.contract = {
    confidence: /Validado geometricamente/i.test(await contract.innerText()),
    method: /Bloco superior de referência Moldeon/i.test(await contract.innerText()),
    identity: /tshirt@3/i.test(await contract.innerText()),
  };
  result.library.passed = result.library.passed && Object.values(result.library.contract).every(Boolean);

  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  result.cancel = {
    unchanged: await page.evaluate(async () => {
      const { useEditorStore } = await import("/src/state/editorStore.ts");
      return useEditorStore.getState().garment.templateId !== "tshirt";
    }),
  };
  result.cancel.passed = result.cancel.unchanged;

  await chooseTemplate(page, "Camiseta básica", async (libraryDialog) => {
    const bust = libraryDialog.getByRole("spinbutton", { name: /Busto ou tórax em cm/i });
    await bust.fill("98");
    await bust.press("Enter");
  });
  await page.locator(".pieces-item").filter({ hasText: "Manga curta guiada" }).waitFor();
  result.template = await inspectTemplate(page);
  result.template.passed = result.template.pieceCount === 3
    && result.template.bustMm === 980
    && result.template.sleeveCount === 1
    && /curta guiada/i.test(result.template.sleeveName);
  await page.screenshot({ path: `${artifactDir}/desktop-tshirt-workspace.png`, fullPage: true });

  const openWizard = page.getByTestId("open-sleeve-wizard");
  if (!await openWizard.isEnabled()) throw new Error("O assistente de manga ficou indisponível para uma camiseta válida.");
  await openWizard.click();
  await page.getByTestId("sleeve-wizard").waitFor();
  const beforeCancel = await inspectTemplate(page);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByTestId("sleeve-wizard").waitFor({ state: "detached" });
  const afterCancel = await inspectTemplate(page);
  result.cancel.wizardPreservedBody = beforeCancel.signature === afterCancel.signature;
  result.cancel.passed = result.cancel.passed && result.cancel.wizardPreservedBody;

  await openWizard.click();
  await page.getByTestId("sleeve-replace-existing").check();
  const sourceText = await page.locator(".sleeve-body-step").innerText();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByTestId("sleeve-type-long").click();
  await page.getByRole("button", { name: "Configurar", exact: true }).click();
  const lengthInput = page.getByTestId("sleeve-length");
  const initialLength = Number(await lengthInput.inputValue());
  await lengthInput.fill(String(initialLength - 35));
  await lengthInput.press("Tab");
  const bicepInput = page.getByTestId("sleeve-bicep");
  const initialBicep = Number(await bicepInput.inputValue());
  await bicepInput.fill(String(initialBicep + 20));
  await bicepInput.press("Tab");
  const settingsStatus = await page.locator(".sleeve-compatibility-summary").innerText();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  const returnedToType = await page.getByTestId("sleeve-type-long").isVisible();
  await page.getByRole("button", { name: "Configurar", exact: true }).click();
  const settingsPreserved = Number(await page.getByTestId("sleeve-length").inputValue()) === initialLength - 35;
  await page.getByTestId("sleeve-view-fit").click();
  await page.getByTestId("sleeve-fit-step").waitFor();
  const fitText = await page.getByTestId("sleeve-fit-step").innerText();
  const confirm = page.getByTestId("sleeve-confirm");
  const confirmEnabled = await confirm.isEnabled();
  await page.screenshot({ path: `${artifactDir}/desktop-sleeve-fit.png`, fullPage: true });
  await confirm.click();
  await page.getByTestId("sleeve-wizard").waitFor({ state: "detached" });
  const afterReplace = await inspectTemplate(page);
  result.wizard = {
    sourceExplained: /arco|cava frontal|cava traseira|ombro|axila/i.test(sourceText),
    explicitReplacement: true,
    settingsStatus: /Encaixe dentro da tolerância|Encaixe exige atenção/i.test(settingsStatus),
    returnedToType,
    settingsPreserved,
    fitExplained: /Cava frontal|Cabeça frontal|Cava traseira|Cabeça traseira|ápice|pique/i.test(fitText),
    confirmEnabled,
    oneSleeveAfterReplace: afterReplace.sleeveCount === 1,
    longSleeveCreated: /longa/i.test(afterReplace.sleeveName),
  };
  result.wizard.passed = Object.values(result.wizard).every(Boolean);

  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  const afterUndo = await inspectTemplate(page);
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  const afterRedo = await inspectTemplate(page);
  result.history = {
    undoRestoredShort: /curta/i.test(afterUndo.sleeveName),
    redoRestoredLong: /longa/i.test(afterRedo.sleeveName),
    bodyPreserved: afterUndo.pieceCount === 3 && afterRedo.pieceCount === 3,
  };
  result.history.passed = Object.values(result.history).every(Boolean);

  await page.waitForTimeout(1_800);
  const savedBeforeReload = await inspectAutosave(page);
  const autosaveStatusBeforeReload = await page.locator(".status-bar").innerText();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".app-shell[aria-busy='false']").waitFor();
  const restored = await inspectTemplate(page);
  result.persistence = {
    template: savedBeforeReload.templateVersion === "tshirt@3",
    measurement: restored.bustMm === 980,
    sleeve: /longa/i.test(restored.sleeveName),
    methodology: savedBeforeReload.methodologyId === "moldeon-upper-block",
    savedSleeve: savedBeforeReload.sleeveName,
    restoredSleeve: restored.sleeveName,
    autosaveStatus: autosaveStatusBeforeReload,
  };
  result.persistence.passed = Object.values(result.persistence).every(Boolean);
  result.consoleErrors = consoleErrors;
  if (consoleErrors.length > 0) throw new Error(`Erros no console desktop: ${consoleErrors.join("\n")}`);
  await context.close();
  return result;
}

async function mobileJourney(currentBrowser) {
  const context = await currentBrowser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR" });
  const page = await context.newPage();
  const consoleErrors = collectErrors(page);
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Moldes essenciais" });
  await dialog.waitFor();
  const libraryBounds = await bounds(dialog);
  const libraryNoOverflow = await noHorizontalOverflow(page);
  await page.screenshot({ path: `${artifactDir}/mobile-library.png`, fullPage: true });
  await page.getByRole("button", { name: /Camiseta básica/ }).click();
  const contractVisible = await dialog.locator(".template-contract").isVisible();
  await dialog.getByRole("button", { name: "Criar molde", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByTestId("open-sleeve-wizard").click();
  const wizard = page.getByTestId("sleeve-wizard");
  await wizard.waitFor();
  const wizardBounds = await bounds(wizard);
  const wizardNoOverflow = await noHorizontalOverflow(page);
  const sourceControlsVisible = await page.getByTestId("sleeve-front-select").isVisible()
    && await page.getByTestId("sleeve-back-select").isVisible();
  await page.getByTestId("sleeve-replace-existing").check();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Configurar", exact: true }).click();
  const settingsVisible = await page.getByTestId("sleeve-length").isVisible();
  await page.getByTestId("sleeve-view-fit").click();
  const fitVisible = await page.getByTestId("sleeve-fit-step").isVisible();
  await page.screenshot({ path: `${artifactDir}/mobile-sleeve-fit.png`, fullPage: true });
  await page.getByRole("button", { name: "Fechar assistente de manga", exact: true }).click();
  const closed = await wizard.isHidden();
  const result = {
    libraryWithinViewport: insideViewport(libraryBounds, 390, 844),
    libraryNoOverflow,
    contractVisible,
    wizardWithinViewport: insideViewport(wizardBounds, 390, 844),
    wizardNoOverflow,
    sourceControlsVisible,
    settingsVisible,
    fitVisible,
    closeWorks: closed,
    consoleErrors,
  };
  result.passed = Object.entries(result).filter(([key]) => key !== "consoleErrors").every(([, value]) => value === true)
    && consoleErrors.length === 0;
  await context.close();
  return result;
}

async function chooseTemplate(page, name, beforeCreate) {
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Moldes essenciais" });
  await page.getByRole("button", { name: new RegExp(name, "i") }).first().click();
  if (beforeCreate) await beforeCreate(dialog);
  await dialog.getByRole("button", { name: "Criar molde", exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: 15_000 });
}

async function inspectTemplate(page) {
  const names = (await page.locator(".pieces-item .pieces-name span").allTextContents()).map((name) => name.trim());
  const bustValue = Number(await page.locator('.measurement-panel-section input[aria-label="Busto ou tórax em cm"]').inputValue());
  return {
    signature: JSON.stringify(await page.locator(".pieces-item").allInnerTexts()),
    pieceCount: names.length,
    sleeveCount: names.filter((name) => /manga/i.test(name)).length,
    sleeveName: names.find((name) => /manga/i.test(name)) ?? "",
    bustMm: bustValue * 10,
  };
}

async function inspectAutosave(page) {
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage/opfs.ts");
    const saved = await loadAutosave();
    if (saved?.document.kind !== "garment") return {};
    return {
      templateVersion: saved.document.garment.parametric?.templateVersion,
      methodologyId: saved.document.garment.parametric?.generations[0]?.methodology?.id,
      sleeveName: saved.document.garment.pieces.find((piece) => /manga/i.test(piece.name))?.name,
    };
  });
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /Autosave falhou/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function bounds(locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("Elemento sem dimensões visíveis.");
  return value;
}

function insideViewport(rect, width, height) {
  return rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1;
}
