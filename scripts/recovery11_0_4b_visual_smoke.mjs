import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.HUMAN_BODY_BASE_URL ?? "http://127.0.0.1:4183";
const outputDir = process.env.HUMAN_BODY_SMOKE_DIR ?? "docs/validation/human-body-11.0.4b";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const views = ["front", "side", "back", "three-quarter"];
const commonArgs = ["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl", "--ignore-gpu-blocklist"];
const rendererCandidates = [
  ["angle-swiftshader", ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]],
  ["swiftshader", ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]],
  ["egl", ["--use-gl=egl"]],
  ["default", []],
];

await fs.mkdir(outputDir, { recursive: true });
const { browser, rendererProfile } = await launchBrowser();
const report = { rendererProfile, views: [] };

try {
  for (const view of views) {
    const context = await browser.newContext({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseURL}/body-smoke.html?view=${encodeURIComponent(view)}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.bodySmokeReady === true, null, { timeout: 30_000 });
    await page.waitForTimeout(150);
    const metadata = await page.evaluate(() => window.bodySmokeMetadata);
    if (errors.length > 0) throw new Error(`${view}: browser errors: ${JSON.stringify(errors)}`);
    if (!metadata || metadata.version !== "human-body-female@1") {
      throw new Error(`${view}: canonical body metadata missing: ${JSON.stringify(metadata)}`);
    }
    const screenshotPath = path.join(outputDir, `${view}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.views.push({ view, screenshotPath, metadata });
    await context.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(outputDir, "smoke.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

async function launchBrowser() {
  const attempts = [];
  for (const [name, extraArgs] of rendererCandidates) {
    let browser;
    const args = [...commonArgs, ...extraArgs];
    try {
      browser = await chromium.launch({ executablePath, headless: true, args });
      const page = await browser.newPage();
      const capability = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2");
        if (!gl) return { supported: false };
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          supported: true,
          renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
        };
      });
      await page.close();
      attempts.push({ name, capability });
      if (capability.supported) return { browser, rendererProfile: { name, capability, attempts } };
    } catch (error) {
      attempts.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
    await browser?.close();
  }
  throw new Error(`No WebGL2 renderer: ${JSON.stringify(attempts)}`);
}
