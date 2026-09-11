import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { STEP0_E2E_SCENARIOS } from "./step0-browser-scenarios.mjs";

const baseUrl = process.env.STEP0_BASE_URL ?? "http://127.0.0.1:5173";
const outputDirectory = resolve(process.env.STEP0_ARTIFACT_DIR ?? "artifacts/step0-browser");
const requestedSuite = process.env.STEP0_SUITE === "full" ? "full" : "quick";
const suiteScenarios = requestedSuite === "full"
  ? STEP0_E2E_SCENARIOS
  : STEP0_E2E_SCENARIOS.filter((scenario) => scenario.quick);
const selectedScenarios = process.env.STEP0_FILTER
  ? suiteScenarios.filter((scenario) => scenario.id.includes(process.env.STEP0_FILTER))
  : suiteScenarios;
await mkdir(outputDirectory, { recursive: true });

const startedAt = performance.now();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  suite: requestedSuite,
  browserVersion: browser.version(),
  head: process.env.GITHUB_SHA ?? null,
  scenarioCount: selectedScenarios.length,
  totalCatalogCount: STEP0_E2E_SCENARIOS.length,
  scenarios: [],
};

try {
  for (const scenario of selectedScenarios) {
    const result = await runScenario(browser, scenario);
    report.scenarios.push(result);
    process.stdout.write(`[step0-e2e] ${scenario.id}: ${result.status} (${(result.elapsedMs / 1_000).toFixed(1)}s)\n`);
  }
} finally {
  await browser.close();
}

report.elapsedMs = performance.now() - startedAt;
report.passed = report.scenarios.filter((scenario) => scenario.status === "passed").length;
report.failed = report.scenarios.filter((scenario) => scenario.status !== "passed").length;
await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "coverage.md"), coverageMarkdown(STEP0_E2E_SCENARIOS), "utf8");
process.stdout.write(`${JSON.stringify({
  suite: report.suite,
  scenarios: report.scenarioCount,
  passed: report.passed,
  failed: report.failed,
  elapsedMs: Number(report.elapsedMs.toFixed(1)),
  failures: report.scenarios.filter((scenario) => scenario.status !== "passed").map((scenario) => ({
    id: scenario.id,
    error: scenario.error,
    failedAssertions: scenario.assertions?.filter((assertion) => !assertion.passed).map((assertion) => assertion.name),
  })),
}, null, 2)}\n`);
if (report.failed > 0) process.exitCode = 1;

async function runScenario(browserInstance, scenario) {
  const scenarioStartedAt = performance.now();
  const context = await browserInstance.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  let source = null;
  let result = null;
  let assertions = [];
  let error = null;
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__moldeonPhase0), null, { timeout: 20_000 });
    const plans = await drawAndPlacePanels(page, scenario);
    await authorSeams(page, scenario, plans);
    await page.getByRole("button", { name: "Montar", exact: true }).click();
    const viewport = page.locator('[data-testid="dressed-avatar-viewport"]');
    await viewport.waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("canvas.three-canvas").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
      return host?.dataset.assemblyStatus === "ready"
        && Number(host.dataset.garmentInstanceCount ?? "0") > 0;
    }, null, { timeout: 60_000 });
    source = await captureSource(page, viewport);
    await page.getByRole("button", { name: "Ajustar montagem", exact: true }).click();
    await page.waitForFunction(() => {
      const notice = document.querySelector(".viewport-sewing-step0-status")?.textContent ?? "";
      const status = document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.sewingStep0Status ?? "";
      return Boolean(notice) && !notice.includes("Ajustando")
        && !status.startsWith("solving") && !status.startsWith("polishing");
    }, null, { timeout: 60_000 });
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    result = await captureResult(page, viewport);
    assertions = validateScenario(scenario, source, result, consoleErrors);
    const failures = assertions.filter((assertion) => !assertion.passed);
    if (failures.length > 0) error = failures.map((failure) => `${failure.name}: ${failure.detail}`).join(" | ");
    await page.screenshot({ path: resolve(outputDirectory, `${scenario.id}.png`), fullPage: true });
  } catch (reason) {
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    await page.screenshot({ path: resolve(outputDirectory, `${scenario.id}-error.png`), fullPage: true }).catch(() => undefined);
  } finally {
    await context.close();
  }
  return {
    id: scenario.id,
    coverage: scenario.coverage,
    quick: scenario.quick,
    status: error ? "failed" : "passed",
    elapsedMs: performance.now() - scenarioStartedAt,
    configuration: publicScenario(scenario),
    source,
    result,
    assertions,
    consoleErrors,
    error,
  };
}

