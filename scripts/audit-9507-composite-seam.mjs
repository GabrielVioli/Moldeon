import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const port = 5186;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = resolve("artifacts/recovery-9-5-07-composite-seam");
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
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: "pt-BR" });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const fixture = await page.evaluate(async () => {
    const [{ createBlankGarment }, { createDefaultFabricSource }, pattern, { useEditorStore }] = await Promise.all([
      import("/src/domain/blankGarment.ts"),
      import("/src/domain/fabric.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/state/editorStore.ts"),
    ]);
    const long = {
      id: "long-side", name: "Lado contínuo", seamAllowanceMm: 0,
      points: [
        { id: "long:0", xMm: 0, yMm: 0 }, { id: "long:1", xMm: 569.4, yMm: 0 },
        { id: "long:2", xMm: 569.4, yMm: 100 }, { id: "long:3", xMm: 0, yMm: 100 },
      ],
    };
    const split = {
      id: "split-side", name: "Lado em dois trechos", seamAllowanceMm: 0,
      points: [
        { id: "split:0", xMm: 0, yMm: 0 }, { id: "split:1", xMm: 284.1, yMm: 0 },
        { id: "split:2", xMm: 569.4, yMm: 0 }, { id: "split:3", xMm: 569.4, yMm: 100 },
        { id: "split:4", xMm: 0, yMm: 100 },
      ],
    };
    const fabric = createDefaultFabricSource();
    const garment = {
      ...createBlankGarment(),
      fabrics: [fabric],
      pieces: [{ ...long, fabricId: fabric.id }, { ...split, fabricId: fabric.id }],
      workspaceStates: [
        { pieceId: long.id, transform: { pieceId: long.id, xMm: 0, yMm: 0, rotationDeg: 0 }, visible: true, locked: false },
        { pieceId: split.id, transform: { pieceId: split.id, xMm: 0, yMm: 180, rotationDeg: 0 }, visible: true, locked: false },
      ],
    };
    useEditorStore.getState().loadGarment(garment);
    const first = pattern.getPatternEdges(long)[0];
    const secondEdges = pattern.getPatternEdges(split).slice(0, 2);
    return {
      first: { pieceId: long.id, edgeId: first.id, startT: 0, endT: 1 },
      second: secondEdges.map((edge) => ({ pieceId: split.id, edgeId: edge.id, startT: 0, endT: 1 })),
    };
  });

  await page.evaluate((range) => window.__auditRange = range, fixture);
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    useEditorStore.getState().addSeamDraftRange(window.__auditRange.first);
  });
  await page.screenshot({ path: resolve(outputDir, "side-a.png"), fullPage: true });
  await page.getByRole("button", { name: "Concluir lado A" }).click();
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    for (const range of window.__auditRange.second) useEditorStore.getState().addSeamDraftRange(range);
  });
  await page.screenshot({ path: resolve(outputDir, "side-b-composed.png"), fullPage: true });
  await page.getByRole("button", { name: "Revisar costura" }).click();
  const reviewText = await page.locator(".context-bar").innerText();
  await page.screenshot({ path: resolve(outputDir, "review-total.png"), fullPage: true });
  await page.getByRole("button", { name: "Confirmar costura" }).click();

  const report = await page.evaluate(async () => {
    const [{ useEditorStore }, pattern, documentModule] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/domain/patternDocumentV3.ts"),
    ]);
    const state = useEditorStore.getState();
    const seam = state.garment.seams[0];
    const beforeUndo = structuredClone(seam);
    const firstRanges = pattern.seamSideRanges(seam, "first");
    const secondRanges = pattern.seamSideRanges(seam, "second");
    const lengths = {
      first: pattern.edgeRangeSequenceLength(state.garment.pieces, firstRanges),
      second: pattern.edgeRangeSequenceLength(state.garment.pieces, secondRanges),
    };
    const document = documentModule.garmentDraftToPatternDocumentV3(state.garment);
    state.undo();
    const afterUndoCount = useEditorStore.getState().garment.seams?.length ?? 0;
    useEditorStore.getState().redo();
    const afterRedo = useEditorStore.getState().garment.seams[0];
    return {
      firstRangeCount: firstRanges.length,
      secondRangeCount: secondRanges.length,
      lengths,
      differenceMm: Math.abs(lengths.first - lengths.second),
      canonicalCounts: [document.seamGroups[0].first.length, document.seamGroups[0].second.length],
      canonicalOrder: document.seamGroups[0].second.map((range) => range.edgeId),
      afterUndoCount,
      redoExact: JSON.stringify(afterRedo) === JSON.stringify(beforeUndo),
      seamIssues: useEditorStore.getState().seamIssues,
    };
  });
  report.reviewText = reviewText;
  report.consoleErrors = consoleErrors;
  if (report.firstRangeCount !== 1 || report.secondRangeCount !== 2) throw new Error("Composição 1↔2 não foi preservada.");
  if (report.differenceMm > 0.01) throw new Error(`Diferença acumulada inesperada: ${report.differenceMm}`);
  if (report.afterUndoCount !== 0 || !report.redoExact) throw new Error("Undo/redo não preservou a costura composta.");
  if (report.seamIssues.length > 0 || consoleErrors.length > 0) throw new Error("Diagnósticos inesperados no navegador.");
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.kill();
  server.stdout?.destroy();
  server.stderr?.destroy();
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Servidor local não iniciou.");
}
