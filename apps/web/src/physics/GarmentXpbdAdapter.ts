import type { FabricPhysics, FabricSource } from "../domain/fabric";
import type { GarmentDraft } from "../domain/pattern";
import type {
  AssemblyPanelInstance,
  GarmentAssemblyState,
  GlobalPointReference,
} from "../garment3d/GarmentAssembly";
import {
  assertSeamReferenceInvariants,
  auditAdapterSeamResiduals,
  type AdapterSeamResidualAudit,
} from "../garment3d/InitialSeamResidual";
import type { PackedBodyColliders } from "./bodyCollision";
import {
  DEFAULT_XPBD_CONFIG,
  XPBD_MISSING_PARTICLE,
  type XpbdSolverConfig,
} from "./xpbd";

export interface XpbdInitializationData {
  revision: string;
  topologyDiagnostics: XpbdTopologyDiagnostics;
  seamResidualAudit: AdapterSeamResidualAudit;
  positions: Float32Array;
  previousPositions: Float32Array;
  predictedPositions: Float32Array;
  velocities: Float32Array;
  inverseMasses: Float32Array;
  restPositions: Float32Array;
  materialCoordinates: Float32Array;
  triangles: Uint32Array;
  triangleRestAreas: Float32Array;
  triangleMaterialOrientations: Int8Array;
  distanceIndices: Uint32Array;
  distanceRestLengths: Float32Array;
  distanceCompliances: Float32Array;
  distanceKinds: Uint8Array;
  distancePanelIds: string[];
  distanceFabricIds: string[];
  shearIndices: Uint32Array;
  shearRestCosines: Float32Array;
  shearCompliances: Float32Array;
  bendIndices: Uint32Array;
  bendRestAngles: Float32Array;
  bendCompliances: Float32Array;
  seamIndices: Uint32Array;
  seamWeights: Float32Array;
  seamRestDistances: Float32Array;
  seamCompliances: Float32Array;
  seamRelaxations: Float32Array;
  seamGroupIds: string[];
  pinIndices: Uint32Array;
  pinTargets: Float32Array;
  bodyColliderKinds?: Uint8Array;
  bodyColliderData?: Float32Array;
  bodyColliderRegions?: string[];
  particleHalfThicknessM?: Float32Array;
  particleFriction?: Float32Array;
  bodyCollisionEnabled?: boolean;
  bodyContactSkinM?: number;
  config: XpbdSolverConfig;
}

export interface XpbdPanelTopologyDiagnostic {
  panelInstanceId: string;
  geometrySignature: string;
  particleStart: number;
  particleCount: number;
  particleEndExclusive: number;
  triangleCount: number;
  maximumLocalTriangleIndex: number;
}

export interface XpbdTopologyDiagnostics {
  revision: string;
  panels: XpbdPanelTopologyDiagnostic[];
  particleCount: number;
  positionsLength: number;
  triangleCount: number;
  maximumTriangleIndex: number;
  stretchConstraintCount: number;
  shearConstraintCount: number;
  bendConstraintCount: number;
  seamConstraintCount: number;
  seamConstraintsByGroup: Record<string, number>;
  finitePositionCount: number;
  valid: boolean;
}

export interface GarmentXpbdAdapterOptions {
  pinAssemblyAnchors?: boolean;
  config?: Partial<XpbdSolverConfig>;
  bodyColliders?: PackedBodyColliders;
  bodyCollisionEnabled?: boolean;
  bodyContactSkinM?: number;
}

interface EdgeRecord {
  a: number;
  b: number;
}

interface HingeRecord {
  edgeStart: number;
  edgeEnd: number;
  opposite: number;
}

const METERS_PER_MM = 0.001;
const DEFAULT_FABRIC: FabricPhysics = {
  weightGsm: 165,
  thicknessMm: 0.42,
  stretchWarpPercent: 2,
  stretchWeftPercent: 3,
  bending: 0.46,
  friction: 0.5,
};

