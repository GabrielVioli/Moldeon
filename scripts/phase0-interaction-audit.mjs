import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.PHASE0_BASE_URL ?? "http://127.0.0.1:5173";
const label = process.env.PHASE0_INTERACTION_LABEL ?? "fallback";
const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
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
  await scenario("point-straight-mouse", desktop(), (page) =>
    auditPoint(page, "free-simple-piece", { input: "mouse" }),
  );
  await scenario("point-curve-mouse", desktop(), (page) =>
    auditPoint(page, "bezier-piece", { input: "mouse" }),
  );
  await scenario("point-zoomed-mouse", desktop(), (page) =>
    auditPoint(page, "free-simple-piece", { input: "mouse", zoom: true }),
  );
  await scenario("point-moved-piece-mouse", desktop(), (page) =>
    auditPoint(page, "free-simple-piece", { input: "mouse", move: true }),
  );
  await scenario("point-straight-touch", mobile(), (page) =>
    auditPoint(page, "free-simple-piece", { input: "touch" }),
  );
  await scenario("cut-straight", desktop(), (page) =>
    auditCut(page, "free-simple-piece"),
  );
  await scenario("cut-bezier", desktop(), (page) =>
    auditCut(page, "bezier-piece"),
  );
  await scenario("piece-menu", desktop(), auditPieceMenu);
  await scenario("selection-clearing", desktop(), auditSelection);
  await scenario("seam-editor", desktop(), auditSeamEditor);
  await scenario("tshirt-three-dimensional", desktop(), (page) =>
    auditThree(page, "tshirt-standard"),
  );
  await scenario("pants-three-dimensional", desktop(), (page) =>
    auditThree(page, "straight-pants-standard"),
  );
  await scenario("skirt-three-dimensional", desktop(), (page) =>
    auditThree(page, "straight-skirt-standard"),
  );
  await scenario("desktop-panel-layout", desktop(), auditLayout);
  await scenario("mobile-panel-layout", mobile(), auditLayout);
} finally {
  await browser.close();
}

await Promise.all([
  writeFile(
    resolve(outputDirectory, "interaction-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "interaction-audit.md"),
    renderMarkdown(report),
    "utf8",
  ),
]);
console.log(renderMarkdown(report));

async function scenario(name, contextOptions, audit) {
  const startedAt = performance.now();
  const context = await browser.newContext({
    ...contextOptions,
    locale: "pt-BR",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    }),
  );

  let status = "passed";
  let result = null;
  let error = null;

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__moldeonPhase0), null, {
      timeout: 20_000,
    });
    await page.waitForTimeout(350);
    result = await audit(page, name);
    await capture(page, name);
  } catch (reason) {
    status = "audit-error";
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    await capture(page, `${name}-audit-error`).catch(() => undefined);
  } finally {
    await context.close();
  }

  report.scenarios.push({
    name,
    status,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    result,
    error,
    consoleMessages,
    pageErrors,
    failedRequests,
  });
}

async function auditPoint(page, fixtureId, options) {
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
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(120);
  }

  const before = await state(page);
  await page.getByRole("button", { name: "+ Ponto", exact: true }).click();
  const insertion = await scanForInsertion(
    page,
    options.input === "touch",
    before.pieces[0].pointCount,
  );
  const inserted = await state(page);

  const undo = page.getByRole("button", { name: "Desfazer" });
  if (insertion.inserted && !(await undo.isDisabled())) await undo.click();
  await page.waitForTimeout(80);
  const undone = await state(page);

  const redo = page.getByRole("button", { name: "Refazer" });
  if (insertion.inserted && !(await redo.isDisabled())) await redo.click();
  await page.waitForTimeout(80);
  const redone = await state(page);

  return {
    fixtureId,
    input: options.input,
    zoomed: Boolean(options.zoom),
    moved: Boolean(options.move),
    before: before.pieces[0].pointCount,
    inserted: inserted.pieces[0].pointCount,
    undone: undone.pieces[0].pointCount,
    redone: redone.pieces[0].pointCount,
    insertion,
    reproduced:
      insertion.inserted &&
      inserted.pieces[0].pointCount === before.pieces[0].pointCount + 1,
  };
}

