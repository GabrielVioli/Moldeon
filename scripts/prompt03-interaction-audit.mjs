import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PROMPT03_BASE_URL ?? "http://127.0.0.1:5173";
const label = process.env.PROMPT03_LABEL ?? "fallback";
const artifactRoot = resolve(process.env.PROMPT03_ARTIFACT_DIR ?? "artifacts/prompt03-editor");
const outputDirectory = resolve(artifactRoot, "interactions", label);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {
  label,
  baseUrl,
  generatedAt: new Date().toISOString(),
  browserVersion: browser.version(),
  scenarios: [],
};

try {
  await scenario("point-straight-mouse", desktop(1366, 768), (page) => auditPoint(page, "free-simple-piece", "mouse"));
  await scenario("point-curve-mouse", desktop(1366, 768), (page) => auditPoint(page, "bezier-piece", "mouse"));
  await scenario("point-zoomed-mouse", desktop(1366, 768), (page) => auditPoint(page, "free-simple-piece", "mouse", { zoom: true }));
  await scenario("point-transformed-mouse", desktop(1366, 768), (page) => auditPoint(page, "free-simple-piece", "mouse", { move: true }));
  await scenario("point-straight-touch", mobile(390, 844), (page) => auditPoint(page, "free-simple-piece", "touch"));
  await scenario("touch-does-not-move-piece-on-tap", mobile(390, 844), auditTouchTapSafety);
  await scenario("selection-and-shortcuts", desktop(1366, 768), auditSelection);
  await scenario("piece-popover-dismissal", desktop(1366, 768), auditPiecePopover);
  await scenario("seam-lifecycle", desktop(1366, 768), auditSeamLifecycle);
  await scenario("measurements-desktop-1366", desktop(1366, 768), auditMeasurements);
  await scenario("measurements-desktop-1920", desktop(1920, 1080), auditMeasurements);
  await scenario("measurements-mobile-360", mobile(360, 800), auditMeasurements);
  await scenario("measurements-mobile-390", mobile(390, 844), auditMeasurements);
} finally {
  await browser.close();
}

