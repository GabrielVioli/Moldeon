import { chromium } from "playwright-core";

const baseURL = process.env.RECOVERY_BASE_URL ?? "http://127.0.0.1:4180";
const executablePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

async function setup() {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const [{ useEditorStore }, { migrateLegacyPieceToSegments }] = await Promise.all([
      import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = migrateLegacyPieceToSegments({ id: "touch-diag", name: "Touch diag", seamAllowanceMm: 0, points: [
      { id: "a", xMm: 0, yMm: 0, handleOut: { xMm: 36, yMm: -20 } },
      { id: "b", xMm: 140, yMm: 0, handleIn: { xMm: -34, yMm: -18 } },
      { id: "c", xMm: 140, yMm: 110 }, { id: "d", xMm: 0, yMm: 110 },
    ] });
    state.loadGarment({ ...structuredClone(state.garment), id: "touch-diag-garment", templateId: "blank", name: "Touch diag", pieces: [piece], seams: [], workspaceStates: [{ pieceId: piece.id, transform: { pieceId: piece.id, xMm: 38, yMm: 24, rotationDeg: 12 }, visible: true, locked: false }], workspaceTransforms: [{ pieceId: piece.id, xMm: 38, yMm: 24, rotationDeg: 12 }], assemblyPlacements: [], parametric: undefined });
    useEditorStore.getState().selectPiece(piece.id);
  });
  await page.getByRole("button", { name: "Enquadrar seleção" }).click();
  await page.waitForTimeout(50);
  const canvas = page.locator("canvas.pattern-canvas");
  const curve = await page.evaluate(async () => {
    const [{ useEditorStore }, pattern, polygon] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/pattern.ts"), import("/src/domain/polygonGeometry.ts")]);
    const s = useEditorStore.getState(), p = s.garment.pieces[0], e = pattern.getPatternEdges(p)[0], a = p.points[0], b = p.points[1], samples = polygon.samplePatternSegment(a, b), q = samples[Math.floor(samples.length / 2)];
    return { edgeId: e.id, point: { xMm: q.xMm, yMm: q.yMm } };
  });
  const toScreen = async (local) => page.evaluate(async (local) => {
    const [{ useEditorStore }, polygon, camera, coords] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/domain/polygonGeometry.ts"), import("/src/editor/camera.ts"), import("/src/editor/coordinates.ts")]);
    const s = useEditorStore.getState(), p = s.garment.pieces[0], t = s.garment.workspaceStates[0].transform, c = document.querySelector("canvas.pattern-canvas"), r = c.getBoundingClientRect(), contour = polygon.samplePatternContour(p.points).map((x) => coords.pieceLocalToWorld(x, t));
    const bounds = { minX: Math.min(...contour.map((x) => x.xMm)), minY: Math.min(...contour.map((x) => x.yMm)), maxX: Math.max(...contour.map((x) => x.xMm)), maxY: Math.max(...contour.map((x) => x.yMm)) };
    return coords.worldToScreen(coords.pieceLocalToWorld(local, t), camera.cameraToFitBounds(bounds, { width: r.width, height: r.height }, 70));
  }, local);
  await canvas.tap({ position: await toScreen(curve.point) });
  await page.waitForTimeout(50);
  const handle = await page.evaluate(async () => {
    const [{ useEditorStore }, helper] = await Promise.all([import("/src/state/editorStore.ts"), import("/src/editor/curveHandleInteraction.ts")]);
    const s = useEditorStore.getState(), p = s.garment.pieces[0], target = helper.patternCurveHandleTargets(p, s.selectedPointId, s.selectedEdgeId).find((x) => x.handle === "out"), point = p.points.find((x) => x.id === target.pointId), v = point.handleOut;
    return { local: { xMm: point.xMm + v.xMm, yMm: point.yMm + v.yMm }, radiusTouch: helper.curveHandleHitRadiusPx("touch") };
  });
  const position = await toScreen(handle.local);
  const box = await canvas.boundingBox();
  await page.evaluate(() => {
    window.__curveTouchEvents = [];
    const canvas = document.querySelector("canvas.pattern-canvas");
    for (const type of ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "touchend"]) {
      canvas.addEventListener(type, (event) => {
        window.__curveTouchEvents.push({ type, pointerType: event.pointerType ?? null, clientX: event.clientX ?? null, clientY: event.clientY ?? null, touches: event.touches?.length ?? null });
      }, true);
    }
  });
  return { canvas, cdp, position, box, radiusTouch: handle.radiusTouch };
}

async function geom() {
  return page.evaluate(async () => structuredClone((await import("/src/state/editorStore.ts")).useEditorStore.getState().garment.pieces[0].points));
}

async function dispatch(start, end) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.x, y: start.y, radiusX: 7, radiusY: 7, force: 1 }] });
  for (let i = 1; i <= 5; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x-start.x)*i/5, y: start.y + (end.y-start.y)*i/5, radiusX: 7, radiusY: 7, force: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
}

try {
  const { position, box, radiusTouch } = await setup();
  const before = await geom();
  const exact = { x: box.x + position.x, y: box.y + position.y };
  await dispatch(exact, { x: exact.x + 30, y: exact.y - 14 });
  const exactAfter = await geom();
  const events = await page.evaluate(() => window.__curveTouchEvents);
  console.log(JSON.stringify({ radiusTouch, exactCenterChanged: JSON.stringify(before) !== JSON.stringify(exactAfter), exact, events }));
} finally {
  await browser.close();
}
