import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.UI_REGRESSION_BASE_URL ?? "http://127.0.0.1:5187";
const outputDirectory = resolve(process.env.UI_REGRESSION_ARTIFACT_DIR ?? "artifacts/ui-regression-fix");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
const report = {
  browserVersion,
  physicalTrackpadValidated: false,
  scenarios: [],
  viewports: ["1366x768", "1920x1080", "390x844", "844x390"],
};

await runDesktop1366();
await runDesktop1920();
await runMobilePortrait();
await runMobileLandscape();
await browser.close();

await writeFile(resolve(outputDirectory, "ui-regression-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "ui-regression-audit.md"), renderMarkdown(report), "utf8");
console.log(renderMarkdown(report));

if (report.scenarios.some((scenario) => scenario.status !== "passed")) {
  throw new Error(`Auditoria de regressões falhou: ${JSON.stringify(report.scenarios.filter((scenario) => scenario.status !== "passed"))}`);
}

async function runDesktop1366() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const diagnostics = collectDiagnostics(page);
  await openEditor(page);

  await scenario(page, diagnostics, "single-piece-ownership", async () => {
    await loadFixture(page, "tshirt-standard");
    await page.locator(".pieces-name").first().click();
    await page.getByRole("button", { name: "Enquadrar seleção", exact: true }).click();
    await page.waitForTimeout(100);
    const canvas = page.locator("canvas[aria-label='Editor de molde 2D']");
    const box = await requiredBox(canvas, "canvas 2D");
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const before = await state(page);
    const zoomBefore = await zoomText(page);
    await installCaptureProbe(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 52, center.y + 24, { steps: 5 });
    await dispatchWheel(canvas, center.x + 52, center.y + 24, { deltaX: 2, deltaY: 2, deltaMode: 0 });
    await page.waitForTimeout(80);
    const zoomDuring = await zoomText(page);
    await page.mouse.move(center.x + 82, center.y + 36, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await state(page);
    const changed = changedPieces(before, after);
    assert(changed.length === 1, `Arraste individual alterou ${changed.length} peças: ${changed.join(", ")}`);
    assert(changed[0] === before.activePieceId, "A peça alterada não é a peça ativa.");
    assert(zoomDuring === zoomBefore, `A câmera recebeu wheel durante o drag: ${zoomBefore} → ${zoomDuring}`);
    assert(await page.evaluate(() => window.__uiCaptureObserved === true), "setPointerCapture não foi observado no pointerdown.");

    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    await page.waitForTimeout(80);
    assert(sameTransforms(before, await state(page)), "Undo não restaurou exatamente o arraste individual.");
    await page.getByRole("button", { name: "Refazer", exact: true }).click();
    await page.waitForTimeout(80);
    assert(sameTransforms(after, await state(page)), "Redo não reaplicou exatamente o arraste individual.");
    await page.screenshot({ path: resolve(outputDirectory, "desktop-1366-single-piece-drag.png"), fullPage: false });
  });

  await scenario(page, diagnostics, "multi-selection-drag", async () => {
    await loadFixture(page, "free-simple-piece");
    await page.locator(".pieces-name").first().click();
    await page.keyboard.press("Control+d");
    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: "Enquadrar seleção", exact: true }).click();
    await page.waitForTimeout(100);
    const canvas = page.locator("canvas[aria-label='Editor de molde 2D']");
    const box = await requiredBox(canvas, "canvas 2D");
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const before = await state(page);
    assert(before.selectedPieceIds.length >= 2, "A seleção múltipla não foi criada.");
    await drag(page, center, { x: center.x + 65, y: center.y + 32 });
    const after = await state(page);
    const changed = changedPieces(before, after);
    assert(changed.length === before.selectedPieceIds.length, "Nem todas e somente as peças selecionadas se moveram.");
    assert(changed.every((id) => before.selectedPieceIds.includes(id)), "Uma peça fora da seleção foi movida.");
    await page.screenshot({ path: resolve(outputDirectory, "desktop-1366-multi-piece-drag.png"), fullPage: false });
  });

  await scenario(page, diagnostics, "empty-and-hand-pan", async () => {
    await loadFixture(page, "free-simple-piece");
    await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
    const canvas = page.locator("canvas[aria-label='Editor de molde 2D']");
    const box = await requiredBox(canvas, "canvas 2D");
    const empty = { x: box.x + 28, y: box.y + 28 };
    const transforms = await state(page);
    const imageBefore = await canvasImage(canvas);
    await drag(page, empty, { x: empty.x + 54, y: empty.y + 37 });
    await page.waitForTimeout(80);
    const imageAfter = await canvasImage(canvas);
    assert(imageAfter !== imageBefore, "Pan em região vazia não alterou a câmera.");
    assert(sameTransforms(transforms, await state(page)), "Pan em região vazia alterou uma peça.");

    await page.getByRole("button", { name: "Mão", exact: true }).click();
    const handBefore = await canvasImage(canvas);
    await drag(page, { x: box.x + box.width * 0.78, y: box.y + box.height * 0.78 }, { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 });
    await page.waitForTimeout(80);
    assert(await canvasImage(canvas) !== handBefore, "Ferramenta Mão não moveu a câmera.");
    await page.getByRole("button", { name: "Mão", exact: true }).click();
  });

  await scenario(page, diagnostics, "wheel-trackpad-data", async () => {
    await loadFixture(page, "free-simple-piece");
    await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
    const canvas = page.locator("canvas[aria-label='Editor de molde 2D']");
    const box = await requiredBox(canvas, "canvas 2D");
    const cursor = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.57 };
    const zoomBefore = await zoomText(page);
    const imageBefore = await canvasImage(canvas);
    await dispatchWheel(canvas, cursor.x, cursor.y, { deltaX: 5.5, deltaY: -3.25, deltaMode: 0 });
    await page.waitForTimeout(80);
    assert(await zoomText(page) === zoomBefore, "Delta pequeno diagonal foi interpretado como zoom.");
    assert(await canvasImage(canvas) !== imageBefore, "Delta pequeno diagonal não produziu pan.");

    const zoomDiscreteBefore = await zoomText(page);
    await dispatchWheel(canvas, cursor.x, cursor.y, { deltaX: 0, deltaY: -2, deltaMode: 1 });
    await page.waitForTimeout(80);
    assert(await zoomText(page) !== zoomDiscreteBefore, "Roda em deltaMode linha não produziu zoom.");

    const zoomPinchBefore = await zoomText(page);
    await dispatchWheel(canvas, cursor.x, cursor.y, { deltaX: 0, deltaY: 8, deltaMode: 0, ctrlKey: true });
    await page.waitForTimeout(80);
    assert(await zoomText(page) !== zoomPinchBefore, "Wheel com Ctrl não produziu zoom centralizado.");
  });

  await scenario(page, diagnostics, "right-panel-lifecycle", async () => {
    await loadFixture(page, "tshirt-standard");
    await page.getByRole("button", { name: "Montar no 3D", exact: true }).click();
    await page.waitForTimeout(2500);
    const editor = page.locator("#editor-panel");
    const openWidth = (await requiredBox(editor, "editor aberto")).width;
    const toggle = page.locator(".right-panel-toggle");
    assert(await toggle.getAttribute("aria-expanded") === "true", "aria-expanded inicial incorreto.");
    const threeCountBefore = await page.locator("canvas.three-canvas").count();
    assert(threeCountBefore <= 1, `Foram criados ${threeCountBefore} canvases 3D antes do toggle.`);
    await page.locator(".right-panel-close").click();
    await page.waitForTimeout(120);
    const closedWidth = (await requiredBox(editor, "editor fechado")).width;
    assert(closedWidth > openWidth + 120, `A bancada não ocupou o espaço liberado: ${openWidth} → ${closedWidth}`);
    assert(await toggle.getAttribute("aria-expanded") === "false", "aria-expanded não refletiu painel fechado.");
    assert(await page.locator("#workspace-right-panel").isHidden(), "Painel direito não ficou oculto.");
    await page.screenshot({ path: resolve(outputDirectory, "desktop-1366-right-panel-closed.png"), fullPage: false });

    for (let index = 0; index < 4; index += 1) {
      await toggle.click();
      await page.waitForTimeout(90);
      assert(await page.locator("canvas.three-canvas").count() <= 1, "Reabertura duplicou o canvas 3D.");
      await page.locator(".right-panel-close").click();
      await page.waitForTimeout(90);
    }
    await toggle.click();
    await page.waitForTimeout(150);
    assert(await page.locator("#workspace-right-panel").isVisible(), "Painel direito não reabriu.");
    assert(await page.locator("canvas.three-canvas").count() <= 1, "Toggle repetido acumulou canvases 3D.");
    await page.screenshot({ path: resolve(outputDirectory, "desktop-1366-right-panel-open.png"), fullPage: false });
  });

  await context.close();
}

