import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import { XpbdWorkerClient, type XpbdFrame } from "./XpbdWorkerClient";

class FakeWorker {
  static current: FakeWorker | null = null;
  readonly requests: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor() { FakeWorker.current = this; }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown): void { this.requests.push(message); }

  emit(message: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: message } as MessageEvent);
  }

  terminate(): void { /* lifecycle observado pelas mensagens. */ }
}

describe("XpbdWorkerClient revision and lifecycle epochs", () => {
  beforeEach(() => {
    FakeWorker.current = null;
    vi.stubGlobal("Worker", FakeWorker);
  });

  it("rejects a late A frame after A → B → A rebuilds", () => {
    const accepted: XpbdFrame[] = [];
    const discarded: Array<{ revision: string; generation: number; epoch: number; reason: string }> = [];
    const client = new XpbdWorkerClient({
      onFrame: (value) => accepted.push(value),
      onDiscardedFrame: (revision, generation, epoch, reason) => discarded.push({ revision, generation, epoch, reason }),
    });
    const worker = FakeWorker.current!;
    const first = client.updateGeometry(initialization("revision-a", 4));
    client.updateGeometry(initialization("revision-b", 7));
    const restored = client.updateGeometry(initialization("revision-a", 4));

    worker.emit(frame("revision-a", first.generation, first.epoch, 4));
    worker.emit(frame("revision-a", restored.generation, restored.epoch, 4));

    expect(first.generation).toBe(1);
    expect(restored.generation).toBe(3);
    expect(discarded).toEqual([{ revision: "revision-a", generation: 1, epoch: 1, reason: "generation" }]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].generation).toBe(3);
    expect(worker.requests).toContainEqual(expect.objectContaining({ type: "recyclePositions" }));
    client.dispose();
  });

  it("rejects a pre-reset frame from the same revision and generation", () => {
    const accepted: XpbdFrame[] = [];
    const discarded: Array<{ epoch: number; reason: string }> = [];
    const client = new XpbdWorkerClient({
      onFrame: (value) => accepted.push(value),
      onDiscardedFrame: (_revision, _generation, epoch, reason) => discarded.push({ epoch, reason }),
    });
    const worker = FakeWorker.current!;
    const initialized = client.updateGeometry(initialization("revision-a", 4));
    const resetEpoch = client.reset();

    worker.emit(frame("revision-a", initialized.generation, initialized.epoch, 4));
    worker.emit(frame("revision-a", initialized.generation, resetEpoch, 4));

    expect(discarded).toEqual([{ epoch: initialized.epoch, reason: "epoch" }]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].epoch).toBe(resetEpoch);
    client.dispose();
  });

  it("assigns a monotonic epoch to rapid lifecycle commands", () => {
    const client = new XpbdWorkerClient();
    const worker = FakeWorker.current!;
    const initialized = client.updateGeometry(initialization("revision-a", 4));
    const firstResume = client.resume();
    const secondResume = client.resume();
    const reset = client.reset();
    const commands = worker.requests.filter((request): request is Record<string, unknown> =>
      typeof request === "object" && request !== null && "type" in request && request.type !== "recyclePositions");

    expect([initialized.epoch, firstResume, secondResume, reset]).toEqual([1, 2, 3, 4]);
    expect(commands.map((request) => request.type)).toEqual(["updateGeometry", "resume", "resume", "reset"]);
    expect(commands.map((request) => request.epoch)).toEqual([1, 2, 3, 4]);
    expect(commands.map((request) => request.commandId)).toEqual([1, 2, 3, 4]);
    client.dispose();
  });

  it("sends transient DEV settings without changing the lifecycle identity", () => {
    const client = new XpbdWorkerClient();
    const worker = FakeWorker.current!;
    const initialized = client.updateGeometry(initialization("revision-a", 4));

    client.configureDev({ gravity: [0, 0, 0], cadence: 0.25, autoPauseSteps: 60 });

    expect(worker.requests.at(-1)).toEqual({
      type: "configureDev",
      generation: initialized.generation,
      gravity: [0, 0, 0],
      cadence: 0.25,
      autoPauseSteps: 60,
    });
    expect(client.resume()).toBe(initialized.epoch + 1);
    client.dispose();
  });

  it("ignores stale state acknowledgements and stale errors after reset", () => {
    const states: Array<{ running: boolean; epoch: number }> = [];
    const errors: string[] = [];
    const client = new XpbdWorkerClient({
      onState: (_generation, running, _disposed, snapshot) => states.push({ running, epoch: snapshot.epoch }),
      onError: (message) => errors.push(message),
    });
    const worker = FakeWorker.current!;
    const initialized = client.updateGeometry(initialization("revision-a", 4));
    const runningEpoch = client.resume();
    const resetEpoch = client.reset();

    worker.emit(lifecycleState(initialized.generation, runningEpoch, true, "resume"));
    worker.emit({
      type: "error",
      revision: "revision-a",
      generation: initialized.generation,
      epoch: runningEpoch,
      message: "erro antigo",
      recoverable: true,
    });
    worker.emit(lifecycleState(initialized.generation, resetEpoch, false, "reset"));

    expect(states).toEqual([{ running: false, epoch: resetEpoch }]);
    expect(errors).toEqual([]);
    client.dispose();
  });
});

