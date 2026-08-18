import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5192;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/prompt-10-2-physics-diagnostics");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const server = startServer();
await waitForServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-webgpu"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

const report = { passed: false, testA: null, testB: null, testC: null, wireframe: false, consoleErrors };
let failure = null;

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("spatial-notched-tube-waistband"));
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  await page.getByLabel("Diagnóstico físico DEV").waitFor();
  await pauseAndReset();

  await page.getByLabel("Gravidade").selectOption("0");
  await page.getByLabel("Auto-pause").selectOption("60");
  await click("Continuar");
  await waitForPausedStep(60);
  report.testA = await snapshot();
  await page.screenshot({ path: resolve(outputDir, "gravity-zero-auto-pause-60.png") });
  if (report.testA.diagnostics.invalid) throw new Error("Teste A terminou com solver inválido.");
  if (report.testA.diagnostics.maximumPositionMagnitude > 5) throw new Error("Teste A excedeu magnitude espacial segura.");
  if (report.testA.instanceCount !== 5) throw new Error(`Teste A renderizou ${report.testA.instanceCount}/5 painéis.`);

  await click("Reiniciar");
  await waitForPausedStep(0);
  await page.getByLabel("Gravidade").selectOption("0.25");
  await page.getByLabel("Simulação").selectOption("0.25");
  await page.getByLabel("Auto-pause").selectOption("0");
  const slowStartedAt = performance.now();
  await click("Continuar");
  await waitForStepAtLeast(6);
  const slowElapsedMs = performance.now() - slowStartedAt;
  await click("Pausar");
  await waitForLifecycle("paused");
  report.testB = { ...(await snapshot()), slowElapsedMs };
  if (slowElapsedMs < 120) throw new Error(`Cadência 0.25x executou rápido demais (${slowElapsedMs.toFixed(1)} ms).`);

  const beforeStep = await snapshot();
  await click("Passo");
  await waitForPausedStep(beforeStep.diagnostics.stepCount + 1);
  const afterStep = await snapshot();
  await page.waitForTimeout(180);
  const frozen = await snapshot();
  report.testC = { beforeStep, afterStep, frozen };
  if (afterStep.diagnostics.stepCount !== beforeStep.diagnostics.stepCount + 1) throw new Error("Passo não avançou exatamente um timestep.");
  if (frozen.diagnostics.stepCount !== afterStep.diagnostics.stepCount) throw new Error("Passo não permaneceu pausado.");
  if (frozen.positionSignature !== afterStep.positionSignature) throw new Error("A malha mudou depois do Passo pausado.");

  await page.getByLabel("Wireframe").check();
  report.wireframe = await page.locator(".viewport-host").getAttribute("data-simulation-wireframe") === "true";
  if (!report.wireframe) throw new Error("Wireframe não foi aplicado.");
  await click("Enquadrar roupa");
  if (consoleErrors.length > 0) throw new Error(`Console registrou ${consoleErrors.length} erro(s).`);
  report.passed = true;
} catch (error) {
  failure = error;
} finally {
  report.failure = failure instanceof Error ? failure.message : failure ? String(failure) : null;
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await page.screenshot({ path: resolve(outputDir, "physics-diagnostics.png"), fullPage: true }).catch(() => undefined);
  await browser.close();
  await stopProcessTree(server);
}

process.stdout.write(JSON.stringify({
  passed: report.passed,
  testAStep: report.testA?.diagnostics.stepCount,
  testAPhysicsStepMs: report.testA?.diagnostics.physicsStepMs,
  testAFps: report.testA?.telemetryFps,
  testBElapsedMs: report.testB?.slowElapsedMs,
  testCSteps: report.testC ? [report.testC.beforeStep.diagnostics.stepCount, report.testC.afterStep.diagnostics.stepCount, report.testC.frozen.diagnostics.stepCount] : null,
  wireframe: report.wireframe,
  consoleErrors,
  failure: report.failure,
}, null, 2));
if (failure) throw failure;

async function pauseAndReset() {
  await waitForStepAtLeast(2);
  await click("Pausar");
  await waitForLifecycle("paused");
  await click("Reiniciar");
  await waitForPausedStep(0);
}

async function snapshot() {
  return page.locator(".viewport-host").evaluate((element) => {
    const diagnostics = JSON.parse(element.getAttribute("data-simulation-diagnostics") ?? "{}");
    const telemetryRows = [...element.querySelectorAll(".viewport-physics-dev dl > *")].map((item) => item.textContent ?? "");
    const fpsIndex = telemetryRows.indexOf("FPS");
    return {
      uiState: element.getAttribute("data-simulation-ui-state"),
      workerState: element.getAttribute("data-simulation-worker-state"),
      positionSignature: element.getAttribute("data-simulation-position-signature"),
      instanceCount: Number(element.getAttribute("data-garment-instance-count")),
      diagnostics,
      telemetryFps: fpsIndex >= 0 ? Number(telemetryRows[fpsIndex + 1]) : null,
      devSettings: JSON.parse(element.getAttribute("data-simulation-dev-settings") ?? "{}"),
    };
  });
}

async function waitForLifecycle(lifecycle) {
  await page.waitForFunction((expected) => {
    const host = document.querySelector(".viewport-host");
    return host?.getAttribute("data-simulation-ui-state") === expected
      && host?.getAttribute("data-simulation-worker-state")?.startsWith(`${expected}:`);
  }, lifecycle, { timeout: 10_000 });
}

async function waitForPausedStep(step) {
  await page.waitForFunction((expected) => {
    const host = document.querySelector(".viewport-host");
    const diagnostics = JSON.parse(host?.getAttribute("data-simulation-diagnostics") ?? "{}");
    return host?.getAttribute("data-simulation-ui-state") === "paused" && diagnostics.stepCount === expected;
  }, step, { timeout: 20_000 });
}

async function waitForStepAtLeast(step) {
  await page.waitForFunction((minimum) => {
    const value = document.querySelector(".viewport-host")?.getAttribute("data-simulation-diagnostics");
    return value ? JSON.parse(value).stepCount >= minimum : false;
  }, step, { timeout: 20_000 });
}

async function click(name) {
  await page.getByRole("button", { name, exact: true }).click();
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
