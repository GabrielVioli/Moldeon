from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:80]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


write(
    "apps/web/src/avatar/AvatarParametricModel.ts",
    r'''
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
    make("torso-front", "torso", "front", "center", [0, model.landmarks.bustY, torso.halfDepth], front, down, horizontal, 0.014),
    make("torso-back", "torso", "back", "center", [0, model.landmarks.bustY, -torso.halfDepth], back, down, [-1, 0, 0], 0.014),
    make("shoulder-left", "shoulder", "side", "left", model.joints.shoulderLeft, [-1, 0.15, 0], leftArmAxis, front, 0.012),
    make("shoulder-right", "shoulder", "side", "right", model.joints.shoulderRight, [1, 0.15, 0], rightArmAxis, front, 0.012),
    make("arm-left", "arm", "side", "left", model.joints.shoulderLeft, [-1, 0, 0], leftArmAxis, front, 0.012),
    make("arm-right", "arm", "side", "right", model.joints.shoulderRight, [1, 0, 0], rightArmAxis, front, 0.012),
    make("waist-front", "waist", "front", "center", [0, model.landmarks.waistY, waist.halfDepth], front, down, horizontal, 0.012),
    make("waist-back", "waist", "back", "center", [0, model.landmarks.waistY, -waist.halfDepth], back, down, [-1, 0, 0], 0.012),
    make("hip-front", "hip", "front", "center", [0, model.landmarks.hipY, hip.halfDepth], front, down, horizontal, 0.014),
    make("hip-back", "hip", "back", "center", [0, model.landmarks.hipY, -hip.halfDepth], back, down, [-1, 0, 0], 0.014),
    make("leg-left", "leg", "side", "left", model.joints.hipLeft, [-1, 0, 0], leftLegAxis, front, 0.012),
    make("leg-right", "leg", "side", "right", model.joints.hipRight, [1, 0, 0], rightLegAxis, front, 0.012),
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
''',
)

write(
    "apps/web/src/avatar/AvatarCollisionModel.ts",
    r'''
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
''',
)

write(
    "apps/web/src/viewport/AvatarVisual.ts",
    r'''
import * as THREE from "three";
import type { AvatarParametricModel, AvatarVector3 } from "../avatar/AvatarParametricModel";
import { sampleArmRadius, sampleLegRadius, sampleTorsoAxes } from "../avatar/AvatarParametricModel";

export interface AvatarVisualOptions {
  radialSegments: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

export function createAvatarVisual(
  model: AvatarParametricModel,
  options: AvatarVisualOptions,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "avatar:visual";
  const segments = Math.max(8, Math.min(28, Math.round(options.radialSegments)));
  const material = new THREE.MeshStandardMaterial({
    color: model.bodyType === "feminine" ? 0xcbb9aa : 0xc4b5a8,
    roughness: 0.82,
    metalness: 0,
  });
  const bust = sampleTorsoAxes(model, model.landmarks.bustY);
  const waist = sampleTorsoAxes(model, model.landmarks.waistY);
  const hip = sampleTorsoAxes(model, model.landmarks.hipY);

  addEllipsoid(
    group,
    "avatar:chest",
    [0, (model.landmarks.shoulderY + model.landmarks.bustY) / 2, 0],
    [bust.halfWidth, Math.max(0.09, (model.landmarks.shoulderY - model.landmarks.bustY) * 0.78), bust.halfDepth],
    material,
    segments,
    options,
  );
  addEllipsoid(
    group,
    "avatar:abdomen",
    [0, (model.landmarks.bustY + model.landmarks.waistY) / 2, 0],
    [(bust.halfWidth + waist.halfWidth) * 0.49, Math.max(0.09, (model.landmarks.bustY - model.landmarks.waistY) * 0.72), (bust.halfDepth + waist.halfDepth) * 0.49],
    material,
    segments,
    options,
  );
  addEllipsoid(
    group,
    "avatar:pelvis",
    [0, (model.landmarks.waistY + model.landmarks.crotchY) / 2, 0],
    [hip.halfWidth, Math.max(0.11, (model.landmarks.waistY - model.landmarks.crotchY) * 0.66), hip.halfDepth],
    material,
    segments,
    options,
  );

  const neckRadius = Math.max(0.035, model.measurements.bustMm * 0.000043);
  addCapsule(group, "avatar:neck", [0, model.landmarks.shoulderY + 0.015, 0], [0, model.landmarks.neckY + 0.02, 0], neckRadius, material, segments, options);
  const headHeight = Math.max(0.18, model.landmarks.headTopY - model.landmarks.neckY);
  addEllipsoid(
    group,
    "avatar:head",
    [0, model.landmarks.headCenterY, 0],
    [headHeight * 0.28, headHeight * 0.48, headHeight * 0.34],
    material,
    segments,
    options,
  );

  const upperArmRadius = sampleArmRadius(model, 0.06);
  const forearmRadius = sampleArmRadius(model, model.measurements.armLengthMm * 0.0007);
  addCapsule(group, "avatar:upper-arm-left", model.joints.shoulderLeft, model.joints.elbowLeft, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-left", model.joints.elbowLeft, model.joints.wristLeft, forearmRadius, material, segments, options);
  addCapsule(group, "avatar:upper-arm-right", model.joints.shoulderRight, model.joints.elbowRight, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-right", model.joints.elbowRight, model.joints.wristRight, forearmRadius, material, segments, options);
  addEllipsoid(group, "avatar:hand-left", model.joints.wristLeft, [forearmRadius * 0.78, forearmRadius * 1.5, forearmRadius * 0.48], material, segments, options);
  addEllipsoid(group, "avatar:hand-right", model.joints.wristRight, [forearmRadius * 0.78, forearmRadius * 1.5, forearmRadius * 0.48], material, segments, options);

  const thighRadius = sampleLegRadius(model, model.landmarks.crotchY - 0.04);
  const calfRadius = sampleLegRadius(model, model.landmarks.kneeY - 0.08);
  addCapsule(group, "avatar:thigh-left", model.joints.hipLeft, model.joints.kneeLeft, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-left", model.joints.kneeLeft, model.joints.ankleLeft, calfRadius, material, segments, options);
  addCapsule(group, "avatar:thigh-right", model.joints.hipRight, model.joints.kneeRight, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-right", model.joints.kneeRight, model.joints.ankleRight, calfRadius, material, segments, options);
  const footLength = Math.max(0.19, model.measurements.heightMm * 0.000135);
  addEllipsoid(group, "avatar:foot-left", [model.joints.ankleLeft[0], model.landmarks.ankleY * 0.48, footLength * 0.18], [calfRadius * 0.9, model.landmarks.ankleY * 0.48, footLength * 0.5], material, segments, options);
  addEllipsoid(group, "avatar:foot-right", [model.joints.ankleRight[0], model.landmarks.ankleY * 0.48, footLength * 0.18], [calfRadius * 0.9, model.landmarks.ankleY * 0.48, footLength * 0.5], material, segments, options);

  return group;
}

function addEllipsoid(
  group: THREE.Group,
  name: string,
  center: AvatarVector3,
  radii: AvatarVector3,
  material: THREE.Material,
  segments: number,
  options: AvatarVisualOptions,
): void {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(6, Math.floor(segments * 0.72)));
  geometry.scale(Math.max(0.001, radii[0]), Math.max(0.001, radii[1]), Math.max(0.001, radii[2]));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = options.castShadow;
  mesh.receiveShadow = options.receiveShadow;
  group.add(mesh);
}

function addCapsule(
  group: THREE.Group,
  name: string,
  start: AvatarVector3,
  end: AvatarVector3,
  radius: number,
  material: THREE.Material,
  segments: number,
  options: AvatarVisualOptions,
): void {
  const direction = new THREE.Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const distance = direction.length();
  if (distance <= 1e-6) return;
  const geometry = new THREE.CapsuleGeometry(
    Math.max(0.005, radius),
    Math.max(0.001, distance - radius * 2),
    Math.max(4, Math.floor(segments * 0.45)),
    segments,
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = options.castShadow;
  mesh.receiveShadow = options.receiveShadow;
  group.add(mesh);
}
''',
)