async function auditCut(page, fixtureId) {
  await loadFixture(page, fixtureId);
  await fitAll(page);
  const before = await state(page);
  const box = await canvas2d(page).boundingBox();
  if (!box) throw new Error("Canvas 2D sem área visível.");

  await page.getByRole("button", { name: "Recortar", exact: true }).click();
  const y = box.y + box.height * 0.5;
  await page.mouse.click(box.x + box.width * 0.36, y);
  await page.mouse.click(box.x + box.width * 0.64, y);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const after = await state(page);

  return {
    fixtureId,
    beforePieceCount: before.pieces.length,
    afterPieceCount: after.pieces.length,
    reproduced: after.pieces.length === before.pieces.length + 1,
  };
}

async function auditPieceMenu(page) {
  await loadFixture(page, "tshirt-standard");
  const details = page.locator("details.pieces-menu").first();
  const summary = details.locator("summary");
  const observed = {};

  await summary.click();
  observed.afterOpen = await details.evaluate((element) => element.open);
  await canvas2d(page).click({ position: { x: 8, y: 8 } });
  observed.afterOutsideClick = await details.evaluate((element) => element.open);
  await page.keyboard.press("Escape");
  observed.afterEscape = await details.evaluate((element) => element.open);
  await summary.click();
  observed.afterSecondSummaryClick = await details.evaluate((element) => element.open);
  await summary.click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await details.getByRole("button", { name: "Renomear" }).click();
  observed.afterAction = await details.evaluate((element) => element.open);

  return {
    observed,
    closesOnOutsideClick: observed.afterOutsideClick === false,
    closesOnEscape: observed.afterEscape === false,
    closesOnAction: observed.afterAction === false,
  };
}

async function auditSelection(page) {
  await loadFixture(page, "tshirt-standard");
  const observed = {};
  await page.locator(".pieces-name").first().click();
  observed.afterPiece = await state(page);
  await canvas2d(page).click({ position: { x: 12, y: 12 } });
  observed.afterBlankCanvas = await state(page);
  await page.locator(".pieces-panel header").click();
  observed.afterPanel = await state(page);
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
  observed.afterToolbar = await state(page);

  return {
    selectedAfterPiece: observed.afterPiece.pieceSelectionActive,
    clearedByBlankCanvas: !observed.afterBlankCanvas.pieceSelectionActive,
    clearedByPanel: !observed.afterPanel.pieceSelectionActive,
    clearedByToolbar: !observed.afterToolbar.pieceSelectionActive,
  };
}

async function auditSeamEditor(page) {
  await loadFixture(page, "equal-length-seam");
  await page.getByRole("button", { name: "Montagem", exact: true }).click();
  await page.waitForTimeout(150);
  const before = await state(page);
  const row = page.locator(".assembly-row").filter({ has: page.locator("input") }).first();
  const input = row.locator("input");
  const select = row.locator("select");
  await input.fill("Costura auditada");
  await select.selectOption("ease");
  const editedName = await input.inputValue();
  const editedTreatment = await select.inputValue();
  const directionControls = await page.getByLabel(/Direção da costura/i).count();
  await row.getByRole("button", { name: "Excluir" }).click();
  const deleted = await state(page);
  const undo = page.getByRole("button", { name: "Desfazer" });
  if (!(await undo.isDisabled())) await undo.click();
  await page.waitForTimeout(80);
  const undone = await state(page);
  const redo = page.getByRole("button", { name: "Refazer" });
  if (!(await redo.isDisabled())) await redo.click();
  await page.waitForTimeout(80);
  const redone = await state(page);

  return {
    beforeSeamCount: before.seamCount,
    editedName,
    editedTreatment,
    directionControls,
    afterDeleteSeamCount: deleted.seamCount,
    afterUndoSeamCount: undone.seamCount,
    afterRedoSeamCount: redone.seamCount,
  };
}

