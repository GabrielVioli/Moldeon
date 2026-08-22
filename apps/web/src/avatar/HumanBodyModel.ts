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
  centerM?: HumanBodyVector3;
  normal?: HumanBodyVector3;
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
  bounds: { min: HumanBodyVector3; max: HumanBodyVector3 };
}

export interface HumanBodySurfaceRegion {
  id: HumanBodyRegionId;
  visualVertexIndices: Uint32Array;
  collisionVertexIndices: Uint32Array;
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

// Both LODs sample exactly the same anatomy field. The visual grid is dense
// enough to preserve bust/glute silhouettes while the collision grid stays
// substantially cheaper for future triangle fitting.
// Both LODs sample the same Y stations. The calibrated surface and robust
// topology repair let us keep the canonical silhouette while avoiding a >5s
// first-build cost in the compatibility facade.
const DEFAULT_VISUAL_RESOLUTION = [56, 84, 48] as const;
const DEFAULT_COLLISION_RESOLUTION = [48, 84, 40] as const;
const modelCache = new Map<string, HumanBodyModel>();

const TETRAHEDRA: readonly (readonly [number, number, number, number])[] = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];
const CUBE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

export function buildHumanBodyModel(
  input: BodyMeasurements,
  options: HumanBodyBuildOptions = {},
): HumanBodyModel {
  const profile = createMeasurementProfile(input, "feminine");
  const resolved = measurementProfileToBodyMeasurements(profile);
  const measurements = resolveHumanMeasurements(resolved);
  const visualResolution = options.visualResolution ?? DEFAULT_VISUAL_RESOLUTION;
  const collisionResolution = options.collisionResolution ?? DEFAULT_COLLISION_RESOLUTION;
  const cacheKey = JSON.stringify({ measurements, visualResolution, collisionResolution });
  if (!options.disableCache) {
    const cached = modelCache.get(cacheKey);
    if (cached) return cached;
  }

  const frame = buildAnatomyFrame(measurements);
  const torsoSections = buildTorsoCrossSections(measurements, frame);
  const crossSections = [...torsoSections, ...buildLimbCrossSections(measurements, frame)];
  const field = buildAnatomyField(measurements, frame, torsoSections);
  const visualMesh = calibrateCriticalSections(
    polygonizeAnatomy(field, visualResolution),
    torsoSections,
  );
  const collisionMesh = calibrateCriticalSections(
    polygonizeAnatomy(field, collisionResolution),
    torsoSections,
  );
  const joints = buildJoints(frame);
  const landmarks = buildLandmarks(measurements, frame, torsoSections);
  const surfaceRegions = buildSurfaceRegions(visualMesh, collisionMesh);
  const diagnostics = buildDiagnostics(measurements, torsoSections, visualMesh, collisionMesh, frame);

  const model: HumanBodyModel = {
    version: "human-body-female@1",
    sex: "female",
    measurements,
    measurementSources: resolveMeasurementSources(profile.entries),
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
  const underbust = clamp(positive(resolved.highBustMm, bust * 0.93) * 0.94, waist * 1.04, bust * 0.96);
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
): Record<keyof HumanBodyMeasurements, HumanBodyMeasurementSource> {
  const from = (key: keyof BodyMeasurements, fallback: MeasurementOrigin = "derived") => entries[key]?.origin ?? fallback;
  return {
    heightMm: from("heightMm"),
    shoulderWidthMm: from("shoulderWidthMm"),
    neckCircumferenceMm: from("neckCircumferenceMm", "estimated"),
    bustMm: from("bustMm"),
    underbustMm: from("highBustMm", "estimated"),
    waistMm: from("waistMm"),
    highHipMm: "derived",
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
    inseamMm: entries.insideLegLengthMm?.origin ?? from("inseamMm"),
    outseamMm: from("outseamLengthMm", "derived"),
    headCircumferenceMm: from("headCircumferenceMm", "estimated"),
  };
}

function buildAnatomyFrame(m: HumanBodyMeasurements): AnatomyFrame {
  const heightM = m.heightMm * 0.001;
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
  const armLengthM = m.armLengthMm * 0.001;
  const armAngle = 8 * Math.PI / 180;
  const shoulderLeft: HumanBodyVector3 = [-shoulderHalf, shoulderY - 0.008, 0.002];
  const shoulderRight: HumanBodyVector3 = [shoulderHalf, shoulderY - 0.008, 0.002];
  const leftArmAxis = normalize([-Math.sin(armAngle), -Math.cos(armAngle), 0.015]);
  const rightArmAxis = normalize([Math.sin(armAngle), -Math.cos(armAngle), 0.015]);
  const elbowLeft = addScaled(shoulderLeft, leftArmAxis, armLengthM * 0.53);
  const elbowRight = addScaled(shoulderRight, rightArmAxis, armLengthM * 0.53);
  const wristLeft = addScaled(shoulderLeft, leftArmAxis, armLengthM);
  const wristRight = addScaled(shoulderRight, rightArmAxis, armLengthM);

  // Close leg roots create the reference mannequin's natural groin. The
  // central carve below produces the real bifurcation instead of starting two
  // capsule legs outside the pelvis.
  const hipHalf = Math.max(0.052, Math.min(m.fullHipMm * 0.000078, m.shoulderWidthMm * 0.000205));
  const hipLeft: HumanBodyVector3 = [-hipHalf, crotchY + 0.055, -0.010];
  const hipRight: HumanBodyVector3 = [hipHalf, crotchY + 0.055, -0.010];
  const kneeLeft: HumanBodyVector3 = [-hipHalf * 0.78, kneeY, 0.004];
  const kneeRight: HumanBodyVector3 = [hipHalf * 0.78, kneeY, 0.004];
  const ankleLeft: HumanBodyVector3 = [-hipHalf * 0.72, ankleY, 0.010];
  const ankleRight: HumanBodyVector3 = [hipHalf * 0.72, ankleY, 0.010];

  return {
    heightM, ankleY, kneeY, crotchY, fullHipY, highHipY, waistY,
    underbustY, bustY, upperChestY, shoulderY, neckBaseY, headCenterY,
    shoulderLeft, shoulderRight, elbowLeft, elbowRight, wristLeft, wristRight,
    hipLeft, hipRight, kneeLeft, kneeRight, ankleLeft, ankleRight,
  };
}

function buildTorsoCrossSections(m: HumanBodyMeasurements, f: AnatomyFrame): HumanBodyCrossSection[] {
  const shoulderCirc = Math.max(m.underbustMm * 0.98, m.bustMm * 0.88);
  const upperChestCirc = Math.max(m.underbustMm, m.bustMm * 0.91);
  const abdomenCirc = lerp(m.waistMm, m.highHipMm, 0.46);
  const crotchCirc = m.fullHipMm * 0.79;
  // These ratios encode the supplied reference silhouette only. section()
  // rescales every station back to its target perimeter, preserving measures.
  return [
    section("crotch", "crotch", f.crotchY, crotchCirc, 1.42, 1.00, 1.02, 0.002, 0.00, 0.045, 0.27),
    section("full-hip", "full-hip", f.fullHipY, m.fullHipMm, 1.58, 0.88, 1.18, -0.006, 0.035, 0.125, 0.29),
    section("high-hip", "high-hip", f.highHipY, m.highHipMm, 1.51, 0.98, 1.08, 0.002, 0.018, 0.055, 0.27),
    section("abdomen", "abdomen", lerp(f.highHipY, f.waistY, 0.46), abdomenCirc, 1.31, 1.09, 0.97, 0.012, 0, 0, 0.22),
    section("waist", "waist", f.waistY, m.waistMm, 1.31, 1.03, 0.97, 0.004, 0, 0, 0.22),
    section("underbust", "underbust", f.underbustY, m.underbustMm, 1.31, 1.04, 0.96, 0.005, 0.010, 0, 0.22),
    // Spread the measured bust projection through the chest section instead
    // of concentrating it in a high-curvature lobe. This preserves the same
    // authored perimeter while reducing polygonization overshoot.
    section("bust", "chest-front", f.bustY, m.bustMm, 1.27, 0.98, 0.89, 0.006, 0.110, 0, clamp(m.bustPointDistanceMm / m.bustMm, 0.18, 0.29)),
    section("upper-chest", "chest-front", f.upperChestY, upperChestCirc, 1.45, 0.93, 1.04, 0, 0.018, 0, 0.23),
    section("shoulder", "back-upper", f.shoulderY, shoulderCirc, 1.78, 0.84, 1.12, -0.005, 0, 0, 0.22),
  ];
}

function buildLimbCrossSections(m: HumanBodyMeasurements, f: AnatomyFrame): HumanBodyCrossSection[] {
  const make = (
    id: string,
    region: HumanBodyRegionId,
    center: HumanBodyVector3,
    normalValue: HumanBodyVector3,
    circumferenceMm: number,
    ratio: number,
  ): HumanBodyCrossSection => {
    const axes = ellipseAxesForPerimeter(circumferenceMm * 0.001, ratio);
    return {
      id, region, yM: center[1], centerM: [...center], normal: normalize(normalValue),
      targetCircumferenceMm: circumferenceMm,
      halfWidthM: axes[0], frontDepthM: axes[1], backDepthM: axes[1], centerZM: center[2],
      frontLobeM: 0, backLobeM: 0, lobeHalfDistanceM: 0,
    };
  };
  const leftArm = normalize(sub(f.elbowLeft, f.shoulderLeft));
  const rightArm = normalize(sub(f.elbowRight, f.shoulderRight));
  const leftForearm = normalize(sub(f.wristLeft, f.elbowLeft));
  const rightForearm = normalize(sub(f.wristRight, f.elbowRight));
  const leftLeg = normalize(sub(f.kneeLeft, f.hipLeft));
  const rightLeg = normalize(sub(f.kneeRight, f.hipRight));
  const leftCalf = normalize(sub(f.ankleLeft, f.kneeLeft));
  const rightCalf = normalize(sub(f.ankleRight, f.kneeRight));
  return [
    make("upper-arm-left", "upper-arm-left", mixPoint(f.shoulderLeft, f.elbowLeft, 0.30), leftArm, m.bicepMm, 1.08),
    make("upper-arm-right", "upper-arm-right", mixPoint(f.shoulderRight, f.elbowRight, 0.30), rightArm, m.bicepMm, 1.08),
    make("elbow-left", "forearm-left", f.elbowLeft, leftForearm, m.elbowMm, 1.06),
    make("elbow-right", "forearm-right", f.elbowRight, rightForearm, m.elbowMm, 1.06),
    make("wrist-left", "wrist-left", f.wristLeft, leftForearm, m.wristMm, 1.04),
    make("wrist-right", "wrist-right", f.wristRight, rightForearm, m.wristMm, 1.04),
    make("thigh-left", "thigh-left", mixPoint(f.hipLeft, f.kneeLeft, 0.18), leftLeg, m.thighMm, 1.12),
    make("thigh-right", "thigh-right", mixPoint(f.hipRight, f.kneeRight, 0.18), rightLeg, m.thighMm, 1.12),
    make("knee-left", "knee-left", f.kneeLeft, leftCalf, m.kneeMm, 1.06),
    make("knee-right", "knee-right", f.kneeRight, rightCalf, m.kneeMm, 1.06),
    make("calf-left", "calf-left", mixPoint(f.kneeLeft, f.ankleLeft, 0.48), leftCalf, m.calfMm, 1.08),
    make("calf-right", "calf-right", mixPoint(f.kneeRight, f.ankleRight, 0.48), rightCalf, m.calfMm, 1.08),
    make("ankle-left", "ankle-left", f.ankleLeft, leftCalf, m.ankleMm, 1.04),
    make("ankle-right", "ankle-right", f.ankleRight, rightCalf, m.ankleMm, 1.04),
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
  const scaleValue = circumferenceMm * 0.001 / Math.max(sectionPerimeter(base, 720), 1e-9);
  return {
    id, region, yM, targetCircumferenceMm: circumferenceMm,
    halfWidthM: base.halfWidthM * scaleValue,
    frontDepthM: base.frontDepthM * scaleValue,
    backDepthM: base.backDepthM * scaleValue,
    centerZM,
    frontLobeM: base.frontLobeM * scaleValue,
    backLobeM: base.backLobeM * scaleValue,
    lobeHalfDistanceM: base.lobeHalfDistanceM * scaleValue,
  };
}

function sectionPerimeter(
  s: Pick<HumanBodyCrossSection, "halfWidthM" | "frontDepthM" | "backDepthM" | "frontLobeM" | "backLobeM" | "lobeHalfDistanceM">,
  samples: number,
): number {
  let total = 0;
  let previous = sectionPoint(s, 0);
  for (let index = 1; index <= samples; index += 1) {
    const current = sectionPoint(s, index / samples * Math.PI * 2);
    total += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    previous = current;
  }
  return total;
}

function sectionPoint(
  s: Pick<HumanBodyCrossSection, "halfWidthM" | "frontDepthM" | "backDepthM" | "frontLobeM" | "backLobeM" | "lobeHalfDistanceM">,
  angle: number,
): readonly [number, number] {
  const sine = Math.sin(angle);
  const x = s.halfWidthM * Math.cos(angle);
  const baseDepth = sine >= 0 ? s.frontDepthM : s.backDepthM;
  const lobe = sine >= 0 ? s.frontLobeM : s.backLobeM;
  const sigma = Math.max(s.halfWidthM * 0.18, 1e-4);
  const normalized = (Math.abs(x) - s.lobeHalfDistanceM) / sigma;
  const lobeWeight = Math.exp(-(normalized * normalized));
  return [x, baseDepth * sine + Math.sign(sine) * lobe * lobeWeight * Math.pow(Math.abs(sine), 0.72)];
}

function buildAnatomyField(
  m: HumanBodyMeasurements,
  f: AnatomyFrame,
  sections: readonly HumanBodyCrossSection[],
): AnatomyField {
  const headRadius = m.headCircumferenceMm * 0.001 / (2 * Math.PI);
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
  const widest = Math.max(...sections.map((value) => value.halfWidthM));
  const wristX = Math.max(Math.abs(f.wristLeft[0]), Math.abs(f.wristRight[0]));
  const xExtent = Math.max(widest + 0.08, wristX + wristAxes[0] + 0.04, m.shoulderWidthMm * 0.0005 + 0.08);
  const zFront = Math.max(...sections.map((value) => value.centerZM + value.frontDepthM + value.frontLobeM), footLength * 0.82);
  const zBack = Math.max(...sections.map((value) => -value.centerZM + value.backDepthM + value.backLobeM));

  const torsoField = (x: number, y: number, z: number): number => {
    if (y < sections[0].yM - 0.04 || y > sections[sections.length - 1].yM + 0.04) return 1;
    const s = interpolateCrossSection(sections, y);
    const absX = Math.abs(x);
    if (absX > s.halfWidthM) return absX - s.halfWidthM;
    const normalizedX = clamp(absX / Math.max(s.halfWidthM, 1e-6), 0, 1);
    const vertical = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
    const sigma = Math.max(s.halfWidthM * 0.18, 1e-4);
    const lobeX = (absX - s.lobeHalfDistanceM) / sigma;
    const lobeWeight = Math.exp(-(lobeX * lobeX));
    const front = s.centerZM + s.frontDepthM * vertical + s.frontLobeM * lobeWeight * Math.pow(vertical, 0.72);
    const back = s.centerZM - s.backDepthM * vertical - s.backLobeM * lobeWeight * Math.pow(vertical, 0.72);
    if (z > front) return z - front;
    if (z < back) return back - z;
    return -Math.min(front - z, z - back, s.halfWidthM - absX);
  };

  const neckField = (x: number, y: number, z: number) => sweptEllipseField(
    [x, y, z], [0, f.shoulderY - 0.015, -0.004], [0, f.neckBaseY + 0.035, -0.006],
    neckRadius * 1.12, neckRadius * 0.96, neckRadius * 1.02, neckRadius * 0.92,
  );
  const headRY = Math.max(0.06, f.heightM - f.headCenterY);
  const headField = (x: number, y: number, z: number) => ellipsoidField(
    x, y, z, [0, f.headCenterY, -headRadius * 0.05], [headRadius * 0.82, headRY, headRadius * 0.96],
  );

  const armField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const shoulder = side < 0 ? f.shoulderLeft : f.shoulderRight;
    const elbow = side < 0 ? f.elbowLeft : f.elbowRight;
    const wrist = side < 0 ? f.wristLeft : f.wristRight;
    const upper = sweptEllipseField([x, y, z], shoulder, elbow, upperArmAxes[0] * 1.04, upperArmAxes[1] * 1.08, elbowAxes[0], elbowAxes[1]);
    const lower = sweptEllipseField([x, y, z], elbow, wrist, elbowAxes[0], elbowAxes[1], wristAxes[0], wristAxes[1]);
    const deltoid = ellipsoidField(
      x, y, z,
      [shoulder[0] * 0.965, shoulder[1] - 0.025, shoulder[2] - 0.004],
      [upperArmAxes[0] * 1.35, upperArmAxes[0] * 1.22, upperArmAxes[1] * 1.18],
    );
    const hand = ellipsoidField(
      x, y, z,
      [wrist[0] + side * wristAxes[0] * 0.08, wrist[1] - handLength * 0.43, wrist[2] + handLength * 0.04],
      [wristAxes[0] * 1.15, handLength * 0.46, wristAxes[1] * 0.78],
    );
    return smoothMin(smoothMin(smoothMin(upper, lower, 0.012), deltoid, 0.020), hand, 0.008);
  };

  const legField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const hip = side < 0 ? f.hipLeft : f.hipRight;
    const knee = side < 0 ? f.kneeLeft : f.kneeRight;
    const ankle = side < 0 ? f.ankleLeft : f.ankleRight;
    const upper = sweptEllipseField(
      [x, y, z], hip, knee,
      thighAxes[0] * 0.94, thighAxes[1] * 0.96, kneeAxes[0], kneeAxes[1], 0.88, thighAxes,
    );
    const lower = sweptEllipseField(
      [x, y, z], knee, ankle,
      kneeAxes[0], kneeAxes[1], ankleAxes[0], ankleAxes[1], 0.72, calfAxes,
    );
    const footRY = Math.max(0.025, f.ankleY * 0.50);
    const foot = ellipsoidField(x, y, z, [ankle[0], footRY, footLength * 0.34], [ankleAxes[0] * 1.02, footRY, footLength * 0.55]);
    return smoothMin(smoothMin(upper, lower, 0.014), foot, 0.010);
  };

  const sample = (x: number, y: number, z: number): number => {
    let body = torsoField(x, y, z);
    body = smoothMin(body, neckField(x, y, z), 0.024);
    body = smoothMin(body, headField(x, y, z), 0.012);
    body = smoothMin(body, armField(-1, x, y, z), 0.032);
    body = smoothMin(body, armField(1, x, y, z), 0.032);
    body = smoothMin(body, legField(-1, x, y, z), 0.020);
    body = smoothMin(body, legField(1, x, y, z), 0.020);

    // Subtractive crotch volume creates the actual leg bifurcation while
    // retaining one continuous watertight body above the groin.
    const separator = ellipsoidField(
      x, y, z, [0, f.crotchY - 0.062, 0.016],
      // The cutter must traverse the complete front/back depth of the upper
    // legs. A shallow closed ellipsoid only created an internal dimple and left
    // centerline surface vertices. This depth opens the bifurcation to outside.
      [Math.max(0.018, Math.abs(f.hipRight[0]) * 0.38), 0.180, Math.max(0.180, m.crotchDepthMm * 0.00082)],
    );
    if (y <= f.crotchY + 0.018) body = Math.max(body, -separator);
    return body;
  };

  return {
    sample,
    regionAt: (x, y, z) => classifyRegion(f, sections, x, y, z),
    bounds: {
// Keep the complete closed iso-surface strictly inside the lattice.
      // In particular the head/feet must never intersect the sampling box.
      min: [-xExtent, -0.03, -zBack - 0.055],
      max: [xExtent, f.heightM + 0.03, zFront + 0.055],
    },
  };
}