async function drawAndPlacePanels(page, scenario) {
  const canvas = page.locator("canvas.pattern-canvas");
  const initialBox = await canvas.boundingBox();
  if (!initialBox) throw new Error("Editor 2D não disponibilizou o canvas.");
  const columns = Math.ceil(scenario.panelCount / (scenario.panelCount > 4 ? 2 : 1));
  const gap = initialBox.width * 0.022;
  const safeWidth = initialBox.width - 140 - gap * (columns - 1);
  const zoomPercent = Math.min(55, Math.floor(100 * safeWidth / (1_250 * scenario.circumferenceFraction)));
  await setEditorZoom(page, zoomPercent);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Editor 2D não disponibilizou o canvas.");
  const plans = panelPlans(scenario, box, zoomPercent / 100);
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    page.once("dialog", (dialog) => dialog.accept(`${scenario.id}-painel-${index + 1}`));
    const empty = page.getByRole("button", { name: "Desenhar primeira peça", exact: true });
    if (await empty.count()) await empty.click();
    else await page.locator('[data-testid="primary-tool-draft"]').click();
    for (const point of plan.points) await canvas.click({ position: point });
    await page.keyboard.press("Enter");
    await page.waitForFunction((count) => window.__moldeonPhase0?.state().pieces.length === count, index + 1);
    const anchor = scenario.anchors[index % scenario.anchors.length];
    const anchorSelect = page.getByLabel("Referência corporal").last();
    await anchorSelect.selectOption(anchor);
    await page.getByRole("button", { name: "Aplicar à instância", exact: true }).last().click();
  }
  return plans;
}

async function authorSeams(page, scenario, plans) {
  const pairs = seamPairs(scenario);
  const canvas = page.locator("canvas.pattern-canvas");
  if (scenario.seamKind === "incomplete") {
    await enterSewing2D(page);
    await canvas.click({ position: plans[0].right });
    await page.keyboard.press("Escape");
    return;
  }
  for (let index = 0; index < pairs.length; index += 1) {
    await enterSewing2D(page);
    const firstPoint = plans[pairs[index].first.panel][pairs[index].first.side];
    const secondPoint = plans[pairs[index].second.panel][pairs[index].second.side];
    await canvas.click({ position: firstPoint });
    await canvas.click({ position: secondPoint });
    const review = page.getByRole("region", { name: "Concluir ação" });
    const confirmInEditor = review.getByRole("button", { name: "Confirmar costura", exact: true });
    if (!await confirmInEditor.isVisible()) {
      const debug = await page.evaluate(() => ({
        context: document.querySelector('.context-bar')?.textContent?.trim() ?? null,
        canvas: document.querySelector('canvas.pattern-canvas')?.getBoundingClientRect().toJSON() ?? null,
      }));
      throw new Error(`Cliques 2D não criaram proposta em ${JSON.stringify([firstPoint, secondPoint])}: ${JSON.stringify(debug)}`);
    }
    if (scenario.sameDirection && index === 0) {
      await page.locator('.workspace-mode-switch').getByRole("button", { name: "Montar", exact: true }).click();
      const proposal = page.getByRole("dialog", { name: "Confirmar proposta de costura" });
      await proposal.getByLabel("Direção da costura").selectOption("same");
      await proposal.getByRole("button", { name: "Confirmar", exact: true }).click();
    } else {
      await confirmInEditor.click();
    }
    await page.waitForFunction((count) => window.__moldeonPhase0?.state().seamCount === count, index + 1);
  }
}

