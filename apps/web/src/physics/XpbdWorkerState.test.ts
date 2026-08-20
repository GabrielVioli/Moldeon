import { describe, expect, it } from "vitest";
import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import { BODY_COLLIDER_CAPSULE, BODY_COLLIDER_STRIDE } from "./bodyCollision";
import { measureXpbdDiagnostics, stepXpbd } from "./xpbd";
import { createXpbdWorkerState } from "./XpbdWorkerState";

describe("Prompt 11 Adapter → Worker body state boundary", () => {
  it("materializes collider/material buffers and produces body contacts in the Worker state", () => {
    const state = createXpbdWorkerState(initialization(true));

    expect(state.body.enabled).toBe(true);
    expect(state.body.colliders.kinds).toEqual(Uint8Array.of(BODY_COLLIDER_CAPSULE));
    expect(state.body.colliders.regions).toEqual(["canonical-capsule"]);
    expect(state.body.particleHalfThicknessM[0]).toBeCloseTo(0.002);
    expect(state.body.particleFriction[0]).toBeCloseTo(0.7);

    stepXpbd(state);
    const diagnostics = measureXpbdDiagnostics(state);

    expect(diagnostics.bodyCollisionEnabled).toBe(true);
    expect(diagnostics.bodyColliderCount).toBe(1);
    expect(diagnostics.bodyContactCount).toBe(1);
    expect(diagnostics.bodyContactsByRegion).toEqual({ "canonical-capsule": 1 });
    expect(diagnostics.maximumBodyPenetrationM).toBeGreaterThan(0);
    expect(diagnostics.bodyCollisionMs).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(state.positions[0], state.positions[1], state.positions[2])).toBeGreaterThan(0);
  });

  it("keeps the same packed body available but inactive when collision is disabled", () => {
    const state = createXpbdWorkerState(initialization(false));
    const before = [...state.positions];

    stepXpbd(state);
    const diagnostics = measureXpbdDiagnostics(state);

    expect(diagnostics.bodyColliderCount).toBe(1);
    expect(diagnostics.bodyCollisionEnabled).toBe(false);
    expect(diagnostics.bodyContactCount).toBe(0);
    expect([...state.positions]).toEqual(before);
  });
});

function initialization(bodyCollisionEnabled: boolean): XpbdInitializationData {
  const positions = new Float32Array([0, 0, 0]);
  const bodyColliderData = new Float32Array(BODY_COLLIDER_STRIDE);
  bodyColliderData.set([-0.1, 0, 0, 0.1, 0, 0, 0.05]);
  return {
    revision: "worker-body-boundary",
    topologyDiagnostics: {
      revision: "worker-body-boundary",
      panels: [],
      particleCount: 1,
      positionsLength: 3,
      triangleCount: 0,
      maximumTriangleIndex: -1,
      stretchConstraintCount: 0,
      shearConstraintCount: 0,
      bendConstraintCount: 0,
      seamConstraintCount: 0,
      seamConstraintsByGroup: {},
      finitePositionCount: 3,
      valid: true,
    },
    seamResidualAudit: {
      stage: "adapter",
      sampleCount: 0,
      meanResidualMm: 0,
      maxResidualMm: 0,
      groups: [],
      invariantErrors: [],
      maximumCorrespondenceJumpMm: 0,
    },
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(3),
    inverseMasses: Float32Array.of(1),
    restPositions: new Float32Array(positions),
    materialCoordinates: new Float32Array(2),
    triangles: new Uint32Array(0),
    triangleRestAreas: new Float32Array(0),
    triangleMaterialOrientations: new Int8Array(0),
    distanceIndices: new Uint32Array(0),
    distanceRestLengths: new Float32Array(0),
    distanceCompliances: new Float32Array(0),
    distanceKinds: new Uint8Array(0),
    distancePanelIds: [],
    distanceFabricIds: [],
    shearIndices: new Uint32Array(0),
    shearRestCosines: new Float32Array(0),
    shearCompliances: new Float32Array(0),
    bendIndices: new Uint32Array(0),
    bendRestAngles: new Float32Array(0),
    bendCompliances: new Float32Array(0),
    seamIndices: new Uint32Array(0),
    seamWeights: new Float32Array(0),
    seamRestDistances: new Float32Array(0),
    seamCompliances: new Float32Array(0),
    seamRelaxations: new Float32Array(0),
    seamGroupIds: [],
    pinIndices: new Uint32Array(0),
    pinTargets: new Float32Array(0),
    bodyColliderKinds: Uint8Array.of(BODY_COLLIDER_CAPSULE),
    bodyColliderData,
    bodyColliderRegions: ["canonical-capsule"],
    particleHalfThicknessM: Float32Array.of(0.002),
    particleFriction: Float32Array.of(0.7),
    bodyCollisionEnabled,
    bodyContactSkinM: 0,
    config: {
      fixedTimeStep: 1 / 120,
      maximumFrameDelta: 1 / 20,
      maximumSubsteps: 1,
      iterations: 1,
      damping: 1,
      gravity: [0, 0, 0],
      maximumCorrection: 0.035,
      maximumVelocity: 12,
      seamTolerance: 0.0025,
    },
  };
}
