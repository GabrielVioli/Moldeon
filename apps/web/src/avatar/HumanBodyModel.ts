import type { BodyMeasurements } from "../domain/pattern";
import {
  createMeasurementProfile,
  measurementProfileToBodyMeasurements,
  type MeasurementOrigin,
} from "../domain/parametricMeasurements";

export type HumanBodyVector3 = [number, number, number];
export type HumanBodyMeasurementSource = MeasurementOrigin;

export type HumanBodyRegionId =
  | "neck"
  | "shoulder-left"
  | "shoulder-right"
  | "bust-left"
  | "bust-right"
  | "underbust"
  | "chest-front"
  | "back-upper"
  | "waist"
  | "abdomen"
  | "high-hip"
  | "full-hip"
  | "pelvis-front"
  | "pelvis-back"
  | "glute-left"
  | "glute-right"
  | "crotch"
  | "thigh-left"
  | "thigh-right"
  | "knee-left"
  | "knee-right"
  | "calf-left"
  | "calf-right"
  | "ankle-left"
  | "ankle-right"
  | "upper-arm-left"
  | "upper-arm-right"
  | "forearm-left"
  | "forearm-right"
  | "wrist-left"
  | "wrist-right";

export type HumanBodyLandmarkId =
  | "ground-center"
  | "head-top"
  | "neck-base-center"
  | "shoulder-left"
  | "shoulder-right"
  | "bust-apex-left"
  | "bust-apex-right"
  | "center-front-waist"
  | "center-back-waist"
  | "side-waist-left"
  | "side-waist-right"
  | "high-hip-front"
  | "high-hip-back"
  | "full-hip-front"
  | "full-hip-back"
  | "crotch-front"
  | "crotch-back"
  | "inseam-top-left"
  | "inseam-top-right"
  | "thigh-widest-left"
  | "thigh-widest-right"
  | "knee-left"
  | "knee-right"
  | "ankle-left"
  | "ankle-right"
  | "armhole-left"
  | "armhole-right"
  | "elbow-left"
  | "elbow-right"
  | "wrist-left"
  | "wrist-right";

export interface HumanBodyMeasurements {
  heightMm: number;
  shoulderWidthMm: number;
  neckCircumferenceMm: number;
  bustMm: number;
  underbustMm: number;
  waistMm: number;
  highHipMm: number;
  fullHipMm: number;
  torsoLengthMm: number;
  shoulderToBustMm: number;
  bustPointDistanceMm: number;
  waistToHipMm: number;
  hipToCrotchMm: number;
  crotchDepthMm: number;
  thighMm: number;
  kneeMm: number;
  calfMm: number;
  ankleMm: number;
  bicepMm: number;
  elbowMm: number;
  wristMm: number;
  armLengthMm: number;
  inseamMm: number;
  outseamMm: number;
  headCircumferenceMm: number;
}

export interface HumanBodyFrame {
  units: "m";
  measurementUnits: "mm";
  origin: "ground-center-between-feet";
  up: HumanBodyVector3;
  front: HumanBodyVector3;
  right: HumanBodyVector3;
  left: HumanBodyVector3;
}

export interface HumanBodyJoint {
  id: string;
  position: HumanBodyVector3;
}

export interface HumanBodyLandmark {
  id: HumanBodyLandmarkId;
  position: HumanBodyVector3;
  normal: HumanBodyVector3;
}

export interface HumanBodyCrossSection {
  id: string;
  region: HumanBodyRegionId;
  yM: number;
  targetCircumferenceMm: number;
  halfWidthM: number;
  frontDepthM: number;
  backDepthM: number;
  centerZM: number;
  frontLobeM: number;
  backLobeM: number;
  lobeHalfDistanceM: number;
}

export interface HumanBodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  regionIds: HumanBodyRegionId[];
  bounds: {
    min: HumanBodyVector3;
    max: HumanBodyVector3;
  };
}

export interface HumanBodySurfaceRegion {
  id: HumanBodyRegionId;
  visualVertexIndices: Uint32Array;
  collisionVertexIndices: Uint32Array;
}

export interface HumanBodyDiagnostics {
  visual: HumanBodyMeshDiagnostics;
  collision: HumanBodyMeshDiagnostics;
  measurementErrorsMm: Record<string, number>;
  lodSectionDeltaMm: Record<string, number>;
  maxLodSectionDeltaMm: number;
  landmarkToleranceMm: number;
  circumferenceToleranceMm: number;
  lengthToleranceMm: number;
}

export interface HumanBodyMeshDiagnostics {
  vertexCount: number;
  triangleCount: number;
  finite: boolean;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  degenerateTriangleCount: number;
  signedVolumeM3: number;
  normalsConsistent: boolean;
}

export interface HumanBodyModel {
  version: "human-body-female@1";
  sex: "female";
  measurements: HumanBodyMeasurements;
  measurementSources: Record<keyof HumanBodyMeasurements, HumanBodyMeasurementSource>;
  bodyFrame: HumanBodyFrame;
  joints: Record<string, HumanBodyJoint>;
  landmarks: Record<HumanBodyLandmarkId, HumanBodyLandmark>;
  surfaceRegions: HumanBodySurfaceRegion[];
  collisionMesh: HumanBodyMesh;
  visualMesh: HumanBodyMesh;
  crossSections: HumanBodyCrossSection[];
  diagnostics: HumanBodyDiagnostics;
  editorMeasurementsMm: {
    quarterWaist: number;
    quarterHip: number;
    bust: number;
    shoulderWidth: number;
    waistToHip: number;
    rise: number;
  };
}

export interface HumanBodyBuildOptions {
  visualResolution?: readonly [number, number, number];
  collisionResolution?: readonly [number, number, number];
  disableCache?: boolean;
}

interface AnatomyFrame {
  heightM: number;
  groundY: number;
  ankleY: number;
  kneeY: number;
  crotchY: number;
  fullHipY: number;
  highHipY: number;
  waistY: number;
  underbustY: number;
  bustY: number;
  upperChestY: number;
  shoulderY: number;
  neckBaseY: number;
  headCenterY: number;
  shoulderLeft: HumanBodyVector3;
  shoulderRight: HumanBodyVector3;
  elbowLeft: HumanBodyVector3;
  elbowRight: HumanBodyVector3;
  wristLeft: HumanBodyVector3;
  wristRight: HumanBodyVector3;
  hipLeft: HumanBodyVector3;
  hipRight: HumanBodyVector3;
  kneeLeft: HumanBodyVector3;
  kneeRight: HumanBodyVector3;
  ankleLeft: HumanBodyVector3;
  ankleRight: HumanBodyVector3;
}

interface AnatomyField {
  sample(x: number, y: number, z: number): number;
  regionAt(x: number, y: number, z: number): HumanBodyRegionId;
  bounds: { min: HumanBodyVector3; max: HumanBodyVector3 };
}

interface LatticeVertex {
  x: number;
  y: number;
  z: number;
  value: number;
  id: number;
}

