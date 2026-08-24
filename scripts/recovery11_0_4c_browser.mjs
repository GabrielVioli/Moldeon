import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.MOLDEON_BASE_URL ?? "http://127.0.0.1:4183";
const outputDir = resolve("artifacts/recovery-11-0-4c-garment-orientation-floor-collision");
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
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

const report = { page: {}, orientation: {}, floor: {}, consoleErrors };
const requestedCases = (process.env.MOLDEON_ORIENTATION_CASES ?? "tshirt,blouse,skirt,multipanel")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0), undefined, { timeout: 15_000 });
  report.page = await page.evaluate(() => ({
    contentLength: document.body.innerText.trim().length,
    errorOverlay: Boolean(document.querySelector(".vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]")),
  }));
  const cases = {
    tshirt: "tshirt-standard",
    blouse: "blouse-standard",
    skirt: "straight-skirt-standard",
    multipanel: "spatial-four-panel-tube",
  };
  for (const label of requestedCases) {
    const fixtureId = cases[label];
    if (fixtureId) report.orientation[label] = await captureOrientationCase(fixtureId, label);
  }
  if (process.env.MOLDEON_SKIP_FLOOR !== "1") report.floor.skirt = await captureFloorCase();
  writeFileSync(resolve(outputDir, "browser-report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: resolve(outputDir, "browser-failure.png"), fullPage: true }).catch(() => undefined);
  writeFileSync(resolve(outputDir, "browser-report.json"), JSON.stringify(report, null, 2), "utf8");
  throw error;
} finally {
  await context.close();
  await browser.close();
}

async function captureOrientationCase(fixtureId, label) {
  const previousRevision = await page.locator("[data-testid='dressed-avatar-viewport']")
    .getAttribute("data-simulation-geometry-revision").catch(() => null);
  await page.evaluate((id) => window.__moldeonPhase0?.loadFixture(id), fixtureId);
  const prove = page.getByRole("button", { name: "Provar", exact: true });
  if (await prove.isVisible()) await prove.click();
  const region = page.getByRole("button", { name: fixtureId.includes("skirt") ? /Parte inferior/ : /Parte superior/ });
  if (await region.isVisible().catch(() => false)) await region.click();
  const candidate = page.getByRole("button", { name: /^Usar .+ como refer.ncia frontal$/ }).first();
  if (await candidate.isVisible().catch(() => false)) {
    await candidate.click();
    await page.getByRole("button", { name: /Usar como refer.ncia frontal/, exact: true }).last().click();
  }
  const host = page.locator("[data-testid='dressed-avatar-viewport']");
  await host.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction((prior) => {
    const element = document.querySelector("[data-testid='dressed-avatar-viewport']");
    const revision = element?.getAttribute("data-simulation-geometry-revision");
    return element?.getAttribute("data-assembly-status") === "ready"
      && Boolean(revision)
      && (!prior || revision !== prior);
  }, previousRevision, { timeout: 60_000 });
  const pause = page.getByRole("button", { name: "Pausar", exact: true });
  if (await pause.isVisible().catch(() => false)) await pause.click();
  await page.locator(".viewport-physics-dev select").first().selectOption("0");
  const bodyCollision = page.getByLabel("Body collision");
  if (await bodyCollision.isChecked()) await bodyCollision.uncheck();
  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Enquadrar roupa", exact: true }).click();
  await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.cameraView("front"));
  await page.waitForTimeout(250);
  const snapshot = await host.evaluate((element) => ({
    registration: JSON.parse(element.getAttribute("data-garment-registration") ?? "{}"),
    meshes: JSON.parse(element.getAttribute("data-garment-mesh-diagnostics") ?? "[]"),
    simulation: JSON.parse(element.getAttribute("data-simulation-diagnostics") ?? "{}"),
    settings: JSON.parse(element.getAttribute("data-simulation-dev-settings") ?? "{}"),
    spatial: JSON.parse(element.getAttribute("data-spatial-assembly-diagnostics") ?? "{}"),
  }));
  await page.screenshot({ path: resolve(outputDir, `${label}-front.png`), fullPage: true });
  await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.cameraView("side"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(outputDir, `${label}-side.png`), fullPage: true });
  await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.cameraView("back"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(outputDir, `${label}-back.png`), fullPage: true });

  const avatar = page.getByLabel("Show procedural avatar");
  if (await avatar.isChecked().catch(() => false)) await avatar.uncheck();
  await page.getByRole("button", { name: "Enquadrar roupa", exact: true }).click();
  await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.cameraView("front"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(outputDir, `${label}-garment-only-front.png`), fullPage: true });
  await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.cameraView("side"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(outputDir, `${label}-garment-only-side.png`), fullPage: true });
  await page.evaluate(() => window.__MOLDEON_VIEWPORT_DEV__?.cameraView("back"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(outputDir, `${label}-garment-only-back.png`), fullPage: true });
  await avatar.check();
  return snapshot;
}

