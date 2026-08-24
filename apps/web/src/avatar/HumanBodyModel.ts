import type { BodyMeasurements } from "../domain/pattern";
import {
  createMeasurementProfile,
  measurementProfileToBodyMeasurements,
  type MeasurementProfile,
  type MeasurementOrigin,
} from "../domain/parametricMeasurements";
import {
  canonicalFemaleMesh,
  type CanonicalFemaleAssetAudit,
} from "./CanonicalFemaleMesh";

export type HumanBodyVector3 = [number, number, number];
export type HumanBodyMeasurementSource = MeasurementOrigin;

export type HumanBodyRegionId =
  | "neck"
  | "shoulder-left"
  | "shoulder-right"
  | "bust-left"
  | "bust-right"
  | "underbust"
  | "ribcage"
  | "chest-front"
  | "back-upper"
  | "waist"
  | "abdomen"
  | "high-hip"
  | "full-hip"
  | "pelvis"
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
  | "high-hip"
  | "high-hip-front"
  | "high-hip-back"
  | "full-hip"
  | "full-hip-front"
  | "full-hip-back"
  | "glute-left"
  | "glute-right"
  | "crotch-front"
  | "crotch-back"
  | "inseam-top-left"
  | "inseam-top-right"
  | "thigh-widest-left"
  | "thigh-widest-right"
  | "knee-left"
  | "knee-right"
  | "calf-left"
  | "calf-right"
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

export interface HumanBodyLandmarkBinding {
  topologySignature: string;
  vertexIndices: Uint32Array;
  weights: Float32Array;
}

export interface HumanBodyLandmark {
  id: HumanBodyLandmarkId;
  position: HumanBodyVector3;
  normal: HumanBodyVector3;
  binding: HumanBodyLandmarkBinding;
}

export interface HumanBodyCrossSection {
  id: string;
  region: HumanBodyRegionId;
  yM: number;
  centerM?: HumanBodyVector3;
  normal?: HumanBodyVector3;
  targetCircumferenceMm: number;
  actualCircumferenceMm: number;
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
  topologySignature: string;
  sourceAssetId: "canonical-female.glb";
}

export interface HumanBodySurfaceRegion {
  id: HumanBodyRegionId;
  visualVertexIndices: Uint32Array;
  visualWeights: Float32Array;
  collisionVertexIndices: Uint32Array;
  collisionWeights: Float32Array;
}

export interface HumanBodyMeshDiagnostics {
  vertexCount: number;
  triangleCount: number;
  finite: boolean;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  degenerateTriangleCount: number;
  invertedTriangleCount: number;
  signedVolumeM3: number;
  normalsConsistent: boolean;
  topologySignature: string;
}

export interface HumanBodyDiagnostics {
  asset: CanonicalFemaleAssetAudit;
  visual: HumanBodyMeshDiagnostics;
  collision: HumanBodyMeshDiagnostics;
  measurementErrorsMm: Record<string, number>;
  lodSectionDeltaMm: Record<string, number>;
  maxLodSectionDeltaMm: number;
  landmarkToleranceMm: number;
  circumferenceToleranceMm: number;
  lengthToleranceMm: number;
  topologyInvariant: boolean;
  visualCollisionTopologyParity: boolean;
  metricCorrectionIterations: number;
  identityDeformation: HumanBodyDisplacementStatistics;
  deformationByRegion: Record<string, HumanBodyDisplacementStatistics>;
  meshQuality: HumanBodyShapeQualityDiagnostics;
}

export interface HumanBodyDisplacementStatistics {
  meanMm: number;
  rmsMm: number;
  percentile95Mm: number;
  maxMm: number;
}

export interface HumanBodyShapeQualityDiagnostics {
  maximumEdgeStretchRatio: number;
  maximumAreaRatio: number;
  maximumNormalChangeDegrees: number;
}

export interface HumanBodyCalibrationStages {
  raw: HumanBodyMesh;
  normalized: HumanBodyMesh;
  posed: HumanBodyMesh;
  deformedBeforeMetric: HumanBodyMesh;
  final: HumanBodyMesh;
  finalRestShape: HumanBodyMesh;
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
  calibrationStages?: HumanBodyCalibrationStages;
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
  /** Kept for API compatibility; the canonical GLB topology is always fixed. */
  visualResolution?: readonly [number, number, number];
  /** Kept for API compatibility; 11.0.5 may derive a reduced fitting LOD. */
  collisionResolution?: readonly [number, number, number];
  disableCache?: boolean;
  metricIterations?: number;
  includeCalibrationStages?: boolean;
  /**
   * Preserves the canonical origin of each document measurement. The flattened
   * values alone cannot distinguish a user-supplied thigh from an estimated
   * formula result, and treating both as supplied over-deforms the body.
   */
  measurementProfile?: MeasurementProfile;
  /** Origin metadata retained by older PatternDocumentV3 files without a full profile. */
  measurementOrigins?: Partial<Record<keyof BodyMeasurements, MeasurementOrigin>>;
}

interface BodyStations {
  groundY: number;
  ankleY: number;
  kneeY: number;
  crotchY: number;
  fullHipY: number;
  highHipY: number;
  waistY: number;
  underbustY: number;
  bustY: number;
  shoulderY: number;
  neckY: number;
  headTopY: number;
}

interface LimbFrame {
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

type VertexGroup =
  | "torso"
  | "arm-left"
  | "arm-right"
  | "pose-arm-left"
  | "pose-arm-right"
  | "leg-left"
  | "leg-right";

interface CanonicalReference {
  sourcePositions: Float32Array;
  posedPositions: Float32Array;
  indices: Uint32Array;
  topologySignature: string;
  stations: BodyStations;
  limbs: LimbFrame;
  groupWeights: Record<VertexGroup, Float32Array>;
  regionBindings: RegionBinding[];
  regionIds: HumanBodyRegionId[];
  landmarkBindings: Record<HumanBodyLandmarkId, HumanBodyLandmarkBinding>;
  vertexNeighbors: Uint32Array[];
}

interface RegionBinding {
  id: HumanBodyRegionId;
  indices: Uint32Array;
  weights: Float32Array;
}

interface SectionSpec {
  id: string;
  diagnosticId: string;
  region: HumanBodyRegionId;
  targetMm: number;
  point: HumanBodyVector3;
  normal: HumanBodyVector3;
  group: VertexGroup;
  influenceM: number;
  mode: "bust" | "torso" | "waist" | "hip" | "limb";
}

interface MeasuredSection {
  circumferenceMm: number;
  points: HumanBodyVector3[];
  center: HumanBodyVector3;
  halfWidthM: number;
  frontDepthM: number;
  backDepthM: number;
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

const CIRCUMFERENCE_TOLERANCE_MM = 5;
const LENGTH_TOLERANCE_MM = 5;
const DEFAULT_METRIC_ITERATIONS = 28;
const modelCache = new Map<string, HumanBodyModel>();
let referenceCache: CanonicalReference | null = null;
let nativeMeasurementCache: HumanBodyMeasurements | null = null;

export function buildHumanBodyModel(
  input: BodyMeasurements,
  options: HumanBodyBuildOptions = {},
): HumanBodyModel {
  const profile = createMeasurementProfile(input, "feminine", options.measurementProfile);
  const entries = applyMeasurementOriginOverrides(profile.entries, options.measurementOrigins);
  const resolved = measurementProfileToBodyMeasurements(profile);
  const measurements = resolveHumanMeasurements(resolved, entries);
  const measurementSources = resolveMeasurementSources(entries);
  const iterations = clampInt(options.metricIterations ?? DEFAULT_METRIC_ITERATIONS, 1, 32);
  const cacheKey = JSON.stringify({
    measurements,
    measurementSources,
    iterations,
    includeCalibrationStages: options.includeCalibrationStages === true,
  });
  if (!options.disableCache) {
    const cached = modelCache.get(cacheKey);
    if (cached) return cached;
  }

  const reference = canonicalReference();
  const targetStations = targetStationsFor(measurements);
  const targetLimbs = targetLimbFrame(measurements, targetStations);
  const restPositions = createInitialDeformation(reference, measurements, targetStations, targetLimbs);
  const preMetricRestPositions = new Float32Array(restPositions);
  const restSpecs = buildSectionSpecs(measurements, targetStations, targetLimbs);
  const usedIterations = correctMetricSections(restPositions, reference, restSpecs, iterations, targetLimbs);
  const posedLimbs = neutralPoseLimbFrame(targetLimbs);
  const preMetricPosedPositions = poseCanonicalArms(preMetricRestPositions, reference.groupWeights, targetLimbs);
  const positions = poseCanonicalArms(restPositions, reference.groupWeights, targetLimbs);
  stabilizePresentationPose(preMetricPosedPositions, positions, reference.indices, reference.vertexNeighbors);
  const normals = buildVertexNormals(positions, reference.indices);
  const bounds = computeBounds(positions);
  const visualMesh: HumanBodyMesh = {
    positions,
    normals,
    indices: reference.indices,
    regionIds: reference.regionIds,
    bounds,
    topologySignature: reference.topologySignature,
    sourceAssetId: "canonical-female.glb",
  };
  // 11.0.5 owns final collision simplification. Until then the fitting mesh is
  // the same final deformed truth, never a second procedural body.
  const collisionMesh: HumanBodyMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: reference.indices,
    regionIds: reference.regionIds,
    bounds: { min: [...bounds.min], max: [...bounds.max] },
    topologySignature: reference.topologySignature,
    sourceAssetId: "canonical-female.glb",
  };
  const landmarks = resolveLandmarks(reference, positions, normals);
  const joints = buildJoints(posedLimbs);
  const posedSpecs = buildSectionSpecs(measurements, targetStations, posedLimbs);
  const restCrossSections = buildCrossSections(restPositions, reference, restSpecs, targetStations);
  const restSectionsById = new Map(restCrossSections.map((section) => [section.id, section]));
  const crossSections = buildCrossSections(positions, reference, posedSpecs, targetStations).map((section) => {
    const rest = restSectionsById.get(section.id);
    if (!rest || section.id === "crotch" || section.id === "shoulder") return section;
    // Circumference and radii describe body shape and therefore belong to the
    // calibrated rest surface. Spatial center/normal belong to the optional
    // presentation pose. Keeping those concerns separate prevents an oblique
    // pose plane from being reported as a shape/measurement error.
    return {
      ...section,
      actualCircumferenceMm: rest.actualCircumferenceMm,
      halfWidthM: rest.halfWidthM,
      frontDepthM: rest.frontDepthM,
      backDepthM: rest.backDepthM,
      centerZM: rest.centerZM,
      frontLobeM: rest.frontLobeM,
      backLobeM: rest.backLobeM,
      lobeHalfDistanceM: rest.lobeHalfDistanceM,
    };
  });
  const surfaceRegions = reference.regionBindings.map((binding) => ({
    id: binding.id,
    visualVertexIndices: binding.indices,
    visualWeights: binding.weights,
    collisionVertexIndices: binding.indices,
    collisionWeights: binding.weights,
  }));
  const diagnostics = buildDiagnostics(
    measurements,
    reference,
    visualMesh,
    collisionMesh,
    crossSections,
    landmarks,
    usedIterations,
    restPositions,
    preMetricPosedPositions,
    targetLimbs,
  );

