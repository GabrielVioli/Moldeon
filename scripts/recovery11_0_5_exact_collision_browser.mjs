import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MOLDEON_BASE_URL ?? "http://127.0.0.1:4185";
const outputDir = "artifacts/recovery-11-0-5-exact-human-surface-contact";
const executablePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
const failedResponses = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("response", (response) => response.status() >= 400 && failedResponses.push({ status: response.status(), url: response.url() }));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("straight-skirt-standard"));
  await page.getByRole("button", { name: "Prova", exact: true }).click();
  await completePreflight();
  const host = page.locator("[data-testid='dressed-avatar-viewport']");
  await host.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-testid='dressed-avatar-viewport']");
    return element?.getAttribute("data-assembly-status") === "ready"
      && element?.getAttribute("data-body-collision-primitive") === "exact-human-surface";
  }, undefined, { timeout: 60_000 });

  const physics = page.locator("[data-testid='physics-dev-panel']");
  if (!await physics.evaluate((element) => element instanceof HTMLDetailsElement && element.open)) {
    await physics.locator(":scope > summary").click();
  }
  const pause = page.getByRole("button", { name: "Pausar", exact: true });
  if (await pause.isVisible().catch(() => false)) await pause.click();
  await page.locator(".viewport-physics-dev select").first().selectOption("0");
  const bodyCollision = page.getByLabel("Body collision");
  if (!await bodyCollision.isChecked()) await bodyCollision.check();
  const ghost = page.getByLabel("Mostrar malha exata de colisão");
  await ghost.check();
  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await page.getByRole("button", { name: "Passo", exact: true }).click();
  await page.waitForFunction(() => {
    const element = document.querySelector("[data-testid='dressed-avatar-viewport']");
    const diagnostics = JSON.parse(element?.getAttribute("data-simulation-diagnostics") ?? "{}");
    return diagnostics.stepCount >= 1 && diagnostics.bodyExactSurface === true;
  }, undefined, { timeout: 20_000 });
  await page.getByRole("button", { name: "Enquadrar roupa", exact: true }).click();
  await page.waitForTimeout(300);
  const report = await host.evaluate((element) => ({
    primitive: element.getAttribute("data-body-collision-primitive"),
    topologyParity: element.getAttribute("data-body-visual-collision-topology-parity"),
    triangleCount: Number(element.getAttribute("data-body-collider-count")),
    ghostVisible: element.getAttribute("data-body-colliders-visible"),
    canvasCount: element.querySelectorAll("canvas").length,
    diagnostics: JSON.parse(element.getAttribute("data-simulation-diagnostics") ?? "{}"),
  }));
  report.consoleErrors = consoleErrors;
  report.failedResponses = failedResponses;
  await writeFile(`${outputDir}/browser-report.json`, JSON.stringify(report, null, 2), "utf8");
  if (report.primitive !== "exact-human-surface") throw new Error("Produção não usa a superfície humana exata.");
  if (report.topologyParity !== "true") throw new Error("A topologia visual e de colisão divergiu.");
  if (report.triangleCount !== 32_508) throw new Error(`Contagem corporal inesperada: ${report.triangleCount}.`);
  if (report.ghostVisible !== "true") throw new Error("Ghost exato não ficou visível.");
  if (report.canvasCount !== 1) throw new Error(`Esperado um canvas; encontrado ${report.canvasCount}.`);
  const exactSurfaceWasQueried = report.diagnostics.bodyBvhNodeVisits > 0;
  const inheritedAssemblyWasSafelyBlocked = report.diagnostics.bodyAssemblyContactBlocked === true
    && report.diagnostics.bodyInitialIntersectionCount > 0
    && report.diagnostics.bodyResidualIntersections === report.diagnostics.bodyInitialIntersectionCount;
  if (!report.diagnostics.bodyExactSurface || (!exactSurfaceWasQueried && !inheritedAssemblyWasSafelyBlocked)) {
    throw new Error("Worker não consultou a BVH exata nem bloqueou com segurança uma montagem inicial profundamente intersectada.");
  }
  if (consoleErrors.length || failedResponses.length) throw new Error("Erros de console/rede no fluxo Prova.");
  await page.screenshot({ path: `${outputDir}/exact-collision-ghost.png`, fullPage: false });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
}

async function completePreflight() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dialog = page.locator(".dressing-preflight-dialog");
    if (!await dialog.isVisible().catch(() => false)) { await page.waitForTimeout(120); continue; }
    const lower = dialog.getByRole("button", { name: /Parte inferior/i });
    if (await lower.isVisible().catch(() => false)) { await lower.click(); await page.waitForTimeout(120); continue; }
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