async function setEditorZoom(page, percent) {
  const indicator = page.locator("button.zoom-indicator");
  await indicator.click();
  const input = page.getByLabel("Zoom em porcentagem");
  await input.fill(String(percent));
  await input.press("Enter");
  await page.locator("button.zoom-indicator", { hasText: `${percent}%` }).waitFor({ state: "visible" });
}

async function enterSewing2D(page) {
  const canvas = page.locator("canvas.pattern-canvas");
  const seamTool = page.locator('[data-testid="primary-tool-seam"]');
  if ((await seamTool.getAttribute("aria-pressed")) !== "true") await seamTool.click();
  if (!await canvas.isVisible()) {
    await page.locator('.workspace-mode-switch').getByRole("button", { name: "Modelar", exact: true }).click();
  }
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
}

async function captureSource(page, viewport) {
  return page.evaluate((host) => {
    const parse = (value) => {
      if (!value) return null;
      try { return JSON.parse(value); } catch { return value; }
    };
    return {
      document: parse(host.dataset.currentPatternDocumentV3),
      editor: window.__moldeonPhase0?.state() ?? null,
      assembly: window.__moldeonPhase0?.assembly() ?? null,
      meshDiagnostics: parse(host.dataset.garmentMeshDiagnostics),
      geometrySignatures: parse(host.dataset.garmentGeometrySignatures),
    };
  }, await viewport.elementHandle());
}

async function captureResult(page, viewport) {
  return page.evaluate((host) => {
    const parse = (value) => {
      if (!value) return null;
      try { return JSON.parse(value); } catch { return value; }
    };
    return {
      status: host.dataset.sewingStep0Status ?? null,
      elapsedMs: host.dataset.sewingStep0Ms ? Number(host.dataset.sewingStep0Ms) : null,
      notice: document.querySelector(".viewport-sewing-step0-status")?.textContent?.trim() ?? null,
      diagnostics: parse(host.dataset.sewingStep0Diagnostics),
      finalHostMeshes: parse(host.dataset.garmentMeshDiagnostics),
    };
  }, await viewport.elementHandle());
}

