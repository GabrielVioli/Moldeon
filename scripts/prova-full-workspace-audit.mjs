import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MOLDEON_UI_AUDIT_URL ?? "http://127.0.0.1:4182";
const outputDir = process.env.MOLDEON_UI_AUDIT_DIR ?? "artifacts/prova-full-workspace-audit";
const executablePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const fullViewports = [
  ["360x640", 360, 640],
  ["390x844", 390, 844],
  ["768x1024", 768, 1024],
  ["1024x600", 1024, 600],
  ["1280x720", 1280, 720],
  ["1366x768", 1366, 768],
  ["1440x900", 1440, 900],
  ["1920x1080", 1920, 1080],
  ["2560x1440", 2560, 1440],
  ["3840x2160", 3840, 2160],
];
const requiredScreenshots = new Map([
  ["390x844", "D-390x844-prova.png"],
  ["1024x600", "C-1024x600-prova.png"],
  ["1366x768", "B-1366x768-prova.png"],
  ["1920x1080", "E-1920x1080-prova.png"],
]);
const zoomLevels = [80, 100, 125, 150];
const zoomReference = { width: 1366, height: 768 };
const onlyLabel = process.env.MOLDEON_UI_AUDIT_ONLY;

await mkdir(outputDir, { recursive: true });
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

const report = { sidePreview: null, fullViewports: [], zoom: [] };

try {
  if (!onlyLabel || onlyLabel === "side-preview") report.sidePreview = await auditSidePreview();

  for (const [label, width, height] of fullViewports) {
    if (onlyLabel && label !== onlyLabel) continue;
    report.fullViewports.push(await auditFullViewport(label, width, height));
  }

  for (const zoom of onlyLabel ? [] : zoomLevels) {
    const width = Math.round(zoomReference.width / (zoom / 100));
    const height = Math.round(zoomReference.height / (zoom / 100));
    report.zoom.push(await auditFullViewport(`zoom-${zoom}`, width, height, {
      zoom,
      referenceViewport: zoomReference,
    }));
  }
} finally {
  await browser.close();
}

await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({
  sidePreview: report.sidePreview,
  fullViewports: report.fullViewports.map(compactResult),
  zoom: report.zoom.map(compactResult),
}, null, 2));

async function auditSidePreview() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = attachErrorCollectors(page);
  try {
    await prepareWorkspace(page);
    await enterFitting(page);
    await page.getByRole("button", { name: "Modelar", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".workspace")?.classList.contains("mode-modeling"));
    await page.waitForFunction(() => document.querySelector("[data-testid='dressed-avatar-viewport']")?.getAttribute("data-viewport-layout") === "side-preview");
    await page.waitForTimeout(250);
    const inspection = await inspect(page);
    assertSidePreview(inspection, errors);
    const screenshot = `${outputDir}/A-1366x768-modelar-preview.png`;
    await page.screenshot({ path: screenshot, fullPage: false });
    return { label: "A-1366x768-modelar-preview", inspection, errors, screenshot };
  } finally {
    await context.close();
  }
}

async function auditFullViewport(label, width, height, metadata = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = attachErrorCollectors(page);
  try {
    await prepareWorkspace(page);
    await enterFitting(page);
    const inspection = await inspect(page);
    assertFullFitting(label, inspection, errors);
    const filename = requiredScreenshots.get(label) ?? `full-${label}.png`;
    const screenshot = `${outputDir}/${filename}`;
    await page.screenshot({ path: screenshot, fullPage: false });
    const drawers = label === "1366x768" ? await verifyDrawers(page) : null;
    return { label, width, height, ...metadata, inspection, drawers, errors, screenshot };
  } finally {
    await context.close();
  }
}

