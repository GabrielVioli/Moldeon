import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PROMPT04_BASE_URL ?? "http://127.0.0.1:5173";
const outputDirectory = resolve(process.env.PROMPT04_ARTIFACT_DIR ?? "artifacts/prompt04-internal-paths");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  browserVersion: browser.version(),
  scenarios: [],
};

try {
  await scenario("curved-cut-and-sew", { viewport: { width: 1366, height: 768 } }, auditCurvedCutAndSew);
  await scenario("structural-dart", { viewport: { width: 1366, height: 768 } }, auditStructuralDart);
  await scenario("internal-path-mobile", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, auditMobilePathDraft);
} finally {
  await browser.close();
}

const failures = report.scenarios.filter((entry) => entry.status !== "passed");
await Promise.all([
  writeFile(resolve(outputDirectory, "prompt04-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "prompt04-audit.md"), renderMarkdown(report), "utf8"),
]);
console.log(renderMarkdown(report));
if (failures.length > 0) process.exitCode = 1;

async function scenario(name, contextOptions, audit) {
  const context = await browser.newContext({ ...contextOptions, locale: "pt-BR", colorScheme: "light" });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let status = "passed";
  let result = null;
  let error = null;
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__moldeonPhase0), null, { timeout: 20_000 });
    result = await audit(page);
  } catch (reason) {
    status = "failed";
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-failed.png`), fullPage: false }).catch(() => undefined);
  } finally {
    report.scenarios.push({ name, status, result, error, consoleMessages, pageErrors });
    await context.close();
  }
}

async function auditCurvedCutAndSew(page) {
  await loadFixture(page, "free-simple-piece");
  await fitAll(page);
  await page.getByRole("button", { name: "Recortar", exact: true }).click();

  const first = await fixturePoint(page, -20, 60, 260, 180);
  const middle = await fixturePoint(page, 130, 132, 260, 180);
  const last = await fixturePoint(page, 280, 78, 260, 180);
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(middle.x, middle.y);
  await page.mouse.click(last.x, last.y);
  await page.keyboard.press("Enter");

  const context = page.locator(".context-bar");
  await context.getByText("Caminho interno", { exact: true }).waitFor();
  const purpose = context.getByRole("combobox", { name: "Finalidade do caminho interno" });
  await purpose.selectOption("cut-and-sew");
  await context.getByRole("button", { name: "Converter segmento para curva" }).click();

  const movedMiddle = await fixturePoint(page, 130, 112, 260, 180);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(movedMiddle.x, movedMiddle.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  await page.screenshot({ path: resolve(outputDirectory, "curved-path-edited.png"), fullPage: false });
  const apply = context.getByRole("button", { name: "Cortar e manter costurado" });
  assert(!(await apply.isDisabled()), "Corte curvo válido ficou indisponível.");
  await apply.click();
  await page.waitForTimeout(150);

  const applied = await state(page);
  assert(applied.pieces.length === 2, `Corte deveria produzir 2 peças, produziu ${applied.pieces.length}.`);
  assert(applied.seamCount >= 1, "Corte e costura não criou costura persistida.");
  await page.screenshot({ path: resolve(outputDirectory, "curved-cut-and-sew.png"), fullPage: false });

  const undo = page.getByRole("button", { name: "Desfazer" });
  await undo.click();
  await page.waitForTimeout(80);
  const undone = await state(page);
  assert(undone.pieces.length === 1, "Undo não restaurou a peça anterior ao corte.");
  const redo = page.getByRole("button", { name: "Refazer" });
  await redo.click();
  await page.waitForTimeout(80);
  const redone = await state(page);
  assert(redone.pieces.length === 2 && redone.seamCount >= 1, "Redo não reaplicou o corte e a costura.");
  return { before: 1, after: applied.pieces.length, seamCount: applied.seamCount, undoPieces: undone.pieces.length, redoPieces: redone.pieces.length };
}

async function auditStructuralDart(page) {
  await loadFixture(page, "free-simple-piece");
  await fitAll(page);
  await page.getByRole("button", { name: "Pence", exact: true }).click();

  const boundary = await fixturePoint(page, 130, 0, 260, 180);
  const apex = await fixturePoint(page, 130, 95, 260, 180);
  await page.mouse.click(boundary.x, boundary.y);
  await page.mouse.click(apex.x, apex.y);
  await page.keyboard.press("Enter");

  const context = page.locator(".context-bar");
  await context.getByText("Caminho interno", { exact: true }).waitFor();
  await page.screenshot({ path: resolve(outputDirectory, "dart-path.png"), fullPage: false });
  const close = context.getByRole("button", { name: "Fechar pence" });
  assert(!(await close.isDisabled()), "Pence geométrica válida ficou indisponível.");
  await close.click();
  await page.waitForTimeout(120);

  const applied = await state(page);
  assert(applied.pieces[0]?.dartCount === 1, "Fechamento não criou uma pence estrutural persistida.");
  await page.screenshot({ path: resolve(outputDirectory, "structural-dart.png"), fullPage: false });

  await page.getByRole("button", { name: "Desfazer" }).click();
  await page.waitForTimeout(80);
  assert((await state(page)).pieces[0]?.dartCount === 0, "Undo não removeu o fechamento da pence.");
  await page.getByRole("button", { name: "Refazer" }).click();
  await page.waitForTimeout(80);
  assert((await state(page)).pieces[0]?.dartCount === 1, "Redo não restaurou a pence estrutural.");
  return { dartCount: applied.pieces[0].dartCount, undoRedo: true };
}

async function auditMobilePathDraft(page) {
  await loadFixture(page, "free-simple-piece");
  await page.getByRole("tab", { name: "Molde" }).click().catch(() => undefined);
  await fitAll(page);
  await page.getByRole("button", { name: "Recortar", exact: true }).click();
  const first = await fixturePoint(page, -15, 55, 260, 180);
  const middle = await fixturePoint(page, 130, 125, 260, 180);
  await page.touchscreen.tap(first.x, first.y);
  await page.touchscreen.tap(middle.x, middle.y);
  const bar = page.locator(".context-bar");
  await bar.getByText(/Desenhando caminho/).waitFor();
  assert(await bar.getByText(/Enter confirma/).isVisible(), "Atalhos contextuais do caminho não ficaram visíveis no mobile.");
  await page.screenshot({ path: resolve(outputDirectory, "internal-path-mobile.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  assert(!(await bar.isVisible()), "Escape não cancelou o caminho incompleto no mobile.");
  return { draftVisible: true, cancelWorked: true };
}

async function loadFixture(page, fixtureId) {
  await page.evaluate((id) => window.__moldeonPhase0?.loadFixture(id), fixtureId);
  await page.waitForTimeout(120);
  await page.getByRole("button", { name: "Modelagem", exact: true }).click();
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
}

async function fitAll(page) {
  await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
  await page.waitForTimeout(80);
}

async function fixturePoint(page, xMm, yMm, widthMm, heightMm) {
  const box = await page.locator("canvas[aria-label='Editor de molde 2D']").boundingBox();
  if (!box) throw new Error("Canvas 2D não possui área visível.");
  const padding = 54;
  const zoom = Math.min(3, Math.max(0.15, Math.min((box.width - padding * 2) / widthMm, (box.height - padding * 2) / heightMm)));
  return {
    x: box.x + box.width / 2 + (xMm - widthMm / 2) * zoom,
    y: box.y + box.height / 2 + (yMm - heightMm / 2) * zoom,
  };
}

async function state(page) {
  return page.evaluate(() => {
    const bridge = window.__moldeonPhase0;
    if (!bridge) throw new Error("Ponte de auditoria ausente.");
    return bridge.state();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function renderMarkdown(value) {
  const rows = value.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.status} | ${scenario.consoleMessages.length + scenario.pageErrors.length} |`);
  return `# Auditoria Prompt 04\n\nChromium ${value.browserVersion}\n\n| Cenário | Resultado | Console |\n|---|---|---:|\n${rows.join("\n")}\n`;
}
