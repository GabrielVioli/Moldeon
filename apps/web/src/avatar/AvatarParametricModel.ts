import type { BodyMeasurements, BodyType, PatternPreviewPlacement, PreviewBodySide, PreviewRegion, PreviewSurface } from "../domain/pattern";
import { createMeasurementProfile, measurementProfileToBodyMeasurements } from "../domain/parametricMeasurements";

export type AvatarVector3 = [number, number, number];

export type AvatarArrangementAnchorId =
  | "torso-front"
  | "torso-back"
  | "shoulder-left"
  | "shoulder-right"
  | "arm-left"
  | "arm-right"
  | "waist-front"
  | "waist-back"
  | "hip-front"
  | "hip-back"
  | "leg-left"
  | "leg-right"
  | "neck"
  | "head";

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

export interface AvatarParametricModel {
  version: "avatar-parametric@1";
  bodyType: BodyType;
  measurements: AvatarResolvedMeasurements;
  landmarks: AvatarLandmarks;
  joints: AvatarJoints;
  torsoStations: AvatarTorsoStation[];
  anchors: AvatarArrangementAnchor[];
  armPoseAngleDeg: number;
  legPoseAngleDeg: number;
}

export function buildAvatarParametricModel(
  input: BodyMeasurements,
  bodyType: BodyType,
): AvatarParametricModel {
  const resolved = measurementProfileToBodyMeasurements(createMeasurementProfile(input, bodyType));
  const measurements: AvatarResolvedMeasurements = {
    heightMm: positive(resolved.heightMm, 1700),
    bustMm: positive(resolved.bustMm, 900),
    waistMm: positive(resolved.waistMm, 740),
    hipMm: positive(resolved.hipMm, 960),
    shoulderWidthMm: positive(resolved.shoulderWidthMm, 410),
    torsoLengthMm: positive(resolved.torsoLengthMm, 620),
    armLengthMm: positive(resolved.armLengthMm, 590),
    bicepMm: positive(resolved.bicepMm, resolved.bustMm * 0.34),
    wristMm: positive(resolved.wristMm, resolved.bustMm * 0.18),
    inseamMm: positive(resolved.insideLegLengthMm ?? resolved.inseamMm, 790),
    thighMm: positive(resolved.thighMm, resolved.hipMm * 0.58),
    calfMm: positive(resolved.calfMm, resolved.hipMm * 0.38),
    ankleMm: positive(resolved.ankleCircumferenceMm, resolved.hipMm * 0.24),
  };

  const height = measurements.heightMm * 0.001;
  const ankleY = Math.max(0.055, height * 0.038);
  const crotchY = clamp(measurements.inseamMm * 0.001 + ankleY, height * 0.43, height * 0.52);
  const kneeY = clamp(
    positive(resolved.kneeHeightMm, measurements.inseamMm * 0.53) * 0.001 + ankleY,
    ankleY + 0.25,
    crotchY - 0.18,
  );
  const hipY = clamp(crotchY + height * 0.055, height * 0.49, height * 0.58);
  const waistY = clamp(
    hipY + positive(resolved.hipHeightMm, height * 1000 * 0.105) * 0.001,
    height * 0.57,
    height * 0.67,
  );
  const shoulderY = clamp(height - Math.max(0.27, height * 0.17), height * 0.78, height * 0.86);
  const bustY = clamp(
    shoulderY - positive(resolved.bustHeightMm, height * 1000 * 0.105) * 0.001,
    waistY + 0.08,
    shoulderY - 0.08,
  );
  const neckY = shoulderY + height * 0.055;
  const headCenterY = neckY + height * 0.065;
  const headTopY = height;
  const landmarks: AvatarLandmarks = {
    groundY: 0,
    ankleY,
    kneeY,
    crotchY,
    hipY,
    waistY,
    bustY,
    shoulderY,
    neckY,
    headCenterY,
    headTopY,
  };

  const bustAxes = ellipseAxes(measurements.bustMm * 0.001, bodyType === "feminine" ? 1.19 : 1.23);
  const waistAxes = ellipseAxes(measurements.waistMm * 0.001, 1.16);
  const hipAxes = ellipseAxes(measurements.hipMm * 0.001, bodyType === "feminine" ? 1.27 : 1.2);
  const shoulderHalf = measurements.shoulderWidthMm * 0.0005;
  const shoulderAxes: [number, number] = [
    Math.max(shoulderHalf * 0.94, bustAxes[0] * 0.94),
    bustAxes[1] * 0.72,
  ];
  const crotchAxes: [number, number] = [hipAxes[0] * 0.72, hipAxes[1] * 0.78];
  const torsoStations: AvatarTorsoStation[] = [
    { y: crotchY, halfWidth: crotchAxes[0], halfDepth: crotchAxes[1] },
    { y: hipY, halfWidth: hipAxes[0], halfDepth: hipAxes[1] },
    { y: waistY, halfWidth: waistAxes[0], halfDepth: waistAxes[1] },
    { y: bustY, halfWidth: bustAxes[0], halfDepth: bustAxes[1] },
    { y: shoulderY, halfWidth: shoulderAxes[0], halfDepth: shoulderAxes[1] },
  ];

  const armPoseAngleDeg = 14;
  const armAngle = armPoseAngleDeg * Math.PI / 180;
  const armLength = measurements.armLengthMm * 0.001;
  const upperArmLength = armLength * 0.49;
  const shoulderJointX = shoulderHalf * 0.92;
  const shoulderLeft: AvatarVector3 = [-shoulderJointX, shoulderY - 0.012, 0];
  const shoulderRight: AvatarVector3 = [shoulderJointX, shoulderY - 0.012, 0];
  const leftArmAxis: AvatarVector3 = normalize3([-Math.sin(armAngle), -Math.cos(armAngle), 0]);
  const rightArmAxis: AvatarVector3 = normalize3([Math.sin(armAngle), -Math.cos(armAngle), 0]);
  const elbowLeft = addScaled3(shoulderLeft, leftArmAxis, upperArmLength);
  const elbowRight = addScaled3(shoulderRight, rightArmAxis, upperArmLength);
  const wristLeft = addScaled3(shoulderLeft, leftArmAxis, armLength);
  const wristRight = addScaled3(shoulderRight, rightArmAxis, armLength);

  const legPoseAngleDeg = 4;
  const legAngle = legPoseAngleDeg * Math.PI / 180;
  const hipJointX = hipAxes[0] * 0.34;
  const hipLeft: AvatarVector3 = [-hipJointX, crotchY + 0.035, 0];
  const hipRight: AvatarVector3 = [hipJointX, crotchY + 0.035, 0];
  const leftLegAxis: AvatarVector3 = normalize3([-Math.sin(legAngle), -Math.cos(legAngle), 0]);
  const rightLegAxis: AvatarVector3 = normalize3([Math.sin(legAngle), -Math.cos(legAngle), 0]);
  const upperLegLength = Math.max(0.28, hipLeft[1] - kneeY);
  const fullLegLength = Math.max(0.5, hipLeft[1] - ankleY);
  const kneeLeft = addScaled3(hipLeft, leftLegAxis, upperLegLength);
  const kneeRight = addScaled3(hipRight, rightLegAxis, upperLegLength);
  const ankleLeft = addScaled3(hipLeft, leftLegAxis, fullLegLength);
  const ankleRight = addScaled3(hipRight, rightLegAxis, fullLegLength);
  ankleLeft[1] = ankleY;
  ankleRight[1] = ankleY;

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

  const anchors = createAnchors({
    bodyType,
    measurements,
    landmarks,
    joints,
    torsoStations,
    armPoseAngleDeg,
    legPoseAngleDeg,
    version: "avatar-parametric@1",
    anchors: [],
  });

  return {
    version: "avatar-parametric@1",
    bodyType,
    measurements,
    landmarks,
    joints,
    torsoStations,
    anchors,
    armPoseAngleDeg,
    legPoseAngleDeg,
  };
}

