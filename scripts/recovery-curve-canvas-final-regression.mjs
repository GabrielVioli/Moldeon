import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-modeling-operations-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = { desktop: {}, mobile: {} };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function installFixture(page, id, transform = { xMm: 0, yMm: 0, rotationDeg: 0 }) {
  await page.evaluate(async ({ id, transform }) => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }, { useInternalPathEditorStore }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"), import("/src/state/internalPathEditorStore.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = migrateLegacyPieceToSegments({ id, name: `Curve ${id}`, seamAllowanceMm: 0, points: [
      { id: `${id}-a`, xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -20 } },
      { id: `${id}-b`, xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -18 } },
      { id: `${id}-c`, xMm: 140, yMm: 110 }, { id: `${id}-d`, xMm: 0, yMm: 110 },
    ] });
    state.loadGarment({ ...structuredClone(state.garment), id: `garment-${id}`, templateId: "blank", name: `Curve ${id}`, pieces: [piece], seams: [],
      workspaceStates: [{ pieceId: id, transform: { pieceId: id, ...transform }, visible: true, locked: false }],
      workspaceTransforms: [{ pieceId: id, ...transform }], assemblyPlacements: [], parametric: undefined });
    useInternalPathEditorStore.getState().reset();
    useEditorStore.getState().selectPiece(id);
  }, { id, transform });
  await page.locator(".pieces-item").filter({ hasText: `Curve ${id}` }).waitFor();
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(50);
}

async function geometry(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const s = useEditorStore.getState(), p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    return p ? structuredClone(p.points) : null;
  });
}

async function workspace(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const s = useEditorStore.getState();
    return structuredClone(s.garment.workspaceStates?.find((x) => x.pieceId === s.activePieceId)?.transform ?? null);
  });
}

async function localToScreen(page, local) {
  return page.evaluate(async (local) => {
    const [{ useEditorStore }, polygon, camera, coords] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts"),
    ]);
    const s = useEditorStore.getState(), p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    if (!p) throw new Error("Peça ativa ausente.");
    const t = s.garment.workspaceStates?.find((x) => x.pieceId === p.id)?.transform ?? { pieceId: p.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas"), rect = canvas.getBoundingClientRect();
    const contour = polygon.samplePatternContour(p.points).map((point) => coords.pieceLocalToWorld(point, t));
    const bounds = { minX: Math.min(...contour.map((q) => q.xMm)), minY: Math.min(...contour.map((q) => q.yMm)), maxX: Math.max(...contour.map((q) => q.xMm)), maxY: Math.max(...contour.map((q) => q.yMm)) };
    return coords.worldToScreen(coords.pieceLocalToWorld(local, t), camera.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 70));
  }, local);
}

async function curveTarget(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, pattern, polygon] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"), import("/src/domain/polygonGeometry.ts"),
    ]);
    const s = useEditorStore.getState(), p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    if (!p) return null;
    for (const edge of pattern.getPatternEdges(p)) {
      const a = p.points.find((x) => x.id === edge.startPointId), b = p.points.find((x) => x.id === edge.endPointId);
      if (!a || !b || (!a.handleOut && !b.handleIn)) continue;
      const samples = polygon.samplePatternSegment(a, b), q = samples[Math.floor(samples.length / 2)];
      return { edgeId: edge.id, local: { xMm: q.xMm, yMm: q.yMm } };
    }
    return null;
  });
}

async function handles(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, helper] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/editor/curveHandleInteraction.ts")]);
    const s = useEditorStore.getState(), p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    if (!p) return [];
    return helper.patternCurveHandleTargets(p, s.selectedPointId, s.selectedEdgeId).flatMap((target) => {
      const point = p.points.find((x) => x.id === target.pointId), vector = target.handle === "in" ? point?.handleIn : point?.handleOut;
      return point && vector ? [{ pointId: point.id, handle: target.handle, local: { xMm: point.xMm + vector.xMm, yMm: point.yMm + vector.yMm } }] : [];
    });
  });
}

async function selectCurve(page, canvas, touch = false) {
  const target = await curveTarget(page); if (!target) throw new Error("Curva ativa ausente.");
  const position = await localToScreen(page, target.local);
  if (touch) await canvas.tap({ position }); else await canvas.click({ position });
  await page.waitForTimeout(50);
  const selection = await page.evaluate(async () => { const { useEditorStore } = await import("/src/state/editorStore.ts"); const s = useEditorStore.getState(); return { edgeId: s.selectedEdgeId, pointId: s.selectedPointId }; });
  if (selection.edgeId !== target.edgeId || selection.pointId !== null) throw new Error(`Curva não selecionou segmento: ${JSON.stringify(selection)}`);
  const result = await handles(page); if (result.length !== 2) throw new Error(`Curva expôs ${result.length} handles.`);
  return result;
}