  const model: HumanBodyModel = {
    version: "human-body-female@1",
    sex: "female",
    measurements,
    measurementSources,
    bodyFrame: BODY_FRAME,
    joints,
    landmarks,
    surfaceRegions,
    collisionMesh,
    visualMesh,
    crossSections,
    diagnostics,
    calibrationStages: options.includeCalibrationStages
      ? buildCalibrationStages(reference, targetLimbs, preMetricRestPositions, restPositions)
      : undefined,
    editorMeasurementsMm: {
      quarterWaist: measurements.waistMm / 4,
      quarterHip: measurements.fullHipMm / 4,
      bust: measurements.bustMm,
      shoulderWidth: measurements.shoulderWidthMm,
      waistToHip: measurements.waistToHipMm,
      rise: measurements.crotchDepthMm,
    },
  };
  if (!options.disableCache) modelCache.set(cacheKey, model);
  return model;
}

function applyMeasurementOriginOverrides(
  entries: MeasurementProfile["entries"],
  origins: Partial<Record<keyof BodyMeasurements, MeasurementOrigin>> | undefined,
): MeasurementProfile["entries"] {
  if (!origins) return entries;
  const result = structuredClone(entries);
  for (const [rawKey, origin] of Object.entries(origins)) {
    const key = rawKey as keyof BodyMeasurements;
    const entry = result[key];
    if (!entry || !origin) continue;
    result[key] = { ...entry, origin };
  }
  return result;
}

function buildCalibrationStages(
  reference: CanonicalReference,
  targetLimbs: LimbFrame,
  preMetricRestPositions: Float32Array,
  finalRestPositions: Float32Array,
): HumanBodyCalibrationStages {
  const canonical = canonicalFemaleMesh();
  const mesh = (
    positions: Float32Array,
    indices: Uint32Array = reference.indices,
    topologySignature: string = reference.topologySignature,
    regionIds: HumanBodyRegionId[] = reference.regionIds,
  ): HumanBodyMesh => ({
    positions: new Float32Array(positions),
    normals: buildVertexNormals(positions, indices),
    indices,
    regionIds,
    bounds: computeBounds(positions),
    topologySignature,
    sourceAssetId: "canonical-female.glb",
  });
  const rawRegionIds = new Array<HumanBodyRegionId>(canonical.raw.positions.length / 3).fill("full-hip");
  const preMetricPosed = poseCanonicalArms(preMetricRestPositions, reference.groupWeights, targetLimbs);
  const finalPosed = poseCanonicalArms(finalRestPositions, reference.groupWeights, targetLimbs);
  stabilizePresentationPose(preMetricPosed, finalPosed, reference.indices, reference.vertexNeighbors);
  return {
    raw: mesh(
      canonical.raw.positions,
      canonical.raw.indices,
      `canonical-female-raw:${canonical.raw.positions.length / 3}:${canonical.raw.indices.length / 3}`,
      rawRegionIds,
    ),
    normalized: mesh(reference.sourcePositions),
    posed: mesh(poseCanonicalArms(reference.sourcePositions, reference.groupWeights, reference.limbs)),
    deformedBeforeMetric: mesh(preMetricPosed),
    final: mesh(finalPosed),
    finalRestShape: mesh(finalRestPositions),
  };
}

function canonicalReference(): CanonicalReference {
  if (referenceCache !== null) return referenceCache;
  const canonical = canonicalFemaleMesh();
  const sourcePositions = new Float32Array(canonical.positions);
  const groupWeights = buildVertexGroupWeights(sourcePositions);
  // Shape calibration is always performed in the canonical T-pose. Presentation
  // pose is a separate final transform and never feeds measurements back into
  // the shape solver.
  const posedPositions = new Float32Array(sourcePositions);
  const height = canonical.bounds.max[1] - canonical.bounds.min[1];
  const stations: BodyStations = {
    groundY: 0,
    ankleY: height * 0.045,
    kneeY: height * 0.251,
    crotchY: height * 0.445,
    fullHipY: height * 0.505,
    highHipY: lerp(height * 0.601, height * 0.505, 0.48),
    waistY: height * 0.601,
    underbustY: lerp(height * 0.735, height * 0.601, 0.36),
    bustY: height * 0.735,
    shoulderY: height * 0.824,
    neckY: height * (0.824 + 0.034),
    headTopY: height,
  };
  const limbs = referenceLimbFrame(stations);
  const regionBindings = buildRegionBindings(posedPositions, stations, limbs, groupWeights);
  const regionIds = dominantRegionIds(posedPositions.length / 3, regionBindings);
  const landmarkBindings = createLandmarkBindings(
    posedPositions,
    canonical.topologySignature,
    stations,
    limbs,
  );
  referenceCache = {
    sourcePositions,
    posedPositions,
    indices: canonical.indices,
    topologySignature: canonical.topologySignature,
    stations,
    limbs,
    groupWeights,
    regionBindings,
    regionIds,
    landmarkBindings,
    vertexNeighbors: buildVertexNeighbors(sourcePositions.length / 3, canonical.indices),
  };
  return referenceCache;
}

function resolveHumanMeasurements(
  resolved: BodyMeasurements,
  entries: Partial<Record<keyof BodyMeasurements, { origin: MeasurementOrigin }>>,
): HumanBodyMeasurements {
  const height = positive(resolved.heightMm, 1680);
  const bust = positive(resolved.bustMm, 920);
  const waist = positive(resolved.waistMm, 760);
  const hip = positive(resolved.hipMm, 1000);
  const native = canonicalNativeMeasurements(canonicalReference());
  const heightScale = height / native.heightMm;
  const torsoScale = (bust / native.bustMm + waist / native.waistMm) * 0.5;
  const hipScale = (hip / native.fullHipMm + heightScale) * 0.5;
  const supplied = (key: keyof BodyMeasurements, fallback: number): number =>
    entries[key]?.origin === "supplied" ? positive(resolved[key], fallback) : fallback;
  // highBust is an upper-torso tape measure, not the circumference directly
  // below the breasts. Treating it as underbust produced the rejected shelf
  // and horizontal fold. Until the domain exposes underbust explicitly, keep
  // that station on the calibrated canonical ribcage prior.
  const underbust = native.underbustMm * torsoScale;
  const highHip = waist + (hip - waist) * 0.56;
  const waistToHip = supplied("hipHeightMm", height * 0.115);
  const inseam = entries.insideLegLengthMm?.origin === "supplied"
    ? positive(resolved.insideLegLengthMm, height * 0.465)
    : supplied("inseamMm", height * 0.465);
  const outseam = supplied("outseamLengthMm", inseam + height * 0.155);
  const crotchDepth = Math.max(120, outseam - inseam);
  return {
    heightMm: height,
    shoulderWidthMm: supplied("shoulderWidthMm", native.shoulderWidthMm * heightScale),
    neckCircumferenceMm: supplied("neckCircumferenceMm", native.neckCircumferenceMm * torsoScale),
    bustMm: bust,
    underbustMm: underbust,
    waistMm: waist,
    highHipMm: highHip,
    fullHipMm: hip,
    torsoLengthMm: supplied("torsoLengthMm", height * 0.262),
    shoulderToBustMm: supplied("bustHeightMm", height * 0.157),
    bustPointDistanceMm: supplied("bustSpanMm", bust * 0.2),
    waistToHipMm: waistToHip,
    hipToCrotchMm: Math.max(70, crotchDepth - waistToHip),
    crotchDepthMm: crotchDepth,
    thighMm: supplied("thighMm", native.thighMm * hipScale),
    kneeMm: supplied("kneeCircumferenceMm", native.kneeMm * heightScale),
    calfMm: supplied("calfMm", native.calfMm * heightScale),
    ankleMm: supplied("ankleCircumferenceMm", native.ankleMm * heightScale),
    bicepMm: supplied("bicepMm", native.bicepMm * torsoScale),
    elbowMm: supplied("elbowCircumferenceMm", native.elbowMm * torsoScale),
    wristMm: supplied("wristMm", native.wristMm * heightScale),
    armLengthMm: supplied("armLengthMm", height * 0.35),
    inseamMm: inseam,
    outseamMm: outseam,
    headCircumferenceMm: supplied("headCircumferenceMm", native.headCircumferenceMm * heightScale),
  };
}

function resolveMeasurementSources(
  entries: Partial<Record<keyof BodyMeasurements, { origin: MeasurementOrigin }>>,
): Record<keyof HumanBodyMeasurements, HumanBodyMeasurementSource> {
  const from = (key: keyof BodyMeasurements, fallback: MeasurementOrigin = "derived") =>
    entries[key]?.origin ?? fallback;
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
    crotchDepthMm: from("crotchDepthMm", "derived"),
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

function targetStationsFor(m: HumanBodyMeasurements): BodyStations {
  const height = m.heightMm * 0.001;
  const canonicalHeight = canonicalFemaleMesh().bounds.max[1] - canonicalFemaleMesh().bounds.min[1];
  const globalScale = height / canonicalHeight;
  const groundY = 0;
  const ankleY = height * 0.045;
  const crotchY = clamp(m.inseamMm * 0.001, height * 0.42, height * 0.51);
  const kneeY = lerp(ankleY, crotchY, 0.52);
  const waistY = clamp(m.outseamMm * 0.001, crotchY + 0.18, height * 0.67);
  const calibratedDistance = (
    canonicalDistanceM: number,
    targetSemanticMm: number,
    nativeSemanticRatio: number,
  ) => canonicalDistanceM * globalScale * (
    targetSemanticMm / Math.max(1e-9, canonicalHeight * 1000 * nativeSemanticRatio * globalScale)
  );
  const fullHipY = clamp(
    waistY - calibratedDistance(canonicalHeight * (0.601 - 0.505), m.waistToHipMm, 0.115),
    crotchY + 0.035,
    waistY - 0.075,
  );
  const highHipY = lerp(waistY, fullHipY, 0.48);
  const shoulderY = clamp(
    waistY + calibratedDistance(canonicalHeight * (0.824 - 0.601), m.torsoLengthMm, 0.262),
    height * 0.78,
    height * 0.88,
  );
  const bustY = clamp(
    shoulderY - calibratedDistance(canonicalHeight * (0.824 - 0.735), m.shoulderToBustMm, 0.157),
    waistY + 0.09,
    shoulderY - 0.07,
  );
  const underbustY = lerp(bustY, waistY, 0.36);
  const neckY = clamp(shoulderY + height * 0.034, shoulderY + 0.035, height - 0.14);
  return {
    groundY,
    ankleY,
    kneeY,
    crotchY,
    fullHipY,
    highHipY,
    waistY,
    underbustY,
    bustY,
    shoulderY,
    neckY,
    headTopY: height,
  };
}

function referenceLimbFrame(stations: BodyStations): LimbFrame {
  const shoulderLeft: HumanBodyVector3 = [-0.205, stations.shoulderY, -0.018];
  const shoulderRight: HumanBodyVector3 = [0.205, stations.shoulderY, -0.018];
  const leftDirection: HumanBodyVector3 = [-1, 0, 0];
  const rightDirection: HumanBodyVector3 = [1, 0, 0];
  const armLength = 0.59;
  const elbowLeft = addScaled(shoulderLeft, leftDirection, armLength * 0.52);
  const elbowRight = addScaled(shoulderRight, rightDirection, armLength * 0.52);
  const wristLeft = addScaled(shoulderLeft, leftDirection, armLength);
  const wristRight = addScaled(shoulderRight, rightDirection, armLength);
  const hipHalf = 0.08405;
  const hipLeft: HumanBodyVector3 = [-hipHalf, stations.crotchY + 0.045, -0.008];
  const hipRight: HumanBodyVector3 = [hipHalf, stations.crotchY + 0.045, -0.008];
  const kneeLeft: HumanBodyVector3 = [-hipHalf * 0.83, stations.kneeY, 0.004];
  const kneeRight: HumanBodyVector3 = [hipHalf * 0.83, stations.kneeY, 0.004];
  const ankleLeft: HumanBodyVector3 = [-hipHalf * 0.72, stations.ankleY, 0.006];
  const ankleRight: HumanBodyVector3 = [hipHalf * 0.72, stations.ankleY, 0.006];
  return {
    shoulderLeft, shoulderRight, elbowLeft, elbowRight, wristLeft, wristRight,
    hipLeft, hipRight, kneeLeft, kneeRight, ankleLeft, ankleRight,
  };
}

function targetLimbFrame(m: HumanBodyMeasurements, stations: BodyStations): LimbFrame {
  const shoulderHalf = m.shoulderWidthMm * 0.0005;
  // Keep the axilla/shoulder root on the canonical depth plane. A seemingly
  // harmless 6 mm forward shift folded two thin axilla triangles while the
  // rest of the arm remained rigidly mapped.
  const shoulderLeft: HumanBodyVector3 = [-shoulderHalf, stations.shoulderY, -0.018];
  const shoulderRight: HumanBodyVector3 = [shoulderHalf, stations.shoulderY, -0.018];
  const leftDirection: HumanBodyVector3 = [-1, 0, 0];
  const rightDirection: HumanBodyVector3 = [1, 0, 0];
  const armLength = m.armLengthMm * 0.001;
  const elbowLeft = addScaled(shoulderLeft, leftDirection, armLength * 0.52);
  const elbowRight = addScaled(shoulderRight, rightDirection, armLength * 0.52);
  const wristLeft = addScaled(shoulderLeft, leftDirection, armLength);
  const wristRight = addScaled(shoulderRight, rightDirection, armLength);
  const hipHalf = clamp(m.fullHipMm * 0.000075, 0.062, 0.096);
  const hipLeft: HumanBodyVector3 = [-hipHalf, stations.crotchY + 0.045, -0.008];
  const hipRight: HumanBodyVector3 = [hipHalf, stations.crotchY + 0.045, -0.008];
  const kneeLeft: HumanBodyVector3 = [-hipHalf * 0.83, stations.kneeY, 0.004];
  const kneeRight: HumanBodyVector3 = [hipHalf * 0.83, stations.kneeY, 0.004];
  const ankleLeft: HumanBodyVector3 = [-hipHalf * 0.72, stations.ankleY, 0.006];
  const ankleRight: HumanBodyVector3 = [hipHalf * 0.72, stations.ankleY, 0.006];
  return {
    shoulderLeft, shoulderRight, elbowLeft, elbowRight, wristLeft, wristRight,
    hipLeft, hipRight, kneeLeft, kneeRight, ankleLeft, ankleRight,
  };
}

function neutralPoseLimbFrame(rest: LimbFrame): LimbFrame {
  const pose = (point: HumanBodyVector3, side: -1 | 1, rotateUpperArm: boolean) => {
    const acromion = side < 0 ? rest.shoulderLeft : rest.shoulderRight;
    const claviclePivot: HumanBodyVector3 = [acromion[0] * 0.28, acromion[1], acromion[2]];
    const humeralPivot: HumanBodyVector3 = [acromion[0] * 0.82, acromion[1], acromion[2]];
    const direction = side < 0 ? 1 : -1;
    const clavicleAngle = direction * 6 * Math.PI / 180;
    const posedHumeralPivot = rotatePointAroundZ(humeralPivot, claviclePivot, clavicleAngle);
    const afterClavicle = rotatePointAroundZ(point, claviclePivot, clavicleAngle);
    return rotateUpperArm
      ? rotatePointAroundZ(afterClavicle, posedHumeralPivot, direction * 62 * Math.PI / 180)
      : posedHumeralPivot;
  };
  return {
    ...rest,
    shoulderLeft: pose(rest.shoulderLeft, -1, false),
    shoulderRight: pose(rest.shoulderRight, 1, false),
    elbowLeft: pose(rest.elbowLeft, -1, true),
    elbowRight: pose(rest.elbowRight, 1, true),
    wristLeft: pose(rest.wristLeft, -1, true),
    wristRight: pose(rest.wristRight, 1, true),
  };
}

function buildVertexGroupWeights(positions: Float32Array): Record<VertexGroup, Float32Array> {
  const count = positions.length / 3;
  const result: Record<VertexGroup, Float32Array> = {
    torso: new Float32Array(count),
    "arm-left": new Float32Array(count),
    "arm-right": new Float32Array(count),
    "pose-arm-left": new Float32Array(count),
    "pose-arm-right": new Float32Array(count),
    "leg-left": new Float32Array(count),
    "leg-right": new Float32Array(count),
  };
  for (let vertex = 0; vertex < count; vertex += 1) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    // The transition must finish at the anatomical shoulder joint. Leaving
    // half-weighted deltoid vertices beyond that point makes the T-pose cap
    // remain above a lowered upper arm, which reads as a square/inflated
    // shoulder. Clavicle/torso vertices stay outside this compact ramp while
    // the upper arm and outer deltoid rotate as one articulated region.
    const arm = smoothRange(Math.abs(x), 0.155, 0.205) * smoothBand(y, 1.45, 0.13, 0.28);
    const poseArm = smoothRange(Math.abs(x), 0.085, 0.205) * smoothBand(y, 1.48, 0.09, 0.18);
    // Below the crotch the sign of X already identifies the leg. The earlier
    // radial ramp removed medial-thigh vertices from the group, so arc-length
    // measurement saw an open partial contour and inflated the remaining arc
    // into a diamond. Preserve the complete anatomical loop on each side.
    const leg = 1 - smoothstep01((y - 0.72) / 0.13);
    if (x < 0) {
      result["arm-left"][vertex] = arm;
      result["pose-arm-left"][vertex] = poseArm;
      result["leg-left"][vertex] = leg;
    } else {
      result["arm-right"][vertex] = arm;
      result["pose-arm-right"][vertex] = poseArm;
      result["leg-right"][vertex] = leg;
    }
    result.torso[vertex] = clamp(1 - arm - leg * 0.65, 0, 1);
  }
  return result;
}

function poseCanonicalArms(
  source: Float32Array,
  groups: Record<VertexGroup, Float32Array>,
  limbs: LimbFrame,
): Float32Array {
  const result = new Float32Array(source);
  for (let vertex = 0; vertex < source.length / 3; vertex += 1) {
    const x = source[vertex * 3];
    const y = source[vertex * 3 + 1];
    const z = source[vertex * 3 + 2];
    const side = x < 0 ? -1 : 1;
    const weight = side < 0 ? groups["pose-arm-left"][vertex] : groups["pose-arm-right"][vertex];
    if (weight <= 0) continue;
    const acromion = side < 0 ? limbs.shoulderLeft : limbs.shoulderRight;
    const direction = side < 0 ? 1 : -1;
    const claviclePivot: HumanBodyVector3 = [acromion[0] * 0.28, acromion[1], z];
    const clavicleAngle = direction * 6 * Math.PI / 180 * weight;
    const childWeight = smoothstep01((weight - 0.35) / 0.65);
    const posedHumeralPivot = rotatePointAroundZ(
      [acromion[0] * 0.82, acromion[1], z],
      claviclePivot,
      clavicleAngle,
    );
    const afterClavicle = rotatePointAroundZ([x, y, z], claviclePivot, clavicleAngle);
    // Two articulated virtual joints: the clavicle supplies the small shoulder
    // slope and the humerus supplies the remaining arm rotation. Both use
    // blended rotations, never regional position pushing or torso scaling.
    const posed = rotatePointAroundZ(
      afterClavicle,
      posedHumeralPivot,
      direction * 62 * Math.PI / 180 * childWeight,
    );
    result[vertex * 3] = posed[0];
    result[vertex * 3 + 1] = posed[1];
    result[vertex * 3 + 2] = z;
  }
  return result;
}

function stabilizePresentationPose(
  baseline: Float32Array,
  posed: Float32Array,
  indices: Uint32Array,
  neighbors: readonly Uint32Array[],
): void {
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const affected = new Set<number>();
    for (let offset = 0; offset < indices.length; offset += 3) {
      const vertices = [indices[offset], indices[offset + 1], indices[offset + 2]] as const;
      const before = normalize(cross(
        sub(pointAt(baseline, vertices[1]), pointAt(baseline, vertices[0])),
        sub(pointAt(baseline, vertices[2]), pointAt(baseline, vertices[0])),
      ));
      const after = normalize(cross(
        sub(pointAt(posed, vertices[1]), pointAt(posed, vertices[0])),
        sub(pointAt(posed, vertices[2]), pointAt(posed, vertices[0])),
      ));
      if (dot(before, after) >= -0.15) continue;
      for (const vertex of vertices) {
        affected.add(vertex);
        for (const neighbor of neighbors[vertex]) affected.add(neighbor);
      }
    }
    if (affected.size === 0) return;
    for (const vertex of affected) {
      for (let axis = 0; axis < 3; axis += 1) {
        const offset = vertex * 3 + axis;
        posed[offset] = lerp(posed[offset], baseline[offset], 0.35);
      }
    }
  }
}

