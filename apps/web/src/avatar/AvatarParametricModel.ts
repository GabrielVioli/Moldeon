import type {
  BodyAnchorId,
  BodyMeasurements,
  BodyType,
  PatternPreviewPlacement,
  PreviewBodySide,
  PreviewRegion,
  PreviewSurface,
} from "../domain/pattern";
import type { MeasurementOrigin, MeasurementProfile } from "../domain/parametricMeasurements";
import { buildHumanBodyModel, type HumanBodyModel } from "./HumanBodyModel";

export type AvatarVector3 = [number, number, number];
export type AvatarArrangementAnchorId = BodyAnchorId | "head";

export interface AvatarResolvedMeasurements {
  heightMm: number;
  bustMm: number;
  waistMm: number;
  hipMm: number;
  shoulderWidthMm: number;
  torsoLengthMm: number;
  armLengthMm: number;
  bicepMm: number;
  wristMm: number;
  inseamMm: number;
  thighMm: number;
  calfMm: number;
  ankleMm: number;
}

export interface AvatarLandmarks {
  groundY: number;
  ankleY: number;
  kneeY: number;
  crotchY: number;
  hipY: number;
  waistY: number;
  bustY: number;
  shoulderY: number;
  neckY: number;
  headCenterY: number;
  headTopY: number;
}

export interface AvatarJoints {
  shoulderLeft: AvatarVector3;
  shoulderRight: AvatarVector3;
  elbowLeft: AvatarVector3;
  elbowRight: AvatarVector3;
  wristLeft: AvatarVector3;
  wristRight: AvatarVector3;
  hipLeft: AvatarVector3;
  hipRight: AvatarVector3;
  kneeLeft: AvatarVector3;
  kneeRight: AvatarVector3;
  ankleLeft: AvatarVector3;
  ankleRight: AvatarVector3;
}

export interface AvatarArrangementAnchor {
  id: AvatarArrangementAnchorId;
  region: PreviewRegion | "neck" | "head" | "shoulder";
  surface: PreviewSurface;
  bodySide: PreviewBodySide;
  position: AvatarVector3;
  outwardNormal: AvatarVector3;
  axis: AvatarVector3;
  tangent: AvatarVector3;
  initialMarginM: number;
}

export interface AvatarTorsoStation {
  y: number;
  halfWidth: number;
  halfDepth: number;
}

/**
 * Compatibility facade for garment arrangement. All anatomy now originates in
 * HumanBodyModel; this interface only preserves the older arrangement API.
 */
export interface AvatarParametricModel {
  version: "avatar-parametric@1";
  bodyType: BodyType;
  humanBody: HumanBodyModel;
  measurements: AvatarResolvedMeasurements;
  measurementOrigins?: Record<string, MeasurementOrigin>;
  landmarks: AvatarLandmarks;
  joints: AvatarJoints;
  torsoStations: AvatarTorsoStation[];
  anchors: AvatarArrangementAnchor[];
  armPoseAngleDeg: number;
  legPoseAngleDeg: number;
}

export interface AvatarMeasurementContext {
  profile?: MeasurementProfile;
  origins?: Partial<Record<keyof BodyMeasurements, MeasurementOrigin>>;
}

