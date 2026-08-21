from pathlib import Path

path = Path("apps/web/src/garment3d/IsometricSurfaceAssembly.ts")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
'''interface Component {
  id: string;
  meshIds: string[];
  seams: CoarseSeamConstraint[];
  relations: Relation[];
  cycleRank: number;
  parallelRelationCount: number;
  supportsShell: boolean;
}''',
'''interface Component {
  id: string;
  meshIds: string[];
  seams: CoarseSeamConstraint[];
  relations: Relation[];
  /**
   * Seam groups that connect independently poseable structural islands.
   * They still connect the garment, but must not redefine either island's
   * cycle graph or purchase attachment closure by deforming the parent shell.
   */
  attachmentGroupIds: Set<string>;
  cycleRank: number;
  parallelRelationCount: number;
  supportsShell: boolean;
}''',
"component attachment metadata",
)

replace_once(
'''interface CandidateScore {
  candidate: Candidate;
  metrics: IsometricAssemblyMetrics;
  score: number;
}''',
'''interface CandidateScore {
  candidate: Candidate;
  metrics: IsometricAssemblyMetrics;
  selectionMetrics: IsometricAssemblyMetrics;
  score: number;
}''',
"candidate selection metrics",
)

replace_once(
'''    const candidates = buildCandidates(component, coarse);
    candidateCount += candidates.length;
    const solved = candidates.map((candidate) => {
      setComponentPositions(component, coarse, candidate.positions);
      if (candidate.project !== false) {
        preAlignComponentRigidTranslations(component, coarse);
        projectComponent(component, coarse, options);
      }
      const metrics = measureComponentMetrics(component, coarse);
      return {
        candidate: snapshotCandidate(candidate.name, component, coarse),
        metrics,
        score: objective(metrics, component),
      };
    });
    solved.sort((left, right) =>
      candidateAdmissibilityRank(left.metrics) - candidateAdmissibilityRank(right.metrics)
      || left.score - right.score
      || left.candidate.name.localeCompare(right.candidate.name),
    );''',
'''    const candidates = buildCandidates(component, coarse);
    const selectionComponent = dominantStructuralSubcomponent(component, coarse);
    candidateCount += candidates.length;
    const solved = candidates.map((candidate) => {
      setComponentPositions(component, coarse, candidate.positions);
      if (candidate.project !== false) {
        preAlignComponentRigidTranslations(component, coarse);
        projectComponent(component, coarse, options);
      }
      realignCurrentStructuralIslandsByAttachments(component, coarse);
      const metrics = measureComponentMetrics(component, coarse);
      const selectionMetrics = measureComponentMetrics(selectionComponent, coarse);
      return {
        candidate: snapshotCandidate(candidate.name, component, coarse),
        metrics,
        selectionMetrics,
        score: objective(selectionMetrics, selectionComponent),
      };
    });
    solved.sort((left, right) =>
      candidateAdmissibilityRank(left.selectionMetrics) - candidateAdmissibilityRank(right.selectionMetrics)
      || left.score - right.score
      || left.candidate.name.localeCompare(right.candidate.name),
    );''',
"dominant island candidate selection",
)

replace_once(
'''    polishZeroEnergyPose(component, coarse, options);
    let finalMetrics = measureComponentMetrics(component, coarse);''',
'''    polishZeroEnergyPose(component, coarse, options);
    realignCurrentStructuralIslandsByAttachments(component, coarse);
    let finalMetrics = measureComponentMetrics(component, coarse);''',
"post polish attachment alignment",
)

replace_once(
'''  const closures = component.seams.filter((seam) =>
    seam.classification === "structural-alignment"
    || seam.classification === "local-shaping-closure",
  );''',
'''  const closures = component.seams.filter((seam) =>
    (seam.classification === "structural-alignment"
      && !component.attachmentGroupIds.has(seam.seamGroupId))
    || seam.classification === "local-shaping-closure",
  );''',
"zero energy excludes attachments",
)

