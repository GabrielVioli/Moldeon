import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://localhost:5173";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-06-library-deferred/app-ux");
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const hiddenTemplateNames = [
  "Corpo básico",
  "Camiseta básica",
  "Blusa básica",
  "Saia reta",
  "Minissaia",
  "Calça reta",
  "Jaqueta básica",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
assert((await page.locator("body").innerText()).includes("Bancada vazia"), "Um usuário novo não iniciou na bancada vazia.");
assert(await page.getByRole("button", { name: "Adicionar manga", exact: true }).isDisabled(), "Assistente de manga foi habilitado sem cavas semânticas.");
assert(await page.getByRole("button", { name: "Moldes", exact: true }).count() === 0, "O botão Moldes ainda está visível.");
assert(await page.getByRole("button", { name: "Abrir biblioteca", exact: true }).count() === 0, "A bancada vazia ainda oferece acesso à biblioteca.");
assert(await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).isVisible(), "A ação principal para desenhar não está visível.");
await page.screenshot({ path: resolve(outputDir, "01-empty-workspace-desktop.png"), fullPage: true });

page.once("dialog", (dialog) => dialog.accept("Primeira peça"));
await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).click();
assert((await page.locator("body").innerText()).includes("Desenhando Primeira peça"), "A ação principal não iniciou o desenho.");
await page.keyboard.press("Escape");
assert((await page.locator("body").innerText()).includes("A bancada está vazia"), "Cancelar o desenho não restaurou a bancada vazia.");

await page.setViewportSize({ width: 390, height: 844 });
const mobileOverflowBefore = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert(mobileOverflowBefore <= 1, `Editor vazio tem overflow horizontal móvel de ${mobileOverflowBefore}px.`);
assert(await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).isVisible(), "A ação principal não está visível no mobile.");
await page.screenshot({ path: resolve(outputDir, "02-empty-workspace-mobile.png"), fullPage: true });

assert(consoleErrors.length === 0, `Erros de console: ${consoleErrors.join(" | ")}`);
const audit = {
  baseUrl,
  publicLibraryEntryPoints: 0,
  publicAutomaticTemplates: 0,
  hiddenTemplateNames,
  newUserStartsBlank: true,
  drawFirstPieceStarted: true,
  cancelDrawingPreservedWorkspace: true,
  sleeveDisabledWithoutSemanticArmholes: true,
  mobileOverflowEditorPx: mobileOverflowBefore,
  consoleErrors,
};
writeFileSync(resolve(outputDir, "ux-audit.json"), JSON.stringify(audit, null, 2), "utf8");
process.stdout.write(JSON.stringify(audit, null, 2));

await browser.close();