write(
    "apps/web/src/garment3d/SemanticAvatarArrangement.ts",
    r'''
import {
  getPatternEdges,
  type GarmentDraft,
  type PatternPiece,
  type PatternPreviewPlacement,
  type PatternSnapshot,
  type PreviewBodySide,
  type SegmentRole,
} from "../domain/pattern";
import { buildAssemblyGraph, validateSeamForAssembly } from "../domain/assembly";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import {
  addScaled3,
  cross3,
  normalize3,
  resolveAvatarAnchor,
  sampleArmRadius,
  sampleLegRadius,
  sampleTorsoAxes,
  type AvatarArrangementAnchor,
  type AvatarParametricModel,
  type AvatarVector3,
} from "../avatar/AvatarParametricModel";
import { buildAvatarCollisionModel, type AvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import type { AssemblyPanelInstance, GarmentAssemblyState, GlobalPointReference } from "./GarmentAssembly";
import { buildPhysicalGarmentAssembly } from "./PhysicalGarmentAssembly";

export type ArrangementDiagnosticCode =
  | "missing-anchor"
  | "missing-connector"
  | "incompatible-seam"
  | "ambiguous-instance"
  | "disconnected-component";

export interface ArrangementDiagnostic {
  code: ArrangementDiagnosticCode;
  severity: "warning" | "error";
  message: string;
  pieceId?: string;
  instanceId?: string;
  connectorId?: string;
}

export interface SemanticAvatarArrangementResult {
  garment: GarmentDraft;
  state: GarmentAssemblyState;
  avatar: AvatarParametricModel;
  collision: AvatarCollisionModel;
  diagnostics: ArrangementDiagnostic[];
  visibleInstanceIds: Set<string>;
}

const METERS_PER_MM = 0.001;

export function buildSemanticAvatarArrangement(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
  avatar: AvatarParametricModel,
): SemanticAvatarArrangementResult {
  const resolvedGarment = resolveTemplateAssemblyGarment(garment);
  const diagnostics: ArrangementDiagnostic[] = [];
  const invalidPieceIds = validateSemanticMetadata(resolvedGarment, diagnostics);
  validateSeams(resolvedGarment, diagnostics);
  validateComponents(resolvedGarment, diagnostics);

  const state = buildPhysicalGarmentAssembly(snapshots, resolvedGarment);
  const pieceById = new Map(resolvedGarment.pieces.map((piece) => [piece.id, piece]));
  const visibleInstanceIds = new Set<string>();

  for (const instance of state.instances) {
    const piece = pieceById.get(instance.pieceId);
    if (!piece || invalidPieceIds.has(instance.pieceId)) continue;
    const anchor = resolveAvatarAnchor(avatar, instance.placement);
    if (!anchor) {
      diagnostics.push({
        code: "missing-anchor",
        severity: "error",
        pieceId: piece.id,
        instanceId: instance.id,
        message: `${piece.name} · ${instance.id}: nenhum anchor corporal corresponde a ${placementLabel(instance.placement)}.`,
      });
      continue;
    }

    arrangeInstance(state, instance, piece, avatar, anchor);
    visibleInstanceIds.add(instance.id);
  }

  applyMinimalSeamStabilization(state, visibleInstanceIds, 2, 0.004);
  state.initialPositions.set(state.positions);
  state.previousPositions.set(state.positions);

  return {
    garment: resolvedGarment,
    state,
    avatar,
    collision: buildAvatarCollisionModel(avatar),
    diagnostics: uniqueDiagnostics(diagnostics),
    visibleInstanceIds,
  };
}

function validateSemanticMetadata(
  garment: GarmentDraft,
  diagnostics: ArrangementDiagnostic[],
): Set<string> {
  const invalid = new Set<string>();

  for (const piece of garment.pieces) {
    const placements = explicitPlacements(piece, garment);
    const expected = piece.cutOnFold ? 1 : Math.max(1, piece.cutQuantity ?? placements.length || 1);
    if (placements.length === 0) {
      diagnostics.push({
        code: "missing-anchor",
        severity: "error",
        pieceId: piece.id,
        message: `${piece.name}: nenhuma instância possui anchor de arranjo explícito. A peça não será exibida solta.`,
      });
      invalid.add(piece.id);
      continue;
    }
    if (placements.length !== expected) {
      diagnostics.push({
        code: "ambiguous-instance",
        severity: "error",
        pieceId: piece.id,
        message: `${piece.name}: cutQuantity=${piece.cutQuantity ?? 1}, mas foram encontrados ${placements.length} placements explícitos; esperado ${expected}.`,
      });
      invalid.add(piece.id);
    }

    const sideKeys = new Set<string>();
    for (const placement of placements) {
      const key = `${placement.region}/${placement.surface}/${placement.bodySide}`;
      if (sideKeys.has(key)) {
        diagnostics.push({
          code: "ambiguous-instance",
          severity: "error",
          pieceId: piece.id,
          instanceId: placement.id,
          message: `${piece.name} · ${placement.id}: placement duplicado em ${key}.`,
        });
        invalid.add(piece.id);
      }
      sideKeys.add(key);
      if ((placement.region === "arm" || placement.region === "leg") && placement.bodySide === "center") {
        diagnostics.push({
          code: "ambiguous-instance",
          severity: "error",
          pieceId: piece.id,
          instanceId: placement.id,
          message: `${piece.name} · ${placement.id}: ${placement.region === "arm" ? "manga" : "perna"} precisa declarar lado esquerdo ou direito.`,
        });
        invalid.add(piece.id);
      }
    }

    const required = requiredRoles(placements);
    const edges = getPatternEdges(piece);
    for (const requirement of required) {
      const found = edges.filter((edge) => edge.role === requirement.role).length;
      if (found < requirement.minimum) {
        diagnostics.push({
          code: "missing-connector",
          severity: "error",
          pieceId: piece.id,
          connectorId: requirement.role,
          message: `${piece.name}: conector ${requirement.role} ausente ou incompleto (${found}/${requirement.minimum}).`,
        });
        invalid.add(piece.id);
      }
    }
  }

  return invalid;
}

function requiredRoles(
  placements: readonly PatternPreviewPlacement[],
): Array<{ role: SegmentRole; minimum: number }> {
  const regions = new Set(placements.map((placement) => placement.region));
  const surfaces = new Set(placements.map((placement) => placement.surface));
  if (regions.has("arm")) {
    return [
      { role: "sleeveCapFront", minimum: 1 },
      { role: "sleeveCapBack", minimum: 1 },
      { role: "sideSeam", minimum: 2 },
    ];
  }
  if (regions.has("leg")) {
    return [
      { role: "outseam", minimum: 1 },
      { role: "inseam", minimum: 1 },
    ];
  }
  if (regions.has("hip") || regions.has("waist")) {
    return [
      { role: "waist", minimum: 1 },
      { role: "sideSeam", minimum: 1 },
    ];
  }
  if (regions.has("torso")) {
    return [
      { role: "shoulder", minimum: 1 },
      { role: "sideSeam", minimum: 1 },
      ...(surfaces.has("front") ? [{ role: "frontArmhole" as const, minimum: 1 }] : []),
      ...(surfaces.has("back") ? [{ role: "backArmhole" as const, minimum: 1 }] : []),
    ];
  }
  return [];
}

function validateSeams(garment: GarmentDraft, diagnostics: ArrangementDiagnostic[]): void {
  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    for (const issue of validateSeamForAssembly(seam, garment)) {
      diagnostics.push({
        code: "incompatible-seam",
        severity: "error",
        pieceId: seam.first.pieceId,
        connectorId: `${seam.first.edgeId} ↔ ${seam.second.edgeId}`,
        message: `${seam.name ?? seam.id}: ${issue.message}`,
      });
    }
  }
}

function validateComponents(garment: GarmentDraft, diagnostics: ArrangementDiagnostic[]): void {
  const graph = buildAssemblyGraph(garment);
  if (graph.connectedComponents.length <= 1) return;
  for (const component of graph.connectedComponents.slice(1)) {
    diagnostics.push({
      code: "disconnected-component",
      severity: "warning",
      pieceId: component[0],
      message: `Componente desconectado: ${component.join(", ")}. Ele permanece ancorado ao corpo, mas não possui ligação semântica com o componente principal.`,
    });
  }
}

function explicitPlacements(piece: PatternPiece, garment: GarmentDraft): PatternPreviewPlacement[] {
  if (piece.previewPlacements?.length) return piece.previewPlacements;
  const legacy = garment.assemblyPlacements?.filter((placement) => placement.pieceId === piece.id) ?? [];
  return legacy.flatMap((placement) => {
    const region: PatternPreviewPlacement["region"] = placement.role === "sleeve"
      ? "arm"
      : placement.role === "leg"
        ? "leg"
        : placement.role === "waist"
          ? "hip"
          : "torso";
    const sides: PreviewBodySide[] = (placement.role === "sleeve" || placement.role === "leg") && (piece.cutQuantity ?? 1) > 1
      ? ["left", "right"]
      : ["center"];
    return sides.map((bodySide, index) => ({
      id: `legacy-anchor:${piece.id}:${bodySide}`,
      pieceId: piece.id,
      region,
      surface: placement.outwardSide,
      bodySide,
      rotationDeg: placement.rotationDeg[2],
      offsetXMm: placement.positionMm[0],
      offsetYMm: placement.positionMm[1],
      offsetZMm: placement.positionMm[2],
      scale: 1,
      mirrorX: Boolean(placement.flipped) !== (index === 1),
    }));
  });
}

function arrangeInstance(
  state: GarmentAssemblyState,
  instance: AssemblyPanelInstance,
  piece: PatternPiece,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  if (instance.placement.region === "arm") {
    mapArm(state.positions, instance, avatar, anchor);
  } else if (instance.placement.region === "leg") {
    mapLeg(state.positions, instance, avatar, anchor);
  } else {
    mapTorsoSurface(state.positions, instance, piece, avatar, anchor);
  }

  instance.arrangement = {
    anchorId: anchor.id,
    outwardNormal: [...anchor.outwardNormal],
    axis: [...anchor.axis],
    bodySide: instance.placement.bodySide,
    marginM: anchor.initialMarginM,
    mapping: instance.placement.region === "arm" ? "local-tube" : instance.placement.region === "leg" ? "anatomical-half-tube" : "body-surface",
    flipWinding: shouldFlipWinding(state.positions, instance, anchor.outwardNormal),
  };
}

function mapTorsoSurface(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  piece: PatternPiece,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const foldX = findFoldCoordinate(piece, instance);
  const sideSign = instance.placement.bodySide === "left" ? -1 : 1;
  const surfaceSign = instance.placement.surface === "back" ? -1 : 1;
  const scale = validScale(instance.placement.scale);
  const topY = instance.placement.region === "torso"
    ? avatar.landmarks.shoulderY + 0.015
    : avatar.landmarks.waistY + 0.008;
  const rotation = instance.placement.rotationDeg * Math.PI / 180;

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    const rawX = piece.cutOnFold && instance.placement.bodySide !== "center"
      ? sideSign * Math.abs(xMm - foldX)
      : xMm - centerX;
    const rawY = yMm - bounds.minY;
    const rotatedX = rawX * Math.cos(rotation) - rawY * Math.sin(rotation);
    const rotatedY = rawX * Math.sin(rotation) + rawY * Math.cos(rotation);
    const worldY = topY - rotatedY * METERS_PER_MM * scale - instance.placement.offsetYMm * METERS_PER_MM;
    const axes = sampleTorsoAxes(avatar, worldY);
    const worldX = rotatedX * METERS_PER_MM * scale + instance.placement.offsetXMm * METERS_PER_MM;
    const normalizedX = Math.min(1, Math.abs(worldX) / Math.max(axes.halfWidth, 1e-6));
    const surfaceDepth = axes.halfDepth * Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = worldX;
    positions[offset + 1] = worldY;
    positions[offset + 2] = surfaceSign * (surfaceDepth + anchor.initialMarginM) + instance.placement.offsetZMm * METERS_PER_MM;
  }
}

function mapArm(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const width = Math.max(1, bounds.width);
  const scale = validScale(instance.placement.scale);
  const frontAxis: AvatarVector3 = [0, 0, 1];
  const tangent = cross3(anchor.axis, frontAxis);
  const normal = normalize3(cross3(tangent, anchor.axis));
  const patternRadius = width * METERS_PER_MM * scale / (Math.PI * 2);

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    let u = clamp01((xMm - bounds.minX) / width);
    if (instance.placement.bodySide === "right") u = 1 - u;
    const distance = Math.max(0, (yMm - bounds.minY) * METERS_PER_MM * scale - instance.placement.offsetYMm * METERS_PER_MM);
    const center = addScaled3(anchor.position, anchor.axis, distance);
    const radius = Math.max(sampleArmRadius(avatar, distance) + anchor.initialMarginM, patternRadius * 0.88);
    const angle = u * Math.PI * 2;
    const aroundTangent = Math.cos(angle) * radius;
    const aroundNormal = Math.sin(angle) * radius;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = center[0] + tangent[0] * aroundTangent + normal[0] * aroundNormal + instance.placement.offsetXMm * METERS_PER_MM;
    positions[offset + 1] = center[1] + tangent[1] * aroundTangent + normal[1] * aroundNormal;
    positions[offset + 2] = center[2] + tangent[2] * aroundTangent + normal[2] * aroundNormal + instance.placement.offsetZMm * METERS_PER_MM;
  }
}

function mapLeg(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const width = Math.max(1, bounds.width);
  const scale = validScale(instance.placement.scale);
  const sideSign = instance.placement.bodySide === "left" ? -1 : 1;
  const baseLegX = anchor.position[0];
  const surfaceFront = instance.placement.surface !== "back";

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    let u = clamp01((xMm - bounds.minX) / width);
    if (instance.placement.mirrorX) u = 1 - u;
    const worldY = avatar.landmarks.waistY - (yMm - bounds.minY) * METERS_PER_MM * scale - instance.placement.offsetYMm * METERS_PER_MM;
    const aboveCrotch = worldY > avatar.landmarks.crotchY;
    const pelvisAxes = sampleTorsoAxes(avatar, worldY);
    const blend = aboveCrotch
      ? clamp01((worldY - avatar.landmarks.crotchY) / Math.max(0.001, avatar.landmarks.waistY - avatar.landmarks.crotchY))
      : 0;
    const centerX = aboveCrotch
      ? sideSign * lerp(Math.abs(baseLegX), pelvisAxes.halfWidth * 0.34, blend)
      : baseLegX;
    const legRadius = sampleLegRadius(avatar, worldY);
    const halfPanelRadius = Math.max(legRadius + anchor.initialMarginM, width * METERS_PER_MM * scale / Math.PI * 0.44);
    const radiusX = aboveCrotch ? lerp(halfPanelRadius, pelvisAxes.halfWidth * 0.62, blend) : halfPanelRadius;
    const radiusZ = aboveCrotch ? lerp(halfPanelRadius, pelvisAxes.halfDepth, blend) : halfPanelRadius * 0.9;
    const angle = surfaceFront ? Math.PI * (1 - u) : Math.PI + Math.PI * u;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = centerX + Math.cos(angle) * radiusX + instance.placement.offsetXMm * METERS_PER_MM;
    positions[offset + 1] = worldY;
    positions[offset + 2] = Math.sin(angle) * radiusZ + instance.placement.offsetZMm * METERS_PER_MM;
  }
}

function findFoldCoordinate(piece: PatternPiece, instance: AssemblyPanelInstance): number {
  const foldEdge = getPatternEdges(piece).find((edge) => edge.role === "fold");
  const path = foldEdge ? instance.topology.edges.get(foldEdge.id) : undefined;
  if (!path || path.vertexIndices.length === 0) return instance.topology.boundsMm.minX;
  return path.vertexIndices.reduce((sum, vertex) => sum + instance.topology.positions2DMm[vertex * 2], 0) / path.vertexIndices.length;
}

function applyMinimalSeamStabilization(
  state: GarmentAssemblyState,
  visible: ReadonlySet<string>,
  passes: number,
  maximumCorrection: number,
): void {
  for (let pass = 0; pass < passes; pass += 1) {
    for (const stitch of state.stitchConstraints) {
      if (!stitch.instanceA || !stitch.instanceB) continue;
      if (!visible.has(stitch.instanceA) || !visible.has(stitch.instanceB)) continue;
      const a = evaluateReference(state.positions, stitch.a);
      const b = evaluateReference(state.positions, stitch.b);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dy, dz);
      if (length <= stitch.restDistance + 1e-6) continue;
      const correction = Math.min(maximumCorrection, (length - stitch.restDistance) * 0.18);
      const scale = correction / Math.max(length, 1e-9);
      applyReferenceDelta(state.positions, stitch.a, dx * scale, dy * scale, dz * scale);
      applyReferenceDelta(state.positions, stitch.b, -dx * scale, -dy * scale, -dz * scale);
    }
  }
}

function evaluateReference(positions: Float32Array, reference: GlobalPointReference): AvatarVector3 {
  const result: AvatarVector3 = [0, 0, 0];
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const offset = reference.particleIndices[index] * 3;
    const weight = reference.weights[index];
    result[0] += positions[offset] * weight;
    result[1] += positions[offset + 1] * weight;
    result[2] += positions[offset + 2] * weight;
  }
  return result;
}

function applyReferenceDelta(
  positions: Float32Array,
  reference: GlobalPointReference,
  dx: number,
  dy: number,
  dz: number,
): void {
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const offset = reference.particleIndices[index] * 3;
    const weight = reference.weights[index];
    positions[offset] += dx * weight;
    positions[offset + 1] += dy * weight;
    positions[offset + 2] += dz * weight;
  }
}

function shouldFlipWinding(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  outward: AvatarVector3,
): boolean {
  const triangles = instance.topology.triangles;
  for (let index = 0; index < triangles.length; index += 3) {
    const a = vertex(positions, instance, triangles[index]);
    const b = vertex(positions, instance, triangles[index + 1]);
    const c = vertex(positions, instance, triangles[index + 2]);
    const ab: AvatarVector3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: AvatarVector3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = cross3(ab, ac);
    if (Math.hypot(normal[0], normal[1], normal[2]) <= 1e-8) continue;
    return normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0;
  }
  return false;
}

function vertex(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  localIndex: number,
): AvatarVector3 {
  const offset = (instance.particleStart + localIndex) * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function placementLabel(placement: PatternPreviewPlacement): string {
  return `${placement.region}/${placement.surface}/${placement.bodySide}`;
}

function validScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function uniqueDiagnostics(diagnostics: readonly ArrangementDiagnostic[]): ArrangementDiagnostic[] {
  const byKey = new Map<string, ArrangementDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}/${diagnostic.pieceId ?? ""}/${diagnostic.instanceId ?? ""}/${diagnostic.connectorId ?? ""}/${diagnostic.message}`;
    byKey.set(key, diagnostic);
  }
  return [...byKey.values()];
}
''',
)