async function auditThree(page, fixtureId) {
  await loadFixture(page, fixtureId);
  const assembly = await page.evaluate(() => window.__moldeonPhase0?.assembly());
  await page.getByRole("button", { name: "Montar no 3D", exact: true }).click();
  await page.waitForSelector("canvas.three-canvas", { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await capture(page, `${fixtureId}-mounted`);
  const warnings = await page.locator(".viewport-warnings").allTextContents();

  const exploded = page.getByRole("button", { name: "Explodida", exact: true });
  if (await exploded.count()) {
    await exploded.click();
    await page.waitForTimeout(150);
    await capture(page, `${fixtureId}-exploded`);
  }

  const lifecycle = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.getByRole("button", { name: "Modelagem", exact: true }).click();
    await page.waitForTimeout(60);
    lifecycle.push({
      cycle,
      mode: "modeling",
      canvasCount: await page.locator("canvas.three-canvas").count(),
    });
    await page.getByRole("button", { name: "Montagem", exact: true }).click();
    await page.waitForTimeout(60);
    lifecycle.push({
      cycle,
      mode: "assembly",
      canvasCount: await page.locator("canvas.three-canvas").count(),
    });
  }

  return {
    fixtureId,
    assembly,
    warnings,
    mountedCanvasCount: await page.locator("canvas.three-canvas").count(),
    lifecycle,
    closeButtonCount: await page
      .getByRole("button", { name: /Fechar.*3D|Fechar prévia/i })
      .count(),
  };
}

async function auditLayout(page) {
  await loadFixture(page, "tshirt-standard");
  return page.evaluate(() => {
    const selectors = [
      ".toolbar",
      ".pieces-panel",
      ".editor-panel",
      ".inspector-panel",
      ".canvas-stack",
      ".mobile-workspace-tabs",
    ];
    const boxes = Object.fromEntries(
      selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const rect = element.getBoundingClientRect();
        return [selector, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight,
        }];
      }),
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
      boxes,
    };
  });
}

async function loadFixture(page, fixtureId) {
  await page.evaluate((id) => {
    const bridge = window.__moldeonPhase0;
    if (!bridge) throw new Error("Ponte da Fase 0 não instalada.");
    bridge.loadFixture(id);
  }, fixtureId);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Modelagem", exact: true }).click();
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
}

async function fitAll(page) {
  const button = page.getByRole("button", { name: "Enquadrar tudo", exact: true });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(100);
  }
}

async function scanForInsertion(page, touch, initialPointCount) {
  const box = await canvas2d(page).boundingBox();
  if (!box) throw new Error("Canvas 2D sem área visível.");
  const candidates = coordinates(box);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (touch) await page.touchscreen.tap(candidate.x, candidate.y);
    else await page.mouse.click(candidate.x, candidate.y);
    const count = await page.evaluate(() =>
      window.__moldeonPhase0?.state().pieces[0]?.pointCount,
    );
    if (count === initialPointCount + 1) {
      return { inserted: true, attempts: index + 1, ...candidate };
    }
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
    for (let x = 0.26; x <= 0.74; x += 0.08) {
      result.push({ x: box.x + box.width * x, y: box.y + box.height * y });
    }
  }
  return result;
}

function state(page) {
  return page.evaluate(() => {
    const bridge = window.__moldeonPhase0;
    if (!bridge) throw new Error("Ponte da Fase 0 não instalada.");
    return bridge.state();
  });
}

function canvas2d(page) {
  return page.locator(".canvas-stack canvas").first();
}

function capture(page, name) {
  return page.screenshot({
    path: resolve(outputDirectory, `${name}.png`),
    type: "png",
    fullPage: false,
  });
}

function desktop() {
  return { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };
}

function mobile() {
  return {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  };
}

function renderMarkdown(audit) {
  const rows = audit.scenarios
    .map((scenario) => {
      const reproduced = scenario.result?.reproduced;
      const result =
        scenario.status !== "passed"
          ? "erro de auditoria"
          : reproduced === undefined
            ? "registrado"
            : reproduced
              ? "reproduzido"
              : "não reproduzido";
      return `| ${scenario.name} | ${scenario.status} | ${result} | ${scenario.consoleMessages.length + scenario.pageErrors.length} |`;
    })
    .join("\n");

  return `# Interações da Fase 0: ${audit.label}\n\n` +
    `Chromium ${audit.browserVersion}\n\n` +
    `| Cenário | Auditoria | Resultado | Console |\n` +
    `|---|---|---|---:|\n${rows}\n`;
}
