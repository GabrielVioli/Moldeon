import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import { XpbdWorkerClient, type XpbdFrame } from "./XpbdWorkerClient";

class FakeWorker {
  static current: FakeWorker | null = null;
  readonly requests: unknown[] = [];
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor() {
    FakeWorker.current = this;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown): void {
    this.requests.push(message);
  }

  emit(message: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: message } as MessageEvent);
    }
  }

  terminate(): void { /* lifecycle observado pelas mensagens. */ }
}

describe("XpbdWorkerClient revision generations", () => {
  beforeEach(() => {
    FakeWorker.current = null;
    vi.stubGlobal("Worker", FakeWorker);
  });

  it("rejects a late A frame after A → B → A rebuilds", () => {
    const accepted: XpbdFrame[] = [];
    const discarded: Array<{ revision: string; generation: number; reason: string }> = [];
    const client = new XpbdWorkerClient({
      onFrame: (frame) => accepted.push(frame),
      onDiscardedFrame: (revision, generation, reason) => discarded.push({ revision, generation, reason }),
    });
    const worker = FakeWorker.current!;
    const firstGeneration = client.updateGeometry(initialization("revision-a", 4));
    client.updateGeometry(initialization("revision-b", 7));
    const restoredGeneration = client.updateGeometry(initialization("revision-a", 4));

    worker.emit(frame("revision-a", firstGeneration, 4));
    worker.emit(frame("revision-a", restoredGeneration, 4));

    expect(firstGeneration).toBe(1);
    expect(restoredGeneration).toBe(3);
    expect(discarded).toEqual([{ revision: "revision-a", generation: 1, reason: "generation" }]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].generation).toBe(3);
    expect(worker.requests).toContainEqual(expect.objectContaining({ type: "recyclePositions" }));
    client.dispose();
  });
});

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

function frame(revision: string, generation: number, particleCount: number): XpbdFrame & { type: "positions" } {
  return {
    type: "positions",
    revision,
    generation,
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
      maximumPositionMagnitude: 0,
      maximumVelocityMagnitude: 0,
      maximumCorrectionApplied: 0,
      invalid: false,
      droppedTimeSeconds: 0,
    },
  };
}
