import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PROMPT05_BASE_URL ?? "http://127.0.0.1:5190";
const outputDirectory = resolve(process.env.PROMPT05_ARTIFACT_DIR ?? "artifacts/prompt05-parametric");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {
  browserVersion: browser.version(),
  physicalDevicesValidated: false,
  scenarios: [],
};

await runScenario("desktop-1366-simple", { width: 1366, height: 768 }, false, false);
await runScenario("desktop-1920-advanced", { width: 1920, height: 1080 }, false, true);
await runScenario("mobile-390-simple", { width: 390, height: 844 }, true, false);
await runScenario("mobile-844-advanced", { width: 844, height: 390 }, true, true);
await browser.close();

const markdown = renderMarkdown(report);
await writeFile(resolve(outputDirectory, "prompt05-visual-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "prompt05-visual-audit.md"), markdown, "utf8");
console.log(markdown);
if (report.scenarios.some((scenario) => scenario.status !== "passed")) process.exitCode = 1;

async function runScenario(name, viewport, mobile, advanced) {
  const context = await browser.newContext({ viewport, locale: "pt-BR", colorScheme: "light", hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage();
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__moldeonPhase0), null, { timeout: 20_000 });
    await page.evaluate(() => window.__moldeonPhase0?.loadFixture("tshirt-standard"));
    await page.waitForTimeout(250);
    const responsiveTab = page.getByRole("tab", { name: /Medidas|Montagem/i }).last();
    if (await responsiveTab.count()) {
      await responsiveTab.click();
      await page.waitForTimeout(100);
    }
    const section = page.locator(".measurement-panel-section");
    const rootDetails = section.locator(":scope > details");
    if (!(await rootDetails.evaluate((element) => element.open))) await rootDetails.locator(":scope > summary").click();
    const general = section.locator(".measurement-groups details").first();
    if (!(await general.evaluate((element) => element.open))) await general.locator(":scope > summary").click();
    await expectVisible(section.locator(".measurement-origin").first(), "origem da medida");
    await expectVisible(section.locator("input[aria-label*='Altura']").first(), "campo de altura");

    if (advanced) {
      await section.getByRole("button", { name: "Modo avançado" }).click();
      const formula = section.locator("textarea[aria-label^='Fórmula de']").first();
      await expectVisible(formula, "campo de fórmula");
      const original = await formula.inputValue();
      const numericBefore = await section.locator("input[type=number]").first().inputValue();
      await formula.fill("bustMm / 0");
      await formula.blur();
      await expectVisible(section.locator(".formula-error").first(), "mensagem de fórmula inválida");
      const numericAfterInvalidFormula = await section.locator("input[type=number]").first().inputValue();
      assert(numericBefore === numericAfterInvalidFormula, "Uma fórmula inválida alterou valores autoritativos.");
      await formula.fill(original);
      await formula.blur();
      await section.locator(".formula-error").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
      const numericAfterRestore = await section.locator("input[type=number]").first().inputValue();
      assert(numericBefore === numericAfterRestore, "Restaurar a fórmula alterou uma medida autoritativa.");
    }

    const layout = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      form: (() => {
        const element = document.querySelector(".body-form");
        const rect = element?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width } : null;
      })(),
      inputs: document.querySelectorAll(".body-form input[type=number]").length,
      badges: document.querySelectorAll(".measurement-origin").length,
      formulas: document.querySelectorAll(".measurement-advanced textarea").length,
    }));
    assert(layout.form && layout.form.width > 0, "O formulário não possui área visível.");
    assert(layout.scrollWidth <= layout.width + 1, `Overflow horizontal: ${layout.scrollWidth} > ${layout.width}.`);
    assert(layout.inputs >= 8, `Somente ${layout.inputs} campos de medidas foram renderizados.`);
    assert(layout.badges >= 8, `Somente ${layout.badges} origens foram renderizadas.`);
    if (advanced) assert(layout.formulas > 0, "O modo avançado não exibiu fórmulas.");
    await page.screenshot({ path: resolve(outputDirectory, `${name}.png`), fullPage: false });
    report.scenarios.push({ name, status: "passed", diagnostics, layout });
  } catch (error) {
    await page.screenshot({ path: resolve(outputDirectory, `${name}-failed.png`), fullPage: false }).catch(() => undefined);
    report.scenarios.push({ name, status: "failed", diagnostics, error: error instanceof Error ? error.stack ?? error.message : String(error) });
  } finally {
    await context.close();
  }
}

async function expectVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  assert(await locator.isVisible(), `${label} não está visível.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function renderMarkdown(value) {
  return [
    "# Auditoria visual do Prompt 5",
    "",
    `Chromium ${value.browserVersion}`,
    "",
    "| Cenário | Resultado | Diagnósticos |",
    "|---|---|---:|",
    ...value.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.status} | ${scenario.diagnostics.length} |`),
    "",
    "A auditoria foi executada em Chromium headless. Não substitui inspeção em aparelho físico ou tecnologia assistiva real.",
    "",
  ].join("\n");
}