function rotatePointAroundZ(
  point: HumanBodyVector3,
  pivot: HumanBodyVector3,
  angle: number,
): HumanBodyVector3 {
  const dx = point[0] - pivot[0];
  const dy = point[1] - pivot[1];
  return [
    pivot[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    pivot[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
    point[2],
  ];
}

function createInitialDeformation(
  reference: CanonicalReference,
  measurements: HumanBodyMeasurements,
  target: BodyStations,
  targetLimbs: LimbFrame,
): Float32Array {
  const result = new Float32Array(reference.posedPositions.length);
  const sourceStations = Object.values(reference.stations);
  const targetStationValues = Object.values(target);
  for (let vertex = 0; vertex < result.length / 3; vertex += 1) {
    const sourcePoint = pointAt(reference.posedPositions, vertex);
    const mapped: HumanBodyVector3 = [
      sourcePoint[0],
      piecewiseMap(sourcePoint[1], sourceStations, targetStationValues),
      sourcePoint[2],
    ];
    const leftArmWeight = reference.groupWeights["arm-left"][vertex];
    const rightArmWeight = reference.groupWeights["arm-right"][vertex];
    let finalPoint = mapped;
    if (leftArmWeight > 0) {
      // Preserve the canonical axilla on low-confidence transition vertices;
      // arm length acts fully only on vertices topologically inside the arm.
      // This is a smooth skinning falloff, not a positional shoulder offset.
      finalPoint = mixPoint(mapped, mapLimbPoint(
        sourcePoint,
        reference.limbs.shoulderLeft,
        reference.limbs.wristLeft,
        targetLimbs.shoulderLeft,
        targetLimbs.wristLeft,
      ), leftArmWeight ** 5);
    } else if (rightArmWeight > 0) {
      finalPoint = mixPoint(mapped, mapLimbPoint(
        sourcePoint,
        reference.limbs.shoulderRight,
        reference.limbs.wristRight,
        targetLimbs.shoulderRight,
        targetLimbs.wristRight,
      ), rightArmWeight ** 5);
    }
    result.set(finalPoint, vertex * 3);
  }
  preconditionCanonicalVolume(result, reference, measurements, target, targetLimbs);
  // Head circumference is independent from stature; scale the cranial volume
  // around the neck while preserving the face/neck transition.
  const referenceHeadMm = 570;
  const headScale = clamp(measurements.headCircumferenceMm / referenceHeadMm, 0.82, 1.2);
  for (let vertex = 0; vertex < result.length / 3; vertex += 1) {
    const y = result[vertex * 3 + 1];
    const weight = smoothstep01((y - target.neckY) / Math.max(0.04, target.headTopY - target.neckY) * 2.5);
    if (weight <= 0) continue;
    result[vertex * 3] *= 1 + (headScale - 1) * weight;
    result[vertex * 3 + 2] *= 1 + (headScale - 1) * weight;
  }
  return result;
}

function preconditionCanonicalVolume(
  positions: Float32Array,
  reference: CanonicalReference,
  measurements: HumanBodyMeasurements,
  stations: BodyStations,
  limbs: LimbFrame,
): void {
  const native = canonicalNativeMeasurements(reference);
  const torsoRatios = [
    measurements.bustMm / native.bustMm,
    measurements.underbustMm / native.underbustMm,
    measurements.waistMm / native.waistMm,
    measurements.highHipMm / native.highHipMm,
    measurements.fullHipMm / native.fullHipMm,
  ];
  const torsoScale = clamp(
    Math.exp(torsoRatios.reduce((sum, ratio) => sum + Math.log(Math.max(0.1, ratio)), 0) / torsoRatios.length),
    0.72,
    1.3,
  );
  const armScales = [
    measurements.bicepMm / native.bicepMm,
    measurements.elbowMm / native.elbowMm,
    measurements.wristMm / native.wristMm,
  ].map((ratio) => clamp(ratio, 0.62, 1.45));
  const armKnots = [0, 0.35, 0.52, 0.9424, 1] as const;
  const armValues = [armScales[0], armScales[0], armScales[1], armScales[2], armScales[2]] as const;

  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const leftArmWeight = reference.groupWeights["arm-left"][vertex];
    const rightArmWeight = reference.groupWeights["arm-right"][vertex];
    const armWeight = Math.max(leftArmWeight, rightArmWeight);
    if (armWeight > 0.005) {
      const start = leftArmWeight > rightArmWeight ? limbs.shoulderLeft : limbs.shoulderRight;
      const end = leftArmWeight > rightArmWeight ? limbs.wristLeft : limbs.wristRight;
      const axis = normalize(sub(end, start));
      const point = pointAt(positions, vertex);
      const local = sub(point, start);
      const along = dot(local, axis);
      const radial = sub(local, scale(axis, along));
      const t = clamp(along / Math.max(1e-9, distance(start, end)), 0, 1);
      const radialScale = piecewiseMap(t, armKnots, armValues);
      const blendedScale = 1 + (radialScale - 1) * armWeight ** 3;
      positions.set(add(addScaled(start, axis, along), scale(radial, blendedScale)), vertex * 3);
      continue;
    }

    const point = pointAt(positions, vertex);
    const lowerFade = smoothRange(point[1], stations.crotchY - 0.08, stations.crotchY + 0.06);
    const upperFade = 1 - smoothRange(point[1], stations.neckY - 0.07, stations.neckY + 0.04);
    const weight = reference.groupWeights.torso[vertex] * lowerFade * upperFade;
    if (weight <= 0.001) continue;
    const scaleAtVertex = 1 + (torsoScale - 1) * weight;
    positions[vertex * 3] *= scaleAtVertex;
    positions[vertex * 3 + 2] *= scaleAtVertex;
  }
}

function mapLimbPoint(
  point: HumanBodyVector3,
  sourceStart: HumanBodyVector3,
  sourceEnd: HumanBodyVector3,
  targetStart: HumanBodyVector3,
  targetEnd: HumanBodyVector3,
): HumanBodyVector3 {
  const sourceAxis = normalize(sub(sourceEnd, sourceStart));
  const targetAxis = normalize(sub(targetEnd, targetStart));
  const sourceLength = distance(sourceStart, sourceEnd);
  const targetLength = distance(targetStart, targetEnd);
  const local = sub(point, sourceStart);
  const along = dot(local, sourceAxis);
  const radial = sub(local, scale(sourceAxis, along));
  const rotatedRadial = rotateFromTo(radial, sourceAxis, targetAxis);
  return add(addScaled(targetStart, targetAxis, along / Math.max(1e-9, sourceLength) * targetLength), rotatedRadial);
}

function buildSectionSpecs(
  m: HumanBodyMeasurements,
  stations: BodyStations,
  limbs: LimbFrame,
): SectionSpec[] {
  const limb = (
    id: string,
    diagnosticId: string,
    region: HumanBodyRegionId,
    targetMm: number,
    point: HumanBodyVector3,
    normal: HumanBodyVector3,
    group: VertexGroup,
    influenceM: number,
  ): SectionSpec => ({ id, diagnosticId, region, targetMm, point, normal: normalize(normal), group, influenceM, mode: "limb" });
  const leftArmAxis = normalize(sub(limbs.wristLeft, limbs.shoulderLeft));
  const rightArmAxis = normalize(sub(limbs.wristRight, limbs.shoulderRight));
  const leftThighAxis = normalize(sub(limbs.kneeLeft, limbs.hipLeft));
  const rightThighAxis = normalize(sub(limbs.kneeRight, limbs.hipRight));
  const leftCalfAxis = normalize(sub(limbs.ankleLeft, limbs.kneeLeft));
  const rightCalfAxis = normalize(sub(limbs.ankleRight, limbs.kneeRight));
  return [
    torsoSpec("bust", "bust", "chest-front", m.bustMm, stations.bustY, 0.145, "bust"),
    torsoSpec("underbust", "underbust", "underbust", m.underbustMm, stations.underbustY, 0.16, "torso"),
    torsoSpec("waist", "waist", "waist", m.waistMm, stations.waistY, 0.17, "waist"),
    torsoSpec("high-hip", "highHip", "high-hip", m.highHipMm, stations.highHipY, 0.16, "hip"),
    torsoSpec("full-hip", "fullHip", "full-hip", m.fullHipMm, stations.fullHipY, 0.18, "hip"),
    limb("thigh-left", "thigh", "thigh-left", m.thighMm, mixPoint(limbs.hipLeft, limbs.kneeLeft, 0.2), leftThighAxis, "leg-left", 0.22),
    limb("thigh-right", "thigh", "thigh-right", m.thighMm, mixPoint(limbs.hipRight, limbs.kneeRight, 0.2), rightThighAxis, "leg-right", 0.22),
    limb("knee-left", "knee", "knee-left", m.kneeMm, limbs.kneeLeft, leftCalfAxis, "leg-left", 0.16),
    limb("knee-right", "knee", "knee-right", m.kneeMm, limbs.kneeRight, rightCalfAxis, "leg-right", 0.16),
    limb("calf-left", "calf", "calf-left", m.calfMm, mixPoint(limbs.kneeLeft, limbs.ankleLeft, 0.48), leftCalfAxis, "leg-left", 0.18),
    limb("calf-right", "calf", "calf-right", m.calfMm, mixPoint(limbs.kneeRight, limbs.ankleRight, 0.48), rightCalfAxis, "leg-right", 0.18),
    limb("ankle-left", "ankle", "ankle-left", m.ankleMm, limbs.ankleLeft, leftCalfAxis, "leg-left", 0.11),
    limb("ankle-right", "ankle", "ankle-right", m.ankleMm, limbs.ankleRight, rightCalfAxis, "leg-right", 0.11),
    limb("upper-arm-left", "bicep", "upper-arm-left", m.bicepMm, mixPoint(limbs.shoulderLeft, limbs.elbowLeft, 0.35), leftArmAxis, "arm-left", 0.16),
    limb("upper-arm-right", "bicep", "upper-arm-right", m.bicepMm, mixPoint(limbs.shoulderRight, limbs.elbowRight, 0.35), rightArmAxis, "arm-right", 0.16),
    limb("elbow-left", "elbow", "forearm-left", m.elbowMm, limbs.elbowLeft, leftArmAxis, "arm-left", 0.13),
    limb("elbow-right", "elbow", "forearm-right", m.elbowMm, limbs.elbowRight, rightArmAxis, "arm-right", 0.13),
    limb("wrist-left", "wrist", "wrist-left", m.wristMm, mixPoint(limbs.elbowLeft, limbs.wristLeft, 0.88), leftArmAxis, "arm-left", 0.095),
    limb("wrist-right", "wrist", "wrist-right", m.wristMm, mixPoint(limbs.elbowRight, limbs.wristRight, 0.88), rightArmAxis, "arm-right", 0.095),
  ];
}

function torsoSpec(
  id: string,
  diagnosticId: string,
  region: HumanBodyRegionId,
  targetMm: number,
  y: number,
  influenceM: number,
  mode: SectionSpec["mode"],
): SectionSpec {
  return {
    id,
    diagnosticId,
    region,
    targetMm,
    point: [0, y, 0],
    normal: [0, 1, 0],
    group: "torso",
    influenceM,
    mode,
  };
}

function correctMetricSections(
  positions: Float32Array,
  reference: CanonicalReference,
  specs: readonly SectionSpec[],
  maximumIterations: number,
  _poseLimbs: LimbFrame,
): number {
  const baseline = new Float32Array(positions);
  let used = 0;
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    let maximumErrorMm = 0;
    const corrections: Array<{ spec: SectionSpec; center: HumanBodyVector3; delta: number }> = [];
    for (const spec of specs) {
      const measured = measureSection(positions, reference, spec);
      if (measured.circumferenceMm <= 1) continue;
      const errorMm = spec.targetMm - measured.circumferenceMm;
      maximumErrorMm = Math.max(maximumErrorMm, Math.abs(errorMm));
      if (Math.abs(errorMm) <= toleranceFor(spec.targetMm) * 0.35) continue;
      const factor = clamp(spec.targetMm / measured.circumferenceMm, 0.92, 1.08);
      corrections.push({ spec, center: measured.center, delta: factor - 1 });
    }
    used = iteration + 1;
    if (maximumErrorMm <= CIRCUMFERENCE_TOLERANCE_MM * 0.75) break;
    if (corrections.length === 0) continue;

    // Resolve every station from the same immutable iteration state. The old
    // sequential solve made whichever section ran last overwrite its
    // neighbours (notably high-hip widening the waist). This compact-RBF blend
    // is order independent and acts as one smooth deformation cage.
    const before = new Float32Array(positions);
    const accumulated = new Float64Array(positions.length);
    const totalInfluence = new Float64Array(positions.length / 3);
    for (const correction of corrections) {
      const candidate = new Float32Array(before);
      applySectionCorrection(
        candidate,
        reference,
        correction.spec,
        correction.center,
        correction.delta,
      );
      regularizeCorrectionField(before, candidate, reference, correction.spec);
      for (let vertex = 0; vertex < candidate.length / 3; vertex += 1) {
        const influence = sectionInfluenceWeight(before, reference, correction.spec, vertex);
        if (influence <= 0.001) continue;
        totalInfluence[vertex] += influence;
        for (let axis = 0; axis < 3; axis += 1) {
          accumulated[vertex * 3 + axis] += candidate[vertex * 3 + axis] - before[vertex * 3 + axis];
        }
      }
    }
    const blended = new Float32Array(before);
    for (let vertex = 0; vertex < blended.length / 3; vertex += 1) {
      const divisor = Math.max(1, totalInfluence[vertex]);
      for (let axis = 0; axis < 3; axis += 1) {
        blended[vertex * 3 + axis] += accumulated[vertex * 3 + axis] / divisor;
      }
    }
    let accepted = false;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const blend = 2 ** -attempt;
      for (let offset = 0; offset < positions.length; offset += 1) {
        positions[offset] = lerp(before[offset], blended[offset], blend);
      }
      if (metricCorrectionIsSafe(baseline, positions, reference.indices)) {
        accepted = true;
        break;
      }
    }
    if (!accepted) positions.set(before);
  }
  return used;
}

