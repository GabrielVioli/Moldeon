from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


step0_path = Path("apps/web/src/viewport/SewingStep0.ts")
step0_text = step0_path.read_text(encoding="utf-8")
anchor = "export function syncMeshGeometryToAssemblyState(\n"
if anchor not in step0_text:
    raise SystemExit("SewingStep0 sync anchor not found")

helper = r'''
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
  const structuralTargets = structural.map((constraint) => particleDistance(world, constraint.a, constraint.b));
  const seams = state.stitchConstraints.filter((constraint) =>
    !constraint.seamGroupId.startsWith("dart:")
    && Boolean(constraint.instanceA && targetIds.has(constraint.instanceA))
    && Boolean(constraint.instanceB && targetIds.has(constraint.instanceB))
    && referenceIsFilled(constraint.a, filled)
    && referenceIsFilled(constraint.b, filled),
  );
  if (seams.length === 0) return null;

  const beforeResidual = measureResidualInWorld(world, seams);
  const initialCentroids = new Map<string, THREE.Vector3>();
  for (const instanceId of target.instanceIds) {
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return null;
    initialCentroids.set(instanceId, instanceParticleCentroid(initial, instance.particleStart, instance.vertexCount));
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const reverse = iteration % 2 === 1;
    projectStructuralMetric(world, structural, structuralTargets, reverse, 0.92);
    projectSeamRelations(world, seams, reverse, seamRelaxation);
    projectStructuralMetric(world, structural, structuralTargets, !reverse, 0.92);
    projectSeamRelations(world, seams, !reverse, seamRelaxation * 0.52);

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

  // Finish with the material metric so STEP-0 never leaves a visibly stretched
  // boundary just because it was the last constraint touched.
  projectStructuralMetric(world, structural, structuralTargets, false, 0.96);
  cageParticleDisplacements(world, initial, filled, maximumVertexDisplacementM);
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

  return {
    positionsByInstanceId,
    beforeResidual,
    afterResidual,
    maximumVertexDisplacementM: maximumVertex,
    maximumCentroidDisplacementM: maximumCentroid,
    metricDistortionMax,
    iterations,
    seamConstraintCount: seams.length,
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
    const magnitude = Math.min(0.006, (current - target) * 0.5 * relaxation);
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
    const magnitude = Math.max(-0.0025, Math.min(0.0025, (current - target) * 0.5 * relaxation));
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

'''
step0_text = step0_text.replace(anchor, helper + anchor, 1)
step0_path.write_text(step0_text, encoding="utf-8")

replace_once(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    '''import {
  applySewingStep0SolvedComponent,
  bakeWorldGeometryIntoAuthoredTransform,
  meshWorldCentroid as sewingStep0MeshWorldCentroid,
  resolveSewingStep0Target,
  syncMeshGeometryToAssemblyState,
  type SewingStep0RunResult,
} from "./SewingStep0";''',
    '''import {
  bakeWorldGeometryIntoAuthoredTransform,
  measureCurrentSewingStep0MaterialDistortion,
  measureCurrentSewingStep0Residual,
  meshWorldCentroid as sewingStep0MeshWorldCentroid,
  resolveSewingStep0Target,
  solvePlacementAnchoredSewingStep0,
  syncMeshGeometryToAssemblyState,
  type SewingStep0RunResult,
} from "./SewingStep0";''',
)

global_path = Path("apps/web/src/viewport/GlobalThreeViewport.ts")
global_text = global_path.read_text(encoding="utf-8")
start = global_text.find("  async runSewingStep0(")
end = global_text.find('  rotateArrangementSelection(axis: Exclude<ArrangementAxis, "free">', start)
if start < 0 or end < 0:
    raise SystemExit("runSewingStep0 method range not found")

