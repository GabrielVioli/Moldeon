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
  return canvas;
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
    const canvas = await drawFirstPiece(page);
    await page.screenshot({
      path: `${artifactDir}/${scenario.name}-drawn.png`,
      fullPage: true,
    });

    const pieceCount = await page.locator(".pieces-item").count();
    if (pieceCount !== 1) {
      throw new Error(`${scenario.name}: primeira peça não ficou disponível.`);
    }

    const box = await canvas.boundingBox();
    if (!box) throw new Error(`${scenario.name}: canvas sem bounding box.`);
    await canvas.click({
      position: { x: box.width * 0.28, y: box.height * 0.28 },
    });
    const numericPanel = page.getByRole("region", {
      name: "Edição numérica do editor 2D",
    });
    await numericPanel.waitFor({ state: "visible" });

    const pointX = numericPanel.getByText("X", { exact: true }).locator("..").getByRole("spinbutton");
    await pointX.fill("12.5");
    await pointX.press("Enter");

    await page.getByRole("button", { name: "Curvar segmento de saída" }).click();
    await page.getByRole("button", { name: "Handle saída" }).click();
    const lengthField = numericPanel.getByText("Comprimento", { exact: true }).locator("..").getByRole("spinbutton");
    await lengthField.fill("42");
    await lengthField.press("Enter");

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
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -180);
      await page.mouse.wheel(0, 180);
    }

    await page.keyboard.press("Escape");
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
      numericPoint: "ok",
      curveHandle: "ok",
      zoom: "ok",
      gesture: scenario.mobile ? "pinch ok" : "wheel ok",
      escapeUndoRedo: "ok",
    });
    await context.close();
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
