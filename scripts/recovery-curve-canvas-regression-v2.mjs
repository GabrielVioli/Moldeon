import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const artifactDir = process.env.RECOVERY_ARTIFACT_DIR ?? "artifacts/recovery-modeling-operations-live";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = { desktop: {}, mobile: {} };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function installFixture(page, id, curve = "top", transform = { xMm: 0, yMm: 0, rotationDeg: 0 }) {
  await page.evaluate(async ({ id, curve, transform }) => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const points = curve === "top" ? [
      { id: `${id}-a`, xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -18 } },
      { id: `${id}-b`, xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -20 } },
      { id: `${id}-c`, xMm: 140, yMm: 110 }, { id: `${id}-d`, xMm: 0, yMm: 110 },
    ] : curve === "left" ? [
      { id: `${id}-a`, xMm: 0, yMm: 0, handleIn: { xMm: -24, yMm: 28 } },
      { id: `${id}-b`, xMm: 140, yMm: 0 }, { id: `${id}-c`, xMm: 140, yMm: 110 },
      { id: `${id}-d`, xMm: 0, yMm: 110, handleOut: { xMm: -24, yMm: -28 } },
    ] : [
      { id: `${id}-a`, xMm: 0, yMm: 0 }, { id: `${id}-b`, xMm: 140, yMm: 0 },
      { id: `${id}-c`, xMm: 140, yMm: 110 }, { id: `${id}-d`, xMm: 0, yMm: 110 },
    ];
    const fabricId = state.garment.fabrics[0]?.id;
    const piece = migrateLegacyPieceToSegments({ id, name: `Curve fixture ${id}`, seamAllowanceMm: 0, ...(fabricId ? { fabricId } : {}), points });
    state.loadGarment({ ...structuredClone(state.garment), id: `garment-${id}`, templateId: "blank", name: `Curve regression ${id}`,
      pieces: [piece], seams: [], workspaceStates: [{ pieceId: id, transform: { pieceId: id, ...transform }, visible: true, locked: false }],
      workspaceTransforms: [{ pieceId: id, ...transform }], assemblyPlacements: [], parametric: undefined });
    useEditorStore.getState().selectPiece(id);
  }, { id, curve, transform });
  await page.locator(".pieces-item").filter({ hasText: `Curve fixture ${id}` }).waitFor();
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(60);
}

async function geometry(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const s = useEditorStore.getState();
    const p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    return p ? { id: p.id, points: structuredClone(p.points) } : null;
  });
}

async function workspace(page) {
  return page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts");
    const s = useEditorStore.getState();
    return structuredClone(s.garment.workspaceStates?.find((x) => x.pieceId === s.activePieceId)?.transform ?? null);
  });
}

async function screen(page, local) {
  return page.evaluate(async (local) => {
    const [{ useEditorStore }, polygon, camera, coords] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts"),
    ]);
    const s = useEditorStore.getState();
    const p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    if (!p) throw new Error("Peça ativa ausente");
    const t = s.garment.workspaceStates?.find((x) => x.pieceId === p.id)?.transform ?? { pieceId: p.id, xMm: 0, yMm: 0, rotationDeg: 0 };
    const canvas = document.querySelector("canvas.pattern-canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Canvas ausente");
    const r = canvas.getBoundingClientRect();
    const contour = polygon.samplePatternContour(p.points).map((x) => coords.pieceLocalToWorld(x, t));
    const bounds = { minX: Math.min(...contour.map((x) => x.xMm)), minY: Math.min(...contour.map((x) => x.yMm)), maxX: Math.max(...contour.map((x) => x.xMm)), maxY: Math.max(...contour.map((x) => x.yMm)) };
    const c = camera.cameraToFitBounds(bounds, { width: r.width, height: r.height }, 70);
    return coords.worldToScreen(coords.pieceLocalToWorld(local, t), c);
  }, local);
}

