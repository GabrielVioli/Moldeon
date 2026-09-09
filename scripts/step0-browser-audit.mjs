import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.STEP0_BASE_URL ?? "http://127.0.0.1:5173";
const outputDirectory = resolve(process.env.STEP0_ARTIFACT_DIR ?? "artifacts/step0-browser");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = { generatedAt: new Date().toISOString(), baseUrl, browserVersion: browser.version(), scenarios: [] };

try {
  await runScenario("self-seam-1020x300", 1020, 300, true);
  await runScenario("self-seam-435x227", 435, 227, false);
} finally {
  await browser.close();
}

await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.scenarios.some((scenario) => scenario.required && scenario.status !== "passed")) process.exitCode = 1;

async function runScenario(name, widthMm, heightMm, required) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 }, locale: "pt-BR", colorScheme: "light" });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let status = "failed";
  let result = null;
  let error = null;
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__moldeonPhase0), null, { timeout: 20_000 });
    await page.evaluate(async ({ widthMm, heightMm }) => {
      const fixtures = await import("/src/testFixtures/baselineGarments.ts");
      const storeModule = await import("/src/state/editorStore.ts");
      const garment = fixtures.createBaselineFixture("exact-contact-tube");
      const piece = garment.pieces[0];
      if (!piece) throw new Error("Fixture exact-contact-tube sem peça.");
      const minX = Math.min(...piece.points.map((point) => point.xMm));
      const minY = Math.min(...piece.points.map((point) => point.yMm));
      const maxX = Math.max(...piece.points.map((point) => point.xMm));
      const maxY = Math.max(...piece.points.map((point) => point.yMm));
      const oldWidth = Math.max(1, maxX - minX);
      const oldHeight = Math.max(1, maxY - minY);
      piece.points = piece.points.map((point) => ({
        ...point,
        xMm: minX + ((point.xMm - minX) / oldWidth) * widthMm,
        yMm: minY + ((point.yMm - minY) / oldHeight) * heightMm,
      }));
      garment.name = `STEP0 E2E ${widthMm}x${heightMm}`;
      garment.id = `step0-e2e-${widthMm}x${heightMm}`;
      storeModule.useEditorStore.getState().loadGarment(garment);
    }, { widthMm, heightMm });

    const montar = page.getByRole("button", { name: "Montar", exact: true });
    if (await montar.count()) await montar.click();
    else await page.getByRole("button", { name: /Montar no 3D|Montagem/i }).first().click();
    await page.waitForSelector("canvas.three-canvas", { timeout: 30_000 });
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-before.png`), fullPage: true });

    const adjust = page.getByRole("button", { name: "Ajustar montagem", exact: true });
    await adjust.waitFor({ state: "visible", timeout: 20_000 });
    await adjust.click();
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
      const status = host?.dataset.sewingStep0Status ?? "";
      return Boolean(status) && !status.startsWith("solving") && !status.startsWith("polishing");
    }, null, { timeout: 45_000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-after.png`), fullPage: true });

    result = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
      const parse = (value) => {
        if (!value) return null;
        try { return JSON.parse(value); } catch { return value; }
      };
      const notice = document.querySelector(".viewport-sewing-step0-status")?.textContent?.trim() ?? null;
      return {
        status: host?.dataset.sewingStep0Status ?? null,
        notice,
        diagnostics: parse(host?.dataset.sewingStep0Diagnostics),
        materialAudit: parse(host?.dataset.sewingStep0MaterialAudit),
        elapsedMs: host?.dataset.sewingStep0Ms ? Number(host.dataset.sewingStep0Ms) : null,
      };
    });

    const applied = result?.status === "applied-global-shape" || result?.status === "applied-global-candidate" || result?.status === "applied";
    const diagnostics = result?.diagnostics ?? {};
    const residualMm = Number(diagnostics?.proposalResidual?.afterBody?.maximumM ?? diagnostics?.finalResidual?.maximumM ?? Number.POSITIVE_INFINITY) * 1000;
    const material = Number(diagnostics?.materialAfter ?? diagnostics?.metricDistortionMax ?? Number.POSITIVE_INFINITY);
    status = required
      ? applied && Number.isFinite(residualMm) && residualMm <= 5 && Number.isFinite(material) && material <= 0.02 ? "passed" : "failed"
      : "observed";
  } catch (reason) {
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-error.png`), fullPage: true }).catch(() => undefined);
  } finally {
    report.scenarios.push({ name, widthMm, heightMm, required, status, result, error, consoleMessages, pageErrors });
    await context.close();
  }
}
