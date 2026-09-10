import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.STEP0_BASE_URL ?? "http://127.0.0.1:5173";
const outputDirectory = resolve(process.env.STEP0_ARTIFACT_DIR ?? "artifacts/step0-browser");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = { generatedAt: new Date().toISOString(), baseUrl, browserVersion: browser.version(), scenarios: [] };

try {
  await runScenario("self-seam-1020x300", 1020, 300, "wrap");
  await runScenario("self-seam-435x227", 435, 227, "reject-too-small");
} finally {
  await browser.close();
}

await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.scenarios.some((scenario) => scenario.status !== "passed")) process.exitCode = 1;

async function runScenario(name, widthMm, heightMm, expectation) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 }, locale: "pt-BR", colorScheme: "light" });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let status = "failed";
  let prepared = null;
  let result = null;
  let error = null;
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__moldeonPhase0), null, { timeout: 20_000 });
    prepared = await page.evaluate(async ({ widthMm, heightMm }) => {
      const fixtures = await import("/src/testFixtures/baselineGarments.ts");
      const patternModule = await import("/src/domain/pattern.ts");
      const storeModule = await import("/src/state/editorStore.ts");
      const avatarModule = await import("/src/avatar/AvatarParametricModel.ts");
      const garment = fixtures.createBaselineFixture("exact-contact-tube");
      const originalPiece = garment.pieces[0];
      const originalSeam = garment.seams?.[0];
      if (!originalPiece || !originalSeam) throw new Error("Fixture exact-contact-tube incompleto.");

      const piece = patternModule.migrateLegacyPieceToSegments({
        id: originalPiece.id,
        name: originalPiece.name,
        seamAllowanceMm: originalPiece.seamAllowanceMm,
        cutQuantity: 1,
        points: [
          { id: `${originalPiece.id}:e2e-a`, xMm: 0, yMm: 0 },
          { id: `${originalPiece.id}:e2e-b`, xMm: widthMm, yMm: 0 },
          { id: `${originalPiece.id}:e2e-c`, xMm: widthMm, yMm: heightMm },
          { id: `${originalPiece.id}:e2e-d`, xMm: 0, yMm: heightMm },
        ],
      });
      piece.fabricId = originalPiece.fabricId;
      const edges = patternModule.getPatternEdges(piece);
      if (edges.length !== 4) throw new Error(`Retângulo E2E gerou ${edges.length} bordas.`);
      garment.pieces = [piece];
      garment.seams = [{
        ...originalSeam,
        first: { pieceId: piece.id, edgeId: edges[1].id, startT: 0, endT: 1 },
        second: { pieceId: piece.id, edgeId: edges[3].id, startT: 0, endT: 1 },
        firstRanges: undefined,
        secondRanges: undefined,
        physicalBindings: undefined,
      }];
      garment.name = `STEP0 E2E ${widthMm}x${heightMm}`;
      garment.id = `step0-e2e-${widthMm}x${heightMm}`;

      const store = storeModule.useEditorStore.getState();
      store.loadGarment(garment);
      const avatar = avatarModule.buildAvatarParametricModel(garment.measurements, garment.bodyType);
      const fullHip = avatar.humanBody.crossSections.find((section) => section.region === "full-hip")
        ?? avatar.humanBody.crossSections.reduce((best, section) =>
          Math.abs(section.yM - avatar.landmarks.hipY) < Math.abs(best.yM - avatar.landmarks.hipY) ? section : best,
        avatar.humanBody.crossSections[0]);
      if (!fullHip) throw new Error("Manequim sem seção corporal para o gate STEP-0.");
      const yMm = fullHip.yM * 1000;
      const bodyFrontZ = fullHip.centerZM + fullHip.frontDepthM;
      const zMm = (bodyFrontZ + 0.012) * 1000;
      storeModule.useEditorStore.getState().setPanelInstanceArrangement(piece.id, 0, {
        id: "step0-e2e-placement",
        pieceId: piece.id,
        region: "hip",
        surface: "front",
        bodySide: "center",
        rotationDeg: 0,
        offsetXMm: 0,
        offsetYMm: 0,
        offsetZMm: 12,
        scale: 1,
        mirrorX: false,
        positionMm: [0, yMm, zMm],
        orientationDeg: [0, 0, 0],
        presentationMode: "authored",
      });

      const currentPiece = storeModule.useEditorStore.getState().garment.pieces[0];
      const xs = currentPiece.points.map((point) => point.xMm);
      const ys = currentPiece.points.map((point) => point.yMm);
      const relevantMinY = fullHip.yM - heightMm * 0.001 - 0.03;
      const relevantMaxY = fullHip.yM + 0.03;
      const nearbySections = avatar.humanBody.crossSections
        .filter((section) => section.yM >= relevantMinY && section.yM <= relevantMaxY)
        .map((section) => ({
          id: section.id,
          region: section.region,
          yM: section.yM,
          centerM: section.centerM ?? [0, section.yM, section.centerZM],
          actualCircumferenceMm: section.actualCircumferenceMm,
          halfWidthM: section.halfWidthM,
          frontDepthM: section.frontDepthM,
          backDepthM: section.backDepthM,
        }));
      return {
        requested: { widthMm, heightMm },
        canonical: {
          widthMm: Math.max(...xs) - Math.min(...xs),
          heightMm: Math.max(...ys) - Math.min(...ys),
          segmentCount: currentPiece.segments?.length ?? 0,
        },
        body: {
          sectionId: fullHip.id,
          sectionRegion: fullHip.region,
          actualCircumferenceMm: fullHip.actualCircumferenceMm,
          centerM: fullHip.centerM ?? [0, fullHip.yM, fullHip.centerZM],
          halfWidthM: fullHip.halfWidthM,
          frontDepthM: fullHip.frontDepthM,
          backDepthM: fullHip.backDepthM,
          nearbySections,
        },
      };
    }, { widthMm, heightMm });

    if (Math.abs(prepared.canonical.widthMm - widthMm) > 0.01 || Math.abs(prepared.canonical.heightMm - heightMm) > 0.01) {
      throw new Error(`Fixture E2E não materializou ${widthMm} x ${heightMm} mm: ${JSON.stringify(prepared.canonical)}`);
    }

    const montar = page.getByRole("button", { name: "Montar", exact: true });
    if (await montar.count()) await montar.click();
    else await page.getByRole("button", { name: /Montar no 3D|Montagem/i }).first().click();
    await page.waitForSelector("canvas.three-canvas", { timeout: 30_000 });
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-before.png`), fullPage: true });

    const adjust = page.getByRole("button", { name: "Ajustar montagem", exact: true });
    await adjust.waitFor({ state: "visible", timeout: 20_000 });
    await adjust.click();
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
      const value = host?.dataset.sewingStep0Status ?? "";
      return Boolean(value) && !value.startsWith("solving") && !value.startsWith("polishing");
    }, null, { timeout: 45_000 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-after.png`), fullPage: true });

    result = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="dressed-avatar-viewport"]');
      const parse = (value) => {
        if (!value) return null;
        try { return JSON.parse(value); } catch { return value; }
      };
      const notice = document.querySelector(".viewport-sewing-step0-status")?.textContent?.trim() ?? null;
      return {
        status: host?.dataset.sewingStep0Status ?? null,
        notice,
        diagnostics: parse(host?.dataset.sewingStep0Diagnostics),
        materialAudit: parse(host?.dataset.sewingStep0MaterialAudit),
        elapsedMs: host?.dataset.sewingStep0Ms ? Number(host.dataset.sewingStep0Ms) : null,
      };
    });

    const applied = result?.status === "applied-global-shape" || result?.status === "applied-global-candidate" || result?.status === "applied";
    const diagnostics = result?.diagnostics ?? {};
    const residualMm = Number(diagnostics?.proposalResidual?.afterBody?.maximumM ?? diagnostics?.finalResidual?.maximumM ?? Number.POSITIVE_INFINITY) * 1000;
    const material = Number(diagnostics?.materialAfter ?? diagnostics?.metricDistortionMax ?? Number.POSITIVE_INFINITY);
    const bodyAudits = Object.values(diagnostics?.bodyAudits ?? {});
    const bodySafe = bodyAudits.length > 0 && bodyAudits.every((audit) =>
      Number(audit?.after?.penetratingSamples ?? 1) === 0
      && Number(audit?.after?.minimumSignedClearanceMm ?? -999) >= -0.5,
    );
    const rendered = diagnostics?.renderedMeshes?.[0]?.boundingBox;
    const bodyBounds = diagnostics?.bodyBounds;
    const bodyCenter = bodyBounds
      ? [
          (bodyBounds.min[0] + bodyBounds.max[0]) * 0.5,
          (bodyBounds.min[1] + bodyBounds.max[1]) * 0.5,
          (bodyBounds.min[2] + bodyBounds.max[2]) * 0.5,
        ]
      : prepared?.body?.centerM;
    const surroundsBodyCenter = Boolean(rendered && bodyCenter)
      && rendered.min[0] < bodyCenter[0] && rendered.max[0] > bodyCenter[0]
      && rendered.min[2] < bodyCenter[2] && rendered.max[2] > bodyCenter[2];
    const fit = diagnostics?.bodyFit ?? diagnostics?.registration?.bodyFit ?? diagnostics?.globalShape?.bodyFit ?? null;
    const tooSmall = result?.status === "insufficient-body-circumference"
      || diagnostics?.rejectionReason === "insufficient-body-circumference"
      || fit?.status === "insufficient-circumference";
    const quantitativeTooSmall = tooSmall
      && Number.isFinite(Number(fit?.materialCircumferenceMm))
      && Number.isFinite(Number(fit?.requiredCircumferenceMm))
      && Number(fit.materialCircumferenceMm) < Number(fit.requiredCircumferenceMm);

    if (expectation === "wrap") {
      status = applied
        && Number.isFinite(residualMm) && residualMm <= 5
        && Number.isFinite(material) && material <= 0.02
        && bodySafe
        && surroundsBodyCenter
        ? "passed"
        : "failed";
    } else {
      status = !applied && quantitativeTooSmall ? "passed" : "failed";
    }
  } catch (reason) {
    error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    await page.screenshot({ path: resolve(outputDirectory, `${name}-error.png`), fullPage: true }).catch(() => undefined);
  } finally {
    report.scenarios.push({ name, widthMm, heightMm, expectation, status, prepared, result, error, consoleMessages, pageErrors });
    await context.close();
  }
}
