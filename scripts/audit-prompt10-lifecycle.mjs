import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const mode = process.argv.includes("--expect-bug") ? "pre-fix" : "validation";
const mobileOnly = process.argv.includes("--mobile-only");
const artifactName = mobileOnly ? "mobile-validation" : mode;
const port = 5189;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/prompt-10-lifecycle");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const server = startServer();
await waitForServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-webgpu"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
await context.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 2 }));
let page = await context.newPage();
const consoleErrors = [];
attachPageDiagnostics(page);

const report = { mode, basic: null, stressCycles: [], rapidSequences: [], mobile: null, consoleErrors };
let failure = null;

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("self-seam-tube"));
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  await waitForStepAtLeast(20);

  if (mobileOnly) {
    report.mobile = await runMobileSmoke();
  } else {
    report.basic = await runResetFreeze("basic", 5_200);
    if (mode === "pre-fix") {
      if (!report.basic.changedWhilePaused) throw new Error("A reprodução pré-correção não manifestou o bug esperado.");
    } else {
      assertFrozen(report.basic.afterReset, report.basic.afterWait, "reset básico");
      for (let cycle = 1; cycle <= 10; cycle += 1) report.stressCycles.push(await runStressCycle(cycle));
      report.rapidSequences = await runRapidSequences();
      report.mobile = await runMobileSmoke();
      if (consoleErrors.length > 0) throw new Error(`Console registrou ${consoleErrors.length} erro(s).`);
    }
  }
} catch (error) {
  failure = error;
} finally {
  report.failure = failure instanceof Error ? failure.message : failure ? String(failure) : null;
  writeFileSync(resolve(outputDir, `${artifactName}-report.json`), JSON.stringify(report, null, 2), "utf8");
  await page.screenshot({ path: resolve(outputDir, `${artifactName}.png`), fullPage: true }).catch(() => undefined);
  await stopProcessTree(server);
  await browser.close();
}

process.stdout.write(JSON.stringify({
  mode,
  passed: failure === null,
  basic: summarizeFreeze(report.basic),
  stressCycles: report.stressCycles.map((cycle) => ({
    cycle: cycle.cycle,
    pauseStep: cycle.pause.afterCommand.diagnostics.stepCount,
    stepAfterSingle: cycle.singleStep.afterCommand.diagnostics.stepCount,
    resetStep: cycle.reset.afterReset.diagnostics.stepCount,
    resetStable: !cycle.reset.changedWhilePaused,
  })),
  rapidSequences: report.rapidSequences.map((entry) => entry.name),
  mobile: report.mobile ? summarizeFreeze(report.mobile.reset) : null,
  consoleErrors,
  failure: report.failure,
}, null, 2));
if (failure) throw failure;

async function runStressCycle(cycle) {
  const beforeRun = await snapshot();
  await click("Continuar");
  await waitForLifecycle("running");
  await waitForStepAtLeast(beforeRun.diagnostics.stepCount + 4);
  const pause = await runPauseFreeze(250);
  const singleStep = await runSingleStepFreeze(250);
  await click("Continuar");
  await waitForLifecycle("running");
  await waitForStepAtLeast(singleStep.afterCommand.diagnostics.stepCount + 4);
  const reset = await runResetFreeze(`cycle-${cycle}`, 5_100);
  assertFrozen(reset.afterReset, reset.afterWait, `reset ciclo ${cycle}`);
  return { cycle, pause, singleStep, reset };
}

async function runPauseFreeze(waitMs) {
  await click("Pausar");
  await waitForLifecycle("paused");
  await page.waitForTimeout(80);
  const afterCommand = await snapshot();
  await page.waitForTimeout(waitMs);
  const afterWait = await snapshot();
  assertFrozen(afterCommand, afterWait, "pause");
  return { afterCommand, afterWait };
}

async function runSingleStepFreeze(waitMs) {
  const before = await snapshot();
  await click("Passo");
  await waitForPausedStep(before.diagnostics.stepCount + 1);
  await page.waitForTimeout(80);
  const afterCommand = await snapshot();
  if (afterCommand.diagnostics.stepCount !== before.diagnostics.stepCount + 1) {
    throw new Error(`Passo avançou ${afterCommand.diagnostics.stepCount - before.diagnostics.stepCount} steps; esperado: 1.`);
  }
  await page.waitForTimeout(waitMs);
  const afterWait = await snapshot();
  assertFrozen(afterCommand, afterWait, "passo pausado");
  return { before, afterCommand, afterWait };
}