write(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    r'''
import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GarmentDraft, PatternSnapshot } from "../domain/pattern";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { buildSemanticAvatarArrangement } from "../garment3d/SemanticAvatarArrangement";
import {
  buildGarmentAssemblyMeshes,
  type GarmentAssemblyMeshData,
} from "../garment3d/GarmentThreeBridge";
import { createAvatarVisual } from "./AvatarVisual";

export type RenderBackend = "webgpu" | "webgl2";
type ViewportRenderer = THREE.WebGLRenderer | WebGPURenderer;

interface PerformanceProfile {
  antialias: boolean;
  maxPixelRatio: number;
  shadows: boolean;
  avatarRadialSegments: number;
}

export class ThreeViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly garmentGroup = new THREE.Group();
  private readonly avatarGroup = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly profile: PerformanceProfile;
  private readonly renderer: ViewportRenderer;
  private garmentMeshes: GarmentAssemblyMeshData[] = [];
  private frameId: number | null = null;
  private lastFrameAt = 0;
  private disposed = false;

  private constructor(
    private readonly host: HTMLElement,
    renderer: ViewportRenderer,
    readonly backend: RenderBackend,
    profile: PerformanceProfile,
  ) {
    this.renderer = renderer;
    this.profile = profile;
    this.scene.background = new THREE.Color(0xe9e6df);
    this.camera.position.set(2.1, 1.25, 3.2);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio));
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.domElement.className = "three-canvas";
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 12;
    this.controls.addEventListener("change", this.requestRender);

    this.avatarGroup.name = "avatar-root";
    this.garmentGroup.name = "garment-root";
    this.scene.add(createLights());
    this.scene.add(this.avatarGroup);
    this.scene.add(this.garmentGroup);
    this.scene.add(createFloor(profile.shadows));

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.requestRender();
    });
    this.resizeObserver.observe(this.host);
  }

  static async create(host: HTMLElement, signal?: AbortSignal): Promise<ThreeViewport> {
    if (signal?.aborted) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
    const profile = getPerformanceProfile();
    const rendererResult = await createRenderer(profile, signal);
    const viewport = new ThreeViewport(host, rendererResult.renderer, rendererResult.backend, profile);
    const abort = () => viewport.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted || viewport.disposed) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      viewport.resize();
      viewport.requestRender();
      return viewport;
    } catch (error) {
      viewport.dispose();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  updateGarment(snapshots: readonly PatternSnapshot[], garment: GarmentDraft): string[] {
    this.clearGarment();
    this.clearAvatar();

    const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const visual = createAvatarVisual(avatar, {
      radialSegments: this.profile.avatarRadialSegments,
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
    });
    this.avatarGroup.add(visual);

    const arrangement = buildSemanticAvatarArrangement(snapshots, garment, avatar);
    this.garmentMeshes = buildGarmentAssemblyMeshes(arrangement.state, arrangement.garment, {
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
      visibleInstanceIds: arrangement.visibleInstanceIds,
    });
    for (const item of this.garmentMeshes) this.garmentGroup.add(item.mesh);

    this.frameDressedScene();
    this.host.dataset.avatarVisible = "true";
    this.host.dataset.avatarAnchorCount = String(avatar.anchors.length);
    this.host.dataset.collisionProxyCount = String(arrangement.collision.proxies.length);
    this.host.dataset.garmentInstanceCount = String(this.garmentMeshes.length);
    this.host.dataset.arrangementDiagnosticCount = String(arrangement.diagnostics.length);
    this.host.dataset.arrangementErrorCount = String(arrangement.diagnostics.filter((item) => item.severity === "error").length);
    this.host.dataset.frameTarget = "avatar-and-garment";
    this.requestRender();

    return [...new Set([
      ...arrangement.state.warnings,
      ...arrangement.diagnostics.map((diagnostic) => diagnostic.message),
    ])];
  }

  dress(): void {
    this.frameDressedScene();
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    this.clearGarment();
    this.clearAvatar();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.host.dataset.avatarVisible;
    delete this.host.dataset.garmentInstanceCount;
  }

  private frameDressedScene(): void {
    this.avatarGroup.updateMatrixWorld(true);
    this.garmentGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.avatarGroup);
    box.expandByObject(this.garmentGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const verticalRadius = Math.max(size.y * 0.57, 0.75);
    const horizontalRadius = Math.max(size.x, size.z) * 0.72;
    const radius = Math.max(verticalRadius, horizontalRadius, 0.55);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const aspectAllowance = this.camera.aspect < 0.8 ? 1.2 : 1;
    const distance = Math.max(1.25, radius / Math.tan(halfFov) * aspectAllowance);
    const direction = new THREE.Vector3(1.15, 0.3, 1.7).normalize();
    this.controls.target.copy(center).add(new THREE.Vector3(0, size.y * 0.02, 0));
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.01, distance / 120);
    this.camera.far = Math.max(20, distance * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private clearGarment(): void {
    for (const item of this.garmentMeshes) {
      this.garmentGroup.remove(item.mesh);
      item.mesh.geometry.dispose();
      const material = item.mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
    this.garmentMeshes = [];
  }

  private clearAvatar(): void {
    disposeObject(this.avatarGroup);
    this.avatarGroup.clear();
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private readonly requestRender = (): void => {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = window.requestAnimationFrame(this.render);
  };

  private readonly render = (time: number): void => {
    this.frameId = null;
    if (this.disposed) return;
    const deltaSeconds = this.lastFrameAt === 0 ? 1 / 60 : Math.min((time - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = time;
    this.controls.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  };
}

async function createRenderer(
  profile: PerformanceProfile,
  signal?: AbortSignal,
): Promise<{ renderer: ViewportRenderer; backend: RenderBackend }> {
  if ("gpu" in navigator) {
    let renderer: WebGPURenderer | null = null;
    try {
      const { WebGPURenderer } = await import("three/webgpu");
      if (signal?.aborted) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      renderer = new WebGPURenderer({ antialias: profile.antialias, alpha: false });
      await renderer.init();
      return { renderer, backend: "webgpu" };
    } catch (error) {
      renderer?.dispose();
      if (signal?.aborted) throw error;
      console.info("WebGPU indisponível; usando WebGL 2.", error);
    }
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: profile.antialias,
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("Este navegador não disponibiliza WebGPU nem WebGL 2.");
  return {
    renderer: new THREE.WebGLRenderer({ canvas, context, alpha: false, antialias: profile.antialias, powerPreference: "high-performance" }),
    backend: "webgl2",
  };
}

function getPerformanceProfile(): PerformanceProfile {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const lowPower = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  if (compact || lowPower) {
    return { antialias: false, maxPixelRatio: 1.25, shadows: false, avatarRadialSegments: 10 };
  }
  return { antialias: true, maxPixelRatio: 1.75, shadows: true, avatarRadialSegments: 18 };
}

function createLights(): THREE.Group {
  const group = new THREE.Group();
  const ambient = new THREE.HemisphereLight(0xffffff, 0x4a4a50, 2.1);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  const fill = new THREE.DirectionalLight(0xc8d2ff, 1.2);
  fill.position.set(-3, 2, 2);
  group.add(ambient, key, fill);
  return group;
}

function createFloor(shadows: boolean): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 48),
    new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = shadows;
  return floor;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  });
}
''',
)