async function curveInfo(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, pattern, polygon] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"), import("/src/domain/polygonGeometry.ts"),
    ]);
    const s = useEditorStore.getState();
    const p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    if (!p) return null;
    for (const e of pattern.getPatternEdges(p)) {
      const a = p.points.find((x) => x.id === e.startPointId); const b = p.points.find((x) => x.id === e.endPointId);
      if (!a || !b || (!a.handleOut && !b.handleIn)) continue;
      const samples = polygon.samplePatternSegment(a, b); const q = samples[Math.max(1, Math.floor(samples.length * .34))];
      return { edgeId: e.id, sample: { xMm: q.xMm, yMm: q.yMm } };
    }
    return null;
  });
}

async function handleTargets(page) {
  return page.evaluate(async () => {
    const [{ useEditorStore }, helper] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/editor/curveHandleInteraction.ts")]);
    const s = useEditorStore.getState(); const p = s.garment.pieces.find((x) => x.id === s.activePieceId); if (!p) return [];
    return helper.patternCurveHandleTargets(p, s.selectedPointId, s.selectedEdgeId).map((t) => {
      const n = p.points.find((x) => x.id === t.pointId); const v = t.handle === "in" ? n?.handleIn : n?.handleOut;
      return n && v ? { pointId: n.id, handle: t.handle, endpoint: { xMm: n.xMm + v.xMm, yMm: n.yMm + v.yMm } } : null;
    }).filter(Boolean);
  });
}

async function selectCurve(page, canvas, touch = false) {
  await page.getByRole("button", { name: "Enquadrar seleção" })[touch ? "tap" : "click"]();
  await page.waitForTimeout(40);
  const c = await curveInfo(page); if (!c) throw new Error("Curva ativa ausente");
  const pos = await screen(page, c.sample); await canvas[touch ? "tap" : "click"]({ position: pos }); await page.waitForTimeout(50);
  const selected = await page.evaluate(async () => { const { useEditorStore } = await import("/src/state/editorStore.ts"); const s = useEditorStore.getState(); return { edge: s.selectedEdgeId, point: s.selectedPointId }; });
  if (selected.edge !== c.edgeId || selected.point !== null) throw new Error(`Curva não selecionada: ${JSON.stringify(selected)}`);
  const handles = await handleTargets(page); if (handles.length !== 2) throw new Error(`Esperados 2 handles, obtido ${handles.length}`);
  return handles;
}

async function mouseDrag(page, canvas, target, dx, dy) {
  const p = await screen(page, target.endpoint); const b = await canvas.boundingBox(); if (!b) throw new Error("Canvas sem caixa");
  await page.mouse.move(b.x + p.x, b.y + p.y); await page.mouse.down(); await page.mouse.move(b.x + p.x + dx, b.y + p.y + dy, { steps: 7 }); await page.mouse.up(); await page.waitForTimeout(60);
}

async function navigate(page, canvas) {
  await page.getByRole("button", { name: "Aumentar zoom" }).click(); await page.getByRole("button", { name: "Diminuir zoom" }).click();
  const hand = page.getByRole("button", { name: "Mão", exact: true }); await hand.click(); const b = await canvas.boundingBox(); if (!b) throw new Error("Canvas sem caixa");
  const x = b.x + b.width * .74, y = b.y + b.height * .76; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 48, y - 20, { steps: 5 }); await page.mouse.up(); await hand.click();
  await page.getByRole("button", { name: "Aumentar zoom" }).click(); await page.waitForTimeout(50);
}

async function injectOverlapSeam(page) {
  await page.evaluate(async () => {
    const { useEditorStore } = await import("/src/state/editorStore.ts"); const s = useEditorStore.getState(); const p = s.garment.pieces.find((x) => x.id === s.activePieceId);
    if (!p || !s.selectedEdgeId) throw new Error("Sem curva selecionada"); const r = { pieceId: p.id, edgeId: s.selectedEdgeId, startT: 0, endT: 1 };
    useEditorStore.setState({ garment: { ...s.garment, seams: [{ id: "overlap", name: "Overlap", first: r, second: r, direction: "same", easeRatio: 0, type: "standard", treatment: "standard", active: true }] }, selectedSeamId: null });
  });
}

