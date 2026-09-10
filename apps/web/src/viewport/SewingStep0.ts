import * as THREE from "three";
import { closestBodySurfacePoint, type BodySurfaceFrame } from "../avatar/BodySurfaceQuery";
import type { HumanBodyCrossSection, HumanBodyMesh } from "../avatar/HumanBodyModel";
import type { AssemblyDistanceConstraint, AssemblyStitchConstraint, GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";
import { connectedSewingInstanceIds } from "./SewingInteraction";

export type SewingStep0Status =
  | "applied"
  | "no-seams"
  | "needs-placement"
  | "too-far"
  | "insufficient-body-circumference"
  | "stale"
  | "failed";

export interface SewingStep0RunResult {
  status: SewingStep0Status;
  affectedPanels: number;
  conformedPanels?: number;
  maximumCentroidDisplacementMm?: number;
  metricDistortionMax?: number;
  seamResidualMaxMm?: number;
  warning?: string;
}

export interface SewingStep0Target {
  rootInstanceId: string;
  instanceIds: string[];
}

export interface SewingStep0BodyFit {
  status: "not-applicable" | "fits" | "insufficient-circumference";
  bodySectionId: string | null;
  materialCircumferenceMm: number | null;
  requiredCircumferenceMm: number | null;
  targetCircumferenceMm: number | null;
  stretchRequiredPercent: number | null;
  maximumAllowedStretchPercent: number;
  clearanceMm: number;
}

const STEP0_MAXIMUM_MATERIAL_STRETCH_PERCENT = 2;

/**
 * Quantitative preflight for a one-panel self seam. The material circumference
 * comes from the canonical/rest chart, never from the already-closed 3D seam.
 * This prevents a tiny loop from being accepted merely because it can close in
 * empty space.
 */
export function analyzeSewingStep0BodyFit(
  state: GarmentAssemblyState,
  target: SewingStep0Target,
  section: HumanBodyCrossSection | null,
  clearanceM = 0.0005,
): SewingStep0BodyFit {
  const base: SewingStep0BodyFit = {
    status: "not-applicable",
    bodySectionId: section?.id ?? null,
    materialCircumferenceMm: null,
    requiredCircumferenceMm: null,
    targetCircumferenceMm: section?.targetCircumferenceMm ?? null,
    stretchRequiredPercent: null,
    maximumAllowedStretchPercent: STEP0_MAXIMUM_MATERIAL_STRETCH_PERCENT,
    clearanceMm: clearanceM * 1_000,
  };
  if (!section || target.instanceIds.length !== 1) return base;
  const instanceId = target.instanceIds[0];
  const selfSeams = physicalSelfSeamConstraints(state, instanceId);
  if (selfSeams.length < 2) return base;
  const materialCircumferenceMm = estimateSelfSeamMaterialCircumferenceMm(state, instanceId, selfSeams);
  if (!Number.isFinite(materialCircumferenceMm) || materialCircumferenceMm <= 1) return base;
  const requiredCircumferenceMm = section.actualCircumferenceMm + Math.PI * 2 * clearanceM * 1_000;
  const stretchRequiredPercent = Math.max(0, requiredCircumferenceMm / materialCircumferenceMm - 1) * 100;
  return {
    ...base,
    status: stretchRequiredPercent > STEP0_MAXIMUM_MATERIAL_STRETCH_PERCENT
      ? "insufficient-circumference"
      : "fits",
    materialCircumferenceMm,
    requiredCircumferenceMm,
    stretchRequiredPercent,
  };
}

export interface SewingStep0Registration {
  rotation: THREE.Quaternion;
  solvedRootCentroid: THREE.Vector3;
  currentRootCentroid: THREE.Vector3;
  solvedRootOrigin: THREE.Vector3;
  currentRootOrigin: THREE.Vector3;
}

export function resolveSewingStep0Target(
  constraints: readonly Pick<AssemblyStitchConstraint, "instanceA" | "instanceB" | "seamGroupId" | "seamId">[],
  selectedSeamId: string | null,
  selectedInstanceIds: readonly string[],
): SewingStep0Target | null {
  const physical = constraints.filter((constraint) =>
    Boolean(constraint.instanceA)
    && Boolean(constraint.instanceB)
    && !constraint.seamGroupId.startsWith("dart:"),
  );
  if (physical.length === 0) return null;

  let root: string | undefined;
  if (selectedSeamId) {
    const selected = physical.find((constraint) => constraint.seamId === selectedSeamId);
    if (!selected) return null;
    root = selected.instanceA;
  }
  if (!root) {
    const participating = new Set(physical.flatMap((constraint) => [constraint.instanceA!, constraint.instanceB!]));
    root = selectedInstanceIds.find((id) => participating.has(id)) ?? physical[0].instanceA;
  }
  if (!root) return null;

  const participating = new Set(physical.flatMap((constraint) => [constraint.instanceA!, constraint.instanceB!]));
  const instanceIds = connectedSewingInstanceIds(physical, root)
    .filter((id) => participating.has(id));
  if (instanceIds.length === 0) return null;
  return { rootInstanceId: root, instanceIds };
}

export function meshWorldCentroid(mesh: THREE.Mesh): THREE.Vector3 {
  const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  mesh.updateMatrixWorld(true);
  const centroid = new THREE.Vector3();
  const point = new THREE.Vector3();
  if (positions.count === 0) return centroid;
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    centroid.add(point);
  }
  return centroid.multiplyScalar(1 / positions.count);
}

export function buildSewingStep0Registration(
  solvedRootPositions: Float32Array,
  currentRootWorldPositions: Float32Array,
  triangles: Uint16Array | Uint32Array,
  materialAnchorVertex?: number,
): SewingStep0Registration | null {
  if (solvedRootPositions.length !== currentRootWorldPositions.length || solvedRootPositions.length < 9) return null;
  const solvedFrame = firstStableTriangleFrame(solvedRootPositions, triangles, materialAnchorVertex);
  const currentFrame = firstStableTriangleFrame(currentRootWorldPositions, triangles, materialAnchorVertex);
  if (!solvedFrame || !currentFrame) return null;

  const solvedBasis = new THREE.Matrix4().makeBasis(solvedFrame.x, solvedFrame.y, solvedFrame.z);
  const currentBasis = new THREE.Matrix4().makeBasis(currentFrame.x, currentFrame.y, currentFrame.z);
  const solvedQuaternion = new THREE.Quaternion().setFromRotationMatrix(solvedBasis);
  const currentQuaternion = new THREE.Quaternion().setFromRotationMatrix(currentBasis);
  const rotation = currentQuaternion.multiply(solvedQuaternion.invert()).normalize();
  const solvedRootCentroid = centroidOfPositions(solvedRootPositions);
  const currentRootCentroid = centroidOfPositions(currentRootWorldPositions);
  const validAnchor = materialAnchorVertex !== undefined
    && materialAnchorVertex >= 0
    && materialAnchorVertex * 3 + 2 < solvedRootPositions.length;
  const solvedRootOrigin = solvedRootCentroid.clone();
  const currentRootOrigin = currentRootCentroid.clone();
  if (validAnchor) {
    readPoint(solvedRootPositions, materialAnchorVertex, solvedRootOrigin);
    readPoint(currentRootWorldPositions, materialAnchorVertex, currentRootOrigin);
  }
  return {
    rotation,
    solvedRootCentroid,
    currentRootCentroid,
    solvedRootOrigin,
    currentRootOrigin,
  };
}

export function transformSewingStep0Point(
  point: THREE.Vector3,
  registration: SewingStep0Registration,
): THREE.Vector3 {
  return point
    .clone()
    .sub(registration.solvedRootOrigin)
    .applyQuaternion(registration.rotation)
    .add(registration.currentRootOrigin);
}

export interface SewingStep0SolvedComponentOptions {
  maximumCentroidDisplacementM?: number;
  bodySection?: HumanBodyCrossSection | null;
  rootSurface?: BodySurfaceFrame | null;
  bodyClearanceM?: number;
  bodyFit?: SewingStep0BodyFit | null;
}

export function applySewingStep0SolvedComponent(
  currentState: GarmentAssemblyState,
  solvedState: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  target: SewingStep0Target,
  optionsOrMaximum: SewingStep0SolvedComponentOptions | number = 0.45,
): {
  appliedIds: string[];
  maximumCentroidDisplacementM: number;
  registrationMode: "body-aware-self-seam" | "authored-rigid";
  bodyFit: SewingStep0BodyFit | null;
} | null {
  const options: SewingStep0SolvedComponentOptions = typeof optionsOrMaximum === "number"
    ? { maximumCentroidDisplacementM: optionsOrMaximum }
    : optionsOrMaximum;
  const maximumCentroidDisplacementM = options.maximumCentroidDisplacementM ?? 0.45;
  const currentRootMesh = meshes.find((item) => item.key === target.rootInstanceId);
  const solvedRoot = solvedState.instances.find((instance) => instance.id === target.rootInstanceId);
  if (!currentRootMesh || !solvedRoot) return null;
  const solvedRootPositions = sliceInstancePositions(solvedState, solvedRoot.id);
  const currentRootWorldPositions = worldPositions(currentRootMesh.mesh);
  if (!solvedRootPositions) return null;

  const bodyAware = options.bodySection
    && options.rootSurface
    && options.bodyFit?.status === "fits"
    && target.instanceIds.length === 1
    ? buildBodyAwareSelfSeamWorldPositions(
      solvedState,
      solvedRoot,
      currentRootWorldPositions,
      options.bodySection,
      options.rootSurface,
      options.bodyFit,
      options.bodyClearanceM ?? 0.0005,
    )
    : null;

  if (bodyAware) {
    currentRootMesh.mesh.updateMatrixWorld(true);
    const inverseCurrentWorld = currentRootMesh.mesh.matrixWorld.clone().invert();
    const local = new Float32Array(bodyAware.length);
    const point = new THREE.Vector3();
    for (let offset = 0; offset < bodyAware.length; offset += 3) {
      point.set(bodyAware[offset], bodyAware[offset + 1], bodyAware[offset + 2]).applyMatrix4(inverseCurrentWorld);
      local[offset] = point.x;
      local[offset + 1] = point.y;
      local[offset + 2] = point.z;
    }
    const currentCentroid = meshWorldCentroid(currentRootMesh.mesh);
    const nextCentroid = centroidOfPositions(bodyAware);
    const displacement = currentCentroid.distanceTo(nextCentroid);
    if (!Number.isFinite(displacement) || displacement > maximumCentroidDisplacementM) return null;
    if (![...local].every(Number.isFinite)) return null;
    writeInstancePositions(currentState, solvedRoot.id, local);
    return {
      appliedIds: [solvedRoot.id],
      maximumCentroidDisplacementM: displacement,
      registrationMode: "body-aware-self-seam",
      bodyFit: options.bodyFit ?? null,
    };
  }

  const registration = buildSewingStep0Registration(
    solvedRootPositions,
    currentRootWorldPositions,
    solvedRoot.topology.triangles,
    meshWorldMaterialAnchor(currentRootMesh.mesh).vertexIndex,
  );
  if (!registration) return null;

  const pending = new Map<string, Float32Array>();
  let maximumDisplacement = 0;
  for (const id of target.instanceIds) {
    const currentInstance = currentState.instances.find((instance) => instance.id === id);
    const solvedInstance = solvedState.instances.find((instance) => instance.id === id);
    const meshData = meshes.find((item) => item.key === id);
    if (!currentInstance || !solvedInstance || !meshData) return null;
    if (currentInstance.vertexCount !== solvedInstance.vertexCount || currentInstance.vertexCount <= 0) return null;
    const solved = sliceInstancePositions(solvedState, id);
    if (!solved || solved.length !== currentInstance.vertexCount * 3) return null;

    meshData.mesh.updateMatrixWorld(true);
    const inverseCurrentWorld = meshData.mesh.matrixWorld.clone().invert();
    const local = new Float32Array(solved.length);
    const transformedWorld = new Float32Array(solved.length);
    const point = new THREE.Vector3();
    for (let offset = 0; offset < solved.length; offset += 3) {
      point.set(solved[offset], solved[offset + 1], solved[offset + 2]);
      const world = transformSewingStep0Point(point, registration);
      transformedWorld[offset] = world.x;
      transformedWorld[offset + 1] = world.y;
      transformedWorld[offset + 2] = world.z;
      world.applyMatrix4(inverseCurrentWorld);
      local[offset] = world.x;
      local[offset + 1] = world.y;
      local[offset + 2] = world.z;
    }

    const currentCentroid = meshWorldCentroid(meshData.mesh);
    const nextCentroid = centroidOfPositions(transformedWorld);
    const displacement = currentCentroid.distanceTo(nextCentroid);
    maximumDisplacement = Math.max(maximumDisplacement, displacement);
    if (!Number.isFinite(displacement) || displacement > maximumCentroidDisplacementM) return null;
    if (![...local].every(Number.isFinite)) return null;
    pending.set(id, local);
  }

  for (const [id, local] of pending) writeInstancePositions(currentState, id, local);
  return {
    appliedIds: [...pending.keys()],
    maximumCentroidDisplacementM: maximumDisplacement,
    registrationMode: "authored-rigid",
    bodyFit: options.bodyFit ?? null,
  };
}

