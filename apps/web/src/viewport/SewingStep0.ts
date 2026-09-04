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
  if (bodyBarrier) {
    const wrapped = seedBodyAwareSelfSeamWrap(world, initial, state, seams, anchorParticles, bodyBarrier);
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
  cageParticleDisplacements(world, initial, filled, displacementBudgets);
}

const solveFinishedAt = step0Now();

// Final material polish is repeated inside the displacement cage so the
// last safety clamp cannot leave the panel visibly stretched.
for (let pass = 0; pass < 36; pass += 1) {
  projectStructuralMetric(world, structural, structuralTargets, pass % 2 === 1, 0.997);
  if (bodyBarrier && pass % 3 === 2) projectStep0BodyBarrier(world, filled, bodyBarrier, 0.8);
  cageParticleDisplacements(world, initial, filled, displacementBudgets);
}
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
  cageParticleDisplacements(world, initial, filled, displacementBudgets);
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
    maximumCentroid = Math.max(
      maximumCentroid,
      particlePoint(world, anchorParticles.get(instanceId)!)
        .distanceTo(initialAnchors.get(instanceId)!),
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
    const axis = lastA.clone().sub(firstA);
    if (axis.lengthSq() <= 1e-10) axis.copy(lastB).sub(firstB);
    const outward = new THREE.Vector3(...anchorFrame.outwardNormal).normalize();
    axis.addScaledVector(outward, -axis.dot(outward));
    if (axis.lengthSq() <= 1e-10) continue;
    axis.normalize();

    const sideA = new THREE.Vector3();
    const sideB = new THREE.Vector3();
    for (const seam of ordered) {
      sideA.add(weightedPointInWorld(initial, seam.a));
      sideB.add(weightedPointInWorld(initial, seam.b));
    }
    sideA.multiplyScalar(1 / ordered.length);
    sideB.multiplyScalar(1 / ordered.length);
    const sideDelta = sideB.clone().sub(sideA);
    const tangent = new THREE.Vector3().crossVectors(axis, outward).normalize();
    if (tangent.dot(sideDelta) < 0) tangent.negate();
    const circumferenceM = Math.abs(sideDelta.dot(tangent));
    if (!Number.isFinite(circumferenceM) || circumferenceM <= 0.03) continue;
    const radiusM = circumferenceM / (Math.PI * 2);
    const anchor = particlePoint(initial, anchorParticle);
    const centre = anchor.clone().addScaledVector(outward, -radiusM);
    const relative = new THREE.Vector3();
    const radial = new THREE.Vector3();
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const particle = instance.particleStart + local;
      const source = particlePoint(initial, particle);
      relative.copy(source).sub(anchor);
      const axial = relative.dot(axis);
      const materialU = relative.dot(tangent);
      const normalOffset = relative.dot(outward);
      const angle = materialU / radiusM;
      radial.copy(outward).multiplyScalar(Math.cos(angle))
        .addScaledVector(tangent, Math.sin(angle))
        .multiplyScalar(radiusM + normalOffset);
      const target = centre.clone().addScaledVector(axis, axial).add(radial);
      const offset = particle * 3;
      world[offset] = target.x;
      world[offset + 1] = target.y;
      world[offset + 2] = target.z;
    }
    wrapped.add(instanceId);
  }
  return wrapped;
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
    barrier.minimumClearanceM[particle] = Math.min(0.006, Math.max(0, signed));
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
