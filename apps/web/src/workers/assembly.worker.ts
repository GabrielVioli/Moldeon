/// <reference lib="webworker" />

import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import {
  collectAssemblyStateTransferables,
  type AssemblyWorkerRequest,
  type AssemblyWorkerResponse,
} from "../garment3d/AssemblyWorkerProtocol";

const scope = self as DedicatedWorkerGlobalScope;
let disposed = false;

scope.onmessage = (event: MessageEvent<AssemblyWorkerRequest>) => {
  if (disposed) return;
  const request = event.data;
  if (request.type === "dispose") {
    disposed = true;
    scope.close();
    return;
  }
  if (request.type !== "solve") return;
  try {
    const raw = JSON.parse(request.serializedDocument) as unknown;
    const document = parsePatternDocumentV3(raw);
    const result = buildCoarseIsometricAssembly(document);
    const response: AssemblyWorkerResponse = {
      type: "solved",
      generation: request.generation,
      revision: request.revision,
      state: result.state,
      diagnostics: {
        coarseVertexCount: result.coarse.coarseVertexCount,
        coarseTriangleCount: result.coarse.coarseTriangleCount,
        fineVertexCount: result.coarse.fineVertexCount,
        hingeCount: result.coarse.hingeCount,
        reductionRatio: result.coarse.reductionRatio,
        fineBindingBuildMs: result.fineBindings.buildMs,
        fineTransferMs: result.fineTransferMs,
        assembly: result.assembly,
      },
      warnings: result.warnings,
    };
    scope.postMessage(response, collectAssemblyStateTransferables(result.state));
  } catch (error) {
    const response: AssemblyWorkerResponse = {
      type: "error",
      generation: request.generation,
      revision: request.revision,
      message: error instanceof Error ? error.message : "Falha desconhecida no Assembly Worker.",
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    };
    scope.postMessage(response);
  }
};

export {};