write(
    "apps/web/src/viewport/GarmentViewport.tsx",
    r'''
import { memo, useEffect, useRef, useState } from "react";
import type { GarmentDraft, PatternSnapshot } from "../domain/pattern";
import { ThreeViewport } from "./GlobalThreeViewport";

interface GarmentViewportProps {
  garment: GarmentDraft;
  snapshots: PatternSnapshot[];
  simulateVersion: number;
  active: boolean;
  onBackendChange(backend: "webgpu" | "webgl2"): void;
}

export const GarmentViewport = memo(function GarmentViewport({
  garment,
  snapshots,
  simulateVersion,
  active,
  onBackendChange,
}: GarmentViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ThreeViewport | null>(null);
  const latestSnapshotsRef = useRef(snapshots);
  const latestGarmentRef = useRef(garment);
  const latestActiveRef = useRef(active);
  const latestSimulateVersionRef = useRef(simulateVersion);
  const lastDressedVersionRef = useRef(0);
  const lastAppliedGarmentRef = useRef<GarmentDraft | null>(null);
  const lastAppliedSnapshotsRef = useRef<PatternSnapshot[] | null>(null);
  const updateFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  latestSnapshotsRef.current = snapshots;
  latestGarmentRef.current = garment;
  latestActiveRef.current = active;
  latestSimulateVersionRef.current = simulateVersion;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let mounted = true;
    const abortController = new AbortController();
    setError(null);

    void ThreeViewport.create(host, abortController.signal)
      .then((viewport) => {
        if (!mounted) {
          viewport.dispose();
          return;
        }
        viewportRef.current = viewport;
        onBackendChange(viewport.backend);
        if (latestActiveRef.current) {
          setWarnings(viewport.updateGarment(latestSnapshotsRef.current, latestGarmentRef.current));
          lastAppliedGarmentRef.current = latestGarmentRef.current;
          lastAppliedSnapshotsRef.current = latestSnapshotsRef.current;
        }
        if (latestActiveRef.current && latestSimulateVersionRef.current > 0) {
          viewport.dress();
          lastDressedVersionRef.current = latestSimulateVersionRef.current;
        }
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        console.error(reason);
        setError("Não foi possível iniciar o manequim 3D neste navegador.");
      });

    return () => {
      mounted = false;
      abortController.abort();
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
      updateFrameRef.current = null;
      viewportRef.current?.dispose();
      viewportRef.current = null;
    };
  }, [onBackendChange]);

  useEffect(() => {
    if (!active || updateFrameRef.current !== null) return;
    if (lastAppliedGarmentRef.current === garment && lastAppliedSnapshotsRef.current === snapshots) return;
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      setWarnings(viewport.updateGarment(latestSnapshotsRef.current, latestGarmentRef.current));
      lastAppliedGarmentRef.current = latestGarmentRef.current;
      lastAppliedSnapshotsRef.current = latestSnapshotsRef.current;
    });
    return () => {
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
      updateFrameRef.current = null;
    };
  }, [active, garment, snapshots]);

  useEffect(() => {
    if (simulateVersion <= lastDressedVersionRef.current || !viewportRef.current) return;
    viewportRef.current.dress();
    lastDressedVersionRef.current = simulateVersion;
  }, [simulateVersion]);

  return (
    <div className="viewport-host" ref={hostRef} data-testid="dressed-avatar-viewport">
      {error ? <div className="viewport-error">{error}</div> : null}
      {warnings.length > 0 ? (
        <div className="viewport-warnings" role="alert">
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      <div className="viewport-label">
        Manequim vestido · {garment.bodyType === "feminine" ? "Feminino" : "Masculino"} ·{" "}
        {garment.fabrics.length > 1 ? `${garment.fabrics.length} tecidos` : garment.fabrics[0]?.name ?? "sem tecido"}
      </div>
    </div>
  );
});
''',
)

