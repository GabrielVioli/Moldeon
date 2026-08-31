import type { GarmentAssemblyState } from "./GarmentAssembly";
import type { IsometricSurfaceAssemblyResult } from "./IsometricSurfaceAssembly";

export interface AssemblyWorkerSolveRequest {
  type: "solve";
  generation: number;
  revision: string;
  serializedDocument: string;
  mode?: "workspace" | "simulation";
}

export interface AssemblyWorkerDisposeRequest {
  type: "dispose";
  generation: number;
}

export type AssemblyWorkerRequest = AssemblyWorkerSolveRequest | AssemblyWorkerDisposeRequest;

export interface AssemblyWorkerDiagnostics {
  coarseVertexCount: number;
  coarseTriangleCount: number;
  fineVertexCount: number;
  hingeCount: number;
  reductionRatio: number;
  fineBindingBuildMs: number;
  fineTransferMs: number;
  assembly: IsometricSurfaceAssemblyResult;
}

export interface AssemblyWorkerSolvedResponse {
  type: "solved";
  generation: number;
  revision: string;
  state: GarmentAssemblyState;
  diagnostics: AssemblyWorkerDiagnostics;
  warnings: string[];
}

export interface AssemblyWorkerErrorResponse {
  type: "error";
  generation: number;
  revision: string;
  message: string;
  stack?: string;
}

export type AssemblyWorkerResponse = AssemblyWorkerSolvedResponse | AssemblyWorkerErrorResponse;

/**
 * Transfer only buffers owned by the geometric assembly state. Velocity and
 * other temporal XPBD buffers do not exist yet by design. Plain JS arrays
 * such as cumulative boundary lengths remain structured-cloned.
 */
export function collectAssemblyStateTransferables(state: GarmentAssemblyState): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (view: ArrayBufferView | undefined): void => {
    if (!view) return;
    const buffer = view.buffer;
    if (buffer instanceof ArrayBuffer) buffers.add(buffer);
  };
  add(state.positions);
  add(state.initialPositions);
  add(state.previousPositions);
  add(state.inverseMasses);
  for (const instance of state.instances) {
    add(instance.topology.positions2DMm);
    add(instance.topology.positions2D);
    add(instance.topology.triangles);
  }
  return [...buffers];
}