const BODY_FRAME: HumanBodyFrame = {
  units: "m",
  measurementUnits: "mm",
  origin: "ground-center-between-feet",
  up: [0, 1, 0],
  front: [0, 0, 1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

const TETRAHEDRA: readonly (readonly [number, number, number, number])[] = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];

const CUBE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

const DEFAULT_VISUAL_RESOLUTION = [40, 82, 34] as const;
const DEFAULT_COLLISION_RESOLUTION = [28, 58, 24] as const;
const modelCache = new Map<string, HumanBodyModel>();

export function buildHumanBodyModel(
  input: BodyMeasurements,
  options: HumanBodyBuildOptions = {},
): HumanBodyModel {
  const profile = createMeasurementProfile(input, "feminine");
  const resolved = measurementProfileToBodyMeasurements(profile);
  const measurements = resolveHumanMeasurements(resolved);
  const sources = resolveMeasurementSources(profile.entries, measurements);
  const visualResolution = options.visualResolution ?? DEFAULT_VISUAL_RESOLUTION;
  const collisionResolution = options.collisionResolution ?? DEFAULT_COLLISION_RESOLUTION;
  const cacheKey = JSON.stringify({ measurements, visualResolution, collisionResolution });
  if (!options.disableCache) {
    const cached = modelCache.get(cacheKey);
    if (cached) return cached;
  }

  const frame = buildAnatomyFrame(measurements);
  const crossSections = buildTorsoCrossSections(measurements, frame);
  const field = buildAnatomyField(measurements, frame, crossSections);
  const visualMesh = polygonizeAnatomy(field, visualResolution);
  const collisionMesh = polygonizeAnatomy(field, collisionResolution);
  const joints = buildJoints(frame);
  const landmarks = buildLandmarks(measurements, frame, crossSections);
  const surfaceRegions = buildSurfaceRegions(visualMesh, collisionMesh);
  const diagnostics = buildDiagnostics(
    measurements,
    crossSections,
    visualMesh,
    collisionMesh,
    frame,
  );

  const model: HumanBodyModel = {
    version: "human-body-female@1",
    sex: "female",
    measurements,
    measurementSources: sources,
    bodyFrame: BODY_FRAME,
    joints,
    landmarks,
    surfaceRegions,
    collisionMesh,
    visualMesh,
    crossSections,
    diagnostics,
    editorMeasurementsMm: {
      quarterWaist: measurements.waistMm / 4,
      quarterHip: measurements.fullHipMm / 4,
      bust: measurements.bustMm,
      shoulderWidth: measurements.shoulderWidthMm,
      waistToHip: measurements.waistToHipMm,
      rise: measurements.hipToCrotchMm,
    },
  };
  if (!options.disableCache) modelCache.set(cacheKey, model);
  return model;
}

function resolveHumanMeasurements(resolved: BodyMeasurements): HumanBodyMeasurements {
  const height = positive(resolved.heightMm, 1680);
  const bust = positive(resolved.bustMm, 920);
  const waist = positive(resolved.waistMm, 760);
  const hip = positive(resolved.hipMm, 1000);
  const underbust = clamp(
    positive(resolved.highBustMm, bust * 0.93) * 0.94,
    waist * 1.04,
    bust * 0.96,
  );
  const highHip = waist + (hip - waist) * 0.56;
  const waistToHip = positive(resolved.hipHeightMm, height * 0.115);
  const inseam = positive(resolved.insideLegLengthMm ?? resolved.inseamMm, height * 0.465);
  const outseam = positive(resolved.outseamLengthMm, inseam + height * 0.155);
  return {
    heightMm: height,
    shoulderWidthMm: positive(resolved.shoulderWidthMm, height * 0.238),
    neckCircumferenceMm: positive(resolved.neckCircumferenceMm, bust * 0.39),
    bustMm: bust,
    underbustMm: underbust,
    waistMm: waist,
    highHipMm: highHip,
    fullHipMm: hip,
    torsoLengthMm: positive(resolved.torsoLengthMm, height * 0.262),
    shoulderToBustMm: positive(resolved.bustHeightMm, height * 0.157),
    bustPointDistanceMm: positive(resolved.bustSpanMm, bust * 0.2),
    waistToHipMm: waistToHip,
    hipToCrotchMm: Math.max(80, outseam - inseam - waistToHip),
    crotchDepthMm: positive(resolved.crotchDepthMm, hip * 0.245),
    thighMm: positive(resolved.thighMm, hip * 0.58),
    kneeMm: positive(resolved.kneeCircumferenceMm, hip * 0.4),
    calfMm: positive(resolved.calfMm, hip * 0.38),
    ankleMm: positive(resolved.ankleCircumferenceMm, hip * 0.24),
    bicepMm: positive(resolved.bicepMm, bust * 0.34),
    elbowMm: positive(resolved.elbowCircumferenceMm, bust * 0.29),
    wristMm: positive(resolved.wristMm, bust * 0.18),
    armLengthMm: positive(resolved.armLengthMm, height * 0.35),
    inseamMm: inseam,
    outseamMm: outseam,
    headCircumferenceMm: positive(resolved.headCircumferenceMm, height * 0.335),
  };
}

function resolveMeasurementSources(
  entries: Partial<Record<keyof BodyMeasurements, { origin: MeasurementOrigin }>>,
  measurements: HumanBodyMeasurements,
): Record<keyof HumanBodyMeasurements, HumanBodyMeasurementSource> {
  const from = (key: keyof BodyMeasurements, fallback: MeasurementOrigin = "derived"): MeasurementOrigin =>
    entries[key]?.origin ?? fallback;
  return {
    heightMm: from("heightMm"),
    shoulderWidthMm: from("shoulderWidthMm"),
    neckCircumferenceMm: from("neckCircumferenceMm", "estimated"),
    bustMm: from("bustMm"),
    underbustMm: from("highBustMm", "estimated"),
    waistMm: from("waistMm"),
    highHipMm: measurements.highHipMm === measurements.waistMm ? "supplied" : "derived",
    fullHipMm: from("hipMm"),
    torsoLengthMm: from("torsoLengthMm"),
    shoulderToBustMm: from("bustHeightMm", "estimated"),
    bustPointDistanceMm: from("bustSpanMm", "estimated"),
    waistToHipMm: from("hipHeightMm", "estimated"),
    hipToCrotchMm: "derived",
    crotchDepthMm: from("crotchDepthMm", "estimated"),
    thighMm: from("thighMm", "estimated"),
    kneeMm: from("kneeCircumferenceMm", "estimated"),
    calfMm: from("calfMm", "estimated"),
    ankleMm: from("ankleCircumferenceMm", "estimated"),
    bicepMm: from("bicepMm", "estimated"),
    elbowMm: from("elbowCircumferenceMm", "estimated"),
    wristMm: from("wristMm", "estimated"),
    armLengthMm: from("armLengthMm"),
    inseamMm: from(resolvedAlias(entries, "insideLegLengthMm", "inseamMm")),
    outseamMm: from("outseamLengthMm", "derived"),
    headCircumferenceMm: from("headCircumferenceMm", "estimated"),
  };
}

function resolvedAlias(
  entries: Partial<Record<keyof BodyMeasurements, { origin: MeasurementOrigin }>>,
  preferred: keyof BodyMeasurements,
  fallback: keyof BodyMeasurements,
): keyof BodyMeasurements {
  return entries[preferred] ? preferred : fallback;
}

function buildAnatomyFrame(m: HumanBodyMeasurements): AnatomyFrame {
  const heightM = m.heightMm * 0.001;
  const groundY = 0;
  const ankleY = Math.max(0.055, heightM * 0.038);
  const crotchY = clamp(m.inseamMm * 0.001, heightM * 0.43, heightM * 0.51);
  const waistY = clamp(m.outseamMm * 0.001, crotchY + 0.18, heightM * 0.66);
  const fullHipY = clamp(waistY - m.waistToHipMm * 0.001, crotchY + 0.045, waistY - 0.09);
  const highHipY = lerp(waistY, fullHipY, 0.48);
  const shoulderY = clamp(waistY + m.torsoLengthMm * 0.001 * 0.96, heightM * 0.79, heightM * 0.87);
  const bustY = clamp(shoulderY - m.shoulderToBustMm * 0.001, waistY + 0.10, shoulderY - 0.08);
  const underbustY = lerp(bustY, waistY, 0.38);
  const upperChestY = lerp(bustY, shoulderY, 0.58);
  const neckBaseY = clamp(shoulderY + heightM * 0.035, shoulderY + 0.035, heightM - 0.19);
  const headCenterY = lerp(neckBaseY, heightM, 0.56);
  const kneeY = clamp(crotchY * 0.53, heightM * 0.235, crotchY - 0.24);

  const shoulderHalf = m.shoulderWidthMm * 0.0005;
  const armLength = m.armLengthMm * 0.001;
  const elbowLength = armLength * 0.53;
  const armAngle = 8 * Math.PI / 180;
  const shoulderLeft: HumanBodyVector3 = [-shoulderHalf, shoulderY - 0.008, 0.002];
  const shoulderRight: HumanBodyVector3 = [shoulderHalf, shoulderY - 0.008, 0.002];
  const leftAxis: HumanBodyVector3 = normalize([-Math.sin(armAngle), -Math.cos(armAngle), 0.015]);
  const rightAxis: HumanBodyVector3 = normalize([Math.sin(armAngle), -Math.cos(armAngle), 0.015]);
  const elbowLeft = addScaled(shoulderLeft, leftAxis, elbowLength);
  const elbowRight = addScaled(shoulderRight, rightAxis, elbowLength);
  const wristLeft = addScaled(shoulderLeft, leftAxis, armLength);
  const wristRight = addScaled(shoulderRight, rightAxis, armLength);

  const hipHalf = Math.max(0.055, m.fullHipMm * 0.000085);
  const hipLeft: HumanBodyVector3 = [-hipHalf, crotchY + 0.045, -0.008];
  const hipRight: HumanBodyVector3 = [hipHalf, crotchY + 0.045, -0.008];
  const kneeLeft: HumanBodyVector3 = [-hipHalf * 0.82, kneeY, 0.002];
  const kneeRight: HumanBodyVector3 = [hipHalf * 0.82, kneeY, 0.002];
  const ankleLeft: HumanBodyVector3 = [-hipHalf * 0.78, ankleY, 0.006];
  const ankleRight: HumanBodyVector3 = [hipHalf * 0.78, ankleY, 0.006];

  return {
    heightM,
    groundY,
    ankleY,
    kneeY,
    crotchY,
    fullHipY,
    highHipY,
    waistY,
    underbustY,
    bustY,
    upperChestY,
    shoulderY,
    neckBaseY,
    headCenterY,
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
}

function buildTorsoCrossSections(
  m: HumanBodyMeasurements,
  frame: AnatomyFrame,
): HumanBodyCrossSection[] {
  const shoulderCirc = Math.max(m.underbustMm * 0.98, m.bustMm * 0.88);
  const upperChestCirc = Math.max(m.underbustMm, m.bustMm * 0.91);
  const abdomenCirc = lerp(m.waistMm, m.highHipMm, 0.46);
  const crotchCirc = m.fullHipMm * 0.79;
  return [
    section("crotch", "crotch", frame.crotchY, crotchCirc, 1.38, 1.02, 0.98, 0.004, 0.00, 0.03, 0.24),
    section("full-hip", "full-hip", frame.fullHipY, m.fullHipMm, 1.46, 0.92, 1.08, 0.000, 0.050, 0.060, 0.26),
    section("high-hip", "high-hip", frame.highHipY, m.highHipMm, 1.43, 1.02, 1.00, 0.008, 0.018, 0.022, 0.24),
    section("abdomen", "abdomen", lerp(frame.highHipY, frame.waistY, 0.46), abdomenCirc, 1.33, 1.08, 0.96, 0.012, 0.000, 0.000, 0.22),
    section("waist", "waist", frame.waistY, m.waistMm, 1.34, 1.02, 0.98, 0.004, 0.000, 0.000, 0.22),
    section("underbust", "underbust", frame.underbustY, m.underbustMm, 1.32, 1.04, 0.96, 0.006, 0.008, 0.000, 0.21),
    section("bust", "chest-front", frame.bustY, m.bustMm, 1.30, 1.02, 0.92, 0.010, 0.050, 0.000, clamp(m.bustPointDistanceMm / m.bustMm, 0.16, 0.27)),
    section("upper-chest", "chest-front", frame.upperChestY, upperChestCirc, 1.42, 0.96, 1.02, 0.004, 0.014, 0.000, 0.22),
    section("shoulder", "back-upper", frame.shoulderY, shoulderCirc, 1.70, 0.88, 1.12, -0.002, 0.000, 0.000, 0.22),
  ];
}

function section(
  id: string,
  region: HumanBodyRegionId,
  yM: number,
  circumferenceMm: number,
  widthRatio: number,
  frontRatio: number,
  backRatio: number,
  centerZM: number,
  frontLobeRatio: number,
  backLobeRatio: number,
  lobeHalfDistanceRatio: number,
): HumanBodyCrossSection {
  const base = {
    halfWidthM: widthRatio,
    frontDepthM: frontRatio,
    backDepthM: backRatio,
    frontLobeM: frontLobeRatio,
    backLobeM: backLobeRatio,
    lobeHalfDistanceM: widthRatio * lobeHalfDistanceRatio,
  };
  const perimeter = sectionPerimeter(base, 512);
  const scale = circumferenceMm * 0.001 / Math.max(perimeter, 1e-9);
  return {
    id,
    region,
    yM,
    targetCircumferenceMm: circumferenceMm,
    halfWidthM: base.halfWidthM * scale,
    frontDepthM: base.frontDepthM * scale,
    backDepthM: base.backDepthM * scale,
    centerZM,
    frontLobeM: base.frontLobeM * scale,
    backLobeM: base.backLobeM * scale,
    lobeHalfDistanceM: base.lobeHalfDistanceM * scale,
  };
}

function sectionPerimeter(
  sectionValue: Pick<HumanBodyCrossSection, "halfWidthM" | "frontDepthM" | "backDepthM" | "frontLobeM" | "backLobeM" | "lobeHalfDistanceM">,
  samples: number,
): number {
  let total = 0;
  let previous = sectionPoint(sectionValue, 0);
  for (let index = 1; index <= samples; index += 1) {
    const point = sectionPoint(sectionValue, index / samples * Math.PI * 2);
    total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return total;
}

function sectionPoint(
  s: Pick<HumanBodyCrossSection, "halfWidthM" | "frontDepthM" | "backDepthM" | "frontLobeM" | "backLobeM" | "lobeHalfDistanceM">,
  angle: number,
): readonly [number, number] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = s.halfWidthM * cosine;
  const baseDepth = sine >= 0 ? s.frontDepthM : s.backDepthM;
  const lobe = sine >= 0 ? s.frontLobeM : s.backLobeM;
  const sigma = Math.max(s.halfWidthM * 0.18, 1e-4);
  const lobeWeight = Math.exp(-((Math.abs(x) - s.lobeHalfDistanceM) / sigma) ** 2);
  const shaped = baseDepth * sine + Math.sign(sine) * lobe * lobeWeight * Math.pow(Math.abs(sine), 0.72);
  return [x, shaped];
}

function buildAnatomyField(
  m: HumanBodyMeasurements,
  frame: AnatomyFrame,
  sections: readonly HumanBodyCrossSection[],
): AnatomyField {
  const headCircM = m.headCircumferenceMm * 0.001;
  const headRadius = headCircM / (2 * Math.PI);
  const neckRadius = m.neckCircumferenceMm * 0.001 / (2 * Math.PI);
  const upperArmAxes = ellipseAxesForPerimeter(m.bicepMm * 0.001, 1.08);
  const elbowAxes = ellipseAxesForPerimeter(m.elbowMm * 0.001, 1.06);
  const wristAxes = ellipseAxesForPerimeter(m.wristMm * 0.001, 1.04);
  const thighAxes = ellipseAxesForPerimeter(m.thighMm * 0.001, 1.12);
  const kneeAxes = ellipseAxesForPerimeter(m.kneeMm * 0.001, 1.06);
  const calfAxes = ellipseAxesForPerimeter(m.calfMm * 0.001, 1.08);
  const ankleAxes = ellipseAxesForPerimeter(m.ankleMm * 0.001, 1.04);
  const footLength = clamp(m.heightMm * 0.000145, 0.20, 0.29);
  const handLength = clamp(m.heightMm * 0.000108, 0.15, 0.21);
  const widestSection = Math.max(...sections.map((sectionValue) => sectionValue.halfWidthM));
  const wristX = Math.max(Math.abs(frame.wristLeft[0]), Math.abs(frame.wristRight[0]));
  const xExtent = Math.max(widestSection + 0.08, wristX + wristAxes[0] + 0.04, m.shoulderWidthMm * 0.0005 + 0.08);
  const zFront = Math.max(
    ...sections.map((sectionValue) => sectionValue.centerZM + sectionValue.frontDepthM + sectionValue.frontLobeM),
    footLength * 0.82,
  );
  const zBack = Math.max(...sections.map((sectionValue) => -sectionValue.centerZM + sectionValue.backDepthM + sectionValue.backLobeM));

  const torsoField = (x: number, y: number, z: number): number => {
    if (y < sections[0].yM - 0.04 || y > sections[sections.length - 1].yM + 0.04) return 1;
    const s = interpolateCrossSection(sections, y);
    const absX = Math.abs(x);
    if (absX > s.halfWidthM) return absX - s.halfWidthM;
    const normalizedX = clamp(absX / Math.max(s.halfWidthM, 1e-6), 0, 1);
    const vertical = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
    const sigma = Math.max(s.halfWidthM * 0.18, 1e-4);
    const lobeWeight = Math.exp(-((absX - s.lobeHalfDistanceM) / sigma) ** 2);
    const front = s.centerZM
      + s.frontDepthM * vertical
      + s.frontLobeM * lobeWeight * Math.pow(vertical, 0.72);
    const back = s.centerZM
      - s.backDepthM * vertical
      - s.backLobeM * lobeWeight * Math.pow(vertical, 0.72);
    if (z > front) return z - front;
    if (z < back) return back - z;
    return -Math.min(front - z, z - back, s.halfWidthM - absX);
  };

  const neckField = (x: number, y: number, z: number) => sweptEllipseField(
    [x, y, z],
    [0, frame.shoulderY - 0.015, -0.004],
    [0, frame.neckBaseY + 0.035, -0.006],
    neckRadius * 1.12,
    neckRadius * 0.96,
    neckRadius * 1.02,
    neckRadius * 0.92,
  );

  const headField = (x: number, y: number, z: number) => ellipsoidField(
    x,
    y,
    z,
    [0, frame.headCenterY, -headRadius * 0.05],
    [headRadius * 0.82, Math.max(0.09, (frame.heightM - frame.neckBaseY) * 0.48), headRadius * 0.96],
  );

  const armField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const shoulder = side < 0 ? frame.shoulderLeft : frame.shoulderRight;
    const elbow = side < 0 ? frame.elbowLeft : frame.elbowRight;
    const wrist = side < 0 ? frame.wristLeft : frame.wristRight;
    const upper = sweptEllipseField([x, y, z], shoulder, elbow, upperArmAxes[0], upperArmAxes[1], elbowAxes[0], elbowAxes[1]);
    const lower = sweptEllipseField([x, y, z], elbow, wrist, elbowAxes[0], elbowAxes[1], wristAxes[0], wristAxes[1]);
    const handCenter: HumanBodyVector3 = [wrist[0] + side * wristAxes[0] * 0.08, wrist[1] - handLength * 0.43, wrist[2] + handLength * 0.04];
    const hand = ellipsoidField(x, y, z, handCenter, [wristAxes[0] * 1.15, handLength * 0.46, wristAxes[1] * 0.78]);
    return smoothMin(smoothMin(upper, lower, 0.010), hand, 0.008);
  };

  const legField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const hip = side < 0 ? frame.hipLeft : frame.hipRight;
    const knee = side < 0 ? frame.kneeLeft : frame.kneeRight;
    const ankle = side < 0 ? frame.ankleLeft : frame.ankleRight;
    const upper = sweptEllipseField([x, y, z], hip, knee, thighAxes[0], thighAxes[1], kneeAxes[0], kneeAxes[1]);
    const lower = sweptEllipseField([x, y, z], knee, ankle, kneeAxes[0], kneeAxes[1], ankleAxes[0], ankleAxes[1], 0.12, calfAxes);
    const footCenter: HumanBodyVector3 = [ankle[0], Math.max(0.025, frame.ankleY * 0.48), footLength * 0.34];
    const foot = ellipsoidField(x, y, z, footCenter, [ankleAxes[0] * 1.02, Math.max(0.025, frame.ankleY * 0.50), footLength * 0.55]);
    return smoothMin(smoothMin(upper, lower, 0.012), foot, 0.010);
  };

  const sample = (x: number, y: number, z: number): number => {
    let body = torsoField(x, y, z);
    body = smoothMin(body, neckField(x, y, z), 0.024);
    body = smoothMin(body, headField(x, y, z), 0.012);
    body = smoothMin(body, armField(-1, x, y, z), 0.026);
    body = smoothMin(body, armField(1, x, y, z), 0.026);
    body = smoothMin(body, legField(-1, x, y, z), 0.018);
    body = smoothMin(body, legField(1, x, y, z), 0.018);

    // A real crotch bifurcation is carved from the unified implicit volume.
    // It is topology-driven by the paired hip/leg frame, not a garment rule.
    const separator = ellipsoidField(
      x,
      y,
      z,
      [0, frame.crotchY - 0.055, 0.020],
      [Math.max(0.018, Math.abs(frame.hipRight[0]) * 0.42), 0.155, Math.max(0.075, m.crotchDepthMm * 0.00038)],
    );
    if (y <= frame.crotchY + 0.025) body = Math.max(body, -separator);
    return body;
  };

  const regionAt = (x: number, y: number, z: number): HumanBodyRegionId => classifyRegion(frame, sections, x, y, z);

  return {
    sample,
    regionAt,
    bounds: {
      min: [-xExtent, -0.025, -zBack - 0.05],
      max: [xExtent, frame.heightM + 0.025, zFront + 0.05],
    },
  };
}