# GarmentAssembly: add arrangement metadata, remove generic tubular/cylindrical initialization and name inference.
replace_once(
    "apps/web/src/garment3d/GarmentAssembly.ts",
    '''export interface AssemblyPanelInstance {\n  id: string;\n  pieceId: string;\n  placement: PatternPreviewPlacement;\n  topology: PanelTopology;\n  particleStart: number;\n  vertexCount: number;\n}\n''',
    '''export interface AssemblyInstanceArrangement {\n  anchorId: string;\n  outwardNormal: [number, number, number];\n  axis: [number, number, number];\n  bodySide: PatternPreviewPlacement["bodySide"];\n  marginM: number;\n  mapping: "body-surface" | "local-tube" | "anatomical-half-tube";\n  flipWinding: boolean;\n}\n\nexport interface AssemblyPanelInstance {\n  id: string;\n  pieceId: string;\n  placement: PatternPreviewPlacement;\n  topology: PanelTopology;\n  particleStart: number;\n  vertexCount: number;\n  arrangement?: AssemblyInstanceArrangement;\n}\n''',
)
replace_once(
    "apps/web/src/garment3d/GarmentAssembly.ts",
    '''    for (const placement of resolvePiecePlacements(snapshot.piece, garment)) {\n      const particleStart = positionValues.length / 3;''',
    '''    const placements = resolvePiecePlacements(snapshot.piece, garment);\n    if (placements.length === 0) {\n      warnings.push(`${snapshot.piece.name}: nenhuma instância possui anchor explícito; a peça foi omitida do 3D.`);\n    }\n    for (const placement of placements) {\n      const particleStart = positionValues.length / 3;''',
)
replace_once(
    "apps/web/src/garment3d/GarmentAssembly.ts",
    '''      appendInitialPositions(\n        positionValues,\n        instance,\n        selfSeamedPieceIds.has(snapshot.piece.id),\n      );''',
    '''      appendInitialPositions(positionValues, instance);''',
)
replace_once(
    "apps/web/src/garment3d/GarmentAssembly.ts",
    '''function appendInitialPositions(\n  target: number[],\n  instance: AssemblyPanelInstance,\n  wrapAsTube: boolean,\n): void {\n  const { topology, placement } = instance;\n  const centerX = (topology.boundsMm.minX + topology.boundsMm.maxX) / 2;\n  const topY = topology.boundsMm.minY;\n  const widthMm = Math.max(topology.boundsMm.width, 1);\n  const scale = validScale(placement.scale);\n  const rotation = placement.rotationDeg * Math.PI / 180;\n  const base = placementBasePosition(placement);\n  const radius = Math.max(\n    widthMm * METERS_PER_MM * scale / (2 * Math.PI),\n    0.025,\n  );\n\n  for (let localIndex = 0; localIndex < instance.vertexCount; localIndex += 1) {\n    const xMm = topology.positions2DMm[localIndex * 2];\n    const yMm = topology.positions2DMm[localIndex * 2 + 1];\n    const rawX = (xMm - centerX) * METERS_PER_MM;\n    const rawY = -(yMm - topY) * METERS_PER_MM;\n    const mirroredX = placement.mirrorX ? -rawX : rawX;\n    const scaledX = mirroredX * scale;\n    const scaledY = rawY * scale;\n    const rotatedX = scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation);\n    const rotatedY = scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation);\n\n    if (wrapAsTube) {\n      const normalized = (xMm - topology.boundsMm.minX) / widthMm;\n      const direction = placement.mirrorX ? -1 : 1;\n      const angle = direction * normalized * Math.PI * 2;\n      target.push(\n        base.x + Math.sin(angle) * radius,\n        base.y + rotatedY,\n        base.z + Math.cos(angle) * radius,\n      );\n      continue;\n    }\n\n    target.push(\n      base.x + rotatedX,\n      base.y + rotatedY,\n      base.z,\n    );\n  }\n}\n\nfunction placementBasePosition(\n  placement: PatternPreviewPlacement,\n): { x: number; y: number; z: number } {\n  let x = 0;\n  let y = 1.62;\n  let z = 0;\n\n  switch (placement.region) {\n    case "torso": y = 1.66; break;\n    case "waist": y = 1.31; break;\n    case "hip": y = 1.18; break;\n    case "arm": y = 1.58; break;\n    case "leg": y = 1.08; break;\n  }\n\n  if (placement.bodySide === "left") {\n    x -= placement.region === "arm" ? 0.58 : placement.region === "leg" ? 0.23 : 0.12;\n  } else if (placement.bodySide === "right") {\n    x += placement.region === "arm" ? 0.58 : placement.region === "leg" ? 0.23 : 0.12;\n  }\n\n  if (placement.surface === "front") z = 0.055;\n  else if (placement.surface === "back") z = -0.055;\n\n  x += placement.offsetXMm * METERS_PER_MM;\n  y -= placement.offsetYMm * METERS_PER_MM;\n  z += placement.offsetZMm * METERS_PER_MM;\n\n  return { x, y, z };\n}\n''',
    '''function appendInitialPositions(\n  target: number[],\n  instance: AssemblyPanelInstance,\n): void {\n  const { topology, placement } = instance;\n  const centerX = (topology.boundsMm.minX + topology.boundsMm.maxX) / 2;\n  const topY = topology.boundsMm.minY;\n  const scale = validScale(placement.scale);\n  const rotation = placement.rotationDeg * Math.PI / 180;\n\n  for (let localIndex = 0; localIndex < instance.vertexCount; localIndex += 1) {\n    const xMm = topology.positions2DMm[localIndex * 2];\n    const yMm = topology.positions2DMm[localIndex * 2 + 1];\n    const rawX = (xMm - centerX) * METERS_PER_MM * (placement.mirrorX ? -1 : 1);\n    const rawY = -(yMm - topY) * METERS_PER_MM;\n    const scaledX = rawX * scale;\n    const scaledY = rawY * scale;\n    const rotatedX = scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation);\n    const rotatedY = scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation);\n    target.push(rotatedX, rotatedY, 0);\n  }\n}\n''',
)
replace_once(
    "apps/web/src/garment3d/GarmentAssembly.ts",
    '''  const assembly = garment.assemblyPlacements?.find(\n    (candidate) => candidate.pieceId === piece.id,\n  );\n  const resolved = assembly ?? inferPlacement(piece);\n  const region = roleToRegion(resolved.role);\n  const duplicateSides = resolved.role === "sleeve" || resolved.role === "leg";\n  const sides = duplicateSides\n    ? (["left", "right"] as const)\n    : (["center"] as const);\n\n  return sides.map((bodySide, index) => ({\n    id: `assembly-${piece.id}-${bodySide}`,\n    pieceId: piece.id,\n    region,\n    surface: resolved.outwardSide,\n    bodySide,\n    rotationDeg: resolved.rotationDeg[2],\n    offsetXMm: resolved.positionMm[0],\n    offsetYMm: resolved.positionMm[1],\n    offsetZMm: resolved.positionMm[2],\n    scale: 1,\n    mirrorX: Boolean(resolved.flipped) !== (index === 1),\n  }));\n}\n\nfunction inferPlacement(piece: PatternPiece): AssemblyPlacement {\n  const name = piece.name.toLocaleLowerCase("pt-BR");\n  const roles = new Set(piece.segments?.map((segment) => segment.role) ?? []);\n  const role = name.includes("costas") || roles.has("backArmhole")\n    ? "back"\n    : name.includes("manga") || roles.has("sleeveCapFront") || roles.has("sleeveCapBack")\n      ? "sleeve"\n      : name.includes("perna") || name.includes("calça") || roles.has("inseam") || roles.has("outseam")\n        ? "leg"\n        : name.includes("saia") || name.includes("cós") || name.includes("cintura")\n          ? "waist"\n          : name.includes("gola")\n            ? "collar"\n            : "front";\n\n  return {\n    pieceId: piece.id,\n    role,\n    outwardSide: role === "back" ? "back" : "front",\n    positionMm: [0, 0, 0],\n    rotationDeg: [0, 0, 0],\n    flipped: false,\n    source: "inferred",\n  };\n}\n''',
    '''  const placements = garment.assemblyPlacements?.filter(\n    (candidate) => candidate.pieceId === piece.id,\n  ) ?? [];\n  return placements.flatMap((resolved) => {\n    const region = roleToRegion(resolved.role);\n    const duplicateSides = (resolved.role === "sleeve" || resolved.role === "leg") && (piece.cutQuantity ?? 1) > 1;\n    const sides = duplicateSides ? (["left", "right"] as const) : (["center"] as const);\n    return sides.map((bodySide, index) => ({\n      id: `assembly-${piece.id}-${bodySide}`,\n      pieceId: piece.id,\n      region,\n      surface: resolved.outwardSide,\n      bodySide,\n      rotationDeg: resolved.rotationDeg[2],\n      offsetXMm: resolved.positionMm[0],\n      offsetYMm: resolved.positionMm[1],\n      offsetZMm: resolved.positionMm[2],\n      scale: 1,\n      mirrorX: Boolean(resolved.flipped) !== (index === 1),\n    }));\n  });\n}\n''',
)
# Remove now-unused self-seamed set and PatternPiece import remains used by placement resolver.
replace_once(
    "apps/web/src/garment3d/GarmentAssembly.ts",
    '''  const selfSeamedPieceIds = new Set(\n    (garment.seams ?? [])\n      .filter(\n        (seam) =>\n          seam.active !== false &&\n          seam.first.pieceId === seam.second.pieceId &&\n          !rangesAreIdentical(seam.first, seam.second),\n      )\n      .map((seam) => seam.first.pieceId),\n  );\n\n''',
    '',
)

