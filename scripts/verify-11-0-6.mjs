import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.MOLDEON_VERIFY_URL ?? "http://127.0.0.1:4186/";
const outputDir = new URL("../docs/evidence/recovery-11.0.6/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0));
  const initial = await page.evaluate(() => ({
    contentLength: document.body.innerText.trim().length,
    overlay: Boolean(document.querySelector("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay")),
    buttons: [...document.querySelectorAll("button")].map((button) => button.textContent?.trim()).filter(Boolean).slice(0, 30),
  }));
  await page.evaluate(() => window.__moldeonPhase0.loadFixture("free-simple-piece"));
  await page.waitForTimeout(250);

  await page.getByLabel("Corpo 2D").check();
  await page.getByLabel("Landmarks").check();
  await page.waitForFunction(() => document.querySelector('[data-testid="body-reference-2d"]')?.getAttribute("data-source-topology") !== "hidden");
  await page.screenshot({ path: new URL("01-body-front.png", outputDir).pathname, fullPage: true });

  const frontTopology = await page.getByTestId("body-reference-2d").getAttribute("data-source-topology");
  const frontProjection = await page.evaluate(() => ({
    silhouetteSegments: document.querySelector(".body-reference-silhouette")?.getAttribute("d")?.split("M").length ?? 0,
    landmarkCount: document.querySelectorAll(".body-reference-landmark").length,
    regionCount: document.querySelectorAll(".body-reference-region").length,
    anchorCount: document.querySelectorAll(".body-reference-anchor").length,
  }));

  await page.getByLabel("Vista corporal 2D").selectOption("back");
  await page.screenshot({ path: new URL("02-body-back.png", outputDir).pathname, fullPage: true });
  await page.getByLabel("Vista corporal 2D").selectOption("left");
  await page.screenshot({ path: new URL("03-body-left.png", outputDir).pathname, fullPage: true });
  await page.getByLabel("Vista corporal 2D").selectOption("right");
  await page.screenshot({ path: new URL("04-body-right.png", outputDir).pathname, fullPage: true });

  await page.getByLabel("Vista corporal 2D").selectOption("front");
  const hipBefore = await page.locator('.body-reference-anchor[aria-label="Usar Lateral esquerda do quadril"]').getAttribute("transform");
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const current = useEditorStore.getState().garment.measurements.hipMm;
    useEditorStore.getState().setBodyMeasurement("hipMm", current + 60);
  });
  await page.waitForTimeout(350);
  const hipAfter = await page.locator('.body-reference-anchor[aria-label="Usar Lateral esquerda do quadril"]').getAttribute("transform");

  await page.getByRole("button", { name: "Usar Frente do torso" }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: new URL("05-arrangement-selected.png", outputDir).pathname, fullPage: true });
  const canonical = await page.evaluate(async () => {
    const [{ useEditorStore }, { garmentDraftToPatternDocumentV3 }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/patternDocumentV3.ts"),
    ]);
    const document = garmentDraftToPatternDocumentV3(useEditorStore.getState().garment);
    const instance = document.panelInstances[0];
    return {
      instanceId: instance.id,
      placementStatus: instance.placementStatus,
      source: instance.metadata.effectivePlacementSource,
      bodyAnchorId: instance.arrangementAnchor?.bodyAnchorId,
      scale: instance.arrangementAnchor?.scale,
    };
  });

  const proveButton = page.getByRole("button", { name: "Prova", exact: true });
  if (await proveButton.count()) {
    await proveButton.first().click();
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: new URL("06-3d-corresponding.png", outputDir).pathname, fullPage: true });

  process.stdout.write(`${JSON.stringify({
    initial,
    frontTopology,
    frontProjection,
    measurementInvalidation: { hipBefore, hipAfter, changed: hipBefore !== hipAfter },
    canonical,
    finalText: (await page.locator("body").innerText()).slice(0, 1500),
    errors,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}

if (errors.length > 0) process.exitCode = 1;