function physicalSelfSeamConstraints(
  state: GarmentAssemblyState,
  instanceId: string,
): AssemblyStitchConstraint[] {
  return state.stitchConstraints.filter((constraint) =>
    !constraint.seamGroupId.startsWith("dart:")
    && constraint.instanceA === instanceId
    && constraint.instanceB === instanceId,
  );
}

function estimateSelfSeamMaterialCircumferenceMm(
  state: GarmentAssemblyState,
  instanceId: string,
  seams: readonly AssemblyStitchConstraint[],
): number {
  const instance = state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) return Number.NaN;
  const distancesMm: number[] = [];
  for (const seam of seams) {
    const a = weightedMaterialPoint2D(instance, seam.a);
    const b = weightedMaterialPoint2D(instance, seam.b);
    if (!a || !b) continue;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (Number.isFinite(distance) && distance > 1) distancesMm.push(distance);
  }
  if (distancesMm.length > 0) {
    distancesMm.sort((a, b) => a - b);
    return distancesMm[Math.floor(distancesMm.length / 2)];
  }
  const radiusM = instance.arrangement?.tubeRadiusM;
  return radiusM && radiusM > 0 ? radiusM * Math.PI * 2 * 1_000 : Number.NaN;
}

function weightedMaterialPoint2D(
  instance: GarmentAssemblyState["instances"][number],
  reference: AssemblyStitchConstraint["a"],
): THREE.Vector2 | null {
  const material = instance.topology.positions2DMm;
  if (!material || reference.particleIndices.length === 0) return null;
  const result = new THREE.Vector2();
  let total = 0;
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const local = reference.particleIndices[index] - instance.particleStart;
    const weight = reference.weights[index] ?? 0;
    if (local < 0 || local * 2 + 1 >= material.length) return null;
    result.x += material[local * 2] * weight;
    result.y += material[local * 2 + 1] * weight;
    total += weight;
  }
  if (Math.abs(total) <= 1e-9) return null;
  if (Math.abs(total - 1) > 1e-9) result.multiplyScalar(1 / total);
  return result;
}

function buildBodyAwareSelfSeamWorldPositions(
  solvedState: GarmentAssemblyState,
  instance: GarmentAssemblyState["instances"][number],
  currentWorld: Float32Array,
  section: HumanBodyCrossSection,
  rootSurface: BodySurfaceFrame,
  fit: SewingStep0BodyFit,
  clearanceM: number,
): Float32Array | null {
  const materialCircumferenceM = (fit.materialCircumferenceMm ?? 0) * 0.001;
  const requiredCircumferenceM = (fit.requiredCircumferenceMm ?? 0) * 0.001;
  if (materialCircumferenceM <= 0 || requiredCircumferenceM <= 0) return null;
  const seams = physicalSelfSeamConstraints(solvedState, instance.id);
  if (seams.length < 2) return null;
  const material = instance.topology.positions2DMm;
  if (!material || material.length !== instance.vertexCount * 2) return null;

  let across = new THREE.Vector2();
  let acrossSamples = 0;
  for (const seam of seams) {
    const a = weightedMaterialPoint2D(instance, seam.a);
    const b = weightedMaterialPoint2D(instance, seam.b);
    if (!a || !b) continue;
    const delta = b.sub(a);
    if (delta.lengthSq() <= 1e-8) continue;
    across.add(delta.normalize());
    acrossSamples += 1;
  }
  if (acrossSamples === 0 || across.lengthSq() <= 1e-8) return null;
  across.normalize();
  const materialAxis = new THREE.Vector2(-across.y, across.x);

  const anchorVertex = nearestWorldVertexIndex(currentWorld, centroidOfPositions(currentWorld));
  const anchorMaterial = new THREE.Vector2(material[anchorVertex * 2], material[anchorVertex * 2 + 1]);
  const currentAxis = materialDirectionInWorld(currentWorld, material, anchorMaterial, materialAxis);
  let targetAxis = section.normal
    ? new THREE.Vector3(...section.normal)
    : new THREE.Vector3(0, 1, 0);
  if (targetAxis.lengthSq() <= 1e-10) targetAxis.set(0, 1, 0);
  targetAxis.normalize();
  if (currentAxis.lengthSq() > 1e-10 && targetAxis.dot(currentAxis) < 0) targetAxis.negate();

  let outward = new THREE.Vector3(...rootSurface.outwardNormal);
  outward.addScaledVector(targetAxis, -outward.dot(targetAxis));
  if (outward.lengthSq() <= 1e-10) outward.set(0, 0, 1).addScaledVector(targetAxis, -targetAxis.z);
  if (outward.lengthSq() <= 1e-10) return null;
  outward.normalize();
  const around = new THREE.Vector3().crossVectors(targetAxis, outward).normalize();
  if (around.lengthSq() <= 1e-10) return null;

  const sectionCenter = section.centerM
    ? new THREE.Vector3(...section.centerM)
    : new THREE.Vector3(0, section.yM, section.centerZM);
  const baseTangentM = Math.max(0.005, section.halfWidthM + clearanceM);
  const baseOutwardM = Math.max(0.005, Math.max(section.frontDepthM, section.backDepthM) + clearanceM);
  const targetCircumferenceM = Math.max(materialCircumferenceM, requiredCircumferenceM);
  const baseCircumferenceM = ellipseCircumference(baseTangentM, baseOutwardM);
  if (!Number.isFinite(baseCircumferenceM) || baseCircumferenceM <= 1e-9) return null;
  const sectionScale = targetCircumferenceM / baseCircumferenceM;
  const semiTangentM = baseTangentM * sectionScale;
  const semiOutwardM = baseOutwardM * sectionScale;
  const arcTable = buildEllipseArcTable(semiTangentM, semiOutwardM);
  const stretchRatio = targetCircumferenceM / materialCircumferenceM;
  if (stretchRatio > 1 + STEP0_MAXIMUM_MATERIAL_STRETCH_PERCENT / 100 + 1e-6) return null;

  const currentAnchor = new THREE.Vector3(
    currentWorld[anchorVertex * 3],
    currentWorld[anchorVertex * 3 + 1],
    currentWorld[anchorVertex * 3 + 2],
  );
  const axialAnchor = currentAnchor.clone().sub(sectionCenter).dot(targetAxis);
  const result = new Float32Array(instance.vertexCount * 3);
  const ellipseNormal = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const materialPoint = new THREE.Vector2(material[local * 2], material[local * 2 + 1]).sub(anchorMaterial);
    const signedArcM = materialPoint.dot(across) * 0.001 * stretchRatio;
    const axialM = materialPoint.dot(materialAxis) * 0.001;
    const angle = ellipseAngleAtSignedArc(signedArcM, arcTable);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    ellipseNormal.copy(around).multiplyScalar(sin / semiTangentM)
      .addScaledVector(outward, cos / semiOutwardM)
      .normalize();
    point.copy(sectionCenter)
      .addScaledVector(targetAxis, axialAnchor + axialM)
      .addScaledVector(around, semiTangentM * sin)
      .addScaledVector(outward, semiOutwardM * cos);
    result[local * 3] = point.x;
    result[local * 3 + 1] = point.y;
    result[local * 3 + 2] = point.z;
  }
  return result;
}

function nearestWorldVertexIndex(positions: Float32Array, target: THREE.Vector3): number {
  let best = 0;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  const point = new THREE.Vector3();
  for (let offset = 0; offset < positions.length; offset += 3) {
    point.set(positions[offset], positions[offset + 1], positions[offset + 2]);
    const distanceSq = point.distanceToSquared(target);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = offset / 3;
    }
  }
  return best;
}

function materialDirectionInWorld(
  world: Float32Array,
  material: Float32Array,
  materialOrigin: THREE.Vector2,
  direction: THREE.Vector2,
): THREE.Vector3 {
  const centroid = centroidOfPositions(world);
  const result = new THREE.Vector3();
  for (let local = 0; local < world.length / 3; local += 1) {
    const scalar = (material[local * 2] - materialOrigin.x) * direction.x
      + (material[local * 2 + 1] - materialOrigin.y) * direction.y;
    result.x += (world[local * 3] - centroid.x) * scalar;
    result.y += (world[local * 3 + 1] - centroid.y) * scalar;
    result.z += (world[local * 3 + 2] - centroid.z) * scalar;
  }
  return result.normalize();
}