function interpolateCrossSection(sections: readonly HumanBodyCrossSection[], y: number): HumanBodyCrossSection {
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

function polygonizeAnatomy(field: AnatomyField, requested: readonly [number, number, number]): HumanBodyMesh {
  const nx = clampInt(requested[0], 18, 72);
  const ny = clampInt(requested[1], 32, 128);
  const nz = clampInt(requested[2], 16, 72);
  const { min, max } = field.bounds;
  const sx = (max[0] - min[0]) / nx;
  const sy = (max[1] - min[1]) / ny;
  const sz = (max[2] - min[2]) / nz;
  const gx = nx + 1;
  const gy = ny + 1;
  const gz = nz + 1;
  const latticeId = (ix: number, iy: number, iz: number) => (iz * gy + iy) * gx + ix;
  const values = new Float32Array(gx * gy * gz);
  for (let iz = 0; iz < gz; iz += 1) {
    for (let iy = 0; iy < gy; iy += 1) {
      for (let ix = 0; ix < gx; ix += 1) {
        const id = latticeId(ix, iy, iz);
        const sampled = field.sample(min[0] + ix * sx, min[1] + iy * sy, min[2] + iz * sz);
        values[id] = Math.abs(sampled) <= 1e-10 ? 1e-10 : sampled;
      }
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const regionIds: HumanBodyRegionId[] = [];
  const cache = new Map<string, number>();
  const lattice = (ix: number, iy: number, iz: number): LatticeVertex => {
    const id = latticeId(ix, iy, iz);
    return { x: min[0] + ix * sx, y: min[1] + iy * sy, z: min[2] + iz * sz, value: values[id], id };
  };
  const edgeVertex = (a: LatticeVertex, b: LatticeVertex): number => {
    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    const denominator = a.value - b.value;
    const t = Math.abs(denominator) <= 1e-12 ? 0.5 : clamp(a.value / denominator, 0, 1);
    const point: HumanBodyVector3 = [lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)];
    const index = positions.length / 3;
    positions.push(...point);
    regionIds.push(field.regionAt(...point));
    cache.set(key, index);
    return index;
  };
  const emit = (a: number, b: number, c: number) => {
    if (a === b || b === c || c === a) return;
    const pa = arrayVertex(positions, a);
    const pb = arrayVertex(positions, b);
    const pc = arrayVertex(positions, c);
    const n = cross(sub(pb, pa), sub(pc, pa));
    const length = magnitude(n);
    if (length <= 1e-10) return;
    const center: HumanBodyVector3 = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const unit = scale(n, 1 / length);
    const epsilon = Math.min(sx, sy, sz) * 0.15;
    const outside = field.sample(center[0] + unit[0] * epsilon, center[1] + unit[1] * epsilon, center[2] + unit[2] * epsilon);
    const inside = field.sample(center[0] - unit[0] * epsilon, center[1] - unit[1] * epsilon, center[2] - unit[2] * epsilon);
    if (outside >= inside) indices.push(a, b, c);
    else indices.push(a, c, b);
  };

  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        const cube = CUBE_OFFSETS.map(([ox, oy, oz]) => lattice(ix + ox, iy + oy, iz + oz));
        for (const tetra of TETRAHEDRA) {
          polygonizeTetra(tetra.map((index) => cube[index]) as [LatticeVertex, LatticeVertex, LatticeVertex, LatticeVertex], edgeVertex, emit);
        }
      }
    }
  }

  const welded = weldPolygonizedSurface(positions, indices, regionIds);
  const closed = triangulateBoundaryLoops(welded.positions, welded.indices, welded.regionIds);
  if (signedVolume(closed.positions, closed.indices) < 0) {
    for (let offset = 0; offset < closed.indices.length; offset += 3) {
      const swap = closed.indices[offset + 1];
      closed.indices[offset + 1] = closed.indices[offset + 2];
      closed.indices[offset + 2] = swap;
    }
  }
  return {
    positions: Float32Array.from(closed.positions),
    normals: buildVertexNormals(closed.positions, closed.indices),
    indices: Uint32Array.from(closed.indices),
    regionIds: closed.regionIds,
    bounds: computeBounds(closed.positions),
  };
}

