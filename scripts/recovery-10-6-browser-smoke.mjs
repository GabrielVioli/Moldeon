import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

try {
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.locator(".app-shell").waitFor({ state: "visible" });
  const result = await page.evaluate(async () => {
    const fixtures = await import("/src/testFixtures/baselineGarments.ts");
    const inputModule = await import("/src/garment3d/ResolvedAssemblyInput.ts");
    const avatarModule = await import("/src/avatar/AvatarParametricModel.ts");
    const arrangementModule = await import("/src/garment3d/SemanticAvatarArrangement.ts");
    const adapterModule = await import("/src/physics/GarmentXpbdAdapter.ts");
    const xpbdModule = await import("/src/physics/xpbd.ts");

    const garment = fixtures.createBaselineFixture("straight-pants-standard");
    const input = inputModule.buildResolvedAssemblyInput(garment);
    const avatar = avatarModule.buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
    const arrangement = arrangementModule.buildSemanticAvatarArrangement(input, avatar);
    const component = arrangement.constraintSpatialAssembly.components[0];
    const initialization = adapterModule.buildXpbdInitialization(arrangement.state, arrangement.garment, "10.6-browser", { config: { gravity: [0, 0, 0] } });
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
    const beforePositions = new Float32Array(state.positions);
    const initial = xpbdModule.measureXpbdDiagnostics(state);
    xpbdModule.stepXpbd(state);
    let oneStepMaxM = 0;
    for (let index = 0; index < state.positions.length; index += 3) {
      oneStepMaxM = Math.max(oneStepMaxM, Math.hypot(
        state.positions[index] - beforePositions[index],
        state.positions[index + 1] - beforePositions[index + 1],
        state.positions[index + 2] - beforePositions[index + 2],
      ));
    }
    for (let step = 1; step < 240; step += 1) xpbdModule.stepXpbd(state);
    const final = xpbdModule.measureXpbdDiagnostics(state, 240);
    const frontRise = arrangement.constraintSpatialAssembly.graph.relations.filter((relation) => relation.seamGroupId === "template-seam:trouser-front-rise");
    const backRise = arrangement.constraintSpatialAssembly.graph.relations.filter((relation) => relation.seamGroupId === "template-seam:trouser-back-rise");
    return {
      strategy: component?.strategy,
      nodeCount: arrangement.constraintSpatialAssembly.graph.nodes.length,
      frontRiseRelations: frontRise.length,
      backRiseRelations: backRise.length,
      constraints: component?.constraintCount,
      cycles: component?.cycleCount,
      nonPlanarityRad: component?.nonPlanarityRad,
      overlap: component?.coarseOverlapScore,
      intrinsic: component?.intrinsicDistortion,
      solveMs: component?.assemblySolveMs,
      initialMeanMm: initial.seamErrorAverage * 1000,
      initialMaxMm: initial.seamErrorMaximum * 1000,
      oneStepMaxM,
      finalMeanMm: final.seamErrorAverage * 1000,
      finalMaxMm: final.seamErrorMaximum * 1000,
      invalid: state.invalid,
    };
  });

  console.log(`MOLDEON_10_6_BROWSER ${JSON.stringify(result)}`);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (result.strategy !== "constraint-spatial-shell") throw new Error(`Unexpected strategy: ${result.strategy}`);
  if (result.nodeCount !== 4) throw new Error(`Unexpected pants panel count: ${result.nodeCount}`);
  if (result.frontRiseRelations < 1 || result.backRiseRelations < 1) throw new Error("Missing paired-copy crotch relations");
  if (!(result.nonPlanarityRad > 0.05)) throw new Error(`Pants remained degenerate/planar: ${result.nonPlanarityRad}`);
  if (!(result.intrinsic < 0.001)) throw new Error(`Intrinsic distortion too large: ${result.intrinsic}`);
  if (!(result.oneStepMaxM < 0.2)) throw new Error(`First-step structural kick: ${result.oneStepMaxM}m`);
  if (result.invalid) throw new Error("XPBD state became invalid");
  if (!(result.finalMeanMm < result.initialMeanMm)) throw new Error("Seam average did not converge");
  if (!(result.finalMaxMm < result.initialMaxMm)) throw new Error("Seam maximum did not converge");
} finally {
  await browser.close();
}