export function buildXpbdInitialization(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  revision: string,
  options: GarmentXpbdAdapterOptions = {},
): XpbdInitializationData {
  const particleCount = state.positions.length / 3;
  const positions = new Float32Array(state.positions);
  const materialCoordinates = new Float32Array(particleCount * 2);
  const triangleValues: number[] = [];
  const triangleRestAreas: number[] = [];
  const triangleMaterialOrientations: number[] = [];
  const distanceIndices: number[] = [];
  const distanceRestLengths: number[] = [];
  const distanceCompliances: number[] = [];
  const distanceKinds: number[] = [];
  const distancePanelIds: string[] = [];
  const distanceFabricIds: string[] = [];
  const shearIndices: number[] = [];
  const shearRestCosines: number[] = [];
  const shearCompliances: number[] = [];
  const bendIndices: number[] = [];
  const bendRestAngles: number[] = [];
  const bendCompliances: number[] = [];
  const inverseMasses = new Float32Array(particleCount);
  const particleHalfThicknessM = new Float32Array(particleCount);
  const particleFriction = new Float32Array(particleCount);
  const particleMasses = new Float64Array(particleCount);
  const fabricById = new Map(garment.fabrics.map((fabric) => [fabric.id, fabric]));
  const pieceById = new Map(garment.pieces.map((piece) => [piece.id, piece]));
  const fallbackFabric = garment.fabrics[0];

  for (const instance of state.instances) {
    const piece = pieceById.get(instance.pieceId);
    const fabric = fabricById.get(piece?.fabricId ?? "") ?? fallbackFabric;
    const physics = fabric?.physics ?? DEFAULT_FABRIC;
    const topology = instance.topology;
    const grain = normalizedGrain(piece?.grainline);
    const edgeMap = new Map<string, EdgeRecord>();

    for (let local = 0; local < instance.vertexCount; local += 1) {
      const global = instance.particleStart + local;
      materialCoordinates[global * 2] = topology.positions2DMm[local * 2] * METERS_PER_MM;
      materialCoordinates[global * 2 + 1] = topology.positions2DMm[local * 2 + 1] * METERS_PER_MM;
      particleHalfThicknessM[global] = Math.max(0, physics.thicknessMm) * METERS_PER_MM * 0.5;
      particleFriction[global] = Math.max(0, physics.friction);
    }

    for (let offset = 0; offset < topology.triangles.length; offset += 3) {
      const localA = topology.triangles[offset];
      // Registration owns the canonical outward side.  Keep renderer and
      // physics triangle orientation identical after a proper rigid transform.
      const localB = topology.triangles[offset + (instance.arrangement?.flipWinding ? 2 : 1)];
      const localC = topology.triangles[offset + (instance.arrangement?.flipWinding ? 1 : 2)];
      const a = instance.particleStart + localA;
      const b = instance.particleStart + localB;
      const c = instance.particleStart + localC;
      triangleValues.push(a, b, c);
      const signedMaterialArea = triangleSignedMaterialArea(materialCoordinates, a, b, c);
      triangleRestAreas.push(Math.abs(signedMaterialArea));
      triangleMaterialOrientations.push(signedMaterialArea < 0 ? -1 : 1);
      accumulateTriangleMass(particleMasses, materialCoordinates, a, b, c, physics.weightGsm);
      appendShear(shearIndices, shearRestCosines, shearCompliances, materialCoordinates, a, b, c, physics);
      appendEdge(edgeMap, a, b);
      appendEdge(edgeMap, b, c);
      appendEdge(edgeMap, c, a);
    }

    for (const edge of edgeMap.values()) {
      const rest = restDistance2D(materialCoordinates, edge.a, edge.b);
      if (rest <= 1e-9) continue;
      const compliance = anisotropicStretchCompliance(
        materialCoordinates,
        edge.a,
        edge.b,
        grain,
        physics,
      );
      distanceIndices.push(edge.a, edge.b);
      distanceRestLengths.push(rest);
      distanceCompliances.push(compliance);
      distanceKinds.push(0);
      distancePanelIds.push(instance.id);
      distanceFabricIds.push(fabric?.id ?? "default-fabric");
    }

    appendDihedralBendingConstraints(
      topology.triangles,
      instance,
      positions,
      materialCoordinates,
      physics,
      bendIndices,
      bendRestAngles,
      bendCompliances,
    );
  }

  for (let particle = 0; particle < particleCount; particle += 1) {
    const mass = particleMasses[particle];
    inverseMasses[particle] = mass > 1e-10 ? Math.min(50_000, 1 / mass) : 1;
  }

  const pinIndices: number[] = [];
  const pinTargets: number[] = [];
  if (options.pinAssemblyAnchors === true) {
    const seenPins = new Set<number>();
    for (const anchor of state.anchorConstraints) {
      if (seenPins.has(anchor.particleIndex)) continue;
      seenPins.add(anchor.particleIndex);
      pinIndices.push(anchor.particleIndex);
      pinTargets.push(anchor.targetX, anchor.targetY, anchor.targetZ);
      inverseMasses[anchor.particleIndex] = 0;
    }
  }

  const seamIndices: number[] = [];
  const seamWeights: number[] = [];
  const seamRestDistances: number[] = [];
  const seamCompliances: number[] = [];
  const seamRelaxations: number[] = [];
  const seamGroupIds: string[] = [];
  for (const seam of state.stitchConstraints) {
    appendPointReference(seamIndices, seamWeights, seam.a);
    appendPointReference(seamIndices, seamWeights, seam.b);
    // GarmentAssembly owns the canonical sampled seam target, including
    // composite range mismatch and explicit slack. Re-deriving only from
    // slack here used to disagree with STEP 0 by a constant 1.5 mm and gave
    // the first physics step artificial closing energy.
    const restDistance = Math.max(
      0,
      seam.physicalRestDistance ?? seam.restDistance,
    );
    seamRestDistances.push(restDistance);
    seamCompliances.push(seamCompliance(seam.treatment));
    // Every seam correction obeys the same material-length trust region. The
    // former 16x dart multiplier let a sub-millimetre closing residual move a
    // light vertex farther than its adjacent material bars could recover,
    // turning a valid local fold into the first-frame skirt explosion.
    seamRelaxations.push(1);
    seamGroupIds.push(seam.seamGroupId);
  }

  const config = normalizeConfig(options.config, garment);
  const triangles = Uint32Array.from(triangleValues);
  const distanceKindsArray = Uint8Array.from(distanceKinds);
  const topologyDiagnostics = buildTopologyDiagnostics(
    revision,
    state.instances,
    positions,
    triangles,
    distanceKindsArray,
    shearRestCosines.length,
    bendRestAngles.length,
    seamGroupIds,
  );
  if (!topologyDiagnostics.valid) {
    throw new RangeError(`Topologia XPBD inválida na revisão ${revision}.`);
  }
  if (import.meta.env.DEV) assertSeamReferenceInvariants(state);
  const seamIndicesArray = Uint32Array.from(seamIndices);
  const seamWeightsArray = Float32Array.from(seamWeights);
  const seamRestDistancesArray = Float32Array.from(seamRestDistances);
  const seamResidualAudit = auditAdapterSeamResiduals(
    state,
    garment,
    positions,
    seamIndicesArray,
    seamWeightsArray,
    seamRestDistancesArray,
    seamGroupIds,
  );
  if (import.meta.env.DEV && seamResidualAudit.invariantErrors.length > 0) {
    throw new RangeError(
      `Seam mapping inválido na revisão ${revision}: ${seamResidualAudit.invariantErrors.join(" | ")}`,
    );
  }
  const bodyColliders = options.bodyColliders ?? { kinds: new Uint8Array(0), data: new Float32Array(0), regions: [] };
  const bodyContactSkinM = options.bodyContactSkinM ?? 0.0004;
  return {
    revision,
    topologyDiagnostics,
    seamResidualAudit,
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses,
    restPositions: new Float32Array(positions),
    materialCoordinates,
    triangles,
    triangleRestAreas: Float32Array.from(triangleRestAreas),
    triangleMaterialOrientations: Int8Array.from(triangleMaterialOrientations),
    distanceIndices: Uint32Array.from(distanceIndices),
    distanceRestLengths: Float32Array.from(distanceRestLengths),
    distanceCompliances: Float32Array.from(distanceCompliances),
    distanceKinds: distanceKindsArray,
    distancePanelIds,
    distanceFabricIds,
    shearIndices: Uint32Array.from(shearIndices),
    shearRestCosines: Float32Array.from(shearRestCosines),
    shearCompliances: Float32Array.from(shearCompliances),
    bendIndices: Uint32Array.from(bendIndices),
    bendRestAngles: Float32Array.from(bendRestAngles),
    bendCompliances: Float32Array.from(bendCompliances),
    seamIndices: seamIndicesArray,
    seamWeights: seamWeightsArray,
    seamRestDistances: seamRestDistancesArray,
    seamCompliances: Float32Array.from(seamCompliances),
    seamRelaxations: Float32Array.from(seamRelaxations),
    seamGroupIds,
    pinIndices: Uint32Array.from(pinIndices),
    pinTargets: Float32Array.from(pinTargets),
    bodyColliderKinds: new Uint8Array(bodyColliders.kinds),
    bodyColliderData: new Float32Array(bodyColliders.data),
    bodyColliderRegions: [...bodyColliders.regions],
    particleHalfThicknessM,
    particleFriction,
    bodyCollisionEnabled: options.bodyCollisionEnabled ?? bodyColliders.kinds.length > 0,
    bodyContactSkinM,
    config,
  };
}