export function buildAvatarParametricModel(
  input: BodyMeasurements,
  bodyType: BodyType,
  measurementContext: AvatarMeasurementContext = {},
): AvatarParametricModel {
  // 11.0.4B is intentionally the canonical female implementation. Keeping the
  // bodyType in the facade preserves the document API while the female body is
  // the single geometric source for the implemented path.
  const humanBody = buildHumanBodyModel(input, {
    measurementProfile: measurementContext.profile,
    measurementOrigins: measurementContext.origins,
  });
  const body = humanBody.measurements;
  const measurements: AvatarResolvedMeasurements = {
    heightMm: body.heightMm,
    bustMm: body.bustMm,
    waistMm: body.waistMm,
    hipMm: body.fullHipMm,
    shoulderWidthMm: body.shoulderWidthMm,
    torsoLengthMm: body.torsoLengthMm,
    armLengthMm: body.armLengthMm,
    bicepMm: body.bicepMm,
    wristMm: body.wristMm,
    inseamMm: body.inseamMm,
    thighMm: body.thighMm,
    calfMm: body.calfMm,
    ankleMm: body.ankleMm,
  };

  const position = (id: keyof HumanBodyModel["landmarks"]): AvatarVector3 =>
    [...humanBody.landmarks[id].position] as AvatarVector3;
  const joint = (id: string): AvatarVector3 => {
    const value = humanBody.joints[id];
    if (!value) throw new Error(`HumanBody joint ausente: ${id}`);
    return [...value.position] as AvatarVector3;
  };

  const shoulderLeft = joint("shoulder-left");
  const shoulderRight = joint("shoulder-right");
  const elbowLeft = joint("elbow-left");
  const elbowRight = joint("elbow-right");
  const wristLeft = joint("wrist-left");
  const wristRight = joint("wrist-right");
  const hipLeft = joint("hip-left");
  const hipRight = joint("hip-right");
  const kneeLeft = joint("knee-left");
  const kneeRight = joint("knee-right");
  const ankleLeft = joint("ankle-left");
  const ankleRight = joint("ankle-right");

  const bustLeft = position("bust-apex-left");
  const waistFront = position("center-front-waist");
  const hipFront = position("full-hip-front");
  const crotchLeft = position("inseam-top-left");
  const neckBase = position("neck-base-center");
  const headTop = position("head-top");
  const landmarks: AvatarLandmarks = {
    groundY: 0,
    ankleY: ankleLeft[1],
    kneeY: kneeLeft[1],
    crotchY: crotchLeft[1],
    hipY: hipFront[1],
    waistY: waistFront[1],
    bustY: bustLeft[1],
    shoulderY: (shoulderLeft[1] + shoulderRight[1]) * 0.5,
    neckY: neckBase[1],
    headCenterY: (neckBase[1] + headTop[1]) * 0.55,
    headTopY: headTop[1],
  };

  const joints: AvatarJoints = {
    shoulderLeft,
    shoulderRight,
    elbowLeft,
    elbowRight,
    wristLeft,
    wristRight,
    hipLeft,
    hipRight,
    kneeLeft,
    kneeRight,
    ankleLeft,
    ankleRight,
  };

  const stationIds = ["crotch", "full-hip", "waist", "bust", "shoulder"] as const;
  const torsoStations: AvatarTorsoStation[] = stationIds.map((id) => {
    const section = humanBody.crossSections.find((candidate) => candidate.id === id);
    if (!section) throw new Error(`HumanBody cross-section ausente: ${id}`);
    return {
      y: section.yM,
      halfWidth: section.halfWidthM,
      halfDepth: (section.frontDepthM + section.backDepthM) * 0.5,
    };
  });

  const armVector: AvatarVector3 = [
    wristRight[0] - shoulderRight[0],
    wristRight[1] - shoulderRight[1],
    wristRight[2] - shoulderRight[2],
  ];
  const legVector: AvatarVector3 = [
    ankleRight[0] - hipRight[0],
    ankleRight[1] - hipRight[1],
    ankleRight[2] - hipRight[2],
  ];
  const armPoseAngleDeg = Math.atan2(Math.abs(armVector[0]), Math.abs(armVector[1])) * 180 / Math.PI;
  const legPoseAngleDeg = Math.atan2(Math.abs(legVector[0]), Math.abs(legVector[1])) * 180 / Math.PI;

  const model: AvatarParametricModel = {
    version: "avatar-parametric@1",
    bodyType,
    humanBody,
    measurements,
    measurementOrigins: { ...humanBody.measurementSources },
    landmarks,
    joints,
    torsoStations,
    anchors: [],
    armPoseAngleDeg,
    legPoseAngleDeg,
  };
  model.anchors = createAnchors(model);
  return model;
}

export function resolveAvatarAnchor(
  model: AvatarParametricModel,
  placement: Pick<PatternPreviewPlacement, "region" | "surface" | "bodySide" | "bodyAnchorId">,
): AvatarArrangementAnchor | undefined {
  if (placement.bodyAnchorId) return anchorById(model, placement.bodyAnchorId);
  const surface = placement.surface === "back" ? "back" : "front";
  if (placement.region === "arm") {
    if (placement.bodySide === "left") return anchorById(model, "arm-left");
    if (placement.bodySide === "right") return anchorById(model, "arm-right");
    return undefined;
  }
  if (placement.region === "leg") {
    if (placement.bodySide === "left") return anchorById(model, "leg-left");
    if (placement.bodySide === "right") return anchorById(model, "leg-right");
    return undefined;
  }
  if (placement.region === "waist") return anchorById(model, surface === "back" ? "waist-back" : "waist-front");
  if (placement.region === "hip") return anchorById(model, surface === "back" ? "hip-back" : "hip-front");
  return anchorById(model, surface === "back" ? "torso-back" : "torso-front");
}