old_build = '''    const nonSelfEdges = componentRelations.filter((relation) => relation.a !== relation.b).length;
    const selfEdges = componentRelations.filter((relation) => relation.a === relation.b).length;
    const cycleRank = Math.max(0, nonSelfEdges - Math.max(0, nodes.length - 1)) + selfEdges;
    const pairCounts = new Map<string, number>();
    for (const relation of componentRelations) {
      const pair = `${relation.a}|${relation.b}`;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }
    const parallelRelationCount = [...pairCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    result.push({
      id: `coarse-component:${result.length + 1}:${nodes.join("+")}`,
      meshIds: nodes,
      seams: componentSeams,
      relations: componentRelations,
      cycleRank,
      parallelRelationCount,
      supportsShell: cycleRank > 0 || parallelRelationCount > 0,
    });'''
new_build = '''    const attachmentGroupIds = detectAttachmentGroups(nodes, componentRelations);
    const structuralRelations = componentRelations.filter(
      (relation) => !attachmentGroupIds.has(relation.seamGroupId),
    );
    const topology = relationTopologyMetrics(nodes, structuralRelations);
    result.push({
      id: `coarse-component:${result.length + 1}:${nodes.join("+")}`,
      meshIds: nodes,
      seams: componentSeams,
      relations: structuralRelations,
      attachmentGroupIds,
      cycleRank: topology.cycleRank,
      parallelRelationCount: topology.parallelRelationCount,
      supportsShell: topology.cycleRank > 0 || topology.parallelRelationCount > 0,
    });'''
replace_once(old_build, new_build, "component attachment decomposition")

insert_anchor = '''  return result;
}

function buildCandidates(component: Component, coarse: CoarseAssemblySet): Candidate[] {'''
insert_code = '''  return result;
}

function relationTopologyMetrics(
  nodes: readonly string[],
  relations: readonly Relation[],
): { cycleRank: number; parallelRelationCount: number } {
  const nonSelfEdges = relations.filter((relation) => relation.a !== relation.b).length;
  const selfEdges = relations.filter((relation) => relation.a === relation.b).length;
  const adjacency = new Map(nodes.map((id) => [id, new Set<string>()]));
  for (const relation of relations) {
    if (relation.a === relation.b) continue;
    adjacency.get(relation.a)?.add(relation.b);
    adjacency.get(relation.b)?.add(relation.a);
  }
  let connectedComponents = 0;
  const visited = new Set<string>();
  for (const root of nodes) {
    if (visited.has(root)) continue;
    connectedComponents += 1;
    const queue = [root];
    visited.add(root);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
  }
  const cycleRank = Math.max(0, nonSelfEdges - nodes.length + connectedComponents) + selfEdges;
  const pairCounts = new Map<string, number>();
  for (const relation of relations) {
    const pair = `${relation.a}|${relation.b}`;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  const parallelRelationCount = [...pairCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  return { cycleRank, parallelRelationCount };
}

/**
 * A seam group is an attachment when removing that complete semantic relation
 * disconnects the pose graph and at least one remaining side is already a
 * shell on its own. This is a topology test, not a garment/template-name test.
 * Composite attachments are therefore one hyperedge instead of N extra cycle
 * edges, which prevents a narrow local shell from hijacking the parent's pose.
 */
function detectAttachmentGroups(
  nodes: readonly string[],
  relations: readonly Relation[],
): Set<string> {
  const result = new Set<string>();
  const groupIds = [...new Set(
    relations
      .filter((relation) => relation.a !== relation.b)
      .map((relation) => relation.seamGroupId),
  )].sort();
  for (const groupId of groupIds) {
    const remaining = relations.filter((relation) => relation.seamGroupId !== groupId);
    const partitions = relationPartitions(nodes, remaining);
    if (partitions.length < 2) continue;
    const hasIndependentShell = partitions.some((partition) => {
      const members = new Set(partition);
      const internal = remaining.filter(
        (relation) => members.has(relation.a) && members.has(relation.b),
      );
      const topology = relationTopologyMetrics(partition, internal);
      return topology.cycleRank > 0 || topology.parallelRelationCount > 0;
    });
    if (hasIndependentShell) result.add(groupId);
  }
  return result;
}

function relationPartitions(
  nodes: readonly string[],
  relations: readonly Relation[],
): string[][] {
  const adjacency = new Map(nodes.map((id) => [id, new Set<string>()]));
  for (const relation of relations) {
    if (relation.a === relation.b) continue;
    adjacency.get(relation.a)?.add(relation.b);
    adjacency.get(relation.b)?.add(relation.a);
  }
  const visited = new Set<string>();
  const result: string[][] = [];
  for (const root of [...nodes].sort()) {
    if (visited.has(root)) continue;
    const queue = [root];
    const partition: string[] = [];
    visited.add(root);
    while (queue.length > 0) {
      const current = queue.shift()!;
      partition.push(current);
      for (const next of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    result.push(partition.sort());
  }
  return result;
}

function dominantStructuralSubcomponent(
  component: Component,
  coarse: CoarseAssemblySet,
): Component {
  const islands = structuralIslands(component);
  if (islands.length <= 1) return component;
  islands.sort((left, right) =>
    structuralIslandScore(right, component, coarse) - structuralIslandScore(left, component, coarse)
    || left.join("|").localeCompare(right.join("|")),
  );
  return structuralSubcomponent(component, islands[0]);
}

function structuralSubcomponent(
  component: Component,
  ids: readonly string[],
): Component {
  const members = new Set(ids);
  const relations = component.relations.filter(
    (relation) => members.has(relation.a) && members.has(relation.b),
  );
  const topology = relationTopologyMetrics(ids, relations);
  return {
    id: `${component.id}:island:${ids.join("+")}`,
    meshIds: [...ids],
    seams: component.seams.filter(
      (seam) => members.has(seam.instanceA) && members.has(seam.instanceB),
    ),
    relations,
    attachmentGroupIds: new Set(),
    cycleRank: topology.cycleRank,
    parallelRelationCount: topology.parallelRelationCount,
    supportsShell: topology.cycleRank > 0 || topology.parallelRelationCount > 0,
  };
}

function buildCandidates(component: Component, coarse: CoarseAssemblySet): Candidate[] {'''
replace_once(insert_anchor, insert_code, "attachment graph helpers")