export interface SewingStep0ResidualMetric {
  maximumM: number;
  meanM: number;
  evaluated: number;
  bySeam: Record<string, { maximumM: number; meanM: number; evaluated: number }>;
}

export interface PlacementAnchoredSewingStep0Options {
  iterations?: number;
  maximumVertexDisplacementM?: number;
  maximumCentroidDisplacementM?: number;
  seamRelaxation?: number;
  /** Exact visual body. When present it is a solve-time inequality barrier. */
  body?: HumanBodyMesh;
  bodyClearanceM?: number;
  bodyQueryDistanceM?: number;
  /** DEV/test-only phase snapshots; final material audit is always computed. */
  captureMaterialDiagnostics?: boolean;
}

export function meshWorldMaterialAnchor(mesh: THREE.Mesh): { vertexIndex: number; position: THREE.Vector3 } {
  const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const centroid = meshWorldCentroid(mesh);
  mesh.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  let vertexIndex = 0;
  let minimumDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    const distanceSq = point.distanceToSquared(centroid);
    if (distanceSq < minimumDistanceSq) {
      minimumDistanceSq = distanceSq;
      vertexIndex = index;
    }
  }
  return {
    vertexIndex,
    position: point.fromBufferAttribute(positions, vertexIndex).applyMatrix4(mesh.matrixWorld).clone(),
  };
}

export function meshWorldVertex(mesh: THREE.Mesh, vertexIndex: number): THREE.Vector3 | null {
  const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  if (vertexIndex < 0 || vertexIndex >= positions.count) return null;
  mesh.updateMatrixWorld(true);
  return new THREE.Vector3().fromBufferAttribute(positions, vertexIndex).applyMatrix4(mesh.matrixWorld);
}

export interface SewingStep0SeamAudit {
  accepted: boolean;
  missingSeamIds: string[];
  unimprovedSeamIds: string[];
  worsenedSeamIds: string[];
}

/** Every physical SeamGroup is audited independently; a good average cannot hide one bad seam. */
export function auditSewingStep0Seams(
  before: SewingStep0ResidualMetric,
  after: SewingStep0ResidualMetric,
): SewingStep0SeamAudit {
  const missingSeamIds: string[] = [];
  const unimprovedSeamIds: string[] = [];
  const worsenedSeamIds: string[] = [];
  for (const [seamId, previous] of Object.entries(before.bySeam)) {
    const next = after.bySeam[seamId];
    if (!next || next.evaluated !== previous.evaluated) {
      missingSeamIds.push(seamId);
      continue;
    }
    const alreadyClosed = previous.meanM <= 0.0015;
    const measurablyImproved = next.meanM <= previous.meanM * 0.995
      || next.meanM <= previous.meanM - 0.00015;
    if (!alreadyClosed && !measurablyImproved) unimprovedSeamIds.push(seamId);
    if (next.maximumM > Math.max(previous.maximumM + 0.001, previous.maximumM * 1.08)) {
      worsenedSeamIds.push(seamId);
    }
  }
  return {
    accepted: missingSeamIds.length === 0
      && unimprovedSeamIds.length === 0
      && worsenedSeamIds.length === 0,
    missingSeamIds,
    unimprovedSeamIds,
    worsenedSeamIds,
  };
}

export interface PlacementAnchoredSewingStep0Proposal {
  positionsByInstanceId: Map<string, Float32Array>;
  beforeResidual: SewingStep0ResidualMetric;
  afterResidual: SewingStep0ResidualMetric;
  maximumVertexDisplacementM: number;
  maximumCentroidDisplacementM: number;
  metricDistortionMax: number;
  materialAudit: SewingStep0MaterialAudit;
  phaseMaterialAudits: Record<string, SewingStep0MaterialAuditSummary>;
  seedResidual: SewingStep0ResidualMetric | null;
  seedMinimumBodyClearanceM: number | null;
  iterations: number;
  seamConstraintCount: number;
  bodyBarrierCorrections: number;
  bodyHemisphereRejects: number;
  minimumBodyClearanceM: number | null;
  phaseTimingsMs: {
    setup: number;
    seed: number;
    solve: number;
    materialPolish: number;
    metricAudit: number;
    serialize: number;
  };
}

export type SewingStep0StructuralEdgeCategory =
  | "boundary"
  | "structural-diagonal"
  | "triangulation/internal"
  | "other";

export interface SewingStep0MaterialConstraintDiagnostic {
  constraintIndex: number;
  instanceId: string | null;
  particleA: number;
  particleB: number;
  localVertexA: number | null;
  localVertexB: number | null;
  restLengthMm: number;
  finalLengthMm: number;
  absoluteErrorMm: number;
  relativeError: number;
  source2DA: [number, number] | null;
  source2DB: [number, number] | null;
  category: SewingStep0StructuralEdgeCategory;
  touchesSewnEdgeRange: boolean;
}

export interface SewingStep0MaterialAuditSummary {
  evaluatedConstraintCount: number;
  relativeErrorMean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  maximumAbsoluteErrorMm: number;
  restLengthMm: { minimum: number; median: number; maximum: number };
}

export interface SewingStep0MaterialAudit extends SewingStep0MaterialAuditSummary {
  topWorstConstraints: SewingStep0MaterialConstraintDiagnostic[];
}

/**
 * Conservative STEP-0 used by Costurar/Montar after the user has authored the
 * 3D placement. It deliberately starts from the meshes that are visible now,
 * not from the legacy/canonical assembly candidate pose. Every panel keeps its
 * own rigid transform; only its local geometry is proposed. This makes manual
 * front/back/left/right placement an invariant instead of a hint.
 *
 * The projection is geometric, finite and history-free: seam correspondence
 * attracts the already-near sewn boundaries while the current material edge
 * metric is restored every pass. Per-vertex and per-panel displacement cages
 * prevent a seam from buying closure by teleporting a panel through the body.
 */