export function sampleTorsoAxes(
  model: AvatarParametricModel,
  y: number,
): { halfWidth: number; halfDepth: number } {
  const stations = model.torsoStations;
  if (y <= stations[0].y) return { halfWidth: stations[0].halfWidth, halfDepth: stations[0].halfDepth };
  if (y >= stations[stations.length - 1].y) {
    const station = stations[stations.length - 1];
    return { halfWidth: station.halfWidth, halfDepth: station.halfDepth };
  }
  for (let index = 1; index < stations.length; index += 1) {
    const lower = stations[index - 1];
    const upper = stations[index];
    if (y <= upper.y) {
      const t = clamp((y - lower.y) / Math.max(1e-6, upper.y - lower.y), 0, 1);
      return {
        halfWidth: lerp(lower.halfWidth, upper.halfWidth, t),
        halfDepth: lerp(lower.halfDepth, upper.halfDepth, t),
      };
    }
  }
  const last = stations[stations.length - 1];
  return { halfWidth: last.halfWidth, halfDepth: last.halfDepth };
}

export function sampleArmRadius(model: AvatarParametricModel, distanceFromShoulder: number): number {
  const armLength = model.measurements.armLengthMm * 0.001;
  const t = clamp(distanceFromShoulder / Math.max(armLength, 1e-6), 0, 1);
  const bicepRadius = model.measurements.bicepMm * 0.001 / (Math.PI * 2);
  const wristRadius = model.measurements.wristMm * 0.001 / (Math.PI * 2);
  return lerp(bicepRadius * 1.02, wristRadius, Math.pow(t, 0.82));
}

export function sampleLegRadius(model: AvatarParametricModel, y: number): number {
  const thighRadius = model.measurements.thighMm * 0.001 / (Math.PI * 2);
  const calfRadius = model.measurements.calfMm * 0.001 / (Math.PI * 2);
  const ankleRadius = model.measurements.ankleMm * 0.001 / (Math.PI * 2);
  const { crotchY, kneeY, ankleY } = model.landmarks;
  if (y >= kneeY) {
    const t = clamp((crotchY - y) / Math.max(1e-6, crotchY - kneeY), 0, 1);
    return lerp(thighRadius, calfRadius * 1.06, t);
  }
  const t = clamp((kneeY - y) / Math.max(1e-6, kneeY - ankleY), 0, 1);
  return lerp(calfRadius * 1.06, ankleRadius, t);
}

export function anchorById(
  model: AvatarParametricModel,
  id: AvatarArrangementAnchorId,
): AvatarArrangementAnchor | undefined {
  return model.anchors.find((anchor) => anchor.id === id);
}