/**
 * Marching tetrahedra can emit the same zero-isosurface lattice vertex through
 * different lattice edges when the field evaluates to exactly zero. Welding
 * only numerically coincident vertices closes those topological cracks without
 * changing the body surface or its measurements.
 */
function weldPolygonizedSurface(
  positions: readonly number[],
  indices: readonly number[],
  regionIds: readonly HumanBodyRegionId[],
): { positions: number[]; indices: number[]; regionIds: HumanBodyRegionId[] } {
  // 0.02 mm is far below fitting tolerances. Adjacent-cell lookup avoids the
  // quantization-boundary crack that the previous scalar rounding produced.
  const toleranceM = 0.00002;
  const tolerance2 = toleranceM * toleranceM;
  const cellSize = toleranceM;
  const weldedPositions: number[] = [];
  const weldedRegions: HumanBodyRegionId[] = [];
  const remap = new Uint32Array(positions.length / 3);
  const grid = new Map<string, number[]>();
  const cell = (value: number) => Math.floor(value / cellSize);
  const key = (ix: number, iy: number, iz: number) => `${ix}:${iy}:${iz}`;

  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const ix = cell(x);
    const iy = cell(y);
    const iz = cell(z);
    let target = -1;
    let bestDistance2 = Number.POSITIVE_INFINITY;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (const candidate of grid.get(key(ix + dx, iy + dy, iz + dz)) ?? []) {
            const cx = weldedPositions[candidate * 3];
            const cy = weldedPositions[candidate * 3 + 1];
            const cz = weldedPositions[candidate * 3 + 2];
            const distance2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
            if (distance2 <= tolerance2 && distance2 < bestDistance2) {
              target = candidate;
              bestDistance2 = distance2;
            }
          }
        }
      }
    }
    if (target < 0) {
      target = weldedPositions.length / 3;
      weldedPositions.push(x, y, z);
      weldedRegions.push(regionIds[vertex]);
      const bucketKey = key(ix, iy, iz);
      const bucket = grid.get(bucketKey) ?? [];
      bucket.push(target);
      grid.set(bucketKey, bucket);
    }
    remap[vertex] = target;
  }

  const weldedIndices: number[] = [];
  const triangles = new Set<string>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = remap[indices[offset]];
    const b = remap[indices[offset + 1]];
    const c = remap[indices[offset + 2]];
    if (a === b || b === c || c === a) continue;
    const pa = arrayVertex(weldedPositions, a);
    const pb = arrayVertex(weldedPositions, b);
    const pc = arrayVertex(weldedPositions, c);
    if (magnitude(cross(sub(pb, pa), sub(pc, pa))) <= 1e-10) continue;
    const canonical = [a, b, c].sort((first, second) => first - second).join(":");
    if (triangles.has(canonical)) continue;
    triangles.add(canonical);
    weldedIndices.push(a, b, c);
  }
  return { positions: weldedPositions, indices: weldedIndices, regionIds: weldedRegions };
}

