import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5183;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/recovery-9-5-07-tube-three-boundary");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const server = startServer(port);
await waitForServer(baseUrl, server);
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const report = await page.evaluate(async () => {
    const [blankModule, patternModule, inputModule, avatarModule, arrangementModule, bridgeModule, assemblyModule, viewportModule] = await Promise.all([
      import("/src/domain/blankGarment.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
      import("/src/garment3d/GarmentThreeBridge.ts"),
      import("/src/garment3d/GarmentAssembly.ts"),
      import("/src/viewport/GlobalThreeViewport.ts"),
    ]);

    const rectangle = (id, width, height) => ({
      id, name: id, seamAllowanceMm: 0, cutQuantity: 1,
      points: [
        { id: `${id}:a`, xMm: 0, yMm: 0 },
        { id: `${id}:b`, xMm: width, yMm: 0 },
        { id: `${id}:c`, xMm: width, yMm: height },
        { id: `${id}:d`, xMm: 0, yMm: height },
      ],
    });
    const garment = (withAttachments) => {
      const blank = blankModule.createBlankGarment();
      const front = rectangle("tube-front", 100, 260);
      const back = rectangle("tube-back", 100, 260);
      const extraFront = rectangle("extra-front", 100, 60);
      const extraBack = rectangle("extra-back", 100, 60);
      const frontEdges = patternModule.getPatternEdges(front);
      const backEdges = patternModule.getPatternEdges(back);
      const seams = [
        { id: "tube-right", first: { pieceId: front.id, edgeId: frontEdges[1].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[1].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "tube-left", first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[3].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
      ];
      if (withAttachments) {
        seams.push(
          { id: "attach-front", first: { pieceId: front.id, edgeId: frontEdges[0].id, startT: 0, endT: 1 }, second: { pieceId: extraFront.id, edgeId: patternModule.getPatternEdges(extraFront)[2].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
          { id: "attach-back", first: { pieceId: back.id, edgeId: backEdges[0].id, startT: 0, endT: 1 }, second: { pieceId: extraBack.id, edgeId: patternModule.getPatternEdges(extraBack)[2].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        );
      }
      return {
        ...blank,
        pieces: withAttachments ? [front, back, extraFront, extraBack] : [front, back],
        seams,
        dressing: { region: "upper", frontReferencePieceId: front.id },
      };
    };

    const scenarios = { isolated: garment(false), attached: garment(true) };
    const results = {};
    const positions = {};
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.style.width = "100vw";
    host.style.height = "100vh";
    document.body.appendChild(host);
    const viewport = await viewportModule.ThreeViewport.create(host);

    for (const [name, draft] of Object.entries(scenarios)) {
      const input = inputModule.buildResolvedAssemblyInput(draft);
      const arrangement = arrangementModule.buildSemanticAvatarArrangement(
        input,
        avatarModule.buildAvatarParametricModel(draft.measurements, draft.bodyType),
      );
      const meshes = bridgeModule.buildGarmentAssemblyMeshes(arrangement.state, arrangement.garment, {
        castShadow: false,
        receiveShadow: false,
        visibleInstanceIds: arrangement.visibleInstanceIds,
      });
      const tubeInstances = arrangement.state.instances.filter((instance) => instance.pieceId.startsWith("tube-"));
      positions[name] = Object.fromEntries(tubeInstances.map((instance) => [
        instance.id,
        Array.from(arrangement.state.positions.slice(instance.particleStart * 3, (instance.particleStart + instance.vertexCount) * 3)),
      ]));
      viewport.updateGarment(input);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      results[name] = {
        panelInstanceCount: arrangement.state.instances.length,
        bridgeMeshCount: meshes.length,
        viewportMeshCount: Number(host.dataset.garmentInstanceCount),
        surfaces: arrangement.state.instances.map((instance) => ({ id: instance.id, surface: instance.placement.surface, mapping: instance.arrangement?.mapping })),
        intrinsic: assemblyModule.measureIntrinsicDistortion(arrangement.state),
        bridge: bridgeModule.captureGarmentMeshDiagnostics(meshes),
        viewport: JSON.parse(host.dataset.garmentMeshDiagnostics ?? "[]"),
      };
      await new Promise((resolveDelay) => requestAnimationFrame(() => resolveDelay()));
    }

    results.tubeCoordinateDelta = Object.fromEntries(Object.keys(positions.isolated).map((id) => [
      id,
      positions.isolated[id].reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - positions.attached[id][index])), 0),
    ]));
    window.__tubeBoundaryAudit = { viewport, scenarios, buildResolvedAssemblyInput: inputModule.buildResolvedAssemblyInput };
    return results;
  });

  await page.evaluate(() => {
    const audit = window.__tubeBoundaryAudit;
    audit.viewport.updateGarment(audit.buildResolvedAssemblyInput(audit.scenarios.isolated));
    audit.viewport.camera.position.set(0.45, 1.29, 0.72);
    audit.viewport.controls.target.set(0, 1.29, 0.025);
    audit.viewport.camera.updateProjectionMatrix();
    audit.viewport.controls.update();
    if (audit.viewport.frameId !== null) cancelAnimationFrame(audit.viewport.frameId);
    audit.viewport.frameId = null;
    audit.viewport.renderer.render(audit.viewport.scene, audit.viewport.camera);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(outputDir, "tube-isolated.png"), fullPage: true });
  await page.evaluate(() => {
    const audit = window.__tubeBoundaryAudit;
    audit.viewport.updateGarment(audit.buildResolvedAssemblyInput(audit.scenarios.attached));
    audit.viewport.camera.position.set(0.45, 1.29, 0.72);
    audit.viewport.controls.target.set(0, 1.29, 0.025);
    audit.viewport.camera.updateProjectionMatrix();
    audit.viewport.controls.update();
    if (audit.viewport.frameId !== null) cancelAnimationFrame(audit.viewport.frameId);
    audit.viewport.frameId = null;
    audit.viewport.renderer.render(audit.viewport.scene, audit.viewport.camera);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(outputDir, "tube-plus-two.png"), fullPage: true });
  const output = { ...report, consoleErrors };
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(output, null, 2), "utf8");
  process.stdout.write(JSON.stringify(output, null, 2));
  if (consoleErrors.length > 0) throw new Error(`Erros no console: ${consoleErrors.join(" | ")}`);
  if (Object.values(report.tubeCoordinateDelta).some((delta) => delta !== 0)) throw new Error("O tubo mudou após os anexos.");
} finally {
  await context.close();
  await browser.close();
  await stopProcessTree(server);
}

function startServer(serverPort) {
  const executable = process.env.ComSpec ?? "cmd.exe";
  const args = ["run", "dev:fallback", "--workspace", "@moldeon/web", "--", "--host", "127.0.0.1", "--port", String(serverPort), "--strictPort"];
  return spawn(executable, ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], {
    cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Servidor encerrou com código ${child.exitCode}.`);
    try { if ((await fetch(url)).ok) return; } catch { /* Vite iniciando. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Servidor local não respondeu.");
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolveStop) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("close", resolveStop);
    killer.on("error", resolveStop);
  });
}