function buildTopologyDiagnostics(
  revision: string,
  instances: readonly AssemblyPanelInstance[],
  positions: Float32Array,
  triangles: Uint32Array,
  distanceKinds: Uint8Array,
  shearConstraintCount: number,
  bendConstraintCount: number,
  seamGroupIds: readonly string[],
): XpbdTopologyDiagnostics {
  const particleCount = positions.length / 3;
  const panels = instances.map((instance) => ({
    panelInstanceId: instance.id,
    geometrySignature: instance.geometrySignature,
    particleStart: instance.particleStart,
    particleCount: instance.vertexCount,
    particleEndExclusive: instance.particleStart + instance.vertexCount,
    triangleCount: instance.topology.triangles.length / 3,
    maximumLocalTriangleIndex: maximumIndex(instance.topology.triangles),
  }));
  const seamConstraintsByGroup: Record<string, number> = {};
  for (const seamGroupId of seamGroupIds) {
    seamConstraintsByGroup[seamGroupId] = (seamConstraintsByGroup[seamGroupId] ?? 0) + 1;
  }
  let finitePositionCount = 0;
  for (const value of positions) if (Number.isFinite(value)) finitePositionCount += 1;
  const maximumTriangleIndex = maximumIndex(triangles);
  const panelRangesValid = panels.every((panel, index) =>
    panel.particleStart === (index === 0 ? 0 : panels[index - 1].particleEndExclusive)
    && panel.particleEndExclusive <= particleCount
    && panel.maximumLocalTriangleIndex < panel.particleCount);
  return {
    revision,
    panels,
    particleCount,
    positionsLength: positions.length,
    triangleCount: triangles.length / 3,
    maximumTriangleIndex,
    stretchConstraintCount: distanceKinds.length,
    shearConstraintCount,
    bendConstraintCount,
    seamConstraintCount: seamGroupIds.length,
    seamConstraintsByGroup,
    finitePositionCount,
    valid: Number.isInteger(particleCount)
      && positions.length > 0
      && finitePositionCount === positions.length
      && maximumTriangleIndex < particleCount
      && panelRangesValid,
  };
}

