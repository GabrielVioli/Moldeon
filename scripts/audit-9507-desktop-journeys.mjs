import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5178";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-07-journeys");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const classifyActivePiece = async ({ region, surface, side, anchor }) => {
  await page.getByLabel("Função da peça").selectOption("custom");
  await page.getByLabel("Região corporal").selectOption(region);
  await page.getByLabel("Superfície").selectOption(surface);
  await page.getByLabel("Lado corporal").selectOption(side);
  await page.getByLabel("Posição", { exact: true }).selectOption(anchor);
  await page.getByRole("button", { name: "Confirmar posição", exact: true }).click();
  await page.getByText("Pronta para vestir", { exact: true }).waitFor();
};
const viewport = () => page.locator('[data-testid="dressed-avatar-viewport"]');
const viewportSignature = () => viewport().evaluate((element) => element.dataset.garmentGeometrySignatures ?? "");
const garmentCount = () => viewport().evaluate((element) => Number(element.dataset.garmentInstanceCount ?? "-1"));
const closeViewport = async () => {
  await page.locator("button.right-panel-close").click();
  await page.locator("canvas.three-canvas").waitFor({ state: "detached" });
};
const reopenViewport = async () => {
  await page.locator("button.right-panel-toggle").click();
  await page.locator("canvas.three-canvas").waitFor();
};
const selectPoint = async (index) => {
  const selection = await page.evaluate((pointIndex) => window.__moldeonPhase0?.selectPoint(pointIndex), index);
  assert(Boolean(selection?.selectedPointId), `Seleção de ponto falhou: ${JSON.stringify(selection)}`);
};

await page.goto(baseUrl, { waitUntil: "networkidle" });
page.once("dialog", (dialog) => dialog.accept("Painel canônico"));
await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).click();
const patternCanvas = page.locator("canvas.pattern-canvas");
const initialBox = await patternCanvas.boundingBox();
if (!initialBox) throw new Error("Canvas 2D indisponível.");
const points = [
  { x: initialBox.width * 0.30, y: initialBox.height * 0.26 },
  { x: initialBox.width * 0.64, y: initialBox.height * 0.26 },
  { x: initialBox.width * 0.64, y: initialBox.height * 0.68 },
  { x: initialBox.width * 0.30, y: initialBox.height * 0.68 },
];
for (const point of points) await patternCanvas.click({ position: point });
await page.keyboard.press("Enter");
assert(await page.getByText("Posição não definida", { exact: true }).count() > 0, "J1: classificação surgiu automaticamente.");

await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
await page.getByText("Defina onde “Painel canônico” deve ficar no corpo.", { exact: true }).waitFor();
assert(await page.locator("canvas.three-canvas").count() === 0, "J2: viewport abriu antes da classificação.");
await classifyActivePiece({ region: "torso", surface: "front", side: "center", anchor: "torso-front" });
await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
await page.locator("canvas.three-canvas").waitFor();
await page.getByText("Manequim humano ainda não configurado.", { exact: true }).first().waitFor();
assert(await garmentCount() === 1, "J3: a peça classificada não gerou uma instância.");
const originalSignature = await viewportSignature();

await closeViewport();
await selectPoint(0);
const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
await numeric.waitFor();
const xInput = numeric.locator("label").filter({ hasText: /^X/ }).locator("input").first();
const originalX = Number(await xInput.inputValue());
await xInput.fill(String(originalX + 250));
await xInput.press("Enter");
await reopenViewport();
await page.waitForFunction((previous) => {
  const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
  return host?.dataset.garmentGeometrySignatures && host.dataset.garmentGeometrySignatures !== previous;
}, originalSignature);
const pointEditedSignature = await viewportSignature();
assert(pointEditedSignature !== originalSignature, "J4: edição do ponto não invalidou a mesh.");

await closeViewport();
await page.getByRole("button", { name: "Desfazer" }).click();
await reopenViewport();
await page.waitForFunction((expected) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures === expected, originalSignature);
await closeViewport();
await page.getByRole("button", { name: "Refazer" }).click();
await reopenViewport();
await page.waitForFunction((expected) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures === expected, pointEditedSignature);

await closeViewport();
await selectPoint(1);
await page.getByRole("button", { name: "Curvar segmento de saída", exact: true }).click();
await numeric.getByRole("button", { name: "Handle saída", exact: true }).first().click();
const handleY = numeric.locator("label").filter({ hasText: /^Handle Y/ }).locator("input").first();
const originalHandleY = Number(await handleY.inputValue());
await handleY.fill(String(originalHandleY + 80));
await handleY.press("Enter");
await reopenViewport();
await page.waitForFunction((previous) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures !== previous, pointEditedSignature);
const curveEditedSignature = await viewportSignature();
assert(curveEditedSignature !== pointEditedSignature, "J5: edição do handle não invalidou a mesh.");

await closeViewport();
await page.getByLabel("Mais ações para Painel canônico").click();
await page.getByRole("menuitem", { name: "Duplicar", exact: true }).click();
const pieces = page.locator(".pieces-item");
assert(await pieces.count() === 2, "J6: duplicação não criou a segunda peça.");
await pieces.last().locator("button.pieces-name").click();
await classifyActivePiece({ region: "torso", surface: "back", side: "center", anchor: "torso-back" });
await page.getByRole("button", { name: "Vestir no manequim", exact: true }).click();
await page.locator("canvas.three-canvas").waitFor();
assert(await garmentCount() === 2, "J6: duas peças classificadas não geraram duas meshes.");

page.once("dialog", (dialog) => dialog.accept());
await pieces.last().locator("button.pieces-more").click();
await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "1");
assert(await garmentCount() === 1, "J6: exclusão deixou mesh fantasma.");
await page.getByRole("button", { name: "Desfazer" }).click();
await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "2");

for (let remaining = 2; remaining > 0; remaining -= 1) {
  const currentPieces = page.locator(".pieces-item");
  page.once("dialog", (dialog) => dialog.accept());
  await currentPieces.last().locator("button.pieces-more").click();
  await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
  await page.waitForFunction((expected) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === String(expected), remaining - 1);
}
assert(await garmentCount() === 0, "J13: projeto vazio manteve garment mesh.");
assert(await viewport().getAttribute("data-avatar-visible") === "false", "J13: avatar indevido apareceu.");

const report = {
  journeys: {
    1: "pass",
    2: "pass",
    3: "pass",
    4: "pass",
    5: "pass",
    6: "pass",
    13: "pass",
  },
  signatures: { originalSignature, pointEditedSignature, curveEditedSignature },
  finalGarmentMeshCount: await garmentCount(),
  avatarConfigured: false,
  consoleErrors: errors,
};
assert(errors.length === 0, `Erros de console: ${errors.join(" | ")}`);
await page.screenshot({ path: resolve(outputDir, "desktop-empty-after-journeys.png"), fullPage: true });
writeFileSync(resolve(outputDir, "desktop-journeys.json"), JSON.stringify(report, null, 2), "utf8");
process.stdout.write(JSON.stringify(report, null, 2));
await browser.close();
