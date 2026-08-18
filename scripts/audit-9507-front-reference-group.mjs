import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5181;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/recovery-9-5-07-front-reference-group");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const server = startServer(port);
await waitForServer(baseUrl, server);
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const [blankModule, patternModule, storeModule] = await Promise.all([
      import("/src/domain/blankGarment.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/state/editorStore.ts"),
    ]);
    const rectangle = (id, name) => ({
      id,
      name,
      seamAllowanceMm: 10,
      cutQuantity: 2,
      cutOnFold: false,
      points: [
        { id: `${id}:a`, xMm: 0, yMm: 0 },
        { id: `${id}:b`, xMm: 120, yMm: 0 },
        { id: `${id}:c`, xMm: 110, yMm: 220 },
        { id: `${id}:d`, xMm: 25, yMm: 220 },
      ],
    });
    const first = rectangle("panel-a", "Painel âmbar");
    const second = rectangle("panel-b", "Painel azul");
    const firstEdges = patternModule.getPatternEdges(first);
    const secondEdges = patternModule.getPatternEdges(second);
    const base = blankModule.createBlankGarment();
    storeModule.useEditorStore.getState().loadGarment({
      ...base,
      name: "Auditoria da referência frontal",
      pieces: [first, second],
      workspaceStates: [first, second].map((piece, index) => ({
        pieceId: piece.id,
        visible: true,
        locked: false,
        transform: { pieceId: piece.id, xMm: index * 180, yMm: 0, rotationDeg: 0 },
      })),
      seams: [
        {
          id: "seam-side-a",
          name: "União 1",
          first: { pieceId: first.id, edgeId: firstEdges[1].id, startT: 0, endT: 1 },
          second: { pieceId: second.id, edgeId: secondEdges[3].id, startT: 0, endT: 1 },
          direction: "opposite",
          treatment: "standard",
          type: "standard",
          easeRatio: 0,
          active: true,
        },
        {
          id: "seam-side-b",
          name: "União 2",
          first: { pieceId: first.id, edgeId: firstEdges[3].id, startT: 0, endT: 1 },
          second: { pieceId: second.id, edgeId: secondEdges[1].id, startT: 0, endT: 1 },
          direction: "opposite",
          treatment: "standard",
          type: "standard",
          easeRatio: 0,
          active: true,
        },
      ],
      dressing: { region: "lower" },
    });
  });

  await page.getByRole("button", { name: "Provar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Qual peça ou conjunto serve como referência frontal?" }).waitFor();
  await page.screenshot({ path: resolve(outputDir, "reference-groups.png"), fullPage: true });

  const frontOption = dialog.getByRole("button", {
    name: "Usar Painel âmbar e sua parte espelhada como referência frontal",
  });
  await frontOption.click();
  const selectedCount = await frontOption.locator(".dressing-piece-thumbnail").count();
  const selectedPressed = await frontOption.getAttribute("aria-pressed");
  await page.screenshot({ path: resolve(outputDir, "mirrored-pair-selected.png"), fullPage: true });

  await dialog.getByRole("button", { name: "Usar como referência frontal", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const state = await page.evaluate(async () => {
    const [storeModule, inputModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
    ]);
    const garment = storeModule.useEditorStore.getState().garment;
    const input = inputModule.buildResolvedAssemblyInput(garment);
    return {
      frontReferencePieceId: garment.dressing?.frontReferencePieceId,
      panelInstances: input.panelInstances.map((instance) => ({
        id: instance.id,
        sourcePatternId: instance.sourcePatternId,
        mirrored: instance.mirrored,
        surface: instance.surface,
        bodySide: instance.bodySide,
      })),
      seamGroupIds: input.seamGroups.map((group) => group.id),
    };
  });

  const report = {
    heading: await page.title(),
    selectedThumbnailCount: selectedCount,
    selectedPressed,
    ...state,
    consoleErrors,
  };
  if (selectedCount !== 2 || selectedPressed !== "true") {
    throw new Error("O par espelhado não recebeu destaque conjunto.");
  }
  if (state.panelInstances.length !== 4) throw new Error("O assembly não preservou as quatro instâncias.");
  if (consoleErrors.length > 0) throw new Error(`Erros no console: ${consoleErrors.join(" | ")}`);
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
  await stopProcessTree(server);
}

function startServer(serverPort) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = ["run", "dev:fallback", "--workspace", "@moldeon/web", "--", "--host", "127.0.0.1", "--port", String(serverPort), "--strictPort"];
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
      killer.on("close", resolveStop);
      killer.on("error", resolveStop);
    });
  } else child.kill("SIGTERM");
}
