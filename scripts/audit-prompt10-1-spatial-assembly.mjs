import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5191;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/prompt-10-1-spatial-assembly");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const cases = [
  { id: "self-seam-tube", expectedMappings: ["seam-derived-tube"] },
  { id: "spatial-two-panel-tube", expectedMappings: ["seam-derived-tube", "seam-derived-tube"] },
  { id: "spatial-four-panel-tube", expectedMappings: Array(4).fill("seam-derived-tube") },
  { id: "spatial-open-chain", expectedMappings: Array(3).fill("rigid-panel") },
  { id: "xpbd-tube-with-flap", expectedMappings: ["seam-derived-tube", "rigid-panel"] },
  { id: "xpbd-four-panel-composite", expectedMappings: Array(4).fill("rigid-panel") },
];
mkdirSync(outputDir, { recursive: true });

const server = startServer();
await waitForServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-webgpu"],
});
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const consoleErrors = [];
const results = [];
let failure = null;

try {
  for (const definition of cases) {
    const page = await desktop.newPage();
    attachErrors(page);
    await openFixture(page, definition.id);
    const reset = await resetAndCapture(page, definition.id, "before");
    const mappings = reset.spatial.instances.map((instance) => instance.mapping).sort();
    const expected = [...definition.expectedMappings].sort();
    if (JSON.stringify(mappings) !== JSON.stringify(expected)) {
      throw new Error(`${definition.id}: mappings ${JSON.stringify(mappings)}; esperado ${JSON.stringify(expected)}.`);
    }
    if (reset.spatial.intrinsicDistortion.maxRelativeDistortion > 0.02) {
      throw new Error(`${definition.id}: distorção intrínseca excessiva.`);
    }
    for (let step = 1; step <= 6; step += 1) {
      await page.getByRole("button", { name: "Passo", exact: true }).click();
      await waitForPausedStep(page, step);
    }
    const afterSteps = await snapshot(page);
    await screenshotViewport(page, `${definition.id}-after-steps.png`);
    const restored = await resetAndCapture(page, definition.id, "restored");
    if (restored.positionSignature !== reset.positionSignature) {
      throw new Error(`${definition.id}: reset não restaurou a pose espacial exata.`);
    }
    results.push({ id: definition.id, reset, afterSteps, restored });
    await page.close();
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR" });
  const mobilePage = await mobile.newPage();
  attachErrors(mobilePage);
  await openFixture(mobilePage, "spatial-four-panel-tube");
  const mobileReset = await resetAndCapture(mobilePage, "spatial-four-panel-tube-mobile", "before");
  await mobile.close();
  if (consoleErrors.length > 0) throw new Error(`Console registrou ${consoleErrors.length} erro(s).`);
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ passed: true, results, mobileReset, consoleErrors }, null, 2));
} catch (error) {
  failure = error;
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({
    passed: false,
    results,
    consoleErrors,
    failure: error instanceof Error ? error.message : String(error),
  }, null, 2));
} finally {
  await desktop.close();
  await browser.close();
  await stopProcessTree(server);
}

process.stdout.write(JSON.stringify({
  passed: failure === null,
  cases: results.map((result) => ({
    id: result.id,
    instances: result.reset.spatial.instances.length,
    mappings: result.reset.spatial.instances.map((instance) => instance.mapping),
    intrinsicDistortion: result.reset.spatial.intrinsicDistortion.maxRelativeDistortion,
    resetExact: result.reset.positionSignature === result.restored.positionSignature,
    stepCount: result.afterSteps.diagnostics.stepCount,
  })),
  consoleErrors,
  failure: failure instanceof Error ? failure.message : failure,
}, null, 2));
if (failure) throw failure;

async function openFixture(page, id) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate((fixtureId) => window.__moldeonPhase0?.loadFixture(fixtureId), id);
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  await page.locator(".viewport-host").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const raw = document.querySelector(".viewport-host")?.getAttribute("data-simulation-diagnostics");
    return raw ? JSON.parse(raw).stepCount >= 2 : false;
  }, undefined, { timeout: 20_000 });
}

async function resetAndCapture(page, id, suffix) {
  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await waitForReset(page);
  await page.waitForTimeout(80);
  const state = await snapshot(page);
  await screenshotViewport(page, `${id}-${suffix}.png`);
  return state;
}

async function waitForReset(page) {
  await page.waitForFunction(() => {
    const host = document.querySelector(".viewport-host");
    if (host?.getAttribute("data-simulation-ui-state") !== "paused") return false;
    const diagnostics = JSON.parse(host.getAttribute("data-simulation-diagnostics") ?? "{}");
    const frame = JSON.parse(host.getAttribute("data-simulation-applied-frame") ?? "{}");
    return diagnostics.stepCount === 0 && frame.epoch === Number(host.getAttribute("data-simulation-epoch"));
  }, undefined, { timeout: 15_000 });
}

async function waitForPausedStep(page, expected) {
  await page.waitForFunction((step) => {
    const host = document.querySelector(".viewport-host");
    if (host?.getAttribute("data-simulation-ui-state") !== "paused") return false;
    const diagnostics = JSON.parse(host.getAttribute("data-simulation-diagnostics") ?? "{}");
    return diagnostics.stepCount === step;
  }, expected, { timeout: 15_000 });
}

async function snapshot(page) {
  return page.locator(".viewport-host").evaluate((host) => ({
    uiState: host.dataset.simulationUiState,
    workerState: host.dataset.simulationWorkerState,
    positionSignature: host.dataset.simulationPositionSignature,
    appliedFrame: JSON.parse(host.dataset.simulationAppliedFrame ?? "{}"),
    diagnostics: JSON.parse(host.dataset.simulationDiagnostics ?? "{}"),
    spatial: JSON.parse(host.dataset.spatialAssemblyDiagnostics ?? "{}"),
    meshes: JSON.parse(host.dataset.garmentMeshDiagnostics ?? "[]"),
  }));
}

async function screenshotViewport(page, name) {
  await page.locator(".viewport-host").screenshot({ path: resolve(outputDir, name) });
}

function attachErrors(page) {
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  page.on("pageerror", (error) => consoleErrors.push(error.message));
}

function startServer() {
  const executable = process.env.ComSpec ?? "cmd.exe";
  const command = `npm.cmd run dev:fallback --workspace @moldeon/web -- --host 127.0.0.1 --port ${port} --strictPort`;
  return spawn(executable, ["/d", "/s", "/c", command], {
    cwd: process.cwd(), env: process.env, windowsHide: true, stdio: "ignore",
  });
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Servidor encerrou com código ${server.exitCode}.`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* Vite iniciando. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Servidor local não respondeu em 60 segundos.");
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolveStop) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("close", resolveStop);
    killer.on("error", resolveStop);
  });
}
