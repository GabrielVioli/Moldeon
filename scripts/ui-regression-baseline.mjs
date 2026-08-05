import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.UI_REGRESSION_BASE_URL ?? "http://127.0.0.1:5186";
const outputDirectory = resolve(process.env.UI_REGRESSION_ARTIFACT_DIR ?? "artifacts/ui-regression-baseline");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleMessages = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") consoleMessages.push(`${message.type()}: ${message.text()}`);
});
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__moldeonPhase0));
await page.evaluate(() => window.__moldeonPhase0.loadFixture("free-simple-piece"));
await page.getByRole("button", { name: "Modelagem", exact: true }).click();
await page.getByRole("button", { name: "Selecionar", exact: true }).click();
await page.getByRole("button", { name: "Enquadrar tudo", exact: true }).click();
await page.waitForTimeout(120);

const canvas = page.locator("canvas[aria-label='Editor de molde 2D']");
const canvasBox = await canvas.boundingBox();
if (!canvasBox) throw new Error("Canvas 2D sem área visível no baseline.");
const center = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
const stateBefore = await page.evaluate(() => window.__moldeonPhase0.state());
const zoomBefore = await page.locator(".zoom-indicator").innerText();

await page.mouse.move(center.x, center.y);
await page.mouse.down();
await page.mouse.move(center.x + 34, center.y + 18, { steps: 4 });
await canvas.evaluate((element, coordinates) => {
  element.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: coordinates.x,
    clientY: coordinates.y,
    deltaX: 2,
    deltaY: 2,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
  }));
}, { x: center.x + 34, y: center.y + 18 });
await page.waitForTimeout(80);
const zoomDuringPieceDrag = await page.locator(".zoom-indicator").innerText();
await page.mouse.move(center.x + 72, center.y + 36, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(120);
const stateAfter = await page.evaluate(() => window.__moldeonPhase0.state());
await page.screenshot({ path: resolve(outputDirectory, "desktop-piece-drag-wheel-leak.png"), fullPage: false });

const pieceBefore = stateBefore.pieces[0];
const pieceAfter = stateAfter.pieces.find((piece) => piece.id === pieceBefore.id);
const pieceMoved = Boolean(pieceAfter) && (pieceAfter.xMm !== pieceBefore.xMm || pieceAfter.yMm !== pieceBefore.yMm);
const cameraChangedDuringPieceDrag = zoomDuringPieceDrag !== zoomBefore;

const panelControls = await page.getByRole("button", { name: /recolher painel|fechar painel|abrir painel|mostrar painel|voltar à bancada/i }).count();
const workspaceBox = await page.locator("main.workspace").boundingBox();
const editorBox = await page.locator("#editor-panel").boundingBox();
const previewBox = await page.locator("#preview-panel").boundingBox();
const panelPermanent = panelControls === 0 && Boolean(workspaceBox && editorBox && previewBox) && editorBox.width < workspaceBox.width * 0.9;
await page.screenshot({ path: resolve(outputDirectory, "desktop-right-panel-permanent.png"), fullPage: false });

const smallWheelBefore = await page.locator(".zoom-indicator").innerText();
await canvas.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    deltaX: 0,
    deltaY: 0.5,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
  }));
});
await page.waitForTimeout(80);
const smallWheelAfter = await page.locator(".zoom-indicator").innerText();
const tinyTrackpadDeltaJumpsZoom = smallWheelBefore !== smallWheelAfter;

await context.close();
const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
await mobilePage.waitForFunction(() => Boolean(window.__moldeonPhase0));
await mobilePage.evaluate(() => window.__moldeonPhase0.loadFixture("free-simple-piece"));
await mobilePage.getByRole("button", { name: "Prévia 3D", exact: true }).click();
await mobilePage.waitForTimeout(120);
await mobilePage.screenshot({ path: resolve(outputDirectory, "mobile-preview-no-explicit-back-control.png"), fullPage: false });
const mobileBackControl = await mobilePage.getByRole("button", { name: /voltar à bancada|fechar painel|recolher painel/i }).count();
await mobileContext.close();
await browser.close();

const result = {
  browserVersion,
  initialCommit: "f02fe4c395e223d6276343e58baf9fc18cabd94f",
  regressions: {
    gestureOwnership: {
      pieceMoved,
      zoomBefore,
      zoomDuringPieceDrag,
      reproduced: pieceMoved && cameraChangedDuringPieceDrag,
    },
    trackpadWheel: {
      zoomBefore: smallWheelBefore,
      zoomAfterTinyPixelDelta: smallWheelAfter,
      reproduced: tinyTrackpadDeltaJumpsZoom,
    },
    rightPanel: {
      explicitControlCount: panelControls,
      mobileBackControlCount: mobileBackControl,
      reproduced: panelPermanent && mobileBackControl === 0,
    },
  },
  consoleMessages,
  pageErrors,
};

await writeFile(resolve(outputDirectory, "baseline.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(resolve(outputDirectory, "baseline.md"), renderMarkdown(result), "utf8");
console.log(renderMarkdown(result));

if (!Object.values(result.regressions).every((entry) => entry.reproduced)) {
  throw new Error(`Nem todas as regressões foram reproduzidas: ${JSON.stringify(result.regressions)}`);
}

function renderMarkdown(result) {
  return `# Baseline das regressões de UI\n\nChromium ${result.browserVersion}\n\n| Regressão | Reproduzida |\n|---|---:|\n| ownership peça/câmera | ${result.regressions.gestureOwnership.reproduced ? "sim" : "não"} |\n| wheel/trackpad com salto | ${result.regressions.trackpadWheel.reproduced ? "sim" : "não"} |\n| painel direito sem recolhimento | ${result.regressions.rightPanel.reproduced ? "sim" : "não"} |\n\nConsole: ${result.consoleMessages.length + result.pageErrors.length} mensagem(ns).\n`;
}