export function solvePlacementAnchoredSewingStep0(
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  target: SewingStep0Target,
  options: PlacementAnchoredSewingStep0Options = {},
): PlacementAnchoredSewingStep0Proposal | null {
  const startedAt = step0Now();
  const iterations = Math.max(8, Math.min(120, Math.round(options.iterations ?? 64)));
  const maximumVertexDisplacementM = Math.max(0.005, options.maximumVertexDisplacementM ?? 0.065);
  const maximumCentroidDisplacementM = Math.max(0.001, options.maximumCentroidDisplacementM ?? 0.018);
  const seamRelaxation = Math.max(0.05, Math.min(0.9, options.seamRelaxation ?? 0.58));
  const targetIds = new Set(target.instanceIds);
  const built = buildCurrentWorldParticles(state, meshes, targetIds);
  if (!built) return null;
  const { world, filled } = built;
  const initial = new Float64Array(world);

  const structural = state.structuralConstraints.filter((constraint) =>
    filled[constraint.a] === 1 && filled[constraint.b] === 1,
  );
  // The 2D material metric is canonical. Using the current 3D edge lengths here
  // made repeated Adjust operations preserve (and accumulate) an earlier error.
  const structuralTargets = structural.map((constraint) => constraint.restLength);
  const seams = state.stitchConstraints.filter((constraint) =>
    !constraint.seamGroupId.startsWith("dart:")
    && Boolean(constraint.instanceA && targetIds.has(constraint.instanceA))
    && Boolean(constraint.instanceB && targetIds.has(constraint.instanceB))
    && referenceIsFilled(constraint.a, filled)
    && referenceIsFilled(constraint.b, filled),
  );
  if (seams.length === 0) return null;

  let metricAuditMs = 0;
  const auditMaterial = (positions: Float64Array): SewingStep0MaterialAudit => {
    const auditStartedAt = step0Now();
    const audit = auditMaterialMetricWorld(positions, structural, state, seams);
    metricAuditMs += step0Now() - auditStartedAt;
    return audit;
  };
  const phaseMaterialAudits: Record<string, SewingStep0MaterialAuditSummary> = {};
  const capturePhase = (name: string): void => {
    if (!options.captureMaterialDiagnostics) return;
    phaseMaterialAudits[name] = materialAuditSummary(auditMaterial(world));
  };

  const beforeResidual = measureResidualInWorld(world, seams);
  capturePhase("initial");
  const bodyBarrier = options.body
    ? buildStep0BodyBarrier(
      options.body,
      initial,
      filled,
      options.bodyClearanceM ?? 0.006,
      options.bodyQueryDistanceM ?? 0.24,
    )
    : null;
  const anchorParticles = new Map<string, number>();
  const initialAnchors = new Map<string, THREE.Vector3>();
  for (const instanceId of target.instanceIds) {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return null;
    const centroid = instanceParticleCentroid(initial, instance.particleStart, instance.vertexCount);
    const anchorParticle = nearestInstanceParticle(initial, instance.particleStart, instance.vertexCount, centroid);
    anchorParticles.set(instanceId, anchorParticle);
    initialAnchors.set(instanceId, particlePoint(initial, anchorParticle));
  }
  const displacementBudgets = buildMaterialDisplacementBudgets(
    state,
    target.instanceIds,
    initial,
    anchorParticles,
    maximumVertexDisplacementM,
  );
  const seedStartedAt = step0Now();
  const wrapped = new Set<string>();
  const selfWrapped = new Set<string>();
  if (bodyBarrier) {
    for (const instanceId of seedBodyAwareSelfSeamWrap(world, initial, state, seams, anchorParticles, bodyBarrier)) {
      wrapped.add(instanceId);
      selfWrapped.add(instanceId);
    }
    for (const instanceId of seedBodyAwareMultiPanelCycleWrap(
      world,
      initial,
      state,
      seams,
      anchorParticles,
      bodyBarrier,
      wrapped,
    )) wrapped.add(instanceId);
    for (const instanceId of wrapped) {
      const instance = state.instances.find((candidate) => candidate.id === instanceId);
      if (instance) refreshStep0BodyBarrierFrames(bodyBarrier, world, instance.particleStart, instance.vertexCount);
    }
  }
  capturePhase("afterSeed");
  const seedResidual = wrapped.size > 0 ? measureResidualInWorld(world, seams) : null;
  const seedMinimumBodyClearanceM = bodyBarrier && wrapped.size > 0
    ? measureStep0BodyClearance(world, filled, bodyBarrier)
    : null;
  const seedFinishedAt = step0Now();

  // A body-aware, arc-length seed starts already near the constrained
  // solution. Limiting only that proven path keeps an explicit UI action fast
  // without reducing convergence work for generic or multi-panel layouts.
  const alreadyClosedSelfSeam = Boolean(bodyBarrier)
    && beforeResidual.maximumM <= 0.005
    && seams.some((seam) => seam.instanceA && seam.instanceA === seam.instanceB);
  const effectiveIterations = selfWrapped.size > 0 || alreadyClosedSelfSeam
    ? Math.min(iterations, 12)
    : iterations;
  for (let iteration = 0; iteration < effectiveIterations; iteration += 1) {
  const reverse = iteration % 2 === 1;
  // Material metric is the hard geometric contract. Multiple alternating
  // sweeps make each seam pull behave as bending/rigid reorientation rather
  // than stretching a boundary toward its mate.
  for (let pass = 0; pass < 3; pass += 1) {
    projectStructuralMetric(world, structural, structuralTargets, (pass % 2 === 0) ? reverse : !reverse, 0.985);
  }
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterStructuralA");
  projectSeamRelations(world, seams, reverse, seamRelaxation * 0.42);
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterSeamA");
  for (let pass = 0; pass < 5; pass += 1) {
    projectStructuralMetric(world, structural, structuralTargets, (pass % 2 === 0) ? !reverse : reverse, 0.992);
  }
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterStructuralB");
  projectSeamRelations(world, seams, !reverse, seamRelaxation * 0.14);
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterSeamB");
  for (let pass = 0; pass < 3; pass += 1) {
    projectStructuralMetric(world, structural, structuralTargets, (pass % 2 === 0) ? reverse : !reverse, 0.995);
  }
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterStructuralC");
  if (bodyBarrier) projectStep0BodyBarrier(world, filled, bodyBarrier, 0.65);
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterBodyBarrier");

  // Keep the authored material anchor in place while allowing the rest of the
  // panel to bend. A centroid is not a stable placement invariant: the centroid
  // of a flat rectangle legitimately moves to the tube centre when it wraps.
  for (const instanceId of target.instanceIds) {
    cageAnchorParticle(
      world,
      anchorParticles.get(instanceId)!,
      initialAnchors.get(instanceId)!,
      maximumCentroidDisplacementM,
    );
  }
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterAnchorCage");
  cageParticleDisplacements(world, initial, filled, displacementBudgets);
  if (iteration === effectiveIterations - 1) capturePhase("lastIteration.afterDisplacementCage");
}

const solveFinishedAt = step0Now();
capturePhase("afterSolve");

// Final material polish is repeated inside the displacement cage so the
// last safety clamp cannot leave the panel visibly stretched.
for (let pass = 0; pass < 36; pass += 1) {
  projectStructuralMetric(world, structural, structuralTargets, pass % 2 === 1, 0.997);
  if (bodyBarrier && pass % 3 === 2) projectStep0BodyBarrier(world, filled, bodyBarrier, 0.8);
  cageParticleDisplacements(world, initial, filled, displacementBudgets);
}
capturePhase("afterPolishSweeps");
for (const instanceId of target.instanceIds) {
  cageAnchorParticle(
    world,
    anchorParticles.get(instanceId)!,
    initialAnchors.get(instanceId)!,
    maximumCentroidDisplacementM,
  );
}
if (bodyBarrier) {
  projectStep0BodyBarrier(world, filled, bodyBarrier, 1);
  capturePhase("afterFinalBodyBarrier");
  cageParticleDisplacements(world, initial, filled, displacementBudgets);
}
const polishFinishedAt = step0Now();
  const materialAudit = auditMaterial(world);
  if (options.captureMaterialDiagnostics) phaseMaterialAudits.final = materialAuditSummary(materialAudit);

  const afterResidual = measureResidualInWorld(world, seams);
  let maximumVertex = 0;
  for (let particle = 0; particle < filled.length; particle += 1) {
    if (filled[particle] !== 1) continue;
    maximumVertex = Math.max(maximumVertex, particleDisplacement(world, initial, particle));
  }
  let maximumCentroid = 0;
  for (const instanceId of target.instanceIds) {
    maximumCentroid = Math.max(
      maximumCentroid,
      particlePoint(world, anchorParticles.get(instanceId)!)
        .distanceTo(initialAnchors.get(instanceId)!),
    );
  }

  const metricDistortionMax = materialAudit.max;

  const serializationStartedAt = step0Now();
  const positionsByInstanceId = new Map<string, Float32Array>();
  const point = new THREE.Vector3();
  for (const instanceId of target.instanceIds) {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    const meshData = meshes.find((candidate) => candidate.key === instanceId);
    if (!instance || !meshData) return null;
    meshData.mesh.updateMatrixWorld(true);
    const inverse = meshData.mesh.matrixWorld.clone().invert();
    const local = new Float32Array(instance.vertexCount * 3);
    for (let localIndex = 0; localIndex < instance.vertexCount; localIndex += 1) {
      const particle = instance.particleStart + localIndex;
      const offset = particle * 3;
      point.set(world[offset], world[offset + 1], world[offset + 2]).applyMatrix4(inverse);
      local[localIndex * 3] = point.x;
      local[localIndex * 3 + 1] = point.y;
      local[localIndex * 3 + 2] = point.z;
    }
    if (![...local].every(Number.isFinite)) return null;
    positionsByInstanceId.set(instanceId, local);
  }

  const serializedAt = step0Now();

  return {
    positionsByInstanceId,
    beforeResidual,
    afterResidual,
    maximumVertexDisplacementM: maximumVertex,
    maximumCentroidDisplacementM: maximumCentroid,
    metricDistortionMax,
    materialAudit,
    phaseMaterialAudits,
    seedResidual,
    seedMinimumBodyClearanceM,
    iterations: effectiveIterations,
    seamConstraintCount: seams.length,
    bodyBarrierCorrections: bodyBarrier?.corrections ?? 0,
    bodyHemisphereRejects: bodyBarrier?.hemisphereRejects ?? 0,
    minimumBodyClearanceM: bodyBarrier ? measureStep0BodyClearance(world, filled, bodyBarrier) : null,
    phaseTimingsMs: {
      setup: seedStartedAt - startedAt,
      seed: seedFinishedAt - seedStartedAt,
      solve: solveFinishedAt - seedFinishedAt,
      materialPolish: polishFinishedAt - solveFinishedAt,
      metricAudit: metricAuditMs,
      serialize: serializedAt - serializationStartedAt,
    },
  };
}

export function measureCurrentSewingStep0Residual(
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  target: SewingStep0Target,
): SewingStep0ResidualMetric | null {
  const targetIds = new Set(target.instanceIds);
  const built = buildCurrentWorldParticles(state, meshes, targetIds);
  if (!built) return null;
  const seams = state.stitchConstraints.filter((constraint) =>
    !constraint.seamGroupId.startsWith("dart:")
    && Boolean(constraint.instanceA && targetIds.has(constraint.instanceA))
    && Boolean(constraint.instanceB && targetIds.has(constraint.instanceB))
    && referenceIsFilled(constraint.a, built.filled)
    && referenceIsFilled(constraint.b, built.filled),
  );
  return measureResidualInWorld(built.world, seams);
}

export function measureCurrentSewingStep0MaterialDistortion(
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  target: SewingStep0Target,
): number | null {
  return measureCurrentSewingStep0MaterialAudit(state, meshes, target)?.max ?? null;
}

export function measureCurrentSewingStep0MaterialAudit(
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  target: SewingStep0Target,
): SewingStep0MaterialAudit | null {
  const built = buildCurrentWorldParticles(state, meshes, new Set(target.instanceIds));
  if (!built) return null;
  const structural = state.structuralConstraints.filter((constraint) =>
    built.filled[constraint.a] === 1 && built.filled[constraint.b] === 1,
  );
  const seams = state.stitchConstraints.filter((constraint) =>
    !constraint.seamGroupId.startsWith("dart:")
    && referenceIsFilled(constraint.a, built.filled)
    && referenceIsFilled(constraint.b, built.filled),
  );
  return auditMaterialMetricWorld(built.world, structural, state, seams);
}