function sectionInfluenceWeight(
  positions: Float32Array,
  reference: CanonicalReference,
  spec: SectionSpec,
  vertex: number,
): number {
  const groupWeight = reference.groupWeights[spec.group][vertex];
  if (groupWeight <= 0.005) return 0;
  const point = pointAt(positions, vertex);
  const axial = Math.abs(dot(sub(point, spec.point), normalize(spec.normal)));
  return groupWeight * smoothFalloff(axial / Math.max(1e-9, spec.influenceM));
}

function metricCorrectionIsSafe(
  baseline: Float32Array,
  candidate: Float32Array,
  indices: Uint32Array,
): boolean {
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset]; const b = indices[offset + 1]; const c = indices[offset + 2];
    const referenceNormal = cross(
      sub(pointAt(baseline, b), pointAt(baseline, a)),
      sub(pointAt(baseline, c), pointAt(baseline, a)),
    );
    const normal = cross(
      sub(pointAt(candidate, b), pointAt(candidate, a)),
      sub(pointAt(candidate, c), pointAt(candidate, a)),
    );
    const referenceArea = magnitude(referenceNormal);
    const area = magnitude(normal);
    if (referenceArea <= 1e-12 || area <= 1e-12) return false;
    const areaRatio = area / referenceArea;
    if (areaRatio < 0.22 || areaRatio > 4.5) return false;
    if (dot(normalize(referenceNormal), normalize(normal)) <= -0.15) return false;
  }
  return true;
}