async function assertEditableOrigin(page, canvas, label) {
  const hs = await selectCurve(page, canvas); const before = await geometry(page); await mouseDrag(page, canvas, hs[0], 21, -12); const after = await geometry(page);
  if (same(before, after)) throw new Error(`${label} não permaneceu editável`); return true;
}

async function runDesktop() {
  const context = await browser.newContext({ viewport: { width: 1366, height: 820 } }); const page = await context.newPage(); const canvas = page.locator("canvas.pattern-canvas"); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "existing", "top", { xMm: 48, yMm: 32, rotationDeg: 17 });
  let hs = await selectCurve(page, canvas); report.desktop.curveSelectShowsHandles = true; await page.screenshot({ path: `${artifactDir}/curve-handles-desktop.png`, fullPage: true });
  await injectOverlapSeam(page);
  const beforeOut = await geometry(page); const inputBefore = beforeOut.points.find((x) => x.id === hs.find((h) => h.handle === "in").pointId).handleIn;
  await mouseDrag(page, canvas, hs.find((h) => h.handle === "out"), 34, -17); const afterOut = await geometry(page); if (same(beforeOut, afterOut)) throw new Error("Handle saída não moveu");
  const inputAfter = afterOut.points.find((x) => x.id === hs.find((h) => h.handle === "in").pointId).handleIn; if (!same(inputBefore, inputAfter)) throw new Error("Handle saída alterou entrada");
  const seam = await page.evaluate(async () => (await import("/src/state/editorStore.ts")).useEditorStore.getState().selectedSeamId); if (seam) throw new Error("Costura roubou handle");
  report.desktop.outputHandle = report.desktop.seamPriority = true;

  await page.keyboard.press("Control+z"); await page.waitForTimeout(50); if (!same(await geometry(page), beforeOut)) throw new Error("Um undo não restaurou drag");
  await navigate(page, canvas); if (!same(await geometry(page), beforeOut)) throw new Error("Câmera alterou undo");
  await page.keyboard.press("Control+y"); await page.waitForTimeout(50); if (!same(await geometry(page), afterOut)) throw new Error("Redo não reaplicou drag");
  await navigate(page, canvas); if (!same(await geometry(page), afterOut)) throw new Error("Câmera alterou redo"); report.desktop.undoRedoCameraStable = true;

  hs = await selectCurve(page, canvas); const beforeIn = await geometry(page); await mouseDrag(page, canvas, hs.find((h) => h.handle === "in"), -27, 19); const afterIn = await geometry(page); if (same(beforeIn, afterIn)) throw new Error("Handle entrada não moveu");
  await navigate(page, canvas); if (!same(await geometry(page), afterIn)) throw new Error("Zoom/pan alterou curva editada"); report.desktop.inputHandle = report.desktop.editedCurveCameraStable = true;

  await selectCurve(page, canvas); const panel = page.getByRole("region", { name: "Edição numérica do editor 2D" }); await panel.getByRole("button", { name: "Handle saída" }).click();
  for (const [label, delta] of [["Handle X", 4], ["Handle Y", -3], ["Comprimento", 5], ["Ângulo", 7]]) { const f = panel.getByLabel(label); const v = Number(await f.inputValue()); await f.fill(String(label === "Comprimento" ? Math.max(1, v + delta) : v + delta)); await f.press("Enter"); await page.waitForTimeout(20); }
  report.desktop.numericXYLengthAngle = true;

  const g = await geometry(page); const a = g.points[0], b = g.points[1]; await canvas.dblclick({ position: await screen(page, { xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 }) });
  await page.getByRole("alert").filter({ hasText: "Arraste os handles no Canvas" }).waitFor({ state: "visible" }); report.desktop.contextMessage = true;

  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "manual", "none"); await canvas.click({ position: await screen(page, { xMm: 48, yMm: 0 }) }); await page.waitForTimeout(40);
  await page.getByRole("region", { name: "Edição numérica do editor 2D" }).getByRole("button", { name: "Converter" }).click(); await page.waitForTimeout(50); if ((await handleTargets(page)).length !== 2) throw new Error("Converter não expôs handles");
  await assertEditableOrigin(page, canvas, "Curva manual"); report.desktop.manualCurve = true;

  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "duplicate", "top"); await page.getByRole("button", { name: "Duplicar", exact: true }).click(); await page.waitForTimeout(50); await assertEditableOrigin(page, canvas, "Curva duplicada"); report.desktop.duplicateCurve = true;
  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "mirror", "top"); await page.getByRole("button", { name: "Espelhar no eixo vertical" }).click(); await page.waitForTimeout(50); await assertEditableOrigin(page, canvas, "Curva espelhada"); report.desktop.mirrorCurve = true;

  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "cut", "left"); await page.getByRole("button", { name: "Recortar" }).click();
  await canvas.click({ position: await screen(page, { xMm: 70, yMm: 1 }) }); await canvas.click({ position: await screen(page, { xMm: 70, yMm: 109 }) }); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Aplicar corte" }).waitFor({ state: "visible" }); await page.getByRole("button", { name: "Aplicar corte" }).click(); await page.waitForTimeout(80);
  const result = await page.evaluate(async () => { const { useEditorStore } = await import("/src/state/editorStore.ts"); const s = useEditorStore.getState(); const p = s.garment.pieces.find((x) => x.points.some((n) => n.handleIn || n.handleOut)); if (!p) return null; useEditorStore.getState().selectPiece(p.id); return p.id; });
  if (!result) throw new Error("Recorte não preservou curva"); await assertEditableOrigin(page, canvas, "Curva pós-recorte"); report.desktop.cutCurve = true;

  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "internal", "none");
  await page.evaluate(async () => { const [{ useEditorStore }, { useInternalPathEditorStore }] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/state/internalPathEditorStore.ts")]); const s = useEditorStore.getState(); const p = s.garment.pieces[0]; const path = { id: "internal-cubic", pieceId: p.id, name: "Internal cubic", purpose: "reference", visible: true, locked: false, metadata: {}, nodes: [{ id: "ia", xMm: 30, yMm: 52, handleOut: { xMm: 24, yMm: -24 } }, { id: "ib", xMm: 108, yMm: 58, handleIn: { xMm: -22, yMm: 22 } }], segments: [{ id: "is", startNodeId: "ia", endNodeId: "ib", kind: "cubic" }] }; useEditorStore.setState({ garment: { ...s.garment, pieces: [{ ...p, internalLines: [path] }] } }); useInternalPathEditorStore.getState().reset(); });
  const sample = await page.evaluate(async () => { const [{ useEditorStore }, { sampleInternalPath }] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/internalPaths.ts")]); const path = useEditorStore.getState().garment.pieces[0].internalLines[0]; const pts = sampleInternalPath(path); return pts[Math.floor(pts.length / 2)]; });
  await canvas.click({ position: await screen(page, sample) }); await page.waitForTimeout(50);
  const ih = await page.evaluate(async () => { const [{ useEditorStore }, { useInternalPathEditorStore }, helper] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/state/internalPathEditorStore.ts"), import("/src/editor/curveHandleInteraction.ts")]); const e = useEditorStore.getState(), i = useInternalPathEditorStore.getState(), path = e.garment.pieces[0].internalLines[0]; return helper.internalCurveHandleTargets(path, i.selectedNodeId, i.selectedSegmentId).map((t) => { const n = path.nodes.find((x) => x.id === t.nodeId), v = t.handle === "in" ? n.handleIn : n.handleOut; return { endpoint: { xMm: n.xMm + v.xMm, yMm: n.yMm + v.yMm } }; }); });
  if (ih.length !== 2) throw new Error("Curva interna não expôs handles"); await page.screenshot({ path: `${artifactDir}/curve-internal-handles-desktop.png`, fullPage: true });
  const ibefore = await page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].internalLines[0])); const ip = await screen(page, ih[0].endpoint), box = await canvas.boundingBox();
  await page.mouse.move(box.x + ip.x, box.y + ip.y); await page.mouse.down(); await page.mouse.move(box.x + ip.x + 25, box.y + ip.y - 14, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(50);
  const iafter = await page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].internalLines[0])); if (same(ibefore, iafter)) throw new Error("Handle interno não moveu"); report.desktop.internalCubic = true;

  if (errors.length) throw new Error(errors.join(" | ")); await context.close();
}