export function normalize3(vector: AvatarVector3): AvatarVector3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length <= 1e-9) return [0, 1, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function cross3(a: AvatarVector3, b: AvatarVector3): AvatarVector3 {
  return normalize3([
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]);
}

export function addScaled3(origin: AvatarVector3, direction: AvatarVector3, scale: number): AvatarVector3 {
  return [
    origin[0] + direction[0] * scale,
    origin[1] + direction[1] * scale,
    origin[2] + direction[2] * scale,
  ];
}

function createAnchors(model: AvatarParametricModel): AvatarArrangementAnchor[] {
  const body = model.humanBody;
  const front: AvatarVector3 = [0, 0, 1];
  const back: AvatarVector3 = [0, 0, -1];
  const down: AvatarVector3 = [0, -1, 0];
  const horizontal: AvatarVector3 = [1, 0, 0];
  const point = (id: keyof HumanBodyModel["landmarks"]): AvatarVector3 =>
    [...body.landmarks[id].position] as AvatarVector3;
  const normal = (id: keyof HumanBodyModel["landmarks"]): AvatarVector3 =>
    [...body.landmarks[id].normal] as AvatarVector3;

  const leftArmAxis = normalize3([
    model.joints.wristLeft[0] - model.joints.shoulderLeft[0],
    model.joints.wristLeft[1] - model.joints.shoulderLeft[1],
    model.joints.wristLeft[2] - model.joints.shoulderLeft[2],
  ]);
  const rightArmAxis = normalize3([
    model.joints.wristRight[0] - model.joints.shoulderRight[0],
    model.joints.wristRight[1] - model.joints.shoulderRight[1],
    model.joints.wristRight[2] - model.joints.shoulderRight[2],
  ]);
  const leftLegAxis = normalize3([
    model.joints.ankleLeft[0] - model.joints.hipLeft[0],
    model.joints.ankleLeft[1] - model.joints.hipLeft[1],
    model.joints.ankleLeft[2] - model.joints.hipLeft[2],
  ]);
  const rightLegAxis = normalize3([
    model.joints.ankleRight[0] - model.joints.hipRight[0],
    model.joints.ankleRight[1] - model.joints.hipRight[1],
    model.joints.ankleRight[2] - model.joints.hipRight[2],
  ]);

  const make = (
    id: AvatarArrangementAnchorId,
    region: AvatarArrangementAnchor["region"],
    surface: PreviewSurface,
    bodySide: PreviewBodySide,
    positionValue: AvatarVector3,
    outwardNormal: AvatarVector3,
    axis: AvatarVector3,
    tangent: AvatarVector3,
    initialMarginM: number,
  ): AvatarArrangementAnchor => ({
    id,
    region,
    surface,
    bodySide,
    position: positionValue,
    outwardNormal: normalize3(outwardNormal),
    axis: normalize3(axis),
    tangent: normalize3(tangent),
    initialMarginM,
  });

  return [
    make("torso-front", "torso", "front", "center", point("bust-apex-right").map((value, index) => index === 0 ? 0 : value) as AvatarVector3, front, down, horizontal, 0.014),
    make("torso-back", "torso", "back", "center", [0, model.landmarks.bustY, point("center-back-waist")[2]], back, down, [-1, 0, 0], 0.014),
    make("shoulder-left", "shoulder", "side", "left", point("shoulder-left"), normal("shoulder-left"), leftArmAxis, front, 0.012),
    make("shoulder-right", "shoulder", "side", "right", point("shoulder-right"), normal("shoulder-right"), rightArmAxis, front, 0.012),
    make("arm-left", "arm", "side", "left", point("armhole-left"), [-1, 0, 0], leftArmAxis, front, 0.012),
    make("arm-right", "arm", "side", "right", point("armhole-right"), [1, 0, 0], rightArmAxis, front, 0.012),
    make("waist-front", "waist", "front", "center", point("center-front-waist"), normal("center-front-waist"), down, horizontal, 0.012),
    make("waist-back", "waist", "back", "center", point("center-back-waist"), normal("center-back-waist"), down, [-1, 0, 0], 0.012),
    make("hip-front", "hip", "front", "center", point("full-hip-front"), normal("full-hip-front"), down, horizontal, 0.014),
    make("hip-back", "hip", "back", "center", point("full-hip-back"), normal("full-hip-back"), down, [-1, 0, 0], 0.014),
    make("hip-left", "hip", "side", "left", [-sampleTorsoAxes(model, model.landmarks.hipY).halfWidth, model.landmarks.hipY, 0], [-1, 0, 0], down, front, 0.014),
    make("hip-right", "hip", "side", "right", [sampleTorsoAxes(model, model.landmarks.hipY).halfWidth, model.landmarks.hipY, 0], [1, 0, 0], down, front, 0.014),
    make("leg-left", "leg", "side", "left", model.joints.hipLeft, [-1, 0, 0], leftLegAxis, front, 0.012),
    make("leg-right", "leg", "side", "right", model.joints.hipRight, [1, 0, 0], rightLegAxis, front, 0.012),
    make("neck", "neck", "front", "center", point("neck-base-center"), normal("neck-base-center"), [0, 1, 0], horizontal, 0.01),
    make("head", "head", "front", "center", [0, model.landmarks.headCenterY, 0], front, [0, 1, 0], horizontal, 0.01),
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
