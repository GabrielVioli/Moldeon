import * as THREE from "three";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import {
  captureGarmentMeshDiagnostics,
  type GarmentAssemblyMeshData,
  type GarmentMeshDiagnostic,
} from "../garment3d/GarmentThreeBridge";
import { auditAssemblySeamResiduals } from "../garment3d/InitialSeamResidual";

interface WorkspaceSeedPanel {
  instanceId: string;
  geometrySignature: string;
  topologySignature: string;
  worldPositions: Float32Array;
  arrangement?: GarmentAssemblyState["instances"][number]["arrangement"];
}

export interface WorkspaceAssemblySeed {
  source: "workspace-rendered-step0";
  geometryRevision: string;
  sewingRevision: string;
  arrangementRevision: string;
  panels: WorkspaceSeedPanel[];
}

export interface AssemblyTransitionDiagnostic {
  source: "workspace-rendered-step0" | "simulation-worker-solve" | "workspace-seed-transfer";
  revision: string;
  geometryRevision: string;
  simulationRevision: string;
  strategy: string;
  positionSignature: string;
  garmentCentroid: [number, number, number];
  garmentBoundingBox: { min: [number, number, number]; max: [number, number, number] };
  instances: Array<{
    id: string;
    geometrySignature: string;
    centroid: [number, number, number];
    boundingBox: { min: [number, number, number]; max: [number, number, number] };
    transform: GarmentMeshDiagnostic["transform"];
    arrangementAnchor: ResolvedAssemblyInput["panelInstances"][number]["arrangementAnchor"] | null;
    assemblyArrangement: GarmentAssemblyState["instances"][number]["arrangement"] | null;
  }>;
  seamResiduals: {
    sampleCount: number;
    meanResidualMm: number;
    maxResidualMm: number;
    groups: Array<{ seamGroupId: string; sampleCount: number; meanResidualMm: number; maxResidualMm: number }>;
  };
  meshDiagnostics?: GarmentMeshDiagnostic[];
}

export interface WorkspaceAssemblyCapture {
  seed: WorkspaceAssemblySeed;
  diagnostic: AssemblyTransitionDiagnostic;
}

export interface WorkspaceSeedTransferResult {
  applied: boolean;
  reason:
    | "applied"
    | "geometry-revision-mismatch"
    | "sewing-revision-mismatch"
    | "arrangement-revision-mismatch"
    | "missing-instance"
    | "topology-mismatch";
  transferredInstanceIds: string[];
}

export function captureWorkspaceAssemblySeed(
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
  input: ResolvedAssemblyInput,
  strategy: string,
): WorkspaceAssemblyCapture | null {
  const meshById = new Map(meshes.map((item) => [item.key, item] as const));
  const positions = new Float32Array(state.positions);
  const panels: WorkspaceSeedPanel[] = [];
  for (const instance of state.instances) {
    const mesh = meshById.get(instance.id);
    if (!mesh || mesh.mesh.geometry.getAttribute("position").count !== instance.vertexCount) return null;
    const world = meshWorldPositions(mesh.mesh);
    positions.set(world, instance.particleStart * 3);
    panels.push({
      instanceId: instance.id,
      geometrySignature: instance.geometrySignature,
      topologySignature: instanceTopologySignature(instance),
      worldPositions: world,
      ...(instance.arrangement ? { arrangement: structuredClone(instance.arrangement) } : {}),
    });
  }
  const materializedState: GarmentAssemblyState = {
    ...state,
    positions,
    initialPositions: new Float32Array(positions),
    previousPositions: new Float32Array(positions),
  };
  const seed: WorkspaceAssemblySeed = {
    source: "workspace-rendered-step0",
    geometryRevision: input.geometryRevision,
    sewingRevision: input.sewingRevision,
    arrangementRevision: input.arrangementRevision,
    panels,
  };
  return {
    seed,
    diagnostic: captureAssemblyTransitionDiagnostic(
      materializedState,
      input,
      "workspace-rendered-step0",
      input.geometryRevision,
      strategy,
      captureGarmentMeshDiagnostics(meshes),
    ),
  };
}

