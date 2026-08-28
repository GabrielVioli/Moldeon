import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.MOLDEON_VERIFY_URL ?? "http://127.0.0.1:4186/";
const outputDir = new URL("../docs/evidence/recovery-11.0.6/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const chromePath = process.env.MOLDEON_CHROME_PATH
  ?? (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "/usr/bin/google-chrome");
const errors = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(`11.0.6 browser gate: ${message}`);
};
const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(12_000);
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__moldeonPhase0));

  // Scenario A: genuinely fresh rectangle, deliberately outside the body map.
  const fresh = await page.evaluate(async () => {
    const [{ useEditorStore }, { createBlankGarment }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/blankGarment.ts"),
    ]);
    const store = useEditorStore.getState();
    store.loadGarment(createBlankGarment());
    store.startDraft("Spatial rectangle");
    store.addDraftPoint(0, 0);
    store.addDraftPoint(100, 0);
    store.addDraftPoint(100, 160);
    store.addDraftPoint(0, 160);
    store.closeDraft();
    const state = useEditorStore.getState();
    const piece = state.garment.pieces[0];
    const workspace = state.garment.workspaceStates?.find((entry) => entry.pieceId === piece.id);
    if (!workspace) throw new Error("fresh panel workspace missing");
    state.setPieceWorkspaceTransform(piece.id, {
      ...workspace.transform,
      xMm: 2600,
      yMm: 400,
      rotationDeg: 0,
    });
    const next = useEditorStore.getState();
    const movedWorkspace = next.garment.workspaceStates?.find((entry) => entry.pieceId === piece.id);
    return {
      pieceId: piece.id,
      geometry: structuredClone(next.garment.pieces[0].points),
      transform: structuredClone(movedWorkspace?.transform),
    };
  });

  await page.getByLabel("Corpo 2D").check();
  await page.waitForFunction(() => document.querySelector('[data-testid="body-reference-2d"]')?.getAttribute("data-source-topology") !== "hidden");
  const bodyAnchorBefore = await page.locator(".body-reference-anchor").first().getAttribute("transform");
  for (const view of ["back", "left", "right", "front"]) {
    await page.getByLabel("Vista corporal 2D").selectOption(view);
    await page.waitForTimeout(80);
  }
  const afterViews = await page.evaluate(async () => {
    const [{ useEditorStore }, { garmentDraftToPatternDocumentV3 }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/patternDocumentV3.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces[0];
    const workspace = state.garment.workspaceStates?.find((entry) => entry.pieceId === piece.id);
    const document = garmentDraftToPatternDocumentV3(state.garment);
    return {
      geometry: structuredClone(piece.points),
      transform: structuredClone(workspace?.transform),
      placementStatus: document.panelInstances[0]?.placementStatus,
      arrangementAnchor: document.panelInstances[0]?.arrangementAnchor,
      effectivePlacementSource: document.panelInstances[0]?.metadata.effectivePlacementSource,
    };
  });
  assert(JSON.stringify(afterViews.geometry) === JSON.stringify(fresh.geometry), "body views changed canonical geometry");
  assert(JSON.stringify(afterViews.transform) === JSON.stringify(fresh.transform), "body views changed workspace transform");
  assert(afterViews.placementStatus === "unclassified", "fresh outside panel was classified merely by showing the body");
  assert(afterViews.arrangementAnchor === undefined, "fresh outside panel gained an arrangement anchor");
  assert(afterViews.effectivePlacementSource === "unassigned", "fresh outside panel is not UNASSIGNED");
  await page.screenshot({ path: fileURLToPath(new URL("01-fresh-outside-unassigned.png", outputDir)), fullPage: true });

  // Scenario B: Provar answers are global context, never canonical placement.
  const afterPreflight = await page.evaluate(async () => {
    const [{ useEditorStore }, { garmentDraftToPatternDocumentV3 }, { deriveDressingPanelInstances }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/patternDocumentV3.ts"),
      import("/src/domain/assembly.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces[0];
    state.setGarmentDressing({ region: "upper", frontReferencePieceId: piece.id });
    const next = useEditorStore.getState();
    const document = garmentDraftToPatternDocumentV3(next.garment);
    const resolved = deriveDressingPanelInstances(document, next.garment);
    return {
      placementStatus: resolved[0]?.placementStatus,
      arrangementAnchor: resolved[0]?.arrangementAnchor,
      effectivePlacementSource: resolved[0]?.metadata.effectivePlacementSource,
    };
  });
  assert(afterPreflight.placementStatus === "unclassified", "Provar promoted UNASSIGNED");
  assert(afterPreflight.arrangementAnchor === undefined, "Provar fabricated an arrangement anchor");
  assert(afterPreflight.effectivePlacementSource === "unassigned", "Provar changed placement provenance");

  // Scenario C: move the piece to hip-front. The body does not chase it.
  const hipMove = await page.evaluate(async () => {
    const [{ useEditorStore }, { buildAvatarParametricModel }, { projectAvatarBody2D }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
      import("/src/avatar/BodyProjection2D.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces[0];
    const workspace = state.garment.workspaceStates?.find((entry) => entry.pieceId === piece.id);
    if (!workspace) throw new Error("hip panel workspace missing");
    const avatar = buildAvatarParametricModel(state.garment.measurements, state.garment.bodyType, {
      profile: state.garment.measurementProfile,
    });
    const projection = projectAvatarBody2D(avatar, "front");
    const hip = projection.anchors.find((anchor) => anchor.id === "hip-front");
    if (!hip) throw new Error("hip-front projection missing");
    state.setPieceWorkspaceTransform(piece.id, {
      ...workspace.transform,
      xMm: hip.xMm - 50,
      yMm: hip.yMm - 80,
      rotationDeg: 0,
    });
    return { hip };
  });
  await page.waitForTimeout(350);
  const hipCanonical = await page.evaluate(async () => {
    const [
      { useEditorStore },
      { garmentDraftToPatternDocumentV3 },
      { buildResolvedAssemblyInput },
      { buildSemanticAvatarArrangement },
      { buildAvatarParametricModel },
    ] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/patternDocumentV3.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
    ]);
    const state = useEditorStore.getState();
    const document = garmentDraftToPatternDocumentV3(state.garment);
    const instance = document.panelInstances[0];
    const input = buildResolvedAssemblyInput(state.garment);
    const arranged = buildSemanticAvatarArrangement(
      input,
      buildAvatarParametricModel(state.garment.measurements, state.garment.bodyType, {
        profile: state.garment.measurementProfile,
      }),
    );
    const physical = arranged.state.instances[0];
    return {
      instanceId: instance.id,
      placementStatus: instance.placementStatus,
      anchor: instance.arrangementAnchor,
      transform: state.garment.workspaceStates?.find((entry) => entry.pieceId === instance.sourcePatternId)?.transform,
      mapping: physical?.arrangement?.mapping,
      tubeGroupId: physical?.arrangement?.tubeGroupId,
      stitchConstraintCount: arranged.state.stitchConstraints.length,
      stateInstanceCount: arranged.state.instances.length,
    };
  });
  const bodyAnchorAfter = await page.locator(".body-reference-anchor").first().getAttribute("transform");
  assert(bodyAnchorAfter === bodyAnchorBefore, "BodyReference2D moved when the piece moved");
  assert(hipCanonical.placementStatus === "confirmed", "hip move did not confirm PanelInstance");
  assert(hipCanonical.anchor?.bodyAnchorId === "hip-front", `expected hip-front, got ${hipCanonical.anchor?.bodyAnchorId}`);
  assert(Math.abs(hipCanonical.anchor?.offsetXMm ?? 999) < 2, "hip X offset does not reflect the chosen spatial position");
  assert(Math.abs(hipCanonical.anchor?.offsetYMm ?? 999) < 2, "hip Y offset does not reflect the chosen spatial position");
  assert(hipCanonical.mapping === "rigid-panel", `seam-free rectangle mapped as ${hipCanonical.mapping}`);
  assert(hipCanonical.tubeGroupId === undefined, "seam-free rectangle gained a tubeGroup");
  assert(hipCanonical.stitchConstraintCount === 0, "seam-free rectangle gained stitch constraints");
  assert(hipCanonical.stateInstanceCount === 1, "seam-free rectangle duplicated physically");
  await page.screenshot({ path: fileURLToPath(new URL("02-hip-front-authored.png", outputDir)), fullPage: true });

  // The spatially authored arrangement is sufficient: no mandatory body-position form.
  const preflightReady = await page.evaluate(async () => {
    const [{ useEditorStore }, { evaluateDressingPreflight }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/assembly.ts"),
    ]);
    return evaluateDressingPreflight(useEditorStore.getState().garment);
  });
  assert(preflightReady.canDress === true, `explicit spatial arrangement still blocked Provar: ${preflightReady.issues.join(" | ")}`);

  const proveButton = page.getByRole("button", { name: "Prova", exact: true });
  await proveButton.first().click();
  await page.waitForFunction(() => Boolean(document.querySelector("canvas.three-canvas")), undefined, { timeout: 15_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: fileURLToPath(new URL("03-hip-front-3d.png", outputDir)), fullPage: true });

  // Move the SAME panel to waist-front. 3D must follow the piece, never vice versa.
  const waist = await page.evaluate(async () => {
    const [{ useEditorStore }, { buildAvatarParametricModel }, { projectAvatarBody2D }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
      import("/src/avatar/BodyProjection2D.ts"),
    ]);
    const state = useEditorStore.getState();
    const piece = state.garment.pieces[0];
    const workspace = state.garment.workspaceStates?.find((entry) => entry.pieceId === piece.id);
    if (!workspace) throw new Error("waist panel workspace missing");
    const avatar = buildAvatarParametricModel(state.garment.measurements, state.garment.bodyType, {
      profile: state.garment.measurementProfile,
    });
    const projection = projectAvatarBody2D(avatar, "front");
    const waist = projection.anchors.find((anchor) => anchor.id === "waist-front");
    if (!waist) throw new Error("waist-front projection missing");
    state.setPieceWorkspaceTransform(piece.id, {
      ...workspace.transform,
      xMm: waist.xMm - 50,
      yMm: waist.yMm - 80,
      rotationDeg: 0,
    });
    return waist;
  });
  await page.waitForTimeout(350);
  const waistCanonical = await page.evaluate(async () => {
    const [{ useEditorStore }, { garmentDraftToPatternDocumentV3 }, { buildResolvedAssemblyInput }, { buildSemanticAvatarArrangement }, { buildAvatarParametricModel }] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/patternDocumentV3.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
    ]);
    const state = useEditorStore.getState();
    const document = garmentDraftToPatternDocumentV3(state.garment);
    const input = buildResolvedAssemblyInput(state.garment);
    const arranged = buildSemanticAvatarArrangement(
      input,
      buildAvatarParametricModel(state.garment.measurements, state.garment.bodyType, {
        profile: state.garment.measurementProfile,
      }),
    );
    return {
      instanceId: document.panelInstances[0]?.id,
      anchor: document.panelInstances[0]?.arrangementAnchor,
      mapping: arranged.state.instances[0]?.arrangement?.mapping,
    };
  });
  assert(waistCanonical.instanceId === hipCanonical.instanceId, "moving to waist changed PanelInstance identity");
  assert(waistCanonical.anchor?.bodyAnchorId === "waist-front", `3D did not follow piece to waist: ${waistCanonical.anchor?.bodyAnchorId}`);
  assert(waistCanonical.mapping === "rigid-panel", "waist move stopped using rigid-panel");
  await page.screenshot({ path: fileURLToPath(new URL("04-waist-front-3d.png", outputDir)), fullPage: true });

  // Scenario D: two independent explicit panels, zero seams, zero tube closure.
  const twoPanels = await page.evaluate(async () => {
    const [
      { useEditorStore },
      { createUnclassifiedBodyPlacement },
      { buildResolvedAssemblyInput },
      { buildSemanticAvatarArrangement },
      { buildAvatarParametricModel },
    ] = await Promise.all([
      import("/src/state/editorStore.ts"),
      import("/src/domain/pattern.ts"),
      import("/src/garment3d/ResolvedAssemblyInput.ts"),
      import("/src/garment3d/SemanticAvatarArrangement.ts"),
      import("/src/avatar/AvatarParametricModel.ts"),
    ]);
    const state = useEditorStore.getState();
    const source = state.garment.pieces[0];
    state.duplicatePiece(source.id, false);
    const next = useEditorStore.getState();
    const duplicate = next.garment.pieces.find((piece) => piece.id !== source.id);
    if (!duplicate) throw new Error("duplicate panel missing");
    next.confirmPanelInstanceArrangement(duplicate.id, 0, {
      ...createUnclassifiedBodyPlacement(),
      status: "confirmed",
      role: "panel",
      region: "hip",
      surface: "back",
      bodySide: "center",
      anchorId: "hip-back",
      source: "manual",
    }, {
      id: `${duplicate.id}:panel:1`,
      pieceId: duplicate.id,
      region: "hip",
      surface: "back",
      bodySide: "center",
      bodyAnchorId: "hip-back",
      rotationDeg: 0,
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 25,
      scale: 1,
    });
    const finalState = useEditorStore.getState();
    const input = buildResolvedAssemblyInput({ ...finalState.garment, seams: [] });
    const arranged = buildSemanticAvatarArrangement(
      input,
      buildAvatarParametricModel(finalState.garment.measurements, finalState.garment.bodyType, {
        profile: finalState.garment.measurementProfile,
      }),
    );
    return {
      instanceCount: arranged.state.instances.length,
      stitchConstraintCount: arranged.state.stitchConstraints.length,
      mappings: arranged.state.instances.map((instance) => instance.arrangement?.mapping),
      tubeGroups: arranged.state.instances.map((instance) => instance.arrangement?.tubeGroupId ?? null),
    };
  });
  assert(twoPanels.instanceCount === 2, "two independent panels did not remain two physical instances");
  assert(twoPanels.stitchConstraintCount === 0, "two seam-free panels gained stitch constraints");
  assert(twoPanels.mappings.every((mapping) => mapping === "rigid-panel"), "two seam-free panels did not stay rigid-panel");
  assert(twoPanels.tubeGroups.every((group) => group === null), "two seam-free panels gained a tube closure");
  await page.screenshot({ path: fileURLToPath(new URL("05-two-independent-panels.png", outputDir)), fullPage: true });

  process.stdout.write(`${JSON.stringify({
    fresh,
    afterViews,
    afterPreflight,
    hipMove,
    hipCanonical,
    preflightReady,
    waist,
    waistCanonical,
    twoPanels,
    errors,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length > 0) process.exitCode = 1;
