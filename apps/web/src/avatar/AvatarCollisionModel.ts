import type { HumanBodyMesh } from "./HumanBodyModel";
import type { AvatarParametricModel, AvatarVector3 } from "./AvatarParametricModel";

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
  sourceBodyVersion: "human-body-female@1";
  /** Canonical fitting/collision surface. Future triangle collision consumes this directly. */
  mesh: HumanBodyMesh;
  /**
   * Compatibility proxies for the current XPBD collider packer. They are now
   * derived from the same canonical body instead of defining a second body.
   */
  proxies: AvatarCollisionProxy[];
}

export function buildAvatarCollisionModel(model: AvatarParametricModel): AvatarCollisionModel {
  const body = model.humanBody;
  const bust = crossSection(body, "bust");
  const waist = crossSection(body, "waist");
  const hip = crossSection(body, "full-hip");
  const shoulder = body.landmarks["shoulder-left"].position[1];
  const bustY = body.landmarks["bust-apex-left"].position[1];
  const waistY = body.landmarks["center-front-waist"].position[1];
  const hipY = body.landmarks["full-hip-front"].position[1];
  const crotchY = body.landmarks["inseam-top-left"].position[1];
  const headTopY = body.landmarks["head-top"].position[1];
  const neckY = body.landmarks["neck-base-center"].position[1];
  const headHeight = Math.max(0.18, headTopY - neckY);
  const headRadius = body.measurements.headCircumferenceMm * 0.001 / (2 * Math.PI);
  const upperArmRadius = ellipseEquivalentRadius(body.measurements.bicepMm);
  const elbowRadius = ellipseEquivalentRadius(body.measurements.elbowMm);
  const wristRadius = ellipseEquivalentRadius(body.measurements.wristMm);
  const thighRadius = ellipseEquivalentRadius(body.measurements.thighMm);
  const kneeRadius = ellipseEquivalentRadius(body.measurements.kneeMm);
  const calfRadius = ellipseEquivalentRadius(body.measurements.calfMm);

  const joint = (id: string): AvatarVector3 => {
    const value = body.joints[id];
    if (!value) throw new Error(`HumanBody joint ausente: ${id}`);
    return [...value.position] as AvatarVector3;
  };

  return {
    version: "avatar-collision@1",
    sourceBodyVersion: body.version,
    mesh: body.collisionMesh,
    proxies: [
      {
        id: "collision:chest",
        kind: "ellipsoid",
        center: [0, (shoulder + bustY) / 2, bust.centerZM],
        radii: [bust.halfWidthM, Math.max(0.07, (shoulder - bustY) * 0.72), (bust.frontDepthM + bust.backDepthM) * 0.5],
        region: "torso",
      },
      {
        id: "collision:abdomen",
        kind: "ellipsoid",
        center: [0, (bustY + waistY) / 2, waist.centerZM],
        radii: [(bust.halfWidthM + waist.halfWidthM) / 2, Math.max(0.07, (bustY - waistY) * 0.64), ((bust.frontDepthM + bust.backDepthM) + (waist.frontDepthM + waist.backDepthM)) * 0.25],
        region: "torso",
      },
      {
        id: "collision:pelvis",
        kind: "ellipsoid",
        center: [0, (waistY + crotchY) / 2, hip.centerZM],
        radii: [hip.halfWidthM, Math.max(0.09, (waistY - crotchY) * 0.58), (hip.frontDepthM + hip.backDepthM) * 0.5],
        region: "hip",
      },
      {
        id: "collision:head",
        kind: "ellipsoid",
        center: [0, (headTopY + neckY) * 0.55, -headRadius * 0.05],
        radii: [headRadius * 0.82, headHeight * 0.48, headRadius * 0.96],
        region: "head",
      },
      capsule("collision:upper-arm-left", joint("shoulder-left"), joint("elbow-left"), upperArmRadius, "arm-left"),
      capsule("collision:forearm-left", joint("elbow-left"), joint("wrist-left"), (elbowRadius + wristRadius) * 0.5, "arm-left"),
      capsule("collision:upper-arm-right", joint("shoulder-right"), joint("elbow-right"), upperArmRadius, "arm-right"),
      capsule("collision:forearm-right", joint("elbow-right"), joint("wrist-right"), (elbowRadius + wristRadius) * 0.5, "arm-right"),
      capsule("collision:thigh-left", joint("hip-left"), joint("knee-left"), thighRadius, "leg-left"),
      capsule("collision:calf-left", joint("knee-left"), joint("ankle-left"), (kneeRadius + calfRadius) * 0.5, "leg-left"),
      capsule("collision:thigh-right", joint("hip-right"), joint("knee-right"), thighRadius, "leg-right"),
      capsule("collision:calf-right", joint("knee-right"), joint("ankle-right"), (kneeRadius + calfRadius) * 0.5, "leg-right"),
    ],
  };
}

function crossSection(model: AvatarParametricModel["humanBody"], id: string) {
  const section = model.crossSections.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`HumanBody cross-section ausente: ${id}`);
  return section;
}

function ellipseEquivalentRadius(circumferenceMm: number): number {
  return circumferenceMm * 0.001 / (2 * Math.PI);
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