async function runDesktop1920() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const diagnostics = collectDiagnostics(page);
  await openEditor(page);
  await scenario(page, diagnostics, "desktop-1920-layout", async () => {
    await loadFixture(page, "tshirt-standard");
    await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
    await page.screenshot({ path: resolve(outputDirectory, "desktop-1920-right-panel-open.png"), fullPage: false });
    await page.locator(".right-panel-toggle").click();
    await page.waitForTimeout(100);
    const editor = await requiredBox(page.locator("#editor-panel"), "editor 1920");
    const workspace = await requiredBox(page.locator("main.workspace"), "workspace 1920");
    assert(editor.width >= workspace.width - 2, "Bancada 1920 não expandiu até a largura disponível.");
    await page.screenshot({ path: resolve(outputDirectory, "desktop-1920-right-panel-closed.png"), fullPage: false });
  });
  await context.close();
}

async function runMobilePortrait() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const diagnostics = collectDiagnostics(page);
  await openEditor(page);
  await scenario(page, diagnostics, "mobile-portrait-panel-and-pinch", async () => {
    await loadFixture(page, "tshirt-standard");
    await page.getByRole("tab", { name: "Prévia 3D", exact: true }).click();
    await page.waitForTimeout(120);
    assert(await page.locator(".right-panel-close").isVisible(), "Mobile não exibe Voltar à bancada.");
    await page.screenshot({ path: resolve(outputDirectory, "mobile-390-right-panel-open.png"), fullPage: false });
    await page.locator(".right-panel-close").click();
    await page.waitForTimeout(100);
    assert(await page.locator("#editor-panel").isVisible(), "Fechar painel mobile não devolveu a bancada.");
    assert(await page.locator(".right-panel-toggle").getAttribute("aria-expanded") === "false", "ARIA mobile não refletiu fechamento.");

    const canvas = page.locator("canvas[aria-label='Editor de molde 2D']");
    const box = await requiredBox(canvas, "canvas mobile");
    const before = await zoomText(page);
    const client = await context.newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 35, y }, { x: x + 35, y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 58, y }, { x: x + 58, y }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(120);
    assert(await zoomText(page) !== before, "Pinch touch não alterou o zoom.");
    await page.screenshot({ path: resolve(outputDirectory, "mobile-390-editor-restored.png"), fullPage: false });
  });
  await context.close();
}

