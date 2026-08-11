import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5178";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-07-mobile");
const viewportWidth = Number(process.argv[4] ?? 390);
const viewportHeight = Number(process.argv[5] ?? 844);
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({
  viewport: { width: viewportWidth, height: viewportHeight },
  screen: { width: viewportWidth, height: viewportHeight },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const viewport = () => page.locator('[data-testid="dressed-avatar-viewport"]');
const signature = () => viewport().evaluate((element) => element.dataset.garmentGeometrySignatures ?? "");

const classifyVisiblePiece = async (surface, anchor) => {
  const inspector = page.locator(".inspector.is-mobile-active");
  await inspector.getByLabel("Função da peça").selectOption("custom");
  await inspector.getByLabel("Região corporal").selectOption("torso");
  await inspector.getByLabel("Superfície").selectOption(surface);
  await inspector.getByLabel("Lado corporal").selectOption("center");
  await inspector.getByLabel("Posição", { exact: true }).selectOption(anchor);
  await inspector.getByRole("button", { name: "Confirmar posição", exact: true }).click();
  await inspector.getByText("Pronta para vestir", { exact: true }).waitFor();
};

await page.goto(baseUrl, { waitUntil: "networkidle" });
page.once("dialog", (dialog) => dialog.accept("Painel mobile"));
await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).click();
const patternCanvas = page.locator("canvas.pattern-canvas");
const box = await patternCanvas.boundingBox();
if (!box) throw new Error("Canvas 2D mobile indisponível.");
for (const point of [
  { x: box.width * 0.18, y: box.height * 0.25 },
  { x: box.width * 0.82, y: box.height * 0.25 },
  { x: box.width * 0.82, y: box.height * 0.68 },
  { x: box.width * 0.18, y: box.height * 0.68 },
]) await patternCanvas.click({ position: point });
await page.keyboard.press("Enter");

await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
await page.getByText("Defina onde “Painel mobile” deve ficar no corpo.", { exact: true }).waitFor();
assert(await page.locator(".inspector.is-mobile-active").count() === 1, "Mobile: classificação não abriu no painel adequado.");
await classifyVisiblePiece("front", "torso-front");
await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
await page.locator("canvas.three-canvas").waitFor();
const beforeEdit = await signature();
assert(beforeEdit.length > 0, "Mobile: peça classificada não gerou mesh.");
assert(await page.getByText("Manequim humano ainda não configurado.", { exact: true }).count() > 0, "Mobile: ausência do asset não foi informada.");

const threeBox = await page.locator("canvas.three-canvas").boundingBox();
if (!threeBox) throw new Error("Canvas 3D mobile indisponível.");
await page.mouse.move(threeBox.x + threeBox.width * 0.45, threeBox.y + threeBox.height * 0.45);
await page.mouse.down();
await page.mouse.move(threeBox.x + threeBox.width * 0.65, threeBox.y + threeBox.height * 0.52, { steps: 8 });
await page.mouse.up();
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [
    { x: threeBox.x + threeBox.width * 0.42, y: threeBox.y + threeBox.height * 0.52 },
    { x: threeBox.x + threeBox.width * 0.58, y: threeBox.y + threeBox.height * 0.52 },
  ],
});
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchMove",
  touchPoints: [
    { x: threeBox.x + threeBox.width * 0.34, y: threeBox.y + threeBox.height * 0.52 },
    { x: threeBox.x + threeBox.width * 0.66, y: threeBox.y + threeBox.height * 0.52 },
  ],
});
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

await page.locator("button.right-panel-close").click();
await page.locator("canvas.three-canvas").waitFor({ state: "detached" });
await page.evaluate(() => window.__moldeonPhase0.selectPoint(0));
const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
const xInput = numeric.locator("label").filter({ hasText: /^X/ }).locator("input").first();
const x = Number(await xInput.inputValue());
await xInput.fill(String(x + 40));
await xInput.press("Enter");
await page.getByRole("tab", { name: "Manequim 3D", exact: true }).click();
await page.locator("canvas.three-canvas").waitFor();
await page.waitForFunction((previous) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures !== previous, beforeEdit);
const afterEdit = await signature();

