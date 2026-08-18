import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const externalBaseUrl = process.argv[2]?.startsWith("http") ? process.argv[2] : null;
const baseUrl = externalBaseUrl ?? "http://127.0.0.1:5178";
const outputDir = resolve((externalBaseUrl ? process.argv[3] : process.argv[2]) ?? "artifacts/recovery-9-5-07-blocking-flow");
const viewportWidth = Number((externalBaseUrl ? process.argv[4] : process.argv[3]) ?? 1440);
const viewportHeight = Number((externalBaseUrl ? process.argv[5] : process.argv[4]) ?? 900);
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const serverProcess = externalBaseUrl ? null : startServer(5178);
if (serverProcess) await waitForServer(baseUrl, serverProcess);

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: viewportWidth, height: viewportHeight },
  locale: "pt-BR",
  isMobile: viewportWidth <= 760,
  hasTouch: viewportWidth <= 760,
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

const drawPiece = async (name, points) => {
  page.once("dialog", (dialog) => dialog.accept(name));
  const emptyButton = page.getByRole("button", { name: "Desenhar primeira peça", exact: true });
  if (await emptyButton.count()) await emptyButton.click();
  else await page.getByRole("button", { name: "Desenhar", exact: true }).click();
  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas 2D indisponível.");
  for (const point of points) {
    await canvas.click({ position: { x: box.width * point.x, y: box.height * point.y } });
  }
  await page.keyboard.press("Enter");
};

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await drawPiece("banana", [
    { x: 0.12, y: 0.25 }, { x: 0.36, y: 0.25 },
    { x: 0.36, y: 0.68 }, { x: 0.12, y: 0.68 },
  ]);
  await drawPiece("Painel 123", [
    { x: 0.58, y: 0.25 }, { x: 0.82, y: 0.25 },
    { x: 0.82, y: 0.68 }, { x: 0.58, y: 0.68 },
  ]);

  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas 2D indisponível após desenhar.");
  await page.locator("button.seam-tool").click();
  await canvas.click({ position: { x: box.width * 0.28, y: box.height * 0.49 } });
  const afterFirst = await page.evaluate(() => window.__moldeonPhase0?.state());
  await canvas.click({ position: { x: box.width * 0.72, y: box.height * 0.49 } });
  const afterSecond = await page.evaluate(() => window.__moldeonPhase0?.state());
  const proposalVisible = await page.getByRole("dialog", { name: "Confirmar proposta de costura" }).isVisible().catch(() => false);
  const contextConfirmationVisible = await page.getByText("Revisar costura", { exact: true }).isVisible().catch(() => false);
  const mode = await page.locator(".workspace").getAttribute("class");
  await page.keyboard.press("Enter");
  const afterEnter = await page.evaluate(() => window.__moldeonPhase0?.state());
  await page.getByRole("button", { name: "Provar", exact: true }).click();
  await page.getByRole("heading", { name: "Onde esta roupa deve ser vestida?" }).waitFor();
  const technicalClassificationVisible = await page.getByLabel("Função da peça").isVisible().catch(() => false);
  await page.getByRole("button", { name: /Parte superior/ }).click();
  await page.getByRole("heading", { name: "Qual peça deve iniciar na frente do corpo?" }).waitFor();
  await page.getByRole("button", { name: "Usar banana como referência frontal" }).click();
  await page.locator("canvas.three-canvas").waitFor();
  const assembly = await page.evaluate(() => window.__moldeonPhase0?.assembly());
  const viewport = await page.locator('[data-testid="dressed-avatar-viewport"]').evaluate((element) => ({
    instanceCount: Number(element.dataset.garmentInstanceCount ?? "-1"),
    signatures: element.dataset.garmentGeometrySignatures ?? "",
  }));
  let lifecycle = null;
  if (viewportWidth > 760) {
    await page.getByRole("button", { name: "Desenhar e editar", exact: true }).click();
    await page.locator(".pieces-item").filter({ hasText: "banana" }).locator("button.pieces-name").click();
    await page.evaluate(() => window.__moldeonPhase0?.selectPoint(0));
    const numeric = page.getByRole("region", { name: "Edição numérica do editor 2D" });
    await numeric.waitFor();
    const xInput = numeric.locator("label").filter({ hasText: /^X/ }).locator("input").first();
    const originalX = Number(await xInput.inputValue());
    await xInput.fill(String(originalX - 300));
    await xInput.press("Enter");
    await page.waitForFunction((previous) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures !== previous, viewport.signatures);
    const editedSignature = await page.locator('[data-testid="dressed-avatar-viewport"]').getAttribute("data-garment-geometry-signatures");
    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    await page.waitForFunction((expected) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures === expected, viewport.signatures);
    await page.getByRole("button", { name: "Refazer", exact: true }).click();
    await page.waitForFunction((expected) => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentGeometrySignatures === expected, editedSignature);

    await page.locator(".workspace-mode-switch").getByRole("button", { name: "Costurar", exact: true }).click();
    await page.getByRole("button", { name: "Selecionar costura Costura", exact: true }).click();
    await page.getByRole("button", { name: "Inverter", exact: true }).click();
    const inverted = await page.evaluate(() => window.__moldeonPhase0?.state().seams[0]?.direction);
    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    const directionAfterUndo = await page.evaluate(() => window.__moldeonPhase0?.state().seams[0]?.direction);
    await page.getByRole("button", { name: "Refazer", exact: true }).click();
    const directionAfterRedo = await page.evaluate(() => window.__moldeonPhase0?.state().seams[0]?.direction);
    await page.getByRole("button", { name: "Excluir", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "0");
    await page.getByRole("button", { name: "Provar", exact: true }).click();
    await page.getByRole("heading", { name: "Corrija isto antes de provar" }).waitFor();
    const invalidSeamMessage = await page.locator(".dressing-preflight-blocker").innerText();
    await page.getByRole("button", { name: "Fechar preparação da prova" }).click();
    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "2");
    await page.getByRole("button", { name: "Desenhar e editar", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Mais ações para Painel 123").click();
    await page.getByRole("menuitem", { name: "Excluir", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "0");
    const instanceCountAfterDelete = Number(await page.locator('[data-testid="dressed-avatar-viewport"]').getAttribute("data-garment-instance-count"));
    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="dressed-avatar-viewport"]')?.dataset.garmentInstanceCount === "2");

    lifecycle = {
      editedSignature,
      originalSignature: viewport.signatures,
      inverted,
      directionAfterUndo,
      directionAfterRedo,
      invalidSeamMessage,
      instanceCountAfterRestore: Number(await page.locator('[data-testid="dressed-avatar-viewport"]').getAttribute("data-garment-instance-count")),
      instanceCountAfterDelete,
    };
  }

  const report = {
    afterFirst,
    afterSecond,
    afterEnter,
    proposalVisible,
    contextConfirmationVisible,
    workspaceClass: mode,
    technicalClassificationVisible,
    assembly,
    viewport,
    lifecycle,
    testedViewport: { width: viewportWidth, height: viewportHeight },
    consoleErrors,
  };
  await page.screenshot({ path: resolve(outputDir, "dressed-after-simple-preflight.png"), fullPage: true });
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
  await stopProcessTree(serverProcess);
}

function startServer(port) {
  const npmExecutable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const npmArgs = ["run", "dev:fallback", "--workspace", "@moldeon/web", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  return spawn(
    npmExecutable,
    process.platform === "win32"
      ? ["/d", "/s", "/c", `npm.cmd ${npmArgs.join(" ")}`]
      : npmArgs,
    { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Servidor encerrou com código ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite ainda está iniciando.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Servidor local não respondeu em 60 segundos.");
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("close", resolveStop);
      killer.on("error", resolveStop);
    });
    return;
  }
  child.kill("SIGTERM");
}
