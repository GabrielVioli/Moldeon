import { chromium } from "playwright-core";

const baseURL = process.env.PROMPT09_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.PROMPT09_ARTIFACT_DIR ?? "artifacts/prompt09-avatar-regression";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const commonArgs = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
];
const rendererCandidates = [
  {
    name: "angle-swiftshader-unsafe",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
  {
    name: "swiftshader-angle",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
  { name: "egl", args: ["--use-gl=egl"] },
  { name: "default", args: [] },
];

const scenarios = [
  {
    label: "desktop-tshirt-with-sleeves",
    template: "Camiseta básica",
    viewport: { width: 1440, height: 1000 },
    expectedInstances: 6,
    expectedCoveredParts: 4,
  },
  {
    label: "desktop-skirt",
    template: "Saia reta",
    viewport: { width: 1366, height: 768 },
    expectedInstances: 4,
    expectedCoveredParts: 3,
  },
  {
    label: "mobile-trousers",
    template: "Calça reta",
    viewport: { width: 390, height: 844 },
    expectedInstances: 4,
    expectedCoveredParts: 5,
  },
];

const { browser, rendererProfile } = await launchBrowserWithWebGL2();
const report = [];

try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedResponses = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
    });

    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Moldes" }).click();
    const templateCard = page.getByRole("button", { name: scenario.template, exact: false }).first();
    await templateCard.waitFor({ state: "visible" });
    await templateCard.evaluate((element) => element.click());
    await page.locator(".pattern-library-dialog").waitFor({ state: "detached", timeout: 10_000 });

    const previewTab = page.getByRole("tab", { name: "Manequim 3D" });
    if (await previewTab.isVisible()) {
      await previewTab.evaluate((element) => element.click());
    } else {
      const dressButton = page.getByRole("button", { name: "Vestir no manequim" });
      await dressButton.waitFor({ state: "visible" });
      await dressButton.evaluate((element) => element.click());
    }

    const host = page.locator("[data-testid='dressed-avatar-viewport']");
    await host.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(1200);

    const inspection = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.three-canvas");
      const viewportHost = document.querySelector("[data-testid='dressed-avatar-viewport']");
      const canvasBox = canvas?.getBoundingClientRect();
      const hostBox = viewportHost?.getBoundingClientRect();
      const bodyText = document.body.innerText;
      const diagnostics = [...document.querySelectorAll(".viewport-diagnostics li, .viewport-warnings span")]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);
      return {
        canvasBox: canvasBox
          ? { width: canvasBox.width, height: canvasBox.height, top: canvasBox.top, bottom: canvasBox.bottom }
          : null,
        hostBox: hostBox
          ? { width: hostBox.width, height: hostBox.height, top: hostBox.top, bottom: hostBox.bottom }
          : null,
        hostDataset: viewportHost instanceof HTMLElement ? { ...viewportHost.dataset } : null,
        diagnostics,
        viewportError: document.querySelector(".viewport-error")?.textContent?.trim() ?? null,
        placeholder: document.querySelector(".viewport-placeholder")?.textContent?.trim() ?? null,
        hasCanvas: Boolean(canvas),
        hasExploded: /Explodida|explodido/i.test(bodyText),
        hasHideBody: /Ocultar corpo|Mostrar corpo/i.test(bodyText),
        documentWidth: document.documentElement.scrollWidth,
      };
    });

    assertScenario(scenario, inspection, consoleErrors, failedResponses, rendererProfile);

    const screenshot = `${artifactDir}/${scenario.label}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    report.push({ ...scenario, inspection, consoleErrors, failedResponses, screenshot });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ rendererProfile, scenarios: report }, null, 2));

function assertScenario(scenario, inspection, consoleErrors, failedResponses, rendererProfile) {
  const details = JSON.stringify({ scenario: scenario.label, inspection, consoleErrors, failedResponses, rendererProfile });
  if (!inspection.hasCanvas || !inspection.canvasBox || !inspection.hostDataset) {
    throw new Error(`${scenario.label}: viewport vestido incompleto: ${details}`);
  }
  if (inspection.canvasBox.width < 240 || inspection.canvasBox.height < 300) {
    throw new Error(`${scenario.label}: canvas sem área útil: ${details}`);
  }
  if (inspection.canvasBox.top < -1 || inspection.canvasBox.bottom > scenario.viewport.height + 1) {
    throw new Error(`${scenario.label}: canvas saiu da viewport vertical: ${details}`);
  }
  if (inspection.documentWidth > scenario.viewport.width + 1) {
    throw new Error(`${scenario.label}: layout criou overflow horizontal: ${details}`);
  }
  if (inspection.hostDataset.avatarVisible !== "true") {
    throw new Error(`${scenario.label}: manequim não está visível: ${details}`);
  }
  if (inspection.hostDataset.frameTarget !== "avatar-and-garment") {
    throw new Error(`${scenario.label}: câmera não enquadra avatar e roupa: ${details}`);
  }
  if (Number(inspection.hostDataset.garmentInstanceCount) !== scenario.expectedInstances) {
    throw new Error(`${scenario.label}: instâncias visíveis diferentes do esperado: ${details}`);
  }
  if (Number(inspection.hostDataset.coveredAvatarPartCount) < scenario.expectedCoveredParts) {
    throw new Error(`${scenario.label}: cobertura semântica insuficiente: ${details}`);
  }
  if (Number(inspection.hostDataset.arrangementErrorCount) !== 0 || inspection.viewportError) {
    throw new Error(`${scenario.label}: montagem possui erro: ${details}`);
  }
  if (inspection.hasExploded || inspection.hasHideBody) {
    throw new Error(`${scenario.label}: modo público legado reapareceu: ${details}`);
  }
  if (failedResponses.length > 0 || consoleErrors.length > 0) {
    throw new Error(`${scenario.label}: navegador registrou falhas: ${details}`);
  }
}

async function launchBrowserWithWebGL2() {
  const attempts = [];
  for (const candidate of rendererCandidates) {
    let candidateBrowser;
    const args = [...commonArgs, ...candidate.args];
    try {
      candidateBrowser = await chromium.launch({ executablePath, headless: true, args });
      const page = await candidateBrowser.newPage();
      const capability = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("webgl2");
        if (!context) return { supported: false, version: null, renderer: null };
        const debug = context.getExtension("WEBGL_debug_renderer_info");
        return {
          supported: true,
          version: context.getParameter(context.VERSION),
          renderer: debug
            ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : context.getParameter(context.RENDERER),
        };
      });
      await page.close();
      attempts.push({ candidate: candidate.name, args, capability });
      if (capability.supported) {
        return {
          browser: candidateBrowser,
          rendererProfile: { candidate: candidate.name, args, capability, attempts },
        };
      }
    } catch (error) {
      attempts.push({
        candidate: candidate.name,
        args,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await candidateBrowser?.close();
  }
  throw new Error(`Nenhum backend do Chrome criou WebGL 2: ${JSON.stringify(attempts)}`);
}
