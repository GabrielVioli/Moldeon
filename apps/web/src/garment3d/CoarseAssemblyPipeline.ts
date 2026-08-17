import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import { buildResolvedGarmentAssembly } from "./ResolvedGarmentAssembly";
import { buildResolvedAssemblyInputFromDocument } from "./ResolvedAssemblyInput";
import { buildCoarseAssemblySet, type CoarseAssemblySet } from "./CoarseAssemblyMesh";
import { buildCoarseSeamResolution, type CoarseSeamResolution } from "./CoarseSeamConstraints";
import {
  buildCoarseFineBindings,
  transferCoarseAssemblyToFine,
  verifyFineBindingOwnership,
  type CoarseFineBindingSet,
} from "./CoarseFineBinding";
import {
  solveIsometricSurfaceAssembly,
  type IsometricAssemblyOptions,
  type IsometricSurfaceAssemblyResult,
} from "./IsometricSurfaceAssembly";
import type { GarmentAssemblyState } from "./GarmentAssembly";

export interface CoarseAssemblyPipelineResult {
  revision: string;
  state: GarmentAssemblyState;
  coarse: CoarseAssemblySet;
  seamResolution: CoarseSeamResolution;
  fineBindings: CoarseFineBindingSet;
  assembly: IsometricSurfaceAssemblyResult;
  fineTransferMs: number;
  warnings: string[];
}

export function buildCoarseIsometricAssembly(
  document: PatternDocumentV3,
  options: IsometricAssemblyOptions = {},
): CoarseAssemblyPipelineResult {
  const input = buildResolvedAssemblyInputFromDocument(document);
  const state = buildResolvedGarmentAssembly(input);
  const coarse = buildCoarseAssemblySet(state);
  const seamResolution = buildCoarseSeamResolution(state, coarse);
  const fineBindings = buildCoarseFineBindings(state, coarse);
  const bindingIssues = verifyFineBindingOwnership(state, fineBindings);
  const assembly = solveIsometricSurfaceAssembly(state, coarse, seamResolution, options);
  const fineTransferMs = transferCoarseAssemblyToFine(state, coarse, fineBindings);
  const warnings = [
    ...state.warnings,
    ...seamResolution.warnings,
    ...assembly.warnings,
    ...bindingIssues.map((issue) => `Coarse→fine: ${issue}`),
  ];
  return {
    revision: input.signature,
    state,
    coarse,
    seamResolution,
    fineBindings,
    assembly,
    fineTransferMs,
    warnings,
  };
}
