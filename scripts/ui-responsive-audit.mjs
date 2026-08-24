import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.MOLDEON_UI_AUDIT_URL ?? "http://127.0.0.1:4182";
const artifactDir = process.env.MOLDEON_UI_AUDIT_DIR ?? "artifacts/ui-responsive-audit";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

const viewports = [
  ["360x640", 360, 640],
  ["390x844", 390, 844],
  ["768x1024", 768, 1024],
  ["1024x600", 1024, 600],
  ["1024x768", 1024, 768],
  ["1280x720", 1280, 720],
  ["1366x768", 1366, 768],
  ["1440x900", 1440, 900],
  ["1920x1080", 1920, 1080],
  ["2560x1440", 2560, 1440],
  ["3840x2160", 3840, 2160],
];

const manualGateLabels = new Set(["390x844", "1024x600", "1366x768", "1920x1080"]);
const zoomLevels = [80, 100, 125, 150];
const zoomReferenceViewport = { width: 1366, height: 768 };
const primaryTools = ["draft", "select", "cut", "dart", "seam", "measure"];

await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

const report = { viewports: [], zoom: [], manualGates: [] };

try {
  for (const [label, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = attachErrorCollectors(page);

    await prepareWorkspace(page);
    const inspection = await inspectLayout(page, { width, height });
    assertStructuralLayout(label, inspection, errors);

    const screenshot = `${artifactDir}/${label}.png`;
    await page.screenshot({ path: screenshot, fullPage: false });
    report.viewports.push({ label, width, height, inspection, errors, screenshot });

    if (manualGateLabels.has(label)) {
      const manualGate = await runManualGate(page, label, { width, height });
      report.manualGates.push(manualGate);
    }

    await context.close();
  }

  // Headless Chromium does not expose browser-chrome zoom shortcuts as a reliable
  // reflow signal. Browser zoom changes the amount of CSS-pixel workspace available,
  // so reproduce that layout effect by inversely scaling the logical viewport while
  // retaining the 1366x768 browser-window reference in the report.
  for (const zoom of zoomLevels) {
    const effectiveViewport = effectiveViewportForZoom(zoomReferenceViewport, zoom);
    const context = await browser.newContext({ viewport: effectiveViewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = attachErrorCollectors(page);

    await prepareWorkspace(page);
    const inspection = await inspectLayout(page, {
      ...effectiveViewport,
      browserZoomPercent: zoom,
      referenceBrowserViewport: zoomReferenceViewport,
    });
    assertStructuralLayout(`zoom-${zoom}`, inspection, errors);

    if (
      inspection.innerWidth !== effectiveViewport.width
      || inspection.innerHeight !== effectiveViewport.height
    ) {
      throw new Error(`zoom-${zoom}: viewport CSS equivalente não foi aplicado.`);
    }

    const screenshot = `${artifactDir}/zoom-${zoom}.png`;
    await page.screenshot({ path: screenshot, fullPage: false });
    report.zoom.push({
      zoom,
      referenceBrowserViewport: zoomReferenceViewport,
      effectiveCssViewport: effectiveViewport,
      inspection,
      errors,
      screenshot,
    });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));

function effectiveViewportForZoom(referenceViewport, zoomPercent) {
  const scale = zoomPercent / 100;
  return {
    width: Math.round(referenceViewport.width / scale),
    height: Math.round(referenceViewport.height / scale),
  };
}

function attachErrorCollectors(page) {
  const consoleErrors = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  return { consoleErrors, failedResponses };
}

async function prepareWorkspace(page) {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), null, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("straight-skirt-standard"));
  await page.waitForFunction(() => (window.__moldeonPhase0?.state().pieces.length ?? 0) > 0);
  await page.waitForTimeout(120);
}

async function inspectLayout(page, requestedViewport) {
  return page.evaluate(({ primaryTools, requestedViewport }) => {
    const rect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };

    const toolRects = primaryTools.map((tool) => ({
      tool,
      rect: rect(document.querySelector(`[data-testid="primary-tool-${tool}"]`)),
      visible: (() => {
        const element = document.querySelector(`[data-testid="primary-tool-${tool}"]`);
        return element instanceof HTMLElement && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none";
      })(),
    }));

    const physicsDev = document.querySelector("[data-testid='physics-dev-panel']");
    const fittingText = document.body.innerText;

    return {
      requestedViewport,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      toolbar: rect(document.querySelector("[data-testid='workspace-toolbar']")),
      workspace: rect(document.querySelector(".workspace")),
      editorPanel: rect(document.querySelector(".editor-panel")),
      canvasStack: rect(document.querySelector(".canvas-stack")),
      mobileTabs: rect(document.querySelector(".mobile-workspace-tabs")),
      rightPanel: rect(document.querySelector("#workspace-right-panel")),
      toolRects,
      hasSleeveAction: /Adicionar manga/i.test(fittingText),
      physicsDevPresent: physicsDev instanceof HTMLDetailsElement,
      physicsDevOpen: physicsDev instanceof HTMLDetailsElement ? physicsDev.open : false,
    };
  }, { primaryTools, requestedViewport });
}

