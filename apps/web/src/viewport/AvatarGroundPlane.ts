import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";
import { transformPoint, type SimulationBodyTransform } from "../physics/bodyCollision";

export const AVATAR_FLOOR_CLEARANCE_M = 0.002;

/**
 * Resolves the visual floor from the same registered body frame used by the
 * visible mesh and collision proxies. Garment assembly coordinates are not
 * guaranteed to put the avatar's feet at world Y=0.
 */
export function resolveAvatarFloorPosition(
  avatar: AvatarParametricModel,
  transform: SimulationBodyTransform,
): [number, number, number] {
  const ground = transformPoint([0, avatar.landmarks.groundY, 0], transform);
  return [ground[0], ground[1] - AVATAR_FLOOR_CLEARANCE_M, ground[2]];
}