function interpolateCrossSection(
  sections: readonly HumanBodyCrossSection[],
  y: number,
): HumanBodyCrossSection {
  if (y <= sections[0].yM) return sections[0];
  if (y >= sections[sections.length - 1].yM) return sections[sections.length - 1];
  for (let index = 1; index < sections.length; index += 1) {
    const lower = sections[index - 1];
    const upper = sections[index];
    if (y <= upper.yM) {
      const t = smoothstep(clamp((y - lower.yM) / Math.max(1e-6, upper.yM - lower.yM), 0, 1));
      return {
        id: `${lower.id}->${upper.id}`,
        region: t < 0.5 ? lower.region : upper.region,
        yM: y,
        targetCircumferenceMm: lerp(lower.targetCircumferenceMm, upper.targetCircumferenceMm, t),
        halfWidthM: lerp(lower.halfWidthM, upper.halfWidthM, t),
        frontDepthM: lerp(lower.frontDepthM, upper.frontDepthM, t),
        backDepthM: lerp(lower.backDepthM, upper.backDepthM, t),
        centerZM: lerp(lower.centerZM, upper.centerZM, t),
        frontLobeM: lerp(lower.frontLobeM, upper.frontLobeM, t),
        backLobeM: lerp(lower.backLobeM, upper.backLobeM, t),
        lobeHalfDistanceM: lerp(lower.lobeHalfDistanceM, upper.lobeHalfDistanceM, t),
      };
    }
  }
  return sections[sections.length - 1];
}

