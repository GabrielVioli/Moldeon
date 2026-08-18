import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5182;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/recovery-9-5-07-intrinsic-assembly");
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
  const report = await page.evaluate(async () => {
    const [blankModule, patternModule, inputModule, avatarModule, arrangementModule, assemblyModule] = await Promise.all([
      import("/src/domain/blankGarment.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
      import("/src/garment3d/GarmentAssembly.ts"),
    ]);
    const placement = (index, surface) => ({
      version: 1, status: "confirmed", includeIn3D: true, role: "custom", region: "torso", surface,
      bodySide: "center", anchorId: surface === "front" ? "torso-front" : "torso-back",
      outwardFace: "normal", offsetXMm: index * 25, offsetYMm: 0, offsetZMm: 25,
      rotationXDeg: 0, rotationYDeg: 0, rotationZDeg: 0, source: "manual",
    });
    const tubePanel = (id, surface) => ({
      id, name: id, seamAllowanceMm: 0, cutQuantity: 1, bodyPlacement: placement(0, surface),
      points: [
        { id: `${id}:a`, xMm: 0, yMm: 0 }, { id: `${id}:b`, xMm: 260, yMm: 0 },
        { id: `${id}:c`, xMm: 260, yMm: 100 }, { id: `${id}:d`, xMm: 0, yMm: 100 },
      ],
    });
    const tubeGarment = (attachmentCount) => {
      const blank = blankModule.createBlankGarment();
      const front = tubePanel("tube-front", "front");
      const back = tubePanel("tube-back", "back");
      const extras = Array.from({ length: attachmentCount }, (_, index) => ({
        id: `extra-${index + 1}`, name: `Painel adicional ${index + 1}`, seamAllowanceMm: 0, cutQuantity: 1,
        bodyPlacement: placement(index + 1, index % 2 === 0 ? "front" : "back"),
        points: [
          { id: `extra-${index + 1}:a`, xMm: 0, yMm: 0 }, { id: `extra-${index + 1}:b`, xMm: 80, yMm: 0 },
          { id: `extra-${index + 1}:c`, xMm: 80, yMm: 60 }, { id: `extra-${index + 1}:d`, xMm: 0, yMm: 60 },
        ],
      }));
      const frontEdges = patternModule.getPatternEdges(front);
      const backEdges = patternModule.getPatternEdges(back);
      const seams = [
        { id: "tube-top", first: { pieceId: front.id, edgeId: frontEdges[0].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[0].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
        { id: "tube-bottom", first: { pieceId: front.id, edgeId: frontEdges[2].id, startT: 0, endT: 1 }, second: { pieceId: back.id, edgeId: backEdges[2].id, startT: 0, endT: 1 }, direction: "opposite", easeRatio: 0, type: "standard", active: true },
      ];
      extras.forEach((piece, index) => {
        const host = index % 2 === 0 ? front : back;
        seams.push({
          id: `extra-seam-${index + 1}`,
          first: { pieceId: host.id, edgeId: patternModule.getPatternEdges(host)[1].id, startT: 0.2, endT: 0.8 },
          second: { pieceId: piece.id, edgeId: patternModule.getPatternEdges(piece)[3].id, startT: 0, endT: 1 },
          direction: "opposite", easeRatio: 0, type: "standard", active: true,
        });
      });
      return { ...blank, pieces: [front, back, ...extras], seams };
    };
    const genericFour = () => {
      const blank = blankModule.createBlankGarment();
      const colors = ["#c7ad79", "#667f86", "#8c5368", "#3f5f78"];
      const fabrics = colors.map((color, index) => ({
        ...blank.fabrics[0],
        id: `audit-fabric-${index + 1}`,
        name: `Tecido de auditoria ${index + 1}`,
        color,
      }));
      const pieces = Array.from({ length: 4 }, (_, index) => ({
        id: `generic-${index + 1}`, name: `Painel ${index + 1}`, seamAllowanceMm: 0, cutQuantity: 1,
        fabricId: fabrics[index].id,
        bodyPlacement: { ...placement(index, index % 2 === 0 ? "front" : "back"), offsetXMm: (index - 1.5) * 120 },
        points: [
          { id: `g${index}:a`, xMm: 0, yMm: 0 }, { id: `g${index}:b`, xMm: 80, yMm: 0 },
          { id: `g${index}:c`, xMm: 75, yMm: 140 }, { id: `g${index}:d`, xMm: 10, yMm: 140 },
        ],
      }));
      const seams = pieces.slice(0, -1).map((piece, index) => ({
        id: `generic-seam-${index + 1}`,
        first: { pieceId: piece.id, edgeId: patternModule.getPatternEdges(piece)[1].id, startT: 0, endT: 1 },
        second: { pieceId: pieces[index + 1].id, edgeId: patternModule.getPatternEdges(pieces[index + 1])[3].id, startT: 0, endT: 1 },
        direction: "opposite", easeRatio: 0, type: "intentional-mismatch", treatment: "intentional-mismatch", active: true,
      }));
      return { ...blank, fabrics, pieces, seams };
    };
    const garments = { "tube-only": tubeGarment(0), "tube-plus-one": tubeGarment(1), "tube-plus-two": tubeGarment(2), "four-generic": genericFour() };
    window.__intrinsicAuditGarments = garments;
    const results = {};
    const tubeCoordinates = {};
    for (const [name, garment] of Object.entries(garments)) {
      const input = inputModule.buildResolvedAssemblyInput(garment);
      const result = arrangementModule.buildSemanticAvatarArrangement(
        input,
        avatarModule.buildAvatarParametricModel(garment.measurements, garment.bodyType),
      );
      const metric = assemblyModule.measureIntrinsicDistortion(result.state);
      results[name] = {
        finite: result.state.positions.every(Number.isFinite),
        maxIntrinsicDistortion: metric.maxRelativeDistortion,
        maxAbsoluteDistortionM: metric.maxAbsoluteDistortionM,
        byInstance: metric.byInstance,
        seamGroupIds: input.seamGroups.map((group) => group.id),
        panels: result.state.instances.map((instance) => ({ id: instance.id, mapping: instance.arrangement?.mapping })),
        warnings: result.state.warnings,
        diagnostics: result.diagnostics,
      };
      tubeCoordinates[name] = result.state.instances
        .filter((instance) => instance.pieceId === "tube-front" || instance.pieceId === "tube-back")
        .flatMap((instance) => Array.from(result.state.positions.slice(instance.particleStart * 3, (instance.particleStart + instance.vertexCount) * 3)));
    }
    results.tubeCoordinateDeltaAfterOne = maximumDelta(tubeCoordinates["tube-only"], tubeCoordinates["tube-plus-one"]);
    results.tubeCoordinateDeltaAfterTwo = maximumDelta(tubeCoordinates["tube-only"], tubeCoordinates["tube-plus-two"]);
    return results;

    function maximumDelta(first, second) {
      return first.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - second[index])), 0);
    }
  });

  for (const name of ["tube-only", "tube-plus-one", "tube-plus-two", "four-generic"]) {
    await page.evaluate(async (scenario) => {
      const [viewportModule, inputModule] = await Promise.all([
        import("/src/viewport/GlobalThreeViewport.ts"),
        import("/src/garment3d/ResolvedAssemblyInput.ts"),
      ]);
      if (!window.__intrinsicAuditViewport) {
        document.body.innerHTML = "";
        const host = document.createElement("div");
        host.style.width = "100vw";
        host.style.height = "100vh";
        document.body.appendChild(host);
        window.__intrinsicAuditViewport = await viewportModule.ThreeViewport.create(host);
      }
      window.__intrinsicAuditViewport.updateGarment(
        inputModule.buildResolvedAssemblyInput(window.__intrinsicAuditGarments[scenario]),
      );
    }, name);
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(outputDir, `${name}.png`), fullPage: true });
  }

  if (consoleErrors.length > 0) throw new Error(`Erros no console: ${consoleErrors.join(" | ")}`);
  const output = { ...report, consoleErrors };
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(output, null, 2), "utf8");
  process.stdout.write(JSON.stringify(output, null, 2));
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