function auditMaterialMetricWorld(
  world: Float64Array,
  constraints: readonly AssemblyDistanceConstraint[],
  state: GarmentAssemblyState,
  seams: readonly AssemblyStitchConstraint[],
): SewingStep0MaterialAudit {
  const originalIndex = new Map(state.structuralConstraints.map((constraint, index) => [constraint, index] as const));
  const sewnParticles = new Set<number>();
  for (const seam of seams) {
    for (const particle of [...seam.a.particleIndices, ...seam.b.particleIndices]) sewnParticles.add(particle);
  }
  const instanceByParticle = new Map<number, GarmentAssemblyState["instances"][number]>();
  const boundaryEdges = new Map<string, Set<string>>();
  const triangleEdgeCounts = new Map<string, Map<string, number>>();
  for (const instance of state.instances) {
    for (let local = 0; local < instance.vertexCount; local += 1) {
      instanceByParticle.set(instance.particleStart + local, instance);
    }
    const boundary = new Set<string>();
    if (instance.topology.edges) {
      for (const path of instance.topology.edges.values()) {
        for (let index = 1; index < path.vertexIndices.length; index += 1) {
          boundary.add(localEdgeKey(path.vertexIndices[index - 1], path.vertexIndices[index]));
        }
      }
    }
    boundaryEdges.set(instance.id, boundary);
    const counts = new Map<string, number>();
    const triangles = instance.topology.triangles ?? new Uint32Array();
    for (let offset = 0; offset + 2 < triangles.length; offset += 3) {
      const vertices = [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
      for (const [a, b] of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]]) {
        const key = localEdgeKey(a, b);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    triangleEdgeCounts.set(instance.id, counts);
  }

  const diagnostics: SewingStep0MaterialConstraintDiagnostic[] = [];
  for (const constraint of constraints) {
    if (constraint.restLength <= 1e-9) continue;
    const instance = instanceByParticle.get(constraint.a);
    const sameInstance = instance && instanceByParticle.get(constraint.b)?.id === instance.id ? instance : null;
    const localA = sameInstance ? constraint.a - sameInstance.particleStart : null;
    const localB = sameInstance ? constraint.b - sameInstance.particleStart : null;
    const finalLengthM = particleDistance(world, constraint.a, constraint.b);
    const absoluteErrorM = Math.abs(finalLengthM - constraint.restLength);
    const sourcePositions = sameInstance?.topology.positions2DMm;
    const sourceA = sourcePositions && localA !== null
      ? [sameInstance.topology.positions2DMm[localA * 2], sameInstance.topology.positions2DMm[localA * 2 + 1]] as [number, number]
      : null;
    const sourceB = sourcePositions && localB !== null
      ? [sameInstance.topology.positions2DMm[localB * 2], sameInstance.topology.positions2DMm[localB * 2 + 1]] as [number, number]
      : null;
    const edgeKey = localA !== null && localB !== null ? localEdgeKey(localA, localB) : null;
    diagnostics.push({
      constraintIndex: originalIndex.get(constraint) ?? -1,
      instanceId: sameInstance?.id ?? null,
      particleA: constraint.a,
      particleB: constraint.b,
      localVertexA: localA,
      localVertexB: localB,
      restLengthMm: constraint.restLength * 1_000,
      finalLengthMm: finalLengthM * 1_000,
      absoluteErrorMm: absoluteErrorM * 1_000,
      relativeError: absoluteErrorM / constraint.restLength,
      source2DA: sourceA,
      source2DB: sourceB,
      category: sameInstance && edgeKey
        ? classifyStructuralEdge(
            edgeKey,
            boundaryEdges.get(sameInstance.id),
            triangleEdgeCounts.get(sameInstance.id),
            sourceA,
            sourceB,
          )
        : "other",
      touchesSewnEdgeRange: sewnParticles.has(constraint.a) || sewnParticles.has(constraint.b),
    });
  }
  diagnostics.sort((left, right) =>
    right.relativeError - left.relativeError
    || right.absoluteErrorMm - left.absoluteErrorMm
    || left.constraintIndex - right.constraintIndex,
  );
  const relative = diagnostics.map((entry) => entry.relativeError).sort((a, b) => a - b);
  const restLengths = diagnostics.map((entry) => entry.restLengthMm).sort((a, b) => a - b);
  return {
    evaluatedConstraintCount: diagnostics.length,
    relativeErrorMean: relative.length > 0
      ? relative.reduce((sum, value) => sum + value, 0) / relative.length
      : 0,
    p50: percentile(relative, 0.5),
    p90: percentile(relative, 0.9),
    p95: percentile(relative, 0.95),
    p99: percentile(relative, 0.99),
    max: relative.at(-1) ?? 0,
    maximumAbsoluteErrorMm: diagnostics.reduce((maximum, entry) => Math.max(maximum, entry.absoluteErrorMm), 0),
    restLengthMm: {
      minimum: restLengths[0] ?? 0,
      median: percentile(restLengths, 0.5),
      maximum: restLengths.at(-1) ?? 0,
    },
    topWorstConstraints: diagnostics.slice(0, 20),
  };
}

function materialAuditSummary(audit: SewingStep0MaterialAudit): SewingStep0MaterialAuditSummary {
  const { topWorstConstraints: _topWorstConstraints, ...summary } = audit;
  return summary;
}

function classifyStructuralEdge(
  edgeKey: string,
  boundaryEdges: ReadonlySet<string> | undefined,
  triangleEdgeCounts: ReadonlyMap<string, number> | undefined,
  sourceA: [number, number] | null,
  sourceB: [number, number] | null,
): SewingStep0StructuralEdgeCategory {
  if (boundaryEdges?.has(edgeKey)) return "boundary";
  if (!triangleEdgeCounts?.has(edgeKey)) return "other";
  if (sourceA && sourceB) {
    const dx = Math.abs(sourceB[0] - sourceA[0]);
    const dy = Math.abs(sourceB[1] - sourceA[1]);
    if (Math.min(dx, dy) > Math.max(dx, dy) * 0.1) return "structural-diagonal";
  }
  return "triangulation/internal";
}

function localEdgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function buildCurrentWorldParticles(
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  targetIds: Set<string>,
): { world: Float64Array; filled: Uint8Array } | null {
  const world = new Float64Array(state.positions.length);
  const filled = new Uint8Array(Math.floor(state.positions.length / 3));
  const point = new THREE.Vector3();
  for (const instance of state.instances) {
    if (!targetIds.has(instance.id)) continue;
    const meshData = meshes.find((candidate) => candidate.key === instance.id);
    const position = meshData?.mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!meshData || !position || position.count !== instance.vertexCount) return null;
    meshData.mesh.updateMatrixWorld(true);
    for (let local = 0; local < instance.vertexCount; local += 1) {
      point.fromBufferAttribute(position, local).applyMatrix4(meshData.mesh.matrixWorld);
      const particle = instance.particleStart + local;
      const offset = particle * 3;
      world[offset] = point.x;
      world[offset + 1] = point.y;
      world[offset + 2] = point.z;
      filled[particle] = 1;
    }
  }
  return { world, filled };
}

interface Step0BodyBarrier {
  body: HumanBodyMesh;
  frames: Array<BodySurfaceFrame | null>;
  minimumClearanceM: Float64Array;
  queryDistanceM: number;
  requestedClearanceM: number;
  corrections: number;
  hemisphereRejects: number;
}

function buildStep0BodyBarrier(
  body: HumanBodyMesh,
  initial: Float64Array,
  filled: Uint8Array,
  requestedClearanceM: number,
  queryDistanceM: number,
): Step0BodyBarrier {
  const frames: Array<BodySurfaceFrame | null> = Array.from({ length: filled.length }, () => null);
  const minimumClearanceM = new Float64Array(filled.length);
  const point = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let particle = 0; particle < filled.length; particle += 1) {
    if (filled[particle] !== 1) continue;
    const offset = particle * 3;
    point.set(initial[offset], initial[offset + 1], initial[offset + 2]);
    const frame = closestBodySurfacePoint(body, [point.x, point.y, point.z], 0, queryDistanceM);
    frames[particle] = frame;
    if (!frame) continue;
    surface.set(...frame.position);
    normal.set(...frame.outwardNormal).normalize();
    const initialSigned = point.clone().sub(surface).dot(normal);
    // Never make an existing penetration worse. An already healthy point keeps
    // a small skin clearance, while a pre-existing inside point is allowed to
    // recover without an instantaneous projection/teleport.
    minimumClearanceM[particle] = initialSigned >= 0
      ? Math.min(requestedClearanceM, initialSigned)
      : initialSigned;
  }
  return {
    body,
    frames,
    minimumClearanceM,
    queryDistanceM,
    requestedClearanceM,
    corrections: 0,
    hemisphereRejects: 0,
  };
}

function projectStep0BodyBarrier(
  world: Float64Array,
  filled: Uint8Array,
  barrier: Step0BodyBarrier,
  relaxation: number,
): void {
  const point = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const initialNormal = new THREE.Vector3();
  for (let particle = 0; particle < filled.length; particle += 1) {
    const initialFrame = barrier.frames[particle];
    if (filled[particle] !== 1 || !initialFrame) continue;
    const offset = particle * 3;
    point.set(world[offset], world[offset + 1], world[offset + 2]);
    const candidate = closestBodySurfacePoint(
      barrier.body,
      [point.x, point.y, point.z],
      0,
      barrier.queryDistanceM,
    );
    initialNormal.set(...initialFrame.outwardNormal).normalize();
    let frame = candidate;
    if (frame) {
      normal.set(...frame.outwardNormal).normalize();
      // A nearest-point jump to the opposite body hemisphere is not a valid
      // shortcut for closing a seam. Keep the original material-side plane.
      if (normal.dot(initialNormal) < -0.2) {
        frame = null;
        barrier.hemisphereRejects += 1;
      }
    }
    if (frame) {
      surface.set(...frame.position);
      normal.set(...frame.outwardNormal).normalize();
    } else {
      surface.set(...initialFrame.position);
      normal.copy(initialNormal);
    }
    const signed = point.clone().sub(surface).dot(normal);
    const deficit = barrier.minimumClearanceM[particle] - signed;
    if (deficit <= 1e-8) continue;
    // Bounded inequality projection: tangential seam motion is untouched.
    const correction = Math.min(0.0025, deficit * relaxation);
    world[offset] += normal.x * correction;
    world[offset + 1] += normal.y * correction;
    world[offset + 2] += normal.z * correction;
    barrier.corrections += 1;
  }
}

function measureStep0BodyClearance(
  world: Float64Array,
  filled: Uint8Array,
  barrier: Step0BodyBarrier,
): number | null {
  const point = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let minimum = Number.POSITIVE_INFINITY;
  for (let particle = 0; particle < filled.length; particle += 1) {
    const initialFrame = barrier.frames[particle];
    if (filled[particle] !== 1 || !initialFrame) continue;
    const offset = particle * 3;
    point.set(world[offset], world[offset + 1], world[offset + 2]);
    const candidate = closestBodySurfacePoint(barrier.body, [point.x, point.y, point.z], 0, barrier.queryDistanceM);
    const initialNormal = new THREE.Vector3(...initialFrame.outwardNormal).normalize();
    const frame = candidate
      && new THREE.Vector3(...candidate.outwardNormal).normalize().dot(initialNormal) >= -0.2
      ? candidate
      : initialFrame;
    surface.set(...frame.position);
    normal.set(...frame.outwardNormal).normalize();
    minimum = Math.min(minimum, point.clone().sub(surface).dot(normal));
  }
  return Number.isFinite(minimum) ? minimum : null;
}

function step0Now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function referenceIsFilled(reference: AssemblyStitchConstraint["a"], filled: Uint8Array): boolean {
  return reference.particleIndices.length > 0
    && reference.particleIndices.every((particle) => filled[particle] === 1);
}

function weightedPointInWorld(world: Float64Array, reference: AssemblyStitchConstraint["a"]): THREE.Vector3 {
  const result = new THREE.Vector3();
  let total = 0;
  reference.particleIndices.forEach((particle, index) => {
    const weight = reference.weights[index] ?? 0;
    const offset = particle * 3;
    result.x += world[offset] * weight;
    result.y += world[offset + 1] * weight;
    result.z += world[offset + 2] * weight;
    total += weight;
  });
  if (Math.abs(total) > 1e-9 && Math.abs(total - 1) > 1e-9) result.multiplyScalar(1 / total);
  return result;
}

function applyReferenceCorrection(
  world: Float64Array,
  reference: AssemblyStitchConstraint["a"],
  correction: THREE.Vector3,
): void {
  let sumSquares = 0;
  for (const weight of reference.weights) sumSquares += weight * weight;
  if (sumSquares <= 1e-12) return;
  reference.particleIndices.forEach((particle, index) => {
    const weight = reference.weights[index] ?? 0;
    const scale = weight / sumSquares;
    const offset = particle * 3;
    world[offset] += correction.x * scale;
    world[offset + 1] += correction.y * scale;
    world[offset + 2] += correction.z * scale;
  });
}

function projectSeamRelations(
  world: Float64Array,
  seams: readonly AssemblyStitchConstraint[],
  reverse: boolean,
  relaxation: number,
): void {
  const direction = new THREE.Vector3();
  for (let cursor = 0; cursor < seams.length; cursor += 1) {
    const seam = seams[reverse ? seams.length - 1 - cursor : cursor];
    const a = weightedPointInWorld(world, seam.a);
    const b = weightedPointInWorld(world, seam.b);
    direction.copy(b).sub(a);
    const current = direction.length();
    const target = Math.max(0, seam.physicalRestDistance ?? 0);
    if (current <= 1e-9 || current <= target + 1e-6) continue;
    const magnitude = Math.min(0.0015, (current - target) * 0.5 * relaxation);
    direction.multiplyScalar(magnitude / current);
    applyReferenceCorrection(world, seam.a, direction);
    applyReferenceCorrection(world, seam.b, direction.clone().multiplyScalar(-1));
  }
}

