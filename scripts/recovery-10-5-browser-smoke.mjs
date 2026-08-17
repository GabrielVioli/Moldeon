import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

try {
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.locator(".app-shell").waitFor({ state: "visible" });
  const result = await page.evaluate(async () => {
    const fixtureModule = await import("/src/testFixtures/generalGarmentShell.ts");
    const inputModule = await import("/src/garment3d/ResolvedAssemblyInput.ts");
    const avatarModule = await import("/src/avatar/AvatarParametricModel.ts");
    const arrangementModule = await import("/src/garment3d/SemanticAvatarArrangement.ts");
    const adapterModule = await import("/src/physics/GarmentXpbdAdapter.ts");
    const xpbdModule = await import("/src/physics/xpbd.ts");

    const garment = fixtureModule.createGeneralGarmentShellFixture();
    const input = inputModule.buildResolvedAssemblyInput(garment);
    const avatar = avatarModule.buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
    const arrangement = arrangementModule.buildSemanticAvatarArrangement(input, avatar);
    const initialization = adapterModule.buildXpbdInitialization(arrangement.state, arrangement.garment, "10.5-browser", { config: { gravity: [0, 0, 0] } });
    const state = xpbdModule.createXpbdState({
      positions: initialization.positions,
      previousPositions: initialization.previousPositions,
      predictedPositions: initialization.predictedPositions,
      velocities: initialization.velocities,
      inverseMasses: initialization.inverseMasses,
      restPositions: initialization.restPositions,
      materialCoordinates: initialization.materialCoordinates,
      triangles: initialization.triangles,
      distances: { indices: initialization.distanceIndices, restLengths: initialization.distanceRestLengths, compliances: initialization.distanceCompliances, lambdas: new Float32Array(initialization.distanceRestLengths.length), kinds: initialization.distanceKinds },
      shears: { indices: initialization.shearIndices, restCosines: initialization.shearRestCosines, compliances: initialization.shearCompliances, lambdas: new Float32Array(initialization.shearRestCosines.length) },
      seams: { indices: initialization.seamIndices, weights: initialization.seamWeights, restDistances: initialization.seamRestDistances, compliances: initialization.seamCompliances, relaxations: initialization.seamRelaxations, lambdas: new Float32Array(initialization.seamRestDistances.length), seamGroupIds: initialization.seamGroupIds },
      pins: { indices: initialization.pinIndices, targets: initialization.pinTargets },
      config: { ...initialization.config, gravity: [0, 0, 0] },
    });
    const initialPositions = new Float32Array(state.positions);
    const before = xpbdModule.measureXpbdDiagnostics(state);
    xpbdModule.stepXpbd(state);
    let oneStepDisplacement = 0;
    for (let i = 0; i < state.positions.length; i += 3) {
      oneStepDisplacement = Math.max(oneStepDisplacement, Math.hypot(state.positions[i] - initialPositions[i], state.positions[i + 1] - initialPositions[i + 1], state.positions[i + 2] - initialPositions[i + 2]));
    }
    for (let step = 1; step < 240; step += 1) xpbdModule.stepXpbd(state);
    const after = xpbdModule.measureXpbdDiagnostics(state, 240);

    const normalSpread = (() => {
      const normals = arrangement.state.instances.map((instance) => {
        const t = instance.topology.triangles;
        const a = (instance.particleStart + t[0]) * 3;
        const b = (instance.particleStart + t[1]) * 3;
        const c = (instance.particleStart + t[2]) * 3;
        const p = arrangement.state.positions;
        const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
        const ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        const length = Math.hypot(...n) || 1;
        return n.map((value) => value / length);
      });
      let spread = 0;
      for (let i = 0; i < normals.length; i += 1) for (let j = i + 1; j < normals.length; j += 1) {
        const dot = Math.max(-1, Math.min(1, Math.abs(normals[i][0] * normals[j][0] + normals[i][1] * normals[j][1] + normals[i][2] * normals[j][2])));
        spread = Math.max(spread, Math.acos(dot));
      }
      return spread;
    })();

    return {
      strategy: arrangement.spatialAssemblyDiagnostics[0]?.strategy,
      assemblyMeanMm: arrangement.initialSeamResidualAudit.afterTubeAlignment.meanResidualMm,
      assemblyMaxMm: arrangement.initialSeamResidualAudit.afterTubeAlignment.maxResidualMm,
      normalSpread,
      oneStepDisplacement,
      initialSeamMeanMm: before.seamErrorAverage * 1000,
      initialSeamMaxMm: before.seamErrorMaximum * 1000,
      finalSeamMeanMm: after.seamErrorAverage * 1000,
      finalSeamMaxMm: after.seamErrorMaximum * 1000,
      invalid: state.invalid,
      physicsStepMs: state.profile.solverStepTotalMs,
    };
  });

  console.log(`MOLDEON_10_5_BROWSER ${JSON.stringify(result)}`);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (result.strategy !== "multipanel-surface-shell") throw new Error(`Unexpected strategy: ${result.strategy}`);
  if (!(result.assemblyMaxMm < 60)) throw new Error(`Assembly residual too large: ${result.assemblyMaxMm} mm`);
  if (!(result.normalSpread > 0.25)) throw new Error(`Shell remained planar: ${result.normalSpread} rad`);
  if (!(result.oneStepDisplacement < 0.05)) throw new Error(`One-step structural kick: ${result.oneStepDisplacement} m`);
  if (result.invalid) throw new Error("XPBD state became invalid");
  if (!(result.finalSeamMeanMm < result.initialSeamMeanMm && result.finalSeamMaxMm < result.initialSeamMaxMm)) throw new Error("240-step seam residual did not converge");
} finally {
  await browser.close();
}
