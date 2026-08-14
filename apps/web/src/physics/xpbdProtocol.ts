import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import type { XpbdSolverConfig, XpbdStepDiagnostics } from "./xpbd";

export type XpbdWorkerRequest =
  | { type: "initialize"; generation: number; payload: XpbdInitializationData }
  | { type: "updateGeometry"; generation: number; payload: XpbdInitializationData }
  | { type: "updateSeams"; revision: string; seamIndices: Uint32Array; seamWeights: Float32Array; seamRestDistances: Float32Array; seamCompliances: Float32Array; seamRelaxations: Float32Array; seamGroupIds: string[] }
  | { type: "updateFabric"; revision: string; distanceCompliances: Float32Array; shearCompliances: Float32Array; config?: Partial<XpbdSolverConfig> }
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "step"; deltaSeconds?: number }
  | { type: "reset" }
  | { type: "recyclePositions"; buffer: ArrayBuffer }
  | { type: "dispose" };

export type XpbdWorkerResponse =
  | { type: "ready"; revision: string; generation: number; diagnostics: XpbdStepDiagnostics }
  | { type: "positions"; revision: string; generation: number; sequence: number; positions: Float32Array; diagnostics: XpbdStepDiagnostics }
  | { type: "state"; generation: number; running: boolean; disposed: boolean }
  | { type: "error"; revision?: string; generation: number; message: string; recoverable: boolean };

export function initializationTransferables(payload: XpbdInitializationData): Transferable[] {
  return [
    payload.positions.buffer,
    payload.previousPositions.buffer,
    payload.predictedPositions.buffer,
    payload.velocities.buffer,
    payload.inverseMasses.buffer,
    payload.restPositions.buffer,
    payload.materialCoordinates.buffer,
    payload.triangles.buffer,
    payload.distanceIndices.buffer,
    payload.distanceRestLengths.buffer,
    payload.distanceCompliances.buffer,
    payload.distanceKinds.buffer,
    payload.shearIndices.buffer,
    payload.shearRestCosines.buffer,
    payload.shearCompliances.buffer,
    payload.seamIndices.buffer,
    payload.seamWeights.buffer,
    payload.seamRestDistances.buffer,
    payload.seamCompliances.buffer,
    payload.seamRelaxations.buffer,
    payload.pinIndices.buffer,
    payload.pinTargets.buffer,
  ];
}