function triangulateBoundaryLoops(
  sourcePositions: readonly number[],
  sourceIndices: readonly number[],
  sourceRegions: readonly HumanBodyRegionId[],
): { positions: number[]; indices: number[]; regionIds: HumanBodyRegionId[] } {
  const positions = [...sourcePositions];
  const indices = [...sourceIndices];
  const regionIds = [...sourceRegions];
  const edgeRecords = new Map<string, { a: number; b: number; count: number; from: number; to: number }>();
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const tri = [indices[offset], indices[offset + 1], indices[offset + 2]] as const;
    for (const [from, to] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = edgeKey(from, to);
      const current = edgeRecords.get(key);
      if (current) current.count += 1;
      else edgeRecords.set(key, { a: Math.min(from, to), b: Math.max(from, to), count: 1, from, to });
    }
  }
  const boundary = [...edgeRecords.values()].filter((edge) => edge.count === 1);
  if (boundary.length === 0) return { positions, indices, regionIds };

  const outgoing = new Map<number, number[]>();
  const undirected = new Map<number, number[]>();
  for (const edge of boundary) {
    const out = outgoing.get(edge.from) ?? [];
    out.push(edge.to);
    outgoing.set(edge.from, out);
    for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      const list = undirected.get(a) ?? [];
      list.push(b);
      undirected.set(a, list);
    }
  }

  const unused = new Set(boundary.map((edge) => edgeKey(edge.a, edge.b)));
  const triangleKeys = new Set<string>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    triangleKeys.add([indices[offset], indices[offset + 1], indices[offset + 2]].sort((a, b) => a - b).join(":"));
  }

  while (unused.size > 0) {
    const seedKey = unused.values().next().value as string;
    const seed = edgeRecords.get(seedKey);
    if (!seed) {
      unused.delete(seedKey);
      continue;
    }
    const loop = [seed.from, seed.to];
    unused.delete(seedKey);
    let previous = seed.from;
    let current = seed.to;
    let closed = false;
    for (let guard = 0; guard <= boundary.length + 2; guard += 1) {
      if (current === loop[0]) {
        loop.pop();
        closed = true;
        break;
      }
      const directedNext = (outgoing.get(current) ?? []).find((candidate) =>
        candidate !== previous && unused.has(edgeKey(current, candidate))
      );
      const fallbackNext = (undirected.get(current) ?? []).find((candidate) =>
        candidate !== previous && unused.has(edgeKey(current, candidate))
      );
      const next = directedNext ?? fallbackNext;
      if (next === undefined) {
        if ((undirected.get(current) ?? []).includes(loop[0])) closed = true;
        break;
      }
      unused.delete(edgeKey(current, next));
      if (next === loop[0]) {
        closed = true;
        break;
      }
      loop.push(next);
      previous = current;
      current = next;
    }
    if (!closed || loop.length < 3) continue;

    // Existing surface triangles traverse the hole boundary in one direction.
    // New faces use the opposite winding. No centroid vertex is introduced, so
    // a tiny numerical loop cannot generate zero-area fan triangles.
    for (let index = 1; index < loop.length - 1; index += 1) {
      const a = loop[0];
      const b = loop[index + 1];
      const c = loop[index];
      if (a === b || b === c || c === a) continue;
      const pa = arrayVertex(positions, a);
      const pb = arrayVertex(positions, b);
      const pc = arrayVertex(positions, c);
      if (magnitude(cross(sub(pb, pa), sub(pc, pa))) <= 1e-10) continue;
      const canonical = [a, b, c].sort((first, second) => first - second).join(":");
      if (triangleKeys.has(canonical)) continue;
      triangleKeys.add(canonical);
      indices.push(a, b, c);
    }
  }
  return { positions, indices, regionIds };
}