async function runMobileLandscape() {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1.5, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const diagnostics = collectDiagnostics(page);
  await openEditor(page);
  await scenario(page, diagnostics, "mobile-landscape-layout", async () => {
    await loadFixture(page, "free-simple-piece");
    await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
    const canvas = await requiredBox(page.locator("canvas[aria-label='Editor de molde 2D']"), "canvas landscape");
    assert(canvas.width > 300 && canvas.height > 120, `Canvas landscape inadequado: ${canvas.width}×${canvas.height}`);
    await page.screenshot({ path: resolve(outputDirectory, "mobile-844x390-editor.png"), fullPage: false });
  });
  await context.close();
}

async function openEditor(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0));
}

async function loadFixture(page, fixtureId) {
  await page.evaluate((id) => window.__moldeonPhase0.loadFixture(id), fixtureId);
  await page.waitForTimeout(100);
  const modeling = page.getByRole("button", { name: "Modelagem", exact: true });
  if (await modeling.isEnabled()) await modeling.click();
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
}

async function scenario(page, diagnostics, name, run) {
  const consoleStart = diagnostics.consoleMessages.length;
  const errorsStart = diagnostics.pageErrors.length;
  try {
    await run();
    const newDiagnostics = diagnostics.consoleMessages.slice(consoleStart).concat(diagnostics.pageErrors.slice(errorsStart));
    report.scenarios.push({ name, status: "passed", diagnostics: newDiagnostics });
  } catch (error) {
    await page.screenshot({ path: resolve(outputDirectory, `${name}-failed.png`), fullPage: false }).catch(() => undefined);
    report.scenarios.push({ name, status: "failed", error: error instanceof Error ? error.message : String(error), diagnostics: diagnostics.consoleMessages.slice(consoleStart).concat(diagnostics.pageErrors.slice(errorsStart)) });
  }
}

