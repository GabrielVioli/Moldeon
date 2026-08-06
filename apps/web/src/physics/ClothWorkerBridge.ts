import type {
  ClothSimulationInput,
  ClothSimulationOptions,
  ClothStepReport,
  InterpolatedConstraintBuffer,
} from "./clothXpbd";
import {
  clothInputTransferables,
  stitchTransferables,
  type ClothWorkerCommand,
  type ClothWorkerEvent,
} from "./ClothWorkerProtocol";

export interface ClothWorkerBridgeHandlers {
  onFrame(positions: Float32Array, report: ClothStepReport, frame: number): void;
  onStatus?(status: "initializing" | "running" | "paused" | "disposed"): void;
  onUnstable?(report: ClothStepReport): void;
  onError?(message: string): void;
}

export class ClothWorkerBridge {
  private readonly worker: Worker;
  private disposed = false;
  private initialized = false;
  private pendingStart = false;
  private lastFrame = -1;

  constructor(
    input: ClothSimulationInput,
    private readonly handlers: ClothWorkerBridgeHandlers,
    options: Partial<ClothSimulationOptions> = {},
  ) {
    this.handlers.onStatus?.("initializing");
    this.worker = new Worker(new URL("../workers/cloth.worker.ts", import.meta.url), {
      type: "module",
      name: "moldeon-cloth-xpbd",
    });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
    this.post({ type: "initialize", input, options }, clothInputTransferables(input));
  }

  start(): void {
    if (this.disposed) return;
    if (!this.initialized) {
      this.pendingStart = true;
      return;
    }
    this.post({ type: "start" });
  }

  pause(): void {
    if (this.disposed || !this.initialized) return;
    this.pendingStart = false;
    this.post({ type: "pause" });
  }

  step(): void {
    if (this.disposed || !this.initialized) return;
    this.post({ type: "step" });
  }

  reset(): void {
    if (this.disposed || !this.initialized) return;
    this.lastFrame = -1;
    this.post({ type: "reset" });
  }

  updateGeometry(input: ClothSimulationInput): void {
    if (this.disposed) return;
    this.lastFrame = -1;
    this.post({ type: "update-geometry", input }, clothInputTransferables(input));
  }

  updateSeams(stitches: InterpolatedConstraintBuffer): void {
    if (this.disposed) return;
    this.post({ type: "update-seams", stitches }, stitchTransferables(stitches));
  }

  updateOptions(options: Partial<ClothSimulationOptions>): void {
    if (this.disposed) return;
    this.post({ type: "update-fabric", options });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingStart = false;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.postMessage({ type: "dispose" } satisfies ClothWorkerCommand);
    this.worker.terminate();
    this.handlers.onStatus?.("disposed");
  }

  private readonly handleMessage = (event: MessageEvent<ClothWorkerEvent>): void => {
    if (this.disposed) return;
    const message = event.data;
    switch (message.type) {
      case "ready":
        this.initialized = true;
        this.handlers.onStatus?.("paused");
        if (this.pendingStart) {
          this.pendingStart = false;
          this.start();
        }
        return;
      case "status":
        this.handlers.onStatus?.(message.status);
        return;
      case "frame": {
        if (message.frame > this.lastFrame) {
          this.lastFrame = message.frame;
          this.handlers.onFrame(new Float32Array(message.positions), message.report, message.frame);
        }
        if (!this.disposed) {
          this.post({ type: "release-frame", buffer: message.positions }, [message.positions]);
        }
        return;
      }
      case "unstable":
        this.handlers.onUnstable?.(message.report);
        return;
      case "error":
        this.handlers.onError?.(message.message);
        return;
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    if (this.disposed) return;
    this.handlers.onError?.(event.message || "O Worker XPBD falhou.");
  };

  private post(command: ClothWorkerCommand, transfer: Transferable[] = []): void {
    this.worker.postMessage(command, transfer);
  }
}