function projectStructuralMetric(
  world: Float64Array,
  constraints: readonly { a: number; b: number }[],
  targets: readonly number[],
  reverse: boolean,
  relaxation: number,
): void {
  for (let cursor = 0; cursor < constraints.length; cursor += 1) {
    const index = reverse ? constraints.length - 1 - cursor : cursor;
    const constraint = constraints[index];
    const target = targets[index];
    if (target <= 1e-9) continue;
    const aOffset = constraint.a * 3;
    const bOffset = constraint.b * 3;
    const dx = world[bOffset] - world[aOffset];
    const dy = world[bOffset + 1] - world[aOffset + 1];
    const dz = world[bOffset + 2] - world[aOffset + 2];
    const current = Math.hypot(dx, dy, dz);
    if (current <= 1e-9) continue;
    const magnitude = Math.max(-0.008, Math.min(0.008, (current - target) * 0.5 * relaxation));
    const scale = magnitude / current;
    world[aOffset] += dx * scale;
    world[aOffset + 1] += dy * scale;
    world[aOffset + 2] += dz * scale;
    world[bOffset] -= dx * scale;
    world[bOffset + 1] -= dy * scale;
    world[bOffset + 2] -= dz * scale;
  }
}

function buildMaterialDisplacementBudgets(
  state: GarmentAssemblyState,
  instanceIds: readonly string[],
  initial: Float64Array,
  anchorParticles: ReadonlyMap<string, number>,
  baseAllowanceM: number,
): Float64Array {
  const budgets = new Float64Array(Math.floor(initial.length / 3));
  budgets.fill(baseAllowanceM);
  for (const instanceId of instanceIds) {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    const anchorParticle = anchorParticles.get(instanceId);
    if (!instance || anchorParticle === undefined) continue;
    const anchor = particlePoint(initial, anchorParticle);
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const particle = instance.particleStart + local;
      // Local deformation freedom scales with material reach from the frozen
      // anchor. This admits isometric bending of a large panel but still rules
      // out a rigid teleport of the whole instance.
      budgets[particle] = baseAllowanceM + particlePoint(initial, particle).distanceTo(anchor) * 1.5;
    }
  }
  return budgets;
}

function seedBodyAwareSelfSeamWrap(
  world: Float64Array,
  initial: Float64Array,
  state: GarmentAssemblyState,
  seams: readonly AssemblyStitchConstraint[],
  anchorParticles: ReadonlyMap<string, number>,
  barrier: Step0BodyBarrier,
): Set<string> {
  const grouped = new Map<string, AssemblyStitchConstraint[]>();
  for (const seam of seams) {
    if (!seam.instanceA || seam.instanceA !== seam.instanceB) continue;
    const group = grouped.get(seam.seamId) ?? [];
    group.push(seam);
    grouped.set(seam.seamId, group);
  }
  const wrapped = new Set<string>();
  const candidates = [...grouped.values()]
    .filter((group) => group.length >= 2)
    .sort((left, right) => right.length - left.length);
  for (const group of candidates) {
    const instanceId = group[0].instanceA!;
    if (wrapped.has(instanceId)) continue;
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    const anchorParticle = anchorParticles.get(instanceId);
    const anchorFrame = anchorParticle === undefined ? null : barrier.frames[anchorParticle];
    if (!instance || anchorParticle === undefined || !anchorFrame) continue;

    const ordered = [...group].sort((left, right) => (left.progress ?? 0) - (right.progress ?? 0));
    const firstA = weightedPointInWorld(initial, ordered[0].a);
    const lastA = weightedPointInWorld(initial, ordered[ordered.length - 1].a);
    const firstB = weightedPointInWorld(initial, ordered[0].b);
    const lastB = weightedPointInWorld(initial, ordered[ordered.length - 1].b);
    const materialAxis = lastA.clone().sub(firstA);
    if (materialAxis.lengthSq() <= 1e-10) materialAxis.copy(lastB).sub(firstB);
    if (materialAxis.lengthSq() <= 1e-10) continue;
    materialAxis.normalize();

    const sideA = new THREE.Vector3();
    const sideB = new THREE.Vector3();
    for (const seam of ordered) {
      sideA.add(weightedPointInWorld(initial, seam.a));
      sideB.add(weightedPointInWorld(initial, seam.b));
    }
    sideA.multiplyScalar(1 / ordered.length);
    sideB.multiplyScalar(1 / ordered.length);
    const sideDelta = sideB.clone().sub(sideA);
    const materialTangent = sideDelta.clone()
      .addScaledVector(materialAxis, -sideDelta.dot(materialAxis));
    const circumferenceM = materialTangent.length();
    if (!Number.isFinite(circumferenceM) || circumferenceM <= 0.03) continue;
    materialTangent.normalize();
    const materialNormal = new THREE.Vector3().crossVectors(materialTangent, materialAxis).normalize();
    const outward = new THREE.Vector3(...anchorFrame.outwardNormal)
      .addScaledVector(materialAxis, -new THREE.Vector3(...anchorFrame.outwardNormal).dot(materialAxis));
    if (outward.lengthSq() <= 1e-10) outward.copy(materialNormal);
    outward.normalize();
    if (materialNormal.dot(outward) < 0) materialNormal.negate();
    const around = new THREE.Vector3().crossVectors(materialAxis, outward).normalize();
    if (around.dot(materialTangent) < 0) around.negate();
    const anchor = particlePoint(initial, anchorParticle);
    const ellipse = fitBodyAwareSelfSeamEllipse(
      barrier.body,
      initial,
      instance.particleStart,
      instance.vertexCount,
      anchor,
      materialAxis,
      around,
      outward,
      circumferenceM,
      barrier.requestedClearanceM,
    );
    const radiusM = circumferenceM / (Math.PI * 2);
    const semiTangentM = ellipse?.semiTangentM ?? radiusM;
    const semiOutwardM = ellipse?.semiOutwardM ?? radiusM;
    const arcTable = buildEllipseArcTable(semiTangentM, semiOutwardM);
    const centre = anchor.clone().addScaledVector(outward, -semiOutwardM);
    const relative = new THREE.Vector3();
    const radial = new THREE.Vector3();
    const surfaceNormal = new THREE.Vector3();
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const particle = instance.particleStart + local;
      const source = particlePoint(initial, particle);
      relative.copy(source).sub(anchor);
      const axial = relative.dot(materialAxis);
      const materialU = relative.dot(materialTangent);
      const normalOffset = relative.dot(materialNormal);
      const angle = ellipseAngleAtSignedArc(materialU, arcTable);
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      radial.copy(around).multiplyScalar(semiTangentM * sin)
        .addScaledVector(outward, semiOutwardM * cos);
      surfaceNormal.copy(around).multiplyScalar(sin / semiTangentM)
        .addScaledVector(outward, cos / semiOutwardM)
        .normalize();
      const target = centre.clone().addScaledVector(materialAxis, axial).add(radial)
        .addScaledVector(surfaceNormal, normalOffset);
      const offset = particle * 3;
      world[offset] = target.x;
      world[offset + 1] = target.y;
      world[offset + 2] = target.z;
    }
    wrapped.add(instanceId);
  }
  return wrapped;
}

interface EllipseArcTable {
  circumferenceM: number;
  angles: Float64Array;
  lengths: Float64Array;
}

/**
 * Fits the closest fixed-perimeter ellipse around the exact central-body
 * samples across the panel's axial span while keeping the authored front
 * anchor fixed. Changing only the aspect ratio never changes material length;
 * arc-length parameterization supplies the isometric development used by the
 * seed, and the exact barrier resolves any remaining submillimetric overlap.
 */
function fitBodyAwareSelfSeamEllipse(
  body: HumanBodyMesh,
  initial: Float64Array,
  particleStart: number,
  vertexCount: number,
  anchor: THREE.Vector3,
  axis: THREE.Vector3,
  tangent: THREE.Vector3,
  outward: THREE.Vector3,
  circumferenceM: number,
  clearanceM: number,
): { semiTangentM: number; semiOutwardM: number } | null {
  let axialMinimum = Number.POSITIVE_INFINITY;
  let axialMaximum = Number.NEGATIVE_INFINITY;
  const point = new THREE.Vector3();
  for (let local = 0; local < vertexCount; local += 1) {
    point.copy(particlePoint(initial, particleStart + local)).sub(anchor);
    const axial = point.dot(axis);
    axialMinimum = Math.min(axialMinimum, axial);
    axialMaximum = Math.max(axialMaximum, axial);
  }
  if (!Number.isFinite(axialMinimum) || !Number.isFinite(axialMaximum)) return null;

  const samples: Array<{ tangent: number; outward: number }> = [];
  const maximumRadialDistanceM = circumferenceM * 0.42;
  let maximumAbsoluteTangentM = 0;
  let minimumOutwardM = 0;
  for (let offset = 0; offset < body.positions.length; offset += 3) {
    const regionId = body.regionIds[offset / 3];
    if (regionId && !BODY_WRAP_REGION_IDS.has(regionId)) continue;
    point.set(body.positions[offset], body.positions[offset + 1], body.positions[offset + 2]).sub(anchor);
    const axial = point.dot(axis);
    if (axial < axialMinimum - 0.012 || axial > axialMaximum + 0.012) continue;
    const tangentCoordinate = point.dot(tangent);
    const outwardCoordinate = point.dot(outward);
    if (Math.hypot(tangentCoordinate, outwardCoordinate) > maximumRadialDistanceM) continue;
    samples.push({ tangent: tangentCoordinate, outward: outwardCoordinate });
    maximumAbsoluteTangentM = Math.max(maximumAbsoluteTangentM, Math.abs(tangentCoordinate));
    minimumOutwardM = Math.min(minimumOutwardM, outwardCoordinate);
  }
  if (samples.length < 12 || maximumAbsoluteTangentM <= 0.01 || minimumOutwardM >= -0.01) return null;

  let best: { semiTangentM: number; semiOutwardM: number; maximumRadiusSq: number } | null = null;
  // Search only the cross-section aspect ratio. Every candidate is scaled to
  // exactly the authored circumference, so this cannot autoscale material.
  for (let step = 0; step <= 96; step += 1) {
    const aspect = 0.65 * ((2.8 / 0.65) ** (step / 96));
    const unitCircumference = ellipseCircumference(aspect, 1);
    const semiOutwardM = circumferenceM / unitCircumference;
    const semiTangentM = aspect * semiOutwardM;
    let maximumRadiusSq = 0;
    for (const sample of samples) {
      const expandedTangent = sample.tangent + Math.sign(sample.tangent) * clearanceM;
      const x = expandedTangent / semiTangentM;
      const z = (sample.outward + clearanceM + semiOutwardM) / semiOutwardM;
      maximumRadiusSq = Math.max(maximumRadiusSq, x * x + z * z);
    }
    if (!best || maximumRadiusSq < best.maximumRadiusSq) {
      best = { semiTangentM, semiOutwardM, maximumRadiusSq };
    }
  }
  // The material cannot enclose this body section without stretch. Let the
  // conservative barrier/validator reject instead of silently scaling it.
  // A near fit is still a much better isometric seed than a circle. The exact
  // barrier remains authoritative and resolves the small residual overlap.
  return best && best.maximumRadiusSq <= 1.08
    ? { semiTangentM: best.semiTangentM, semiOutwardM: best.semiOutwardM }
    : null;
}

