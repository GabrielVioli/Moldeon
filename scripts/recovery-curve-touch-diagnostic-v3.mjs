import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function localToScreen(local) {
  return page.evaluate(async (local) => {
    const [{ useEditorStore }, polygon, camera, coords] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts")]);
    const s = useEditorStore.getState(), p = s.garment.pieces[0], t = s.garment.workspaceStates[0].transform, canvas = document.querySelector("canvas.pattern-canvas"), rect = canvas.getBoundingClientRect();
    const contour = polygon.samplePatternContour(p.points).map((point) => coords.pieceLocalToWorld(point, t));
    const bounds = { minX: Math.min(...contour.map((p) => p.xMm)), minY: Math.min(...contour.map((p) => p.yMm)), maxX: Math.max(...contour.map((p) => p.xMm)), maxY: Math.max(...contour.map((p) => p.yMm)) };
    return coords.worldToScreen(coords.pieceLocalToWorld(local, t), camera.cameraToFitBounds(bounds, { width: rect.width, height: rect.height }, 70));
  }, local);
}

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  const [{ useEditorStore }, { migrateLegacyPieceToSegments }] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts")]);
  const state = useEditorStore.getState();
  const piece = migrateLegacyPieceToSegments({ id: "touch-v3", name: "Touch v3", seamAllowanceMm: 0, points: [
    { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -20 } },
    { id: "b", xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -18 } },
    { id: "c", xMm: 140, yMm: 110 }, { id: "d", xMm: 0, yMm: 110 },
  ] });
  state.loadGarment({ ...structuredClone(state.garment), id: "touch-v3-g", templateId: "blank", name: "Touch v3", pieces: [piece], seams: [], workspaceStates: [{ pieceId: piece.id, transform: { pieceId: piece.id, xMm: 38, yMm: 24, rotationDeg: 12 }, visible: true, locked: false }], workspaceTransforms: [{ pieceId: piece.id, xMm: 38, yMm: 24, rotationDeg: 12 }], assemblyPlacements: [], parametric: undefined });
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
  return { xMm: point.xMm + v.xMm, yMm: point.yMm + v.yMm };
});
await page.evaluate(() => {
  window.__curveTouchEvents = [];
  const canvas = document.querySelector("canvas.pattern-canvas");
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "mousedown", "mousemove", "mouseup"]) {
    canvas.addEventListener(type, (event) => window.__curveTouchEvents.push({ type, pointerType: event.pointerType ?? null, clientX: event.clientX ?? null, clientY: event.clientY ?? null, touches: event.touches?.length ?? null }), true);
  }
});
const position = await localToScreen(handle), box = await canvas.boundingBox();
const start = { x: box.x + position.x, y: box.y + position.y };
const before = await page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].points));
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
for (let i = 1; i <= 6; i += 1) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x + 31*i/6, y: start.y - 14*i/6, button: "left", buttons: 1 });
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + 31, y: start.y - 14, button: "left", buttons: 0, clickCount: 1 });
await page.waitForTimeout(80);
const after = await page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].points));
console.log(JSON.stringify({ changed: !same(before, after), events: await page.evaluate(() => window.__curveTouchEvents) }));
await browser.close();