async function touchDrag(cdp, a, b) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y, radiusX: 7, radiusY: 7, force: 1 }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + (b.x-a.x)*i/6, y: a.y + (b.y-a.y)*i/6, radiusX: 7, radiusY: 7, force: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function runMobile() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); const page = await context.newPage(); const cdp = await context.newCDPSession(page); const canvas = page.locator("canvas.pattern-canvas"); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(baseURL, { waitUntil: "networkidle" }); await installFixture(page, "mobile", "top", { xMm: 42, yMm: 26, rotationDeg: 13 });
  const hs = await selectCurve(page, canvas, true); await page.screenshot({ path: `${artifactDir}/curve-handles-mobile.png`, fullPage: true }); report.mobile.tapShowsHandles = true;
  const before = await geometry(page), wb = await workspace(page), h = hs.find((x) => x.handle === "out") ?? hs[0], p = await screen(page, h.endpoint), box = await canvas.boundingBox();
  const start = { x: box.x + p.x + 16, y: box.y + p.y }, end = { x: box.x + p.x + 47, y: box.y + p.y - 14 }; await touchDrag(cdp, start, end); await page.waitForTimeout(70);
  const after = await geometry(page); if (same(before, after)) throw new Error("Touch fora do desenho mas dentro da hit area não moveu handle"); if (!same(wb, await workspace(page))) throw new Error("Touch do handle virou movimento de peça");
  report.mobile.expandedHitArea = report.mobile.handleDrag = report.mobile.noAccidentalPiecePan = true;
  await page.getByRole("button", { name: "Desfazer" }).tap(); await page.waitForTimeout(50); if (!same(await geometry(page), before)) throw new Error("Undo touch falhou"); await page.getByRole("button", { name: "Refazer" }).tap(); await page.waitForTimeout(50); if (!same(await geometry(page), after)) throw new Error("Redo touch falhou"); report.mobile.undoRedo = true;
  const geometryBeforePinch = await geometry(page); const zoomBefore = await page.locator(".zoom-indicator").textContent(); const y = box.y + Math.max(45, box.height - 35);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 90, y, radiusX: 7, radiusY: 7, force: 1 }, { x: box.x + 185, y, radiusX: 7, radiusY: 7, force: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 72, y, radiusX: 7, radiusY: 7, force: 1 }, { x: box.x + 205, y, radiusX: 7, radiusY: 7, force: 1 }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(80);
  const zoomAfter = await page.locator(".zoom-indicator").textContent(); if (zoomBefore === zoomAfter) throw new Error("Pinch não alterou zoom"); if (!same(await geometry(page), geometryBeforePinch)) throw new Error("Pinch alterou geometria"); report.mobile.pinch = report.mobile.pinchGeometryStable = true;
  await page.screenshot({ path: `${artifactDir}/curve-handles-mobile-after-touch.png`, fullPage: true }); if (errors.length) throw new Error(errors.join(" | ")); await context.close();
}

try { await runDesktop(); await runMobile(); console.log(JSON.stringify(report)); } finally { await browser.close(); }
