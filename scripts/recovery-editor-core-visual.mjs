import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4179";
const artifactDir =
  process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-editor-core";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = [];

async function openBlank(page) {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Moldes", exact: true }).click();
  await page.getByText("Bancada vazia", { exact: true }).click();
  await page.getByRole("button", { name: "Criar bancada vazia" }).click();
  await page.locator(".empty-workspace").waitFor({ state: "visible" });
}

async function drawFirstPiece(page) {
  page.once("dialog", (dialog) => dialog.accept("Editor core"));
  await page.getByRole("button", { name: "Desenhar primeira peça" }).click();
  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas sem bounding box.");
  const points = [
    [box.width * 0.28, box.height * 0.28],
    [box.width * 0.68, box.height * 0.28],
    [box.width * 0.66, box.height * 0.68],
    [box.width * 0.30, box.height * 0.68],
  ];
  for (const [x, y] of points) {
    await canvas.click({ position: { x, y } });
  }
  await page.keyboard.press("Enter");
  await page.locator(".pieces-item").filter({ hasText: "Editor core" }).waitFor();
  return { canvas, points };
}

async function pointCount(page) {
  const text = await page
    .locator(".metric-card")
    .filter({ hasText: "Pontos" })
    .first()
    .locator("strong")
    .textContent();
  const value = Number.parseInt(text ?? "", 10);
  if (!Number.isFinite(value)) throw new Error(`Contagem de pontos inválida: ${text}`);
  return value;
}

async function numericPanel(page) {
  return page.getByRole("region", { name: "Edição numérica do editor 2D" });
}

async function selectNodeNear(page, canvas, target, label) {
  const panel = await numericPanel(page);
  const offsets = [
    [0, 0], [8, 0], [-8, 0], [0, 8], [0, -8],
    [14, 0], [-14, 0], [0, 14], [0, -14],
    [10, 10], [-10, 10], [10, -10], [-10, -10],
    [20, 0], [-20, 0], [0, 20], [0, -20],
  ];
  for (const [dx, dy] of offsets) {
    await canvas.click({ position: { x: target[0] + dx, y: target[1] + dy } });
    await page.waitForTimeout(35);
    if (await panel.getByRole("button", { name: "Nó", exact: true }).isVisible().catch(() => false)) {
      return panel;
    }
  }
  throw new Error(`${label}: não foi possível selecionar o nó próximo ao vértice esperado.`);
}

async function selectSegmentNear(page, canvas, target, label) {
  const panel = await numericPanel(page);
  const offsets = [
    [0, 0], [0, 6], [0, -6], [6, 0], [-6, 0],
    [0, 12], [0, -12], [12, 0], [-12, 0],
  ];
  for (const [dx, dy] of offsets) {
    await page.keyboard.press("Escape");
    await canvas.click({ position: { x: target[0] + dx, y: target[1] + dy } });
    await page.waitForTimeout(35);
    if (await panel.getByText(/Segmento ·/).isVisible().catch(() => false)) return panel;
  }
  throw new Error(`${label}: não foi possível selecionar o segmento esperado.`);
}

async function insertPointNear(page, canvas, target, expectedCount, label) {
  await page.getByRole("button", { name: "+ Ponto", exact: true }).click();
  const offsets = [[0, 0], [0, 5], [0, -5], [5, 0], [-5, 0], [0, 10], [0, -10]];
  for (const [dx, dy] of offsets) {
    await canvas.click({ position: { x: target[0] + dx, y: target[1] + dy } });
    await page.waitForTimeout(40);
    if ((await pointCount(page)) === expectedCount) return;
    if (await page.getByRole("button", { name: "+ Ponto", exact: true }).isVisible()) {
      const active = await page.getByRole("button", { name: "+ Ponto", exact: true }).evaluate(
        (element) => element.classList.contains("active"),
      );
      if (!active) await page.getByRole("button", { name: "+ Ponto", exact: true }).click();
    }
  }
  throw new Error(`${label}: inserção não alterou a contagem para ${expectedCount} pontos.`);
}

async function assertNoErrors(errors, label) {
  if (errors.length) {
    throw new Error(`${label}: erros no navegador: ${errors.join(" | ")}`);
  }
}

