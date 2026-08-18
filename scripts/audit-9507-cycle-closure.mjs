import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5185;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/recovery-9-5-07-cycle-closure");
mkdirSync(outputDir, { recursive: true });
const server = spawn(process.env.ComSpec ?? "cmd.exe", [
  "/d", "/s", "/c",
  `npm.cmd run dev:fallback --workspace @moldeon/web -- --host 127.0.0.1 --port ${port} --strictPort`,
], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
await waitForServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
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
        { id: `${id}:a`, xMm: 0, yMm: 0 }, { id: `${id}:b`, xMm: width, yMm: 0 },
        { id: `${id}:c`, xMm: width, yMm: height }, { id: `${id}:d`, xMm: 0, yMm: height },
      ],
    });
    const buildGarment = (closeCycle) => {
      const blank = blankModule.createBlankGarment();
      const front = rectangle("cycle-tube-front", 100, 260);
      const back = rectangle("cycle-tube-back", 100, 260);
      const upperA = rectangle("cycle-upper-a", 100, 60);
      const upperB = rectangle("cycle-upper-b", 100, 60);
      const frontEdges = patternModule.getPatternEdges(front);
      const backEdges = patternModule.getPatternEdges(back);
      const aEdges = patternModule.getPatternEdges(upperA);
      const bEdges = patternModule.getPatternEdges(upperB);
      const seams = [
        { id: "tube-right", first: { pieceId: front.id, edgeId: frontEdges[1].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[1].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "tube-left", first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[3].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "attach-a", first: { pieceId: front.id, edgeId: frontEdges[0].id, startT: 0, endT: 1 }, second: { pieceId: upperA.id, edgeId: aEdges[2].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "attach-b", first: { pieceId: back.id, edgeId: backEdges[2].id, startT: 0, endT: 1 }, second: { pieceId: upperB.id, edgeId: bEdges[2].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
      ];
      if (closeCycle) seams.push(
        { id: "upper-cycle:part:1", groupId: "upper-cycle", first: { pieceId: upperA.id, edgeId: aEdges[1].id, startT: 0, endT: 1 }, second: { pieceId: upperB.id, edgeId: bEdges[1].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "upper-cycle:part:2", groupId: "upper-cycle", first: { pieceId: upperA.id, edgeId: aEdges[3].id, startT: 0, endT: 1 }, second: { pieceId: upperB.id, edgeId: bEdges[3].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
      );
      return { ...blank, pieces: [front, back, upperA, upperB], seams, dressing: { region: "upper", frontReferencePieceId: front.id } };
    };
    const garments = { before: buildGarment(false), closed: buildGarment(true), removed: buildGarment(false) };
    const results = {};
    const positions = {};
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.style.width = "100vw";
    host.style.height = "100vh";
    document.body.appendChild(host);
    const viewport = await viewportModule.ThreeViewport.create(host);

    for (const [name, garment] of Object.entries(garments)) {
      const input = inputModule.buildResolvedAssemblyInput(garment);
      const arrangement = arrangementModule.buildSemanticAvatarArrangement(
        input,
        avatarModule.buildAvatarParametricModel(garment.measurements, garment.bodyType),
      );
      const meshes = bridgeModule.buildGarmentAssemblyMeshes(arrangement.state, arrangement.garment, {
        castShadow: false, receiveShadow: false, visibleInstanceIds: arrangement.visibleInstanceIds,
      });
      positions[name] = Object.fromEntries(arrangement.state.instances.map((instance) => [
        instance.id,
        Array.from(arrangement.state.positions.slice(instance.particleStart * 3, (instance.particleStart + instance.vertexCount) * 3)),
      ]));
      viewport.updateGarment(input);
      viewport.camera.position.set(0.42, 1.3, 0.6);
      viewport.controls.target.set(0, 1.3, 0.025);
      viewport.camera.updateProjectionMatrix();
      viewport.controls.update();
      if (viewport.frameId !== null) cancelAnimationFrame(viewport.frameId);
      viewport.frameId = null;
      viewport.renderer.render(viewport.scene, viewport.camera);
      const cycleConstraints = arrangement.state.stitchConstraints.filter((item) => item.seamGroupId === "upper-cycle");
      results[name] = {
        seamGroups: input.seamGroups.map((group) => group.id),
        mappings: arrangement.state.instances.map((instance) => ({ id: instance.id, mapping: instance.arrangement?.mapping })),
        intrinsic: assemblyModule.measureIntrinsicDistortion(arrangement.state),
        bridgeMeshes: bridgeModule.captureGarmentMeshDiagnostics(meshes),
        viewportMeshes: JSON.parse(host.dataset.garmentMeshDiagnostics ?? "[]"),
        cycleResidual: residual(arrangement.state.positions, cycleConstraints),
      };
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      await new Promise((resolveDelay) => requestAnimationFrame(() => resolveDelay()));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      await window.__captureCycleAudit?.(name);
    }
    const ids = Object.keys(positions.before);
    results.deltaBeforeClosed = Object.fromEntries(ids.map((id) => [id, maximumDelta(positions.before[id], positions.closed[id])]));
    results.deltaBeforeRemoved = Object.fromEntries(ids.map((id) => [id, maximumDelta(positions.before[id], positions.removed[id])]));
    const closedUpper = results.closed.viewportMeshes.filter((item) => item.id.startsWith("cycle-upper-"));
    results.upperComparison = {
      centroidDistance: distance(closedUpper[0].centroid, closedUpper[1].centroid),
      meanNormalDot: dot(closedUpper[0].meanNormal, closedUpper[1].meanNormal),
      exactBoundingBoxOverlap: JSON.stringify(closedUpper[0].boundingBox) === JSON.stringify(closedUpper[1].boundingBox),
      exactPositionOverlap: arraysEqual(positions.closed[closedUpper[0].id], positions.closed[closedUpper[1].id]),
    };
    window.__cycleAudit = { viewport, garments, buildInput: inputModule.buildResolvedAssemblyInput };
    return results;

    function residual(positionArray, constraints) {
      const values = constraints.map((constraint) => distance(point(positionArray, constraint.a), point(positionArray, constraint.b)));
      return { count: values.length, averageM: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), maxM: Math.max(0, ...values) };
    }
    function point(positionArray, reference) {
      return reference.particleIndices.reduce((result, particle, index) => {
        const offset = particle * 3;
        result[0] += positionArray[offset] * reference.weights[index];
        result[1] += positionArray[offset + 1] * reference.weights[index];
        result[2] += positionArray[offset + 2] * reference.weights[index];
        return result;
      }, [0, 0, 0]);
    }
    function maximumDelta(first, second) { return first.reduce((max, value, index) => Math.max(max, Math.abs(value - second[index])), 0); }
    function distance(first, second) { return Math.hypot(...first.map((value, index) => value - second[index])); }
    function dot(first, second) { return first.reduce((sum, value, index) => sum + value * second[index], 0); }
    function arraysEqual(first, second) { return first.length === second.length && first.every((value, index) => value === second[index]); }
  });

  await page.exposeFunction("__captureCycleAudit", async () => undefined).catch(() => undefined);
  for (const name of ["before", "closed", "removed"]) {
    await page.evaluate((scenario) => {
      const audit = window.__cycleAudit;
      audit.viewport.updateGarment(audit.buildInput(audit.garments[scenario]));
      audit.viewport.camera.position.set(0.42, 1.3, 0.6);
      audit.viewport.controls.target.set(0, 1.3, 0.025);
      audit.viewport.camera.updateProjectionMatrix();
      audit.viewport.controls.update();
      if (audit.viewport.frameId !== null) cancelAnimationFrame(audit.viewport.frameId);
      audit.viewport.frameId = null;
      audit.viewport.renderer.render(audit.viewport.scene, audit.viewport.camera);
    }, name);
    await page.screenshot({ path: resolve(outputDir, `${name}.png`), fullPage: true });
  }
  const output = { ...report, consoleErrors };
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(output, null, 2), "utf8");
  process.stdout.write(JSON.stringify(output, null, 2));
  if (consoleErrors.length > 0) throw new Error(consoleErrors.join(" | "));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolveStop) => {
    const killer = spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("close", resolveStop);
    killer.on("error", resolveStop);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Servidor encerrou com código ${server.exitCode}.`);
    try { if ((await fetch(baseUrl)).ok) return; } catch { /* Vite iniciando. */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Servidor local não respondeu.");
}