# Physical assembly no longer imposes a generic front/back depth before semantic arrangement.
replace_once(
    "apps/web/src/garment3d/PhysicalGarmentAssembly.ts",
    '''const FRONT_SURFACE_Z = 0.07;\nconst BACK_SURFACE_Z = -0.07;\n''',
    '',
)
replace_once(
    "apps/web/src/garment3d/PhysicalGarmentAssembly.ts",
    '''  const targetZ =\n    instance.placement.surface === "front"\n      ? FRONT_SURFACE_Z\n      : instance.placement.surface === "back"\n        ? BACK_SURFACE_Z\n        : 0;\n  const offsetZ = instance.placement.offsetZMm * 0.001;\n\n  translateValues(values, 0, 0, targetZ + offsetZ - averageZ);''',
    '''  translateValues(values, 0, 0, -averageZ);''',
)

# Three bridge supports diagnostics hiding invalid instances and per-instance winding.
replace_once(
    "apps/web/src/garment3d/GarmentThreeBridge.ts",
    '''export interface GarmentThreeBridgeOptions {\n  castShadow: boolean;\n  receiveShadow: boolean;\n}\n''',
    '''export interface GarmentThreeBridgeOptions {\n  castShadow: boolean;\n  receiveShadow: boolean;\n  visibleInstanceIds?: ReadonlySet<string>;\n}\n''',
)
replace_once(
    "apps/web/src/garment3d/GarmentThreeBridge.ts",
    '''  for (const instance of state.instances) {\n    const piece = pieceById.get(instance.pieceId);''',
    '''  for (const instance of state.instances) {\n    if (options.visibleInstanceIds && !options.visibleInstanceIds.has(instance.id)) continue;\n    const piece = pieceById.get(instance.pieceId);''',
)
replace_once(
    "apps/web/src/garment3d/GarmentThreeBridge.ts",
    '''  geometry.setIndex(Array.from(instance.topology.triangles));''',
    '''  const indices = Array.from(instance.topology.triangles);\n  if (instance.arrangement?.flipWinding) {\n    for (let index = 0; index < indices.length; index += 3) {\n      const second = indices[index + 1];\n      indices[index + 1] = indices[index + 2];\n      indices[index + 2] = second;\n    }\n  }\n  geometry.setIndex(indices);''',
)