function polygonizeAnatomy(
  field: AnatomyField,
  resolutionInput: readonly [number, number, number],
): HumanBodyMesh {
  const resolution: [number, number, number] = [
    clampInt(resolutionInput[0], 18, 72),
    clampInt(resolutionInput[1], 32, 128),
    clampInt(resolutionInput[2], 16, 72),
  ];
  const [nx, ny, nz] = resolution;
  const min = field.bounds.min;
  const max = field.bounds.max;
  const sx = (max[0] - min[0]) / nx;
  const sy = (max[1] - min[1]) / ny;
  const sz = (max[2] - min[2]) / nz;
  const gx = nx + 1;
  const gy = ny + 1;
  const gz = nz + 1;
  const values = new Float32Array(gx * gy * gz);
  const latticeId = (ix: number, iy: number, iz: number) => (iz * gy + iy) * gx + ix;

  for (let iz = 0; iz < gz; iz += 1) {
    const z = min[2] + iz * sz;
    for (let iy = 0; iy < gy; iy += 1) {
      const y = min[1] + iy * sy;
      for (let ix = 0; ix < gx; ix += 1) {
        const x = min[0] + ix * sx;
        values[latticeId(ix, iy, iz)] = field.sample(x, y, z);
      }
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const regionIds: HumanBodyRegionId[] = [];
  const edgeVertexCache = new Map<string, number>();

  const latticeVertex = (ix: number, iy: number, iz: number): LatticeVertex => {
    const id = latticeId(ix, iy, iz);
    return {
      x: min[0] + ix * sx,
      y: min[1] + iy * sy,
      z: min[2] + iz * sz,
      value: values[id],
      id,
    };
  };

  const edgeVertex = (a: LatticeVertex, b: LatticeVertex): number => {
    const first = Math.min(a.id, b.id);
    const second = Math.max(a.id, b.id);
    const key = `${first}:${second}`;
    const cached = edgeVertexCache.get(key);
    if (cached !== undefined) return cached;
    const denominator = a.value - b.value;
    const t = Math.abs(denominator) <= 1e-12 ? 0.5 : clamp(a.value / denominator, 0, 1);
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    const z = lerp(a.z, b.z, t);
    const index = positions.length / 3;
    positions.push(x, y, z);
    regionIds.push(field.regionAt(x, y, z));
    edgeVertexCache.set(key, index);
    return index;
  };

  const emitTriangle = (a: number, b: number, c: number): void => {
    const pa = arrayVertex(positions, a);
    const pb = arrayVertex(positions, b);
    const pc = arrayVertex(positions, c);
    const normal = cross(sub(pb, pa), sub(pc, pa));
    const length = magnitude(normal);
    if (length <= 1e-10) return;
    const centroid: HumanBodyVector3 = [
      (pa[0] + pb[0] + pc[0]) / 3,
      (pa[1] + pb[1] + pc[1]) / 3,
      (pa[2] + pb[2] + pc[2]) / 3,
    ];
    const n = scale(normal, 1 / length);
    const epsilon = Math.min(sx, sy, sz) * 0.18;
    const outside = field.sample(centroid[0] + n[0] * epsilon, centroid[1] + n[1] * epsilon, centroid[2] + n[2] * epsilon);
    const inside = field.sample(centroid[0] - n[0] * epsilon, centroid[1] - n[1] * epsilon, centroid[2] - n[2] * epsilon);
    if (outside >= inside) indices.push(a, b, c);
    else indices.push(a, c, b);
  };

  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const cube = CUBE_OFFSETS.map(([ox, oy, oz]) => latticeVertex(ix + ox, iy + oy, iz + oz));
        for (const tetra of TETRAHEDRA) {
          polygonizeTetra(tetra.map((index) => cube[index]) as [LatticeVertex, LatticeVertex, LatticeVertex, LatticeVertex], edgeVertex, emitTriangle);
        }
      }
    }
  }

  const normals = buildVertexNormals(positions, indices);
  const meshBounds = computeBounds(positions);
  return {
    positions: Float32Array.from(positions),
    normals,
    indices: Uint32Array.from(indices),
    regionIds,
    bounds: meshBounds,
  };
}

