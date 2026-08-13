import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const baseUrl = "http://127.0.0.1:5179";
const outputDir = resolve("artifacts/recovery-9-5-07-seam-derived-tube");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const serverProcess = startServer(5179);
await waitForServer(baseUrl, serverProcess);
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

const drawPiece = async (name, points) => {
  page.once("dialog", (dialog) => dialog.accept(name));
  const emptyButton = page.getByRole("button", { name: "Desenhar primeira peÃ§a", exact: true });
  if (await emptyButton.count()) await emptyButton.click();
  else await page.getByRole("button", { name: "Desenhar", exact: true }).click();
  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas 2D indisponÃ­vel.");
  for (const point of points) {
    await canvas.click({ position: { x: box.width * point.x, y: box.height * point.y } });
  }
  await page.keyboard.press("Enter");
};

const sew = async (first, second) => {
  const canvas = page.locator("canvas.pattern-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas 2D indisponÃ­vel para costura.");
  await page.locator("button.seam-tool").click();
  await canvas.click({ position: { x: box.width * first.x, y: box.height * first.y } });
  await canvas.click({ position: { x: box.width * second.x, y: box.height * second.y } });
  try {
    await page.getByText("Revisar costura", { exact: true }).waitFor({ timeout: 8_000 });
  } catch (error) {
    await page.screenshot({ path: resolve(outputDir, "seam-selection-failure.png"), fullPage: true });
    const state = await page.evaluate(() => window.__moldeonPhase0?.state());
    throw new Error(`SeleÃ§Ã£o de costura falhou: ${JSON.stringify(state)}`, { cause: error });
  }
  await page.keyboard.press("Enter");
};

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await drawPiece("RetÃ¢ngulo A", [
    { x: 0.10, y: 0.34 }, { x: 0.40, y: 0.34 },
    { x: 0.40, y: 0.52 }, { x: 0.10, y: 0.52 },
  ]);
  await drawPiece("RetÃ¢ngulo B", [
    { x: 0.58, y: 0.34 }, { x: 0.88, y: 0.34 },
    { x: 0.88, y: 0.52 }, { x: 0.58, y: 0.52 },
  ]);
  await page.screenshot({ path: resolve(outputDir, "rectangles-before-sewing.png"), fullPage: true });

  await sew({ x: 0.392, y: 0.424 }, { x: 0.617, y: 0.358 });
  await sew({ x: 0.392, y: 0.644 }, { x: 0.617, y: 0.553 });
  const afterSeams = await page.evaluate(() => window.__moldeonPhase0?.state());
  if (afterSeams?.seamCount !== 2) throw new Error(`Esperadas 2 costuras; recebidas ${afterSeams?.seamCount}.`);

  await page.getByRole("button", { name: "Provar", exact: true }).click();
  await page.getByRole("button", { name: /Parte superior/ }).click();
  await page.locator(".dressing-piece-grid button").first().click();
  await page.locator("canvas.three-canvas").waitFor();

  const geometry = await page.evaluate(async () => {
    const [{ useEditorStore }, inputModule, avatarModule, arrangementModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
    ]);
    const garment = useEditorStore.getState().garment;
    const input = inputModule.buildResolvedAssemblyInput(garment);
    const avatar = avatarModule.buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const result = arrangementModule.buildSemanticAvatarArrangement(input, avatar);
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    const values = [0, 1, 2].map((axis) => {
      const coordinates = visible.flatMap((instance) => Array.from(
        { length: instance.vertexCount },
        (_, local) => result.state.positions[(instance.particleStart + local) * 3 + axis],
      ));
      return Math.max(...coordinates) - Math.min(...coordinates);
    });
    const pieceBounds = garment.pieces.map((piece) => ({
      widthMm: Math.max(...piece.points.map((point) => point.xMm)) - Math.min(...piece.points.map((point) => point.xMm)),
      heightMm: Math.max(...piece.points.map((point) => point.yMm)) - Math.min(...piece.points.map((point) => point.yMm)),
    }));
    return {
      spansM: { x: values[0], y: values[1], z: values[2] },
      expectedAxisM: pieceBounds[0].widthMm * 0.001,
      expectedDiameterM: pieceBounds.reduce((sum, bounds) => sum + bounds.heightMm, 0) / Math.PI * 0.001,
      mappings: visible.map((instance) => instance.arrangement?.mapping),
      axes: visible.map((instance) => instance.arrangement?.axis),
      pieceBounds,
    };
  });

  if (!geometry.mappings.every((mapping) => mapping === "seam-derived-tube")) {
    throw new Error(`Mapping inesperado: ${geometry.mappings.join(", ")}`);
  }
  if (Math.abs(geometry.spansM.x - geometry.expectedAxisM) > 0.003) {
    throw new Error(`Eixo X deformado: ${geometry.spansM.x} versus ${geometry.expectedAxisM}.`);
  }
  if (geometry.spansM.x <= Math.max(geometry.spansM.y, geometry.spansM.z) * 1.5) {
    throw new Error(`O tubo nÃ£o ficou horizontal: ${JSON.stringify(geometry.spansM)}.`);
  }
  if (consoleErrors.length > 0) throw new Error(`Erros no console: ${consoleErrors.join(" | ")}`);

  const report = { afterSeams, geometry, consoleErrors };
  await page.screenshot({ path: resolve(outputDir, "horizontal-tube.png"), fullPage: true });
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
  await stopProcessTree(serverProcess);
}

function startServer(port) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = ["run", "dev:fallback", "--workspace", "@moldeon/web", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  return spawn(
    executable,
    process.platform === "win32" ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args,
    { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Servidor encerrou com cÃ³digo ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite ainda estÃ¡ iniciando.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Servidor local nÃ£o respondeu em 60 segundos.");
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
