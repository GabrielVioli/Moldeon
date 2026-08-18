import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5178";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-07-journeys");
const viewportWidth = Number(process.argv[4] ?? 1440);
const viewportHeight = Number(process.argv[5] ?? 900);
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await (await browser.newContext({ viewport: { width: viewportWidth, height: viewportHeight } })).newPage();
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
  { x: initialBox.width * 0.08, y: initialBox.height * 0.26 },
  { x: initialBox.width * 0.92, y: initialBox.height * 0.26 },
  { x: initialBox.width * 0.92, y: initialBox.height * 0.68 },
  { x: initialBox.width * 0.08, y: initialBox.height * 0.68 },
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
const originalAssemblySignature = await page.evaluate(() => window.__moldeonPhase0.assemblySignature());

await closeViewport();
await selectPoint(0);
const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
await numeric.waitFor();
const xInput = numeric.locator("label").filter({ hasText: /^X/ }).locator("input").first();
const originalX = Number(await xInput.inputValue());
const nextPointBeforeEdit = await page.evaluate(() => window.__moldeonPhase0.point(1));
assert(nextPointBeforeEdit.xMm - originalX > 250, `J4: fixture não comporta +250 mm sem cruzar a borda: ${JSON.stringify({ originalX, nextPointBeforeEdit })}`);
await xInput.fill(String(originalX + 250));
await xInput.press("Enter");
const pointAfterEdit = await page.evaluate(() => window.__moldeonPhase0.point(0));
const pointEditedAssemblySignature = await page.evaluate(() => window.__moldeonPhase0.assemblySignature());
assert(Math.abs(pointAfterEdit.xMm - (originalX + 250)) < 0.01, `J4: campo X não alterou a geometria: ${JSON.stringify(pointAfterEdit)}`);
assert(pointEditedAssemblySignature !== originalAssemblySignature, "J4: assinatura canônica não mudou após edição do ponto.");
await reopenViewport();
await page.waitForTimeout(800);
const pointEditedSignature = await viewportSignature();
const pointEditedMeshCount = await garmentCount();
const pointWarnings = await page.locator(".viewport-warnings").allTextContents();
assert(pointEditedSignature !== originalSignature, `J4: edição do ponto não invalidou a mesh. ${JSON.stringify({ originalSignature, pointEditedSignature, pointEditedMeshCount, pointWarnings })}`);

await closeViewport();
await page.getByRole("button", { name: "Desfazer" }).click();
await reopenViewport();
await page.waitForFunction((expected) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures === expected, originalSignature);
await closeViewport();
await page.getByRole("button", { name: "Refazer" }).click();
await reopenViewport();
await page.waitForFunction((expected) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures === expected, pointEditedSignature);

await closeViewport();
await page.getByRole("button", { name: "Modelagem", exact: true }).click();
await selectPoint(1);
await reopenViewport();
await page.getByRole("button", { name: "Curvar segmento de saída", exact: true }).click();
await page.waitForTimeout(800);
const curvedSignature = await viewportSignature();
const curvedAssemblySignature = await page.evaluate(() => window.__moldeonPhase0.assemblySignature());
assert(curvedAssemblySignature !== pointEditedAssemblySignature, "J5: converter o segmento não alterou o documento canônico.");
assert(curvedSignature !== pointEditedSignature, `J5: converter o segmento não atualizou a mesh. ${JSON.stringify({ pointEditedSignature, curvedSignature, count: await garmentCount(), warnings: await page.locator(".viewport-warnings").allTextContents() })}`);
await numeric.getByRole("button", { name: "Handle saída", exact: true }).first().click();
const handleX = numeric.locator("label").filter({ hasText: /^Handle X/ }).locator("input").first();
const originalHandleX = Number(await handleX.inputValue());
await handleX.fill(String(originalHandleX + 30));
await handleX.press("Enter");
await page.waitForFunction((previous) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures !== previous, curvedSignature);
const curveEditedSignature = await viewportSignature();
assert(curveEditedSignature !== curvedSignature, "J5: edição do handle não invalidou a mesh.");

await closeViewport();
await page.getByLabel("Mais ações para Painel canônico").click();
await page.getByRole("menuitem", { name: "Duplicar", exact: true }).click();
const pieces = page.locator(".pieces-item");
assert(await pieces.count() === 2, "J6: duplicação não criou a segunda peça.");
await pieces.last().locator("button.pieces-name").click();
await reopenViewport();
await classifyActivePiece({ region: "leg", surface: "front", side: "right", anchor: "leg-right" });
await page.waitForTimeout(800);
assert(await garmentCount() === 2, `J6: duas peças classificadas não geraram duas meshes. ${JSON.stringify({ count: await garmentCount(), auditState: await page.evaluate(() => window.__moldeonPhase0.state()), assembly: await page.evaluate(() => window.__moldeonPhase0.assembly()), warnings: await page.locator(".viewport-warnings").allTextContents() })}`);

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
    7: "pass",
    13: "pass",
  },
  signatures: { originalSignature, pointEditedSignature, curveEditedSignature },
  finalGarmentMeshCount: await garmentCount(),
  avatarConfigured: false,
  viewport: { width: viewportWidth, height: viewportHeight },
  consoleErrors: errors,
};
assert(errors.length === 0, `Erros de console: ${errors.join(" | ")}`);
await page.screenshot({ path: resolve(outputDir, "desktop-empty-after-journeys.png"), fullPage: true });
writeFileSync(resolve(outputDir, "desktop-journeys.json"), JSON.stringify(report, null, 2), "utf8");
process.stdout.write(JSON.stringify(report, null, 2));
await browser.close();
