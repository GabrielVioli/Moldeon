import { resolveAvatarAnchor, type AvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { IDENTITY_BODY_TRANSFORM, type SimulationBodyTransform } from "./bodyCollision";

export type BodyRegistrationStatus = "registered" | "body-placement-required";

export interface SimulationBodyRegistration {
  status: BodyRegistrationStatus;
  transform: SimulationBodyTransform;
  source: "placement-anchors" | "lower-shell-top-plane" | "unavailable";
  registeredInstanceIds: string[];
  residualMeanM: number;
  residualMaxM: number;
  warning?: string;
}

interface RegistrationPair {
  instanceId: string;
  region: string;
  surface: string;
  neutralPlacement: boolean;
  garment: [number, number, number];
  body: [number, number, number];
}

/**
 * Registers the static parametric body into the coarse/fine garment world.
 *
 * Body placement stays separate from assembly and collision. Confirmed closed
 * lower shells use their assembled upper plane as the waist reference; other
 * placements retain the generic anchor fit. No garment/template name is read.
 */
export function resolveSimulationBodyRegistration(
  state: Pick<GarmentAssemblyState, "positions" | "instances">,
  avatar: AvatarParametricModel,
): SimulationBodyRegistration {
  const correspondences: RegistrationPair[] = [];

  for (const instance of state.instances) {
    if (instance.placement.region === "custom" || instance.placement.surface === "custom") continue;
    const anchor = resolveAvatarAnchor(avatar, instance.placement);
    if (!anchor) continue;
    const garment = instanceCentroid(state.positions, instance.particleStart, instance.vertexCount);
    const body: [number, number, number] = [
      anchor.position[0] + instance.placement.offsetXMm * 0.001,
      anchor.position[1] + instance.placement.offsetYMm * 0.001,
      anchor.position[2] + instance.placement.offsetZMm * 0.001,
    ];
    correspondences.push({
      instanceId: instance.id,
      region: instance.placement.region,
      surface: instance.placement.surface,
      neutralPlacement: instance.placement.offsetXMm === 0
        && instance.placement.offsetYMm === 0
        && instance.placement.offsetZMm === 0
        && instance.placement.rotationDeg === 0,
      garment,
      body,
    });
  }

  if (correspondences.length === 0) {
    return {
      status: "body-placement-required",
      transform: IDENTITY_BODY_TRANSFORM,
      source: "unavailable",
      registeredInstanceIds: [],
      residualMeanM: 0,
      residualMaxM: 0,
      warning: "body-placement-required: o documento não possui placement corporal confirmado suficiente para registrar corpo e roupa.",
    };
  }

  const surfaces = new Set(correspondences.map((pair) => pair.surface));
  const isClosedLowerShell = correspondences.length >= 2
    && correspondences.every((pair) => pair.region === "hip" || pair.region === "waist")
    && surfaces.has("front")
    && surfaces.has("back");
  if (isClosedLowerShell) return registerClosedLowerShell(state, avatar, correspondences);

  return registerByPlacementAnchors(correspondences);
}

function registerClosedLowerShell(
  state: Pick<GarmentAssemblyState, "positions" | "instances">,
  avatar: AvatarParametricModel,
  correspondences: readonly RegistrationPair[],
): SimulationBodyRegistration {
  const registered = new Set(correspondences.map((pair) => pair.instanceId));
  let sumX = 0;
  let sumZ = 0;
  let particleCount = 0;
  let garmentTopY = Number.NEGATIVE_INFINITY;
  const instanceTopY: number[] = [];

  for (const instance of state.instances) {
    if (!registered.has(instance.id)) continue;
    let topY = Number.NEGATIVE_INFINITY;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const offset = (instance.particleStart + local) * 3;
      sumX += state.positions[offset];
      sumZ += state.positions[offset + 2];
      particleCount += 1;
      topY = Math.max(topY, state.positions[offset + 1]);
    }
    if (Number.isFinite(topY)) {
      instanceTopY.push(topY);
      garmentTopY = Math.max(garmentTopY, topY);
    }
  }

  const count = Math.max(1, particleCount);
  const translation: [number, number, number] = [
    sumX / count,
    garmentTopY - avatar.landmarks.waistY,
    sumZ / count,
  ];
  const registeredWaistY = avatar.landmarks.waistY + translation[1];
  const residuals = instanceTopY.map((topY) => Math.abs(topY - registeredWaistY));

  return {
    status: "registered",
    transform: { translation, rotation: [0, 0, 0, 1] },
    source: "lower-shell-top-plane",
    registeredInstanceIds: correspondences.map((pair) => pair.instanceId),
    residualMeanM: residuals.length > 0 ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length : 0,
    residualMaxM: residuals.length > 0 ? Math.max(...residuals) : 0,
  };
}

function registerByPlacementAnchors(correspondences: readonly RegistrationPair[]): SimulationBodyRegistration {
  const translation: [number, number, number] = [0, 0, 0];
  for (const pair of correspondences) {
    translation[0] += pair.garment[0] - pair.body[0];
    translation[1] += pair.garment[1] - pair.body[1];
    translation[2] += pair.garment[2] - pair.body[2];
  }
  translation[0] /= correspondences.length;
  translation[1] /= correspondences.length;
  translation[2] /= correspondences.length;

  let residualTotal = 0;
  let residualMaxM = 0;
  for (const pair of correspondences) {
    const dx = pair.body[0] + translation[0] - pair.garment[0];
    const dy = pair.body[1] + translation[1] - pair.garment[1];
    const dz = pair.body[2] + translation[2] - pair.garment[2];
    const residual = Math.hypot(dx, dy, dz);
    residualTotal += residual;
    residualMaxM = Math.max(residualMaxM, residual);
  }

  return {
    status: "registered",
    transform: { translation, rotation: [0, 0, 0, 1] },
    source: "placement-anchors",
    registeredInstanceIds: correspondences.map((pair) => pair.instanceId),
    residualMeanM: residualTotal / correspondences.length,
    residualMaxM,
  };
}

function instanceCentroid(
  positions: Float32Array,
  particleStart: number,
  vertexCount: number,
): [number, number, number] {
  const centroid: [number, number, number] = [0, 0, 0];
  const count = Math.max(1, vertexCount);
  for (let local = 0; local < vertexCount; local += 1) {
    const offset = (particleStart + local) * 3;
    centroid[0] += positions[offset];
    centroid[1] += positions[offset + 1];
    centroid[2] += positions[offset + 2];
  }
  return [centroid[0] / count, centroid[1] / count, centroid[2] / count];
}
