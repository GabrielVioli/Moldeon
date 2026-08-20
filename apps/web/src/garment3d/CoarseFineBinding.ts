import type { GarmentAssemblyState } from "./GarmentAssembly";
import {
  bindMaterialPoint,
  evaluateCoarseBinding,
  type CoarseAssemblySet,
  type CoarseMaterialBinding,
} from "./CoarseAssemblyMesh";

export interface FineVertexCoarseBinding {
  panelInstanceId: string;
  fineParticleIndex: number;
  fineLocalVertex: number;
  coarse: CoarseMaterialBinding;
}

export interface CoarseFineBindingSet {
  bindings: FineVertexCoarseBinding[];
  byInstance: Map<string, FineVertexCoarseBinding[]>;
  buildMs: number;
}

/** Build once on geometry rebuild in material space. Never used as a per-frame search. */
export function buildCoarseFineBindings(
  state: GarmentAssemblyState,
  coarse: CoarseAssemblySet,
): CoarseFineBindingSet {
  const started = nowMs();
  const bindings: FineVertexCoarseBinding[] = [];
  const byInstance = new Map<string, FineVertexCoarseBinding[]>();

  for (const instance of state.instances.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const mesh = coarse.byInstanceId.get(instance.id);
    if (!mesh) throw new Error(`CoarseAssemblyMesh ausente para ${instance.id}.`);
    const localBindings: FineVertexCoarseBinding[] = [];
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const xMm = instance.topology.positions2DMm[local * 2];
      const yMm = instance.topology.positions2DMm[local * 2 + 1];
      const direct = local < mesh.materialPositionsMm.length / 2
        && Math.abs(mesh.materialPositionsMm[local * 2] - xMm) <= 1e-6
        && Math.abs(mesh.materialPositionsMm[local * 2 + 1] - yMm) <= 1e-6;
      const binding: FineVertexCoarseBinding = {
        panelInstanceId: instance.id,
        fineParticleIndex: instance.particleStart + local,
        fineLocalVertex: local,
        coarse: direct
          ? {
              triangleIndex: 0,
              vertices: [local, local, local],
              weights: [1, 0, 0],
              materialXMm: xMm,
              materialYMm: yMm,
            }
          : bindMaterialPoint(mesh, xMm, yMm),
      };
      bindings.push(binding);
      localBindings.push(binding);
    }
    byInstance.set(instance.id, localBindings);
  }
  return { bindings, byInstance, buildMs: nowMs() - started };
}

export function transferCoarseAssemblyToFine(
  state: GarmentAssemblyState,
  coarse: CoarseAssemblySet,
  bindings: CoarseFineBindingSet,
): number {
  const started = nowMs();
  for (const binding of bindings.bindings) {
    const mesh = coarse.byInstanceId.get(binding.panelInstanceId);
    if (!mesh) throw new Error(`CoarseAssemblyMesh ausente para ${binding.panelInstanceId}.`);
    const position = evaluateCoarseBinding(mesh, binding.coarse);
    const offset = binding.fineParticleIndex * 3;
    state.positions[offset] = position[0];
    state.positions[offset + 1] = position[1];
    state.positions[offset + 2] = position[2];
  }
  state.initialPositions.set(state.positions);
  state.previousPositions.set(state.positions);
  return nowMs() - started;
}

export function verifyFineBindingOwnership(
  state: GarmentAssemblyState,
  bindings: CoarseFineBindingSet,
): string[] {
  const issues: string[] = [];
  const ownerByParticle = new Map<number, string>();
  for (const instance of state.instances) {
    for (let local = 0; local < instance.vertexCount; local += 1) {
      ownerByParticle.set(instance.particleStart + local, instance.id);
    }
  }
  for (const binding of bindings.bindings) {
    if (ownerByParticle.get(binding.fineParticleIndex) !== binding.panelInstanceId) {
      issues.push(`particle ${binding.fineParticleIndex}: ownership mismatch`);
    }
    const sum = binding.coarse.weights[0] + binding.coarse.weights[1] + binding.coarse.weights[2];
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-5) {
      issues.push(`particle ${binding.fineParticleIndex}: barycentric weights invalid`);
    }
    if (binding.coarse.weights.some((weight) => !Number.isFinite(weight) || weight < -1e-5 || weight > 1 + 1e-5)) {
      issues.push(`particle ${binding.fineParticleIndex}: barycentric component invalid`);
    }
  }
  return issues;
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