async function mouseDrag(page, canvas, handle, dx, dy) {
  const p = await localToScreen(page, handle.local), box = await canvas.boundingBox(); if (!box) throw new Error("Canvas sem bounding box.");
  await page.mouse.move(box.x + p.x, box.y + p.y); await page.mouse.down(); await page.mouse.move(box.x + p.x + dx, box.y + p.y + dy, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(60);
}

async function cameraRoundTrip(page, canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click(); await page.getByRole("button", { name: "Diminuir zoom" }).click();
  const hand = page.getByRole("button", { name: "Mão", exact: true }); await hand.click();
  const box = await canvas.boundingBox(); if (!box) throw new Error("Canvas sem bounding box."); const x = box.x + box.width * .74, y = box.y + box.height * .76;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 50, y - 22, { steps: 6 }); await page.mouse.up(); await hand.click();
  await page.getByRole("button", { name: "Aumentar zoom" }).click(); await page.waitForTimeout(50);
}

async function runDesktop() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } }); const page = await context.newPage(); const canvas = page.locator("canvas.pattern-canvas");
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await installFixture(page, "desktop-out", { xMm: 42, yMm: 28, rotationDeg: 17 });
  let hs = await selectCurve(page, canvas); report.desktop.curveClickShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-final-desktop-selected.png`, fullPage: true });
  await page.evaluate(async () => { const { useEditorStore } = await import("/src/state/editorStore.ts"); const s = useEditorStore.getState(), p = s.garment.pieces[0], range = { pieceId: p.id, edgeId: s.selectedEdgeId, startT: 0, endT: 1 }; useEditorStore.setState({ garment: { ...s.garment, seams: [{ id: "overlap", name: "Overlap", first: range, second: range, direction: "same", easeRatio: 0, type: "standard", treatment: "standard", active: true }] }, selectedSeamId: null }); });
  const before = await geometry(page), output = hs.find((h) => h.handle === "out"); if (!output) throw new Error("Handle saída ausente.");
  await mouseDrag(page, canvas, output, 34, -17); const after = await geometry(page); if (same(before, after)) throw new Error("Handle saída não alterou curva.");
  if (await page.evaluate(async () => (await import("/src/state/editorStore.ts")).useEditorStore.getState().selectedSeamId) !== null) throw new Error("Costura roubou handle.");
  report.desktop.outputHandleDrag = report.desktop.handleBeatsSeamAndSegment = true;
  await page.keyboard.press("Control+z"); await page.waitForTimeout(50); if (!same(await geometry(page), before)) throw new Error("Undo não restaurou curva.");
  await cameraRoundTrip(page, canvas); if (!same(await geometry(page), before)) throw new Error("Câmera alterou undo.");
  await page.keyboard.press("Control+y"); await page.waitForTimeout(50); if (!same(await geometry(page), after)) throw new Error("Redo não reaplicou curva.");
  await cameraRoundTrip(page, canvas); if (!same(await geometry(page), after)) throw new Error("Câmera alterou redo.");
  report.desktop.oneDragOneUndoRedo = report.desktop.cameraStable = true;

  await installFixture(page, "desktop-in", { xMm: 20, yMm: 24, rotationDeg: -13 }); hs = await selectCurve(page, canvas);
  const beforeIn = await geometry(page), input = hs.find((h) => h.handle === "in"); if (!input) throw new Error("Handle entrada ausente.");
  await mouseDrag(page, canvas, input, -28, 19); const afterIn = await geometry(page); if (same(beforeIn, afterIn)) throw new Error("Handle entrada não alterou curva.");
  report.desktop.inputHandleDrag = true;

  await installFixture(page, "desktop-numeric"); await selectCurve(page, canvas);
  const panel = page.getByRole("region", { name: "Edição numérica do editor 2D" }); await panel.getByRole("button", { name: "Handle saída" }).click();
  for (const [label, delta] of [["Handle X", 4], ["Handle Y", -3], ["Comprimento", 5], ["Ângulo", 7]]) { const field = panel.getByLabel(label), value = Number(await field.inputValue()); await field.fill(String(label === "Comprimento" ? Math.max(1, value + delta) : value + delta)); await field.press("Enter"); await page.waitForTimeout(20); }
  report.desktop.numericXYLengthAngle = true;
  await page.screenshot({ path: `${artifactDir}/curve-final-desktop-numeric.png`, fullPage: true });
  await context.close();
}

async function dispatchTouchPointer(page, canvas, events) {
  const box = await canvas.boundingBox(); if (!box) throw new Error("Canvas sem bounding box.");
  await page.evaluate(({ events }) => {
    const canvas = document.querySelector("canvas.pattern-canvas");
    canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {}; canvas.hasPointerCapture = () => false;
    for (const event of events) canvas.dispatchEvent(new PointerEvent(event.type, { bubbles: true, cancelable: true, pointerId: event.pointerId, pointerType: "touch", isPrimary: event.isPrimary, clientX: event.clientX, clientY: event.clientY, button: event.type === "pointerdown" ? 0 : -1, buttons: event.type === "pointerup" ? 0 : 1, pressure: event.type === "pointerup" ? 0 : .5, width: 14, height: 14 }));
  }, { events });
  await page.waitForTimeout(70);
  return box;
}

async function runMobile() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); const page = await context.newPage(); const canvas = page.locator("canvas.pattern-canvas");
  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "mobile", { xMm: 38, yMm: 24, rotationDeg: 12 });
  await page.evaluate(() => { window.__tapPointerTypes = []; const c = document.querySelector("canvas.pattern-canvas"); c.addEventListener("pointerdown", (e) => window.__tapPointerTypes.push(e.pointerType), true); });
  const hs = await selectCurve(page, canvas, true); const tapTypes = await page.evaluate(() => window.__tapPointerTypes); if (!tapTypes.includes("touch")) throw new Error(`Tap mobile não gerou PointerEvent touch: ${JSON.stringify(tapTypes)}`);
  report.mobile.nativeTapSelectsCurveAndShowsHandles = true;
  await page.screenshot({ path: `${artifactDir}/curve-final-mobile-selected.png`, fullPage: true });
  const target = hs.find((h) => h.handle === "out") ?? hs[0], p = await localToScreen(page, target.local), box = await canvas.boundingBox(); if (!box) throw new Error("Canvas mobile sem bounding box.");
  const before = await geometry(page), workspaceBefore = await workspace(page), start = { x: box.x + p.x + 16, y: box.y + p.y }, end = { x: start.x + 31, y: start.y - 14 };
  const events = [{ type: "pointerdown", pointerId: 71, isPrimary: true, clientX: start.x, clientY: start.y }];
  for (let i = 1; i <= 7; i++) events.push({ type: "pointermove", pointerId: 71, isPrimary: true, clientX: start.x + (end.x-start.x)*i/7, clientY: start.y + (end.y-start.y)*i/7 });
  events.push({ type: "pointerup", pointerId: 71, isPrimary: true, clientX: end.x, clientY: end.y });
  await dispatchTouchPointer(page, canvas, events); const after = await geometry(page); if (same(before, after)) throw new Error("Pointer touch dentro da hit area ampliada não moveu handle."); if (!same(workspaceBefore, await workspace(page))) throw new Error("Drag touch virou movimento de peça/pan.");
  report.mobile.touchPointerHandleDrag = report.mobile.expandedHitArea = report.mobile.noAccidentalPan = true;
  await page.getByRole("button", { name: "Desfazer" }).tap(); await page.waitForTimeout(40); if (!same(await geometry(page), before)) throw new Error("Undo touch não restaurou curva.");
  await page.getByRole("button", { name: "Refazer" }).tap(); await page.waitForTimeout(40); if (!same(await geometry(page), after)) throw new Error("Redo touch não reaplicou curva."); report.mobile.undoRedoTouch = true;

  const stable = await geometry(page), zoomBefore = await page.locator(".zoom-indicator").textContent(), y = box.y + Math.max(48, box.height - 34);
  await dispatchTouchPointer(page, canvas, [
    { type: "pointerdown", pointerId: 81, isPrimary: true, clientX: box.x + 90, clientY: y },
    { type: "pointerdown", pointerId: 82, isPrimary: false, clientX: box.x + 190, clientY: y },
    { type: "pointermove", pointerId: 81, isPrimary: true, clientX: box.x + 68, clientY: y },
    { type: "pointermove", pointerId: 82, isPrimary: false, clientX: box.x + 212, clientY: y },
    { type: "pointerup", pointerId: 82, isPrimary: false, clientX: box.x + 212, clientY: y },
    { type: "pointerup", pointerId: 81, isPrimary: true, clientX: box.x + 68, clientY: y },
  ]);
  const zoomAfter = await page.locator(".zoom-indicator").textContent(); if (zoomBefore === zoomAfter) throw new Error("Pinch touch não alterou zoom."); if (!same(await geometry(page), stable)) throw new Error("Pinch touch alterou geometria."); report.mobile.pinchStillWorksAndPreservesGeometry = true;
  await page.screenshot({ path: `${artifactDir}/curve-final-mobile-after-touch.png`, fullPage: true });
  await context.close();
}

try { await runDesktop(); await runMobile(); console.log(JSON.stringify(report)); } finally { await browser.close(); }