replace_once(
'''      const attachments = component.seams.filter((seam) =>
        seam.classification === "intentional-mismatch"
        && ((island.has(seam.instanceA) && placed.has(seam.instanceB))
          || (island.has(seam.instanceB) && placed.has(seam.instanceA))));''',
'''      const attachments = component.seams.filter((seam) =>
        component.attachmentGroupIds.has(seam.seamGroupId)
        && ((island.has(seam.instanceA) && placed.has(seam.instanceB))
          || (island.has(seam.instanceB) && placed.has(seam.instanceA))));''',
"attachment island alignment semantics",
)

replace_once(
'''  for (const seam of component.seams) {
    if (seam.classification !== "structural-alignment" || seam.instanceA === seam.instanceB) continue;
    adjacency.get(seam.instanceA)?.add(seam.instanceB);
    adjacency.get(seam.instanceB)?.add(seam.instanceA);
  }''',
'''  for (const relation of component.relations) {
    if (relation.a === relation.b) continue;
    adjacency.get(relation.a)?.add(relation.b);
    adjacency.get(relation.b)?.add(relation.a);
  }''',
"structural island topology",
)

replace_once(
'''  const structuralSamples = component.seams.filter((seam) =>
    seam.classification === "structural-alignment"
    && members.has(seam.instanceA)
    && members.has(seam.instanceB)).length;
  return area + structuralSamples * 1e-6;''',
'''  const structuralSamples = component.relations.filter((relation) =>
    members.has(relation.a) && members.has(relation.b)).length;
  return area + structuralSamples * 1e-6;''',
"island score relation topology",
)

replace_once(
'''  const structural = component.seams.filter((seam) =>
    participatesInShellTopology(seam) && seam.instanceA !== seam.instanceB);''',
'''  const structural = component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && !component.attachmentGroupIds.has(seam.seamGroupId)
    && seam.instanceA !== seam.instanceB);''',
"structural tree excludes attachments",
)

replace_once(
'''  const placed = new Set<string>([ids[0]]);''',
'''  const placed = new Set<string>(
    structuralIslands(component).map((island) => island[0]).filter(Boolean),
  );''',
"one rigid anchor per island",
)

