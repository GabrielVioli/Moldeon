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
  await runScenario("point-straight-mouse", desktop(), pointScenario({
    fixtureId: "free-simple-piece",
    input: "mouse",
  }));
  await runScenario("point-curve-mouse", desktop(), pointScenario({
    fixtureId: "bezier-piece",
    input: "mouse",
  }));
  await runScenario("point-zoomed-mouse", desktop(), pointScenario({
    fixtureId: "free-simple-piece",
    input: "mouse",
    zoom: true,
  }));
  await runScenario("point-moved-piece-mouse", desktop(), pointScenario({
    fixtureId: "free-simple-piece",
    input: "mouse",
    movePiece: true,
  }));
  await runScenario("point-straight-touch", mobile(), pointScenario({
    fixtureId: "free-simple-piece",
    input: "touch",
  }));
  await runScenario("cut-straight", desktop(), cutScenario("free-simple-piece"));
  await runScenario("cut-bezier", desktop(), cutScenario("bezier-piece"));
  await runScenario("piece-menu", desktop(), pieceMenuScenario);
  await runScenario("selection-clearing", desktop(), selectionScenario);
  await runScenario("seam-editor", desktop(), seamScenario);
  await runScenario("tshirt-three-dimensional", desktop(), threeScenario("tshirt-standard"));
  await runScenario("pants-three-dimensional", desktop(), threeScenario("straight-pants-standard"));
  await runScenario("skirt-three-dimensional", desktop(), threeScenario("straight-skirt-standard"));
  await runScenario("desktop-panel-layout", desktop(), layoutScenario);
  await runScenario("mobile-panel-layout", mobile(), layoutScenario);
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

