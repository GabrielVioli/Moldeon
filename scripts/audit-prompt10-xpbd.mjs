import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5188;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/prompt-10-xpbd");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });
const mark = (stage, details = {}) => writeFileSync(resolve(outputDir, "stage.json"), JSON.stringify({ stage, ...details }, null, 2), "utf8");

const server = startServer();
await waitForServer();
mark("server-ready");
const browser = await chromium.launch({ headless: true, executablePath: chromePath, timeout: 20_000, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-webgpu"] });
mark("browser-launched");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
await context.addInitScript(() => {
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 2 });
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  process.stdout.write("[audit] abrindo aplicativo\n");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  mark("dom-loaded", { url: page.url() });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  mark("audit-bridge-ready");
  process.stdout.write("[audit] carregando tubo e refer\u00eancia frontal\n");
  await page.evaluate(() => {
    window.__moldeonPhase0?.loadFixture("self-seam-tube");
  });
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  mark("prove-clicked");
  process.stdout.write("[audit] Provar acionado; aguardando frames do Worker\n");

  const host = page.locator(".viewport-host");
  try {
    await page.waitForFunction(() => {
      const value = document.querySelector(".viewport-host")?.getAttribute("data-simulation-diagnostics");
      return value ? JSON.parse(value).stepCount > 2 : false;
    }, undefined, { timeout: 12_000 });
  } catch (error) {
    const failure = await page.evaluate(() => {
      const host = document.querySelector(".viewport-host");
      return {
        hostDataset: host instanceof HTMLElement ? { ...host.dataset } : null,
        bodyText: document.body.innerText.slice(0, 4_000),
        resources: performance.getEntriesByType("resource").map((entry) => entry.name),
      };
    });
    await page.screenshot({ path: resolve(outputDir, "startup-failure.png"), fullPage: true });
    writeFileSync(resolve(outputDir, "startup-failure.json"), JSON.stringify({ failure, consoleErrors }, null, 2), "utf8");
    throw error;
  }

  const running = await diagnostics();
  mark("worker-running", { running });
  const workerAsset = await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .find((name) => name.includes("simulation.worker")) ?? null);
  const meshDiagnostics = JSON.parse(await host.getAttribute("data-garment-mesh-diagnostics") ?? "[]");
  if (!workerAsset) throw new Error("O navegador não carregou o Web Worker XPBD.");
  if (!meshDiagnostics.length) throw new Error("Nenhuma mesh chegou ao Three.js.");
  if (running.invalid) throw new Error("O solver marcou o estado como inválido.");

  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.waitForTimeout(180);
  const paused = await diagnostics();
  await page.waitForTimeout(180);
  if ((await diagnostics()).stepCount !== paused.stepCount) throw new Error("Pausar não interrompeu o timestep.");

  await page.getByRole("button", { name: "Passo", exact: true }).click();
  await page.waitForTimeout(100);
  const stepped = await diagnostics();
  if (stepped.stepCount !== paused.stepCount + 1) throw new Error("Passo não avançou exatamente um timestep.");

  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await page.waitForTimeout(100);
  const reset = await diagnostics();
  if (reset.stepCount !== 0) throw new Error("Reiniciar não restaurou o passo zero.");

  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.waitForFunction(() => {
    const value = document.querySelector(".viewport-host")?.getAttribute("data-simulation-diagnostics");
    return value ? JSON.parse(value).stepCount > 2 : false;
  });
  const resumed = await diagnostics();
  await page.screenshot({ path: resolve(outputDir, "desktop-running.png"), fullPage: true });

  const caseA = await captureCase("A-tubo", 1);
  const generationA = caseA.generation;

  process.stdout.write("\n[audit] rebuild A → B (tubo + retalho costurado)\n");
  await loadPhysicalFixture("xpbd-tube-with-flap", 2, generationA, undefined, 180);
  const caseB = await captureCase("B-tubo-retalho", 2);
  await page.screenshot({ path: resolve(outputDir, "desktop-tube-with-flap.png"), fullPage: true });

  process.stdout.write("\n[audit] rebuild B → A (sem estado fantasma)\n");
  await loadPhysicalFixture("self-seam-tube", 1, caseB.generation);
  const restoredA = await captureCase("A-restaurado", 1);
  if (restoredA.topology.positionsLength !== caseA.topology.positionsLength
    || restoredA.topology.triangleCount !== caseA.topology.triangleCount
    || restoredA.topology.panels.map((panel) => panel.id).join(",") !== caseA.topology.panels.map((panel) => panel.id).join(",")) {
    throw new Error("O rebuild B → A não restaurou a topologia canônica do tubo.");
  }

  process.stdout.write("\n[audit] rebuild A → C (quatro painéis + costura composta 2↔3)\n");
  await loadPhysicalFixture("xpbd-four-panel-composite", 4, restoredA.generation);
  const caseC = await captureCase("C-quatro-paineis-compostos", 4);
  await page.screenshot({ path: resolve(outputDir, "desktop-four-panel-composite.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  let mobileControlsVisible = await page.locator(".viewport-simulation-controls").isVisible();
  if (!mobileControlsVisible) {
    await page.getByRole("tab", { name: "Manequim 3D", exact: true }).click();
    await page.waitForTimeout(300);
    mobileControlsVisible = await page.locator(".viewport-simulation-controls").isVisible();
  }
  if (!mobileControlsVisible) throw new Error("Controles da simulação não estão acessíveis no mobile.");
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.screenshot({ path: resolve(outputDir, "mobile-paused.png"), fullPage: true });

  if (consoleErrors.length > 0) throw new Error(`Erros no console: ${consoleErrors.join(" | ")}`);
  const report = {
    workerAsset,
    lifecycle: { running, paused, stepped, reset, resumed },
    initialMeshCount: meshDiagnostics.length,
    cases: { caseA, caseB, restoredA, caseC },
    mobileControlsVisible,
    consoleErrors,
  };
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(JSON.stringify(report, null, 2));
} finally {
  await stopProcessTree(server);
  await Promise.race([
    browser.close(),
    new Promise((resolveClose) => setTimeout(resolveClose, 5_000)),
  ]);
}

async function diagnostics() {
  return page.locator(".viewport-host").evaluate((element) => JSON.parse(element.dataset.simulationDiagnostics ?? "{}"));
}

async function loadPhysicalFixture(id, expectedPanels, previousGeneration, dressing, minimumSteps = 3) {
  await page.evaluate(async ({ fixtureId, nextDressing }) => {
    const host = document.querySelector(".viewport-host");
    if (host instanceof HTMLElement) {
      delete host.dataset.simulationRejectedFrame;
      delete host.dataset.simulationAppliedFrame;
    }
    window.__moldeonPhase0?.loadFixture(fixtureId);
    if (nextDressing) {
      const { useEditorStore } = await import("/src/state/editorStore.ts");
      useEditorStore.getState().setGarmentDressing(nextDressing);
    }
  }, { fixtureId: id, nextDressing: dressing });
  await page.waitForFunction(({ count, oldGeneration, steps }) => {
    const host = document.querySelector(".viewport-host");
    if (!(host instanceof HTMLElement)) return false;
    const topology = JSON.parse(host.dataset.simulationTopologyDiagnostics ?? "{}");
    const applied = JSON.parse(host.dataset.simulationAppliedFrame ?? "{}");
    const generation = Number(host.dataset.simulationGeneration ?? 0);
    const diagnostics = JSON.parse(host.dataset.simulationDiagnostics ?? "{}");
    return generation > oldGeneration
      && topology.panels?.length === count
      && applied.generation === generation
      && diagnostics.stepCount >= steps;
  }, { count: expectedPanels, oldGeneration: previousGeneration, steps: minimumSteps }, { timeout: 30_000 });
}

async function captureCase(label, expectedPanels) {
  const snapshot = await page.locator(".viewport-host").evaluate((element) => ({
    generation: Number(element.dataset.simulationGeneration ?? 0),
    topology: JSON.parse(element.dataset.simulationTopologyDiagnostics ?? "{}"),
    diagnostics: JSON.parse(element.dataset.simulationDiagnostics ?? "{}"),
    ready: JSON.parse(element.dataset.simulationWorkerReady ?? "{}"),
    applied: JSON.parse(element.dataset.simulationAppliedFrame ?? "{}"),
    rejected: element.dataset.simulationRejectedFrame
      ? JSON.parse(element.dataset.simulationRejectedFrame)
      : null,
    workerState: element.dataset.simulationWorkerState ?? null,
    meshes: JSON.parse(element.dataset.garmentMeshDiagnostics ?? "[]"),
  }));
  if (!snapshot.topology.valid) throw new Error(`${label}: topologia inválida antes do Worker.`);
  if (snapshot.topology.panels?.length !== expectedPanels) throw new Error(`${label}: quantidade incorreta de painéis.`);
  if (snapshot.meshes.length !== expectedPanels) throw new Error(`${label}: quantidade incorreta de meshes no Three.js.`);
  if (snapshot.topology.maximumTriangleIndex >= snapshot.topology.particleCount) throw new Error(`${label}: índice global fora do limite.`);
  if (snapshot.topology.positionsLength !== snapshot.topology.particleCount * 3) throw new Error(`${label}: buffer de posições inconsistente.`);
  if (snapshot.applied.generation !== snapshot.generation || snapshot.ready.generation !== snapshot.generation) {
    throw new Error(`${label}: frame/revisão do Worker não corresponde à geometria atual.`);
  }
  if (snapshot.rejected?.generation === snapshot.generation
    && snapshot.rejected?.expectedGeneration === snapshot.generation) {
    throw new Error(`${label}: o renderer rejeitou um frame da geração atual: ${JSON.stringify(snapshot.rejected)}`);
  }
  if (snapshot.diagnostics.invalid) throw new Error(`${label}: solver marcou o estado como inválido.`);
  if (!(snapshot.diagnostics.stepCount > 2)) throw new Error(`${label}: simulação não avançou.`);
  if (!(snapshot.diagnostics.seamConstraintCount > 0)) throw new Error(`${label}: nenhuma seam constraint física foi gerada.`);
  if (!(snapshot.diagnostics.maximumPositionMagnitude < 20)) throw new Error(`${label}: posições explodiram.`);
  return snapshot;
}

function startServer() {
  const executable = process.env.ComSpec ?? "cmd.exe";
  const command = `npm.cmd run dev:fallback --workspace @moldeon/web -- --host 127.0.0.1 --port ${port} --strictPort`;
  return spawn(executable, ["/d", "/s", "/c", command], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: "ignore" });
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