const BODY_WRAP_REGION_IDS = new Set<string>([
  "bust-left",
  "bust-right",
  "underbust",
  "ribcage",
  "chest-front",
  "back-upper",
  "waist",
  "abdomen",
  "high-hip",
  "full-hip",
  "pelvis",
  "pelvis-front",
  "pelvis-back",
  "glute-left",
  "glute-right",
  "crotch",
  "thigh-left",
  "thigh-right",
] as const);

function ellipseCircumference(semiA: number, semiB: number): number {
  const h = ((semiA - semiB) ** 2) / ((semiA + semiB) ** 2);
  return Math.PI * (semiA + semiB) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function buildEllipseArcTable(semiA: number, semiB: number): EllipseArcTable {
  const sampleCount = 2048;
  const angles = new Float64Array(sampleCount + 1);
  const lengths = new Float64Array(sampleCount + 1);
  let previousX = 0;
  let previousZ = semiB;
  for (let index = 1; index <= sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2;
    const x = semiA * Math.sin(angle);
    const z = semiB * Math.cos(angle);
    angles[index] = angle;
    lengths[index] = lengths[index - 1] + Math.hypot(x - previousX, z - previousZ);
    previousX = x;
    previousZ = z;
  }
  return { circumferenceM: lengths[sampleCount], angles, lengths };
}

function ellipseAngleAtSignedArc(signedArcM: number, table: EllipseArcTable): number {
  let target = signedArcM % table.circumferenceM;
  if (target < 0) target += table.circumferenceM;
  let low = 0;
  let high = table.lengths.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (table.lengths[middle] <= target) low = middle;
    else high = middle;
  }
  const span = table.lengths[high] - table.lengths[low];
  const ratio = span > 1e-12 ? (target - table.lengths[low]) / span : 0;
  return table.angles[low] + (table.angles[high] - table.angles[low]) * ratio;
}

interface CycleBoundary {
  seamId: string;
  points: THREE.Vector3[];
}

function seedBodyAwareMultiPanelCycleWrap(
  world: Float64Array,
  initial: Float64Array,
  state: GarmentAssemblyState,
  seams: readonly AssemblyStitchConstraint[],
  anchorParticles: ReadonlyMap<string, number>,
  barrier: Step0BodyBarrier,
  excluded: ReadonlySet<string>,
): Set<string> {
  const graphEdges = new Map<string, [string, string]>();
  const boundaries = new Map<string, Map<string, CycleBoundary>>();
  const addPoint = (instanceId: string, seamId: string, point: THREE.Vector3): void => {
    const bySeam = boundaries.get(instanceId) ?? new Map<string, CycleBoundary>();
    const boundary = bySeam.get(seamId) ?? { seamId, points: [] };
    boundary.points.push(point);
    bySeam.set(seamId, boundary);
    boundaries.set(instanceId, bySeam);
  };
  for (const seam of seams) {
    if (!seam.instanceA || !seam.instanceB || seam.instanceA === seam.instanceB) continue;
    graphEdges.set(seam.seamId, [seam.instanceA, seam.instanceB]);
    addPoint(seam.instanceA, seam.seamId, weightedPointInWorld(initial, seam.a));
    addPoint(seam.instanceB, seam.seamId, weightedPointInWorld(initial, seam.b));
  }
  const graphNodes = new Set([...graphEdges.values()].flat());
  // A tree is an attachment layout, not a closed circumference. Only a real
  // seam-graph cycle is eligible for this isometric cylindrical seed.
  if (graphNodes.size < 2 || graphEdges.size < graphNodes.size) return new Set();

  const plans: Array<{
    instanceId: string;
    axis: THREE.Vector3;
    outward: THREE.Vector3;
    tangent: THREE.Vector3;
    widthM: number;
    anchorParticle: number;
    boundaryCentroids: Map<string, THREE.Vector3>;
    chirality: 1 | -1;
  }> = [];
  for (const instanceId of graphNodes) {
    if (excluded.has(instanceId)) continue;
    const instanceBoundaries = [...(boundaries.get(instanceId)?.values() ?? [])];
    const anchorParticle = anchorParticles.get(instanceId);
    const anchorFrame = anchorParticle === undefined ? null : barrier.frames[anchorParticle];
    if (instanceBoundaries.length < 2 || anchorParticle === undefined || !anchorFrame) continue;
    let first = instanceBoundaries[0];
    let second = instanceBoundaries[1];
    let widest = 0;
    for (let a = 0; a < instanceBoundaries.length; a += 1) {
      for (let b = a + 1; b < instanceBoundaries.length; b += 1) {
        const distance = centroidOfPoints(instanceBoundaries[a].points)
          .distanceTo(centroidOfPoints(instanceBoundaries[b].points));
        if (distance > widest) {
          widest = distance;
          first = instanceBoundaries[a];
          second = instanceBoundaries[b];
        }
      }
    }
    const outward = new THREE.Vector3(...anchorFrame.outwardNormal).normalize();
    const axis = farthestPointDirection(first.points);
    if (axis.lengthSq() <= 1e-10) axis.copy(farthestPointDirection(second.points));
    axis.addScaledVector(outward, -axis.dot(outward));
    if (axis.lengthSq() <= 1e-10) continue;
    axis.normalize();
    const sideDelta = centroidOfPoints(second.points).sub(centroidOfPoints(first.points));
    const tangent = new THREE.Vector3().crossVectors(axis, outward).normalize();
    if (tangent.dot(sideDelta) < 0) tangent.negate();
    const widthM = Math.abs(sideDelta.dot(tangent));
    if (!Number.isFinite(widthM) || widthM <= 0.015) continue;
    plans.push({
      instanceId,
      axis,
      outward,
      tangent,
      widthM,
      anchorParticle,
      boundaryCentroids: new Map(instanceBoundaries.map((boundary) => [
        boundary.seamId,
        centroidOfPoints(boundary.points),
      ])),
      chirality: 1,
    });
  }
  if (plans.length !== graphNodes.size) return new Set();
  const circumferenceM = plans.reduce((sum, plan) => sum + plan.widthM, 0);
  if (!Number.isFinite(circumferenceM) || circumferenceM <= 0.06) return new Set();
  const radiusM = circumferenceM / (Math.PI * 2);
  chooseCycleChiralities(plans, graphEdges, initial, radiusM);
  const wrapped = new Set<string>();
  for (const plan of plans) {
    const instance = state.instances.find((candidate) => candidate.id === plan.instanceId);
    if (!instance) continue;
    wrapInstanceAroundAxis(
      world,
      initial,
      instance.particleStart,
      instance.vertexCount,
      plan.anchorParticle,
      plan.axis,
      plan.outward,
      plan.tangent,
      radiusM,
      plan.chirality,
    );
    wrapped.add(plan.instanceId);
  }
  return wrapped;
}

function wrapInstanceAroundAxis(
  world: Float64Array,
  initial: Float64Array,
  particleStart: number,
  vertexCount: number,
  anchorParticle: number,
  axis: THREE.Vector3,
  outward: THREE.Vector3,
  tangent: THREE.Vector3,
  radiusM: number,
  chirality: 1 | -1 = 1,
): void {
  const anchor = particlePoint(initial, anchorParticle);
  const centre = anchor.clone().addScaledVector(outward, -radiusM);
  const relative = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const aroundTangent = new THREE.Vector3().crossVectors(axis, outward).normalize();
  const target = new THREE.Vector3();
  for (let local = 0; local < vertexCount; local += 1) {
    const particle = particleStart + local;
    relative.copy(particlePoint(initial, particle)).sub(anchor);
    const axial = relative.dot(axis);
    const materialU = relative.dot(tangent);
    const normalOffset = relative.dot(outward);
    const angle = materialU / radiusM;
    radial.copy(outward).multiplyScalar(Math.cos(angle))
      .addScaledVector(aroundTangent, Math.sin(angle) * chirality)
      .multiplyScalar(radiusM + normalOffset);
    target.copy(centre).addScaledVector(axis, axial).add(radial);
    const offset = particle * 3;
    world[offset] = target.x;
    world[offset + 1] = target.y;
    world[offset + 2] = target.z;
  }
}

function chooseCycleChiralities(
  plans: Array<{
    instanceId: string;
    axis: THREE.Vector3;
    outward: THREE.Vector3;
    tangent: THREE.Vector3;
    anchorParticle: number;
    boundaryCentroids: Map<string, THREE.Vector3>;
    chirality: 1 | -1;
  }>,
  graphEdges: ReadonlyMap<string, [string, string]>,
  initial: Float64Array,
  radiusM: number,
): void {
  if (plans.length <= 1 || plans.length > 12) return;
  const byId = new Map(plans.map((plan) => [plan.instanceId, plan]));
  let bestMask = 0;
  let bestError = Number.POSITIVE_INFINITY;
  const combinations = 2 ** (plans.length - 1);
  for (let mask = 0; mask < combinations; mask += 1) {
    let error = 0;
    for (const [seamId, [firstId, secondId]] of graphEdges) {
      const first = byId.get(firstId);
      const second = byId.get(secondId);
      const firstPoint = first?.boundaryCentroids.get(seamId);
      const secondPoint = second?.boundaryCentroids.get(seamId);
      if (!first || !second || !firstPoint || !secondPoint) continue;
      const firstSign: 1 | -1 = plans.indexOf(first) === 0 || (mask & (1 << (plans.indexOf(first) - 1))) === 0 ? 1 : -1;
      const secondSign: 1 | -1 = plans.indexOf(second) === 0 || (mask & (1 << (plans.indexOf(second) - 1))) === 0 ? 1 : -1;
      error += mapCycleSeedPoint(first, firstPoint, initial, radiusM, firstSign)
        .distanceToSquared(mapCycleSeedPoint(second, secondPoint, initial, radiusM, secondSign));
    }
    if (error < bestError) {
      bestError = error;
      bestMask = mask;
    }
  }
  plans.forEach((plan, index) => {
    plan.chirality = index === 0 || (bestMask & (1 << (index - 1))) === 0 ? 1 : -1;
  });
}