function validateScenario(scenario, source, result, consoleErrors) {
  const assertions = [];
  const check = (name, passed, detail) => assertions.push({ name, passed: Boolean(passed), detail });
  check("ui-created-panel-count", source?.editor?.pieces?.length === scenario.panelCount,
    `esperado ${scenario.panelCount}, recebido ${source?.editor?.pieces?.length}`);
  check("ui-created-seam-count", source?.editor?.seamCount === expectedSeamCount(scenario),
    `esperado ${expectedSeamCount(scenario)}, recebido ${source?.editor?.seamCount}`);
  check("canonical-mm-document", source?.document?.units === "mm", `units=${source?.document?.units}`);
  check("no-browser-errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  if (scenario.expectation === "no-seams") {
    check("no-seam-stops-before-solver", result?.notice?.includes("Selecione ou crie uma costura ativa"), result?.notice);
    check("no-invented-binding", source?.assembly?.stitchConstraintCount === 0,
      `constraints=${source?.assembly?.stitchConstraintCount}`);
    return assertions;
  }

  const diagnostics = result?.diagnostics ?? {};
  const trace = diagnostics.pipelineTrace ?? {};
  check("trace-document", typeof trace.document?.serializedDocument === "string", "documento ausente");
  check("trace-bindings", Number(trace.bindings?.physicalBindingCount) > 0,
    `bindings=${trace.bindings?.physicalBindingCount}`);
  check("trace-assembly", Boolean(trace.assembly?.positionSignature), "assembly inicial ausente");
  check("trace-solver-output", Boolean(trace.solverOutput?.positionSignature), "saída do solver ausente");
  check("document-trace-is-same-click", trace.document?.geometryRevision === trace.assembly?.geometryRevision,
    `${trace.document?.geometryRevision} != ${trace.assembly?.geometryRevision}`);
  check("step0-applied", result?.status === "applied-global-shape", result?.status);
  check("trace-post-registration", Boolean(trace.postRegistration?.positionSignature), "pós-registro ausente");
  check("body-conform-explicitly-deferred", trace.postBodyConform?.executed === false
    && trace.postBodyConform?.reason === "body-contact-deferred-to-Provar",
  JSON.stringify(trace.postBodyConform));
  check("trace-final-rendered", Array.isArray(trace.finalRendered) && trace.finalRendered.length === scenario.targetPanelCount,
    `meshes=${trace.finalRendered?.length}`);
  const residualMm = Number(trace.postRegistration?.seamResiduals?.maxResidualMm);
  check("seams-geometrically-closed", Number.isFinite(residualMm) && residualMm <= scenario.maximumResidualMm,
    `residual=${residualMm}mm`);
  check("material-metric-preserved", Number(diagnostics.materialAfter) <= 0.02,
    `material=${diagnostics.materialAfter}`);
  const audits = Object.values(diagnostics.bodyAudits ?? {});
  check("body-contact-audit-deferred-to-provar", audits.length === scenario.targetPanelCount && audits.every((audit) =>
    audit?.contactDeferredToPhysics === true),
  JSON.stringify(audits));
  const bounds = trace.postRegistration?.garmentBoundingBox;
  const spans = bounds ? bounds.max.map((value, axis) => value - bounds.min[axis]) : [];
  const sortedSpans = [...spans].sort((left, right) => right - left);
  check("volume-not-flat", sortedSpans.length === 3 && sortedSpans[1] >= scenario.minimumSecondarySpanM,
    `spans=${JSON.stringify(spans)}`);
  const reference = trace.placementReference?.bodySection?.centerM;
  const bodyBounds = diagnostics.bodyBounds;
  check("near-authored-body-region", Boolean(reference && bounds) && distancePointToBox(reference, bounds) <= 0.12,
    `reference=${JSON.stringify(reference)} bounds=${JSON.stringify(bounds)}`);
  check("component-centered-around-body", Number(diagnostics.horizontalOffsetMm) <= 80,
    `horizontalOffsetMm=${diagnostics.horizontalOffsetMm}`);
  check("not-above-or-below-avatar", Boolean(bounds && bodyBounds)
    && bounds.min[1] >= bodyBounds.min[1] - 0.1 && bounds.max[1] <= bodyBounds.max[1] + 0.1,
  `garment=${JSON.stringify(bounds)} body=${JSON.stringify(bodyBounds)}`);
  const finalById = new Map((trace.finalRendered ?? []).map((mesh) => [mesh.id, mesh]));
  const registeredMeshes = trace.postRegistration?.meshDiagnostics ?? [];
  check("rendered-mesh-equals-registered-output", registeredMeshes.length === scenario.targetPanelCount && registeredMeshes
    .filter((mesh) => finalById.has(mesh.id))
    .every((mesh) => sameBounds(mesh.boundingBox, finalById.get(mesh.id)?.boundingBox)),
  "bounds pós-registro divergiram da mesh renderizada");
  if (scenario.expectation === "open-shell") {
    check("front-opening-preserved", residualMm <= scenario.maximumResidualMm && sortedSpans[1] >= 0.02,
      `residual=${residualMm} spans=${JSON.stringify(spans)}`);
  }
  if (scenario.sameDirection) {
    check("same-direction-persisted", trace.bindings?.groups?.[0]?.direction === "same",
      `direction=${trace.bindings?.groups?.[0]?.direction}`);
  }
  if (scenario.asymmetric) {
    const definitions = trace.document?.definitions ?? [];
    check("asymmetric-source-retained", new Set(definitions.map((definition) => definition.geometrySignature)).size > 1
      || scenario.panelCount === 1, JSON.stringify(definitions));
  }
  return assertions;
}