export function applyWorkspaceAssemblySeed(
  state: GarmentAssemblyState,
  seed: WorkspaceAssemblySeed,
  input: ResolvedAssemblyInput,
): WorkspaceSeedTransferResult {
  if (seed.geometryRevision !== input.geometryRevision) {
    return { applied: false, reason: "geometry-revision-mismatch", transferredInstanceIds: [] };
  }
  if (seed.sewingRevision !== input.sewingRevision) {
    return { applied: false, reason: "sewing-revision-mismatch", transferredInstanceIds: [] };
  }
  if (seed.arrangementRevision !== input.arrangementRevision) {
    return { applied: false, reason: "arrangement-revision-mismatch", transferredInstanceIds: [] };
  }
  if (state.instances.length === 0) {
    return { applied: false, reason: "missing-instance", transferredInstanceIds: [] };
  }
  const seedById = new Map(seed.panels.map((panel) => [panel.instanceId, panel] as const));
  for (const instance of state.instances) {
    const panel = seedById.get(instance.id);
    if (!panel) return { applied: false, reason: "missing-instance", transferredInstanceIds: [] };
    if (panel.geometrySignature !== instance.geometrySignature
      || panel.worldPositions.length !== instance.vertexCount * 3
      || panel.topologySignature !== instanceTopologySignature(instance)) {
      return { applied: false, reason: "topology-mismatch", transferredInstanceIds: [] };
    }
  }

  const transferredInstanceIds: string[] = [];
  for (const instance of state.instances) {
    const panel = seedById.get(instance.id)!;
    const offset = instance.particleStart * 3;
    state.positions.set(panel.worldPositions, offset);
    state.initialPositions.set(panel.worldPositions, offset);
    state.previousPositions.set(panel.worldPositions, offset);
    if (panel.arrangement) instance.arrangement = structuredClone(panel.arrangement);
    transferredInstanceIds.push(instance.id);
  }
  for (const anchor of state.anchorConstraints) {
    const offset = anchor.particleIndex * 3;
    anchor.targetX = state.positions[offset];
    anchor.targetY = state.positions[offset + 1];
    anchor.targetZ = state.positions[offset + 2];
  }
  return { applied: true, reason: "applied", transferredInstanceIds };
}

export function captureAssemblyTransitionDiagnostic(
  state: GarmentAssemblyState,
  input: ResolvedAssemblyInput,
  source: AssemblyTransitionDiagnostic["source"],
  revision: string,
  strategy: string,
  meshDiagnostics?: GarmentMeshDiagnostic[],
): AssemblyTransitionDiagnostic {
  const anchors = new Map(input.panelInstances.map((instance) => [instance.id, instance.arrangementAnchor ?? null] as const));
  const meshDiagnosticById = new Map(meshDiagnostics?.map((diagnostic) => [diagnostic.id, diagnostic] as const) ?? []);
  const instances = state.instances.map((instance) => {
    const bounds = rangeBounds(state.positions, instance.particleStart, instance.vertexCount);
    const meshDiagnostic = meshDiagnosticById.get(instance.id);
    return {
      id: instance.id,
      geometrySignature: instance.geometrySignature,
      centroid: bounds.centroid,
      boundingBox: { min: bounds.min, max: bounds.max },
      transform: meshDiagnostic?.transform ?? {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        matrixWorld: new THREE.Matrix4().toArray(),
      },
      arrangementAnchor: structuredClone(anchors.get(instance.id) ?? null),
      assemblyArrangement: instance.arrangement ? structuredClone(instance.arrangement) : null,
    };
  });
  const garment = rangeBounds(state.positions, 0, state.positions.length / 3);
  const residuals = auditAssemblySeamResiduals(state, input.garmentProjection);
  return {
    source,
    revision,
    geometryRevision: input.geometryRevision,
    simulationRevision: input.simulationRevision,
    strategy,
    positionSignature: assemblyPositionSignature(state.positions),
    garmentCentroid: garment.centroid,
    garmentBoundingBox: { min: garment.min, max: garment.max },
    instances,
    seamResiduals: {
      sampleCount: residuals.sampleCount,
      meanResidualMm: residuals.meanResidualMm,
      maxResidualMm: residuals.maxResidualMm,
      groups: residuals.groups.map((group) => ({
        seamGroupId: group.seamGroupId,
        sampleCount: group.sampleCount,
        meanResidualMm: group.meanResidualMm,
        maxResidualMm: group.maxResidualMm,
      })),
    },
    ...(meshDiagnostics ? { meshDiagnostics } : {}),
  };
}

export function assemblyPositionSignature(positions: Float32Array): string {
  const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${positions.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function meshWorldPositions(mesh: THREE.Mesh): Float32Array {
  const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  mesh.updateMatrixWorld(true);
  const result = new Float32Array(attribute.count * 3);
  const point = new THREE.Vector3();
  for (let index = 0; index < attribute.count; index += 1) {
    point.fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld);
    result[index * 3] = point.x;
    result[index * 3 + 1] = point.y;
    result[index * 3 + 2] = point.z;
  }
  return result;
}

function instanceTopologySignature(instance: GarmentAssemblyState["instances"][number]): string {
  let hash = 0x811c9dc5;
  const add = (value: number) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (value >>> 24) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  };
  add(instance.vertexCount);
  for (const index of instance.topology.triangles) add(index);
  for (const source of instance.vertexSources) {
    const text = JSON.stringify(source);
    for (let index = 0; index < text.length; index += 1) add(text.charCodeAt(index));
  }
  return `${instance.geometrySignature}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function rangeBounds(
  positions: Float32Array,
  particleStart: number,
  vertexCount: number,
): { min: [number, number, number]; max: [number, number, number]; centroid: [number, number, number] } {
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const centroid: [number, number, number] = [0, 0, 0];
  for (let local = 0; local < vertexCount; local += 1) {
    const offset = (particleStart + local) * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
      centroid[axis] += value;
    }
  }
  if (vertexCount === 0) return { min: [0, 0, 0], max: [0, 0, 0], centroid: [0, 0, 0] };
  centroid[0] /= vertexCount;
  centroid[1] /= vertexCount;
  centroid[2] /= vertexCount;
  return { min, max, centroid };
}
