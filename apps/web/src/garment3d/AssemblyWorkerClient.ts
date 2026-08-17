import { serializePatternDocumentV3 } from "../domain/patternDocumentV3";
import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import type {
  AssemblyWorkerRequest,
  AssemblyWorkerResponse,
  AssemblyWorkerSolvedResponse,
} from "./AssemblyWorkerProtocol";

export interface AssemblyWorkerLike {
  onmessage: ((event: MessageEvent<AssemblyWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: AssemblyWorkerRequest): void;
  terminate(): void;
}

export type AssemblyWorkerFactory = () => AssemblyWorkerLike;

export interface AssemblyWorkerSolveInput {
  document: PatternDocumentV3;
  revision: string;
}

/**
 * Dedicated lifecycle, intentionally separate from XPBD. A superseding solve
 * terminates the old Worker rather than queueing behind it, providing true
 * cancellation even when the geometric solver is inside a synchronous local
 * iteration. Generation + revision still reject stale messages defensively.
 */
export class AssemblyWorkerClient {
  private worker: AssemblyWorkerLike | null = null;
  private generation = 0;
  private disposed = false;
  private pendingReject: ((reason?: unknown) => void) | null = null;

  constructor(private readonly factory: AssemblyWorkerFactory = createAssemblyWorker) {}

  solve(input: AssemblyWorkerSolveInput): Promise<AssemblyWorkerSolvedResponse> {
    if (this.disposed) return Promise.reject(new Error("AssemblyWorkerClient já foi descartado."));
    this.cancelInFlight("Assembly solve substituído por uma revisão mais nova.");
    const worker = this.factory();
    const generation = ++this.generation;
    this.worker = worker;
    return new Promise<AssemblyWorkerSolvedResponse>((resolve, reject) => {
      this.pendingReject = reject;
      worker.onmessage = (event) => {
        const response = event.data;
        if (this.disposed || worker !== this.worker) return;
        if (response.generation !== generation || response.revision !== input.revision) return;
        this.pendingReject = null;
        if (response.type === "error") {
          reject(new Error(response.message));
          return;
        }
        resolve(response);
      };
      worker.onerror = (event) => {
        if (this.disposed || worker !== this.worker) return;
        this.pendingReject = null;
        reject(new Error(event.message || "Assembly Worker falhou."));
      };
      worker.postMessage({
        type: "solve",
        generation,
        revision: input.revision,
        serializedDocument: serializePatternDocumentV3(input.document),
      });
    });
  }

  cancel(): void {
    this.cancelInFlight("Assembly solve cancelado.");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelInFlight("AssemblyWorkerClient descartado.");
  }

  get currentGeneration(): number {
    return this.generation;
  }

  private cancelInFlight(reason: string): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingReject = null;
      reject(new DOMException(reason, "AbortError"));
    }
  }
}

function createAssemblyWorker(): AssemblyWorkerLike {
  return new Worker(new URL("../workers/assembly.worker.ts", import.meta.url), { type: "module" });
}