function polygonizeTetra(
  tetra: readonly [LatticeVertex, LatticeVertex, LatticeVertex, LatticeVertex],
  edgeVertex: (a: LatticeVertex, b: LatticeVertex) => number,
  emitTriangle: (a: number, b: number, c: number) => void,
): void {
  const inside = tetra.filter((vertex) => vertex.value <= 0);
  const outside = tetra.filter((vertex) => vertex.value > 0);
  if (inside.length === 0 || inside.length === 4) return;
  if (inside.length === 1) {
    const a = inside[0];
    const v0 = edgeVertex(a, outside[0]);
    const v1 = edgeVertex(a, outside[1]);
    const v2 = edgeVertex(a, outside[2]);
    emitTriangle(v0, v1, v2);
    return;
  }
  if (inside.length === 3) {
    const a = outside[0];
    const v0 = edgeVertex(a, inside[0]);
    const v1 = edgeVertex(a, inside[1]);
    const v2 = edgeVertex(a, inside[2]);
    emitTriangle(v0, v2, v1);
    return;
  }
  const a = inside[0];
  const b = inside[1];
  const c = outside[0];
  const d = outside[1];
  const ac = edgeVertex(a, c);
  const ad = edgeVertex(a, d);
  const bc = edgeVertex(b, c);
  const bd = edgeVertex(b, d);
  emitTriangle(ac, ad, bc);
  emitTriangle(ad, bd, bc);
}

