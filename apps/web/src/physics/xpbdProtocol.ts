import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import type { XpbdSolverConfig, XpbdStepDiagnostics } from "./xpbd";

export interface XpbdWorkerLifecycleSnapshot {
  timestampMs: number;
  lifecycle: "paused" | "running" | "disposed";
  generation: number;
  epoch: number;
  commandId: number;
  stepCount: number;
  accumulator: number;
  timerActive: boolean;
  timersStarted: number;
  timersCanceled: number;
  framesProduced: number;
  framesSent: number;
  commandsProcessed: number;
  lastCommand: XpbdWorkerRequest["type"];
}

export interface XpbdCommandIdentity {
  generation: number;
  epoch: number;
  commandId: number;
}

export type XpbdWorkerRequest =
  | ({ type: "initialize"; payload: XpbdInitializationData } & XpbdCommandIdentity)
  | ({ type: "updateGeometry"; payload: XpbdInitializationData } & XpbdCommandIdentity)
  | { type: "updateSeams"; revision: string; seamIndices: Uint32Array; seamWeights: Float32Array; seamRestDistances: Float32Array; seamCompliances: Float32Array; seamRelaxations: Float32Array; seamGroupIds: string[] }
  | { type: "updateFabric"; revision: string; distanceCompliances: Float32Array; shearCompliances: Float32Array; config?: Partial<XpbdSolverConfig> }
  | ({ type: "start" } & XpbdCommandIdentity)
  | ({ type: "pause" } & XpbdCommandIdentity)
  | ({ type: "resume" } & XpbdCommandIdentity)
  | ({ type: "step"; deltaSeconds?: number } & XpbdCommandIdentity)
  | ({ type: "reset" } & XpbdCommandIdentity)
  | { type: "recyclePositions"; buffer: ArrayBuffer }
  | ({ type: "dispose" } & XpbdCommandIdentity);

export type XpbdWorkerResponse =
  | { type: "ready"; revision: string; generation: number; epoch: number; diagnostics: XpbdStepDiagnostics }
  | { type: "positions"; revision: string; generation: number; epoch: number; sequence: number; positions: Float32Array; diagnostics: XpbdStepDiagnostics }
  | { type: "state"; generation: number; epoch: number; running: boolean; disposed: boolean; snapshot: XpbdWorkerLifecycleSnapshot }
  | { type: "error"; revision?: string; generation: number; epoch: number; message: string; recoverable: boolean };

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