/**
 * Preserves differential shape by smoothing only the correction displacement,
 * never the canonical surface itself. The measured core remains authoritative;
 * the compact RBF transition is regularized over the mesh one-ring so adjacent
 * anatomical regions cannot form a shelf, fold or curvature spike.
 */
function regularizeCorrectionField(
  before: Float32Array,
  candidate: Float32Array,
  reference: CanonicalReference,
  spec: SectionSpec,
): void {
  const displacement = new Float32Array(candidate.length);
  for (let offset = 0; offset < candidate.length; offset += 1) {
    displacement[offset] = candidate[offset] - before[offset];
  }
  const membership = reference.groupWeights[spec.group];
  const normal = normalize(spec.normal);
  for (let vertex = 0; vertex < candidate.length / 3; vertex += 1) {
    if (membership[vertex] <= 0.005) continue;
    const point = pointAt(before, vertex);
    const axial = Math.abs(dot(sub(point, spec.point), normal));
    if (axial >= spec.influenceM) continue;
    const neighbors = reference.vertexNeighbors[vertex];
    if (neighbors.length === 0) continue;
    const average: HumanBodyVector3 = [0, 0, 0];
    let count = 0;
    for (const neighbor of neighbors) {
      if (membership[neighbor] <= 0.005) continue;
      average[0] += displacement[neighbor * 3];
      average[1] += displacement[neighbor * 3 + 1];
      average[2] += displacement[neighbor * 3 + 2];
      count += 1;
    }
    if (count === 0) continue;
    const core = smoothFalloff(axial / Math.max(1e-9, spec.influenceM));
    const blend = 0.2 * (1 - core * 0.8);
    for (let axis = 0; axis < 3; axis += 1) {
      const own = displacement[vertex * 3 + axis];
      candidate[vertex * 3 + axis] = before[vertex * 3 + axis]
        + lerp(own, average[axis] / count, blend);
    }
  }
}

function buildVertexNeighbors(vertexCount: number, indices: Uint32Array): Uint32Array[] {
  const sets = Array.from({ length: vertexCount }, () => new Set<number>());
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset]; const b = indices[offset + 1]; const c = indices[offset + 2];
    sets[a].add(b); sets[a].add(c);
    sets[b].add(a); sets[b].add(c);
    sets[c].add(a); sets[c].add(b);
  }
  return sets.map((neighbors) => Uint32Array.from(neighbors));
}

function applySectionCorrection(
  positions: Float32Array,
  reference: CanonicalReference,
  spec: SectionSpec,
  measuredCenter: HumanBodyVector3,
  delta: number,
): void {
  const membership = reference.groupWeights[spec.group];
  const normal = normalize(spec.normal);
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const groupWeight = membership[vertex];
    if (groupWeight <= 0.005) continue;
    const point = pointAt(positions, vertex);
    const axial = dot(sub(point, spec.point), normal);
    const stationWeight = smoothFalloff(Math.abs(axial) / spec.influenceM);
    const weight = groupWeight * stationWeight;
    if (weight <= 0.001) continue;
    if (spec.mode === "limb") {
      const radial = sub(sub(point, spec.point), scale(normal, axial));
      const corrected = add(point, scale(radial, delta * weight));
      positions.set(corrected, vertex * 3);
      continue;
    }
    const dx = point[0] - measuredCenter[0];
    const dz = point[2] - measuredCenter[2];
    const coefficients = torsoCorrectionCoefficients(spec.mode, point[0], dz);
    positions[vertex * 3] += dx * delta * weight * coefficients.x;
    positions[vertex * 3 + 2] += dz * delta * weight * coefficients.z;
  }
}

function torsoCorrectionCoefficients(
  mode: SectionSpec["mode"],
  x: number,
  relativeZ: number,
): { x: number; z: number } {
  if (mode === "bust") {
    const breast = relativeZ > 0
      ? 0.9 + 0.1 * smoothFalloff(Math.abs(Math.abs(x) - 0.075) / 0.1)
      : 0.45;
    return { x: 0.68, z: breast };
  }
  if (mode === "waist") return { x: 0.1, z: 1.15 };
  if (mode === "hip") return { x: 0.76, z: relativeZ < 0 ? 0.9 : 0.58 };
  return { x: 0.74, z: relativeZ > 0 ? 0.76 : 0.66 };
}

function measureSection(
  positions: Float32Array,
  reference: CanonicalReference,
  spec: SectionSpec,
): MeasuredSection {
  const points: HumanBodyVector3[] = [];
  let lengthM = 0;
  const membership = reference.groupWeights[spec.group];
  const normal = normalize(spec.normal);
  for (let offset = 0; offset < reference.indices.length; offset += 3) {
    const ia = reference.indices[offset];
    const ib = reference.indices[offset + 1];
    const ic = reference.indices[offset + 2];
    if ((membership[ia] + membership[ib] + membership[ic]) / 3 < 0.42) continue;
    const segment = trianglePlaneSegment(
      pointAt(positions, ia),
      pointAt(positions, ib),
      pointAt(positions, ic),
      spec.point,
      normal,
    );
    if (segment === null) continue;
    const midpoint = mixPoint(segment[0], segment[1], 0.5);
    const relative = sub(midpoint, spec.point);
    const radial = sub(relative, scale(normal, dot(relative, normal)));
    // Membership is bound to the canonical topology, so a limb section cannot
    // accidentally consume torso triangles. Do not apply a radius cutoff here:
    // it would hide the very expansion the metric iteration is measuring.
    lengthM += distance(segment[0], segment[1]);
    points.push(segment[0], segment[1]);
  }
  const center = points.length === 0
    ? [...spec.point] as HumanBodyVector3
    : centroid(points);
  if (spec.mode === "limb") {
    const radius = lengthM / (Math.PI * 4);
    return {
      circumferenceMm: lengthM * 1000,
      points,
      center,
      halfWidthM: radius,
      frontDepthM: radius,
      backDepthM: radius,
    };
  }
  const minX = points.length === 0 ? 0 : Math.min(...points.map((point) => point[0]));
  const maxX = points.length === 0 ? 0 : Math.max(...points.map((point) => point[0]));
  const minZ = points.length === 0 ? 0 : Math.min(...points.map((point) => point[2]));
  const maxZ = points.length === 0 ? 0 : Math.max(...points.map((point) => point[2]));
  return {
    circumferenceMm: lengthM * 1000,
    points,
    // The canonical frame owns the anatomical sagittal/coronal axes. Using
    // the bounding-box midpoint here erased the real front/back asymmetry of
    // breasts and glutes and then fed that artificial centre back into the
    // metric correction. Keep the section anchored to the body axes instead.
    center: [0, spec.point[1], 0],
    halfWidthM: (maxX - minX) * 0.5,
    frontDepthM: Math.max(0, maxZ),
    backDepthM: Math.max(0, -minZ),
  };
}

function trianglePlaneSegment(
  a: HumanBodyVector3,
  b: HumanBodyVector3,
  c: HumanBodyVector3,
  planePoint: HumanBodyVector3,
  planeNormal: HumanBodyVector3,
): readonly [HumanBodyVector3, HumanBodyVector3] | null {
  const vertices = [a, b, c] as const;
  const distances = vertices.map((point) => dot(sub(point, planePoint), planeNormal));
  const intersections: HumanBodyVector3[] = [];
  for (const [first, second] of [[0, 1], [1, 2], [2, 0]] as const) {
    const da = distances[first];
    const db = distances[second];
    if ((da > 1e-9 && db > 1e-9) || (da < -1e-9 && db < -1e-9)) continue;
    if (Math.abs(da - db) <= 1e-12) continue;
    const t = clamp(da / (da - db), 0, 1);
    const point = mixPoint(vertices[first], vertices[second], t);
    if (intersections.every((candidate) => distance(candidate, point) > 1e-8)) intersections.push(point);
  }
  if (intersections.length !== 2) return null;
  return [intersections[0], intersections[1]];
}

function buildCrossSections(
  positions: Float32Array,
  reference: CanonicalReference,
  specs: readonly SectionSpec[],
  stations: BodyStations,
): HumanBodyCrossSection[] {
  const measured = specs.map((spec) => {
    const measured = measureSection(positions, reference, spec);
    return {
      id: spec.id,
      region: spec.region,
      yM: spec.point[1],
      centerM: measured.center,
      normal: spec.normal,
      targetCircumferenceMm: spec.targetMm,
      actualCircumferenceMm: measured.circumferenceMm,
      halfWidthM: measured.halfWidthM,
      frontDepthM: measured.frontDepthM,
      backDepthM: measured.backDepthM,
      centerZM: measured.center[2],
      frontLobeM: spec.mode === "bust" ? Math.max(0, measured.frontDepthM - measured.backDepthM) : 0,
      backLobeM: spec.mode === "hip" ? Math.max(0, measured.backDepthM - measured.frontDepthM) : 0,
      lobeHalfDistanceM: spec.mode === "bust" ? measured.halfWidthM * 0.42 : 0,
    };
  });
  const bust = measured.find((section) => section.id === "bust")!;
  const hip = measured.find((section) => section.id === "full-hip")!;
  return [
    sectionFromNearbyVertices("crotch", "crotch", positions, stations.crotchY, hip, 0.78),
    ...measured,
    sectionFromNearbyVertices("shoulder", "back-upper", positions, stations.shoulderY, bust, 1.08),
  ];
}

function sectionFromNearbyVertices(
  id: string,
  region: HumanBodyRegionId,
  positions: Float32Array,
  yM: number,
  fallback: HumanBodyCrossSection,
  circumferenceScale: number,
): HumanBodyCrossSection {
  const points: HumanBodyVector3[] = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const point = pointAt(positions, vertex);
    if (Math.abs(point[1] - yM) <= 0.012 && Math.abs(point[0]) <= 0.32) points.push(point);
  }
  if (points.length < 4) {
    return { ...fallback, id, region, yM, targetCircumferenceMm: fallback.targetCircumferenceMm * circumferenceScale, actualCircumferenceMm: fallback.actualCircumferenceMm * circumferenceScale };
  }
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minZ = Math.min(...points.map((point) => point[2]));
  const maxZ = Math.max(...points.map((point) => point[2]));
  const halfWidthM = (maxX - minX) * 0.5;
  const halfDepthM = (maxZ - minZ) * 0.5;
  const circumferenceMm = ellipsePerimeter(halfWidthM, halfDepthM) * 1000;
  return {
    id,
    region,
    yM,
    centerM: [(minX + maxX) * 0.5, yM, (minZ + maxZ) * 0.5],
    normal: [0, 1, 0],
    targetCircumferenceMm: circumferenceMm,
    actualCircumferenceMm: circumferenceMm,
    halfWidthM,
    frontDepthM: maxZ - (minZ + maxZ) * 0.5,
    backDepthM: (minZ + maxZ) * 0.5 - minZ,
    centerZM: (minZ + maxZ) * 0.5,
    frontLobeM: 0,
    backLobeM: 0,
    lobeHalfDistanceM: 0,
  };
}

function buildVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const accumulated = new Float64Array(positions.length);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset]; const b = indices[offset + 1]; const c = indices[offset + 2];
    const normal = cross(sub(pointAt(positions, b), pointAt(positions, a)), sub(pointAt(positions, c), pointAt(positions, a)));
    for (const vertex of [a, b, c]) {
      accumulated[vertex * 3] += normal[0];
      accumulated[vertex * 3 + 1] += normal[1];
      accumulated[vertex * 3 + 2] += normal[2];
    }
  }
  const result = new Float32Array(positions.length);
  for (let vertex = 0; vertex < result.length / 3; vertex += 1) {
    result.set(normalize(pointAt(accumulated, vertex)), vertex * 3);
  }
  return result;
}