function polygonizeTetra(
  tetra: readonly [LatticeVertex, LatticeVertex, LatticeVertex, LatticeVertex],
  edge: (a: LatticeVertex, b: LatticeVertex) => number,
  emit: (a: number, b: number, c: number) => void,
): void {
  const inside = tetra.filter((value) => value.value <= 0);
  const outside = tetra.filter((value) => value.value > 0);
  if (inside.length === 0 || inside.length === 4) return;
  if (inside.length === 1) {
    emit(edge(inside[0], outside[0]), edge(inside[0], outside[1]), edge(inside[0], outside[2]));
    return;
  }
  if (inside.length === 3) {
    emit(edge(outside[0], inside[0]), edge(outside[0], inside[2]), edge(outside[0], inside[1]));
    return;
  }
  const ac = edge(inside[0], outside[0]);
  const ad = edge(inside[0], outside[1]);
  const bc = edge(inside[1], outside[0]);
  const bd = edge(inside[1], outside[1]);
  emit(ac, ad, bc);
  emit(ad, bd, bc);
}


function calibrateCriticalSections(
  mesh: HumanBodyMesh,
  sections: readonly HumanBodyCrossSection[],
): HumanBodyMesh {
  const positions = new Float32Array(mesh.positions);
  const critical = ["bust", "waist", "full-hip"] as const;
  for (const id of critical) {
    const sectionValue = sectionById(sections, id);
    const currentMm = measureMeshCircumferenceAtY({ ...mesh, positions }, sectionValue.yM) * 1000;
    if (!Number.isFinite(currentMm) || currentMm <= 1e-6) continue;
    const factor = sectionValue.targetCircumferenceMm / currentMm;
    const plateauM = 0.012;
    const influenceM = id === "waist" ? 0.042 : 0.036;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const y = positions[vertex * 3 + 1];
      const distanceY = Math.abs(y - sectionValue.yM);
      if (distanceY >= influenceM) continue;
      const weight = distanceY <= plateauM
        ? 1
        : smoothstep(1 - (distanceY - plateauM) / (influenceM - plateauM));
      const localScale = 1 + (factor - 1) * weight;
      positions[vertex * 3] *= localScale;
      positions[vertex * 3 + 2] = sectionValue.centerZM
        + (positions[vertex * 3 + 2] - sectionValue.centerZM) * localScale;
    }
  }
  const positionsArray = Array.from(positions);
  const indicesArray = Array.from(mesh.indices);
  return {
    ...mesh,
    positions,
    normals: buildVertexNormals(positionsArray, indicesArray),
    bounds: computeBounds(positionsArray),
  };
}