async function captureFloorCase() {
  const previousRevision = await page.locator("[data-testid='dressed-avatar-viewport']")
    .getAttribute("data-simulation-geometry-revision").catch(() => null);
  await page.evaluate(() => window.__moldeonPhase0?.loadFixture("straight-skirt-standard"));
  const prove = page.getByRole("button", { name: "Provar", exact: true });
  if (await prove.isVisible()) await prove.click();
  const region = page.getByRole("button", { name: /Parte inferior/ });
  if (await region.isVisible().catch(() => false)) await region.click();
  const candidate = page.getByRole("button", { name: /^Usar .+ como refer.ncia frontal$/ }).first();
  if (await candidate.isVisible().catch(() => false)) {
    await candidate.click();
    await page.getByRole("button", { name: /Usar como refer.ncia frontal/, exact: true }).last().click();
  }
  const host = page.locator("[data-testid='dressed-avatar-viewport']");
  await host.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction((prior) => {
    const element = document.querySelector("[data-testid='dressed-avatar-viewport']");
    const revision = element?.getAttribute("data-simulation-geometry-revision");
    return element?.getAttribute("data-assembly-status") === "ready"
      && Boolean(revision)
      && (!prior || revision !== prior);
  }, previousRevision, { timeout: 60_000 });
  const bodyCollision = page.getByLabel("Body collision");
  if (await bodyCollision.isChecked()) await bodyCollision.uncheck();
  const floorCollision = page.getByLabel("Floor collision");
  if (!(await floorCollision.isChecked())) await floorCollision.check();
  await page.locator(".viewport-physics-dev select").first().selectOption("1");
  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.waitForFunction(() => {
    const hostElement = document.querySelector("[data-testid='dressed-avatar-viewport']");
    const diagnostics = JSON.parse(hostElement?.getAttribute("data-simulation-diagnostics") ?? "{}");
    return diagnostics.stepCount > 20 && diagnostics.floorContactCount > 0;
  }, undefined, { timeout: 20_000 });
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Enquadrar roupa", exact: true }).click();
  await page.waitForTimeout(250);
  const snapshot = await host.evaluate((element) => {
    const meshes = JSON.parse(element.getAttribute("data-garment-mesh-diagnostics") ?? "[]");
    return {
      diagnostics: JSON.parse(element.getAttribute("data-simulation-diagnostics") ?? "{}"),
      settings: JSON.parse(element.getAttribute("data-simulation-dev-settings") ?? "{}"),
      physicalFloorY: element.getAttribute("data-physical-floor-y"),
      visualFloorY: element.getAttribute("data-visual-floor-y"),
      meshMinimumY: Math.min(...meshes.map((mesh) => mesh.boundingBox.min[1])),
      meshes,
    };
  });
  await page.screenshot({ path: resolve(outputDir, "floor-skirt-resting.png"), fullPage: true });
  return snapshot;
}