function buildVertexNormals(positions: number[], indices: number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    const pa = arrayVertex(positions, a);
    const pb = arrayVertex(positions, b);
    const pc = arrayVertex(positions, c);
    const n = cross(sub(pb, pa), sub(pc, pa));
    for (const index of [a, b, c]) {
      normals[index * 3] += n[0];
      normals[index * 3 + 1] += n[1];
      normals[index * 3 + 2] += n[2];
    }
  }
  for (let index = 0; index < normals.length / 3; index += 1) {
    const x = normals[index * 3];
    const y = normals[index * 3 + 1];
    const z = normals[index * 3 + 2];
    const length = Math.hypot(x, y, z) || 1;
    normals[index * 3] = x / length;
    normals[index * 3 + 1] = y / length;
    normals[index * 3 + 2] = z / length;
  }
  return normals;
}

function buildJoints(frame: AnatomyFrame): Record<string, HumanBodyJoint> {
  return Object.fromEntries([
    ["shoulder-left", frame.shoulderLeft],
    ["shoulder-right", frame.shoulderRight],
    ["elbow-left", frame.elbowLeft],
    ["elbow-right", frame.elbowRight],
    ["wrist-left", frame.wristLeft],
    ["wrist-right", frame.wristRight],
    ["hip-left", frame.hipLeft],
    ["hip-right", frame.hipRight],
    ["knee-left", frame.kneeLeft],
    ["knee-right", frame.kneeRight],
    ["ankle-left", frame.ankleLeft],
    ["ankle-right", frame.ankleRight],
  ].map(([id, position]) => [id as string, { id: id as string, position: [...position as HumanBodyVector3] as HumanBodyVector3 }])) as Record<string, HumanBodyJoint>;
}

function buildLandmarks(
  m: HumanBodyMeasurements,
  frame: AnatomyFrame,
  sections: readonly HumanBodyCrossSection[],
): Record<HumanBodyLandmarkId, HumanBodyLandmark> {
  const waist = sectionById(sections, "waist");
  const highHip = sectionById(sections, "high-hip");
  const hip = sectionById(sections, "full-hip");
  const bust = sectionById(sections, "bust");
  const crotch = sectionById(sections, "crotch");
  const bustX = Math.min(bust.halfWidthM * 0.58, m.bustPointDistanceMm * 0.0005);
  const landmark = (id: HumanBodyLandmarkId, position: HumanBodyVector3, normal: HumanBodyVector3): HumanBodyLandmark => ({ id, position, normal: normalize(normal) });
  return {
    "ground-center": landmark("ground-center", [0, 0, 0], [0, 1, 0]),
    "head-top": landmark("head-top", [0, frame.heightM, -0.004], [0, 1, 0]),
    "neck-base-center": landmark("neck-base-center", [0, frame.neckBaseY, -0.004], [0, 0, 1]),
    "shoulder-left": landmark("shoulder-left", frame.shoulderLeft, [-1, 0.25, 0]),
    "shoulder-right": landmark("shoulder-right", frame.shoulderRight, [1, 0.25, 0]),
    "bust-apex-left": landmark("bust-apex-left", [-bustX, frame.bustY, bust.centerZM + bust.frontDepthM + bust.frontLobeM], [0, 0, 1]),
    "bust-apex-right": landmark("bust-apex-right", [bustX, frame.bustY, bust.centerZM + bust.frontDepthM + bust.frontLobeM], [0, 0, 1]),
    "center-front-waist": landmark("center-front-waist", [0, frame.waistY, waist.centerZM + waist.frontDepthM], [0, 0, 1]),
    "center-back-waist": landmark("center-back-waist", [0, frame.waistY, waist.centerZM - waist.backDepthM], [0, 0, -1]),
    "side-waist-left": landmark("side-waist-left", [-waist.halfWidthM, frame.waistY, waist.centerZM], [-1, 0, 0]),
    "side-waist-right": landmark("side-waist-right", [waist.halfWidthM, frame.waistY, waist.centerZM], [1, 0, 0]),
    "high-hip-front": landmark("high-hip-front", [0, frame.highHipY, highHip.centerZM + highHip.frontDepthM], [0, 0, 1]),
    "high-hip-back": landmark("high-hip-back", [0, frame.highHipY, highHip.centerZM - highHip.backDepthM - highHip.backLobeM], [0, 0, -1]),
    "full-hip-front": landmark("full-hip-front", [0, frame.fullHipY, hip.centerZM + hip.frontDepthM], [0, 0, 1]),
    "full-hip-back": landmark("full-hip-back", [0, frame.fullHipY, hip.centerZM - hip.backDepthM - hip.backLobeM], [0, 0, -1]),
    "crotch-front": landmark("crotch-front", [0, frame.crotchY, crotch.centerZM + crotch.frontDepthM * 0.78], [0, 0, 1]),
    "crotch-back": landmark("crotch-back", [0, frame.crotchY, crotch.centerZM - crotch.backDepthM * 0.88], [0, 0, -1]),
    "inseam-top-left": landmark("inseam-top-left", [frame.hipLeft[0] * 0.36, frame.crotchY - 0.012, 0.012], [1, 0, 0]),
    "inseam-top-right": landmark("inseam-top-right", [frame.hipRight[0] * 0.36, frame.crotchY - 0.012, 0.012], [-1, 0, 0]),
    "thigh-widest-left": landmark("thigh-widest-left", [frame.hipLeft[0], frame.crotchY - 0.085, 0.012], [-1, 0, 0]),
    "thigh-widest-right": landmark("thigh-widest-right", [frame.hipRight[0], frame.crotchY - 0.085, 0.012], [1, 0, 0]),
    "knee-left": landmark("knee-left", frame.kneeLeft, [-1, 0, 0]),
    "knee-right": landmark("knee-right", frame.kneeRight, [1, 0, 0]),
    "ankle-left": landmark("ankle-left", frame.ankleLeft, [-1, 0, 0]),
    "ankle-right": landmark("ankle-right", frame.ankleRight, [1, 0, 0]),
    "armhole-left": landmark("armhole-left", [frame.shoulderLeft[0] * 0.82, frame.shoulderY - 0.075, 0.015], [-1, 0, 0.2]),
    "armhole-right": landmark("armhole-right", [frame.shoulderRight[0] * 0.82, frame.shoulderY - 0.075, 0.015], [1, 0, 0.2]),
    "elbow-left": landmark("elbow-left", frame.elbowLeft, [-1, 0, 0]),
    "elbow-right": landmark("elbow-right", frame.elbowRight, [1, 0, 0]),
    "wrist-left": landmark("wrist-left", frame.wristLeft, [-1, 0, 0]),
    "wrist-right": landmark("wrist-right", frame.wristRight, [1, 0, 0]),
  };
}