async function runScenario(name, contextOptions, scenario) {
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
    await page.waitForTimeout(500);
    result = await scenario(page, name);
  } catch (reason) {
    status = "audit-error";
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    await safeScreenshot(page, `${name}-audit-error`);
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

function pointScenario(options) {
  return async (page, name) => {
    await loadFixture(page, options.fixtureId);
    await fitAll(page);

    if (options.movePiece) {
      await page.evaluate(() => {
        const bridge = window.__moldeonPhase0;
        const pieceId = bridge?.state().pieces[0]?.id;
        if (bridge && pieceId) bridge.movePiece(pieceId, 180, 120);
      });
      await fitAll(page);
    }

    const canvas = canvasLocator(page);
    if (options.zoom) {
      await canvas.hover();
      await page.mouse.wheel(0, -900);
      await page.waitForTimeout(150);
    }

    const before = await bridgeState(page);
    await page.getByRole("button", { name: "+ Ponto", exact: true }).click();
    const insertion = await findInsertableCanvasCoordinate(
      page,
      options.input === "touch",
      before.pieces[0].pointCount,
    );
    const afterInsertion = await bridgeState(page);

    const undoButton = page.getByRole("button", { name: "Desfazer" });
    const redoButton = page.getByRole("button", { name: "Refazer" });
    let afterUndo = afterInsertion;
    let afterRedo = afterInsertion;

    if (insertion.inserted && !(await undoButton.isDisabled())) {
      await undoButton.click();
      await page.waitForTimeout(100);
      afterUndo = await bridgeState(page);
    }
    if (insertion.inserted && !(await redoButton.isDisabled())) {
      await redoButton.click();
      await page.waitForTimeout(100);
      afterRedo = await bridgeState(page);
    }

    await safeScreenshot(page, name);
    return {
      fixtureId: options.fixtureId,
      input: options.input,
      zoomed: Boolean(options.zoom),
      movedPiece: Boolean(options.movePiece),
      beforePointCount: before.pieces[0].pointCount,
      afterInsertionPointCount: afterInsertion.pieces[0].pointCount,
      afterUndoPointCount: afterUndo.pieces[0].pointCount,
      afterRedoPointCount: afterRedo.pieces[0].pointCount,
      insertion,
      reproduced:
        insertion.inserted &&
        afterInsertion.pieces[0].pointCount === before.pieces[0].pointCount + 1,
    };
  };
}

function cutScenario(fixtureId) {
  return async (page, name) => {
    await loadFixture(page, fixtureId);
    await fitAll(page);
    const before = await bridgeState(page);
    const canvas = canvasLocator(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas 2D não possui área visível.");

    await page.getByRole("button", { name: "Recortar", exact: true }).click();
    const y = box.y + box.height * 0.5;
    await page.mouse.click(box.x + box.width * 0.36, y);
    await page.mouse.click(box.x + box.width * 0.64, y);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    const after = await bridgeState(page);
    await safeScreenshot(page, name);
    return {
      fixtureId,
      beforePieceCount: before.pieces.length,
      afterPieceCount: after.pieces.length,
      reproduced: after.pieces.length === before.pieces.length + 1,
    };
  };
}

async function pieceMenuScenario(page, name) {
  await loadFixture(page, "tshirt-standard");
  const details = page.locator("details.pieces-menu").first();
  const summary = details.locator("summary");
  const states = {};

  await summary.click();
  states.afterOpen = await details.evaluate((element) => element.open);
  await canvasLocator(page).click({ position: { x: 8, y: 8 } });
  states.afterOutsideClick = await details.evaluate((element) => element.open);
  await page.keyboard.press("Escape");
  states.afterEscape = await details.evaluate((element) => element.open);
  await summary.click();
  states.afterSecondSummaryClick = await details.evaluate((element) => element.open);
  await summary.click();

  page.once("dialog", (dialog) => dialog.dismiss());
  await details.getByRole("button", { name: "Renomear" }).click();
  states.afterAction = await details.evaluate((element) => element.open);
  await safeScreenshot(page, name);

  return {
    states,
    closesOnOutsideClick: states.afterOutsideClick === false,
    closesOnEscape: states.afterEscape === false,
    closesOnAction: states.afterAction === false,
  };
}

async function selectionScenario(page, name) {
  await loadFixture(page, "tshirt-standard");
  const frontButton = page.locator(".pieces-name").first();
  const states = {};

  await frontButton.click();
  states.afterPieceClick = await bridgeState(page);
  await canvasLocator(page).click({ position: { x: 12, y: 12 } });
  states.afterBlankCanvas = await bridgeState(page);
  await page.locator(".pieces-panel header").click();
  states.afterPanelClick = await bridgeState(page);
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
  states.afterToolbarClick = await bridgeState(page);
  await safeScreenshot(page, name);

  return {
    selectedAfterPieceClick: states.afterPieceClick.pieceSelectionActive,
    clearedByBlankCanvas: !states.afterBlankCanvas.pieceSelectionActive,
    clearedByPanelClick: !states.afterPanelClick.pieceSelectionActive,
    clearedByToolbarClick: !states.afterToolbarClick.pieceSelectionActive,
    states,
  };
}

async function seamScenario(page, name) {
  await loadFixture(page, "equal-length-seam");
  await page.getByRole("button", { name: "Montagem", exact: true }).click();
  await page.waitForTimeout(200);

  const before = await bridgeState(page);
  const firstRow = page.locator(".assembly-row").filter({ has: page.locator("input") }).first();
  const nameInput = firstRow.locator("input");
  const treatment = firstRow.locator("select");
  await nameInput.fill("Costura auditada");
  await treatment.selectOption("ease");
  const editedName = await nameInput.inputValue();
  const editedTreatment = await treatment.inputValue();
  const directionControlCount = await page.getByLabel(/Direção da costura/i).count();
  await firstRow.getByRole("button", { name: "Excluir" }).click();
  const afterDelete = await bridgeState(page);

  const undo = page.getByRole("button", { name: "Desfazer" });
  if (!(await undo.isDisabled())) await undo.click();
  await page.waitForTimeout(100);
  const afterUndo = await bridgeState(page);

  const redo = page.getByRole("button", { name: "Refazer" });
  if (!(await redo.isDisabled())) await redo.click();
  await page.waitForTimeout(100);
  const afterRedo = await bridgeState(page);
  await safeScreenshot(page, name);

  return {
    beforeSeamCount: before.seamCount,
    editedName,
    editedTreatment,
    directionControlCount,
    afterDeleteSeamCount: afterDelete.seamCount,
    afterUndoSeamCount: afterUndo.seamCount,
    afterRedoSeamCount: afterRedo.seamCount,
  };
}

function threeScenario(fixtureId) {
  return async (page, name) => {
    await loadFixture(page, fixtureId);
    const assemblyBefore = await page.evaluate(() =>
      window.__moldeonPhase0?.assembly(),
    );

    await page.getByRole("button", { name: "Montar no 3D", exact: true }).click();
    await page.waitForSelector("canvas.three-canvas", { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const mountedCanvasCount = await page.locator("canvas.three-canvas").count();
    const warnings = await page.locator(".viewport-warnings").allTextContents();
    await safeScreenshot(page, `${name}-mounted`);

    const exploded = page.getByRole("button", { name: "Explodida", exact: true });
    if (await exploded.count()) {
      await exploded.click();
      await page.waitForTimeout(200);
      await safeScreenshot(page, `${name}-exploded`);
    }

    const lifecycle = [];
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await page.getByRole("button", { name: "Modelagem", exact: true }).click();
      await page.waitForTimeout(80);
      lifecycle.push({
        cycle,
        mode: "modeling",
        canvasCount: await page.locator("canvas.three-canvas").count(),
      });
      await page.getByRole("button", { name: "Montagem", exact: true }).click();
      await page.waitForTimeout(80);
      lifecycle.push({
        cycle,
        mode: "assembly",
        canvasCount: await page.locator("canvas.three-canvas").count(),
      });
    }

    return {
      fixtureId,
      assemblyBefore,
      mountedCanvasCount,
      warnings,
      lifecycle,
      hasRealCloseButton:
        (await page.getByRole("button", { name: /Fechar.*3D|Fechar prévia/i }).count()) > 0,
    };
  };
}

async function layoutScenario(page, name) {
  await loadFixture(page, "tshirt-standard");
  await safeScreenshot(page, name);
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
        return [
          selector,
          {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
          },
        ];
      }),
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight + 1,
      boxes,
    };
  });
}

