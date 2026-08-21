from pathlib import Path

path = Path("apps/web/src/garment3d/PhysicalGarmentAssembly.ts")
text = path.read_text(encoding="utf-8")
start = text.index("function remapStructuredAttachmentOpeningCycles(\n")
end = text.index("function buildPhysicalOpeningOccurrences(\n", start)
old = text[start:end]
new = r'''function remapStructuredAttachmentOpeningCycles(
  constraints: AssemblyStitchConstraint[],
  plans: readonly InstancePlan[],
): void {
  const planById = new Map(plans.map((plan) => [plan.instance.id, plan]));
  const attachmentGroups = new Map<string, AssemblyStitchConstraint[]>();

  for (const constraint of constraints) {
    const planA = constraint.instanceA ? planById.get(constraint.instanceA) : undefined;
    const planB = constraint.instanceB ? planById.get(constraint.instanceB) : undefined;
    const attachmentOnA = planA?.instance.structuredAttachmentPlan?.seamGroupId === constraint.seamGroupId;
    const attachmentOnB = planB?.instance.structuredAttachmentPlan?.seamGroupId === constraint.seamGroupId;
    if (attachmentOnA === attachmentOnB) continue;
    const list = attachmentGroups.get(constraint.seamGroupId) ?? [];
    list.push(constraint);
    attachmentGroups.set(constraint.seamGroupId, list);
  }

  for (const [groupId, group] of attachmentGroups) {
    const attachmentPlanIds = new Set<string>();
    let attachmentIsA: boolean | undefined;
    for (const constraint of group) {
      const planA = constraint.instanceA ? planById.get(constraint.instanceA) : undefined;
      const planB = constraint.instanceB ? planById.get(constraint.instanceB) : undefined;
      const onA = planA?.instance.structuredAttachmentPlan?.seamGroupId === groupId;
      const onB = planB?.instance.structuredAttachmentPlan?.seamGroupId === groupId;
      if (onA === onB) continue;
      attachmentPlanIds.add((onA ? planA : planB)!.instance.id);
      if (attachmentIsA === undefined) attachmentIsA = onA;
      else if (attachmentIsA !== onA) attachmentIsA = undefined;
    }
    // This resolver is intentionally narrow: one physical narrow strip joined
    // to one closed physical opening. Multi-copy attachments remain on the
    // generic path until they can be resolved without ambiguity.
    if (attachmentPlanIds.size !== 1 || attachmentIsA === undefined) continue;
    const attachmentPlan = planById.get([...attachmentPlanIds][0]);
    if (!attachmentPlan) continue;

    const occurrences = buildPhysicalOpeningOccurrences(group, planById);
    if (occurrences.length < 2) continue;
    const union = buildEndpointUnion(constraints, groupId);
    for (const occurrence of occurrences) {
      occurrence.startClass = union.find(occurrence.startKey);
      occurrence.endClass = union.find(occurrence.endKey);
    }
    const ordered = orderPhysicalOpeningCycle(occurrences);
    if (!ordered) continue;
    const totalLengthMm = ordered.reduce((sum, item) => sum + item.occurrence.lengthMm, 0);
    if (totalLengthMm <= POSITION_EPSILON) continue;

    const template = group[0];
    const attachmentRange = attachmentIsA ? template.rangeA : template.rangeB;
    if (!attachmentRange) continue;
    const attachmentPath = attachmentPlan.instance.topology.edges.get(attachmentRange.edgeId);
    if (!attachmentPath) continue;
    const attachmentLengthMm = attachmentPath.lengthMm
      * Math.abs(attachmentRange.endT - attachmentRange.startT);
    if (attachmentLengthMm <= POSITION_EPSILON) continue;
    // Zero-energy correspondence cannot invent or remove cloth. A topology
    // resolver only applies when the physical opening and authored strip are
    // already metrically compatible.
    if (Math.abs(attachmentLengthMm - totalLengthMm) > Math.max(0.5, totalLengthMm * 5e-4)) continue;

    const progresses = [...new Set(group
      .map((constraint) => constraint.progress)
      .filter((value): value is number => Number.isFinite(value))
      .map((value) => Math.round(value * 1e9) / 1e9))]
      .sort((left, right) => left - right);
    const sampleCount = progresses.length;
    if (sampleCount < 4) continue;

    const rebuilt: AssemblyStitchConstraint[] = [];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const openingProgress = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
      const openingSample = samplePhysicalOpeningAtProgress(
        ordered,
        totalLengthMm,
        openingProgress,
        planById,
      );
      if (!openingSample) {
        rebuilt.length = 0;
        break;
      }
      const attachmentProgress = template.direction === "opposite"
        ? 1 - openingProgress
        : openingProgress;
      const attachmentT = attachmentRange.startT
        + (attachmentRange.endT - attachmentRange.startT) * attachmentProgress;
      const attachmentReference = pointReferenceOnPath(
        attachmentPlan.instance,
        attachmentPath,
        attachmentT,
      );
      const parentPlan = openingSample.plan;
      const parentRange = openingSample.item.occurrence.range;
      const parentReference = openingSample.reference;
      const next: AssemblyStitchConstraint = {
        ...template,
        id: `${groupId}:physical-opening:${sampleIndex}`,
        a: attachmentIsA ? attachmentReference : parentReference,
        b: attachmentIsA ? parentReference : attachmentReference,
        instanceA: attachmentIsA ? attachmentPlan.instance.id : parentPlan.instance.id,
        instanceB: attachmentIsA ? parentPlan.instance.id : attachmentPlan.instance.id,
        rangeA: attachmentIsA ? { ...attachmentRange } : { ...parentRange },
        rangeB: attachmentIsA ? { ...parentRange } : { ...attachmentRange },
        rangeLengthAMm: attachmentIsA ? attachmentLengthMm : totalLengthMm,
        rangeLengthBMm: attachmentIsA ? totalLengthMm : attachmentLengthMm,
        progress: openingProgress,
      };
      rebuilt.push(next);
    }
    if (rebuilt.length !== sampleCount) continue;

    const firstIndex = constraints.findIndex((constraint) => constraint.seamGroupId === groupId);
    if (firstIndex < 0) continue;
    const retained = constraints.filter((constraint) => constraint.seamGroupId !== groupId);
    const before = retained.slice(0, Math.min(firstIndex, retained.length));
    const after = retained.slice(Math.min(firstIndex, retained.length));
    constraints.splice(0, constraints.length, ...before, ...rebuilt, ...after);
  }
}

function samplePhysicalOpeningAtProgress(
  ordered: readonly OrderedOpeningOccurrence[],
  totalLengthMm: number,
  progress: number,
  planById: ReadonlyMap<string, InstancePlan>,
): { item: OrderedOpeningOccurrence; plan: InstancePlan; reference: GlobalPointReference } | null {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const targetArcMm = clampedProgress * totalLengthMm;
  let item = ordered[ordered.length - 1];
  for (const candidate of ordered) {
    const endArcMm = candidate.startArcMm + candidate.occurrence.lengthMm;
    if (targetArcMm <= endArcMm + 1e-7) {
      item = candidate;
      break;
    }
  }
  const plan = planById.get(item.occurrence.instanceId);
  if (!plan || item.occurrence.lengthMm <= POSITION_EPSILON) return null;
  const localArcMm = Math.min(
    item.occurrence.lengthMm,
    Math.max(0, targetArcMm - item.startArcMm),
  );
  const traversalProgress = localArcMm / item.occurrence.lengthMm;
  const rangeProgress = item.forward ? traversalProgress : 1 - traversalProgress;
  const range = item.occurrence.range;
  const t = range.startT + (range.endT - range.startT) * rangeProgress;
  return {
    item,
    plan,
    reference: pointReferenceOnPath(plan.instance, item.occurrence.path, t),
  };
}

'''
text = text[:start] + new + text[end:]
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
