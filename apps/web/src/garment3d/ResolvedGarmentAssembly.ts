import type {
  PreviewBodySide,
} from "../domain/pattern";
import {
  type AssemblyPanelInstance,
  type AssemblyStitchConstraint,
  type GarmentAssemblyState,
} from "./GarmentAssembly";
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
  const instanceById = new Map(
    state.instances.map((instance) => [instance.id, instance]),
  );

  state.stitchConstraints = state.stitchConstraints.filter((constraint) =>
    stitchMatchesBodySide(constraint, instanceById),
  );

  return state;
}

function stitchMatchesBodySide(
  constraint: AssemblyStitchConstraint,
  instanceById: ReadonlyMap<string, AssemblyPanelInstance>,
): boolean {
  if (constraint.seamId.startsWith("fold:")) return true;
  if (!constraint.instanceA || !constraint.instanceB) return true;
  if (constraint.instanceA === constraint.instanceB) return true;

  const first = instanceById.get(constraint.instanceA);
  const second = instanceById.get(constraint.instanceB);

  if (!first || !second) return true;

  const firstSide = first.placement.bodySide;
  const secondSide = second.placement.bodySide;

  if (!isLateralSide(firstSide) || !isLateralSide(secondSide)) {
    return true;
  }

  return firstSide === secondSide;
}

function isLateralSide(
  side: PreviewBodySide,
): side is "left" | "right" {
  return side === "left" || side === "right";
}