function assertStructuralLayout(label, inspection, errors) {
  const details = () => JSON.stringify({ label, inspection, errors });
  if (errors.consoleErrors.length > 0 || errors.failedResponses.length > 0) {
    throw new Error(`${label}: erros de navegador: ${details()}`);
  }
  if (inspection.documentScrollWidth > inspection.documentClientWidth + 1) {
    throw new Error(`${label}: overflow horizontal estrutural: ${details()}`);
  }
  if (!inspection.toolbar || inspection.toolbar.left < -1 || inspection.toolbar.right > inspection.innerWidth + 1) {
    throw new Error(`${label}: toolbar fora da viewport: ${details()}`);
  }
  if (!inspection.workspace || inspection.workspace.height < 180) {
    throw new Error(`${label}: workspace sem altura útil: ${details()}`);
  }
  if (!inspection.canvasStack || inspection.canvasStack.width < 180 || inspection.canvasStack.height < 170) {
    throw new Error(`${label}: canvas sem área útil: ${details()}`);
  }
  if (inspection.hasSleeveAction) {
    throw new Error(`${label}: ação Adicionar manga reapareceu na UI normal: ${details()}`);
  }
  for (const entry of inspection.toolRects) {
    if (!entry.visible || !entry.rect) {
      throw new Error(`${label}: ferramenta ${entry.tool} não está acessível: ${details()}`);
    }
    if (entry.rect.left < -1 || entry.rect.right > inspection.innerWidth + 1) {
      throw new Error(`${label}: ferramenta ${entry.tool} saiu da viewport: ${details()}`);
    }
  }
  for (let index = 1; index < inspection.toolRects.length; index += 1) {
    const previous = inspection.toolRects[index - 1].rect;
    const current = inspection.toolRects[index].rect;
    if (previous && current && current.left < previous.right - 1) {
      throw new Error(`${label}: ferramentas principais se sobrepõem: ${details()}`);
    }
  }
  if (inspection.physicsDevPresent && inspection.physicsDevOpen) {
    throw new Error(`${label}: Physics DEV deveria iniciar recolhido: ${details()}`);
  }
}

async function runManualGate(page, label, viewport) {
  const result = { label, viewport, tools: {}, drawer: null, dialog: null, preview: null, screenshot: null };

  for (const tool of ["select", "cut", "dart", "seam", "measure"]) {
    const button = page.locator(`[data-testid="primary-tool-${tool}"]`);
    await button.click();
    result.tools[tool] = await button.getAttribute("aria-pressed");
  }

  const drawButton = page.locator("[data-testid='primary-tool-draft']");
  await drawButton.click();
  result.tools.draft = {
    enabled: await drawButton.isEnabled(),
    activated: await drawButton.getAttribute("aria-pressed"),
  };

  const overflow = page.locator(".toolbar-overflow > summary");
  await overflow.click();
  const fittingTrigger = page.getByRole("menuitem", { name: "Corpo e posição" });
  await fittingTrigger.click();
  const fitting = page.locator("[data-testid='fitting-dialog']");
  await fitting.waitFor({ state: "visible" });
  result.dialog = await fitting.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      withinViewport: box.left >= -1 && box.top >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1,
      hasFabricTab: [...element.querySelectorAll("button")].some((button) => /Tecidos/i.test(button.textContent ?? "")),
    };
  });
  if (!result.dialog.withinViewport || result.dialog.hasFabricTab) {
    throw new Error(`${label}: dialog inválido: ${JSON.stringify(result.dialog)}`);
  }
  await page.getByRole("button", { name: "Fechar sala de prova" }).click();

  if (viewport.width <= 1180) {
    const previewTab = page.getByRole("tab", { name: "Manequim 3D" });
    await previewTab.click();
    await page.locator(".preview-panel.is-mobile-active").waitFor({ state: "visible" });
    const close = page.locator(".right-panel-close");
    result.drawer = { open: await close.isVisible() };
    await close.click();
    await page.locator(".editor-panel.is-mobile-active").waitFor({ state: "visible" });
    result.drawer.closedToCanvas = true;
  }

  const proveButton = page.locator(".toolbar-preview-button");
  result.preview = { enabled: await proveButton.isEnabled(), opened: false, preflightSteps: [] };
  if (!result.preview.enabled) {
    throw new Error(`${label}: a prova 3D não está acessível para a fixture padrão.`);
  }

  await proveButton.click();
  const host = page.locator("[data-testid='dressed-avatar-viewport']");
  await completeDressingPreflight(page, host, result.preview.preflightSteps);
  await host.waitFor({ state: "visible", timeout: 15_000 });
  result.preview.opened = true;

  const physicsDev = page.locator("[data-testid='physics-dev-panel']");
  if (await physicsDev.count()) {
    result.preview.physicsDevOpen = await physicsDev.evaluate((element) => element instanceof HTMLDetailsElement && element.open);
    if (result.preview.physicsDevOpen) throw new Error(`${label}: Physics DEV abriu por padrão.`);
  }

  result.screenshot = `${artifactDir}/${label}-manual-gate.png`;
  await page.screenshot({ path: result.screenshot, fullPage: false });
  return result;
}

async function completeDressingPreflight(page, host, steps) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await host.isVisible().catch(() => false)) return;

    const preflight = page.locator(".dressing-preflight-dialog");
    if (!await preflight.isVisible().catch(() => false)) {
      await page.waitForTimeout(180);
      continue;
    }

    const blocker = preflight.locator("[role='alert']");
    if (await blocker.isVisible().catch(() => false)) {
      throw new Error(`A fixture padrão encontrou bloqueio na pré-prova: ${await blocker.innerText()}`);
    }

    const lowerRegion = preflight.getByRole("button", { name: /Parte inferior/i });
    if (await lowerRegion.isVisible().catch(() => false)) {
      steps.push("region:lower");
      await lowerRegion.click();
      await page.waitForTimeout(120);
      continue;
    }

    const referenceCandidate = preflight.getByRole("button", { name: /^Usar .+ como referência frontal$/i }).first();
    if (await referenceCandidate.isVisible().catch(() => false)) {
      steps.push("front-reference:selected");
      await referenceCandidate.click();
      const confirmReference = preflight.getByRole("button", { name: "Usar como referência frontal", exact: true });
      await confirmReference.click();
      await page.waitForTimeout(180);
      continue;
    }

    await page.waitForTimeout(180);
  }
}