async function verifyDrawers(page) {
  const physics = page.locator("[data-testid='physics-dev-panel']");
  await physics.locator(":scope > summary").click();
  const physicsOpen = await physics.evaluate((element) => element instanceof HTMLDetailsElement && element.open);
  const telemetryVisible = await physics.locator(".viewport-physics-dev-body").isVisible();
  await physics.locator(":scope > summary").click();

  const summary = page.locator(".fitting-summary-drawer");
  await summary.locator(":scope > summary").click();
  const summaryOpen = await summary.evaluate((element) => element instanceof HTMLDetailsElement && element.open);
  const assembledTextVisible = await summary.getByText("Roupa montada", { exact: true }).isVisible();
  await summary.locator(":scope > summary").click();

  if (!physicsOpen || !telemetryVisible || !summaryOpen || !assembledTextVisible) {
    throw new Error("1366x768: drawers da Prova não abriram corretamente.");
  }
  return { physicsOpen, telemetryVisible, summaryOpen, assembledTextVisible };
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
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("straight-skirt-standard"));
  await page.waitForFunction(() => (window.__moldeonPhase0?.state().pieces.length ?? 0) > 0);
}

async function enterFitting(page) {
  await page.getByRole("button", { name: "Prova", exact: true }).click();
  await completeDressingPreflight(page);
  const host = page.locator("[data-testid='dressed-avatar-viewport']");
  await host.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => {
    const viewport = document.querySelector("[data-testid='dressed-avatar-viewport']");
    const canvas = viewport?.querySelector("canvas");
    return viewport?.getAttribute("data-assembly-status") === "ready"
      && viewport?.getAttribute("data-viewport-layout") === "full-fitting"
      && canvas instanceof HTMLCanvasElement
      && canvas.width > 0
      && canvas.height > 0;
  }, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
}

async function completeDressingPreflight(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dialog = page.locator(".dressing-preflight-dialog");
    if (!await dialog.isVisible().catch(() => false)) {
      await page.waitForTimeout(120);
      continue;
    }
    const blocker = dialog.locator("[role='alert']");
    if (await blocker.isVisible().catch(() => false)) {
      throw new Error(`Pré-prova bloqueada: ${await blocker.innerText()}`);
    }
    const lowerRegion = dialog.getByRole("button", { name: /Parte inferior/i });
    if (await lowerRegion.isVisible().catch(() => false)) {
      await lowerRegion.click();
      await page.waitForTimeout(120);
      continue;
    }
    const reference = dialog.getByRole("button", { name: /como referência frontal/i }).first();
    if (await reference.isVisible().catch(() => false)) {
      await reference.click();
      const confirm = dialog.getByRole("button", { name: "Usar como referência frontal", exact: true });
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await page.waitForTimeout(160);
      continue;
    }
    await page.waitForTimeout(120);
  }
}

async function inspect(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const style = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const computed = getComputedStyle(element);
      return { display: computed.display, visibility: computed.visibility, pointerEvents: computed.pointerEvents };
    };
    const host = document.querySelector("[data-testid='dressed-avatar-viewport']");
    const canvas = host?.querySelector("canvas");
    const physics = document.querySelector("[data-testid='physics-dev-panel']");
    const summary = document.querySelector(".fitting-summary-drawer");
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth,
      workspace: rect(".workspace"),
      workspaceMode: document.querySelector(".workspace")?.className ?? null,
      editor: { rect: rect(".editor-panel"), style: style(".editor-panel") },
      mobileTabs: { rect: rect(".mobile-workspace-tabs"), style: style(".mobile-workspace-tabs") },
      preview: rect(".preview-panel"),
      host: rect("[data-testid='dressed-avatar-viewport']"),
      simulationControls: {
        rect: rect(".viewport-simulation-controls"),
        style: (() => {
          const element = document.querySelector(".viewport-simulation-controls");
          if (!(element instanceof HTMLElement)) return null;
          const computed = getComputedStyle(element);
          return { top: computed.top, right: computed.right, bottom: computed.bottom };
        })(),
      },
      hostLayout: host?.getAttribute("data-viewport-layout") ?? null,
      assemblyStatus: host?.getAttribute("data-assembly-status") ?? null,
      canvas: canvas instanceof HTMLCanvasElement ? {
        css: (() => {
          const box = canvas.getBoundingClientRect();
          return { width: box.width, height: box.height };
        })(),
        buffer: { width: canvas.width, height: canvas.height },
      } : null,
      viewportCanvasCount: document.querySelectorAll("[data-testid='dressed-avatar-viewport'] canvas").length,
      physics: {
        count: document.querySelectorAll("[data-testid='physics-dev-panel']").length,
        open: physics instanceof HTMLDetailsElement ? physics.open : null,
        rect: rect("[data-testid='physics-dev-panel']"),
      },
      summary: {
        count: document.querySelectorAll(".fitting-summary-drawer").length,
        open: summary instanceof HTMLDetailsElement ? summary.open : null,
        rect: rect(".fitting-summary-drawer"),
      },
    };
  });
}

