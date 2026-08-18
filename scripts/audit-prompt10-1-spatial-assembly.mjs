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
  { id: "spatial-notched-tube", expectedMappings: Array(4).fill("seam-derived-tube") },
  {
    id: "spatial-notched-tube-waistband",
    expectedMappings: Array(5).fill("seam-derived-tube"),
  },
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
let localClosureComparison = null;

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
    if (reset.meshes.length !== expected.length
      || reset.meshes.some((mesh) => mesh.meshCount !== 1
        || !mesh.meanNormal.every(Number.isFinite)
        || !mesh.meanTriangleNormal.every(Number.isFinite))) {
      throw new Error(`${definition.id}: identidade, contagem ou normals das meshes inválidas.`);
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

  const notchedBody = results.find((result) => result.id === "spatial-notched-tube")?.reset;
  const notchedWithBand = results.find((result) => result.id === "spatial-notched-tube-waistband")?.reset;
  if (!notchedBody || !notchedWithBand) throw new Error("Casos de corpo recortado incompletos.");
  const stableBodyMesh = (mesh) => ({
    id: mesh.id,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    boundingBox: mesh.boundingBox,
    centroid: mesh.centroid,
    transform: mesh.transform,
    geometrySignature: mesh.geometrySignature,
    meanNormal: mesh.meanNormal,
    meanTriangleNormal: mesh.meanTriangleNormal,
    materialSide: mesh.materialSide,
  });
  const bodyMeshesBefore = notchedBody.meshes.map(stableBodyMesh);
  const bodyMeshesAfter = notchedWithBand.meshes
    .filter((mesh) => mesh.id !== "spatial-upper-band:panel:1")
    .map(stableBodyMesh);
  if (JSON.stringify(bodyMeshesBefore) !== JSON.stringify(bodyMeshesAfter)) {
    throw new Error("A faixa superior alterou a casca, transforms ou normals do corpo principal.");
  }
  const bodyCenter = notchedWithBand.spatial.instances[0].tubeCenter;
  const band = notchedWithBand.spatial.instances.find((instance) => instance.id === "spatial-upper-band:panel:1");
  if (!band || Math.hypot(band.tubeCenter[0] - bodyCenter[0], band.tubeCenter[2] - bodyCenter[2]) > 0.007) {
    throw new Error("Loop superior não foi alinhado à casca global.");
  }

  const comparisonPage = await desktop.newPage();
  attachErrors(comparisonPage);
  await openFixture(comparisonPage, "spatial-notched-tube");
  const beforeLocalClosure = await resetAndCapture(comparisonPage, "spatial-notched-tube-A", "before");
  const previousGeneration = Number(beforeLocalClosure.appliedFrame.generation ?? 0);
  await comparisonPage.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const { getPatternEdges } = await import("/src/domain/pattern.ts");
    const state = useEditorStore.getState();
    const first = state.garment.pieces.find((piece) => piece.id === "spatial-notch-1");
    const second = state.garment.pieces.find((piece) => piece.id === "spatial-notch-2");
    if (!first || !second) throw new Error("Painéis recortados ausentes no fixture.");
    state.addSeam(
      { pieceId: first.id, edgeId: getPatternEdges(first)[2].id, startT: 0, endT: 1 },
      { pieceId: second.id, edgeId: getPatternEdges(second)[0].id, startT: 0, endT: 1 },
      "reverse",
    );
  });
  await comparisonPage.waitForFunction((oldGeneration) => {
    const host = document.querySelector(".viewport-host");
    if (!(host instanceof HTMLElement)) return false;
    const generation = Number(host.dataset.simulationGeneration ?? 0);
    const spatial = JSON.parse(host.dataset.spatialAssemblyDiagnostics ?? "{}");
    return generation > oldGeneration && spatial.seamGraph?.edges?.length === 5;
  }, previousGeneration, { timeout: 15_000 });
  const afterLocalClosure = await resetAndCapture(comparisonPage, "spatial-notched-tube-B-local-closure", "before");
  const stableMesh = (mesh) => ({
    id: mesh.id,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    boundingBox: mesh.boundingBox,
    centroid: mesh.centroid,
    transform: mesh.transform,
    geometrySignature: mesh.geometrySignature,
    meshCount: mesh.meshCount,
    meanNormal: mesh.meanNormal,
    meanTriangleNormal: mesh.meanTriangleNormal,
    materialSide: mesh.materialSide,
  });
  if (beforeLocalClosure.positionSignature !== afterLocalClosure.positionSignature) {
    throw new Error("Fechamento local alterou a pose tubular primária.");
  }
  if (JSON.stringify(beforeLocalClosure.meshes.map(stableMesh)) !== JSON.stringify(afterLocalClosure.meshes.map(stableMesh))) {
    throw new Error("Fechamento local alterou identidade, geometria, transform ou normals das meshes.");
  }
  if (afterLocalClosure.spatial.instances.some((instance) => instance.mapping !== "seam-derived-tube")) {
    throw new Error("Fechamento local removeu uma instância da casca tubular.");
  }
  for (let step = 1; step <= 6; step += 1) {
    await comparisonPage.getByRole("button", { name: "Passo", exact: true }).click();
    await waitForPausedStep(comparisonPage, step);
  }
  const afterLocalClosureSteps = await snapshot(comparisonPage);
  await screenshotViewport(comparisonPage, "spatial-notched-tube-B-local-closure-after-steps.png");
  if (afterLocalClosureSteps.diagnostics.invalid || afterLocalClosureSteps.meshes.length !== 4) {
    throw new Error("Fechamento local corrompeu o solver ou a contagem de meshes durante os steps.");
  }
  if (afterLocalClosureSteps.diagnostics.seamErrorMaximum > afterLocalClosure.diagnostics.seamErrorMaximum + 1e-6) {
    throw new Error("Fechamento local aumentou o residual de seam durante os steps.");
  }
  localClosureComparison = { beforeLocalClosure, afterLocalClosure, afterLocalClosureSteps };
  await comparisonPage.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR" });
  const mobilePage = await mobile.newPage();
  attachErrors(mobilePage);
  await openFixture(mobilePage, "spatial-four-panel-tube");
  const mobileReset = await resetAndCapture(mobilePage, "spatial-four-panel-tube-mobile", "before");
  await mobile.close();
  if (consoleErrors.length > 0) throw new Error(`Console registrou ${consoleErrors.length} erro(s).`);
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ passed: true, results, localClosureComparison, mobileReset, consoleErrors }, null, 2));
} catch (error) {
  failure = error;
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({
    passed: false,
    results,
    localClosureComparison,
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
  localClosure: localClosureComparison ? {
    graphEdgesBefore: localClosureComparison.beforeLocalClosure.spatial.seamGraph.edges.length,
    graphEdgesAfter: localClosureComparison.afterLocalClosure.spatial.seamGraph.edges.length,
    mappingsAfter: localClosureComparison.afterLocalClosure.spatial.instances.map((instance) => instance.mapping),
    meshCountBefore: localClosureComparison.beforeLocalClosure.meshes.length,
    meshCountAfter: localClosureComparison.afterLocalClosure.meshes.length,
    seamErrorBeforeSteps: localClosureComparison.afterLocalClosure.diagnostics.seamErrorMaximum,
    seamErrorAfterSteps: localClosureComparison.afterLocalClosureSteps.diagnostics.seamErrorMaximum,
    positionSignaturePreserved: localClosureComparison.beforeLocalClosure.positionSignature
      === localClosureComparison.afterLocalClosure.positionSignature,
  } : null,
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