function maximumIndex(values: Uint32Array): number {
  let maximum = -1;
  for (const value of values) maximum = Math.max(maximum, value);
  return maximum;
}

export function xpbdInitializationTransferables(data: XpbdInitializationData): Transferable[] {
  return [
    data.positions.buffer,
    data.previousPositions.buffer,
    data.predictedPositions.buffer,
    data.velocities.buffer,
    data.inverseMasses.buffer,
    data.restPositions.buffer,
    data.materialCoordinates.buffer,
    data.triangles.buffer,
    data.triangleRestAreas.buffer,
    data.triangleMaterialOrientations.buffer,
    data.distanceIndices.buffer,
    data.distanceRestLengths.buffer,
    data.distanceCompliances.buffer,
    data.distanceKinds.buffer,
    data.shearIndices.buffer,
    data.shearRestCosines.buffer,
    data.shearCompliances.buffer,
    data.bendIndices.buffer,
    data.bendRestAngles.buffer,
    data.bendCompliances.buffer,
    data.seamIndices.buffer,
    data.seamWeights.buffer,
    data.seamRestDistances.buffer,
    data.seamCompliances.buffer,
    data.seamRelaxations.buffer,
    data.pinIndices.buffer,
    data.pinTargets.buffer,
    ...(data.bodyColliderKinds ? [data.bodyColliderKinds.buffer] : []),
    ...(data.bodyColliderData ? [data.bodyColliderData.buffer] : []),
    ...(data.particleHalfThicknessM ? [data.particleHalfThicknessM.buffer] : []),
    ...(data.particleFriction ? [data.particleFriction.buffer] : []),
  ];
}

