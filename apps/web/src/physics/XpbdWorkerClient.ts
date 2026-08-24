import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import {
  initializationTransferables,
  type XpbdAutoPauseSteps,
  type XpbdSimulationCadence,
  type XpbdWorkerDiagnostics,
  type XpbdWorkerRequest,
  type XpbdWorkerResponse,
} from "./xpbdProtocol";
import type { XpbdWorkerLifecycleSnapshot } from "./xpbdProtocol";

export interface XpbdFrame {
  revision: string;
  generation: number;
  epoch: number;
  sequence: number;
  positions: Float32Array;
  diagnostics: XpbdWorkerDiagnostics;
}

export interface XpbdWorkerClientCallbacks {
  onReady?(revision: string, generation: number, epoch: number, diagnostics: XpbdWorkerDiagnostics): void;
  onFrame?(frame: XpbdFrame): void;
  onState?(generation: number, running: boolean, disposed: boolean, snapshot: XpbdWorkerLifecycleSnapshot): void;
  onDiscardedFrame?(revision: string, generation: number, epoch: number, reason: string): void;
  onError?(message: string, recoverable: boolean): void;
}

export class XpbdWorkerClient {
  private readonly worker: Worker;
  private disposed = false;
  private latestFrame: XpbdFrame | null = null;
  private generation = 0;
  private epoch = 0;
  private commandId = 0;
  private expectedRevision: string | null = null;

  constructor(private readonly callbacks: XpbdWorkerClientCallbacks = {}) {
    this.worker = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
      type: "module",
      name: "moldeon-xpbd",
    });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  initialize(payload: XpbdInitializationData): { generation: number; epoch: number } {
    this.recycleLatestFrame();
    this.generation += 1;
    this.epoch += 1;
    this.commandId += 1;
    this.expectedRevision = payload.revision;
    this.post({ type: "initialize", generation: this.generation, epoch: this.epoch, commandId: this.commandId, payload }, initializationTransferables(payload));
    return { generation: this.generation, epoch: this.epoch };
  }

  updateGeometry(payload: XpbdInitializationData): { generation: number; epoch: number } {
    this.recycleLatestFrame();
    this.generation += 1;
    this.epoch += 1;
    this.commandId += 1;
    this.expectedRevision = payload.revision;
    this.post({ type: "updateGeometry", generation: this.generation, epoch: this.epoch, commandId: this.commandId, payload }, initializationTransferables(payload));
    return { generation: this.generation, epoch: this.epoch };
  }

  start(): number { return this.sendLifecycle("start"); }
  pause(): number { return this.sendLifecycle("pause"); }
  resume(): number { return this.sendLifecycle("resume"); }
  step(deltaSeconds?: number): number {
    return this.sendLifecycle("step", deltaSeconds === undefined ? {} : { deltaSeconds });
  }
  reset(): number { return this.sendLifecycle("reset"); }

  configureDev(settings: {
    gravity: [number, number, number];
    cadence: XpbdSimulationCadence;
    autoPauseSteps: XpbdAutoPauseSteps;
    bodyCollisionEnabled?: boolean;
    floorCollisionEnabled?: boolean;
  }): void {
    this.post({ type: "configureDev", generation: this.generation, ...settings });
  }

  consumeLatestFrame(): XpbdFrame | null {
    const frame = this.latestFrame;
    this.latestFrame = null;
    return frame;
  }

  recycleFrame(frame: XpbdFrame): void {
    if (this.disposed || frame.positions.byteLength === 0) return;
    this.post({ type: "recyclePositions", buffer: frame.positions.buffer as ArrayBuffer }, [frame.positions.buffer as ArrayBuffer]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.recycleLatestFrame();
    this.epoch += 1;
    this.commandId += 1;
    this.post({ type: "dispose", generation: this.generation, epoch: this.epoch, commandId: this.commandId });
    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.terminate();
  }

  private readonly handleMessage = (event: MessageEvent<XpbdWorkerResponse>): void => {
    const message = event.data;
    if (message.type === "positions") {
      if (message.generation !== this.generation || message.revision !== this.expectedRevision || message.epoch !== this.epoch) {
        this.callbacks.onDiscardedFrame?.(
          message.revision,
          message.generation,
          message.epoch,
          message.generation !== this.generation ? "generation" : message.revision !== this.expectedRevision ? "revision" : "epoch",
        );
        if (message.positions.byteLength > 0) {
          this.post({ type: "recyclePositions", buffer: message.positions.buffer as ArrayBuffer }, [message.positions.buffer as ArrayBuffer]);
        }
        return;
      }
      if (this.latestFrame) this.recycleFrame(this.latestFrame);
      this.latestFrame = message;
      this.callbacks.onFrame?.(message);
      return;
    }
    if (message.type === "ready") {
      if (message.generation !== this.generation || message.revision !== this.expectedRevision || message.epoch !== this.epoch) return;
      this.callbacks.onReady?.(message.revision, message.generation, message.epoch, message.diagnostics);
      return;
    }
    if (message.type === "state") {
      if ((message.generation !== this.generation || message.epoch !== this.epoch) && !message.disposed) return;
      this.callbacks.onState?.(message.generation, message.running, message.disposed, message.snapshot);
      return;
    }
    if (message.type === "error") {
      if (message.generation !== this.generation || message.epoch !== this.epoch) return;
      this.callbacks.onError?.(message.message, message.recoverable);
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.callbacks.onError?.(event.message || "Falha no Worker XPBD.", false);
  };

  private recycleLatestFrame(): void {
    if (!this.latestFrame) return;
    this.recycleFrame(this.latestFrame);
    this.latestFrame = null;
  }

  private sendLifecycle<T extends "start" | "pause" | "resume" | "step" | "reset">(
    type: T,
    extra: T extends "step" ? { deltaSeconds?: number } : Record<string, never> = {} as never,
  ): number {
    this.recycleLatestFrame();
    this.epoch += 1;
    this.commandId += 1;
    this.post({ type, generation: this.generation, epoch: this.epoch, commandId: this.commandId, ...extra } as XpbdWorkerRequest);
    return this.epoch;
  }

  private post(message: XpbdWorkerRequest, transfer: Transferable[] = []): void {
    if (this.disposed) return;
    this.worker.postMessage(message, transfer);
  }
}