function assertSidePreview(inspection, errors) {
  assertNoBrowserErrors("side-preview", errors);
  if (inspection.hostLayout !== "side-preview") throw new Error(`side-preview: layout incorreto ${inspection.hostLayout}`);
  if (inspection.physics.count !== 0) throw new Error("side-preview: painel Física DEV foi renderizado.");
  if (inspection.editor.style?.display === "none") throw new Error("side-preview: editor 2D desapareceu em Modelar.");
  if (!inspection.workspace || !inspection.host || inspection.host.height < inspection.workspace.height * 0.45) {
    throw new Error(`side-preview: viewport ocupa menos de 45% da altura: ${JSON.stringify(inspection)}`);
  }
  assertCanvasMatchesHost("side-preview", inspection);
}

function assertFullFitting(label, inspection, errors) {
  assertNoBrowserErrors(label, errors);
  if (!inspection.workspaceMode.includes("mode-fitting")) throw new Error(`${label}: modo Prova não está ativo.`);
  if (inspection.editor.style?.display !== "none") throw new Error(`${label}: editor 2D continua visível.`);
  if (inspection.mobileTabs.style?.display !== "none") throw new Error(`${label}: tabs do editor continuam visíveis.`);
  if (!inspection.workspace || !inspection.host) throw new Error(`${label}: workspace/viewport ausente.`);
  if (inspection.host.width < inspection.workspace.width * 0.95 || inspection.host.height < inspection.workspace.height * 0.95) {
    throw new Error(`${label}: 3D não domina o workspace: ${JSON.stringify(inspection)}`);
  }
  if (inspection.hostLayout !== "full-fitting") throw new Error(`${label}: variante full-fitting ausente.`);
  if (inspection.physics.count !== 1 || inspection.physics.open !== false) throw new Error(`${label}: Física DEV não está disponível e recolhida.`);
  if (inspection.summary.count !== 1 || inspection.summary.open !== false) throw new Error(`${label}: resumo da prova não está recolhido.`);
  if (inspection.viewportCanvasCount !== 1) throw new Error(`${label}: quantidade inesperada de canvases 3D.`);
  if (inspection.documentWidth > inspection.innerWidth + 1) throw new Error(`${label}: overflow horizontal.`);
  assertCanvasMatchesHost(label, inspection);
}

function assertCanvasMatchesHost(label, inspection) {
  const { host, canvas, devicePixelRatio } = inspection;
  if (!host || !canvas || canvas.css.width <= 0 || canvas.css.height <= 0) throw new Error(`${label}: canvas vazio.`);
  if (Math.abs(canvas.css.width - host.width) > 2 || Math.abs(canvas.css.height - host.height) > 2) {
    throw new Error(`${label}: canvas CSS não acompanha o host.`);
  }
  const expectedWidth = canvas.css.width * devicePixelRatio;
  const expectedHeight = canvas.css.height * devicePixelRatio;
  if (canvas.buffer.width < expectedWidth * 0.75 || canvas.buffer.height < expectedHeight * 0.75) {
    throw new Error(`${label}: drawing buffer menor que o container.`);
  }
}

function assertNoBrowserErrors(label, errors) {
  if (errors.consoleErrors.length || errors.failedResponses.length) {
    throw new Error(`${label}: erros de navegador ${JSON.stringify(errors)}`);
  }
}

function compactResult(result) {
  return {
    label: result.label,
    size: `${result.width}x${result.height}`,
    host: result.inspection.host,
    canvas: result.inspection.canvas,
    physics: result.inspection.physics,
    screenshot: result.screenshot,
  };
}