function buildSurfaceRegions(
  visual: HumanBodyMesh,
  collision: HumanBodyMesh,
): HumanBodySurfaceRegion[] {
  const ids = [...new Set([...visual.regionIds, ...collision.regionIds])].sort() as HumanBodyRegionId[];
  return ids.map((id) => ({
    id,
    visualVertexIndices: Uint32Array.from(visual.regionIds.flatMap((region, index) => region === id ? [index] : [])),
    collisionVertexIndices: Uint32Array.from(collision.regionIds.flatMap((region, index) => region === id ? [index] : [])),
  }));
}

function buildDiagnostics(
  measurements: HumanBodyMeasurements,
  sections: readonly HumanBodyCrossSection[],
  visual: HumanBodyMesh,
  collision: HumanBodyMesh,
  frame: AnatomyFrame,
): HumanBodyDiagnostics {
  const visualDiagnostics = inspectMesh(visual);
  const collisionDiagnostics = inspectMesh(collision);
  const critical = [
    ["bust", frame.bustY, measurements.bustMm],
    ["waist", frame.waistY, measurements.waistMm],
    ["hip", frame.fullHipY, measurements.fullHipMm],
  ] as const;
  const measurementErrorsMm: Record<string, number> = {};
  const lodSectionDeltaMm: Record<string, number> = {};
  for (const [id, y, target] of critical) {
    const visualCirc = measureMeshCircumferenceAtY(visual, y) * 1000;
    const collisionCirc = measureMeshCircumferenceAtY(collision, y) * 1000;
    measurementErrorsMm[id] = visualCirc > 0 ? visualCirc - target : Number.POSITIVE_INFINITY;
    lodSectionDeltaMm[id] = visualCirc > 0 && collisionCirc > 0 ? collisionCirc - visualCirc : Number.POSITIVE_INFINITY;
  }
  for (const sectionValue of sections) {
    const analytic = sectionPerimeter(sectionValue, 1024) * 1000;
    measurementErrorsMm[`analytic:${sectionValue.id}`] = analytic - sectionValue.targetCircumferenceMm;
  }
  measurementErrorsMm.height = (visual.bounds.max[1] - Math.max(0, visual.bounds.min[1])) * 1000 - measurements.heightMm;
  measurementErrorsMm.shoulderWidth = distance(frame.shoulderLeft, frame.shoulderRight) * 1000 - measurements.shoulderWidthMm;
  measurementErrorsMm.armLength = distance(frame.shoulderLeft, frame.wristLeft) * 1000 - measurements.armLengthMm;
  measurementErrorsMm.inseam = frame.crotchY * 1000 - measurements.inseamMm;
  return {
    visual: visualDiagnostics,
    collision: collisionDiagnostics,
    measurementErrorsMm,
    lodSectionDeltaMm,
    maxLodSectionDeltaMm: Math.max(...Object.values(lodSectionDeltaMm).map(Math.abs)),
    landmarkToleranceMm: 5,
    circumferenceToleranceMm: 5,
    lengthToleranceMm: 5,
  };
}

export function inspectHumanBodyMesh(mesh: HumanBodyMesh): HumanBodyMeshDiagnostics {
  return inspectMesh(mesh);
}

function inspectMesh(mesh: HumanBodyMesh): HumanBodyMeshDiagnostics {
  const edgeCounts = new Map<string, number>();
  let degenerateTriangleCount = 0;
  let signedVolumeM3 = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset];
    const b = mesh.indices[offset + 1];
    const c = mesh.indices[offset + 2];
    const pa = typedVertex(mesh.positions, a);
    const pb = typedVertex(mesh.positions, b);
    const pc = typedVertex(mesh.positions, c);
    if (magnitude(cross(sub(pb, pa), sub(pc, pa))) <= 1e-10) degenerateTriangleCount += 1;
    signedVolumeM3 += dot(pa, cross(pb, pc)) / 6;
    for (const [first, second] of [[a, b], [b, c], [c, a]] as const) {
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdgeCount += 1;
    else if (count !== 2) nonManifoldEdgeCount += 1;
  }
  return {
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    finite: [...mesh.positions, ...mesh.normals].every(Number.isFinite),
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount,
    signedVolumeM3,
    normalsConsistent: signedVolumeM3 > 0 && degenerateTriangleCount === 0,
  };
}

export function measureHumanBodyMeshCircumferenceAtY(mesh: HumanBodyMesh, yM: number): number {
  return measureMeshCircumferenceAtY(mesh, yM) * 1000;
}

function measureMeshCircumferenceAtY(mesh: HumanBodyMesh, yM: number): number {
  let length = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const points = [
      typedVertex(mesh.positions, mesh.indices[offset]),
      typedVertex(mesh.positions, mesh.indices[offset + 1]),
      typedVertex(mesh.positions, mesh.indices[offset + 2]),
    ] as const;
    const intersections: HumanBodyVector3[] = [];
    for (const [a, b] of [[points[0], points[1]], [points[1], points[2]], [points[2], points[0]]] as const) {
      const da = a[1] - yM;
      const db = b[1] - yM;
      if (Math.abs(da) <= 1e-9 && Math.abs(db) <= 1e-9) continue;
      if ((da > 0) === (db > 0)) continue;
      const t = clamp(da / (da - db), 0, 1);
      intersections.push([
        lerp(a[0], b[0], t),
        yM,
        lerp(a[2], b[2], t),
      ]);
    }
    const unique = uniquePoints(intersections);
    if (unique.length === 2) length += distance(unique[0], unique[1]);
  }
  return length;
}

function uniquePoints(points: readonly HumanBodyVector3[]): HumanBodyVector3[] {
  const result: HumanBodyVector3[] = [];
  for (const point of points) {
    if (!result.some((candidate) => distance(candidate, point) <= 1e-7)) result.push(point);
  }
  return result;
}

