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
  distanceIndices: Uint32Array;
  distanceRestLengths: Float32Array;
  distanceCompliances: Float32Array;
  distanceKinds: Uint8Array;
  shearIndices: Uint32Array;
  shearRestCosines: Float32Array;
  shearCompliances: Float32Array;
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
  opposite: number;
  instance: AssemblyPanelInstance;
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
  const distanceIndices: number[] = [];
  const distanceRestLengths: number[] = [];
  const distanceCompliances: number[] = [];
  const distanceKinds: number[] = [];
  const shearIndices: number[] = [];
  const shearRestCosines: number[] = [];
  const shearCompliances: number[] = [];
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
      const localB = topology.triangles[offset + 1];
      const localC = topology.triangles[offset + 2];
      const a = instance.particleStart + localA;
      const b = instance.particleStart + localB;
      const c = instance.particleStart + localC;
      triangleValues.push(a, b, c);
      accumulateTriangleMass(particleMasses, materialCoordinates, a, b, c, physics.weightGsm);
      appendShear(shearIndices, shearRestCosines, shearCompliances, positions, a, b, c, physics);
      appendEdge(edgeMap, a, b, c, instance);
      appendEdge(edgeMap, b, c, a, instance);
      appendEdge(edgeMap, c, a, b, instance);
    }

    for (const edge of edgeMap.values()) {
      const rest = restDistance3D(positions, edge.a, edge.b);
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
    }

    appendBendingConstraints(
      topology.triangles,
      instance,
      positions,
      physics,
      distanceIndices,
      distanceRestLengths,
      distanceCompliances,
      distanceKinds,
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
    const appendPin = (particleIndex: number, x: number, y: number, z: number) => {
      if (seenPins.has(particleIndex)) return;
      seenPins.add(particleIndex);
      pinIndices.push(particleIndex);
      pinTargets.push(x, y, z);
      inverseMasses[particleIndex] = 0;
    };

    for (const anchor of state.anchorConstraints) {
      appendPin(anchor.particleIndex, anchor.targetX, anchor.targetY, anchor.targetZ);
    }
    for (const instance of state.instances) {
      if (instance.placement.region === "custom" || instance.placement.surface === "custom") continue;
      for (const localIndex of selectInstanceSupportVertices(instance)) {
        const particleIndex = instance.particleStart + localIndex;
        appendPin(
          particleIndex,
          positions[particleIndex * 3],
          positions[particleIndex * 3 + 1],
          positions[particleIndex * 3 + 2],
        );
      }
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
    const restDistance = Math.max(
      0,
      seam.slackMm * METERS_PER_MM / Math.max(1, seamGroupSampleCount(state, seam.seamGroupId)),
    );
    seamRestDistances.push(restDistance);
    seamCompliances.push(seamCompliance(seam.treatment));
    const initialResidual = Math.abs(pointReferenceDistance(state.positions, seam.a, seam.b) - restDistance);
    seamRelaxations.push(
      seam.instanceA !== undefined && seam.instanceA === seam.instanceB
        ? 1
        : initialResidual <= (options.config?.seamTolerance ?? DEFAULT_XPBD_CONFIG.seamTolerance)
          ? 0.35
          : 1,
    );
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
    distanceIndices: Uint32Array.from(distanceIndices),
    distanceRestLengths: Float32Array.from(distanceRestLengths),
    distanceCompliances: Float32Array.from(distanceCompliances),
    distanceKinds: distanceKindsArray,
    shearIndices: Uint32Array.from(shearIndices),
    shearRestCosines: Float32Array.from(shearRestCosines),
    shearCompliances: Float32Array.from(shearCompliances),
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
  let bendConstraintCount = 0;
  for (const kind of distanceKinds) if (kind === 1) bendConstraintCount += 1;
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
    stretchConstraintCount: distanceKinds.length - bendConstraintCount,
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
    data.distanceIndices.buffer,
    data.distanceRestLengths.buffer,
    data.distanceCompliances.buffer,
    data.distanceKinds.buffer,
    data.shearIndices.buffer,
    data.shearRestCosines.buffer,
    data.shearCompliances.buffer,
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

function selectInstanceSupportVertices(instance: AssemblyPanelInstance): number[] {
  const boundary = [...instance.topology.boundaryVertices];
  if (boundary.length <= 16) return boundary;
  const xOf = (localIndex: number) => instance.topology.positions2DMm[localIndex * 2];
  const yOf = (localIndex: number) => instance.topology.positions2DMm[localIndex * 2 + 1];
  const topY = Math.min(...boundary.map(yOf));
  const minX = Math.min(...boundary.map(xOf));
  const maxX = Math.max(...boundary.map(xOf));
  const sideTolerance = Math.max(8, (maxX - minX) * 0.04);
  const topBand = boundary
    .filter((localIndex) => yOf(localIndex) <= topY + 12)
    .sort((left, right) => xOf(left) - xOf(right));
  const sideRails = boundary
    .filter((localIndex) => xOf(localIndex) <= minX + sideTolerance || xOf(localIndex) >= maxX - sideTolerance)
    .sort((left, right) => yOf(left) - yOf(right));
  const anchors = [
    ...sampleEvenly(topBand.length >= 2 ? topBand : [...boundary].sort((left, right) => yOf(left) - yOf(right)).slice(0, 2), 8),
    ...sampleEvenly(sideRails, 8),
  ];
  return uniqueNumbers(anchors);
}

function sampleEvenly(values: readonly number[], maximum: number): number[] {
  if (values.length <= maximum) return [...values];
  const result: number[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round(index * (values.length - 1) / Math.max(1, maximum - 1));
    const value = values[sourceIndex];
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}
function appendEdge(
  edges: Map<string, EdgeRecord>,
  a: number,
  b: number,
  opposite: number,
  instance: AssemblyPanelInstance,
): void {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  if (!edges.has(key)) edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), opposite, instance });
}

