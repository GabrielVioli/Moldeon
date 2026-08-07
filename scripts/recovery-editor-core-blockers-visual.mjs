import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-editor-core-blockers";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = [];

async function openBlank(page) {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByText("Bancada vazia", { exact: true }).click();
  await page.getByRole("button", { name: "Criar bancada vazia" }).click();
  await page.locator(".empty-workspace").waitFor({ state: "visible" });
}

async function drawPiece(page, name, offsetX = 0, offsetY = 0) {
  if (await page.locator(".empty-workspace").isVisible().catch(() => false)) {
    page.once("dialog", (dialog) => dialog.accept(name));
    await page.getByRole("button", { name: "Desenhar primeira peça" }).click();
  } else {
    page.once("dialog", (dialog) => dialog.accept(name));
    await page.getByRole("button", { name: "Criar nova peça" }).click();
  }
  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box.");
  const points = [
    [box.width * 0.27 + offsetX, box.height * 0.28 + offsetY],
    [box.width * 0.60 + offsetX, box.height * 0.28 + offsetY],
    [box.width * 0.60 + offsetX, box.height * 0.62 + offsetY],
    [box.width * 0.27 + offsetX, box.height * 0.62 + offsetY],
  ];
  for (const [x, y] of points) await canvas.click({ position: { x, y } });
  await page.keyboard.press("Enter");
  await page.locator(".pieces-item").filter({ hasText: name }).waitFor();
  return { canvas, points };
}

async function clickEmpty(page, canvas) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box para clique vazio.");
  await canvas.click({ position: { x: box.width - 34, y: box.height - 34 } });
  await page.waitForTimeout(80);
}

async function assertNoSelection(page, label) {
  const checked = await page.locator('.pieces-item input[type="checkbox"]:checked').count();
  if (checked !== 0) throw new Error(`${label}: seleção de peça permaneceu ativa.`);
  if (await page.getByRole("button", { name: "Girar peça selecionada" }).isVisible().catch(() => false)) {
    throw new Error(`${label}: handle de rotação permaneceu após limpar seleção.`);
  }
  if (await page.getByRole("region", { name: "Edição numérica do editor 2D" }).isVisible().catch(() => false)) {
    throw new Error(`${label}: seleção de ponto/segmento permaneceu ativa.`);
  }
}

async function rotateWithPointer(context, page, handle, dx, dy, mobile) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("Handle de rotação sem bounding box.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (!mobile) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    const angle = page.getByRole("status", { name: "Ângulo de rotação" });
    await angle.waitFor({ state: "visible" });
    await page.mouse.up();
  } else {
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{
          x: x + dx * step / 8,
          y: y + dy * step / 8,
          id: 1,
          radiusX: 8,
          radiusY: 8,
          force: 1,
        }],
      });
    }
    const angle = page.getByRole("status", { name: "Ângulo de rotação" });
    await angle.waitFor({ state: "visible" });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.waitForTimeout(80);
}

async function dragSelectedPiece(context, page, canvas, mobile) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box para deslocamento.");
  const x = box.x + box.width * 0.43;
  const y = box.y + box.height * 0.45;
  if (!mobile) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 55, y + 35, { steps: 8 });
    await page.mouse.up();
  } else {
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 3, radiusX: 8, radiusY: 8, force: 1 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + 42, y: y + 30, id: 3, radiusX: 8, radiusY: 8, force: 1 }],
    });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.waitForTimeout(80);
}