new_method = r'''  async runSewingStep0(
    selectedSeamId: string | null = this.sewingState.selectedSeamId,
  ): Promise<SewingStep0RunResult> {
    const input = this.currentInput;
    const state = this.assemblyState;
    const avatar = this.currentAvatarModel;
    if (this.viewportMode !== "assembly" || !input || !state || !avatar) {
      return { status: "failed", affectedPanels: 0, warning: "Montagem 3D ainda não está pronta." };
    }
    const target = resolveSewingStep0Target(
      state.stitchConstraints,
      selectedSeamId,
      [...this.selectedInstanceIds],
    );
    if (!target) return { status: "no-seams", affectedPanels: 0 };

    const targetIds = new Set(target.instanceIds);
    const missingPlacement = input.panelInstances.some((instance) =>
      targetIds.has(instance.id)
      && (instance.placementStatus !== "confirmed" || !instance.arrangementAnchor),
    );
    if (missingPlacement) {
      return { status: "needs-placement", affectedPanels: target.instanceIds.length };
    }

    const body = avatar.humanBody.visualMesh;
    prepareBodySurfaceQuery(body);
    const snapshots = new Map<string, {
      item: GarmentAssemblyMeshData;
      positions: Float32Array;
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: THREE.Vector3;
      matrixWorld: THREE.Matrix4;
      centroid: THREE.Vector3;
      surface: BodySurfaceFrame;
      bodyAudit: ReturnType<typeof auditMeshBodyClearance>;
    }>();
    for (const instanceId of target.instanceIds) {
      const item = this.garmentMeshes.find((candidate) => candidate.key === instanceId);
      if (!item) return { status: "failed", affectedPanels: target.instanceIds.length };
      const centroid = sewingStep0MeshWorldCentroid(item.mesh);
      const surface = closestBodySurfacePoint(body, [centroid.x, centroid.y, centroid.z], 0, 0.24);
      if (!surface) return { status: "too-far", affectedPanels: target.instanceIds.length };
      const position = item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      item.mesh.updateMatrixWorld(true);
      snapshots.set(instanceId, {
        item,
        positions: new Float32Array(position.array as Float32Array),
        position: item.mesh.position.clone(),
        quaternion: item.mesh.quaternion.clone(),
        scale: item.mesh.scale.clone(),
        matrixWorld: item.mesh.matrixWorld.clone(),
        centroid,
        surface,
        bodyAudit: auditMeshBodyClearance(item.mesh, body, 0.5, 112),
      });
    }

    const restoreSnapshots = (): void => {
      for (const snapshot of snapshots.values()) {
        restoreMeshMaterialGeometry(snapshot.item.mesh, snapshot.positions);
        snapshot.item.mesh.position.copy(snapshot.position);
        snapshot.item.mesh.quaternion.copy(snapshot.quaternion);
        snapshot.item.mesh.scale.copy(snapshot.scale);
        snapshot.item.mesh.updateMatrixWorld(true);
      }
      this.refreshSewingOverlay();
      this.requestRender();
    };

    // Costurar/Montar remains geometric-only. This operation never delegates
    // placement to the old global candidate solver and never wakes XPBD.
    this.simulation.pause();
    const geometryRevision = input.geometryRevision;
    const sewingRevision = input.sewingRevision;
    const arrangementRevision = input.arrangementRevision;
    const startedAt = performance.now();
    const materialBefore = measureCurrentSewingStep0MaterialDistortion(state, this.garmentMeshes, target) ?? 0;
    this.host.dataset.sewingStep0Status = "solving-local";
    this.host.dataset.sewingStep0Target = JSON.stringify(target.instanceIds);

    // Give React one paint so the busy label is visible even though the local
    // bounded solve is normally far faster than the old Worker solve.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const current = this.currentInput;
    if (!current
      || current.geometryRevision !== geometryRevision
      || current.sewingRevision !== sewingRevision
      || current.arrangementRevision !== arrangementRevision
      || this.viewportMode !== "assembly") {
      this.host.dataset.sewingStep0Status = "stale";
      return { status: "stale", affectedPanels: target.instanceIds.length };
    }

    try {
      const proposal = solvePlacementAnchoredSewingStep0(
        state,
        this.garmentMeshes,
        target,
        {
          iterations: 72,
          maximumVertexDisplacementM: 0.065,
          maximumCentroidDisplacementM: 0.018,
          seamRelaxation: 0.58,
        },
      );
      if (!proposal || proposal.seamConstraintCount === 0) {
        this.host.dataset.sewingStep0Status = "failed";
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: "As costuras ativas não produziram correspondências físicas utilizáveis.",
        };
      }

      // A proposal that cannot even improve the current sewing residual is not
      // allowed to touch the viewport. This is an atomic safety gate.
      const proposalImproves = proposal.beforeResidual.meanM <= 0.0015
        || proposal.afterResidual.meanM <= proposal.beforeResidual.meanM * 0.985
        || proposal.afterResidual.meanM <= proposal.beforeResidual.meanM - 0.0005;
      if (!proposalImproves || proposal.metricDistortionMax > 0.02) {
        this.host.dataset.sewingStep0Status = "rejected-local-solve";
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: "Não encontrei uma aproximação segura que preserve o molde e o placement atual.",
        };
      }

      for (const [instanceId, local] of proposal.positionsByInstanceId) {
        const snapshot = snapshots.get(instanceId);
        if (!snapshot) continue;
        const attribute = snapshot.item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        if (attribute.count * 3 !== local.length) {
          restoreSnapshots();
          return { status: "failed", affectedPanels: target.instanceIds.length, warning: "Topologia mudou durante o STEP-0." };
        }
        (attribute.array as Float32Array).set(local);
        attribute.needsUpdate = true;
        snapshot.item.mesh.geometry.computeVertexNormals();
        snapshot.item.mesh.geometry.computeBoundingBox();
        snapshot.item.mesh.geometry.computeBoundingSphere();
      }

      let conformedPanels = 0;
      const bodyAudits: Record<string, unknown> = {};
      let unsafeReason: string | null = null;
      let maximumCentroidDisplacementM = 0;
      for (const instanceId of target.instanceIds) {
        const snapshot = snapshots.get(instanceId)!;
        const item = snapshot.item;
        const conform = adjustMeshToBodySurface(item.mesh, body, snapshot.surface.attachment, undefined, {
          clearanceMm: 10,
          captureDistanceMm: 90,
          maximumVertexProjectionDistanceMm: 90,
          maximumMetricDistortion: 0.025,
          minimumProjectedVertexRatio: 0.2,
        });
        if (conform.conformed) {
          bakeWorldGeometryIntoAuthoredTransform(
            item.mesh,
            snapshot.matrixWorld,
            snapshot.position,
            snapshot.quaternion,
            snapshot.scale,
          );
          conformedPanels += 1;
        }

        const finalCentroid = sewingStep0MeshWorldCentroid(item.mesh);
        const centroidDisplacement = finalCentroid.distanceTo(snapshot.centroid);
        maximumCentroidDisplacementM = Math.max(maximumCentroidDisplacementM, centroidDisplacement);
        const finalSurface = closestBodySurfacePoint(body, [finalCentroid.x, finalCentroid.y, finalCentroid.z], 0, 0.24);
        const finalAudit = auditMeshBodyClearance(item.mesh, body, 0.5, 112);
        const normalDot = finalSurface
          ? new THREE.Vector3(...snapshot.surface.outwardNormal)
            .normalize()
            .dot(new THREE.Vector3(...finalSurface.outwardNormal).normalize())
          : -1;
        const penetrationWorsened = finalAudit.penetratingSamples > snapshot.bodyAudit.penetratingSamples
          || finalAudit.minimumSignedClearanceMm < snapshot.bodyAudit.minimumSignedClearanceMm - 2;
        if (!finalSurface) unsafeReason ??= `${instanceId}: saiu da vizinhança corporal escolhida.`;
        else if (normalDot < 0.15) unsafeReason ??= `${instanceId}: tentou trocar de lado do corpo.`;
        else if (centroidDisplacement > 0.06) unsafeReason ??= `${instanceId}: tentou deslocar o placement mais de 60 mm.`;
        else if (penetrationWorsened) unsafeReason ??= `${instanceId}: piorou a penetração no corpo.`;
        bodyAudits[instanceId] = {
          conform,
          before: snapshot.bodyAudit,
          after: finalAudit,
          centroidDisplacementMm: centroidDisplacement * 1_000,
          surfaceNormalDot: normalDot,
        };
      }

      const finalResidual = measureCurrentSewingStep0Residual(state, this.garmentMeshes, target);
      const materialAfter = measureCurrentSewingStep0MaterialDistortion(state, this.garmentMeshes, target);
      if (!finalResidual || materialAfter === null) unsafeReason ??= "Não foi possível auditar a geometria final.";
      const residualImproves = finalResidual
        ? proposal.beforeResidual.meanM <= 0.0015
          || finalResidual.meanM <= proposal.beforeResidual.meanM * 0.99
          || finalResidual.meanM <= proposal.beforeResidual.meanM - 0.00035
        : false;
      const maximumResidualSafe = finalResidual
        ? finalResidual.maximumM <= Math.max(
          proposal.beforeResidual.maximumM + 0.003,
          proposal.beforeResidual.maximumM * 1.08,
        )
        : false;
      const materialSafe = materialAfter !== null
        && materialAfter <= Math.max(0.03, materialBefore + 0.015);
      if (!residualImproves) unsafeReason ??= "O ajuste não aproximou as costuras de forma mensurável.";
      else if (!maximumResidualSafe) unsafeReason ??= "Uma das costuras piorou enquanto outra era aproximada.";
      else if (!materialSafe) unsafeReason ??= "O ajuste exigiria deformar demais o material.";

      if (unsafeReason) {
        restoreSnapshots();
        this.host.dataset.sewingStep0Status = "rolled-back";
        this.host.dataset.sewingStep0Diagnostics = JSON.stringify({
          rollback: unsafeReason,
          proposal,
          finalResidual,
          materialBefore,
          materialAfter,
          bodyAudits,
        }, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value);
        return {
          status: "failed",
          affectedPanels: target.instanceIds.length,
          warning: `STEP-0 cancelado sem alterar a roupa: ${unsafeReason}`,
        };
      }

      for (const instanceId of target.instanceIds) {
        const item = snapshots.get(instanceId)?.item;
        if (item) syncMeshGeometryToAssemblyState(state, item);
      }
      const intrinsic = measureIntrinsicDistortion(state);
      this.refreshSewingOverlay();
      this.host.dataset.sewingStep0Status = "applied-local";
      this.host.dataset.sewingStep0Ms = (performance.now() - startedAt).toFixed(2);
      this.host.dataset.sewingStep0Diagnostics = JSON.stringify({
        affectedPanels: target.instanceIds.length,
        conformedPanels,
        maximumCentroidDisplacementMm: maximumCentroidDisplacementM * 1_000,
        maximumVertexDisplacementMm: proposal.maximumVertexDisplacementM * 1_000,
        proposalResidual: {
          before: proposal.beforeResidual,
          afterLocal: proposal.afterResidual,
          afterBody: finalResidual,
        },
        metricDistortionMax: intrinsic.maxRelativeDistortion,
        materialBefore,
        materialAfter,
        bodyAudits,
        iterations: proposal.iterations,
        constraintCount: proposal.seamConstraintCount,
      });
      this.host.dataset.simulationStatus = "disabled-in-montar";
      this.requestRender();
      const residualMm = (finalResidual?.maximumM ?? 0) * 1_000;
      return {
        status: "applied",
        affectedPanels: target.instanceIds.length,
        conformedPanels,
        maximumCentroidDisplacementMm: maximumCentroidDisplacementM * 1_000,
        metricDistortionMax: intrinsic.maxRelativeDistortion,
        seamResidualMaxMm: residualMm,
        ...(residualMm > 20 ? { warning: `Ainda há uma costura com ${residualMm.toFixed(1)} mm de abertura.` } : {}),
      };
    } catch (error) {
      restoreSnapshots();
      console.error("STEP-0 geométrico local:", error);
      this.host.dataset.sewingStep0Status = "failed";
      return {
        status: "failed",
        affectedPanels: target.instanceIds.length,
        warning: error instanceof Error ? error.message : "Falha no STEP-0 geométrico local.",
      };
    }
  }

'''
global_text = global_text[:start] + new_method + global_text[end:]
global_path.write_text(global_text, encoding="utf-8")

