import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.HUMAN_BODY_BASE_URL ?? "http://127.0.0.1:4183";
const outputDir = process.env.HUMAN_BODY_SMOKE_DIR ?? "docs/validation/human-body-11.0.4b-calibration";
const executablePath = process.env.CHROME_PATH
  ?? (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/google-chrome");
const jobs = [
  { stage: "raw", view: "front", file: "raw-front.png" },
  { stage: "raw", view: "side", file: "raw-side.png" },
  { stage: "raw", view: "back", file: "raw-back.png" },
  { stage: "raw", view: "front", file: "stages/stage-0-raw-glb-front.png" },
  { stage: "raw", view: "side", file: "stages/stage-0-raw-glb-side.png" },
  { stage: "normalized", view: "front", file: "stages/stage-1-normalized-front.png" },
  { stage: "normalized", view: "side", file: "stages/stage-1-normalized-side.png" },
  { stage: "posed", view: "front", file: "stages/stage-2-posed-front.png" },
  { stage: "posed", view: "side", file: "stages/stage-2-posed-side.png" },
  { stage: "pre-metric", view: "front", file: "stages/stage-3-deformed-before-metric-correction-front.png" },
  { stage: "pre-metric", view: "side", file: "stages/stage-3-deformed-before-metric-correction-side.png" },
  { stage: "final", view: "front", file: "stages/stage-4-final-front.png" },
  { stage: "final", view: "side", file: "stages/stage-4-final-side.png" },
  { stage: "final", view: "front", file: "front.png" },
  { stage: "final", view: "side", file: "side.png" },
  { stage: "final", view: "back", file: "back.png" },
  { stage: "final", view: "front-three-quarter", file: "front-three-quarter.png" },
  { stage: "final", view: "back-three-quarter", file: "back-three-quarter.png" },
  { stage: "final", view: "front-silhouette", file: "front-silhouette.png" },
  { stage: "final", view: "side-silhouette", file: "side-silhouette.png" },
  { stage: "final", view: "back-silhouette", file: "back-silhouette.png" },
];
const commonArgs = ["--no-sandbox", "--disable-dev-shm-usage", "--enable-webgl", "--ignore-gpu-blocklist"];
const rendererCandidates = [
  ["angle-swiftshader", ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]],
  ["swiftshader", ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]],
  ["egl", ["--use-gl=egl"]],
  ["default", []],
];

await fs.mkdir(path.join(outputDir, "stages"), { recursive: true });
const { browser, rendererProfile } = await launchBrowser();
const report = { rendererProfile, views: [] };

try {
  for (const job of jobs) {
    const { stage, view } = job;
    const context = await browser.newContext({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseURL}/body-smoke.html?view=${encodeURIComponent(view)}&stage=${encodeURIComponent(stage)}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.bodySmokeReady === true, null, { timeout: 30_000 });
    await page.waitForTimeout(150);
    const metadata = await page.evaluate(() => window.bodySmokeMetadata);
    if (errors.length > 0) throw new Error(`${view}: browser errors: ${JSON.stringify(errors)}`);
    if (!metadata || metadata.version !== "human-body-female@1"
      || metadata.sourceAssetId !== "canonical-female.glb"
      || metadata.topologyInvariant !== true
      || metadata.visualCollisionTopologyParity !== true) {
      throw new Error(`${view}: canonical body metadata missing: ${JSON.stringify(metadata)}`);
    }
    const mesh = metadata.meshDiagnostics;
    if (!mesh || mesh.finite !== true || mesh.boundaryEdgeCount !== 0
      || mesh.nonManifoldEdgeCount !== 0 || mesh.degenerateTriangleCount !== 0
      || mesh.invertedTriangleCount !== 0 || mesh.normalsConsistent !== true) {
      throw new Error(`${view}: invalid runtime mesh diagnostics: ${JSON.stringify(mesh)}`);
    }
    const measurementErrors = Object.values(metadata.measurementErrorsMm ?? {});
    if (measurementErrors.length === 0 || measurementErrors.some((value) => Math.abs(value) > 5)) {
      throw new Error(`${view}: metric tolerance failed: ${JSON.stringify(metadata.measurementErrorsMm)}`);
    }
    const identity = metadata.identityDeformation;
    if (!identity || identity.rmsMm > 1 || identity.percentile95Mm > 2 || identity.maxMm > 5) {
      throw new Error(`${view}: identity deformation failed: ${JSON.stringify(identity)}`);
    }
    const quality = metadata.shapeQuality;
    if (!quality || quality.maximumEdgeStretchRatio >= 4 || quality.maximumAreaRatio >= 8
      || quality.maximumNormalChangeDegrees >= 110) {
      throw new Error(`${view}: shape quality failed: ${JSON.stringify(quality)}`);
    }
    const screenshotPath = path.join(outputDir, job.file);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.views.push({ stage, view, screenshotPath, metadata });
    await context.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(outputDir, "smoke.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  renderer: report.rendererProfile.name,
  viewCount: report.views.length,
  outputDir,
}, null, 2));

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
