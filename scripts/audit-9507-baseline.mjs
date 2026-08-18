import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5178";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-07-baseline");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
page.once("dialog", (dialog) => dialog.accept("Costas"));
await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).click();
const canvas = page.locator("canvas.pattern-canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("Canvas 2D indisponível.");
for (const point of [
  { x: box.width * 0.28, y: box.height * 0.25 },
  { x: box.width * 0.62, y: box.height * 0.25 },
  { x: box.width * 0.62, y: box.height * 0.65 },
  { x: box.width * 0.28, y: box.height * 0.65 },
]) await canvas.click({ position: point });
await page.keyboard.press("Enter");

const dressButton = page.getByRole("button", { name: "Vestir no manequim", exact: true });
const proofButton = page.getByRole("button", { name: "Prova", exact: true });
const baseline = {
  freePieceName: "Costas",
  dressEnabledWithoutClassification: await dressButton.isEnabled(),
  proofEnabledWithoutClassification: await proofButton.isEnabled(),
};

await dressButton.click();
await page.locator("canvas.three-canvas").waitFor({ state: "visible", timeout: 15000 });
const host = page.locator("[data-testid=dressed-avatar-viewport]");
Object.assign(baseline, await host.evaluate((element) => ({
  garmentMeshCount: Number(element.dataset.garmentInstanceCount ?? -1),
  proceduralAvatarVisible: element.dataset.avatarVisible === "true",
  collisionProxyCountExposed: Number(element.dataset.collisionProxyCount ?? -1),
  arrangementErrors: Number(element.dataset.arrangementErrorCount ?? -1),
})));
baseline.consoleErrors = errors;

await page.screenshot({ path: resolve(outputDir, "before.png"), fullPage: true });
writeFileSync(resolve(outputDir, "before.json"), JSON.stringify(baseline, null, 2), "utf8");
process.stdout.write(JSON.stringify(baseline, null, 2));
await browser.close();