function buildRegionBindings(
  positions: Float32Array,
  stations: BodyStations,
  limbs: LimbFrame,
  groups: Record<VertexGroup, Float32Array>,
): RegionBinding[] {
  const definitions: Array<[HumanBodyRegionId, (vertex: number, point: HumanBodyVector3) => number]> = [
    ["neck", (_, p) => smoothBand(p[1], stations.neckY, 0.045, 0.09) * groups.torso[_]],
    ["shoulder-left", (v, p) => sideWeight(p[0], -1) * smoothBand(p[1], stations.shoulderY, 0.055, 0.11) * Math.max(groups.torso[v], groups["arm-left"][v])],
    ["shoulder-right", (v, p) => sideWeight(p[0], 1) * smoothBand(p[1], stations.shoulderY, 0.055, 0.11) * Math.max(groups.torso[v], groups["arm-right"][v])],
    ["bust-left", (v, p) => sideWeight(p[0], -1) * frontWeight(p[2]) * smoothBand(p[1], stations.bustY, 0.06, 0.14) * groups.torso[v]],
    ["bust-right", (v, p) => sideWeight(p[0], 1) * frontWeight(p[2]) * smoothBand(p[1], stations.bustY, 0.06, 0.14) * groups.torso[v]],
    ["underbust", (v, p) => smoothBand(p[1], stations.underbustY, 0.05, 0.11) * groups.torso[v]],
    ["ribcage", (v, p) => smoothBand(p[1], lerp(stations.waistY, stations.bustY, 0.68), 0.1, 0.2) * groups.torso[v]],
    ["chest-front", (v, p) => frontWeight(p[2]) * smoothBand(p[1], stations.bustY, 0.12, 0.22) * groups.torso[v]],
    ["back-upper", (v, p) => backWeight(p[2]) * smoothBand(p[1], lerp(stations.bustY, stations.shoulderY, 0.45), 0.15, 0.25) * groups.torso[v]],
    ["waist", (v, p) => smoothBand(p[1], stations.waistY, 0.055, 0.12) * groups.torso[v]],
    ["abdomen", (v, p) => frontWeight(p[2]) * smoothBand(p[1], lerp(stations.waistY, stations.highHipY, 0.5), 0.075, 0.14) * groups.torso[v]],
    ["high-hip", (v, p) => smoothBand(p[1], stations.highHipY, 0.055, 0.12) * groups.torso[v]],
    ["full-hip", (v, p) => smoothBand(p[1], stations.fullHipY, 0.07, 0.14) * groups.torso[v]],
    ["pelvis", (v, p) => smoothBand(p[1], lerp(stations.fullHipY, stations.crotchY, 0.5), 0.09, 0.18) * groups.torso[v]],
    ["pelvis-front", (v, p) => frontWeight(p[2]) * smoothBand(p[1], lerp(stations.fullHipY, stations.crotchY, 0.5), 0.09, 0.18) * groups.torso[v]],
    ["pelvis-back", (v, p) => backWeight(p[2]) * smoothBand(p[1], lerp(stations.fullHipY, stations.crotchY, 0.5), 0.09, 0.18) * groups.torso[v]],
    ["glute-left", (v, p) => sideWeight(p[0], -1) * backWeight(p[2]) * smoothBand(p[1], stations.fullHipY, 0.075, 0.15) * groups.torso[v]],
    ["glute-right", (v, p) => sideWeight(p[0], 1) * backWeight(p[2]) * smoothBand(p[1], stations.fullHipY, 0.075, 0.15) * groups.torso[v]],
    ["crotch", (v, p) => smoothBand(p[1], stations.crotchY, 0.05, 0.11) * Math.max(groups.torso[v], groups["leg-left"][v], groups["leg-right"][v])],
    ...limbRegionDefinitions(groups, stations, limbs),
  ];
  return definitions.map(([id, weightFor]) => sparseRegion(id, positions, weightFor));
}

function limbRegionDefinitions(
  groups: Record<VertexGroup, Float32Array>,
  stations: BodyStations,
  limbs: LimbFrame,
): Array<[HumanBodyRegionId, (vertex: number, point: HumanBodyVector3) => number]> {
  const armStation = (fraction: number) => lerp(limbs.shoulderLeft[1], limbs.wristLeft[1], fraction);
  const legStation = (fraction: number) => lerp(stations.crotchY, stations.ankleY, fraction);
  return [
    ["upper-arm-left", (v, p) => groups["arm-left"][v] * smoothBand(p[1], armStation(0.28), 0.13, 0.24)],
    ["upper-arm-right", (v, p) => groups["arm-right"][v] * smoothBand(p[1], armStation(0.28), 0.13, 0.24)],
    ["forearm-left", (v, p) => groups["arm-left"][v] * smoothBand(p[1], armStation(0.65), 0.13, 0.24)],
    ["forearm-right", (v, p) => groups["arm-right"][v] * smoothBand(p[1], armStation(0.65), 0.13, 0.24)],
    ["wrist-left", (v, p) => groups["arm-left"][v] * smoothBand(p[1], armStation(0.92), 0.07, 0.14)],
    ["wrist-right", (v, p) => groups["arm-right"][v] * smoothBand(p[1], armStation(0.92), 0.07, 0.14)],
    ["thigh-left", (v, p) => groups["leg-left"][v] * smoothBand(p[1], legStation(0.2), 0.13, 0.25)],
    ["thigh-right", (v, p) => groups["leg-right"][v] * smoothBand(p[1], legStation(0.2), 0.13, 0.25)],
    ["knee-left", (v, p) => groups["leg-left"][v] * smoothBand(p[1], stations.kneeY, 0.075, 0.15)],
    ["knee-right", (v, p) => groups["leg-right"][v] * smoothBand(p[1], stations.kneeY, 0.075, 0.15)],
    ["calf-left", (v, p) => groups["leg-left"][v] * smoothBand(p[1], legStation(0.67), 0.1, 0.19)],
    ["calf-right", (v, p) => groups["leg-right"][v] * smoothBand(p[1], legStation(0.67), 0.1, 0.19)],
    ["ankle-left", (v, p) => groups["leg-left"][v] * smoothBand(p[1], stations.ankleY, 0.065, 0.12)],
    ["ankle-right", (v, p) => groups["leg-right"][v] * smoothBand(p[1], stations.ankleY, 0.065, 0.12)],
  ];
}

function sparseRegion(
  id: HumanBodyRegionId,
  positions: Float32Array,
  weightFor: (vertex: number, point: HumanBodyVector3) => number,
): RegionBinding {
  const indices: number[] = [];
  const weights: number[] = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const weight = clamp(weightFor(vertex, pointAt(positions, vertex)), 0, 1);
    if (weight <= 0.005) continue;
    indices.push(vertex);
    weights.push(weight);
  }
  return { id, indices: Uint32Array.from(indices), weights: Float32Array.from(weights) };
}

function dominantRegionIds(vertexCount: number, regions: readonly RegionBinding[]): HumanBodyRegionId[] {
  const ids = new Array<HumanBodyRegionId>(vertexCount).fill("full-hip");
  const weights = new Float32Array(vertexCount);
  for (const region of regions) {
    for (let index = 0; index < region.indices.length; index += 1) {
      const vertex = region.indices[index];
      if (region.weights[index] <= weights[vertex]) continue;
      weights[vertex] = region.weights[index];
      ids[vertex] = region.id;
    }
  }
  return ids;
}

function createLandmarkBindings(
  positions: Float32Array,
  topologySignature: string,
  stations: BodyStations,
  limbs: LimbFrame,
): Record<HumanBodyLandmarkId, HumanBodyLandmarkBinding> {
  const single = (target: HumanBodyVector3, filter?: (point: HumanBodyVector3) => boolean) =>
    binding(topologySignature, [nearestVertex(positions, target, filter)], [1]);
  const station = (target: HumanBodyVector3, filter?: (point: HumanBodyVector3) => boolean) =>
    bindingAtStation(topologySignature, positions, target, filter);
  const paired = (first: HumanBodyVector3, second: HumanBodyVector3) =>
    binding(topologySignature, [nearestVertex(positions, first), nearestVertex(positions, second)], [0.5, 0.5]);
  const pairedStation = (first: HumanBodyVector3, second: HumanBodyVector3) =>
    combineBindings(
      topologySignature,
      [bindingAtStation(topologySignature, positions, first), bindingAtStation(topologySignature, positions, second)],
      [0.5, 0.5],
    );
  const side = (value: number) => (point: HumanBodyVector3) => value < 0 ? point[0] < 0 : point[0] > 0;
  return {
    "ground-center": paired([-0.09, 0, 0.02], [0.09, 0, 0.02]),
    "head-top": single([0, stations.headTopY, 0]),
    "neck-base-center": pairedStation([0, stations.neckY, 0.045], [0, stations.neckY, -0.045]),
    "shoulder-left": station(limbs.shoulderLeft, side(-1)),
    "shoulder-right": station(limbs.shoulderRight, side(1)),
    "bust-apex-left": station([-0.075, stations.bustY, 0.13], side(-1)),
    "bust-apex-right": station([0.075, stations.bustY, 0.13], side(1)),
    "center-front-waist": station([0, stations.waistY, 0.105]),
    "center-back-waist": station([0, stations.waistY, -0.075]),
    "side-waist-left": station([-0.14, stations.waistY, 0], side(-1)),
    "side-waist-right": station([0.14, stations.waistY, 0], side(1)),
    "high-hip": pairedStation([0, stations.highHipY, 0.09], [0, stations.highHipY, -0.1]),
    "high-hip-front": station([0, stations.highHipY, 0.09]),
    "high-hip-back": station([0, stations.highHipY, -0.1]),
    "full-hip": pairedStation([0, stations.fullHipY, 0.09], [0, stations.fullHipY, -0.115]),
    "full-hip-front": station([0, stations.fullHipY, 0.09]),
    "full-hip-back": station([0, stations.fullHipY, -0.115]),
    "glute-left": station([-0.085, stations.fullHipY, -0.115], side(-1)),
    "glute-right": station([0.085, stations.fullHipY, -0.115], side(1)),
    "crotch-front": station([0, stations.crotchY, 0.075]),
    "crotch-back": station([0, stations.crotchY, -0.055]),
    "inseam-top-left": station([-0.035, stations.crotchY, 0], side(-1)),
    "inseam-top-right": station([0.035, stations.crotchY, 0], side(1)),
    "thigh-widest-left": station([-0.17, lerp(stations.crotchY, stations.kneeY, 0.2), 0], side(-1)),
    "thigh-widest-right": station([0.17, lerp(stations.crotchY, stations.kneeY, 0.2), 0], side(1)),
    "knee-left": station(limbs.kneeLeft, side(-1)),
    "knee-right": station(limbs.kneeRight, side(1)),
    "calf-left": station([-0.15, lerp(stations.kneeY, stations.ankleY, 0.48), -0.01], side(-1)),
    "calf-right": station([0.15, lerp(stations.kneeY, stations.ankleY, 0.48), -0.01], side(1)),
    "ankle-left": station(limbs.ankleLeft, side(-1)),
    "ankle-right": station(limbs.ankleRight, side(1)),
    "armhole-left": station([-0.2, stations.shoulderY - 0.055, 0], side(-1)),
    "armhole-right": station([0.2, stations.shoulderY - 0.055, 0], side(1)),
    "elbow-left": station(limbs.elbowLeft, side(-1)),
    "elbow-right": station(limbs.elbowRight, side(1)),
    "wrist-left": station(limbs.wristLeft, side(-1)),
    "wrist-right": station(limbs.wristRight, side(1)),
  };
}