function collectDiagnostics(page) {
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleMessages.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleMessages, pageErrors };
}

async function installCaptureProbe(page) {
  await page.evaluate(() => {
    window.__uiCaptureObserved = false;
    const canvas = document.querySelector("canvas[aria-label='Editor de molde 2D']");
    canvas.addEventListener("pointerdown", (event) => {
      queueMicrotask(() => { window.__uiCaptureObserved = canvas.hasPointerCapture(event.pointerId); });
    }, { once: true });
  });
}

async function dispatchWheel(canvas, clientX, clientY, options) {
  await canvas.evaluate((element, payload) => {
    element.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: payload.clientX,
      clientY: payload.clientY,
      deltaX: payload.deltaX,
      deltaY: payload.deltaY,
      deltaMode: payload.deltaMode,
      ctrlKey: payload.ctrlKey ?? false,
      metaKey: payload.metaKey ?? false,
      shiftKey: payload.shiftKey ?? false,
    }));
  }, { clientX, clientY, ...options });
}

async function drag(page, start, end) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function state(page) {
  return page.evaluate(() => window.__moldeonPhase0.state());
}

function changedPieces(before, after) {
  return before.pieces.filter((piece) => {
    const next = after.pieces.find((candidate) => candidate.id === piece.id);
    return next && (next.xMm !== piece.xMm || next.yMm !== piece.yMm || next.rotationDeg !== piece.rotationDeg);
  }).map((piece) => piece.id);
}

function sameTransforms(first, second) {
  if (first.pieces.length !== second.pieces.length) return false;
  return first.pieces.every((piece) => {
    const other = second.pieces.find((candidate) => candidate.id === piece.id);
    return other && other.xMm === piece.xMm && other.yMm === piece.yMm && other.rotationDeg === piece.rotationDeg;
  });
}

async function canvasImage(canvas) {
  return canvas.evaluate((element) => element.toDataURL("image/png"));
}

async function zoomText(page) {
  return page.locator(".zoom-indicator").innerText();
}

async function requiredBox(locator, label) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} não possui área visível.`);
  return box;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function renderMarkdown(value) {
  const rows = value.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.status} | ${scenario.diagnostics?.length ?? 0} |`);
  return `# Auditoria de regressões de UI pós-Prompt 04\n\nChromium ${value.browserVersion}\n\n| Cenário | Resultado | Erros de console |\n|---|---|---:|\n${rows.join("\n")}\n\nTrackpad físico: **não validado neste executor**. A auditoria usa eventos Wheel reais do Chromium com perfis de delta de trackpad e mouse, mas não substitui hardware físico.\n`;
}
