import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5178";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-07-flow");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));

const assert = (condition, message) => { if (!condition) throw new Error(message); };

await page.goto(baseUrl, { waitUntil: "networkidle" });
page.once("dialog", (dialog) => dialog.accept("Peça criativa"));
await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).click();
const canvas = page.locator("canvas.pattern-canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("Canvas 2D indisponível.");
for (const point of [
  { x: box.width * 0.30, y: box.height * 0.26 },
  { x: box.width * 0.64, y: box.height * 0.26 },
  { x: box.width * 0.64, y: box.height * 0.68 },
  { x: box.width * 0.30, y: box.height * 0.68 },
]) await canvas.click({ position: point });
await page.keyboard.press("Enter");

await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
await page.getByText("Defina onde “Peça criativa” deve ficar no corpo.").waitFor();
assert(await page.locator("canvas.three-canvas").count() === 0, "O 3D abriu antes da classificação.");

await page.getByLabel("Função da peça").selectOption("custom");
await page.getByLabel("Região corporal").selectOption("torso");
await page.getByLabel("Superfície").selectOption("front");
await page.getByLabel("Lado corporal").selectOption("center");
await page.getByLabel("Posição", { exact: true }).selectOption("torso-front");
await page.getByRole("button", { name: "Confirmar posição", exact: true }).click();
await page.getByText("Pronta para vestir", { exact: true }).waitFor();

await page.waitForTimeout(900);
await page.reload({ waitUntil: "networkidle" });
await page.getByText("Pronta para vestir", { exact: true }).waitFor();

const report = {
  blockedBeforeClassification: true,
  focusedBodyPosition: true,
  customClassificationConfirmed: true,
  persistedAfterReload: true,
  consoleErrors: errors,
};
await page.screenshot({ path: resolve(outputDir, "classification-desktop.png"), fullPage: true });
writeFileSync(resolve(outputDir, "classification.json"), JSON.stringify(report, null, 2), "utf8");
process.stdout.write(JSON.stringify(report, null, 2));
await browser.close();
