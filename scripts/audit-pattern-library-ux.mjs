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

async function openLibrary() {
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByRole("heading", { name: "Biblioteca de moldes" }).waitFor();
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
assert((await page.locator("body").innerText()).includes("Bancada vazia"), "Um usuário novo não iniciou na bancada vazia.");
assert(await page.getByRole("button", { name: "Adicionar manga", exact: true }).isDisabled(), "Assistente de manga foi habilitado sem cavas semânticas.");
await page.screenshot({ path: resolve(outputDir, "01-empty-workspace-desktop.png"), fullPage: true });

await openLibrary();
const libraryText = await page.locator(".pattern-library-dialog").innerText();
for (const name of hiddenTemplateNames) {
  assert(!libraryText.includes(name), `${name} ainda está visível na biblioteca pública.`);
}
assert(libraryText.includes("Crie um molde do zero para começar."), "Estado vazio da biblioteca não explica o próximo passo.");
await page.screenshot({ path: resolve(outputDir, "02-library-empty-desktop.png"), fullPage: true });

await page.getByRole("button", { name: "Cancelar", exact: true }).click();
assert((await page.locator("body").innerText()).includes("Bancada vazia"), "Cancelar alterou a bancada.");

await openLibrary();
await page.getByRole("button", { name: /Bancada vazia/ }).click();
await page.getByRole("button", { name: "Criar bancada vazia", exact: true }).click();
await page.getByRole("heading", { name: "Biblioteca de moldes" }).waitFor({ state: "hidden" });
const blankBodyText = await page.locator("body").innerText();
assert(blankBodyText.includes("Bancada vazia"), "Criar bancada vazia não retornou ao editor vazio.");
assert(!blankBodyText.includes("Camiseta básica"), "O projeto vazio carregou conteúdo de template oculto.");

await page.setViewportSize({ width: 390, height: 844 });
const mobileOverflowBefore = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert(mobileOverflowBefore <= 1, `Editor vazio tem overflow horizontal móvel de ${mobileOverflowBefore}px.`);
await openLibrary();
const mobileOverflowLibrary = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert(mobileOverflowLibrary <= 1, `Biblioteca vazia tem overflow horizontal móvel de ${mobileOverflowLibrary}px.`);
await page.screenshot({ path: resolve(outputDir, "03-library-empty-mobile.png"), fullPage: true });
await page.getByRole("button", { name: "Fechar biblioteca" }).click();

assert(consoleErrors.length === 0, `Erros de console: ${consoleErrors.join(" | ")}`);
const audit = {
  baseUrl,
  publicAutomaticTemplates: 0,
  hiddenTemplateNames,
  newUserStartsBlank: true,
  blankProjectCreated: true,
  cancelPreservedWorkspace: true,
  sleeveDisabledWithoutSemanticArmholes: true,
  mobileOverflowEditorPx: mobileOverflowBefore,
  mobileOverflowLibraryPx: mobileOverflowLibrary,
  consoleErrors,
};
writeFileSync(resolve(outputDir, "ux-audit.json"), JSON.stringify(audit, null, 2), "utf8");
process.stdout.write(JSON.stringify(audit, null, 2));

await browser.close();