# Public interface and eligibility.
replace_once(
    "apps/web/src/App.tsx",
    '''import { PreviewPlacementPanel } from "./components/PreviewPlacementPanel";''',
    '''import { PreviewPlacementPanel } from "./components/PreviewPlacementPanel";''',
)
replace_once(
    "apps/web/src/App.tsx",
    '''import { createPreviewPlacement, type GarmentDraft, type PreviewRegion } from "./domain/pattern";''',
    '''import type { GarmentDraft } from "./domain/pattern";''',
)
replace_once(
    "apps/web/src/App.tsx",
    '''  const handlePieceDrop = useCallback((pieceId: string, region: PreviewRegion) => {\n    selectPiece(pieceId);\n    setActivePiecePlacements([createPreviewPlacement(pieceId, { region })]);\n  }, [selectPiece, setActivePiecePlacements]);\n''',
    '',
)
replace_once(
    "apps/web/src/App.tsx",
    '''                onBackendChange={setRenderBackend}\n                onPieceDrop={handlePieceDrop}\n                showBody={workspaceMode === "fitting"}\n                connectedPieceIds={eligibility.connectedPieceIds}\n''',
    '''                onBackendChange={setRenderBackend}\n''',
)
replace_once(
    "apps/web/src/App.tsx",
    '''            Prévia 3D''',
    '''            Manequim 3D''',
)
replace_once(
    "apps/web/src/App.tsx",
    '''              handleSimulate();''',
    '''              handleDressBody();''',
)
replace_once(
    "apps/web/src/App.tsx",
    '''      <strong>{loading ? "Preparando prévia 3D" : "Montagem 3D ainda indisponível"}</strong>\n      <span>{loading ? "O editor 2D continua leve enquanto o 3D carrega." : "Conecte duas peças válidas por uma costura e solicite a montagem."}</span>''',
    '''      <strong>{loading ? "Preparando manequim vestido" : "Manequim 3D ainda indisponível"}</strong>\n      <span>{loading ? "O editor 2D continua leve enquanto avatar e roupa são preparados." : "Crie ao menos uma peça triangulável e solicite a prova no manequim."}</span>''',
)

