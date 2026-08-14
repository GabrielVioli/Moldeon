import type { XpbdInitializationData } from "./GarmentXpbdAdapter";
import {
  initializationTransferables,
  type XpbdWorkerRequest,
  type XpbdWorkerResponse,
} from "./xpbdProtocol";
import type { XpbdStepDiagnostics } from "./xpbd";

export interface XpbdFrame {
  revision: string;
  generation: number;
  sequence: number;
  positions: Float32Array;
  diagnostics: XpbdStepDiagnostics;
}

export interface XpbdWorkerClientCallbacks {
  onReady?(revision: string, generation: number, diagnostics: XpbdStepDiagnostics): void;
  onFrame?(frame: XpbdFrame): void;
  onState?(generation: number, running: boolean, disposed: boolean): void;
  onDiscardedFrame?(revision: string, generation: number, reason: string): void;
  onError?(message: string, recoverable: boolean): void;
}

export class XpbdWorkerClient {
  private readonly worker: Worker;
  private disposed = false;
  private latestFrame: XpbdFrame | null = null;
  private generation = 0;
  private expectedRevision: string | null = null;

  constructor(private readonly callbacks: XpbdWorkerClientCallbacks = {}) {
    this.worker = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
      type: "module",
      name: "moldeon-xpbd",
    });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  initialize(payload: XpbdInitializationData): number {
    this.recycleLatestFrame();
    this.generation += 1;
    this.expectedRevision = payload.revision;
    this.post({ type: "initialize", generation: this.generation, payload }, initializationTransferables(payload));
    return this.generation;
  }

  updateGeometry(payload: XpbdInitializationData): number {
    this.recycleLatestFrame();
    this.generation += 1;
    this.expectedRevision = payload.revision;
    this.post({ type: "updateGeometry", generation: this.generation, payload }, initializationTransferables(payload));
    return this.generation;
  }

  start(): void { this.post({ type: "start" }); }
  pause(): void { this.post({ type: "pause" }); }
  resume(): void { this.post({ type: "resume" }); }
  step(deltaSeconds?: number): void { this.post({ type: "step", ...(deltaSeconds === undefined ? {} : { deltaSeconds }) }); }
  reset(): void { this.post({ type: "reset" }); }

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
    this.post({ type: "dispose" });
    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.terminate();
  }

  private readonly handleMessage = (event: MessageEvent<XpbdWorkerResponse>): void => {
    const message = event.data;
    if (message.type === "positions") {
      if (message.generation !== this.generation || message.revision !== this.expectedRevision) {
        this.callbacks.onDiscardedFrame?.(
          message.revision,
          message.generation,
          message.generation !== this.generation ? "generation" : "revision",
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
      if (message.generation !== this.generation || message.revision !== this.expectedRevision) return;
      this.callbacks.onReady?.(message.revision, message.generation, message.diagnostics);
      return;
    }
    if (message.type === "state") {
      if (message.generation !== this.generation && !message.disposed) return;
      this.callbacks.onState?.(message.generation, message.running, message.disposed);
      return;
    }
    if (message.type === "error") this.callbacks.onError?.(message.message, message.recoverable);
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.callbacks.onError?.(event.message || "Falha no Worker XPBD.", false);
  };

  private recycleLatestFrame(): void {
    if (!this.latestFrame) return;
    this.recycleFrame(this.latestFrame);
    this.latestFrame = null;
  }

  private post(message: XpbdWorkerRequest, transfer: Transferable[] = []): void {
    if (this.disposed) return;
    this.worker.postMessage(message, transfer);
  }
}