function buildVertexNormals(positions: readonly number[], indices: readonly number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    const n = cross(sub(arrayVertex(positions, b), arrayVertex(positions, a)), sub(arrayVertex(positions, c), arrayVertex(positions, a)));
    for (const index of [a, b, c]) {
      normals[index * 3] += n[0];
      normals[index * 3 + 1] += n[1];
      normals[index * 3 + 2] += n[2];
    }
  }
  for (let index = 0; index < normals.length / 3; index += 1) {
    const n = normalize([normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]]);
    normals[index * 3] = n[0];
    normals[index * 3 + 1] = n[1];
    normals[index * 3 + 2] = n[2];
  }
  return normals;
}

function buildJoints(f: AnatomyFrame): Record<string, HumanBodyJoint> {
  const pairs: Array<[string, HumanBodyVector3]> = [
    ["shoulder-left", f.shoulderLeft], ["shoulder-right", f.shoulderRight],
    ["elbow-left", f.elbowLeft], ["elbow-right", f.elbowRight],
    ["wrist-left", f.wristLeft], ["wrist-right", f.wristRight],
    ["hip-left", f.hipLeft], ["hip-right", f.hipRight],
    ["knee-left", f.kneeLeft], ["knee-right", f.kneeRight],
    ["ankle-left", f.ankleLeft], ["ankle-right", f.ankleRight],
  ];
  return Object.fromEntries(pairs.map(([id, position]) => [id, { id, position: [...position] as HumanBodyVector3 }])) as Record<string, HumanBodyJoint>;
}

function buildLandmarks(
  m: HumanBodyMeasurements,
  f: AnatomyFrame,
  sections: readonly HumanBodyCrossSection[],
): Record<HumanBodyLandmarkId, HumanBodyLandmark> {
  const waist = sectionById(sections, "waist");
  const highHip = sectionById(sections, "high-hip");
  const hip = sectionById(sections, "full-hip");
  const bust = sectionById(sections, "bust");
  const crotch = sectionById(sections, "crotch");
  const bustX = Math.min(bust.halfWidthM * 0.58, m.bustPointDistanceMm * 0.0005);
  const lm = (id: HumanBodyLandmarkId, position: HumanBodyVector3, normalValue: HumanBodyVector3): HumanBodyLandmark => ({ id, position, normal: normalize(normalValue) });
  return {
    "ground-center": lm("ground-center", [0, 0, 0], [0, 1, 0]),
    "head-top": lm("head-top", [0, f.heightM, -0.004], [0, 1, 0]),
    "neck-base-center": lm("neck-base-center", [0, f.neckBaseY, -0.004], [0, 0, 1]),
    "shoulder-left": lm("shoulder-left", f.shoulderLeft, [-1, 0.25, 0]),
    "shoulder-right": lm("shoulder-right", f.shoulderRight, [1, 0.25, 0]),
    "bust-apex-left": lm("bust-apex-left", [-bustX, f.bustY, bust.centerZM + bust.frontDepthM + bust.frontLobeM], [0, 0, 1]),
    "bust-apex-right": lm("bust-apex-right", [bustX, f.bustY, bust.centerZM + bust.frontDepthM + bust.frontLobeM], [0, 0, 1]),
    "center-front-waist": lm("center-front-waist", [0, f.waistY, waist.centerZM + waist.frontDepthM], [0, 0, 1]),
    "center-back-waist": lm("center-back-waist", [0, f.waistY, waist.centerZM - waist.backDepthM], [0, 0, -1]),
    "side-waist-left": lm("side-waist-left", [-waist.halfWidthM, f.waistY, waist.centerZM], [-1, 0, 0]),
    "side-waist-right": lm("side-waist-right", [waist.halfWidthM, f.waistY, waist.centerZM], [1, 0, 0]),
    "high-hip-front": lm("high-hip-front", [0, f.highHipY, highHip.centerZM + highHip.frontDepthM], [0, 0, 1]),
    "high-hip-back": lm("high-hip-back", [0, f.highHipY, highHip.centerZM - highHip.backDepthM - highHip.backLobeM], [0, 0, -1]),
    "full-hip-front": lm("full-hip-front", [0, f.fullHipY, hip.centerZM + hip.frontDepthM], [0, 0, 1]),
    "full-hip-back": lm("full-hip-back", [0, f.fullHipY, hip.centerZM - hip.backDepthM - hip.backLobeM], [0, 0, -1]),
    "crotch-front": lm("crotch-front", [0, f.crotchY, crotch.centerZM + crotch.frontDepthM * 0.78], [0, 0, 1]),
    "crotch-back": lm("crotch-back", [0, f.crotchY, crotch.centerZM - crotch.backDepthM * 0.88], [0, 0, -1]),
    "inseam-top-left": lm("inseam-top-left", [f.hipLeft[0] * 0.36, f.crotchY - 0.012, 0.012], [1, 0, 0]),
    "inseam-top-right": lm("inseam-top-right", [f.hipRight[0] * 0.36, f.crotchY - 0.012, 0.012], [-1, 0, 0]),
    "thigh-widest-left": lm("thigh-widest-left", mixPoint(f.hipLeft, f.kneeLeft, 0.18), [-1, 0, 0]),
    "thigh-widest-right": lm("thigh-widest-right", mixPoint(f.hipRight, f.kneeRight, 0.18), [1, 0, 0]),
    "knee-left": lm("knee-left", f.kneeLeft, [-1, 0, 0]),
    "knee-right": lm("knee-right", f.kneeRight, [1, 0, 0]),
    "ankle-left": lm("ankle-left", f.ankleLeft, [-1, 0, 0]),
    "ankle-right": lm("ankle-right", f.ankleRight, [1, 0, 0]),
    "armhole-left": lm("armhole-left", [f.shoulderLeft[0] * 0.82, f.shoulderY - 0.075, 0.015], [-1, 0, 0.2]),
    "armhole-right": lm("armhole-right", [f.shoulderRight[0] * 0.82, f.shoulderY - 0.075, 0.015], [1, 0, 0.2]),
    "elbow-left": lm("elbow-left", f.elbowLeft, [-1, 0, 0]),
    "elbow-right": lm("elbow-right", f.elbowRight, [1, 0, 0]),
    "wrist-left": lm("wrist-left", f.wristLeft, [-1, 0, 0]),
    "wrist-right": lm("wrist-right", f.wristRight, [1, 0, 0]),
  };
}