try {
  for (const scenario of [
    { name: "desktop", viewport: { width: 1366, height: 768 }, mobile: false },
    { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await browser.newContext({ viewport: scenario.viewport, hasTouch: scenario.mobile, isMobile: scenario.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

    await openBlank(page);
    const { canvas, points } = await drawPiece(page, "Rotação");
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`${scenario.name}: canvas ausente.`);

    // Área da peça seleciona e torna o handle visual disponível.
    await canvas.click({ position: { x: box.width * 0.43, y: box.height * 0.45 } });
    const rotationHandle = page.getByRole("button", { name: "Girar peça selecionada" });
    await rotationHandle.waitFor({ state: "visible" });
    const initialRotation = Number(await rotationHandle.getAttribute("data-rotation-deg"));

    // Rotação contínua por mouse/touch gera feedback e uma única transação.
    await rotateWithPointer(context, page, rotationHandle, 52, 68, scenario.mobile);
    const afterRotation = Number(await rotationHandle.getAttribute("data-rotation-deg"));
    if (!Number.isFinite(afterRotation) || Math.abs(afterRotation - initialRotation) < 2) {
      throw new Error(`${scenario.name}: drag do handle não alterou a rotação.`);
    }
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    const afterUndo = Number(await rotationHandle.getAttribute("data-rotation-deg"));
    if (Math.abs(afterUndo - initialRotation) > 0.01) throw new Error(`${scenario.name}: undo não restaurou a rotação.`);
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(60);
    const afterRedo = Number(await rotationHandle.getAttribute("data-rotation-deg"));
    if (Math.abs(afterRedo - afterRotation) > 0.05) throw new Error(`${scenario.name}: redo não reaplicou a rotação.`);
    // Retorna ao ângulo inicial para os testes de hit em coordenadas conhecidas.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);

    // Escape limpa a seleção e remove o controle de rotação.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
    await assertNoSelection(page, `${scenario.name}: Escape`);

    // Ponto/handle selecionado também é limpo por clique vazio.
    await canvas.click({ position: { x: points[0][0], y: points[0][1] } });
    const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
    await numeric.waitFor({ state: "visible" });
    const curveButton = page.getByRole("button", { name: "Curvar segmento de saída" });
    if (await curveButton.isVisible().catch(() => false)) await curveButton.click();
    const handleOut = numeric.getByRole("button", { name: "Handle saída" });
    if (await handleOut.isEnabled().catch(() => false)) await handleOut.click();
    await clickEmpty(page, canvas);
    await assertNoSelection(page, `${scenario.name}: ponto/handle + fundo`);

    // Peça deslocada mantém seleção e limpeza previsíveis.
    await canvas.click({ position: { x: box.width * 0.43, y: box.height * 0.45 } });
    await page.getByRole("button", { name: "Girar peça selecionada" }).waitFor({ state: "visible" });
    await dragSelectedPiece(context, page, canvas, scenario.mobile);
    await clickEmpty(page, canvas);
    await assertNoSelection(page, `${scenario.name}: peça deslocada + fundo`);

    // Zoom alto e baixo não mudam a semântica do fundo. Selecionar via painel evita
    // depender da nova posição da peça para este teste específico.
    await page.getByRole("button", { name: "Aumentar zoom" }).click();
    await page.getByRole("button", { name: "Aumentar zoom" }).click();
    await page.getByRole("checkbox", { name: "Selecionar Rotação" }).check();
    await clickEmpty(page, canvas);
    await assertNoSelection(page, `${scenario.name}: zoom alto`);
    await page.getByRole("button", { name: "Diminuir zoom" }).click();
    await page.getByRole("button", { name: "Diminuir zoom" }).click();
    await page.getByRole("button", { name: "Diminuir zoom" }).click();
    await page.getByRole("checkbox", { name: "Selecionar Rotação" }).check();
    await clickEmpty(page, canvas);
    await assertNoSelection(page, `${scenario.name}: zoom baixo`);

    // Duas peças podem estar selecionadas; um toque/clique vazio limpa ambas.
    await drawPiece(page, "Segunda", scenario.mobile ? -18 : 70, scenario.mobile ? 80 : 45);
    await page.getByRole("checkbox", { name: "Selecionar Rotação" }).check();
    await page.getByRole("checkbox", { name: "Selecionar Segunda" }).check();
    await clickEmpty(page, canvas);
    await assertNoSelection(page, `${scenario.name}: múltiplas peças`);

    if (scenario.mobile) {
      // Um tap real no Canvas, sem movimento ou segundo dedo, é o gesto de fundo.
      const current = await canvas.boundingBox();
      if (!current) throw new Error("Canvas mobile ausente.");
      await page.getByRole("checkbox", { name: "Selecionar Segunda" }).check();
      await page.touchscreen.tap(current.x + current.width - 30, current.y + current.height - 30);
      await page.waitForTimeout(80);
      await assertNoSelection(page, "mobile: touch vazio");
    }

    await page.screenshot({ path: `${artifactDir}/${scenario.name}-selection-rotation.png`, fullPage: true });
    if (errors.length) throw new Error(`${scenario.name}: ${errors.join(" | ")}`);
    report.push({
      scenario: scenario.name,
      emptyClick: "ok",
      escape: "ok",
      rotationHandle: scenario.mobile ? "touch ok" : "mouse ok",
      rotationUndoRedo: "ok",
      movedPiece: "ok",
      zoomHighLow: "ok",
      multiSelection: "ok",
      touchEmpty: scenario.mobile ? "ok" : "n/a",
    });
    await context.close();
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
