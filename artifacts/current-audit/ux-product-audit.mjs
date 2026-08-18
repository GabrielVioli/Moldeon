import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:4173";
const executablePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const outputDir = resolve(process.env.AUDIT_OUTPUT_DIR ?? "artifacts/current-audit/product-ux");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});

const report = { baseURL, generatedAt: new Date().toISOString(), browser: browser.version(), scenarios: [] };

try {
  report.scenarios.push(await runDesktop());
  for (const config of [
    { name: "notebook-1366x768", width: 1366, height: 768 },
    { name: "reduced-900x700", width: 900, height: 700 },
    { name: "mobile-390x844", width: 390, height: 844, mobile: true, touch: true },
    { name: "mobile-landscape-844x390", width: 844, height: 390, mobile: true, touch: true },
  ]) report.scenarios.push(await runViewport(config));
} finally {
  await browser.close();
}

await writeFile(resolve(outputDir, "product-ux-audit.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));

async function newPage(config) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.mobile ? 2 : 1,
    isMobile: config.mobile ?? false,
    hasTouch: config.touch ?? false,
    locale: "pt-BR",
    colorScheme: "light",
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    window.__uxAudit = { longTasks: [], events: [] };
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__uxAudit.longTasks.push({ start: entry.startTime, duration: entry.duration });
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {}
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__uxAudit.events.push({ name: entry.name, duration: entry.duration, interactionId: entry.interactionId });
      });
      observer.observe({ type: "event", buffered: true, durationThreshold: 16 });
    } catch {}
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedResponses = [];
  page.on("console", (message) => { if (["warning", "error"].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }); });
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(750);
  return { context, page, consoleMessages, pageErrors, failedResponses };
}

