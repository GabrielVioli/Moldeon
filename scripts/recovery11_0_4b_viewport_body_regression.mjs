import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.MOLDEON_BASE_URL ?? "http://127.0.0.1:4183";
const outputDir = resolve("artifacts/recovery-11-0-4b-viewport-body");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 820 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

let report;
try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("straight-skirt-standard"));
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  const regionChoice = page.getByRole("button", { name: /Parte inferior/ });
  if (await regionChoice.isVisible()) await regionChoice.click();
  const frontCandidate = page.getByRole("button", { name: /^Usar .+ como referência frontal$/ }).first();
  if (await frontCandidate.isVisible()) {
    await frontCandidate.click();
    await page.getByRole("button", { name: "Usar como referência frontal", exact: true }).click();
  }
  const host = page.locator("[data-testid='dressed-avatar-viewport']");
  await host.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-testid='dressed-avatar-viewport']");
    return element?.getAttribute("data-assembly-status") === "ready"
      && Boolean(element.getAttribute("data-avatar-floor-position"));
  }, undefined, { timeout: 30_000 });
  const pause = page.getByRole("button", { name: "Pausar", exact: true });
  if (await pause.isVisible()) await pause.click();
  await page.waitForTimeout(500);

  report = await host.evaluate((element) => {
    const registration = JSON.parse(element.getAttribute("data-body-registration") ?? "{}");
    const floorPosition = JSON.parse(element.getAttribute("data-avatar-floor-position") ?? "[]");
    const origins = JSON.parse(element.getAttribute("data-avatar-measurement-origins") ?? "{}");
    const resolved = JSON.parse(element.getAttribute("data-avatar-resolved-measurements") ?? "{}");
    const documentV3 = JSON.parse(element.getAttribute("data-current-pattern-document-v3") ?? "{}");
    const profileThigh = documentV3.measurements?.profile?.entries?.thighMm?.value;
    const canvas = element.querySelector("canvas.three-canvas")?.getBoundingClientRect();
    return {
      contentLength: document.body.innerText.trim().length,
      errorOverlay: Boolean(document.querySelector(".vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]")),
      interactiveLabels: [...document.querySelectorAll("button, select, input")]
        .map((control) => control.getAttribute("aria-label") ?? control.textContent?.trim() ?? control.getAttribute("name") ?? "")
        .filter(Boolean),
      registration,
      floorPosition,
      origins,
      resolved,
      profileThigh,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      proceduralAvatarVisible: element.getAttribute("data-procedural-avatar-visible"),
    };
  });

  if (report.contentLength === 0 || report.errorOverlay) throw new Error("A página carregou vazia ou com overlay de erro.");
  if (!report.canvas || report.canvas.width < 300 || report.canvas.height < 300) throw new Error("O viewport 3D não possui área útil.");
  if (report.registration.status !== "registered") throw new Error(`Body registration inválido: ${JSON.stringify(report.registration)}`);
  const expectedFloorY = report.registration.transform.translation[1] - 0.002;
  if (Math.abs(report.floorPosition[1] - expectedFloorY) > 1e-6) {
    throw new Error(`Piso não acompanha os pés: ${JSON.stringify({ expectedFloorY, actual: report.floorPosition[1] })}`);
  }
  if (report.origins.thighMm !== "estimated") throw new Error(`Origem da coxa perdida: ${report.origins.thighMm}`);
  if (!(report.profileThigh > 570 && report.resolved.thighMm < 500)) {
    throw new Error(`Estimativa da coxa foi reinterpretada como override: ${JSON.stringify({ profileThigh: report.profileThigh, resolved: report.resolved.thighMm })}`);
  }
  if (report.proceduralAvatarVisible !== "true") throw new Error("Manequim procedural não está visível.");
  if (consoleErrors.length > 0) throw new Error(`Console registrou erros: ${JSON.stringify(consoleErrors)}`);

  await page.screenshot({ path: resolve(outputDir, "registered-body-floor-and-thigh.png"), fullPage: true });
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ passed: true, ...report, consoleErrors }, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ passed: true, ...report, consoleErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(outputDir, "failure.png"), fullPage: true }).catch(() => undefined);
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ passed: false, report, consoleErrors, error: error instanceof Error ? error.message : String(error) }, null, 2), "utf8");
  throw error;
} finally {
  await context.close();
  await browser.close();
}