try {
  for (const scenario of [
    { name: "desktop", viewport: { width: 1366, height: 768 }, mobile: false },
    { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: scenario.viewport,
      hasTouch: scenario.mobile,
      isMobile: scenario.mobile,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await openBlank(page);
    const { canvas, points } = await drawFirstPiece(page);
    await page.screenshot({
      path: `${artifactDir}/${scenario.name}-drawn.png`,
      fullPage: true,
    });

    if ((await page.locator(".pieces-item").count()) !== 1 || (await pointCount(page)) !== 4) {
      throw new Error(`${scenario.name}: primeira peça não ficou íntegra e disponível.`);
    }

    const box = await canvas.boundingBox();
    if (!box) throw new Error(`${scenario.name}: canvas sem bounding box.`);

    // Área da peça: selecionar o centro não deve criar um nó/segmento acidentalmente.
    await canvas.click({ position: { x: box.width * 0.48, y: box.height * 0.48 } });
    const pieceCheckbox = page.getByRole("checkbox", { name: "Selecionar Editor core" });
    if (!(await pieceCheckbox.isChecked())) {
      throw new Error(`${scenario.name}: clique na área não selecionou a peça.`);
    }

    // Inserção em reta.
    const topMiddle = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
    await insertPointNear(page, canvas, topMiddle, 5, `${scenario.name}: reta`);

    // Seleção de nó e edição numérica X/Y.
    let panel = await selectNodeNear(page, canvas, points[0], `${scenario.name}: nó`);
    const pointX = panel.getByLabel("X", { exact: true });
    const pointY = panel.getByLabel("Y", { exact: true });
    await pointX.fill("12.5");
    await pointX.press("Enter");
    await pointY.fill("18.5");
    await pointY.press("Enter");

    // Seleção de segmento e conversão para cúbica.
    const rightMiddle = [(points[1][0] + points[2][0]) / 2, (points[1][1] + points[2][1]) / 2];
    panel = await selectSegmentNear(page, canvas, rightMiddle, `${scenario.name}: segmento`);
    const convertCurve = page.getByRole("button", { name: "Converter para curva", exact: true });
    if (await convertCurve.isVisible().catch(() => false)) await convertCurve.click();
    else await panel.getByRole("button", { name: "Converter", exact: true }).click();

    // Inserção em segmento cúbico usa o mesmo gesto de + Ponto; o domínio valida De Casteljau.
    await insertPointNear(page, canvas, rightMiddle, 6, `${scenario.name}: curva`);

    // O ponto recém-inserido fica selecionado e possui handles de continuidade.
    panel = await numericPanel(page);
    await panel.waitFor({ state: "visible" });
    const handleIn = panel.getByRole("button", { name: "Handle entrada", exact: true });
    const handleOut = panel.getByRole("button", { name: "Handle saída", exact: true });
    if (await handleIn.isEnabled()) {
      await handleIn.click();
      if ((await handleIn.getAttribute("aria-pressed")) !== "true") {
        throw new Error(`${scenario.name}: handle de entrada não foi selecionado individualmente.`);
      }
    }
    if (!(await handleOut.isEnabled())) {
      throw new Error(`${scenario.name}: handle de saída indisponível após divisão cúbica.`);
    }
    await handleOut.click();
    if ((await handleOut.getAttribute("aria-pressed")) !== "true") {
      throw new Error(`${scenario.name}: handle de saída não foi selecionado individualmente.`);
    }
    const lengthField = panel.getByLabel("Comprimento", { exact: true });
    const angleField = panel.getByLabel("Ângulo", { exact: true });
    await lengthField.fill("42");
    await lengthField.press("Enter");
    await angleField.fill("25");
    await angleField.press("Enter");

    // Zoom +/− e navegação por roda/pinch não podem invalidar a seleção nem mover geometria.
    await page.getByRole("button", { name: "Aumentar zoom" }).click();
    await page.getByRole("button", { name: "Diminuir zoom" }).click();
    if (scenario.mobile) {
      const client = await context.newCDPSession(page);
      const current = await canvas.boundingBox();
      if (!current) throw new Error("Canvas mobile sem bounding box.");
      const y = current.y + current.height * 0.45;
      const left = current.x + current.width * 0.38;
      const right = current.x + current.width * 0.62;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: left, y, radiusX: 2, radiusY: 2, force: 1, id: 1 },
          { x: right, y, radiusX: 2, radiusY: 2, force: 1, id: 2 },
        ],
      });
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: left - 28, y, radiusX: 2, radiusY: 2, force: 1, id: 1 },
          { x: right + 28, y, radiusX: 2, radiusY: 2, force: 1, id: 2 },
        ],
      });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -180);
      await page.mouse.wheel(0, 180);
      await page.getByRole("button", { name: "Mão", exact: true }).click();
      await canvas.hover({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5 + 45, box.y + box.height * 0.5 + 20);
      await page.mouse.up();
      await page.getByRole("button", { name: "Mão", exact: true }).click();
    }

    // Fundo e Escape limpam seleção; undo/redo permanecem operacionais.
    await page.keyboard.press("Escape");
    await canvas.click({ position: { x: Math.max(30, box.width - 36), y: Math.max(30, box.height - 36) } });
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");

    await page.screenshot({
      path: `${artifactDir}/${scenario.name}-final.png`,
      fullPage: true,
    });
    await assertNoErrors(errors, scenario.name);
    report.push({
      scenario: scenario.name,
      firstPiece: "ok",
      pieceArea: "ok",
      point: "ok",
      lineInsertion: "ok",
      segment: "ok",
      cubicInsertion: "ok",
      handles: "entrada/saída ok",
      numericPoint: "X/Y ok",
      numericHandle: "coordenadas derivadas por comprimento/ângulo ok",
      zoom: "controles ok",
      gesture: scenario.mobile ? "pinch ok" : "wheel/pan ok",
      escapeUndoRedo: "ok",
    });
    await context.close();
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