const failed = report.scenarios.filter((entry) => entry.status !== "passed");
await Promise.all([
  writeFile(resolve(outputDirectory, "prompt03-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(resolve(outputDirectory, "prompt03-audit.md"), renderMarkdown(report), "utf8"),
]);
console.log(renderMarkdown(report));
if (failed.length > 0) process.exitCode = 1;

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
    await page.waitForTimeout(250);
    result = await audit(page);
    await page.screenshot({ path: resolve(outputDirectory, `${name}.png`), fullPage: false });
  } catch (reason) {
    status = "failed";
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-failed.png`), fullPage: false }).catch(() => undefined);
  } finally {
    report.scenarios.push({ name, status, result, error, consoleMessages, pageErrors });
    await context.close();
  }
}

async function auditPoint(page, fixtureId, input, options = {}) {
  await loadFixture(page, fixtureId);
  await fitAll(page);
  if (options.move) {
    await page.evaluate(() => {
      const bridge = window.__moldeonPhase0;
      const pieceId = bridge?.state().pieces[0]?.id;
      if (bridge && pieceId) bridge.movePiece(pieceId, 180, 120);
    });
    await fitAll(page);
  }
  const canvas = canvas2d(page);
  if (options.zoom) {
    await canvas.hover();
    await page.mouse.wheel(0, -800);
    await page.waitForTimeout(100);
  }

  const before = await state(page);
  await page.getByRole("button", { name: "+ Ponto", exact: true }).click();
  const insertion = await scanForInsertion(page, input === "touch", before.pieces[0].pointCount);
  assert(insertion.inserted, `Não inseriu ponto em ${fixtureId} com ${input}.`);
  const inserted = await state(page);
  assert(inserted.pieces[0].pointCount === before.pieces[0].pointCount + 1, "Contagem após inserção incorreta.");

  const undo = page.getByRole("button", { name: "Desfazer" });
  assert(!(await undo.isDisabled()), "Undo ficou indisponível após criar ponto.");
  await undo.click();
  await page.waitForTimeout(60);
  const undone = await state(page);
  assert(undone.pieces[0].pointCount === before.pieces[0].pointCount, "Undo não removeu o ponto.");

  const redo = page.getByRole("button", { name: "Refazer" });
  assert(!(await redo.isDisabled()), "Redo ficou indisponível após undo.");
  await redo.click();
  await page.waitForTimeout(60);
  const redone = await state(page);
  assert(redone.pieces[0].pointCount === before.pieces[0].pointCount + 1, "Redo não restaurou o ponto.");
  return { fixtureId, input, options, insertion, before: before.pieces[0].pointCount, inserted: inserted.pieces[0].pointCount, undone: undone.pieces[0].pointCount, redone: redone.pieces[0].pointCount };
}

async function auditTouchTapSafety(page) {
  await loadFixture(page, "free-simple-piece");
  await fitAll(page);
  const before = await state(page);
  const box = await visibleCanvasBox(page);
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(100);
  const after = await state(page);
  assert(after.pieces[0].xMm === before.pieces[0].xMm, "Tap touch alterou X da peça.");
  assert(after.pieces[0].yMm === before.pieces[0].yMm, "Tap touch alterou Y da peça.");
  assert(after.pieces[0].pointCount === before.pieces[0].pointCount, "Tap touch criou ponto fora da ferramenta de ponto.");
  return { before: before.pieces[0], after: after.pieces[0] };
}

async function auditSelection(page) {
  await loadFixture(page, "tshirt-standard");
  const pieceButton = page.locator(".pieces-name").first();
  await pieceButton.click();
  assert((await state(page)).pieceSelectionActive, "Clique na peça não selecionou.");

  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
  assert((await state(page)).pieceSelectionActive, "Toolbar limpou seleção relacionada.");
  await page.locator(".pieces-panel header").click();
  assert((await state(page)).pieceSelectionActive, "Painel relacionado limpou seleção.");

  const canvas = canvas2d(page);
  const box = await visibleCanvasBox(page);
  await page.mouse.click(box.x + 6, box.y + 6);
  await page.waitForTimeout(60);
  assert(!(await state(page)).pieceSelectionActive, "Clique vazio não limpou seleção.");

  await canvas.focus();
  await page.keyboard.press("Control+A");
  const selectedAll = await state(page);
  assert(selectedAll.selectedPieceIds.length === selectedAll.pieces.length, "Ctrl+A não selecionou todas as peças.");

  const beforeZoom = await canvas.boundingBox();
  await canvas.hover();
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(80);
  const afterZoom = await canvas.boundingBox();
  assert(Boolean(beforeZoom && afterZoom && afterZoom.width > 0), "Zoom invalidou o canvas.");
  return { selectedAll: selectedAll.selectedPieceIds, pieceCount: selectedAll.pieces.length };
}

async function auditPiecePopover(page) {
  await loadFixture(page, "tshirt-standard");
  const trigger = page.locator(".pieces-more").first();
  const menu = page.locator(".pieces-popover");

  await trigger.click();
  assert(await menu.isVisible(), "Menu não abriu.");
  await trigger.click();
  assert(!(await menu.isVisible()), "Segundo clique não fechou o menu.");

  await trigger.click();
  const box = await visibleCanvasBox(page);
  await page.mouse.click(box.x + 5, box.y + 5);
  assert(!(await menu.isVisible()), "Clique fora não fechou o menu.");

  await trigger.click();
  await page.keyboard.press("Escape");
  assert(!(await menu.isVisible()), "Escape não fechou o menu.");
  assert(await trigger.evaluate((element) => document.activeElement === element), "Foco não retornou ao gatilho.");

  await trigger.click();
  const beforeDuplicate = (await state(page)).pieces.length;
  await menu.getByRole("menuitem", { name: "Duplicar", exact: true }).click();
  assert(!(await menu.isVisible()), "Ação não fechou o menu.");
  assert((await state(page)).pieces.length === beforeDuplicate + 1, "Ação do menu não foi executada.");

  await page.locator(".pieces-more").first().click();
  await page.getByRole("button", { name: "+ Ponto", exact: true }).click();
  assert(!(await menu.isVisible()), "Troca de ferramenta não fechou o menu.");
  return { duplicatedFrom: beforeDuplicate, duplicatedTo: (await state(page)).pieces.length };
}

async function auditSeamLifecycle(page) {
  await loadFixture(page, "equal-length-seam");
  await page.getByRole("button", { name: "Montagem", exact: true }).click();
  await page.waitForTimeout(100);
  const row = page.locator(".seam-editor-row").first();
  assert(await row.isVisible(), "Linha de costura não apareceu.");
  await row.getByRole("button", { name: /Selecionar costura/i }).click();
  const selected = await state(page);
  assert(Boolean(selected.selectedSeamId), "Clique na lista não selecionou a costura.");

  await row.getByRole("button", { name: "Desativar" }).click();
  assert((await state(page)).seams[0].active === false, "Costura não foi desativada.");
  await row.getByRole("button", { name: "Reativar" }).click();
  assert((await state(page)).seams[0].active === true, "Costura não foi reativada.");

  const initialDirection = (await state(page)).seams[0].direction;
  await row.getByRole("button", { name: "Inverter" }).click();
  assert((await state(page)).seams[0].direction !== initialDirection, "Direção não foi invertida.");

  const before = (await state(page)).seamCount;
  await row.getByRole("button", { name: "Excluir" }).click();
  assert((await state(page)).seamCount === before - 1, "Costura não foi removida.");
  await page.getByRole("button", { name: "Desfazer" }).click();
  assert((await state(page)).seamCount === before, "Undo não recuperou a costura.");
  await page.getByRole("button", { name: "Refazer" }).click();
  assert((await state(page)).seamCount === before - 1, "Redo não removeu novamente a costura.");
  return { initialDirection, before, afterRedo: (await state(page)).seamCount };
}

async function auditMeasurements(page) {
  await loadFixture(page, "tshirt-standard");
  const isMobile = await page.evaluate(() => matchMedia("(max-width: 760px)").matches);
  if (isMobile) {
    await page.getByRole("tab", { name: "Medidas" }).click();
    await page.waitForTimeout(80);
  }
  const section = page.locator(".measurement-panel-section");
  const details = section.locator("details").first();
  await details.locator(":scope > summary").click();
  const mainGroup = section.locator(".measurement-groups details").first();
  if (!(await mainGroup.evaluate((element) => element.open))) await mainGroup.locator(":scope > summary").click();
  const input = section.locator("input[type=number]").first();
  assert(await input.isVisible(), "Campo de medida não ficou acessível.");
  const original = Number(await input.inputValue());
  await input.fill(String(original + 1));
  await input.press("Enter");
  assert(Number(await input.inputValue()) === original + 1, "Medida não foi atualizada.");
  await page.getByRole("button", { name: "Desfazer" }).click();
  await page.waitForTimeout(60);

  const layout = await page.evaluate(() => {
    const canvas = document.querySelector(".canvas-stack");
    const inspector = document.querySelector(".inspector");
    const canvasRect = canvas?.getBoundingClientRect();
    const inspectorRect = inspector?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvas: canvasRect ? { width: canvasRect.width, height: canvasRect.height } : null,
      inspector: inspectorRect ? { left: inspectorRect.left, top: inspectorRect.top, width: inspectorRect.width, height: inspectorRect.height, bottom: inspectorRect.bottom } : null,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  assert(layout.inspector && layout.inspector.width > 0, "Painel de medidas sem área.");
  assert(!layout.overflowX, "Painel de medidas criou overflow horizontal.");
  if (isMobile) {
    assert(layout.inspector.bottom <= layout.viewport.height + 1, "Bottom sheet saiu da viewport.");
    assert(layout.inspector.height < layout.viewport.height * 0.72, "Bottom sheet bloqueou a bancada inteira.");
  } else {
    assert(layout.canvas && layout.canvas.width > 350, "Painel de medidas comprimiu excessivamente a bancada.");
    assert(layout.inspector.width <= 445, "Painel desktop excedeu a largura compacta.");
  }
  return { isMobile, original, layout };
}

async function loadFixture(page, fixtureId) {
  await page.evaluate((id) => {
    const bridge = window.__moldeonPhase0;
    if (!bridge) throw new Error("Ponte de auditoria não instalada.");
    bridge.loadFixture(id);
  }, fixtureId);
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "Modelagem", exact: true }).click();
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
}

async function fitAll(page) {
  const button = page.getByRole("button", { name: "Enquadrar tudo", exact: true });
  if (await button.count()) await button.click();
  await page.waitForTimeout(80);
}

async function scanForInsertion(page, touch, initialPointCount) {
  const box = await visibleCanvasBox(page);
  const candidates = coordinates(box);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (touch) await page.touchscreen.tap(candidate.x, candidate.y);
    else await page.mouse.click(candidate.x, candidate.y);
    await page.waitForTimeout(12);
    const count = (await state(page)).pieces[0].pointCount;
    if (count === initialPointCount + 1) return { inserted: true, attempts: index + 1, ...candidate };
  }
  return { inserted: false, attempts: candidates.length };
}

function coordinates(box) {
  const values = [0.08, 0.12, 0.16, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.84, 0.88, 0.92];
  const bands = [0.08, 0.12, 0.16, 0.2, 0.8, 0.84, 0.88, 0.92];
  const result = [];
  for (const value of values) {
    for (const band of bands) {
      result.push({ x: box.x + box.width * value, y: box.y + box.height * band });
      result.push({ x: box.x + box.width * band, y: box.y + box.height * value });
    }
  }
  for (let y = 0.26; y <= 0.74; y += 0.08) {
    for (let x = 0.26; x <= 0.74; x += 0.08) result.push({ x: box.x + box.width * x, y: box.y + box.height * y });
  }
  return result;
}

async function visibleCanvasBox(page) {
  const box = await canvas2d(page).boundingBox();
  if (!box || box.width < 1 || box.height < 1) throw new Error("Canvas 2D sem área visível.");
  return box;
}

function canvas2d(page) {
  return page.locator(".canvas-stack canvas").first();
}

function state(page) {
  return page.evaluate(() => {
    const bridge = window.__moldeonPhase0;
    if (!bridge) throw new Error("Ponte de auditoria não instalada.");
    return bridge.state();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function desktop(width, height) {
  return { viewport: { width, height }, deviceScaleFactor: 1 };
}

function mobile(width, height) {
  return { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
}

function renderMarkdown(audit) {
  const rows = audit.scenarios.map((entry) => `| ${entry.name} | ${entry.status} | ${entry.consoleMessages.length + entry.pageErrors.length} |`).join("\n");
  return `# Auditoria do editor: ${audit.label}\n\nChromium ${audit.browserVersion}\n\n| Cenário | Resultado | Console |\n|---|---|---:|\n${rows}\n`;
}
