import type {
  AssemblyStitchConstraint,
  GarmentAssemblyState,
} from "./GarmentAssembly";
import {
  bindMaterialPoint,
  materialPointFromFineReference,
  type CoarseAssemblySet,
  type CoarseMaterialBinding,
} from "./CoarseAssemblyMesh";

export type CoarseSeamClass =
  | "structural-alignment"
  | "local-shaping-closure"
  | "intentional-mismatch";

export interface CoarseSeamConstraint {
  id: string;
  seamId: string;
  seamGroupId: string;
  instanceA: string;
  instanceB: string;
  a: CoarseMaterialBinding;
  b: CoarseMaterialBinding;
  classification: CoarseSeamClass;
  treatment: string;
  distribution: string;
  targetRatio: number;
  slackMm: number;
  direction: "same" | "opposite";
  restDistanceM: number;
  stiffness: number;
  progress: number;
  rangeLengthAMm?: number;
  rangeLengthBMm?: number;
}

export interface CoarseSeamResolution {
  constraints: CoarseSeamConstraint[];
  structural: CoarseSeamConstraint[];
  shaping: CoarseSeamConstraint[];
  intentional: CoarseSeamConstraint[];
  byGroup: Map<string, CoarseSeamConstraint[]>;
  warnings: string[];
}

/**
 * Converts already-canonical physical stitch samples to the coarse surface.
 * The existing stitch builder is deliberately reused for arc-length sampling,
 * 1↔N/N↔M, direction, targetRatio, slack and physical PanelInstance binding.
 * No vertex-index pairing is re-invented here.
 */
export function buildCoarseSeamResolution(
  state: GarmentAssemblyState,
  coarse: CoarseAssemblySet,
): CoarseSeamResolution {
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  const constraints: CoarseSeamConstraint[] = [];
  const warnings: string[] = [];

  for (const stitch of state.stitchConstraints) {
    if (!stitch.instanceA || !stitch.instanceB) continue;
    const instanceA = instanceById.get(stitch.instanceA);
    const instanceB = instanceById.get(stitch.instanceB);
    const meshA = coarse.byInstanceId.get(stitch.instanceA);
    const meshB = coarse.byInstanceId.get(stitch.instanceB);
    if (!instanceA || !instanceB || !meshA || !meshB) {
      warnings.push(`${stitch.seamGroupId}: binding físico não encontrou a coarse surface.`);
      continue;
    }
    try {
      const materialA = materialPointFromFineReference(
        instanceA,
        stitch.a.particleIndices,
        stitch.a.weights,
      );
      const materialB = materialPointFromFineReference(
        instanceB,
        stitch.b.particleIndices,
        stitch.b.weights,
      );
      const classification = classifyCoarseStitch(stitch);
      constraints.push({
        id: stitch.id,
        seamId: stitch.seamId,
        seamGroupId: stitch.seamGroupId,
        instanceA: stitch.instanceA,
        instanceB: stitch.instanceB,
        a: bindMaterialPoint(meshA, materialA[0], materialA[1]),
        b: bindMaterialPoint(meshB, materialB[0], materialB[1]),
        classification,
        treatment: stitch.treatment,
        distribution: stitch.distribution,
        targetRatio: stitch.targetRatio,
        slackMm: stitch.slackMm,
        direction: stitch.direction ?? "same",
        restDistanceM: stitch.physicalRestDistance ?? stitch.restDistance,
        stiffness: stitch.stiffness,
        progress: stitch.progress ?? 0,
        ...(stitch.rangeLengthAMm === undefined ? {} : { rangeLengthAMm: stitch.rangeLengthAMm }),
        ...(stitch.rangeLengthBMm === undefined ? {} : { rangeLengthBMm: stitch.rangeLengthBMm }),
      });
    } catch (error) {
      warnings.push(
        `${stitch.seamGroupId}: ${error instanceof Error ? error.message : "falha ao mapear costura para coarse surface"}`,
      );
    }
  }

  const byGroup = new Map<string, CoarseSeamConstraint[]>();
  for (const constraint of constraints) {
    const list = byGroup.get(constraint.seamGroupId) ?? [];
    list.push(constraint);
    byGroup.set(constraint.seamGroupId, list);
  }
  return {
    constraints,
    structural: constraints.filter((constraint) => constraint.classification === "structural-alignment"),
    shaping: constraints.filter((constraint) => constraint.classification === "local-shaping-closure"),
    intentional: constraints.filter((constraint) => constraint.classification === "intentional-mismatch"),
    byGroup,
    warnings,
  };
}

export function classifyCoarseStitch(
  stitch: Pick<AssemblyStitchConstraint, "treatment" | "targetRatio" | "slackMm" | "seamId" | "seamGroupId">,
): CoarseSeamClass {
  const treatment = stitch.treatment.toLowerCase();
  if (
    treatment === "dart"
    || stitch.seamId.startsWith("dart:")
    || stitch.seamGroupId.startsWith("dart:")
  ) {
    return "local-shaping-closure";
  }
  if (
    treatment === "intentional-mismatch"
    || treatment === "gather"
    || treatment === "stretch"
    || stitch.slackMm > 1e-4
    || (Math.abs(stitch.targetRatio - 1) > 0.12 && treatment !== "ease")
  ) {
    return "intentional-mismatch";
  }
  // `ease` is a physical structural seam with a non-zero fit residual. It
  // participates in initial alignment but restDistance retains the authored
  // mismatch so the geometric solver does not force metric stretch.
  return "structural-alignment";
}