function binding(
  topologySignature: string,
  vertices: readonly number[],
  weights: readonly number[],
): HumanBodyLandmarkBinding {
  return {
    topologySignature,
    vertexIndices: Uint32Array.from(vertices),
    weights: Float32Array.from(weights),
  };
}

function bindingAtStation(
  topologySignature: string,
  positions: Float32Array,
  target: HumanBodyVector3,
  filter: (point: HumanBodyVector3) => boolean = () => true,
): HumanBodyLandmarkBinding {
  let below = -1;
  let above = -1;
  let belowScore = Number.POSITIVE_INFINITY;
  let aboveScore = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const point = pointAt(positions, vertex);
    if (!filter(point)) continue;
    const planar = Math.hypot(point[0] - target[0], point[2] - target[2]);
    const vertical = Math.abs(point[1] - target[1]);
    const score = planar + vertical * 0.2;
    if (point[1] <= target[1] && score < belowScore) { below = vertex; belowScore = score; }
    if (point[1] >= target[1] && score < aboveScore) { above = vertex; aboveScore = score; }
  }
  if (below < 0 || above < 0 || below === above) {
    return binding(topologySignature, [nearestVertex(positions, target, filter)], [1]);
  }
  const belowY = positions[below * 3 + 1];
  const aboveY = positions[above * 3 + 1];
  const upperWeight = clamp((target[1] - belowY) / Math.max(1e-9, aboveY - belowY), 0, 1);
  return binding(topologySignature, [below, above], [1 - upperWeight, upperWeight]);
}

function combineBindings(
  topologySignature: string,
  bindings: readonly HumanBodyLandmarkBinding[],
  bindingWeights: readonly number[],
): HumanBodyLandmarkBinding {
  const vertices: number[] = [];
  const weights: number[] = [];
  for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
    const source = bindings[bindingIndex];
    for (let index = 0; index < source.vertexIndices.length; index += 1) {
      vertices.push(source.vertexIndices[index]);
      weights.push(source.weights[index] * bindingWeights[bindingIndex]);
    }
  }
  return binding(topologySignature, vertices, weights);
}

function nearestVertex(
  positions: Float32Array,
  target: HumanBodyVector3,
  filter: (point: HumanBodyVector3) => boolean = () => true,
): number {
  let selected = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const point = pointAt(positions, vertex);
    if (!filter(point)) continue;
    const score = distance(point, target);
    if (score < best) {
      selected = vertex;
      best = score;
    }
  }
  return selected;
}

function resolveLandmarks(
  reference: CanonicalReference,
  positions: Float32Array,
  normals: Float32Array,
): Record<HumanBodyLandmarkId, HumanBodyLandmark> {
  return Object.fromEntries(
    (Object.entries(reference.landmarkBindings) as Array<[HumanBodyLandmarkId, HumanBodyLandmarkBinding]>)
      .map(([id, landmarkBinding]) => [id, {
        id,
        position: evaluateBinding(positions, landmarkBinding),
        normal: normalize(evaluateBinding(normals, landmarkBinding)),
        binding: landmarkBinding,
      }]),
  ) as Record<HumanBodyLandmarkId, HumanBodyLandmark>;
}

function evaluateBinding(values: Float32Array, landmark: HumanBodyLandmarkBinding): HumanBodyVector3 {
  const result: HumanBodyVector3 = [0, 0, 0];
  for (let index = 0; index < landmark.vertexIndices.length; index += 1) {
    const point = pointAt(values, landmark.vertexIndices[index]);
    result[0] += point[0] * landmark.weights[index];
    result[1] += point[1] * landmark.weights[index];
    result[2] += point[2] * landmark.weights[index];
  }
  return result;
}

function buildJoints(frame: LimbFrame): Record<string, HumanBodyJoint> {
  return Object.fromEntries(Object.entries({
    "shoulder-left": frame.shoulderLeft,
    "shoulder-right": frame.shoulderRight,
    "elbow-left": frame.elbowLeft,
    "elbow-right": frame.elbowRight,
    "wrist-left": frame.wristLeft,
    "wrist-right": frame.wristRight,
    "hip-left": frame.hipLeft,
    "hip-right": frame.hipRight,
    "knee-left": frame.kneeLeft,
    "knee-right": frame.kneeRight,
    "ankle-left": frame.ankleLeft,
    "ankle-right": frame.ankleRight,
  }).map(([id, position]) => [id, { id, position }])) as Record<string, HumanBodyJoint>;
}

function buildDiagnostics(
  measurements: HumanBodyMeasurements,
  reference: CanonicalReference,
  visual: HumanBodyMesh,
  collision: HumanBodyMesh,
  sections: readonly HumanBodyCrossSection[],
  landmarks: Record<HumanBodyLandmarkId, HumanBodyLandmark>,
  iterations: number,
  restPositions: Float32Array,
  preMetricPosedPositions: Float32Array,
  restLimbs: LimbFrame,
): HumanBodyDiagnostics {
  const grouped = new Map<string, number[]>();
  for (const section of sections) {
    if (section.id === "crotch" || section.id === "shoulder") continue;
    const errors = grouped.get(sectionDiagnosticKey(section.id)) ?? [];
    errors.push(section.actualCircumferenceMm - section.targetCircumferenceMm);
    grouped.set(sectionDiagnosticKey(section.id), errors);
  }
  const measurementErrorsMm: Record<string, number> = Object.fromEntries(
    [...grouped].map(([id, errors]) => [id, errors.reduce((sum, error) => sum + error, 0) / errors.length]),
  );
  measurementErrorsMm.height = visual.bounds.max[1] * 1000 - measurements.heightMm;
  const restBustApex = evaluateBinding(restPositions, reference.landmarkBindings["bust-apex-left"]);
  measurementErrorsMm.shoulderWidth = distance(restLimbs.shoulderLeft, restLimbs.shoulderRight) * 1000
    - measurements.shoulderWidthMm;
  const shoulderToBustVerticalM = restLimbs.shoulderLeft[1] - restBustApex[1];
  const waistToHipVerticalM = landmarks["center-front-waist"].position[1] - landmarks["full-hip-front"].position[1];
  // These catalog values are tape/surface dimensions. Convert the calibrated
  // vertical station delta back to that semantic space instead of comparing a
  // straight Y distance directly with a body-surface measurement.
  measurementErrorsMm.shoulderToBust = shoulderToBustVerticalM * 1000 * (0.157 / (0.824 - 0.735))
    - measurements.shoulderToBustMm;
  measurementErrorsMm.waistToHip = waistToHipVerticalM * 1000 * (0.115 / (0.601 - 0.505))
    - measurements.waistToHipMm;
  measurementErrorsMm.crotchDepth = (landmarks["center-front-waist"].position[1] - landmarks["inseam-top-left"].position[1]) * 1000 - measurements.crotchDepthMm;
  measurementErrorsMm.armLength = distance(restLimbs.shoulderLeft, restLimbs.wristLeft) * 1000
    - measurements.armLengthMm;
  measurementErrorsMm.inseam = landmarks["inseam-top-left"].position[1] * 1000 - measurements.inseamMm;
  measurementErrorsMm.outseam = landmarks["center-front-waist"].position[1] * 1000 - measurements.outseamMm;
  const preMetricNormals = triangleNormals(preMetricPosedPositions, reference.indices);
  const visualDiagnostics = inspectMesh(visual, preMetricNormals);
  const collisionDiagnostics = inspectMesh(collision, preMetricNormals);
  const lodSectionDeltaMm = Object.fromEntries(sections.map((section) => [section.id, 0]));
  const identityDeformation = inspectCanonicalIdentityDeformation();
  const deformationByRegion = Object.fromEntries(reference.regionBindings.map((region) => [
    region.id,
    displacementStatistics(reference.sourcePositions, restPositions, region.indices),
  ]));
  return {
    asset: canonicalFemaleMesh().audit,
    visual: visualDiagnostics,
    collision: collisionDiagnostics,
    measurementErrorsMm,
    lodSectionDeltaMm,
    maxLodSectionDeltaMm: 0,
    landmarkToleranceMm: 4,
    circumferenceToleranceMm: CIRCUMFERENCE_TOLERANCE_MM,
    lengthToleranceMm: LENGTH_TOLERANCE_MM,
    topologyInvariant: visual.topologySignature === reference.topologySignature,
    visualCollisionTopologyParity: visual.topologySignature === collision.topologySignature
      && visual.indices === collision.indices,
    metricCorrectionIterations: iterations,
    identityDeformation,
    deformationByRegion,
    meshQuality: inspectShapeQuality(preMetricPosedPositions, visual.positions, reference.indices),
  };
}

let identityDisplacementCache: HumanBodyDisplacementStatistics | null = null;

export function inspectCanonicalIdentityDeformation(): HumanBodyDisplacementStatistics {
  if (identityDisplacementCache !== null) return identityDisplacementCache;
  const reference = canonicalReference();
  const native = canonicalNativeMeasurements(reference);
  const stations = targetStationsFor(native);
  const limbs = targetLimbFrame(native, stations);
  const result = createInitialDeformation(reference, native, stations, limbs);
  const specs = buildSectionSpecs(native, stations, limbs);
  correctMetricSections(result, reference, specs, DEFAULT_METRIC_ITERATIONS, limbs);
  identityDisplacementCache = displacementStatistics(reference.sourcePositions, result);
  return identityDisplacementCache;
}

export function inspectCanonicalPoseIsolation(): HumanBodyDisplacementStatistics {
  const reference = canonicalReference();
  const posed = poseCanonicalArms(reference.sourcePositions, reference.groupWeights, reference.limbs);
  const restored = unposeCanonicalArms(posed, reference.groupWeights, reference.limbs);
  return displacementStatistics(reference.sourcePositions, restored);
}

function unposeCanonicalArms(
  source: Float32Array,
  groups: Record<VertexGroup, Float32Array>,
  limbs: LimbFrame,
): Float32Array {
  const result = new Float32Array(source);
  for (let vertex = 0; vertex < source.length / 3; vertex += 1) {
    const x = source[vertex * 3]; const y = source[vertex * 3 + 1]; const z = source[vertex * 3 + 2];
    const side = x < 0 ? -1 : 1;
    const weight = side < 0 ? groups["pose-arm-left"][vertex] : groups["pose-arm-right"][vertex];
    if (weight <= 0) continue;
    const acromion = side < 0 ? limbs.shoulderLeft : limbs.shoulderRight;
    const direction = side < 0 ? 1 : -1;
    const claviclePivot: HumanBodyVector3 = [acromion[0] * 0.28, acromion[1], z];
    const clavicleAngle = direction * 6 * Math.PI / 180 * weight;
    const childWeight = smoothstep01((weight - 0.35) / 0.65);
    const posedHumeralPivot = rotatePointAroundZ(
      [acromion[0] * 0.82, acromion[1], z],
      claviclePivot,
      clavicleAngle,
    );
    const afterUpperArm = rotatePointAroundZ(
      [x, y, z],
      posedHumeralPivot,
      -direction * 62 * Math.PI / 180 * childWeight,
    );
    result.set(
      rotatePointAroundZ(afterUpperArm, claviclePivot, -clavicleAngle),
      vertex * 3,
    );
  }
  return result;
}

export function canonicalFemaleNativeMeasurements(): HumanBodyMeasurements {
  return { ...canonicalNativeMeasurements(canonicalReference()) };
}