replace_once(
    "apps/web/src/viewport/GarmentViewport.tsx",
    'setSewingStep0Notice("Calculando montagem geométrica…");',
    'setSewingStep0Notice("Ajustando costuras no placement atual…");',
)
replace_once(
    "apps/web/src/viewport/GarmentViewport.tsx",
    'setSewingStep0Notice(`STEP-0 aplicado em ${result.affectedPanels} painel(is). Física continua desligada.`);',
    'setSewingStep0Notice(`STEP-0 local aplicado em ${result.affectedPanels} painel(is)${result.seamResidualMaxMm !== undefined ? ` · abertura máx. ${result.seamResidualMaxMm.toFixed(1)} mm` : ""}. Física desligada.`);',
)

# A regression test intentionally uses manually separated Object3D transforms.
# The solver must improve the seam while leaving those transforms untouched.
test = r'''import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { GarmentAssemblyMeshData } from "../garment3d/GarmentThreeBridge";
import {
  measureCurrentSewingStep0Residual,
  solvePlacementAnchoredSewingStep0,
  type SewingStep0Target,
} from "./SewingStep0";

function quadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -0.05, -0.1, 0,
     0.05, -0.1, 0,
     0.05,  0.1, 0,
    -0.05,  0.1, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function meshData(key: string, x: number, z: number): GarmentAssemblyMeshData {
  const mesh = new THREE.Mesh(quadGeometry(), new THREE.MeshBasicMaterial());
  mesh.position.set(x, 1, z);
  mesh.updateMatrixWorld(true);
  return {
    key,
    mesh,
    flat: new Float32Array(mesh.geometry.getAttribute("position").array as Float32Array),
    dressed: new Float32Array(mesh.geometry.getAttribute("position").array as Float32Array),
  } as GarmentAssemblyMeshData;
}

function state(): GarmentAssemblyState {
  const structural = [
    [0, 1, 0.1], [1, 2, 0.2], [2, 3, 0.1], [3, 0, 0.2], [0, 2, Math.hypot(0.1, 0.2)],
    [4, 5, 0.1], [5, 6, 0.2], [6, 7, 0.1], [7, 4, 0.2], [4, 6, Math.hypot(0.1, 0.2)],
  ].map(([a, b, restLength]) => ({ a, b, restLength, stiffness: 1 }));
  const seam = (id: string, a: number, b: number) => ({
    id,
    seamId: "side",
    seamGroupId: "side",
    treatment: "plain",
    distribution: "uniform" as const,
    targetRatio: 1,
    slackMm: 0,
    a: { particleIndices: [a], weights: [1] },
    b: { particleIndices: [b], weights: [1] },
    restDistance: 0,
    physicalRestDistance: 0,
    stiffness: 1,
    instanceA: "front",
    instanceB: "back",
  });
  return {
    positions: new Float32Array(8 * 3),
    initialPositions: new Float32Array(8 * 3),
    previousPositions: new Float32Array(8 * 3),
    inverseMasses: new Float32Array(8),
    instances: [
      { id: "front", particleStart: 0, vertexCount: 4, topology: {} },
      { id: "back", particleStart: 4, vertexCount: 4, topology: {} },
    ] as GarmentAssemblyState["instances"],
    structuralConstraints: structural,
    stitchConstraints: [seam("low", 1, 4), seam("high", 2, 7)],
    anchorConstraints: [],
    warnings: [],
    invalid: false,
  };
}

const target: SewingStep0Target = { rootInstanceId: "front", instanceIds: ["front", "back"] };

describe("placement-anchored STEP-0", () => {
  it("improves sewn boundaries without replacing either manually authored transform", () => {
    const assembly = state();
    const front = meshData("front", -0.07, 0.11);
    const back = meshData("back", 0.07, -0.11);
    const meshes = [front, back];
    const frontPosition = front.mesh.position.clone();
    const backPosition = back.mesh.position.clone();
    const before = measureCurrentSewingStep0Residual(assembly, meshes, target)!;
    const proposal = solvePlacementAnchoredSewingStep0(assembly, meshes, target, {
      iterations: 72,
      maximumVertexDisplacementM: 0.065,
      maximumCentroidDisplacementM: 0.018,
    });

    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.meanM).toBeLessThan(before.meanM);
    expect(proposal!.maximumCentroidDisplacementM).toBeLessThanOrEqual(0.018001);
    expect(proposal!.maximumVertexDisplacementM).toBeLessThanOrEqual(0.065001);
    expect(proposal!.metricDistortionMax).toBeLessThan(0.025);
    expect(front.mesh.position.toArray()).toEqual(frontPosition.toArray());
    expect(back.mesh.position.toArray()).toEqual(backPosition.toArray());
    expect(front.mesh.position.z).toBeGreaterThan(0);
    expect(back.mesh.position.z).toBeLessThan(0);
  });

  it("closes a same-panel relation locally instead of requiring a second placement system", () => {
    const assembly = state();
    assembly.instances = [assembly.instances[0]];
    assembly.structuralConstraints = assembly.structuralConstraints.slice(0, 5);
    assembly.stitchConstraints = [{
      ...assembly.stitchConstraints[0],
      seamId: "strap-loop",
      seamGroupId: "strap-loop",
      instanceA: "front",
      instanceB: "front",
      a: { particleIndices: [0], weights: [1] },
      b: { particleIndices: [1], weights: [1] },
    }];
    const front = meshData("front", 0, 0.12);
    const selfTarget: SewingStep0Target = { rootInstanceId: "front", instanceIds: ["front"] };
    const before = measureCurrentSewingStep0Residual(assembly, [front], selfTarget)!;
    const proposal = solvePlacementAnchoredSewingStep0(assembly, [front], selfTarget, { iterations: 72 });
    expect(proposal).not.toBeNull();
    expect(proposal!.afterResidual.meanM).toBeLessThan(before.meanM);
    expect(front.mesh.position.z).toBeCloseTo(0.12, 8);
  });
});
'''
Path("apps/web/src/viewport/SewingStep0Placement.test.ts").write_text(test, encoding="utf-8")