async function runDesktop() {
  const config = { name: "desktop-1440x900-beginner", width: 1440, height: 900 };
  const env = await newPage(config);
  const { page, context } = env;
  const result = { ...config, chronology: [], states: {}, interactions: {}, errors: env };
  delete result.errors.context; delete result.errors.page;
  try {
    result.states.initial = await state(page);
    await shot(page, "desktop-01-initial");
    result.chronology.push(step("Abriu a aplicação", "Viu a bancada, toolbar, painel de peças, painel 3D vazio e propriedades ao mesmo tempo."));

    result.interactions.keyboardInitial = await keyboardSurvey(page, 24);

    await page.getByRole("button", { name: "Moldes", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    result.states.libraryOpen = await state(page);
    result.interactions.libraryFocus = await modalFocusSurvey(page);
    await shot(page, "desktop-02-library");
    result.chronology.push(step("Clicou em Moldes", "Encontrou cartões de bases e um segundo nível de medidas que só aparece após escolher."));
    await page.getByRole("button", { name: "Fechar biblioteca" }).click();
    result.interactions.libraryCloseX = (await page.getByRole("dialog").count()) === 0;

    await page.getByRole("button", { name: "Moldes", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.mouse.click(3, 3);
    await page.waitForTimeout(80);
    result.interactions.libraryCloseOutside = (await page.getByRole("dialog").count()) === 0;

    await page.getByRole("button", { name: "Moldes", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(120);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    result.interactions.libraryCloseEscape = (await page.getByRole("dialog").count()) === 0;
    if (await page.getByRole("dialog").count()) await page.getByRole("button", { name: "Fechar biblioteca" }).click();

    await chooseTemplate(page, "Camiseta básica");
    result.states.tshirt = await state(page);
    await shot(page, "desktop-03-tshirt-editor");
    result.chronology.push(step("Criou Camiseta básica", "Precisou selecionar o cartão e depois localizar Criar molde; voltou para uma tela densa, já com várias peças."));

    result.interactions.tools = {};
    for (const name of ["Selecionar", "Costurar", "Recortar", "Pence", "Medir"]) {
      const control = page.getByRole("button", { name, exact: true });
      await control.click();
      await page.waitForTimeout(60);
      result.interactions.tools[name] = {
        pressed: await control.getAttribute("aria-pressed"),
        activeClass: await control.evaluate((el) => el.classList.contains("active")),
        context: await page.locator(".context-bar").allTextContents(),
      };
      await page.keyboard.press("Escape");
    }
    let promptSeen = false;
    page.once("dialog", async (dialog) => { promptSeen = dialog.type() === "prompt"; await dialog.dismiss(); });
    await page.getByRole("button", { name: "Desenhar", exact: true }).click();
    await page.waitForTimeout(80);
    result.interactions.tools.Desenhar = { nativePrompt: promptSeen };

    const sleeveButton = page.getByRole("button", { name: "Adicionar manga", exact: true });
    result.interactions.sleeveButtonEnabled = !(await sleeveButton.isDisabled());
    if (!(await sleeveButton.isDisabled())) {
      await sleeveButton.click(); await page.getByRole("dialog").waitFor();
      result.states.sleeveWizard = await state(page); await shot(page, "desktop-04-sleeve-wizard");
      result.interactions.sleeveFocus = await modalFocusSurvey(page);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      result.interactions.sleeveCloseEscape = (await page.getByRole("dialog").count()) === 0;
      if (await page.getByRole("dialog").count()) await page.getByRole("button", { name: "Fechar assistente de manga" }).click();
    }

    await page.getByRole("button", { name: "Corpo e tecido", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    result.states.fittingBody = await state(page);
    result.interactions.fittingFocus = await modalFocusSurvey(page);
    await shot(page, "desktop-05-body-fabric");
    for (const tab of ["2. Tecidos", "3. Posição", "1. Corpo"]) {
      await page.getByRole("button", { name: tab, exact: true }).click(); await page.waitForTimeout(50);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    result.interactions.fittingCloseEscape = (await page.getByRole("dialog").count()) === 0;
    if (await page.getByRole("dialog").count()) await page.getByRole("button", { name: "Fechar sala de prova" }).click();

    const downloadPromise = page.waitForEvent("download", { timeout: 5_000 }).catch(() => null);
    await page.getByRole("button", { name: /SVG/, exact: false }).click();
    const download = await downloadPromise;
    result.interactions.exportSvg = download ? { downloaded: true, filename: download.suggestedFilename() } : { downloaded: false };

    const dress = page.getByRole("button", { name: "Vestir no manequim", exact: true });
    result.interactions.dressEnabled = !(await dress.isDisabled());
    if (!(await dress.isDisabled())) {
      const started = performance.now();
      await dress.click();
      const host = page.locator("[data-testid='dressed-avatar-viewport']");
      await host.waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(1_200);
      result.interactions.threeOpenMs = Math.round(performance.now() - started);
      result.states.three = await state(page);
      await shot(page, "desktop-06-three");
      const canvas = page.locator("canvas.three-canvas");
      const box = await canvas.boundingBox();
      if (box) {
        const before = hash(await canvas.screenshot());
        await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
        await page.mouse.down(); await page.mouse.move(box.x + box.width * .72, box.y + box.height * .55, { steps: 12 }); await page.mouse.up();
        await page.mouse.wheel(0, -450); await page.waitForTimeout(250);
        const after = hash(await canvas.screenshot());
        result.interactions.threeOrbitZoomVisualChange = before !== after;
      }
      result.interactions.twoToThree = await testTwoToThree(page);
      await shot(page, "desktop-07-two-to-three-after-drag");
      const close = page.getByRole("button", { name: /Recolher|Voltar à bancada/, exact: false }).first();
      await close.click(); await page.waitForTimeout(250);
      result.interactions.close3D = {
        hostCount: await page.locator("[data-testid='dressed-avatar-viewport']").count(),
        visibleCanvasCount: await page.locator("canvas.three-canvas:visible").count(),
        allCanvasCount: await page.locator("canvas.three-canvas").count(),
      };
    }

    result.states.final = await state(page);
    result.performance = await performanceState(page);
  } finally { await context.close(); }
  return result;
}

async function runViewport(config) {
  const env = await newPage(config); const { page, context } = env;
  const result = { ...config, states: {}, interactions: {}, errors: env };
  delete result.errors.context; delete result.errors.page;
  try {
    result.states.initial = await state(page); await shot(page, `${config.name}-01-initial`);
    await chooseTemplate(page, "Camiseta básica");
    result.states.tshirt = await state(page); await shot(page, `${config.name}-02-tshirt`);
    result.interactions.toolbar = await page.evaluate(() => {
      const toolbar = document.querySelector(".tool-buttons"); const actions = document.querySelector(".toolbar-actions");
      return { toolClientWidth: toolbar?.clientWidth, toolScrollWidth: toolbar?.scrollWidth, toolScrollLeft: toolbar?.scrollLeft, actionClientWidth: actions?.clientWidth, actionScrollWidth: actions?.scrollWidth };
    });
    const fitting = page.getByRole("button", { name: "Corpo e tecido", exact: true });
    if (await fitting.isVisible()) {
      await fitting.click(); await page.getByRole("dialog").waitFor();
      result.states.fitting = await state(page); await shot(page, `${config.name}-03-fitting`);
      result.interactions.fittingFocus = await modalFocusSurvey(page);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      if (await page.getByRole("dialog").count()) await page.getByRole("button", { name: "Fechar sala de prova" }).click();
    }
    const previewTab = page.getByRole("tab", { name: "Manequim 3D", exact: true });
    if (await previewTab.isVisible()) {
      await previewTab.click();
      const host = page.locator("[data-testid='dressed-avatar-viewport']");
      await host.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      result.states.preview = await state(page); await shot(page, `${config.name}-04-three`);
      const back = page.getByRole("button", { name: /Voltar à bancada|Recolher/, exact: false }).first();
      if (await back.isVisible()) { await back.click(); await page.waitForTimeout(80); }
      result.interactions.previewClosed = (await page.locator("canvas.three-canvas:visible").count()) === 0;
    }
    result.performance = await performanceState(page);
  } finally { await context.close(); }
  return result;
}

async function chooseTemplate(page, name) {
  if (!(await page.getByRole("dialog").count())) await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: new RegExp(name, "i") }).first().click();
  await page.getByRole("button", { name: "Criar molde", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15_000 });
  await page.waitForTimeout(350);
}

async function modalFocusSurvey(page) {
  const initial = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 80), inside: Boolean(document.activeElement?.closest("[role='dialog']")) }));
  let escaped = false; const visited = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const current = await page.evaluate(() => ({ text: (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 80), inside: Boolean(document.activeElement?.closest("[role='dialog']")) }));
    visited.push(current); if (!current.inside) escaped = true;
  }
  return { initial, escaped, firstTen: visited.slice(0, 10) };
}

async function keyboardSurvey(page, count) {
  const visited = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Tab");
    visited.push(await page.evaluate(() => {
      const el = document.activeElement; if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect(); const style = getComputedStyle(el);
      return { tag: el.tagName, name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 80), visible: r.width > 0 && r.height > 0, outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}` };
    }));
  }
  return visited;
}

async function testTwoToThree(page) {
  const canvas2d = page.locator("canvas.pattern-canvas"); const canvas3d = page.locator("canvas.three-canvas");
  if (!(await canvas2d.isVisible()) || !(await canvas3d.isVisible())) return { attempted: false };
  const target = await page.evaluate(async () => {
    const [{ useEditorStore }, { getCamera }, coordinates] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts")
    ]);
    const state = useEditorStore.getState(); const piece = state.garment.pieces.find((p) => p.id === state.activePieceId) ?? state.garment.pieces[0];
    const point = piece?.points?.[0]; const canvas = document.querySelector("canvas.pattern-canvas");
    if (!point || !(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect(); const workspace = state.garment.workspaceStates?.find((w) => w.pieceId === piece.id)?.transform ?? { xMm: 0, yMm: 0, rotationDeg: 0 };
    const world = coordinates.pieceLocalToWorld({ xMm: point.xMm, yMm: point.yMm }, workspace);
    const screen = coordinates.worldToScreen(world, getCamera());
    return { x: rect.left + screen.x, y: rect.top + screen.y, pointId: point.id };
  }).catch(() => null);
  if (!target) return { attempted: false, reason: "point mapping unavailable" };
  const before3d = hash(await canvas3d.screenshot());
  const started = performance.now();
  await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.move(target.x + 28, target.y + 16, { steps: 14 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const latencyMs = Math.round(performance.now() - started); const after3d = hash(await canvas3d.screenshot());
  return { attempted: true, latencyMs, visual3DChanged: before3d !== after3d };
}

async function state(page) {
  return page.evaluate(() => {
    const visible = [...document.querySelectorAll("button,input,select,textarea,[role='tab'],[role='dialog']")].map((el) => {
      const r = el.getBoundingClientRect(); const style = getComputedStyle(el); const text = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 120);
      return { tag: el.tagName.toLowerCase(), text, title: el.getAttribute("title"), disabled: "disabled" in el ? el.disabled : false, pressed: el.getAttribute("aria-pressed"), selected: el.getAttribute("aria-selected"), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), clipped: r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1, display: style.display };
    }).filter((x) => x.width > 0 && x.height > 0 && x.display !== "none");
    const canvas2d = document.querySelector("canvas.pattern-canvas")?.getBoundingClientRect(); const canvas3d = document.querySelector("canvas.three-canvas")?.getBoundingClientRect();
    const box = (r) => r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
    return {
      viewport: { width: innerWidth, height: innerHeight }, bodyText: document.body.innerText.slice(0, 3500), visibleControlCount: visible.length,
      unnamedControlCount: visible.filter((x) => !x.text).length, under24Count: visible.filter((x) => x.tag !== "input" && (x.width < 24 || x.height < 24)).length,
      under44Count: visible.filter((x) => x.tag !== "input" && (x.width < 44 || x.height < 44)).length, clippedCount: visible.filter((x) => x.clipped).length,
      controls: visible, canvas2d: box(canvas2d), canvas3d: box(canvas3d), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      dialogs: document.querySelectorAll("[role='dialog']").length, activeElement: document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 80) || document.activeElement?.tagName,
    };
  });
}

async function performanceState(page) {
  return page.evaluate(() => ({ longTasks: window.__uxAudit?.longTasks ?? [], events: (window.__uxAudit?.events ?? []).sort((a,b) => b.duration-a.duration).slice(0,30), resources: performance.getEntriesByType("resource").map((r) => ({ name: r.name.split("/").pop(), duration: r.duration, transferSize: r.transferSize })).sort((a,b) => b.transferSize-a.transferSize).slice(0,15), memory: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null }));
}

function rect(r) { return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null; }
function hash(buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function step(action, observation) { return { action, observation }; }
function shot(page, name) { return page.screenshot({ path: resolve(outputDir, `${name}.png`), fullPage: false }); }
