import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import {
  DEFAULT_BODY_CONTACT_SKIN_M,
  createBodyCollisionRuntimeState,
} from "./bodyCollision";
import { buildTriangleMaterialReference, createXpbdState, type XpbdState } from "./xpbd";

/**
 * Canonical typed-array boundary between GarmentXpbdAdapter and the Worker.
 * Keeping this construction outside the worker event loop makes the exact
 * initialize/updateGeometry mapping directly regression-testable.
 */
export function createXpbdWorkerState(payload: XpbdInitializationData): XpbdState {
  const particleCount = payload.positions.length / 3;
  const body = createBodyCollisionRuntimeState(
    {
      kinds: payload.bodyColliderKinds ?? new Uint8Array(0),
      data: payload.bodyColliderData ?? new Float32Array(0),
      regions: payload.bodyColliderRegions ?? [],
    },
    payload.particleHalfThicknessM ?? new Float32Array(particleCount),
    payload.particleFriction ?? new Float32Array(particleCount),
    payload.bodyCollisionEnabled ?? false,
    payload.bodyContactSkinM ?? DEFAULT_BODY_CONTACT_SKIN_M,
  );

  return createXpbdState({
    positions: payload.positions,
    previousPositions: payload.previousPositions,
    predictedPositions: payload.predictedPositions,
    velocities: payload.velocities,
    inverseMasses: payload.inverseMasses,
    restPositions: payload.restPositions,
    materialCoordinates: payload.materialCoordinates,
    triangles: payload.triangles,
    triangleMaterial: {
      ...buildTriangleMaterialReference(payload.materialCoordinates, payload.triangles, payload.positions),
      restAreas: payload.triangleRestAreas,
      orientations: payload.triangleMaterialOrientations,
    },
    distances: {
      indices: payload.distanceIndices,
      restLengths: payload.distanceRestLengths,
      compliances: payload.distanceCompliances,
      lambdas: new Float32Array(payload.distanceRestLengths.length),
      kinds: payload.distanceKinds,
      panelIds: payload.distancePanelIds,
      fabricIds: payload.distanceFabricIds,
    },
    shears: {
      indices: payload.shearIndices,
      restCosines: payload.shearRestCosines,
      compliances: payload.shearCompliances,
      lambdas: new Float32Array(payload.shearRestCosines.length),
    },
    bends: {
      indices: payload.bendIndices,
      restAngles: payload.bendRestAngles,
      compliances: payload.bendCompliances,
      lambdas: new Float32Array(payload.bendRestAngles.length),
    },
    seams: {
      indices: payload.seamIndices,
      weights: payload.seamWeights,
      restDistances: payload.seamRestDistances,
      compliances: payload.seamCompliances,
      relaxations: payload.seamRelaxations,
      lambdas: new Float32Array(payload.seamRestDistances.length),
      seamGroupIds: payload.seamGroupIds,
    },
    pins: { indices: payload.pinIndices, targets: payload.pinTargets },
    body,
    config: payload.config,
  });
}
