import { resolveAvatarAnchor, type AvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { IDENTITY_BODY_TRANSFORM, type SimulationBodyTransform } from "./bodyCollision";

export type BodyRegistrationStatus = "registered" | "body-placement-required";

export interface SimulationBodyRegistration {
  status: BodyRegistrationStatus;
  transform: SimulationBodyTransform;
  source: "placement-anchors" | "unavailable";
  registeredInstanceIds: string[];
  residualMeanM: number;
  residualMaxM: number;
  warning?: string;
}

/**
 * Registers the static parametric body into the coarse/fine garment world.
 *
 * The coarse assembly intentionally owns its own origin. Body registration is
 * therefore explicit and separate from both assembly and collision. Only
 * existing confirmed placement/anchor metadata can authorize this transform.
 * No garment name/type or geometry classifier is consulted.
 */
export function resolveSimulationBodyRegistration(
  state: Pick<GarmentAssemblyState, "positions" | "instances">,
  avatar: AvatarParametricModel,
): SimulationBodyRegistration {
  const correspondences: Array<{
    instanceId: string;
    garment: [number, number, number];
    body: [number, number, number];
  }> = [];

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
    correspondences.push({ instanceId: instance.id, garment, body });
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

  // Body -> garment. Rotation stays identity until explicit orientation metadata
  // supplies a non-ambiguous rigid frame. Arbitrary scale is never permitted.
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
