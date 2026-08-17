import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentDraft, PatternPoint } from "../domain/pattern";
import { buildXpbdInitialization } from "../physics/GarmentXpbdAdapter";
import { createXpbdState, measureXpbdDiagnostics, stepXpbd } from "../physics/xpbd";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";


describe("Prompt 10.6 shorts/trouser topology", () => {
  it("assembles a shortened trouser with the same generic crotch/side/inseam graph", () => {
    const garment = shortenTrouser(createBaselineFixture("straight-pants-standard"));
    const input = buildResolvedAssemblyInput(garment);
    const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
    const arrangement = buildSemanticAvatarArrangement(input, avatar);
    const graph = arrangement.constraintSpatialAssembly.graph;
    const component = arrangement.constraintSpatialAssembly.components[0];

    expect(input.panelInstances).toHaveLength(4);
    expect(graph.relations.some((relation) => relation.seamGroupId === "template-seam:trouser-front-rise")).toBe(true);
    expect(graph.relations.some((relation) => relation.seamGroupId === "template-seam:trouser-back-rise")).toBe(true);
    expect(graph.relations.some((relation) => relation.classification === "local-shaping-closure")).toBe(true);
    expect(component.strategy).toBe("constraint-spatial-shell");
    expect(component.nonPlanarityRad).toBeGreaterThan(0.05);
    expect([...arrangement.state.positions].every(Number.isFinite)).toBe(true);

    const init = buildXpbdInitialization(arrangement.state, arrangement.garment, "10.6-shorts", { config: { gravity: [0, 0, 0] } });
    const state = createXpbdState({
      positions: init.positions,
      previousPositions: init.previousPositions,
      predictedPositions: init.predictedPositions,
      velocities: init.velocities,
      inverseMasses: init.inverseMasses,
      restPositions: init.restPositions,
      materialCoordinates: init.materialCoordinates,
      triangles: init.triangles,
      distances: { indices: init.distanceIndices, restLengths: init.distanceRestLengths, compliances: init.distanceCompliances, lambdas: new Float32Array(init.distanceRestLengths.length), kinds: init.distanceKinds },
      shears: { indices: init.shearIndices, restCosines: init.shearRestCosines, compliances: init.shearCompliances, lambdas: new Float32Array(init.shearRestCosines.length) },
      seams: { indices: init.seamIndices, weights: init.seamWeights, restDistances: init.seamRestDistances, compliances: init.seamCompliances, relaxations: init.seamRelaxations, lambdas: new Float32Array(init.seamRestDistances.length), seamGroupIds: init.seamGroupIds },
      pins: { indices: init.pinIndices, targets: init.pinTargets },
      config: { ...init.config, gravity: [0, 0, 0] },
    });
    const before = measureXpbdDiagnostics(state);
    for (let step = 0; step < 60; step += 1) stepXpbd(state);
    const after = measureXpbdDiagnostics(state, 60);
    expect(state.invalid).toBe(false);
    expect(after.seamErrorAverage).toBeLessThan(before.seamErrorAverage);
  });
});

function shortenTrouser(garment: GarmentDraft): GarmentDraft {
  return {
    ...garment,
    id: `${garment.id}:shorts-topology`,
    name: "Shortened trouser topology",
    pieces: garment.pieces.map((piece) => {
      const ys = piece.points.map((point) => point.yMm);
      const top = Math.min(...ys);
      const factor = 0.58;
      return {
        ...piece,
        points: piece.points.map((point) => scalePointY(point, top, factor)),
      };
    }),
  };
}

function scalePointY(point: PatternPoint, originY: number, factor: number): PatternPoint {
  const scaleY = (value: number) => originY + (value - originY) * factor;
  return {
    ...point,
    yMm: scaleY(point.yMm),
    ...(point.handleIn ? { handleIn: { ...point.handleIn, yMm: scaleY(point.handleIn.yMm) } } : {}),
    ...(point.handleOut ? { handleOut: { ...point.handleOut, yMm: scaleY(point.handleOut.yMm) } } : {}),
  };
}