function lifecycleState(generation: number, epoch: number, running: boolean, lastCommand: "resume" | "reset") {
  return {
    type: "state" as const,
    generation,
    epoch,
    running,
    disposed: false,
    snapshot: {
      timestampMs: 1,
      lifecycle: running ? "running" as const : "paused" as const,
      generation,
      epoch,
      commandId: epoch,
      stepCount: running ? 1 : 0,
      accumulator: 0,
      timerActive: running,
      timersStarted: running ? 1 : 0,
      timersCanceled: running ? 0 : 1,
      framesProduced: 0,
      framesSent: 0,
      commandsProcessed: epoch,
      lastCommand,
    },
  };
}

function initialization(revision: string, particleCount: number): XpbdInitializationData {
  const positions = new Float32Array(particleCount * 3);
  return {
    revision,
    topologyDiagnostics: {
      revision,
      panels: [],
      particleCount,
      positionsLength: positions.length,
      triangleCount: 0,
      maximumTriangleIndex: -1,
      stretchConstraintCount: 0,
      shearConstraintCount: 0,
      bendConstraintCount: 0,
      seamConstraintCount: 0,
      seamConstraintsByGroup: {},
      finitePositionCount: positions.length,
      valid: true,
    },
    seamResidualAudit: {
      stage: "adapter",
      sampleCount: 0,
      meanResidualMm: 0,
      maxResidualMm: 0,
      groups: [],
      invariantErrors: [],
      maximumCorrespondenceJumpMm: 0,
    },
    positions,
    previousPositions: new Float32Array(positions),
    predictedPositions: new Float32Array(positions),
    velocities: new Float32Array(positions.length),
    inverseMasses: new Float32Array(particleCount).fill(1),
    restPositions: new Float32Array(positions),
    materialCoordinates: new Float32Array(particleCount * 2),
    triangles: new Uint32Array(),
    distanceIndices: new Uint32Array(),
    distanceRestLengths: new Float32Array(),
    distanceCompliances: new Float32Array(),
    distanceKinds: new Uint8Array(),
    shearIndices: new Uint32Array(),
    shearRestCosines: new Float32Array(),
    shearCompliances: new Float32Array(),
    seamIndices: new Uint32Array(),
    seamWeights: new Float32Array(),
    seamRestDistances: new Float32Array(),
    seamCompliances: new Float32Array(),
    seamRelaxations: new Float32Array(),
    seamGroupIds: [],
    pinIndices: new Uint32Array(),
    pinTargets: new Float32Array(),
    config: {
      fixedTimeStep: 1 / 120,
      maximumFrameDelta: 1 / 20,
      maximumSubsteps: 2,
      iterations: 5,
      damping: 0.996,
      gravity: [0, -9.81, 0],
      maximumCorrection: 0.035,
      maximumVelocity: 12,
      seamTolerance: 0.0025,
    },
  };
}

function frame(revision: string, generation: number, epoch: number, particleCount: number): XpbdFrame & { type: "positions" } {
  return {
    type: "positions",
    revision,
    generation,
    epoch,
    sequence: 1,
    positions: new Float32Array(particleCount * 3),
    diagnostics: {
      stepCount: 1,
      substeps: 1,
      particleCount,
      triangleCount: 0,
      stretchConstraintCount: 0,
      shearConstraintCount: 0,
      bendConstraintCount: 0,
      seamConstraintCount: 0,
      seamErrorAverage: 0,
      seamErrorMaximum: 0,
      seamErrorsByGroup: {},
      maximumPositionMagnitude: 0,
      maximumVelocityMagnitude: 0,
      maximumCorrectionApplied: 0,
      invalid: false,
      droppedTimeSeconds: 0,
    },
  };
}