docs = Path("docs/modifications-11.0.8.md")
doc_text = docs.read_text(encoding="utf-8")
doc_text += r'''

## Manual gate repair: placement-safe local STEP-0

The first visual gate exposed an architectural failure: the coarse isometric
solution was registered from one root panel and that root registration was then
applied to every connected panel. That made the solver's legacy relative pose
authoritative over manual 3D arrangement, allowing a back skirt panel to move
to the front of the body. Body conform happened only after that destructive
move, so it could not recover the authored hemisphere. The same global solve
also made the explicit action unnecessarily slow.

The gate now uses a bounded local projection starting from the currently visible
mesh geometry. Every PanelInstance keeps its own Object3D transform; only local
vertex geometry may change. Current structural edge lengths are restored every
iteration, seam constraints attract canonical correspondence points, per-vertex
movement is capped, per-panel centroid drift is capped, and the result is not
committed until body-side, penetration, material and seam-residual audits pass.
Any unsafe result restores the exact pre-click meshes atomically. The body
surface normal selected before the solve remains a hemisphere guard after the
solve, so front/back cannot silently swap.

This path does not invoke the expensive coarse candidate Worker and never starts
XPBD. It is intentionally incremental: when a complex garment cannot close
safely inside the local displacement cage, it keeps the manual arrangement and
reports the refusal instead of purchasing seam closure with a teleport.
Undo/redo of seam authoring remains outside this repair pass per the manual gate.
'''
docs.write_text(doc_text, encoding="utf-8")

print("Applied placement-safe local STEP-0 repair")