function appendEdge(
  edges: Map<string, EdgeRecord>,
  a: number,
  b: number,
): void {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  if (!edges.has(key)) edges.set(key, { a: Math.min(a, b), b: Math.max(a, b) });
}

function appendDihedralBendingConstraints(
  triangles: Uint32Array,
  instance: AssemblyPanelInstance,
  dressPosePositions: Float32Array,
  materialCoordinates: Float32Array,
  physics: FabricPhysics,
  indices: number[],
  restAngles: number[],
  compliances: number[],
): void {
  const shared = new Map<string, HingeRecord>();
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const vertices = [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const first = vertices[edge];
      const second = vertices[(edge + 1) % 3];
      const opposite = vertices[(edge + 2) % 3];
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      const previous = shared.get(key);
      if (previous === undefined) {
        shared.set(key, { edgeStart: first, edgeEnd: second, opposite });
        continue;
      }
      const p0 = instance.particleStart + previous.opposite;
      const p1 = instance.particleStart + opposite;
      const p2 = instance.particleStart + previous.edgeStart;
      const p3 = instance.particleStart + previous.edgeEnd;
      const restAngle = dressPoseDihedralRestAngle(dressPosePositions, p0, p1, p2, p3);
      if (!Number.isFinite(restAngle)) continue;
      indices.push(p0, p1, p2, p3);
      restAngles.push(restAngle);
      compliances.push(hingeBendCompliance(instance, materialCoordinates, p2, p3, physics));
    }
  }
}

function appendShear(
  indices: number[],
  restCosines: number[],
  compliances: number[],
  materialCoordinates: Float32Array,
  a: number,
  b: number,
  c: number,
  physics: FabricPhysics,
): void {
  const e1x = materialCoordinates[b * 2] - materialCoordinates[a * 2];
  const e1y = materialCoordinates[b * 2 + 1] - materialCoordinates[a * 2 + 1];
  const e2x = materialCoordinates[c * 2] - materialCoordinates[a * 2];
  const e2y = materialCoordinates[c * 2 + 1] - materialCoordinates[a * 2 + 1];
  const denominator = Math.hypot(e1x, e1y) * Math.hypot(e2x, e2y);
  if (denominator <= 1e-12) return;
  indices.push(a, b, c);
  restCosines.push((e1x * e2x + e1y * e2y) / denominator);
  const stretch = (physics.stretchWarpPercent + physics.stretchWeftPercent) * 0.5;
  compliances.push(0.000002 + stretch * 0.00000035);
}