await page.locator("button.right-panel-close").click();
await page.locator("canvas.three-canvas").waitFor({ state: "detached" });
await page.getByLabel("Mais ações para Painel mobile").click();
await page.getByRole("menuitem", { name: "Duplicar", exact: true }).click();
const pieces = page.locator(".pieces-item");
await pieces.last().locator("button.pieces-name").click();
await page.getByRole("button", { name: "Modelagem", exact: true }).click();
await page.getByRole("tab", { name: "Medidas", exact: true }).click();
await classifyVisiblePiece("back", "torso-back");
const seamState = await page.evaluate(() => window.__moldeonPhase0.createSimpleSeam());
assert(seamState.seamCount === 1, "Mobile: costura simples não foi confirmada.");
await page.getByRole("button", { name: "Montagem", exact: true }).click();
await page.getByRole("tab", { name: "Montagem", exact: true }).click();
await page.locator('input[value="Costura mobile"]').waitFor();

await page.getByRole("tab", { name: "Manequim 3D", exact: true }).click();
await page.locator("canvas.three-canvas").waitFor();
await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "2");
await page.locator("button.right-panel-close").click();
await page.locator("canvas.three-canvas").waitFor({ state: "detached" });
await page.getByRole("tab", { name: "Manequim 3D", exact: true }).click();
await page.locator("canvas.three-canvas").waitFor();

const layout = await page.evaluate(() => ({
  innerWidth: window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  garmentCount: Number(document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount ?? -1),
}));
assert(layout.scrollWidth <= layout.innerWidth + 1, `Mobile: overflow horizontal ${JSON.stringify(layout)}.`);
assert(layout.garmentCount === 2, "Mobile: reabertura perdeu instâncias.");
const instanceIdsBeforeReload = await viewport().evaluate((element) => element.dataset.garmentInstanceIds ?? "");
await page.waitForTimeout(1100);
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__moldeonPhase0));
const reloadedState = await page.evaluate(() => window.__moldeonPhase0.state());
assert(reloadedState.pieces.length === 2 && reloadedState.seamCount === 1, `Reload: documento não persistiu. ${JSON.stringify(reloadedState)}`);
await page.getByRole("tab", { name: "Manequim 3D", exact: true }).click();
await page.locator("canvas.three-canvas").waitFor();
await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "2");
const instanceIdsAfterReload = await viewport().evaluate((element) => element.dataset.garmentInstanceIds ?? "");
assert(instanceIdsAfterReload === instanceIdsBeforeReload, `Reload: identidade das instâncias mudou. ${JSON.stringify({ instanceIdsBeforeReload, instanceIdsAfterReload })}`);
assert(errors.length === 0, `Erros de console mobile: ${errors.join(" | ")}`);

const report = {
  journey16: "pass",
  created: true,
  classified: true,
  dressed: true,
  edited2D: beforeEdit !== afterEdit,
  simpleSeamCreated: seamState.seamCount === 1,
  orbitGesture: true,
  pinchGesture: true,
  closeReopen: true,
  reloadPersistence: true,
  layout,
  viewport: { width: viewportWidth, height: viewportHeight },
  signatures: { beforeEdit, afterEdit },
  instanceIds: { beforeReload: instanceIdsBeforeReload, afterReload: instanceIdsAfterReload },
  consoleErrors: errors,
};
await page.screenshot({ path: resolve(outputDir, "mobile-final.png"), fullPage: true });
writeFileSync(resolve(outputDir, "mobile-journey.json"), JSON.stringify(report, null, 2), "utf8");
process.stdout.write(JSON.stringify(report, null, 2));
await browser.close();