function appendBendingConstraints(
  triangles: Uint32Array,
  instance: AssemblyPanelInstance,
  initialPositions: Float32Array,
  physics: FabricPhysics,
  indices: number[],
  restLengths: number[],
  compliances: number[],
  kinds: number[],
): void {
  const shared = new Map<string, number>();
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const vertices = [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
    for (let edge = 0; edge < 3; edge += 1) {
      const first = vertices[edge];
      const second = vertices[(edge + 1) % 3];
      const opposite = vertices[(edge + 2) % 3];
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      const previousOpposite = shared.get(key);
      if (previousOpposite === undefined) {
        shared.set(key, opposite);
        continue;
      }
      const a = instance.particleStart + previousOpposite;
      const b = instance.particleStart + opposite;
      const rest = restDistance3D(initialPositions, a, b);
      if (rest <= 1e-9) continue;
      indices.push(a, b);
      restLengths.push(rest);
      compliances.push(0.00008 + (1 - clamp01(physics.bending)) * 0.0025);
      kinds.push(1);
    }
  }
}

function appendShear(
  indices: number[],
  restCosines: number[],
  compliances: number[],
  initialPositions: Float32Array,
  a: number,
  b: number,
  c: number,
  physics: FabricPhysics,
): void {
  const e1x = initialPositions[b * 3] - initialPositions[a * 3];
  const e1y = initialPositions[b * 3 + 1] - initialPositions[a * 3 + 1];
  const e1z = initialPositions[b * 3 + 2] - initialPositions[a * 3 + 2];
  const e2x = initialPositions[c * 3] - initialPositions[a * 3];
  const e2y = initialPositions[c * 3 + 1] - initialPositions[a * 3 + 1];
  const e2z = initialPositions[c * 3 + 2] - initialPositions[a * 3 + 2];
  const denominator = Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z);
  if (denominator <= 1e-12) return;
  indices.push(a, b, c);
  restCosines.push((e1x * e2x + e1y * e2y + e1z * e2z) / denominator);
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

function pointReferenceDistance(
  positions: Float32Array,
  first: GlobalPointReference,
  second: GlobalPointReference,
): number {
  const evaluate = (reference: GlobalPointReference): [number, number, number] => {
    const result: [number, number, number] = [0, 0, 0];
    reference.particleIndices.forEach((particle, index) => {
      const weight = reference.weights[index] ?? 0;
      result[0] += positions[particle * 3] * weight;
      result[1] += positions[particle * 3 + 1] * weight;
      result[2] += positions[particle * 3 + 2] * weight;
    });
    return result;
  };
  const a = evaluate(first);
  const b = evaluate(second);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function seamGroupSampleCount(state: GarmentAssemblyState, seamGroupId: string): number {
  let count = 0;
  for (const seam of state.stitchConstraints) if (seam.seamGroupId === seamGroupId) count += 1;
  return count;
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

function restDistance3D(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[b * 3] - positions[a * 3],
    positions[b * 3 + 1] - positions[a * 3 + 1],
    positions[b * 3 + 2] - positions[a * 3 + 2],
  );
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