function canonicalNativeMeasurements(reference: CanonicalReference): HumanBodyMeasurements {
  if (nativeMeasurementCache !== null) return nativeMeasurementCache;
  const placeholder: HumanBodyMeasurements = {
    heightMm: reference.stations.headTopY * 1000,
    shoulderWidthMm: distance(reference.limbs.shoulderLeft, reference.limbs.shoulderRight) * 1000,
    neckCircumferenceMm: 340,
    bustMm: 940,
    underbustMm: 720,
    waistMm: 750,
    highHipMm: 930,
    fullHipMm: 1120,
    torsoLengthMm: reference.stations.headTopY * 1000 * 0.262,
    shoulderToBustMm: reference.stations.headTopY * 1000 * 0.157,
    bustPointDistanceMm: 150,
    waistToHipMm: reference.stations.headTopY * 1000 * 0.115,
    hipToCrotchMm: reference.stations.headTopY * 1000 * (0.155 - 0.115),
    crotchDepthMm: reference.stations.headTopY * 1000 * 0.155,
    thighMm: 490,
    kneeMm: 325,
    calfMm: 293,
    ankleMm: 231,
    bicepMm: 224,
    elbowMm: 174,
    wristMm: 170,
    armLengthMm: distance(reference.limbs.shoulderLeft, reference.limbs.wristLeft) * 1000,
    inseamMm: reference.stations.crotchY * 1000,
    outseamMm: reference.stations.waistY * 1000,
    headCircumferenceMm: 570,
  };
  const specs = buildSectionSpecs(placeholder, reference.stations, reference.limbs);
  const measured = Object.fromEntries(specs.map((spec) => [spec.id, measureSection(
    reference.sourcePositions,
    reference,
    spec,
  ).circumferenceMm]));
  nativeMeasurementCache = {
    ...placeholder,
    bustMm: measured.bust,
    underbustMm: measured.underbust,
    waistMm: measured.waist,
    highHipMm: measured["high-hip"],
    fullHipMm: measured["full-hip"],
    thighMm: (measured["thigh-left"] + measured["thigh-right"]) * 0.5,
    kneeMm: (measured["knee-left"] + measured["knee-right"]) * 0.5,
    calfMm: (measured["calf-left"] + measured["calf-right"]) * 0.5,
    ankleMm: (measured["ankle-left"] + measured["ankle-right"]) * 0.5,
    bicepMm: (measured["upper-arm-left"] + measured["upper-arm-right"]) * 0.5,
    elbowMm: (measured["elbow-left"] + measured["elbow-right"]) * 0.5,
    wristMm: (measured["wrist-left"] + measured["wrist-right"]) * 0.5,
  };
  return nativeMeasurementCache;
}

function displacementStatistics(
  source: Float32Array,
  target: Float32Array,
  subset?: Uint32Array,
): HumanBodyDisplacementStatistics {
  const values: number[] = [];
  if (subset) {
    for (const vertex of subset) values.push(distance(pointAt(source, vertex), pointAt(target, vertex)) * 1000);
  } else {
    for (let vertex = 0; vertex < source.length / 3; vertex += 1) {
      values.push(distance(pointAt(source, vertex), pointAt(target, vertex)) * 1000);
    }
  }
  values.sort((a, b) => a - b);
  const meanMm = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const squareMean = values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length);
  return {
    meanMm,
    rmsMm: Math.sqrt(squareMean),
    percentile95Mm: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0,
    maxMm: values.at(-1) ?? 0,
  };
}

function inspectShapeQuality(
  referencePositions: Float32Array,
  positions: Float32Array,
  indices: Uint32Array,
): HumanBodyShapeQualityDiagnostics {
  let maximumEdgeStretchRatio = 1;
  let maximumAreaRatio = 1;
  let maximumNormalChangeDegrees = 0;
  const seenEdges = new Set<string>();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]] as const;
    const referenceNormal = cross(
      sub(pointAt(referencePositions, triangle[1]), pointAt(referencePositions, triangle[0])),
      sub(pointAt(referencePositions, triangle[2]), pointAt(referencePositions, triangle[0])),
    );
    const normal = cross(
      sub(pointAt(positions, triangle[1]), pointAt(positions, triangle[0])),
      sub(pointAt(positions, triangle[2]), pointAt(positions, triangle[0])),
    );
    const referenceArea = magnitude(referenceNormal) * 0.5;
    const area = magnitude(normal) * 0.5;
    if (referenceArea > 1e-12 && area > 1e-12) {
      maximumAreaRatio = Math.max(maximumAreaRatio, area / referenceArea, referenceArea / area);
      const cosine = clamp(dot(normalize(referenceNormal), normalize(normal)), -1, 1);
      maximumNormalChangeDegrees = Math.max(maximumNormalChangeDegrees, Math.acos(cosine) * 180 / Math.PI);
    }
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as const) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const before = distance(pointAt(referencePositions, a), pointAt(referencePositions, b));
      const after = distance(pointAt(positions, a), pointAt(positions, b));
      if (before > 1e-12 && after > 1e-12) {
        maximumEdgeStretchRatio = Math.max(maximumEdgeStretchRatio, after / before, before / after);
      }
    }
  }
  return { maximumEdgeStretchRatio, maximumAreaRatio, maximumNormalChangeDegrees };
}

function sectionDiagnosticKey(id: string): string {
  return id.replace(/-(left|right)$/u, "").replace("upper-arm", "bicep");
}

export function inspectHumanBodyMesh(mesh: HumanBodyMesh): HumanBodyMeshDiagnostics {
  return inspectMesh(mesh);
}

function inspectMesh(mesh: HumanBodyMesh, referenceNormals?: Float32Array): HumanBodyMeshDiagnostics {
  const edges = new Map<string, number>();
  let degenerateTriangleCount = 0;
  let invertedTriangleCount = 0;
  const directedEdges = new Map<string, number>();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]] as const;
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as const) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      directedEdges.set(key, (directedEdges.get(key) ?? 0) + (a < b ? 1 : -1));
    }
    const face = cross(
      sub(pointAt(mesh.positions, triangle[1]), pointAt(mesh.positions, triangle[0])),
      sub(pointAt(mesh.positions, triangle[2]), pointAt(mesh.positions, triangle[0])),
    );
    if (magnitude(face) <= 1e-12) degenerateTriangleCount += 1;
    const faceNormal = normalize(face);
    if (referenceNormals) {
      const reference = pointAt(referenceNormals, offset / 3);
      if (dot(faceNormal, reference) < -0.2) invertedTriangleCount += 1;
    }
  }
  return {
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    finite: [...mesh.positions, ...mesh.normals].every(Number.isFinite),
    boundaryEdgeCount: [...edges.values()].filter((count) => count === 1).length,
    nonManifoldEdgeCount: [...edges.values()].filter((count) => count > 2).length,
    degenerateTriangleCount,
    invertedTriangleCount,
    signedVolumeM3: signedVolume(mesh.positions, mesh.indices),
    normalsConsistent: [...directedEdges.values()].every((balance) => balance === 0),
    topologySignature: mesh.topologySignature,
  };
}

export function measureHumanBodyMeshCircumferenceAtY(mesh: HumanBodyMesh, yM: number): number {
  const reference = canonicalReference();
  return measureSection(mesh.positions, reference, {
    id: "horizontal",
    diagnosticId: "horizontal",
    region: "waist",
    targetMm: 1000,
    point: [0, yM, 0],
    normal: [0, 1, 0],
    group: "torso",
    influenceM: 0.1,
    mode: "torso",
  }).circumferenceMm;
}

function triangleNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const result = new Float32Array(indices.length);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const normal = normalize(cross(
      sub(pointAt(positions, indices[offset + 1]), pointAt(positions, indices[offset])),
      sub(pointAt(positions, indices[offset + 2]), pointAt(positions, indices[offset])),
    ));
    result.set(normal, offset);
  }
  return result;
}

function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let result = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = pointAt(positions, indices[offset]);
    const b = pointAt(positions, indices[offset + 1]);
    const c = pointAt(positions, indices[offset + 2]);
    result += dot(a, cross(b, c));
  }
  return result / 6;
}

function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) * (a - b)) / Math.max(1e-12, (a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(Math.max(1e-12, 4 - 3 * h))));
}

function computeBounds(positions: Float32Array): HumanBodyMesh["bounds"] {
  const min: HumanBodyVector3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: HumanBodyVector3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis]);
      max[axis] = Math.max(max[axis], positions[offset + axis]);
    }
  }
  return { min, max };
}

function piecewiseMap(value: number, source: readonly number[], target: readonly number[]): number {
  if (value <= source[0]) return target[0] + value - source[0];
  for (let index = 1; index < source.length; index += 1) {
    if (value > source[index]) continue;
    const t = (value - source[index - 1]) / Math.max(1e-9, source[index] - source[index - 1]);
    return lerp(target[index - 1], target[index], t);
  }
  return target[target.length - 1] + value - source[source.length - 1];
}

function rotateFromTo(
  vector: HumanBodyVector3,
  from: HumanBodyVector3,
  to: HumanBodyVector3,
): HumanBodyVector3 {
  const axis = cross(from, to);
  const sine = magnitude(axis);
  const cosine = clamp(dot(from, to), -1, 1);
  if (sine <= 1e-9) return cosine >= 0 ? vector : scale(vector, -1);
  const unit = scale(axis, 1 / sine);
  return add(
    add(scale(vector, cosine), scale(cross(unit, vector), sine)),
    scale(unit, dot(unit, vector) * (1 - cosine)),
  );
}

function pointAt(values: ArrayLike<number>, vertex: number): HumanBodyVector3 {
  return [values[vertex * 3], values[vertex * 3 + 1], values[vertex * 3 + 2]];
}

function centroid(points: readonly HumanBodyVector3[]): HumanBodyVector3 {
  const result: HumanBodyVector3 = [0, 0, 0];
  for (const point of points) {
    result[0] += point[0]; result[1] += point[1]; result[2] += point[2];
  }
  return scale(result, 1 / Math.max(1, points.length));
}

function smoothBand(value: number, center: number, fullRadius: number, outerRadius: number): number {
  const distance = Math.abs(value - center);
  if (distance <= fullRadius) return 1;
  if (distance >= outerRadius) return 0;
  return 1 - smoothstep01((distance - fullRadius) / Math.max(1e-9, outerRadius - fullRadius));
}

function smoothRange(value: number, start: number, end: number): number {
  return smoothstep01((value - start) / Math.max(1e-9, end - start));
}

function smoothFalloff(value: number): number {
  return value >= 1 ? 0 : 1 - smoothstep01(value);
}

function sideWeight(x: number, side: -1 | 1): number {
  return smoothstep01((side * x + 0.025) / 0.08);
}

function frontWeight(z: number): number { return smoothstep01((z + 0.045) / 0.11); }
function backWeight(z: number): number { return smoothstep01((-z + 0.045) / 0.11); }
function smoothstep01(value: number): number { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function toleranceFor(targetMm: number): number { return Math.max(CIRCUMFERENCE_TOLERANCE_MM, targetMm * 0.01); }
function positive(value: number | undefined, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function clampInt(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, Math.round(value))); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function add(a: HumanBodyVector3, b: HumanBodyVector3): HumanBodyVector3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: HumanBodyVector3, b: HumanBodyVector3): HumanBodyVector3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: HumanBodyVector3, value: number): HumanBodyVector3 { return [a[0] * value, a[1] * value, a[2] * value]; }
function dot(a: HumanBodyVector3, b: HumanBodyVector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: HumanBodyVector3, b: HumanBodyVector3): HumanBodyVector3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function magnitude(a: HumanBodyVector3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: HumanBodyVector3): HumanBodyVector3 { const length = magnitude(a); return length <= 1e-12 ? [0, 1, 0] : scale(a, 1 / length); }
function distance(a: HumanBodyVector3, b: HumanBodyVector3): number { return magnitude(sub(a, b)); }
function mixPoint(a: HumanBodyVector3, b: HumanBodyVector3, t: number): HumanBodyVector3 { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function addScaled(a: HumanBodyVector3, b: HumanBodyVector3, value: number): HumanBodyVector3 { return [a[0] + b[0] * value, a[1] + b[1] * value, a[2] + b[2] * value]; }