replace_once(
    "apps/web/src/components/Toolbar.tsx",
    '''        <button className="primary-button" type="button" disabled={!canAssemble3D} onClick={onSimulate}>Montar no 3D</button>''',
    '''        <button className="primary-button" type="button" disabled={!canAssemble3D} onClick={onSimulate}>Vestir no manequim</button>''',
)

write(
    "apps/web/src/components/PreviewPlacementPanel.tsx",
    r'''
import { createPreviewPlacement, type PatternPreviewPlacement, type PreviewBodySide, type PreviewRegion, type PreviewSurface } from "../domain/pattern";
import { useEditorStore } from "../state/editorStore";

export function PreviewPlacementPanel() {
  const garment = useEditorStore((state) => state.garment);
  const activePieceId = useEditorStore((state) => state.activePieceId);
  const setPlacements = useEditorStore((state) => state.setActivePiecePlacements);
  const piece = garment.pieces.find((item) => item.id === activePieceId) ?? garment.pieces[0];
  const placement = piece.previewPlacements?.[0] ?? createPreviewPlacement(piece.id);
  const update = (values: Partial<PatternPreviewPlacement>) => setPlacements([{ ...placement, ...values }]);

  return (
    <aside className="placement-panel">
      <span className="section-eyebrow">Anchor semântico</span>
      <h2>{piece.name}</h2>
      <p className="muted">Defina região, superfície e lado corporal. Sem anchor válido, a peça gera diagnóstico e não aparece suspensa.</p>
      <PlacementSelect label="Região" value={placement.region} options={["torso", "waist", "hip", "arm", "leg"]} onChange={(region) => update({ region: region as PreviewRegion })} />
      <PlacementSelect label="Superfície" value={placement.surface} options={["front", "back", "side"]} onChange={(surface) => update({ surface: surface as PreviewSurface })} />
      <PlacementSelect label="Lado" value={placement.bodySide} options={["center", "left", "right"]} onChange={(bodySide) => update({ bodySide: bodySide as PreviewBodySide })} />
      {(["rotationDeg", "offsetXMm", "offsetYMm", "offsetZMm"] as const).map((field) => (
        <label className="placement-field" key={field}>
          <span>{{ rotationDeg: "Rotação local (°)", offsetXMm: "Ajuste X (mm)", offsetYMm: "Ajuste Y (mm)", offsetZMm: "Margem adicional Z (mm)" }[field]}</span>
          <input type="number" step={1} value={placement[field]} onChange={(event) => Number.isFinite(event.currentTarget.valueAsNumber) && update({ [field]: event.currentTarget.valueAsNumber })} />
        </label>
      ))}
      <button type="button" onClick={() => setPlacements([])}>Remover anchor</button>
    </aside>
  );
}

function PlacementSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange(value: string): void }) {
  return <label className="placement-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}
''',
)

replace_once(
    "apps/web/src/domain/assembly.ts",
    '''  if (graph.validSeamIds.length === 0 && canPreviewGarment) {\n    warnings.push(\n      "Nenhuma costura válida foi criada. As peças serão mostradas separadamente.",\n    );\n  }\n\n  const placementIds = new Set(\n    (garment.assemblyPlacements ?? []).map(\n      (placement) => placement.pieceId,\n    ),\n  );''',
    '''  if (graph.validSeamIds.length === 0 && canPreviewGarment) {\n    warnings.push(\n      "Nenhuma costura válida foi criada. O manequim exibirá somente instâncias com anchors válidos e informará componentes desconectados.",\n    );\n  }\n\n  const placementIds = new Set([\n    ...(garment.assemblyPlacements ?? []).map((placement) => placement.pieceId),\n    ...garment.pieces.filter((piece) => (piece.previewPlacements?.length ?? 0) > 0).map((piece) => piece.id),\n  ]);''',
)
replace_once(
    "apps/web/src/domain/assembly.ts",
    '''    canDressBody:\n      canPreviewGarment &&\n      graph.validSeamIds.length > 0 &&\n      missingPlacements.length === 0,''',
    '''    canDressBody: canPreviewGarment,''',
)
replace_once(
    "apps/web/src/domain/assembly.ts",
    '''  if (!requested || !eligibility.canPreviewGarment) return false;\n  return mode !== "fitting" || eligibility.canDressBody;''',
    '''  void mode;\n  return requested && eligibility.canPreviewGarment;''',
)
# Replace name-based public placement inference with segment semantics only.
start = (ROOT / "apps/web/src/domain/assembly.ts").read_text(encoding="utf-8")
old_start = start.index("export function inferAssemblyPlacement(")
old_end = start.index("\nfunction rangesAreIdentical", old_start)
new_function = r'''export function inferAssemblyPlacement(
  piece: PatternPiece,
  index = 0,
): AssemblyPlacement {
  const roles = new Set(piece.segments?.map((segment) => segment.role) ?? []);
  const role = roles.has("backArmhole")
    ? "back"
    : roles.has("sleeveCapFront") || roles.has("sleeveCapBack")
      ? "sleeve"
      : roles.has("inseam") || roles.has("outseam")
        ? "leg"
        : roles.has("waist") && roles.has("hem") && !roles.has("frontArmhole")
          ? "waist"
          : roles.has("frontArmhole")
            ? "front"
            : "custom";
  const outwardSide = role === "back" ? "back" : "front";
  return {
    pieceId: piece.id,
    role,
    outwardSide,
    positionMm: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    flipped: false,
    source: role === "custom" ? "manual" : "inferred",
  };
}
'''
(ROOT / "apps/web/src/domain/assembly.ts").write_text(start[:old_start] + new_function + start[old_end:], encoding="utf-8")

# Export new modules.
index_path = ROOT / "apps/web/src/garment3d/index.ts"
index_source = index_path.read_text(encoding="utf-8")
if 'export * from "./SemanticAvatarArrangement";' not in index_source:
    index_source += '\nexport * from "./SemanticAvatarArrangement";\n'
index_path.write_text(index_source, encoding="utf-8")

# Remove dead viewport implementation and misleading test from the active tree.
for obsolete in [
    "apps/web/src/viewport/ThreeViewport.ts",
    "apps/web/src/viewport/ThreeViewport.test.ts",
]:
    path = ROOT / obsolete
    if path.exists():
        path.unlink()

# Policy-friendly styles for multiple diagnostics without hiding the avatar.
styles = ROOT / "apps/web/src/styles.css"
style_source = styles.read_text(encoding="utf-8")
style_append = r'''

.viewport-warnings {
  display: grid;
  gap: 0.25rem;
  max-height: min(34%, 13rem);
  overflow: auto;
}

.viewport-warnings span {
  display: block;
}
'''
if ".viewport-warnings span" not in style_source:
    styles.write_text(style_source + style_append, encoding="utf-8")

print("Prompt 9 implementation applied")