function accumulateTriangleMass(
  masses: Float64Array,
  uv: Float32Array,
  a: number,
  b: number,
  c: number,
  weightGsm: number,
): void {
  const area = Math.abs(
    (uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1])
    - (uv[b * 2 + 1] - uv[a * 2 + 1]) * (uv[c * 2] - uv[a * 2])
  ) * 0.5;
  const massPerVertex = Math.max(1e-8, area * weightGsm * 0.001 / 3);
  masses[a] += massPerVertex;
  masses[b] += massPerVertex;
  masses[c] += massPerVertex;
}

function anisotropicStretchCompliance(
  uv: Float32Array,
  a: number,
  b: number,
  grain: readonly [number, number],
  physics: FabricPhysics,
): number {
  const dx = uv[b * 2] - uv[a * 2];
  const dy = uv[b * 2 + 1] - uv[a * 2 + 1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return 0;
  const warpAlignment = Math.abs((dx * grain[0] + dy * grain[1]) / length);
  const weftAlignment = Math.sqrt(Math.max(0, 1 - warpAlignment * warpAlignment));
  const warp = 0.00000002 + physics.stretchWarpPercent * 0.00000018;
  const weft = 0.00000002 + physics.stretchWeftPercent * 0.00000018;
  return warp * warpAlignment * warpAlignment + weft * weftAlignment * weftAlignment;
}

function normalizedGrain(grainline: { start: { xMm: number; yMm: number }; end: { xMm: number; yMm: number } } | undefined): [number, number] {
  if (!grainline) return [0, 1];
  const dx = grainline.end.xMm - grainline.start.xMm;
  const dy = grainline.end.yMm - grainline.start.yMm;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? [dx / length, dy / length] : [0, 1];
}

function appendPointReference(indices: number[], weights: number[], reference: GlobalPointReference): void {
  const entries = reference.particleIndices
    .map((particle, index) => ({ particle, weight: reference.weights[index] ?? 0 }))
    .filter((entry) => entry.weight > 1e-8)
    .slice(0, 2);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  for (let slot = 0; slot < 2; slot += 1) {
    const entry = entries[slot];
    indices.push(entry?.particle ?? XPBD_MISSING_PARTICLE);
    weights.push(entry ? entry.weight / Math.max(total, 1e-8) : 0);
  }
}

function seamCompliance(treatment: string): number {
  switch (treatment) {
    case "gather": return 0.0000015;
    case "ease": return 0.0000008;
    case "elastic":
    case "stretch": return 0.000004;
    case "intentional-mismatch": return 0.000008;
    default: return 0.00000008;
  }
}

function normalizeConfig(
  partial: Partial<XpbdSolverConfig> | undefined,
  _garment: GarmentDraft,
): XpbdSolverConfig {
  return {
    ...DEFAULT_XPBD_CONFIG,
    ...partial,
    gravity: partial?.gravity ?? DEFAULT_XPBD_CONFIG.gravity,
    iterations: clampInteger(partial?.iterations ?? DEFAULT_XPBD_CONFIG.iterations, 1, 40),
    maximumSubsteps: clampInteger(partial?.maximumSubsteps ?? DEFAULT_XPBD_CONFIG.maximumSubsteps, 1, 12),
  };
}

function restDistance2D(materialCoordinates: Float32Array, a: number, b: number): number {
  return Math.hypot(
    materialCoordinates[b * 2] - materialCoordinates[a * 2],
    materialCoordinates[b * 2 + 1] - materialCoordinates[a * 2 + 1],
  );
}

function triangleSignedMaterialArea(materialCoordinates: Float32Array, a: number, b: number, c: number): number {
  const abx = materialCoordinates[b * 2] - materialCoordinates[a * 2];
  const aby = materialCoordinates[b * 2 + 1] - materialCoordinates[a * 2 + 1];
  const acx = materialCoordinates[c * 2] - materialCoordinates[a * 2];
  const acy = materialCoordinates[c * 2 + 1] - materialCoordinates[a * 2 + 1];
  return (abx * acy - aby * acx) * 0.5;
}

function dressPoseDihedralRestAngle(
  positions: Float32Array,
  oppositeA: number,
  oppositeB: number,
  edgeStart: number,
  edgeEnd: number,
): number {
  const normalA = spatialCross(positions, oppositeA, edgeStart, edgeEnd);
  const normalB = spatialCross(positions, oppositeB, edgeEnd, edgeStart);
  const denominator = Math.hypot(...normalA) * Math.hypot(...normalB);
  if (denominator <= 1e-16) return Number.NaN;
  const cosine = (
    normalA[0] * normalB[0]
    + normalA[1] * normalB[1]
    + normalA[2] * normalB[2]
  ) / denominator;
  const clamped = Math.min(1, Math.max(-1, cosine));
  // Keep STEP 0 exactly on the same numerical manifold used by solveBendSet.
  // The hot loop deliberately uses this cubic acos approximation; using
  // Math.acos only for rest angles injected a systematic bend impulse into an
  // otherwise identical pose.
  return (-0.6981317 * clamped * clamped - 0.8726646) * clamped + 1.570796;
}

function spatialCross(
  positions: Float32Array,
  origin: number,
  first: number,
  second: number,
): readonly [number, number, number] {
  const originOffset = origin * 3;
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  const ax = positions[firstOffset] - positions[originOffset];
  const ay = positions[firstOffset + 1] - positions[originOffset + 1];
  const az = positions[firstOffset + 2] - positions[originOffset + 2];
  const bx = positions[secondOffset] - positions[originOffset];
  const by = positions[secondOffset + 1] - positions[originOffset + 1];
  const bz = positions[secondOffset + 2] - positions[originOffset + 2];
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

function dihedralBendCompliance(bending: number): number {
  // Angle gradients scale inversely with edge length and particle masses are
  // measured in kilograms. A logarithmic compliance range keeps the public
  // 0..1 fabric control meaningful across millimetre-scale tessellations.
  return 10 ** (6 - 3 * clamp01(bending));
}

function hingeBendCompliance(
  instance: AssemblyPanelInstance,
  materialCoordinates: Float32Array,
  edgeStart: number,
  edgeEnd: number,
  physics: FabricPhysics,
): number {
  const base = dihedralBendCompliance(physics.bending);
  if (instance.topology.darts.length === 0) return base;
  const midpoint = {
    xMm: (materialCoordinates[edgeStart * 2] + materialCoordinates[edgeEnd * 2]) * 500,
    yMm: (materialCoordinates[edgeStart * 2 + 1] + materialCoordinates[edgeEnd * 2 + 1]) * 500,
  };
  for (const { dart } of instance.topology.darts) {
    if (!dart.closed) continue;
    const nearFold = pointSegmentDistanceMm(midpoint, dart.centerLine.start, dart.centerLine.end) <= 18;
    const insideLegA = pointSegmentDistanceMm(midpoint, dart.legA, dart.apex) <= 18;
    const insideLegB = pointSegmentDistanceMm(midpoint, dart.legB, dart.apex) <= 18;
    if (nearFold || insideLegA || insideLegB) return Math.max(base, 1_000_000_000);
  }
  return base;
}

function pointSegmentDistanceMm(
  point: { xMm: number; yMm: number },
  start: { xMm: number; yMm: number },
  end: { xMm: number; yMm: number },
): number {
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return Math.hypot(point.xMm - start.xMm, point.yMm - start.yMm);
  const t = Math.min(1, Math.max(0, ((point.xMm - start.xMm) * dx + (point.yMm - start.yMm) * dy) / lengthSquared));
  return Math.hypot(point.xMm - (start.xMm + dx * t), point.yMm - (start.yMm + dy * t));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function fabricPhysicsForInstance(
  instance: AssemblyPanelInstance,
  garment: GarmentDraft,
): FabricSource["physics"] {
  const piece = garment.pieces.find((candidate) => candidate.id === instance.pieceId);
  return garment.fabrics.find((fabric) => fabric.id === piece?.fabricId)?.physics
    ?? garment.fabrics[0]?.physics
    ?? DEFAULT_FABRIC;
}