export function resolveAvatarAnchor(
  model: AvatarParametricModel,
  placement: Pick<PatternPreviewPlacement, "region" | "surface" | "bodySide">,
): AvatarArrangementAnchor | undefined {
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
  const front: AvatarVector3 = [0, 0, 1];
  const back: AvatarVector3 = [0, 0, -1];
  const down: AvatarVector3 = [0, -1, 0];
  const horizontal: AvatarVector3 = [1, 0, 0];
  const torso = sampleTorsoAxes(model, model.landmarks.bustY);
  const waist = sampleTorsoAxes(model, model.landmarks.waistY);
  const hip = sampleTorsoAxes(model, model.landmarks.hipY);
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
    position: AvatarVector3,
    outwardNormal: AvatarVector3,
    axis: AvatarVector3,
    tangent: AvatarVector3,
    initialMarginM: number,
  ): AvatarArrangementAnchor => ({
    id,
    region,
    surface,
    bodySide,
    position,
    outwardNormal: normalize3(outwardNormal),
    axis: normalize3(axis),
    tangent: normalize3(tangent),
    initialMarginM,
  });

  return [
    make("torso-front", "torso", "front", "center", [0, model.landmarks.bustY, torso.halfDepth], front, down, horizontal, 0.028),
    make("torso-back", "torso", "back", "center", [0, model.landmarks.bustY, -torso.halfDepth], back, down, [-1, 0, 0], 0.028),
    make("shoulder-left", "shoulder", "side", "left", model.joints.shoulderLeft, [-1, 0.15, 0], leftArmAxis, front, 0.02),
    make("shoulder-right", "shoulder", "side", "right", model.joints.shoulderRight, [1, 0.15, 0], rightArmAxis, front, 0.02),
    make("arm-left", "arm", "side", "left", model.joints.shoulderLeft, [-1, 0, 0], leftArmAxis, front, 0.022),
    make("arm-right", "arm", "side", "right", model.joints.shoulderRight, [1, 0, 0], rightArmAxis, front, 0.022),
    make("waist-front", "waist", "front", "center", [0, model.landmarks.waistY, waist.halfDepth], front, down, horizontal, 0.024),
    make("waist-back", "waist", "back", "center", [0, model.landmarks.waistY, -waist.halfDepth], back, down, [-1, 0, 0], 0.024),
    make("hip-front", "hip", "front", "center", [0, model.landmarks.hipY, hip.halfDepth], front, down, horizontal, 0.028),
    make("hip-back", "hip", "back", "center", [0, model.landmarks.hipY, -hip.halfDepth], back, down, [-1, 0, 0], 0.028),
    make("leg-left", "leg", "side", "left", model.joints.hipLeft, [-1, 0, 0], leftLegAxis, front, 0.026),
    make("leg-right", "leg", "side", "right", model.joints.hipRight, [1, 0, 0], rightLegAxis, front, 0.026),
    make("neck", "neck", "front", "center", [0, model.landmarks.neckY, 0], front, [0, 1, 0], horizontal, 0.01),
    make("head", "head", "front", "center", [0, model.landmarks.headCenterY, 0], front, [0, 1, 0], horizontal, 0.01),
  ];
}

function ellipseAxes(circumference: number, widthBias: number): [number, number] {
  const baseA = Math.max(0.5, widthBias);
  const baseB = 1;
  const unitCircumference = ramanujanCircumference(baseA, baseB);
  const scale = circumference / Math.max(unitCircumference, 1e-6);
  return [baseA * scale, baseB * scale];
}

function ramanujanCircumference(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
