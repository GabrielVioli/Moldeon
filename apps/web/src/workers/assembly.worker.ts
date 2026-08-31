/// <reference lib="webworker" />

import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInputFromDocument } from "../garment3d/ResolvedAssemblyInput";
import { buildResolvedGarmentAssembly } from "../garment3d/ResolvedGarmentAssembly";
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
    const result = request.mode === "workspace"
      ? buildRigidWorkspaceAssembly(document)
      : buildCoarseIsometricAssembly(document);
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

function buildRigidWorkspaceAssembly(document: ReturnType<typeof parsePatternDocumentV3>) {
  const input = buildResolvedAssemblyInputFromDocument(document);
  const state = buildResolvedGarmentAssembly(input);
  const vertexCount = state.positions.length / 3;
  const triangleCount = state.instances.reduce((sum, instance) => sum + instance.topology.triangles.length / 3, 0);
  const zeroMetrics = {
    metricDistortionMean: 0,
    metricDistortionMax: 0,
    areaDistortionMean: 0,
    areaDistortionMax: 0,
    structuralSeamMeanMm: 0,
    structuralSeamMaxMm: 0,
    normalizedResidual: 0,
    overlapScore: 0,
    triangleCrossingProxyCount: 0,
    nonPlanarityRad: 0,
  };
  return {
    state,
    coarse: {
      coarseVertexCount: vertexCount,
      coarseTriangleCount: triangleCount,
      fineVertexCount: vertexCount,
      hingeCount: 0,
      reductionRatio: 1,
    },
    fineBindings: { buildMs: 0 },
    fineTransferMs: 0,
    assembly: {
      strategy: "workspace-rigid-panels" as const,
      components: [],
      metrics: zeroMetrics,
      assemblySolveMs: 0,
      candidateCount: 0,
      invalid: false,
      warnings: [],
    },
    warnings: state.warnings,
  };
}

export {};
