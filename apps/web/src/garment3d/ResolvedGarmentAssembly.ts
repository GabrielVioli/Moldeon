import type { GarmentAssemblyState } from "./GarmentAssembly";
import { buildPhysicalGarmentAssembly } from "./PhysicalGarmentAssembly";
import type { ResolvedAssemblyInput } from "./ResolvedAssemblyInput";

/**
 * Entrada final da montagem usada pelo viewport.
 *
 * Além de expandir peças cortadas na dobra, esta etapa resolve as costuras
 * semânticas dos moldes-base e remove ligações cruzadas entre lados do corpo.
 */
export function buildResolvedGarmentAssembly(
  input: ResolvedAssemblyInput,
): GarmentAssemblyState {
  const state = buildPhysicalGarmentAssembly(
    input.snapshots,
    input.garmentProjection,
    input.geometrySignatures,
  );
  // Prompt 10.7: canonical physical bindings are authoritative.
  // Inferred body-side labels cannot discard a material seam.


  return state;
}