function mapCycleSeedPoint(
  plan: {
    axis: THREE.Vector3;
    outward: THREE.Vector3;
    tangent: THREE.Vector3;
    anchorParticle: number;
  },
  source: THREE.Vector3,
  initial: Float64Array,
  radiusM: number,
  chirality: 1 | -1,
): THREE.Vector3 {
  const anchor = particlePoint(initial, plan.anchorParticle);
  const relative = source.clone().sub(anchor);
  const angle = relative.dot(plan.tangent) / radiusM;
  const aroundTangent = new THREE.Vector3().crossVectors(plan.axis, plan.outward).normalize();
  const radial = plan.outward.clone().multiplyScalar(Math.cos(angle))
    .addScaledVector(aroundTangent, Math.sin(angle) * chirality)
    .multiplyScalar(radiusM + relative.dot(plan.outward));
  return anchor.clone().addScaledVector(plan.outward, -radiusM)
    .addScaledVector(plan.axis, relative.dot(plan.axis))
    .add(radial);
}

function centroidOfPoints(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const centroid = new THREE.Vector3();
  for (const point of points) centroid.add(point);
  return points.length > 0 ? centroid.multiplyScalar(1 / points.length) : centroid;
}

function farthestPointDirection(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const direction = new THREE.Vector3();
  let farthestSq = 0;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      const distanceSq = points[a].distanceToSquared(points[b]);
      if (distanceSq > farthestSq) {
        farthestSq = distanceSq;
        direction.copy(points[b]).sub(points[a]);
      }
    }
  }
  return direction;
}

function refreshStep0BodyBarrierFrames(
  barrier: Step0BodyBarrier,
  world: Float64Array,
  particleStart: number,
  vertexCount: number,
): void {
  const point = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let local = 0; local < vertexCount; local += 1) {
    const particle = particleStart + local;
    const offset = particle * 3;
    point.set(world[offset], world[offset + 1], world[offset + 2]);
    const frame = closestBodySurfacePoint(barrier.body, [point.x, point.y, point.z], 0, barrier.queryDistanceM);
    if (!frame) continue;
    barrier.frames[particle] = frame;
    surface.set(...frame.position);
    normal.set(...frame.outwardNormal).normalize();
    const signed = point.clone().sub(surface).dot(normal);
    barrier.minimumClearanceM[particle] = Math.min(
      barrier.requestedClearanceM,
      Math.max(0, signed),
    );
  }
}

function cageParticleDisplacements(
  world: Float64Array,
  initial: Float64Array,
  filled: Uint8Array,
  maximumM: number | Float64Array,
): void {
  for (let particle = 0; particle < filled.length; particle += 1) {
    if (filled[particle] !== 1) continue;
    const offset = particle * 3;
    const dx = world[offset] - initial[offset];
    const dy = world[offset + 1] - initial[offset + 1];
    const dz = world[offset + 2] - initial[offset + 2];
    const distance = Math.hypot(dx, dy, dz);
    const particleMaximumM = typeof maximumM === "number" ? maximumM : maximumM[particle];
    if (distance <= particleMaximumM || distance <= 1e-12) continue;
    const scale = particleMaximumM / distance;
    world[offset] = initial[offset] + dx * scale;
    world[offset + 1] = initial[offset + 1] + dy * scale;
    world[offset + 2] = initial[offset + 2] + dz * scale;
  }
}

function cageAnchorParticle(
  world: Float64Array,
  particle: number,
  original: THREE.Vector3,
  maximumM: number,
): void {
  const offset = particle * 3;
  const correction = new THREE.Vector3(
    world[offset] - original.x,
    world[offset + 1] - original.y,
    world[offset + 2] - original.z,
  );
  const distance = correction.length();
  if (distance <= maximumM || distance <= 1e-12) return;
  correction.multiplyScalar(maximumM / distance);
  world[offset] = original.x + correction.x;
  world[offset + 1] = original.y + correction.y;
  world[offset + 2] = original.z + correction.z;
}

function nearestInstanceParticle(
  world: Float64Array,
  particleStart: number,
  vertexCount: number,
  point: THREE.Vector3,
): number {
  let nearest = particleStart;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (let local = 0; local < vertexCount; local += 1) {
    const particle = particleStart + local;
    const distanceSq = particlePoint(world, particle).distanceToSquared(point);
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      nearest = particle;
    }
  }
  return nearest;
}

function particlePoint(world: Float64Array, particle: number): THREE.Vector3 {
  const offset = particle * 3;
  return new THREE.Vector3(world[offset], world[offset + 1], world[offset + 2]);
}

function instanceParticleCentroid(
  world: Float64Array,
  particleStart: number,
  vertexCount: number,
): THREE.Vector3 {
  const centroid = new THREE.Vector3();
  if (vertexCount <= 0) return centroid;
  for (let local = 0; local < vertexCount; local += 1) {
    const offset = (particleStart + local) * 3;
    centroid.x += world[offset];
    centroid.y += world[offset + 1];
    centroid.z += world[offset + 2];
  }
  return centroid.multiplyScalar(1 / vertexCount);
}

function particleDistance(world: Float64Array, a: number, b: number): number {
  const aOffset = a * 3;
  const bOffset = b * 3;
  return Math.hypot(
    world[bOffset] - world[aOffset],
    world[bOffset + 1] - world[aOffset + 1],
    world[bOffset + 2] - world[aOffset + 2],
  );
}

function particleDisplacement(world: Float64Array, initial: Float64Array, particle: number): number {
  const offset = particle * 3;
  return Math.hypot(
    world[offset] - initial[offset],
    world[offset + 1] - initial[offset + 1],
    world[offset + 2] - initial[offset + 2],
  );
}

function measureResidualInWorld(
  world: Float64Array,
  seams: readonly AssemblyStitchConstraint[],
): SewingStep0ResidualMetric {
  let maximumM = 0;
  let totalM = 0;
  let evaluated = 0;
  const buckets = new Map<string, { maximumM: number; totalM: number; evaluated: number }>();
  for (const seam of seams) {
    const distance = weightedPointInWorld(world, seam.a).distanceTo(weightedPointInWorld(world, seam.b));
    const residual = Math.abs(distance - Math.max(0, seam.physicalRestDistance ?? 0));
    maximumM = Math.max(maximumM, residual);
    totalM += residual;
    evaluated += 1;
    const bucket = buckets.get(seam.seamId) ?? { maximumM: 0, totalM: 0, evaluated: 0 };
    bucket.maximumM = Math.max(bucket.maximumM, residual);
    bucket.totalM += residual;
    bucket.evaluated += 1;
    buckets.set(seam.seamId, bucket);
  }
  return {
    maximumM,
    meanM: evaluated > 0 ? totalM / evaluated : 0,
    evaluated,
    bySeam: Object.fromEntries([...buckets].map(([id, bucket]) => [id, {
      maximumM: bucket.maximumM,
      meanM: bucket.evaluated > 0 ? bucket.totalM / bucket.evaluated : 0,
      evaluated: bucket.evaluated,
    }])),
  };
}

export function syncMeshGeometryToAssemblyState(
  state: GarmentAssemblyState,
  meshData: GarmentAssemblyMeshData,
): boolean {
  const instance = state.instances.find((candidate) => candidate.id === meshData.key);
  const position = meshData.mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!instance || !position || position.count !== instance.vertexCount) return false;
  const local = new Float32Array(instance.vertexCount * 3);
  for (let index = 0; index < instance.vertexCount; index += 1) {
    local[index * 3] = position.getX(index);
    local[index * 3 + 1] = position.getY(index);
    local[index * 3 + 2] = position.getZ(index);
  }
  writeInstancePositions(state, instance.id, local);
  meshData.dressed.set(local);
  return true;
}

export function bakeWorldGeometryIntoAuthoredTransform(
  mesh: THREE.Mesh,
  originalMatrixWorld: THREE.Matrix4,
  originalPosition: THREE.Vector3,
  originalQuaternion: THREE.Quaternion,
  originalScale: THREE.Vector3,
): void {
  mesh.updateMatrixWorld(true);
  const afterMatrixWorld = mesh.matrixWorld.clone();
  const originalWorldInverse = originalMatrixWorld.clone().invert();
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index)
      .applyMatrix4(afterMatrixWorld)
      .applyMatrix4(originalWorldInverse);
    position.setXYZ(index, point.x, point.y, point.z);
  }
  position.needsUpdate = true;
  mesh.position.copy(originalPosition);
  mesh.quaternion.copy(originalQuaternion);
  mesh.scale.copy(originalScale);
  mesh.updateMatrixWorld(true);
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

function writeInstancePositions(state: GarmentAssemblyState, instanceId: string, local: Float32Array): void {
  const instance = state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance || local.length !== instance.vertexCount * 3) return;
  const start = instance.particleStart * 3;
  state.positions.set(local, start);
  state.previousPositions.set(local, start);
}

function sliceInstancePositions(state: GarmentAssemblyState, instanceId: string): Float32Array | null {
  const instance = state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) return null;
  const start = instance.particleStart * 3;
  const end = start + instance.vertexCount * 3;
  if (end > state.positions.length) return null;
  return new Float32Array(state.positions.slice(start, end));
}

function worldPositions(mesh: THREE.Mesh): Float32Array {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  mesh.updateMatrixWorld(true);
  const result = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    result[index * 3] = point.x;
    result[index * 3 + 1] = point.y;
    result[index * 3 + 2] = point.z;
  }
  return result;
}

function centroidOfPositions(positions: Float32Array): THREE.Vector3 {
  const centroid = new THREE.Vector3();
  const count = Math.floor(positions.length / 3);
  if (count === 0) return centroid;
  for (let offset = 0; offset < count * 3; offset += 3) {
    centroid.x += positions[offset];
    centroid.y += positions[offset + 1];
    centroid.z += positions[offset + 2];
  }
  return centroid.multiplyScalar(1 / count);
}

function firstStableTriangleFrame(
  positions: Float32Array,
  triangles: Uint16Array | Uint32Array,
  preferredVertex?: number,
): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3 } | null {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const preferAnchor of preferredVertex === undefined ? [false] : [true, false]) {
    for (let offset = 0; offset + 2 < triangles.length; offset += 3) {
      if (preferAnchor
        && triangles[offset] !== preferredVertex
        && triangles[offset + 1] !== preferredVertex
        && triangles[offset + 2] !== preferredVertex) continue;
      readPoint(positions, triangles[offset], a);
      readPoint(positions, triangles[offset + 1], b);
      readPoint(positions, triangles[offset + 2], c);
      const x = b.clone().sub(a);
      const side = c.clone().sub(a);
      const z = new THREE.Vector3().crossVectors(x, side);
      if (x.lengthSq() <= 1e-12 || z.lengthSq() <= 1e-12) continue;
      x.normalize();
      z.normalize();
      const y = new THREE.Vector3().crossVectors(z, x).normalize();
      return { x, y, z };
    }
  }
  return null;
}

function readPoint(positions: Float32Array, index: number, target: THREE.Vector3): void {
  const offset = index * 3;
  target.set(positions[offset], positions[offset + 1], positions[offset + 2]);
}