function buildSurfaceRegions(visual: HumanBodyMesh, collision: HumanBodyMesh): HumanBodySurfaceRegion[] {
  const ids = [...new Set([...visual.regionIds, ...collision.regionIds])].sort() as HumanBodyRegionId[];
  return ids.map((id) => ({
    id,
    visualVertexIndices: Uint32Array.from(visual.regionIds.flatMap((value, index) => value === id ? [index] : [])),
    collisionVertexIndices: Uint32Array.from(collision.regionIds.flatMap((value, index) => value === id ? [index] : [])),
  }));
}

function buildDiagnostics(
  m: HumanBodyMeasurements,
  sections: readonly HumanBodyCrossSection[],
  visual: HumanBodyMesh,
  collision: HumanBodyMesh,
  f: AnatomyFrame,
): HumanBodyDiagnostics {
  const measurementErrorsMm: Record<string, number> = {};
  const lodSectionDeltaMm: Record<string, number> = {};
  for (const [id, y, target] of [
    ["bust", f.bustY, m.bustMm], ["waist", f.waistY, m.waistMm], ["hip", f.fullHipY, m.fullHipMm],
  ] as const) {
    const visualCirc = measureMeshCircumferenceAtY(visual, y) * 1000;
    const collisionCirc = measureMeshCircumferenceAtY(collision, y) * 1000;
    measurementErrorsMm[id] = visualCirc > 0 ? visualCirc - target : Number.POSITIVE_INFINITY;
    lodSectionDeltaMm[id] = visualCirc > 0 && collisionCirc > 0 ? collisionCirc - visualCirc : Number.POSITIVE_INFINITY;
  }
  for (const value of sections) {
    measurementErrorsMm[`analytic:${value.id}`] = sectionPerimeter(value, 1200) * 1000 - value.targetCircumferenceMm;
  }
  measurementErrorsMm.height = visual.bounds.max[1] * 1000 - m.heightMm;
  measurementErrorsMm.shoulderWidth = distance(f.shoulderLeft, f.shoulderRight) * 1000 - m.shoulderWidthMm;
  measurementErrorsMm.armLength = distance(f.shoulderLeft, f.wristLeft) * 1000 - m.armLengthMm;
  measurementErrorsMm.inseam = f.crotchY * 1000 - m.inseamMm;
  return {
    visual: inspectMesh(visual),
    collision: inspectMesh(collision),
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
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset];
    const b = mesh.indices[offset + 1];
    const c = mesh.indices[offset + 2];
    if (magnitude(cross(sub(typedVertex(mesh.positions, b), typedVertex(mesh.positions, a)), sub(typedVertex(mesh.positions, c), typedVertex(mesh.positions, a)))) <= 1e-10) {
      degenerateTriangleCount += 1;
    }
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
  const volume = signedVolume([...mesh.positions], [...mesh.indices]);
  return {
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    finite: mesh.positions.every(Number.isFinite) && mesh.normals.every(Number.isFinite),
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount,
    signedVolumeM3: volume,
    normalsConsistent: volume > 0 && degenerateTriangleCount === 0,
  };
}

export function measureHumanBodyMeshCircumferenceAtY(mesh: HumanBodyMesh, yM: number): number {
  return measureMeshCircumferenceAtY(mesh, yM) * 1000;
}

/** Returns the longest closed intersection loop, excluding arm loops. */
function measureMeshCircumferenceAtY(mesh: HumanBodyMesh, yM: number): number {
  const segments: Array<readonly [HumanBodyVector3, HumanBodyVector3]> = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = [
      typedVertex(mesh.positions, mesh.indices[offset]),
      typedVertex(mesh.positions, mesh.indices[offset + 1]),
      typedVertex(mesh.positions, mesh.indices[offset + 2]),
    ] as const;
    const hits: HumanBodyVector3[] = [];
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as const) {
      const da = a[1] - yM;
      const db = b[1] - yM;
      if (Math.abs(da) <= 1e-9 && Math.abs(db) <= 1e-9) continue;
      if ((da > 0) === (db > 0)) continue;
      const t = clamp(da / (da - db), 0, 1);
      hits.push([lerp(a[0], b[0], t), yM, lerp(a[2], b[2], t)]);
    }
    const unique = uniquePoints(hits);
    if (unique.length === 2) segments.push([unique[0], unique[1]]);
  }
  if (segments.length === 0) return 0;

  const key = (p: HumanBodyVector3) => `${Math.round(p[0] * 1e6)}:${Math.round(p[2] * 1e6)}`;
  const adjacency = new Map<string, Array<{ segment: number; point: HumanBodyVector3 }>>();
  for (let index = 0; index < segments.length; index += 1) {
    const [a, b] = segments[index];
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const k = key(from);
      const values = adjacency.get(k) ?? [];
      values.push({ segment: index, point: to });
      adjacency.set(k, values);
    }
  }
  const visited = new Set<number>();
  let maximum = 0;
  for (let start = 0; start < segments.length; start += 1) {
    if (visited.has(start)) continue;
    let length = 0;
    const stack = [start];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const [a, b] = segments[current];
      length += distance(a, b);
      for (const endpoint of [a, b]) {
        for (const next of adjacency.get(key(endpoint)) ?? []) {
          if (!visited.has(next.segment)) stack.push(next.segment);
        }
      }
    }
    maximum = Math.max(maximum, length);
  }
  return maximum;
}