function panelPlans(scenario, box, zoom) {
  const rows = scenario.panelCount > 4 ? 2 : 1;
  const columns = Math.ceil(scenario.panelCount / rows);
  const gap = box.width * 0.022;
  const totalWidth = 1_250 * scenario.circumferenceFraction * zoom;
  const weights = Array.from({ length: scenario.panelCount }, (_, index) =>
    scenario.asymmetric ? 0.78 + ((index * 7) % 5) * 0.11 : 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((weight) => totalWidth * weight / weightTotal);
  const height = box.height * scenario.heightFraction;
  const plans = [];
  let panelIndex = 0;
  for (let row = 0; row < rows; row += 1) {
    const count = Math.min(columns, scenario.panelCount - panelIndex);
    const rowWidths = widths.slice(panelIndex, panelIndex + count);
    const rowWidth = rowWidths.reduce((sum, value) => sum + value, 0) + gap * (count - 1);
    let left = (box.width - rowWidth) * 0.5;
    const top = rows === 1
      ? Math.min(box.height * 0.28, box.height - 70 - height)
      : row === 0 ? 30 : box.height - 70 - height;
    for (let column = 0; column < count; column += 1) {
      const width = rowWidths[column];
      const shape = scenario.shapes[(panelIndex + column) % scenario.shapes.length];
      const points = shapePoints(shape, left, top, width, height, panelIndex + column);
      plans.push({ points, left: midpoint(points[3], points[0]), right: midpoint(points[1], points[2]) });
      left += width + gap;
    }
    panelIndex += count;
  }
  return plans;
}

function shapePoints(shape, left, top, width, height, index) {
  if (shape === "trapezoid") return [
    { x: left + width * 0.10, y: top }, { x: left + width * 0.90, y: top },
    { x: left + width, y: top + height }, { x: left, y: top + height },
  ];
  if (shape === "tapered") return [
    { x: left, y: top }, { x: left + width, y: top + height * 0.08 },
    { x: left + width * 0.78, y: top + height }, { x: left + width * 0.18, y: top + height * 0.94 },
  ];
  if (shape === "asymmetric") {
    const skew = index % 2 === 0 ? 0.13 : 0.07;
    return [
      { x: left + width * skew, y: top }, { x: left + width, y: top + height * 0.12 },
      { x: left + width * 0.86, y: top + height }, { x: left, y: top + height * 0.78 },
    ];
  }
  return [
    { x: left, y: top }, { x: left + width, y: top },
    { x: left + width, y: top + height }, { x: left, y: top + height },
  ];
}

function seamPairs(scenario) {
  if (scenario.seamKind === "none" || scenario.seamKind === "incomplete") return [];
  const edge = (panel, side) => ({ panel, side });
  if (scenario.seamKind === "disconnected-self") {
    return Array.from({ length: scenario.panelCount }, (_, panel) => ({ first: edge(panel, "right"), second: edge(panel, "left") }));
  }
  if (scenario.seamKind === "self") return [{ first: edge(0, "right"), second: edge(0, "left") }];
  const pairs = [];
  const limit = scenario.seamKind === "chain" ? scenario.panelCount - 1 : scenario.panelCount;
  for (let index = 0; index < limit; index += 1) {
    pairs.push({ first: edge(index, "right"), second: edge((index + 1) % scenario.panelCount, "left") });
  }
  return pairs;
}

function expectedSeamCount(scenario) {
  if (scenario.seamKind === "none" || scenario.seamKind === "incomplete") return 0;
  if (scenario.seamKind === "self") return 1;
  if (scenario.seamKind === "chain") return scenario.panelCount - 1;
  return scenario.panelCount;
}

function midpoint(first, second) { return { x: (first.x + second.x) * 0.5, y: (first.y + second.y) * 0.5 }; }
function distancePointToBox(point, box) {
  return Math.hypot(...point.map((value, axis) => Math.max(box.min[axis] - value, 0, value - box.max[axis])));
}
function sameBounds(left, right) {
  if (!left || !right) return false;
  const rightValues = [...right.min, ...right.max];
  return [...left.min, ...left.max].every((value, index) => Math.abs(value - rightValues[index]) <= 1e-6);
}
function publicScenario(scenario) {
  const { coverage, quick, ...configuration } = scenario;
  return configuration;
}
function coverageMarkdown(catalog) {
  return `# STEP-0 E2E coverage\n\nTotal: ${catalog.length} cenários. A suíte rápida contém ${catalog.filter((item) => item.quick).length}.\n\n${catalog.map((scenario, index) =>
    `${index + 1}. \`${scenario.id}\` — ${scenario.coverage}${scenario.quick ? " (rápida)" : ""}`,
  ).join("\n")}\n`;
}
