import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function localToScreen(local) {
  return page.evaluate(async (local) => {
    const [{ useEditorStore }, polygon, camera, coords] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts"),
    ]);
    const s = useEditorStore.getState(), p = s.garment.pieces[0], t = s.garment.workspaceStates[0].transform;
    const canvas = document.querySelector("canvas.pattern-canvas"), rect = canvas.getBoundingClientRect();
    const contour = polygon.samplePatternContour(p.points).map((point) => coords.pieceLocalToWorld(point, t));
    const bounds = { minX: Math.min(...contour.map((p) => p.xMm)), minY: Math.min(...contour.map((p) => p.yMm)), maxX: Math.max(...contour.map((p) => p.xMm)), maxY: Math.max(...contour.map((p) => p.yMm)) };
    const fit = camera.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 70);
    return coords.worldToScreen(coords.pieceLocalToWorld(local, t), fit);
  }, local);
}

async function setup() {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts")]);
    const state = useEditorStore.getState();
    const piece = migrateLegacyPieceToSegments({ id: "touch-v2", name: "Touch v2", seamAllowanceMm: 0, points: [
      { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -20 } },
      { id: "b", xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -18 } },
      { id: "c", xMm: 140, yMm: 110 }, { id: "d", xMm: 0, yMm: 110 },
    ] });
    state.loadGarment({ ...structuredClone(state.garment), id: "touch-v2-g", templateId: "blank", name: "Touch v2", pieces: [piece], seams: [], workspaceStates: [{ pieceId: piece.id, transform: { pieceId: piece.id, xMm: 38, yMm: 24, rotationDeg: 12 }, visible: true, locked: false }], workspaceTransforms: [{ pieceId: piece.id, xMm: 38, yMm: 24, rotationDeg: 12 }], assemblyPlacements: [], parametric: undefined });
    useEditorStore.getState().selectPiece(piece.id);
  });
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(50);
  const canvas = page.locator("canvas.pattern-canvas");
  const curve = await page.evaluate(async () => {
    const [{ useEditorStore }, polygon] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts")]);
    const p = useEditorStore.getState().garment.pieces[0], samples = polygon.samplePatternSegment(p.points[0], p.points[1]), q = samples[Math.floor(samples.length / 2)];
    return { xMm: q.xMm, yMm: q.yMm };
  });
  await canvas.tap({ position: await localToScreen(curve) });
  await page.waitForTimeout(50);
  const handle = await page.evaluate(async () => {
    const [{ useEditorStore }, helper] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/editor/curveHandleInteraction.ts")]);
    const s = useEditorStore.getState(), p = s.garment.pieces[0], target = helper.patternCurveHandleTargets(p, s.selectedPointId, s.selectedEdgeId).find((x) => x.handle === "out"), point = p.points.find((x) => x.id === target.pointId), v = point.handleOut;
    return { local: { xMm: point.xMm + v.xMm, yMm: point.yMm + v.yMm }, radius: helper.curveHandleHitRadiusPx("touch") };
  });
  await page.evaluate(() => {
    window.__curveTouchEvents = [];
    const canvas = document.querySelector("canvas.pattern-canvas");
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel"]) {
      canvas.addEventListener(type, (event) => window.__curveTouchEvents.push({ type, pointerType: event.pointerType ?? null, clientX: event.clientX ?? null, clientY: event.clientY ?? null, touches: event.touches?.length ?? null }), true);
    }
  });
  return { canvas, handle };
}

async function geometry() {
  return page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].points));
}

async function drag(start, end) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x, y: start.y, radiusX: 7, radiusY: 7, force: 1 }] });
  for (let i = 1; i <= 6; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x-start.x)*i/6, y: start.y + (end.y-start.y)*i/6, radiusX: 7, radiusY: 7, force: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
}

try {
  const { canvas, handle } = await setup();
  const position = await localToScreen(handle.local), box = await canvas.boundingBox();
  const before = await geometry();
  const start = { x: box.x + position.x, y: box.y + position.y };
  await drag(start, { x: start.x + 31, y: start.y - 14 });
  const after = await geometry();
  console.log(JSON.stringify({ radiusTouch: handle.radius, changed: !same(before, after), events: await page.evaluate(() => window.__curveTouchEvents) }));
} finally {
  await browser.close();
}
