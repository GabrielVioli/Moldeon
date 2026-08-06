import type { AvatarParametricModel, AvatarVector3 } from "./AvatarParametricModel";
import { sampleArmRadius, sampleLegRadius, sampleTorsoAxes } from "./AvatarParametricModel";

export type AvatarCollisionProxy =
  | {
      id: string;
      kind: "ellipsoid";
      center: AvatarVector3;
      radii: AvatarVector3;
      region: string;
    }
  | {
      id: string;
      kind: "capsule";
      start: AvatarVector3;
      end: AvatarVector3;
      radius: number;
      region: string;
    };

export interface AvatarCollisionModel {
  version: "avatar-collision@1";
  proxies: AvatarCollisionProxy[];
}

export function buildAvatarCollisionModel(model: AvatarParametricModel): AvatarCollisionModel {
  const bust = sampleTorsoAxes(model, model.landmarks.bustY);
  const waist = sampleTorsoAxes(model, model.landmarks.waistY);
  const hip = sampleTorsoAxes(model, model.landmarks.hipY);
  const headHeight = Math.max(0.18, model.landmarks.headTopY - model.landmarks.neckY);
  const headRadius = headHeight * 0.36;
  const upperArmRadius = sampleArmRadius(model, 0.08);
  const forearmRadius = sampleArmRadius(model, model.measurements.armLengthMm * 0.00072);
  const thighRadius = sampleLegRadius(model, model.landmarks.crotchY - 0.04);
  const calfRadius = sampleLegRadius(model, model.landmarks.kneeY - 0.08);

  return {
    version: "avatar-collision@1",
    proxies: [
      {
        id: "collision:chest",
        kind: "ellipsoid",
        center: [0, (model.landmarks.shoulderY + model.landmarks.bustY) / 2, 0],
        radii: [bust.halfWidth, (model.landmarks.shoulderY - model.landmarks.bustY) * 0.72, bust.halfDepth],
        region: "torso",
      },
      {
        id: "collision:abdomen",
        kind: "ellipsoid",
        center: [0, (model.landmarks.bustY + model.landmarks.waistY) / 2, 0],
        radii: [(bust.halfWidth + waist.halfWidth) / 2, (model.landmarks.bustY - model.landmarks.waistY) * 0.64, (bust.halfDepth + waist.halfDepth) / 2],
        region: "torso",
      },
      {
        id: "collision:pelvis",
        kind: "ellipsoid",
        center: [0, (model.landmarks.waistY + model.landmarks.crotchY) / 2, 0],
        radii: [hip.halfWidth, (model.landmarks.waistY - model.landmarks.crotchY) * 0.58, hip.halfDepth],
        region: "hip",
      },
      {
        id: "collision:head",
        kind: "ellipsoid",
        center: [0, model.landmarks.headCenterY, 0],
        radii: [headRadius * 0.78, headHeight * 0.48, headRadius],
        region: "head",
      },
      capsule("collision:upper-arm-left", model.joints.shoulderLeft, model.joints.elbowLeft, upperArmRadius, "arm-left"),
      capsule("collision:forearm-left", model.joints.elbowLeft, model.joints.wristLeft, forearmRadius, "arm-left"),
      capsule("collision:upper-arm-right", model.joints.shoulderRight, model.joints.elbowRight, upperArmRadius, "arm-right"),
      capsule("collision:forearm-right", model.joints.elbowRight, model.joints.wristRight, forearmRadius, "arm-right"),
      capsule("collision:thigh-left", model.joints.hipLeft, model.joints.kneeLeft, thighRadius, "leg-left"),
      capsule("collision:calf-left", model.joints.kneeLeft, model.joints.ankleLeft, calfRadius, "leg-left"),
      capsule("collision:thigh-right", model.joints.hipRight, model.joints.kneeRight, thighRadius, "leg-right"),
      capsule("collision:calf-right", model.joints.kneeRight, model.joints.ankleRight, calfRadius, "leg-right"),
    ],
  };
}

function capsule(
  id: string,
  start: AvatarVector3,
  end: AvatarVector3,
  radius: number,
  region: string,
): AvatarCollisionProxy {
  return { id, kind: "capsule", start: [...start], end: [...end], radius, region };
}
