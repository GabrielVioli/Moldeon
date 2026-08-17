import { describe, expect, it } from "vitest";
import { createBlankGarment } from "../domain/blankGarment";
import { garmentDraftToPatternDocumentV3 } from "../domain/patternDocumentV3";
import {
  AssemblyWorkerClient,
  type AssemblyWorkerLike,
} from "./AssemblyWorkerClient";
import type {
  AssemblyWorkerRequest,
  AssemblyWorkerResponse,
} from "./AssemblyWorkerProtocol";

class FakeWorker implements AssemblyWorkerLike {
  onmessage: ((event: MessageEvent<AssemblyWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: AssemblyWorkerRequest[] = [];
  terminated = false;

  postMessage(message: AssemblyWorkerRequest): void {
    this.requests.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: AssemblyWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<AssemblyWorkerResponse>);
  }
}

describe("AssemblyWorkerClient isolated lifecycle", () => {
  it("terminates an obsolete solve instead of building an unbounded queue", async () => {
    const workers: FakeWorker[] = [];
    const client = new AssemblyWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const document = garmentDraftToPatternDocumentV3(createBlankGarment());
    const first = client.solve({ document, revision: "A" });
    const second = client.solve({ document, revision: "B" });
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].onmessage).toBeNull();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    const request = workers[1].requests[0];
    expect(request.type).toBe("solve");
    if (request.type !== "solve") throw new Error("solve request expected");
    workers[1].emit({
      type: "solved",
      generation: request.generation,
      revision: "B",
      state: emptyState(),
      diagnostics: emptyDiagnostics(),
      warnings: [],
    });
    await expect(second).resolves.toMatchObject({ type: "solved", revision: "B" });
    client.dispose();
    expect(workers[1].terminated).toBe(true);
  });

  it("ignores stale generation/revision responses", async () => {
    const worker = new FakeWorker();
    const client = new AssemblyWorkerClient(() => worker);
    const document = garmentDraftToPatternDocumentV3(createBlankGarment());
    const pending = client.solve({ document, revision: "current" });
    const request = worker.requests[0];
    if (request.type !== "solve") throw new Error("solve request expected");
    worker.emit({
      type: "error",
      generation: request.generation - 1,
      revision: "old",
      message: "stale",
    });
    let settled = false;
    pending.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    worker.emit({
      type: "solved",
      generation: request.generation,
      revision: "current",
      state: emptyState(),
      diagnostics: emptyDiagnostics(),
      warnings: [],
    });
    await expect(pending).resolves.toMatchObject({ revision: "current" });
    client.dispose();
  });
});

function emptyState(): any {
  return {
    instances: [], positions: new Float32Array(), initialPositions: new Float32Array(), previousPositions: new Float32Array(),
    velocities: new Float32Array(), inverseMasses: new Float32Array(), triangles: [], stitchConstraints: [],
    structuralConstraints: [], shearConstraints: [], bendConstraints: [], pinConstraints: [], warnings: [],
  };
}

function emptyDiagnostics(): any {
  return {
    coarseVertexCount: 0, coarseTriangleCount: 0, fineVertexCount: 0, hingeCount: 0,
    reductionRatio: 0, fineBindingBuildMs: 0, fineTransferMs: 0,
    assembly: {
      strategy: "coarse-isometric-surface", components: [],
      metrics: {
        metricDistortionMean: 0, metricDistortionMax: 0, areaDistortionMean: 0, areaDistortionMax: 0,
        structuralSeamMeanMm: 0, structuralSeamMaxMm: 0, normalizedResidual: 0,
        overlapScore: 0, triangleCrossingProxyCount: 0, nonPlanarityRad: 0,
      }, assemblySolveMs: 0, candidateCount: 0, invalid: false, warnings: [],
    },
  };
}