replace_once(
'''  const anchor = ids[0];
  for (let iteration = 0; iteration < 256; iteration += 1) {''',
'''  const anchors = new Set(
    structuralIslands(component).map((island) => island[0]).filter(Boolean),
  );
  for (let iteration = 0; iteration < 256; iteration += 1) {''',
"pose graph island anchors",
)
replace_once(
'''      if (id === anchor) continue;''',
'''      if (anchors.has(id)) continue;''',
"pose graph skip island anchors",
)

# preAlignComponentRigidTranslations has the same structural selector text as
# alignCandidateAlongStructuralTree; after the first replacement there is one
# remaining occurrence.
replace_once(
'''  const structural = component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && seam.instanceA !== seam.instanceB,
  );''',
'''  const structural = component.seams.filter((seam) =>
    participatesInShellTopology(seam)
    && !component.attachmentGroupIds.has(seam.seamGroupId)
    && seam.instanceA !== seam.instanceB,
  );''',
"prealignment excludes attachments",
)

replace_once(
'''    for (const seam of component.seams) {
      if (seam.classification !== "structural-alignment") continue;
      structuralGroupCounts.set(seam.seamGroupId, (structuralGroupCounts.get(seam.seamGroupId) ?? 0) + 1);
    }
    for (const seam of component.seams) {
      if (seam.classification !== "structural-alignment") continue;''',
'''    for (const seam of component.seams) {
      if (seam.classification !== "structural-alignment"
        || component.attachmentGroupIds.has(seam.seamGroupId)) continue;
      structuralGroupCounts.set(seam.seamGroupId, (structuralGroupCounts.get(seam.seamGroupId) ?? 0) + 1);
    }
    for (const seam of component.seams) {
      if (seam.classification !== "structural-alignment"
        || component.attachmentGroupIds.has(seam.seamGroupId)) continue;''',
"projection excludes attachments",
)

replace_once(
'''function projectOverlapBarrier(
  component: Component,
  coarse: CoarseAssemblySet,
  buffers: Map<string, ProjectionBuffer>,
  ignoredSelfOverlapIds: ReadonlySet<string>,
): void {
  const triangles: Array<{''',
'''function projectOverlapBarrier(
  component: Component,
  coarse: CoarseAssemblySet,
  buffers: Map<string, ProjectionBuffer>,
  ignoredSelfOverlapIds: ReadonlySet<string>,
): void {
  const islandByMesh = new Map<string, number>();
  structuralIslands(component).forEach((island, index) => {
    for (const id of island) islandByMesh.set(id, index);
  });
  const triangles: Array<{''',
"overlap island membership",
)
replace_once(
'''      const second = triangles[j];
      if (second.min[0] > first.max[0] + padding) break;
      if (first.mesh.panelInstanceId === second.mesh.panelInstanceId) {''',
'''      const second = triangles[j];
      if (second.min[0] > first.max[0] + padding) break;
      if (islandByMesh.get(first.mesh.panelInstanceId) !== islandByMesh.get(second.mesh.panelInstanceId)) continue;
      if (first.mesh.panelInstanceId === second.mesh.panelInstanceId) {''',
"overlap ignores cross-island pairs",
)

# Keep whole-component diagnostics, but do not count attachment residual as a
# structural shell residual.
replace_once(
'''  const structural = component.seams.filter((seam) => seam.classification === "structural-alignment");''',
'''  const structural = component.seams.filter((seam) =>
    seam.classification === "structural-alignment"
    && !component.attachmentGroupIds.has(seam.seamGroupId));''',
"metrics exclude attachment residual",
)

insert_realign_anchor = '''function structuralIslands(component: Component): string[][] {'''
insert_realign = '''function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {
  if (component.attachmentGroupIds.size === 0) return;
  const current = snapshotCandidate("attachment-realign", component, coarse);
  const aligned = alignStructuralIslandsByAttachments(component, coarse, current);
  setComponentPositions(component, coarse, aligned.positions);
}

function structuralIslands(component: Component): string[][] {'''
replace_once(insert_realign_anchor, insert_realign, "attachment realign helper")

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
