from pathlib import Path

path = Path("apps/web/src/garment3d/PhysicalGarmentAssembly.ts")
text = path.read_text(encoding="utf-8")

# The preceding physical-opening prototype partitions cut-on-fold copies by
# copy parity. Replace only that temporary correspondence rule. Physical copy
# generation remains untouched; correspondence is rebuilt afterwards from the
# real endpoint graph formed by seam/fold connectivity.
old_block = r'''    const attachmentOnA = sourceA.structuredAttachmentPlan?.seamGroupId === constraint.seamGroupId;
    const attachmentOnB = sourceB.structuredAttachmentPlan?.seamGroupId === constraint.seamGroupId;
    const foldExpansionOnA = attachmentOnB
      && plansB.length === 1
      && plansA.length === 2
      && plansA.every((plan) => Boolean(plan.foldGroupId));
    const foldExpansionOnB = attachmentOnA
      && plansA.length === 1
      && plansB.length === 2
      && plansB.every((plan) => Boolean(plan.foldGroupId));

    if (foldExpansionOnA || foldExpansionOnB) {
      const attachmentSource = foldExpansionOnA ? sourceB : sourceA;
      const attachmentPlan = (foldExpansionOnA ? plansB : plansA)[0];
      const parentSource = foldExpansionOnA ? sourceA : sourceB;
      const parentPlans = foldExpansionOnA ? plansA : plansB;
      const attachmentIsA = foldExpansionOnB;
      for (const parentPlan of parentPlans) {
        const attachmentReference = remapStructuredAttachmentReference(
          constraint,
          attachmentSource,
          attachmentPlan,
          parentSource,
          parentPlan,
          attachmentIsA,
        );
        if (!attachmentReference) continue;
        const planA = foldExpansionOnA ? parentPlan : attachmentPlan;
        const planB = foldExpansionOnA ? attachmentPlan : parentPlan;
        result.push({
          ...constraint,
          id: `${constraint.id}/${planA.instance.id}/${planB.instance.id}`,
          a: attachmentIsA
            ? attachmentReference
            : remapReference(constraint.a, sourceA, planA),
          b: attachmentIsA
            ? remapReference(constraint.b, sourceB, planB)
            : attachmentReference,
          instanceA: planA.instance.id,
          instanceB: planB.instance.id,
          ...(attachmentIsA && constraint.rangeLengthAMm !== undefined
            ? { rangeLengthAMm: constraint.rangeLengthAMm / parentPlans.length }
            : {}),
          ...(!attachmentIsA && constraint.rangeLengthBMm !== undefined
            ? { rangeLengthBMm: constraint.rangeLengthBMm / parentPlans.length }
            : {}),
        });
      }
      continue;
    }

    for (const [planA, planB] of pairPlans(sourceA, sourceB, plansA, plansB)) {
      result.push({
        ...constraint,
        id: `${constraint.id}/${planA.instance.id}/${planB.instance.id}`,
        a: remapReference(constraint.a, sourceA, planA),
        b: remapReference(constraint.b, sourceB, planB),
        instanceA: planA.instance.id,
        instanceB: planB.instance.id,
      });
    }'''
new_block = r'''    for (const [planA, planB] of pairPlans(sourceA, sourceB, plansA, plansB)) {
      result.push({
        ...constraint,
        id: `${constraint.id}/${planA.instance.id}/${planB.instance.id}`,
        a: remapReference(constraint.a, sourceA, planA),
        b: remapReference(constraint.b, sourceB, planB),
        instanceA: planA.instance.id,
        instanceB: planB.instance.id,
      });
    }'''
count = text.count(old_block)
if count != 1:
    raise RuntimeError(f"temporary fold partition block: expected one match, found {count}")
text = text.replace(old_block, new_block, 1)

# Remove the parity-based helper inserted by the preceding prototype. The
# generic edge-reference helper is retained and reused by the graph resolver.
helper_start = text.index("function remapStructuredAttachmentReference(\n")
helper_end = text.index("function pointReferenceOnPath(\n")
text = text[:helper_start] + text[helper_end:]

old_fold_call = '''  stitchConstraints.push(...buildFoldConstraints(plans));\n'''
new_fold_call = '''  const foldConstraints = buildFoldConstraints(plans);\n  stitchConstraints.push(...foldConstraints);\n  remapStructuredAttachmentOpeningCycles(stitchConstraints, plans);\n'''
count = text.count(old_fold_call)
if count != 1:
    raise RuntimeError(f"fold call: expected one match, found {count}")
text = text.replace(old_fold_call, new_fold_call, 1)