async function runResetFreeze(label, waitMs) {
  const beforeReset = await snapshot();
  await click("Reiniciar");
  await waitForResetFrame();
  await page.waitForTimeout(80);
  const afterReset = await snapshot();
  await page.waitForTimeout(waitMs);
  const afterWait = await snapshot();
  return { label, beforeReset, afterReset, afterWait, changedWhilePaused: hasPhysicalChange(afterReset, afterWait) };
}

async function runRapidSequences() {
  const results = [];
  await clickMany(["Reiniciar", "Reiniciar"]);
  await waitForResetFrame();
  results.push({ name: "reset → reset", ...(await frozenAfter(300, "reset → reset")) });

  await clickMany(["Reiniciar", "Continuar"]);
  await waitForLifecycle("running");
  await waitForStepAtLeast(3);
  results.push({ name: "reset → resume", after: await snapshot() });

  await clickMany(["Pausar", "Reiniciar"]);
  await waitForResetFrame();
  results.push({ name: "pause → reset", ...(await frozenAfter(300, "pause → reset")) });

  await clickMany(["Continuar", "Reiniciar"]);
  await waitForResetFrame();
  results.push({ name: "resume → reset", ...(await frozenAfter(300, "resume → reset")) });

  await click("Continuar");
  await waitForLifecycle("running");
  await waitForStepAtLeast(3);
  await click("Pausar");
  await waitForLifecycle("paused");
  await click("Continuar");
  await waitForLifecycle("running");
  await click("Pausar");
  await waitForLifecycle("paused");
  results.push({ name: "pause → resume → pause", ...(await frozenAfter(300, "pause → resume → pause")) });

  const beforeTwoSteps = await snapshot();
  await clickMany(["Passo", "Passo"]);
  await waitForPausedStep(beforeTwoSteps.diagnostics.stepCount + 2);
  const afterTwoSteps = await snapshot();
  if (afterTwoSteps.diagnostics.stepCount !== beforeTwoSteps.diagnostics.stepCount + 2) {
    throw new Error("Dois comandos Passo não produziram exatamente dois steps.");
  }
  await click("Continuar");
  await waitForLifecycle("running");
  results.push({ name: "pause → step → step → resume", beforeTwoSteps, afterTwoSteps, afterResume: await snapshot() });

  await click("Pausar");
  await waitForLifecycle("paused");
  await clickRepeated("Continuar", 6);
  await waitForLifecycle("running");
  const repeatedResumeStart = await snapshot();
  await waitForStepAtLeast(repeatedResumeStart.diagnostics.stepCount + 6);
  await click("Pausar");
  await waitForLifecycle("paused");
  results.push({ name: "6× Continuar rápido", ...(await frozenAfter(300, "6× Continuar rápido")) });
  return results;
}

async function runMobileSmoke() {
  await page.close();
  page = await context.newPage();
  attachPageDiagnostics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("self-seam-tube"));
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  await page.locator(".viewport-host").waitFor({ state: "visible", timeout: 10_000 });
  await waitForStepAtLeast(4);
  await click("Pausar");
  await waitForLifecycle("paused");
  const before = await snapshot();
  await click("Continuar");
  await waitForLifecycle("running");
  await waitForStepAtLeast(before.diagnostics.stepCount + 4);
  const pause = await runPauseFreeze(250);
  const singleStep = await runSingleStepFreeze(250);
  await click("Continuar");
  await waitForLifecycle("running");
  await waitForStepAtLeast(singleStep.afterCommand.diagnostics.stepCount + 4);
  const reset = await runResetFreeze("mobile", 5_100);
  assertFrozen(reset.afterReset, reset.afterWait, "reset mobile");
  return { viewport: { width: 390, height: 844 }, pause, singleStep, reset };
}

function attachPageDiagnostics(targetPage) {
  targetPage.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  targetPage.on("pageerror", (error) => consoleErrors.push(error.message));
}

async function frozenAfter(waitMs, label) {
  await page.waitForTimeout(80);
  const afterCommand = await snapshot();
  await page.waitForTimeout(waitMs);
  const afterWait = await snapshot();
  assertFrozen(afterCommand, afterWait, label);
  return { afterCommand, afterWait };
}