function classifyRegion(
  frame: AnatomyFrame,
  sections: readonly HumanBodyCrossSection[],
  x: number,
  y: number,
  z: number,
): HumanBodyRegionId {
  const side = x < 0 ? "left" : "right";
  if (y >= frame.neckBaseY - 0.025) return "neck";
  if (y >= frame.shoulderY - 0.09 && Math.abs(x) > sections[sections.length - 1].halfWidthM * 0.72) return side === "left" ? "shoulder-left" : "shoulder-right";
  if (distance2D(x, y, frame.wristLeft[0], frame.wristLeft[1]) < 0.075 || distance2D(x, y, frame.wristRight[0], frame.wristRight[1]) < 0.075) return side === "left" ? "wrist-left" : "wrist-right";
  if (y < frame.shoulderY && y > frame.wristLeft[1] - 0.13 && Math.abs(x) > sections[sections.length - 1].halfWidthM * 0.95) {
    const elbowY = side === "left" ? frame.elbowLeft[1] : frame.elbowRight[1];
    return y > elbowY ? (side === "left" ? "upper-arm-left" : "upper-arm-right") : (side === "left" ? "forearm-left" : "forearm-right");
  }
  if (y <= frame.crotchY + 0.06) {
    if (y > frame.kneeY) return side === "left" ? "thigh-left" : "thigh-right";
    if (Math.abs(y - frame.kneeY) < 0.06) return side === "left" ? "knee-left" : "knee-right";
    if (y > frame.ankleY + 0.08) return side === "left" ? "calf-left" : "calf-right";
    return side === "left" ? "ankle-left" : "ankle-right";
  }
  if (Math.abs(y - frame.crotchY) < 0.07) return "crotch";
  if (y <= frame.fullHipY + 0.06) return z < 0 ? (side === "left" ? "glute-left" : "glute-right") : z > 0 ? "pelvis-front" : "pelvis-back";
  if (y <= frame.highHipY + 0.035) return "full-hip";
  if (y <= frame.waistY - 0.02) return "high-hip";
  if (Math.abs(y - frame.waistY) < 0.045) return "waist";
  if (y < frame.underbustY) return "abdomen";
  if (y < frame.bustY - 0.035) return "underbust";
  if (y <= frame.bustY + 0.055 && z >= 0) return side === "left" ? "bust-left" : "bust-right";
  return z >= 0 ? "chest-front" : "back-upper";
}

function sweptEllipseField(
  p: HumanBodyVector3,
  start: HumanBodyVector3,
  end: HumanBodyVector3,
  a0: number,
  b0: number,
  a1: number,
  b1: number,
  middleBulge = 0,
  middleAxes?: readonly [number, number],
): number {
  const axis = sub(end, start);
  const axisLength2 = dot(axis, axis);
  const t = axisLength2 <= 1e-12 ? 0 : clamp(dot(sub(p, start), axis) / axisLength2, 0, 1);
  const center = addScaled(start, axis, t);
  let a = lerp(a0, a1, t);
  let b = lerp(b0, b1, t);
  if (middleAxes && middleBulge > 0) {
    const weight = Math.sin(Math.PI * t) ** 2 * middleBulge;
    a = lerp(a, middleAxes[0], weight);
    b = lerp(b, middleAxes[1], weight);
  }
  const direction = normalize(axis);
  let transverse = cross([0, 0, 1], direction);
  if (magnitude(transverse) <= 1e-6) transverse = [1, 0, 0];
  transverse = normalize(transverse);
  const front = normalize(cross(direction, transverse));
  const delta = sub(p, center);
  const u = dot(delta, transverse);
  const v = dot(delta, front);
  const axialOutside = t <= 0 ? Math.max(0, -dot(sub(p, start), direction)) : t >= 1 ? Math.max(0, dot(sub(p, end), direction)) : 0;
  const radial = (Math.hypot(u / Math.max(a, 1e-6), v / Math.max(b, 1e-6)) - 1) * Math.min(a, b);
  return axialOutside > 0 ? Math.hypot(Math.max(radial, 0), axialOutside) : radial;
}

function ellipsoidField(
  x: number,
  y: number,
  z: number,
  center: HumanBodyVector3,
  radii: HumanBodyVector3,
): number {
  const dx = (x - center[0]) / Math.max(radii[0], 1e-6);
  const dy = (y - center[1]) / Math.max(radii[1], 1e-6);
  const dz = (z - center[2]) / Math.max(radii[2], 1e-6);
  return (Math.hypot(dx, dy, dz) - 1) * Math.min(radii[0], radii[1], radii[2]);
}

function smoothMin(a: number, b: number, k: number): number {
  if (k <= 1e-9) return Math.min(a, b);
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

function ellipseAxesForPerimeter(perimeterM: number, ratio: number): readonly [number, number] {
  const a = Math.max(1.001, ratio);
  const b = 1;
  const base = ellipsePerimeter(a, b);
  const scaleValue = perimeterM / Math.max(base, 1e-9);
  return [a * scaleValue, b * scaleValue];
}

function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
}

function sectionById(sections: readonly HumanBodyCrossSection[], id: string): HumanBodyCrossSection {
  const value = sections.find((sectionValue) => sectionValue.id === id);
  if (!value) throw new Error(`HumanBody cross-section ausente: ${id}`);
  return value;
}

function computeBounds(positions: readonly number[]): { min: HumanBodyVector3; max: HumanBodyVector3 } {
  const min: HumanBodyVector3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: HumanBodyVector3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index < positions.length; index += 3) {
    min[0] = Math.min(min[0], positions[index]);
    min[1] = Math.min(min[1], positions[index + 1]);
    min[2] = Math.min(min[2], positions[index + 2]);
    max[0] = Math.max(max[0], positions[index]);
    max[1] = Math.max(max[1], positions[index + 1]);
    max[2] = Math.max(max[2], positions[index + 2]);
  }
  return { min, max };
}

function typedVertex(values: Float32Array, index: number): HumanBodyVector3 {
  return [values[index * 3], values[index * 3 + 1], values[index * 3 + 2]];
}

function arrayVertex(values: readonly number[], index: number): HumanBodyVector3 {
  return [values[index * 3], values[index * 3 + 1], values[index * 3 + 2]];
}

function distance2D(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function addScaled(a: HumanBodyVector3, b: HumanBodyVector3, scaleValue: number): HumanBodyVector3 {
  return [a[0] + b[0] * scaleValue, a[1] + b[1] * scaleValue, a[2] + b[2] * scaleValue];
}

function sub(a: HumanBodyVector3, b: HumanBodyVector3): HumanBodyVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: HumanBodyVector3, value: number): HumanBodyVector3 {
  return [a[0] * value, a[1] * value, a[2] * value];
}

function dot(a: HumanBodyVector3, b: HumanBodyVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: HumanBodyVector3, b: HumanBodyVector3): HumanBodyVector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(a: HumanBodyVector3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: HumanBodyVector3): HumanBodyVector3 {
  const length = magnitude(a);
  return length <= 1e-12 ? [0, 1, 0] : scale(a, 1 / length);
}

function distance(a: HumanBodyVector3, b: HumanBodyVector3): number {
  return magnitude(sub(a, b));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
