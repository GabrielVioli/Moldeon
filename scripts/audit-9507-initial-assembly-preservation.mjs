import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const baseUrl = "http://127.0.0.1:5180";
const outputDir = resolve("artifacts/recovery-9-5-07-initial-assembly-preservation");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const server = startServer(5180);
await waitForServer(baseUrl, server);
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const report = await page.evaluate(async () => {
    const [blankModule, inputModule, avatarModule, arrangementModule, patternModule] = await Promise.all([
      import("/src/domain/blankGarment.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
      import("/src/domain/pattern.ts"),
    ]);
    const pieces = Array.from({ length: 4 }, (_, index) => ({
      id: `audit-panel-${index}`,
      name: `Painel ${index + 1}`,
      seamAllowanceMm: 0,
      cutQuantity: 1,
      points: [
        { id: `p${index}:a`, xMm: 0, yMm: 0 }, { id: `p${index}:b`, xMm: 80, yMm: 0 },
        { id: `p${index}:c`, xMm: 80, yMm: 140 }, { id: `p${index}:d`, xMm: 0, yMm: 140 },
      ],
      bodyPlacement: {
        version: 1,
        status: "confirmed",
        includeIn3D: true,
        role: "custom",
        region: "torso",
        surface: index % 2 === 0 ? "front" : "back",
        bodySide: "center",
        anchorId: index % 2 === 0 ? "torso-front" : "torso-back",
        outwardFace: "normal",
        offsetXMm: (index - 1.5) * 500,
        offsetYMm: index * 8,
        offsetZMm: 25,
        rotationXDeg: 0,
        rotationYDeg: 0,
        rotationZDeg: 0,
        source: "manual",
      },
    }));
    const seams = pieces.slice(0, -1).map((piece, index) => ({
      id: `audit-seam-${index}`,
      groupId: `audit-group-${index}`,
      first: { pieceId: piece.id, edgeId: patternModule.getPatternEdges(piece)[1].id, startT: 0, endT: 1 },
      second: { pieceId: pieces[index + 1].id, edgeId: patternModule.getPatternEdges(pieces[index + 1])[3].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      active: true,
    }));
    const garment = {
      ...blankModule.createBlankGarment(),
      pieces,
      seams,
    };
    const input = inputModule.buildResolvedAssemblyInput(garment);
    const avatar = avatarModule.buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const result = arrangementModule.buildSemanticAvatarArrangement(input, avatar);
    const panels = result.state.instances.map((instance) => {
      const positions = Array.from({ length: instance.vertexCount }, (_, local) => {
        const offset = (instance.particleStart + local) * 3;
        return [result.state.positions[offset], result.state.positions[offset + 1], result.state.positions[offset + 2]];
      });
      const span = (axis) => Math.max(...positions.map((position) => position[axis])) - Math.min(...positions.map((position) => position[axis]));
      const center = [0, 1, 2].map((axis) => positions.reduce((sum, position) => sum + position[axis], 0) / positions.length);
      return { id: instance.id, mapping: instance.arrangement?.mapping, spansM: [span(0), span(1), span(2)], center };
    });
    return {
      garment,
      panels,
      seamGroups: [...new Set(result.state.stitchConstraints.map((constraint) => constraint.seamGroupId))],
      finite: result.state.positions.every(Number.isFinite),
      warnings: result.state.warnings,
    };
  });

  if (!report.finite || report.panels.length !== 4) throw new Error(`Assembly inválido: ${JSON.stringify(report)}`);
  if (!report.panels.every((panel) => panel.mapping === "body-surface")) throw new Error(`Mapeamento inesperado: ${JSON.stringify(report.panels)}`);
  if (report.seamGroups.length !== 3) throw new Error(`SeamGroups perdidas: ${JSON.stringify(report.seamGroups)}`);
  if (report.panels.some((panel) => Math.max(...panel.spansM) < 0.05)) throw new Error(`Painel colapsado: ${JSON.stringify(report.panels)}`);

  await page.evaluate(async (garment) => {
    const [viewportModule, inputModule] = await Promise.all([
      import("/src/viewport/GlobalThreeViewport.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
    ]);
    document.body.innerHTML = "";
    document.body.style.margin = "0";
    const host = document.createElement("div");
    host.style.width = "100vw";
    host.style.height = "100vh";
    document.body.appendChild(host);
    const viewport = await viewportModule.ThreeViewport.create(host);
    viewport.updateGarment(inputModule.buildResolvedAssemblyInput(garment));
  }, report.garment);
  await page.locator("canvas.three-canvas").waitFor();
  await page.screenshot({ path: resolve(outputDir, "four-panels-preserved.png"), fullPage: true });
  if (consoleErrors.length > 0) throw new Error(`Erros no console: ${consoleErrors.join(" | ")}`);
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify({ ...report, consoleErrors }, null, 2), "utf8");
  process.stdout.write(JSON.stringify({
    panels: report.panels,
    seamGroups: report.seamGroups,
    finite: report.finite,
    warnings: report.warnings,
    consoleErrors,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await stopProcessTree(server);
}

function startServer(port) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = ["run", "dev:fallback", "--workspace", "@moldeon/web", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  return spawn(executable, process.platform === "win32" ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args, {
    cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Servidor encerrou com código ${child.exitCode}.`);
    try { if ((await fetch(url)).ok) return; } catch { /* Vite ainda iniciando. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Servidor local não respondeu.");
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("close", resolveStop); killer.on("error", resolveStop);
    });
  } else child.kill("SIGTERM");
}