function assertFrozen(first, second, label) {
  if (hasPhysicalChange(first, second)) throw new Error(`${label}: simulação mudou enquanto deveria estar pausada.`);
  if (!first.workerSnapshot || !second.workerSnapshot
    || first.workerSnapshot.lifecycle !== "paused" || second.workerSnapshot.lifecycle !== "paused") {
    throw new Error(`${label}: Worker não confirmou estado paused.`);
  }
  if (first.workerSnapshot.timerActive || second.workerSnapshot.timerActive) throw new Error(`${label}: timer permaneceu ativo.`);
  if (first.workerSnapshot.framesProduced !== second.workerSnapshot.framesProduced
    || first.workerSnapshot.framesSent !== second.workerSnapshot.framesSent) {
    throw new Error(`${label}: Worker produziu ou enviou frame físico após pausar.`);
  }
}

function hasPhysicalChange(first, second) {
  return first.diagnostics.stepCount !== second.diagnostics.stepCount
    || first.positionSignature !== second.positionSignature
    || first.appliedFrame.epoch !== second.appliedFrame.epoch
    || first.appliedFrame.sequence !== second.appliedFrame.sequence;
}

async function snapshot() {
  return page.locator(".viewport-host").evaluate((element) => {
    const parse = (value, fallback) => {
      try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
    };
    const trace = parse(element.dataset.simulationLifecycleTrace, []);
    const workerSnapshot = [...trace].reverse().find((entry) => entry.event === "worker-state") ?? null;
    return {
      timestampMs: performance.now(),
      uiState: element.dataset.simulationUiState,
      workerState: element.dataset.simulationWorkerState,
      simulationStatus: element.dataset.simulationStatus,
      epoch: Number(element.dataset.simulationEpoch ?? -1),
      diagnostics: parse(element.dataset.simulationDiagnostics, {}),
      frameCounters: parse(element.dataset.simulationFrameCounters, {}),
      positionSignature: element.dataset.simulationPositionSignature ?? null,
      appliedFrame: parse(element.dataset.simulationAppliedFrame, {}),
      workerSnapshot,
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

async function waitForResetFrame() {
  await page.waitForFunction(() => {
    const host = document.querySelector(".viewport-host");
    if (!host || host.getAttribute("data-simulation-ui-state") !== "paused") return false;
    const diagnostics = JSON.parse(host.getAttribute("data-simulation-diagnostics") ?? "{}");
    const frame = JSON.parse(host.getAttribute("data-simulation-applied-frame") ?? "{}");
    return diagnostics.stepCount === 0 && frame.epoch === Number(host.getAttribute("data-simulation-epoch"));
  }, undefined, { timeout: 10_000 });
}

async function waitForPausedStep(expectedStep) {
  await page.waitForFunction((step) => {
    const host = document.querySelector(".viewport-host");
    if (!host || host.getAttribute("data-simulation-ui-state") !== "paused") return false;
    const diagnostics = JSON.parse(host.getAttribute("data-simulation-diagnostics") ?? "{}");
    const frame = JSON.parse(host.getAttribute("data-simulation-applied-frame") ?? "{}");
    return diagnostics.stepCount === step && frame.epoch === Number(host.getAttribute("data-simulation-epoch"));
  }, expectedStep, { timeout: 10_000 });
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

async function clickMany(names) {
  await page.evaluate((labels) => {
    const buttons = [...document.querySelectorAll("button")];
    for (const label of labels) {
      const button = buttons.find((candidate) => candidate.textContent?.trim() === label);
      if (!button) throw new Error(`Botão ${label} não encontrado.`);
      button.click();
    }
  }, names);
}

async function clickRepeated(name, count) {
  await page.evaluate(({ label, repetitions }) => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error(`Botão ${label} não encontrado.`);
    for (let index = 0; index < repetitions; index += 1) button.click();
  }, { label: name, repetitions: count });
}

function summarizeFreeze(value) {
  if (!value) return null;
  return {
    resetStep: value.afterReset.diagnostics.stepCount,
    afterWaitStep: value.afterWait.diagnostics.stepCount,
    resetPosition: value.afterReset.positionSignature,
    afterWaitPosition: value.afterWait.positionSignature,
    workerAtReset: value.afterReset.workerState,
    workerAfterWait: value.afterWait.workerState,
    changedWhilePaused: value.changedWhilePaused,
  };
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
