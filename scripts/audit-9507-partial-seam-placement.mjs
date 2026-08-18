import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5184;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/recovery-9-5-07-partial-seam-placement");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outputDir, { recursive: true });

const server = spawn(process.env.ComSpec ?? "cmd.exe", [
  "/d", "/s", "/c",
  `npm.cmd run dev:fallback --workspace @moldeon/web -- --host 127.0.0.1 --port ${port} --strictPort`,
], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
await waitForServer();
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const report = await page.evaluate(async () => {
    const [threeAuditModule, blankModule, patternModule, inputModule, avatarModule, arrangementModule, bridgeModule, assemblyModule, viewportModule] = await Promise.all([
      import("/src/dev/threeAudit.ts"),
      import("/src/domain/blankGarment.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
      import("/src/garment3d/GarmentThreeBridge.ts"),
      import("/src/garment3d/GarmentAssembly.ts"),
      import("/src/viewport/GlobalThreeViewport.ts"),
    ]);
    const { THREE } = threeAuditModule;
    const rectangle = (id, width, height) => ({
      id, name: id, seamAllowanceMm: 0, cutQuantity: 1,
      points: [
        { id: `${id}:a`, xMm: 0, yMm: 0 }, { id: `${id}:b`, xMm: width, yMm: 0 },
        { id: `${id}:c`, xMm: width, yMm: height }, { id: `${id}:d`, xMm: 0, yMm: height },
      ],
    });
    const blank = blankModule.createBlankGarment();
    const front = rectangle("diagnostic-tube-front", 100, 260);
    const back = rectangle("diagnostic-tube-back", 100, 260);
    const flap = rectangle("diagnostic-short-flap", 80, 60);
    const frontEdges = patternModule.getPatternEdges(front);
    const backEdges = patternModule.getPatternEdges(back);
    const flapEdges = patternModule.getPatternEdges(flap);
    const garment = {
      ...blank,
      pieces: [front, back, flap],
      dressing: { region: "upper", frontReferencePieceId: front.id },
      seams: [
        { id: "tube-right", first: { pieceId: front.id, edgeId: frontEdges[1].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[1].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "tube-left", first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[3].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "partial-flap", groupId: "partial-flap-group", first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0.2, endT: 0.8 }, second: { pieceId: flap.id, edgeId: flapEdges[1].id, startT: 0, endT: 1 }, direction: "same", easeRatio: 0, type: "intentional-mismatch", treatment: "intentional-mismatch", active: true },
      ],
    };
    const input = inputModule.buildResolvedAssemblyInput(garment);
    const arrangement = arrangementModule.buildSemanticAvatarArrangement(
      input,
      avatarModule.buildAvatarParametricModel(garment.measurements, garment.bodyType),
    );
    const diagnostic = arrangement.seamPlacementDiagnostics.find((item) => item.seamGroupId === "partial-flap-group");
    if (!diagnostic) throw new Error("Diagnóstico do retalho não foi produzido.");

    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.style.width = "100vw";
    host.style.height = "100vh";
    document.body.appendChild(host);
    const viewport = await viewportModule.ThreeViewport.create(host);
    viewport.updateGarment(input);
    const debug = new THREE.Group();
    debug.name = "partial-seam-debug";
    viewport.scene.add(debug);
    addPoint(debug, diagnostic.parentStart, 0xff3b30);
    addPoint(debug, diagnostic.parentEnd, 0x3478f6);
    addPoint(debug, diagnostic.parentMidpoint, 0x34c759);
    addVector(debug, diagnostic.parentMidpoint, diagnostic.seamTangent, 0xffcc00, 0.075);
    addVector(debug, diagnostic.parentMidpoint, diagnostic.parentNormal, 0x00d9ff, 0.065);
    addVector(debug, diagnostic.parentMidpoint, diagnostic.developDirection, 0xff2dca, 0.095);
    viewport.camera.position.set(0.42, 1.28, 0.54);
    viewport.controls.target.set(0, 1.28, 0.025);
    viewport.camera.updateProjectionMatrix();
    viewport.controls.update();
    if (viewport.frameId !== null) cancelAnimationFrame(viewport.frameId);
    viewport.frameId = null;
    viewport.renderer.render(viewport.scene, viewport.camera);

    const meshes = bridgeModule.buildGarmentAssemblyMeshes(arrangement.state, arrangement.garment, {
      castShadow: false, receiveShadow: false, visibleInstanceIds: arrangement.visibleInstanceIds,
    });
    return {
      seam: diagnostic,
      intrinsic: assemblyModule.measureIntrinsicDistortion(arrangement.state),
      meshes: bridgeModule.captureGarmentMeshDiagnostics(meshes),
      viewportMeshes: JSON.parse(host.dataset.garmentMeshDiagnostics ?? "[]"),
    };

    function addPoint(group, point, color) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 16, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      marker.position.set(...point);
      marker.renderOrder = 10;
      group.add(marker);
    }
    function addVector(group, origin, direction, color, length) {
      const unit = new THREE.Vector3(...direction).normalize();
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...origin),
          new THREE.Vector3(...origin).addScaledVector(unit, length),
        ]),
        new THREE.LineBasicMaterial({ color, depthTest: false }),
      );
      line.renderOrder = 10;
      group.add(line);
    }
  });
  await page.screenshot({ path: resolve(outputDir, "partial-seam-debug.png"), fullPage: true });
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