function uniquePoints(points: readonly HumanBodyVector3[]): HumanBodyVector3[] {
  const result: HumanBodyVector3[] = [];
  for (const point of points) if (!result.some((other) => distance(other, point) <= 1e-7)) result.push(point);
  return result;
}

function classifyRegion(f: AnatomyFrame, sections: readonly HumanBodyCrossSection[], x: number, y: number, z: number): HumanBodyRegionId {
  const side = x < 0 ? "left" : "right";
  const shoulderWidth = sections[sections.length - 1].halfWidthM;
  if (y >= f.neckBaseY - 0.025) return "neck";
  if (y >= f.shoulderY - 0.09 && Math.abs(x) > shoulderWidth * 0.72) return side === "left" ? "shoulder-left" : "shoulder-right";
  if (distance2D(x, y, f.wristLeft[0], f.wristLeft[1]) < 0.075 || distance2D(x, y, f.wristRight[0], f.wristRight[1]) < 0.075) return side === "left" ? "wrist-left" : "wrist-right";
  if (y < f.shoulderY && y > f.wristLeft[1] - 0.13 && Math.abs(x) > shoulderWidth * 0.95) {
    const elbowY = side === "left" ? f.elbowLeft[1] : f.elbowRight[1];
    return y > elbowY ? (side === "left" ? "upper-arm-left" : "upper-arm-right") : (side === "left" ? "forearm-left" : "forearm-right");
  }
  if (Math.abs(x) < Math.abs(f.hipRight[0]) * 0.72 && Math.abs(y - f.crotchY) < 0.055) return "crotch";
  if (y <= f.crotchY + 0.06) {
    if (y > f.kneeY + 0.06) return side === "left" ? "thigh-left" : "thigh-right";
    if (Math.abs(y - f.kneeY) <= 0.06) return side === "left" ? "knee-left" : "knee-right";
    if (y > f.ankleY + 0.08) return side === "left" ? "calf-left" : "calf-right";
    return side === "left" ? "ankle-left" : "ankle-right";
  }
  if (y <= f.fullHipY + 0.06) {
    if (z < 0 && Math.abs(x) > Math.abs(f.hipRight[0]) * 0.55) return side === "left" ? "glute-left" : "glute-right";
    return z < 0 ? "pelvis-back" : "pelvis-front";
  }
  if (y <= f.highHipY + 0.035) return "full-hip";
  if (y <= f.waistY - 0.02) return "high-hip";
  if (Math.abs(y - f.waistY) < 0.045) return "waist";
  if (y < f.underbustY) return "abdomen";
  if (y < f.bustY - 0.035) return "underbust";
  if (y <= f.bustY + 0.055 && z >= 0) return side === "left" ? "bust-left" : "bust-right";
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
  const length2 = dot(axis, axis);
  const t = length2 <= 1e-12 ? 0 : clamp(dot(sub(p, start), axis) / length2, 0, 1);
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
  const before = -dot(sub(p, start), direction);
  const after = dot(sub(p, end), direction);
  const axialOutside = t <= 0 ? Math.max(0, before) : t >= 1 ? Math.max(0, after) : 0;
  const radial = (Math.hypot(u / Math.max(a, 1e-6), v / Math.max(b, 1e-6)) - 1) * Math.min(a, b);
  return axialOutside > 0 ? Math.hypot(Math.max(radial, 0), axialOutside) : radial;
}

function ellipsoidField(x: number, y: number, z: number, center: HumanBodyVector3, radii: HumanBodyVector3): number {
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
  const base = ellipsePerimeter(a, 1);
  const scaleValue = perimeterM / Math.max(base, 1e-9);
  return [a * scaleValue, scaleValue];
}

function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)));
}

function sectionById(sections: readonly HumanBodyCrossSection[], id: string): HumanBodyCrossSection {
  const value = sections.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`HumanBody cross-section ausente: ${id}`);
  return value;
}

function computeBounds(positions: readonly number[]): { min: HumanBodyVector3; max: HumanBodyVector3 } {
  const min: HumanBodyVector3 = [Infinity, Infinity, Infinity];
  const max: HumanBodyVector3 = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    min[0] = Math.min(min[0], positions[index]); min[1] = Math.min(min[1], positions[index + 1]); min[2] = Math.min(min[2], positions[index + 2]);
    max[0] = Math.max(max[0], positions[index]); max[1] = Math.max(max[1], positions[index + 1]); max[2] = Math.max(max[2], positions[index + 2]);
  }
  return { min, max };
}

function signedVolume(positions: readonly number[], indices: readonly number[]): number {
  let volume = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = arrayVertex(positions, indices[offset]);
    const b = arrayVertex(positions, indices[offset + 1]);
    const c = arrayVertex(positions, indices[offset + 2]);
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}

function typedVertex(values: Float32Array, index: number): HumanBodyVector3 {
  return [values[index * 3], values[index * 3 + 1], values[index * 3 + 2]];
}
function arrayVertex(values: readonly number[], index: number): HumanBodyVector3 {
  return [values[index * 3], values[index * 3 + 1], values[index * 3 + 2]];
}
function mixPoint(a: HumanBodyVector3, b: HumanBodyVector3, t: number): HumanBodyVector3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function addScaled(a: HumanBodyVector3, b: HumanBodyVector3, value: number): HumanBodyVector3 {
  return [a[0] + b[0] * value, a[1] + b[1] * value, a[2] + b[2] * value];
}
function sub(a: HumanBodyVector3, b: HumanBodyVector3): HumanBodyVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: HumanBodyVector3, value: number): HumanBodyVector3 { return [a[0] * value, a[1] * value, a[2] * value]; }
function dot(a: HumanBodyVector3, b: HumanBodyVector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: HumanBodyVector3, b: HumanBodyVector3): HumanBodyVector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function magnitude(a: HumanBodyVector3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: HumanBodyVector3): HumanBodyVector3 { const length = magnitude(a); return length <= 1e-12 ? [0, 1, 0] : scale(a, 1 / length); }
function distance(a: HumanBodyVector3, b: HumanBodyVector3): number { return magnitude(sub(a, b)); }
function distance2D(ax: number, ay: number, bx: number, by: number): number { return Math.hypot(ax - bx, ay - by); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function clampInt(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, Math.round(value))); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }
function positive(value: number | undefined, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback; }
