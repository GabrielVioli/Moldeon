import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://localhost:5173";
const outputDir = resolve(process.argv[3] ?? "artifacts/recovery-9-5-06-dart-panels");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const report = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function drawRectangle(page, touch) {
  page.once("dialog", (dialog) => dialog.accept("Painel livre"));
  await page.getByRole("button", { name: "Desenhar primeira peça", exact: true }).click();
  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas indisponível.");
  const points = [
    { x: box.width * 0.27, y: box.height * 0.27 },
    { x: box.width * 0.69, y: box.height * 0.27 },
    { x: box.width * 0.69, y: box.height * 0.69 },
    { x: box.width * 0.27, y: box.height * 0.69 },
  ];
  for (const point of points) await tapCanvas(page, canvas, point, touch);
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: "Selecionar Painel livre" }).waitFor();
  return { canvas, box, points };
}

async function tapCanvas(page, canvas, point, touch) {
  if (!touch) {
    await canvas.click({ position: point });
    return;
  }
  await canvas.tap({ position: point });
}

async function reopenOperations(page) {
  await page.locator(".pieces-item").filter({ hasText: "Painel livre" }).locator(".pieces-name").click();
  await page.locator(".context-bar").waitFor({ state: "visible" });
}

async function closeWithButton(page) {
  await page.locator(".context-bar").getByRole("button", { name: "Fechar", exact: true }).click();
  await page.locator(".context-bar").waitFor({ state: "hidden" });
}

async function panCanvas(page, canvas, touch) {
  await page.getByRole("button", { name: "Mão", exact: true }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas indisponível para pan.");
  const start = { x: box.x + box.width * 0.78, y: box.y + box.height * 0.58 };
  if (!touch) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 28, start.y + 22, { steps: 5 });
    await page.mouse.up();
  } else {
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 7 }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x - 28, y: start.y + 22, id: 7 }] });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.getByRole("button", { name: "Mão", exact: true }).click();
}

for (const scenario of [
  { name: "desktop", viewport: { width: 1440, height: 980 }, touch: false },
  { name: "mobile-touch", viewport: { width: 390, height: 844 }, touch: true },
]) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    hasTouch: scenario.touch,
    isMobile: scenario.touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const { canvas, box, points } = await drawRectangle(page, scenario.touch);
  const checkbox = page.getByRole("checkbox", { name: "Selecionar Painel livre" });
  const panel = page.locator(".context-bar");
  if (!await checkbox.isChecked()) await checkbox.check();
  await panel.waitFor({ state: "visible" });

  // Botão Fechar preserva seleção e não cria comando.
  await panel.getByText("Criar prega", { exact: true }).click();
  await closeWithButton(page);
  assert(await checkbox.isChecked(), `${scenario.name}: Fechar destruiu a seleção.`);
  assert(await page.locator(".dialog-backdrop").count() === 0, `${scenario.name}: overlay invisível permaneceu.`);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await page.locator(".empty-workspace").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await checkbox.waitFor();

  // Reabrir, Escape e repetição.
  await reopenOperations(page);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert(await checkbox.isChecked(), `${scenario.name}: Escape destruiu a seleção.`);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await reopenOperations(page);
    await closeWithButton(page);
  }

  // Clique fora fecha e o mesmo Canvas continua recebendo interação.
  await reopenOperations(page);
  await tapCanvas(page, canvas, { x: box.width - 28, y: box.height * 0.45 }, scenario.touch);
  await panel.waitFor({ state: "hidden" });
  await reopenOperations(page);

  // Escape durante um desenho temporário cancela sem deixar caminho ou operação.
  await page.getByRole("button", { name: "Pence", exact: true }).click();
  await tapCanvas(page, canvas, { x: points[0].x + 30, y: points[0].y }, scenario.touch);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert(await page.getByRole("button", { name: "Fechar pence", exact: true }).count() === 0, `${scenario.name}: Escape deixou uma pence parcial.`);
  await page.getByRole("button", { name: "Selecionar", exact: true }).click();

  // Pence real: três pontos do V, sem depender de instrução ou ordem interna.
  await page.getByRole("button", { name: "Pence", exact: true }).click();
  const dartPoints = [
    { x: points[0].x + (points[1].x - points[0].x) * 0.25, y: points[0].y },
    { x: (points[0].x + points[1].x) / 2, y: points[0].y + (points[2].y - points[1].y) * 0.48 },
    { x: points[0].x + (points[1].x - points[0].x) * 0.75, y: points[1].y },
  ];
  for (const point of dartPoints) {
    await tapCanvas(page, canvas, point, scenario.touch);
  }
  await page.keyboard.press("Enter");
  const closeDart = page.getByRole("button", { name: "Fechar pence", exact: true });
  await closeDart.waitFor({ state: "visible", timeout: 5000 }).catch(async () => {
    const currentPanel = await panel.count() ? await panel.innerText().catch(() => "painel sem texto") : "painel ausente";
    throw new Error(`${scenario.name}: Fechar pence não apareceu. Estado: ${currentPanel}`);
  });
  assert(await closeDart.isEnabled(), `${scenario.name}: V inequívoco foi rejeitado.`);
  const panelText = await panel.innerText();
  assert(!/primeiro nó|ápice da pence precisa/i.test(panelText), `${scenario.name}: painel ainda ensina ordem interna.`);
  await panel.getByRole("button", { name: "Fechar", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  await tapCanvas(page, canvas, dartPoints[1], scenario.touch);
  await closeDart.waitFor({ state: "visible" });
  assert(await closeDart.isEnabled(), `${scenario.name}: reabrir o painel alterou a validade da pence.`);
  await closeDart.click();

  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "networkidle" });
  await checkbox.waitFor();

  // Smoke do corte em V já aprovado: não exige overshoot.
  if (!await checkbox.isChecked()) await checkbox.check();
  await page.getByRole("button", { name: "Recortar", exact: true }).click();
  const cutPoints = [
    { x: points[0].x + 18, y: points[0].y },
    { x: points[0].x + 55, y: points[0].y + 65 },
    { x: points[0].x + 92, y: points[0].y },
  ];
  for (const point of cutPoints) await tapCanvas(page, canvas, point, scenario.touch);
  await page.keyboard.press("Enter");
  const applyCut = page.getByRole("button", { name: "Aplicar corte", exact: true });
  await applyCut.waitFor({ state: "visible" });
  assert(await applyCut.isEnabled(), `${scenario.name}: corte em V sem overshoot foi rejeitado.`);
  await applyCut.click();
  assert(await page.locator(".pieces-item").count() === 2, `${scenario.name}: corte em V não criou duas peças.`);

  await page.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
  await page.getByRole("button", { name: "Diminuir zoom", exact: true }).click();
  await panCanvas(page, canvas, scenario.touch);

  await page.screenshot({ path: resolve(outputDir, `${scenario.name}.png`), fullPage: true });
  assert(errors.length === 0, `${scenario.name}: erros de console: ${errors.join(" | ")}`);
  report.push({
    scenario: scenario.name,
    closeButton: true,
    escape: true,
    outsideClick: true,
    reopenCycles: 3,
    selectionPreserved: true,
    dartV: true,
    closeDartPanelWithoutApplying: true,
    undoRedo: true,
    reload: true,
    cutVWithoutOvershoot: true,
    zoomAndPan: true,
    consoleErrors: errors,
  });
  await context.close();
}

writeFileSync(resolve(outputDir, "audit.json"), JSON.stringify(report, null, 2), "utf8");
process.stdout.write(JSON.stringify(report, null, 2));
await browser.close();
