import * as THREE from "three";
import { closestBodySurfacePoint, type BodySurfaceFrame } from "../avatar/BodySurfaceQuery";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import type { AssemblyStitchConstraint, GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";
import { connectedSewingInstanceIds } from "./SewingInteraction";

export type SewingStep0Status =
  | "applied"
  | "no-seams"
  | "needs-placement"
  | "too-far"
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

export interface SewingStep0Registration {
  rotation: THREE.Quaternion;
  solvedRootCentroid: THREE.Vector3;
  currentRootCentroid: THREE.Vector3;
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
): SewingStep0Registration | null {
  if (solvedRootPositions.length !== currentRootWorldPositions.length || solvedRootPositions.length < 9) return null;
  const solvedFrame = firstStableTriangleFrame(solvedRootPositions, triangles);
  const currentFrame = firstStableTriangleFrame(currentRootWorldPositions, triangles);
  if (!solvedFrame || !currentFrame) return null;

  const solvedBasis = new THREE.Matrix4().makeBasis(solvedFrame.x, solvedFrame.y, solvedFrame.z);
  const currentBasis = new THREE.Matrix4().makeBasis(currentFrame.x, currentFrame.y, currentFrame.z);
  const solvedQuaternion = new THREE.Quaternion().setFromRotationMatrix(solvedBasis);
  const currentQuaternion = new THREE.Quaternion().setFromRotationMatrix(currentBasis);
  const rotation = currentQuaternion.multiply(solvedQuaternion.invert()).normalize();
  return {
    rotation,
    solvedRootCentroid: centroidOfPositions(solvedRootPositions),
    currentRootCentroid: centroidOfPositions(currentRootWorldPositions),
  };
}

export function transformSewingStep0Point(
  point: THREE.Vector3,
  registration: SewingStep0Registration,
): THREE.Vector3 {
  return point
    .clone()
    .sub(registration.solvedRootCentroid)
    .applyQuaternion(registration.rotation)
    .add(registration.currentRootCentroid);
}

export function applySewingStep0SolvedComponent(
  currentState: GarmentAssemblyState,
  solvedState: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  target: SewingStep0Target,
  maximumCentroidDisplacementM = 0.45,
): { appliedIds: string[]; maximumCentroidDisplacementM: number } | null {
  const currentRootMesh = meshes.find((item) => item.key === target.rootInstanceId);
  const solvedRoot = solvedState.instances.find((instance) => instance.id === target.rootInstanceId);
  if (!currentRootMesh || !solvedRoot) return null;
  const solvedRootPositions = sliceInstancePositions(solvedState, solvedRoot.id);
  const currentRootWorldPositions = worldPositions(currentRootMesh.mesh);
  if (!solvedRootPositions) return null;
  const registration = buildSewingStep0Registration(
    solvedRootPositions,
    currentRootWorldPositions,
    solvedRoot.topology.triangles,
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
  return { appliedIds: [...pending.keys()], maximumCentroidDisplacementM: maximumDisplacement };
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
  iterations: number;
  seamConstraintCount: number;
  bodyBarrierCorrections: number;
  bodyHemisphereRejects: number;
  minimumBodyClearanceM: number | null;
  phaseTimingsMs: {
    setup: number;
    solve: number;
    materialPolish: number;
    serialize: number;
  };
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

  const beforeResidual = measureResidualInWorld(world, seams);
  const bodyBarrier = options.body
    ? buildStep0BodyBarrier(
      options.body,
      initial,
      filled,
      options.bodyClearanceM ?? 0.006,
      options.bodyQueryDistanceM ?? 0.24,
    )
    : null;
  const initialCentroids = new Map<string, THREE.Vector3>();
  for (const instanceId of target.instanceIds) {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return null;
    initialCentroids.set(instanceId, instanceParticleCentroid(initial, instance.particleStart, instance.vertexCount));
  }

  const setupFinishedAt = step0Now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
  const reverse = iteration % 2 === 1;
  // Material metric is the hard geometric contract. Multiple alternating
  // sweeps make each seam pull behave as bending/rigid reorientation rather
  // than stretching a boundary toward its mate.
  for (let pass = 0; pass < 3; pass += 1) {
    projectStructuralMetric(world, structural, structuralTargets, (pass % 2 === 0) ? reverse : !reverse, 0.985);
  }
  projectSeamRelations(world, seams, reverse, seamRelaxation * 0.42);
  for (let pass = 0; pass < 5; pass += 1) {
    projectStructuralMetric(world, structural, structuralTargets, (pass % 2 === 0) ? !reverse : reverse, 0.992);
  }
  projectSeamRelations(world, seams, !reverse, seamRelaxation * 0.14);
  for (let pass = 0; pass < 3; pass += 1) {
    projectStructuralMetric(world, structural, structuralTargets, (pass % 2 === 0) ? reverse : !reverse, 0.995);
  }
  if (bodyBarrier) projectStep0BodyBarrier(world, filled, bodyBarrier, 0.65);

  // Keep every panel in the neighbourhood explicitly chosen by the user.
  // A tiny spring removes accumulated numerical drift; the hard cage below
  // is the actual safety contract.
  for (const instanceId of target.instanceIds) {
    const instance = state.instances.find((candidate) => candidate.id === instanceId)!;
    const originalCentroid = initialCentroids.get(instanceId)!;
    const centroid = instanceParticleCentroid(world, instance.particleStart, instance.vertexCount);
    const drift = centroid.sub(originalCentroid);
    translateInstanceParticles(world, instance.particleStart, instance.vertexCount, drift.multiplyScalar(-0.012));
    cageInstanceCentroid(
      world,
      instance.particleStart,
      instance.vertexCount,
      originalCentroid,
      maximumCentroidDisplacementM,
    );
  }
  cageParticleDisplacements(world, initial, filled, maximumVertexDisplacementM);
}

const solveFinishedAt = step0Now();

// Final material polish is repeated inside the displacement cage so the
// last safety clamp cannot leave the panel visibly stretched.
for (let pass = 0; pass < 36; pass += 1) {
  projectStructuralMetric(world, structural, structuralTargets, pass % 2 === 1, 0.997);
  if (bodyBarrier && pass % 3 === 2) projectStep0BodyBarrier(world, filled, bodyBarrier, 0.8);
  cageParticleDisplacements(world, initial, filled, maximumVertexDisplacementM);
}
for (const instanceId of target.instanceIds) {
  const instance = state.instances.find((candidate) => candidate.id === instanceId)!;
  cageInstanceCentroid(
    world,
    instance.particleStart,
    instance.vertexCount,
    initialCentroids.get(instanceId)!,
    maximumCentroidDisplacementM,
  );
}
if (bodyBarrier) {
  projectStep0BodyBarrier(world, filled, bodyBarrier, 1);
  cageParticleDisplacements(world, initial, filled, maximumVertexDisplacementM);
}
const polishFinishedAt = step0Now();

  const afterResidual = measureResidualInWorld(world, seams);
  let maximumVertex = 0;
  for (let particle = 0; particle < filled.length; particle += 1) {
    if (filled[particle] !== 1) continue;
    maximumVertex = Math.max(maximumVertex, particleDisplacement(world, initial, particle));
  }
  let maximumCentroid = 0;
  for (const instanceId of target.instanceIds) {
    const instance = state.instances.find((candidate) => candidate.id === instanceId)!;
    maximumCentroid = Math.max(
      maximumCentroid,
      instanceParticleCentroid(world, instance.particleStart, instance.vertexCount)
        .distanceTo(initialCentroids.get(instanceId)!),
    );
  }

  let metricDistortionMax = 0;
  structural.forEach((constraint, index) => {
    const rest = structuralTargets[index];
    if (rest <= 1e-9) return;
    metricDistortionMax = Math.max(
      metricDistortionMax,
      Math.abs(particleDistance(world, constraint.a, constraint.b) - rest) / rest,
    );
  });

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
    iterations,
    seamConstraintCount: seams.length,
    bodyBarrierCorrections: bodyBarrier?.corrections ?? 0,
    bodyHemisphereRejects: bodyBarrier?.hemisphereRejects ?? 0,
    minimumBodyClearanceM: bodyBarrier ? measureStep0BodyClearance(world, filled, bodyBarrier) : null,
    phaseTimingsMs: {
      setup: setupFinishedAt - startedAt,
      solve: solveFinishedAt - setupFinishedAt,
      materialPolish: polishFinishedAt - solveFinishedAt,
      serialize: serializedAt - polishFinishedAt,
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
  const built = buildCurrentWorldParticles(state, meshes, new Set(target.instanceIds));
  if (!built) return null;
  let maximum = 0;
  for (const constraint of state.structuralConstraints) {
    if (built.filled[constraint.a] !== 1 || built.filled[constraint.b] !== 1 || constraint.restLength <= 1e-9) continue;
    maximum = Math.max(
      maximum,
      Math.abs(particleDistance(built.world, constraint.a, constraint.b) - constraint.restLength) / constraint.restLength,
    );
  }
  return maximum;
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

function cageParticleDisplacements(
  world: Float64Array,
  initial: Float64Array,
  filled: Uint8Array,
  maximumM: number,
): void {
  for (let particle = 0; particle < filled.length; particle += 1) {
    if (filled[particle] !== 1) continue;
    const offset = particle * 3;
    const dx = world[offset] - initial[offset];
    const dy = world[offset + 1] - initial[offset + 1];
    const dz = world[offset + 2] - initial[offset + 2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= maximumM || distance <= 1e-12) continue;
    const scale = maximumM / distance;
    world[offset] = initial[offset] + dx * scale;
    world[offset + 1] = initial[offset + 1] + dy * scale;
    world[offset + 2] = initial[offset + 2] + dz * scale;
  }
}

function cageInstanceCentroid(
  world: Float64Array,
  particleStart: number,
  vertexCount: number,
  original: THREE.Vector3,
  maximumM: number,
): void {
  const centroid = instanceParticleCentroid(world, particleStart, vertexCount);
  const drift = centroid.sub(original);
  const distance = drift.length();
  if (distance <= maximumM || distance <= 1e-12) return;
  const correction = drift.multiplyScalar(-(distance - maximumM) / distance);
  translateInstanceParticles(world, particleStart, vertexCount, correction);
}

function translateInstanceParticles(
  world: Float64Array,
  particleStart: number,
  vertexCount: number,
  correction: THREE.Vector3,
): void {
  for (let local = 0; local < vertexCount; local += 1) {
    const offset = (particleStart + local) * 3;
    world[offset] += correction.x;
    world[offset + 1] += correction.y;
    world[offset + 2] += correction.z;
  }
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
): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3 } | null {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let offset = 0; offset + 2 < triangles.length; offset += 3) {
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
  return null;
}

function readPoint(positions: Float32Array, index: number, target: THREE.Vector3): void {
  const offset = index * 3;
  target.set(positions[offset], positions[offset + 1], positions[offset + 2]);
}