async function loadFixture(page, fixtureId) {
  await page.evaluate((id) => {
    const bridge = window.__moldeonPhase0;
    if (!bridge) throw new Error("Ponte da Fase 0 não foi instalada.");
    bridge.loadFixture(id);
  }, fixtureId);
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Modelagem", exact: true }).click();
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
}

async function fitAll(page) {
  const button = page.getByRole("button", { name: "Enquadrar tudo", exact: true });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(120);
  }
}

async function findInsertableCanvasCoordinate(page, touch, initialPointCount) {
  const canvas = canvasLocator(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas 2D não possui área visível.");

  const candidates = candidateCoordinates(box);
  let attempts = 0;

  for (const candidate of candidates) {
    attempts += 1;
    if (touch) {
      await page.touchscreen.tap(candidate.x, candidate.y);
    } else {
      await page.mouse.click(candidate.x, candidate.y);
    }
    const pointCount = await page.evaluate(() =>
      window.__moldeonPhase0?.state().pieces[0]?.pointCount,
    );
    if (pointCount === initialPointCount + 1) {
      return { inserted: true, attempts, x: candidate.x, y: candidate.y };
    }
  }

  return { inserted: false, attempts };
}

function candidateCoordinates(box) {
  const result = [];
  const steps = [
    0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
    0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.84, 0.88, 0.92,
  ];
  const bands = [0.08, 0.12, 0.16, 0.2, 0.8, 0.84, 0.88, 0.92];

  for (const t of steps) {
    for (const band of bands) {
      result.push({ x: box.x + box.width * t, y: box.y + box.height * band });
      result.push({ x: box.x + box.width * band, y: box.y + box.height * t });
    }
  }

  for (let y = 0.25; y <= 0.75; y += 0.08) {
    for (let x = 0.25; x <= 0.75; x += 0.08) {
      result.push({ x: box.x + box.width * x, y: box.y + box.height * y });
    }
  }

  return result;
}

function canvasLocator(page) {
  return page.locator(".canvas-stack canvas").first();
}

function bridgeState(page) {
  return page.evaluate(() => {
    const bridge = window.__moldeonPhase0;
    if (!bridge) throw new Error("Ponte da Fase 0 não foi instalada.");
    return bridge.state();
  });
}

async function safeScreenshot(page, name) {
  try {
    await page.screenshot({
      path: resolve(outputDirectory, `${name}.webp`),
      type: "webp",
      quality: 82,
      fullPage: false,
    });
  } catch {
    // A ausência de screenshot fica registrada pelo cenário audit-error.
  }
}

function desktop() {
  return {
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  };
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
      const outcome =
        scenario.status !== "passed"
          ? "erro de auditoria"
          : reproduced === undefined
            ? "registrado"
            : reproduced
              ? "reproduzido"
              : "não reproduzido";
      return `| ${scenario.name} | ${scenario.status} | ${outcome} | ${scenario.consoleMessages.length + scenario.pageErrors.length} |`;
    })
    .join("\n");

  return `# Interações da Fase 0: ${audit.label}\n\n` +
    `Chromium ${audit.browserVersion}\n\n` +
    `| Cenário | Auditoria | Resultado | Console |\n` +
    `|---|---|---|---:|\n${rows}\n`;
}