insert_at = text.index("function buildFoldConstraints(\n")
resolver = r'''interface PhysicalOpeningOccurrence {
  id: string;
  instanceId: string;
  range: import("../domain/pattern").EdgeRange;
  path: PanelEdgePath;
  startKey: string;
  endKey: string;
  startClass: string;
  endClass: string;
  lengthMm: number;
  constraints: AssemblyStitchConstraint[];
}

interface OrderedOpeningOccurrence {
  occurrence: PhysicalOpeningOccurrence;
  forward: boolean;
  startArcMm: number;
}

/**
 * Rebuilds a structured attachment correspondence from the physical endpoint
 * graph after cut-on-fold expansion. Opening segments are material edges;
 * zero-rest seam endpoints and fold relations identify graph vertices. No
 * garment names, copy suffixes, body-side labels, scaling or shell motion are
 * involved.
 */
function remapStructuredAttachmentOpeningCycles(
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

    const occurrenceByConstraint = new Map<AssemblyStitchConstraint, OrderedOpeningOccurrence>();
    for (const item of ordered) {
      for (const constraint of item.occurrence.constraints) {
        occurrenceByConstraint.set(constraint, item);
      }
    }

    for (const constraint of group) {
      const item = occurrenceByConstraint.get(constraint);
      if (!item) continue;
      const planA = constraint.instanceA ? planById.get(constraint.instanceA) : undefined;
      const planB = constraint.instanceB ? planById.get(constraint.instanceB) : undefined;
      if (!planA || !planB) continue;
      const attachmentOnA = planA.instance.structuredAttachmentPlan?.seamGroupId === groupId;
      const attachmentPlan = attachmentOnA ? planA : planB;
      const parentPlan = attachmentOnA ? planB : planA;
      const attachmentRange = attachmentOnA ? constraint.rangeA : constraint.rangeB;
      const parentReference = attachmentOnA ? constraint.b : constraint.a;
      if (!attachmentRange) continue;
      const attachmentPath = attachmentPlan.instance.topology.edges.get(attachmentRange.edgeId);
      if (!attachmentPath) continue;

      const localFraction = referenceFractionOnRange(
        parentPlan.instance,
        item.occurrence.path,
        item.occurrence.range,
        parentReference,
      );
      if (localFraction === null) continue;
      const localArcMm = item.occurrence.lengthMm
        * (item.forward ? localFraction : 1 - localFraction);
      const openingProgress = Math.min(1, Math.max(0,
        (item.startArcMm + localArcMm) / totalLengthMm,
      ));
      const attachmentProgress = constraint.direction === "opposite"
        ? 1 - openingProgress
        : openingProgress;
      const attachmentT = attachmentRange.startT
        + (attachmentRange.endT - attachmentRange.startT) * attachmentProgress;
      const remapped = pointReferenceOnPath(
        attachmentPlan.instance,
        attachmentPath,
        attachmentT,
      );
      if (attachmentOnA) constraint.a = remapped;
      else constraint.b = remapped;
      constraint.progress = openingProgress;
    }
  }
}

function buildPhysicalOpeningOccurrences(
  group: readonly AssemblyStitchConstraint[],
  planById: ReadonlyMap<string, InstancePlan>,
): PhysicalOpeningOccurrence[] {
  const byId = new Map<string, PhysicalOpeningOccurrence>();
  for (const constraint of group) {
    const planA = constraint.instanceA ? planById.get(constraint.instanceA) : undefined;
    const planB = constraint.instanceB ? planById.get(constraint.instanceB) : undefined;
    if (!planA || !planB) continue;
    const attachmentOnA = planA.instance.structuredAttachmentPlan?.seamGroupId === constraint.seamGroupId;
    const parentPlan = attachmentOnA ? planB : planA;
    const range = attachmentOnA ? constraint.rangeB : constraint.rangeA;
    if (!range) continue;
    const path = parentPlan.instance.topology.edges.get(range.edgeId);
    if (!path) continue;
    const id = `${parentPlan.instance.id}|${range.pieceId}|${range.edgeId}|${range.startT}|${range.endT}`;
    let occurrence = byId.get(id);
    if (!occurrence) {
      const start = pointReferenceOnPath(parentPlan.instance, path, range.startT);
      const end = pointReferenceOnPath(parentPlan.instance, path, range.endT);
      const startKey = directReferenceKey(start);
      const endKey = directReferenceKey(end);
      if (!startKey || !endKey) continue;
      occurrence = {
        id,
        instanceId: parentPlan.instance.id,
        range: { ...range },
        path,
        startKey,
        endKey,
        startClass: startKey,
        endClass: endKey,
        lengthMm: path.lengthMm * Math.abs(range.endT - range.startT),
        constraints: [],
      };
      byId.set(id, occurrence);
    }
    occurrence.constraints.push(constraint);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

class EndpointUnion {
  private parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    this.add(value);
    const current = this.parent.get(value)!;
    if (current === value) return value;
    const root = this.find(current);
    this.parent.set(value, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const first = rootA.localeCompare(rootB) <= 0 ? rootA : rootB;
    const second = first === rootA ? rootB : rootA;
    this.parent.set(second, first);
  }
}

function buildEndpointUnion(
  constraints: readonly AssemblyStitchConstraint[],
  attachmentGroupId: string,
): EndpointUnion {
  const union = new EndpointUnion();
  for (const constraint of constraints) {
    if (constraint.seamGroupId === attachmentGroupId) continue;
    const physicalRest = constraint.physicalRestDistance ?? constraint.restDistance;
    if (physicalRest > 0.0002) continue;
    const a = directReferenceKey(constraint.a);
    const b = directReferenceKey(constraint.b);
    if (!a || !b) continue;
    union.union(a, b);
  }
  return union;
}

function directReferenceKey(reference: GlobalPointReference): string | null {
  if (reference.particleIndices.length !== 1 || reference.weights.length !== 1) return null;
  if (Math.abs(reference.weights[0] - 1) > 1e-5) return null;
  return `p:${reference.particleIndices[0]}`;
}

function orderPhysicalOpeningCycle(
  occurrences: readonly PhysicalOpeningOccurrence[],
): OrderedOpeningOccurrence[] | null {
  const byClass = new Map<string, PhysicalOpeningOccurrence[]>();
  for (const occurrence of occurrences) {
    for (const endpointClass of [occurrence.startClass, occurrence.endClass]) {
      const list = byClass.get(endpointClass) ?? [];
      list.push(occurrence);
      byClass.set(endpointClass, list);
    }
  }
  if ([...byClass.values()].some((edges) => edges.length !== 2)) return null;

  const start = [...occurrences].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!start) return null;
  const first = traverseOpeningCycle(start, true, byClass, occurrences.length);
  const second = traverseOpeningCycle(start, false, byClass, occurrences.length);
  if (!first && !second) return null;
  if (!first) return assignOpeningArcs(second!);
  if (!second) return assignOpeningArcs(first);
  const signature = (items: readonly { occurrence: PhysicalOpeningOccurrence; forward: boolean }[]) =>
    items.map((item) => `${item.occurrence.id}:${item.forward ? "+" : "-"}`).join("|");
  return assignOpeningArcs(signature(first) <= signature(second) ? first : second);
}

function traverseOpeningCycle(
  start: PhysicalOpeningOccurrence,
  forward: boolean,
  byClass: ReadonlyMap<string, readonly PhysicalOpeningOccurrence[]>,
  expectedCount: number,
): Array<{ occurrence: PhysicalOpeningOccurrence; forward: boolean }> | null {
  const result: Array<{ occurrence: PhysicalOpeningOccurrence; forward: boolean }> = [];
  const visited = new Set<string>();
  let current = start;
  let currentForward = forward;
  for (let step = 0; step < expectedCount; step += 1) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    result.push({ occurrence: current, forward: currentForward });
    const exitClass = currentForward ? current.endClass : current.startClass;
    const next = (byClass.get(exitClass) ?? []).find((candidate) => candidate.id !== current.id);
    if (!next) return null;
    if (step === expectedCount - 1) {
      return next.id === start.id && visited.size === expectedCount ? result : null;
    }
    currentForward = next.startClass === exitClass;
    current = next;
  }
  return null;
}

function assignOpeningArcs(
  items: readonly { occurrence: PhysicalOpeningOccurrence; forward: boolean }[],
): OrderedOpeningOccurrence[] {
  let cursor = 0;
  return items.map((item) => {
    const result = { ...item, startArcMm: cursor };
    cursor += item.occurrence.lengthMm;
    return result;
  });
}

function referenceFractionOnRange(
  instance: AssemblyPanelInstance,
  path: PanelEdgePath,
  range: import("../domain/pattern").EdgeRange,
  reference: GlobalPointReference,
): number | null {
  const cumulativeByLocal = new Map<number, number>();
  path.vertexIndices.forEach((localIndex, index) => {
    cumulativeByLocal.set(localIndex, path.cumulativeLengthsMm[index]);
  });
  let arcMm = 0;
  let weightSum = 0;
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const local = reference.particleIndices[index] - instance.particleStart;
    const cumulative = cumulativeByLocal.get(local);
    if (cumulative === undefined) return null;
    const weight = reference.weights[index] ?? 0;
    arcMm += cumulative * weight;
    weightSum += weight;
  }
  if (Math.abs(weightSum) <= POSITION_EPSILON || path.lengthMm <= POSITION_EPSILON) return null;
  const t = arcMm / weightSum / path.lengthMm;
  const span = range.endT - range.startT;
  if (Math.abs(span) <= POSITION_EPSILON) return null;
  return Math.min(1, Math.max(0, (t - range.startT) / span));
}

'''
text = text[:insert_at] + resolver + text[insert_at:]
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
