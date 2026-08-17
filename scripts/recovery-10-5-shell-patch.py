from pathlib import Path

assembly = Path('apps/web/src/garment3d/GarmentAssembly.ts')
s = assembly.read_text()
s = s.replace(
'  mapping: "rigid-panel" | "body-surface" | "local-tube" | "anatomical-half-tube" | "seam-derived-tube";',
'  mapping: "rigid-panel" | "body-surface" | "local-tube" | "anatomical-half-tube" | "seam-derived-tube" | "multipanel-surface-shell";'
)
assembly.write_text(s)

p = Path('apps/web/src/garment3d/SemanticAvatarArrangement.ts')
s = p.read_text()

s = s.replace(
'''  seamPlacementDiagnostics: SeamPlacementDiagnostic[];\n  initialSeamResidualAudit: {''',
'''  seamPlacementDiagnostics: SeamPlacementDiagnostic[];\n  spatialAssemblyDiagnostics: SpatialAssemblyComponentDiagnostic[];\n  initialSeamResidualAudit: {'''
)

marker = '''export interface SeamPlacementDiagnostic {\n'''
insert = '''export interface SpatialAssemblyComponentDiagnostic {\n  componentId: string;\n  instanceIds: string[];\n  strategy: "seam-derived-tube" | "multipanel-surface-shell" | "rigid-fallback";\n  reason: string;\n  structuralSeamGroupCount: number;\n  freeBoundaryCount: number;\n  detectedCycles: number;\n  poseConstraintCount: number;\n  finalMeanResidualMm: number;\n  finalMaxResidualMm: number;\n}\n\n'''
if insert not in s:
    s = s.replace(marker, insert + marker)

s = s.replace(
'''  const afterTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);\n  state.initialPositions.set(state.positions);''',
'''  const afterTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);\n  const spatialAssemblyDiagnostics = buildSpatialAssemblyDiagnostics(\n    state,\n    resolvedGarment,\n    afterTubeAlignment,\n  );\n  state.initialPositions.set(state.positions);'''
)
s = s.replace(
'''    seamPlacementDiagnostics,\n    initialSeamResidualAudit: {''',
'''    seamPlacementDiagnostics,\n    spatialAssemblyDiagnostics,\n    initialSeamResidualAudit: {'''
)

start = s.index('function placeConnectedPanelsRigidly(')
end = s.index('function averageTubeGroupTranslation(', start)
new_block = r'''function placeConnectedPanelsRigidly(
  state: GarmentAssemblyState,
  visible: ReadonlySet<string>,
): SeamPlacementDiagnostic[] {
  const diagnostics: SeamPlacementDiagnostic[] = [];
  const instanceById = new Map(
    state.instances.filter((instance) => visible.has(instance.id)).map((instance) => [instance.id, instance]),
  );
  const adjacency = new Map<string, Set<string>>(
    [...instanceById.keys()].map((id) => [id, new Set<string>()]),
  );
  const constraintsByPair = new Map<string, Map<string, GarmentAssemblyState["stitchConstraints"]>>();

  for (const stitch of state.stitchConstraints) {
    const first = stitch.instanceA;
    const second = stitch.instanceB;
    if (!first || !second || first === second || !instanceById.has(first) || !instanceById.has(second)) continue;
    const key = instancePairKey(first, second);
    const groups = constraintsByPair.get(key) ?? new Map<string, GarmentAssemblyState["stitchConstraints"]>();
    const groupId = stitch.seamGroupId || stitch.seamId;
    const current = groups.get(groupId) ?? [];
    current.push(stitch);
    groups.set(groupId, current);
    constraintsByPair.set(key, groups);
    adjacency.get(first)?.add(second);
    adjacency.get(second)?.add(first);
  }

  const componentVisited = new Set<string>();
  for (const firstInstance of [...instanceById.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (componentVisited.has(firstInstance.id)) continue;
    const component: string[] = [];
    const discoveryQueue = [firstInstance.id];
    componentVisited.add(firstInstance.id);
    while (discoveryQueue.length > 0) {
      const current = discoveryQueue.shift()!;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (componentVisited.has(neighbor)) continue;
        componentVisited.add(neighbor);
        discoveryQueue.push(neighbor);
      }
    }

    component.sort();
    const tubeGroups = new Map<string, string[]>();
    for (const id of component) {
      const arrangement = instanceById.get(id)?.arrangement;
      if (arrangement?.mapping !== "seam-derived-tube") continue;
      const groupId = arrangement.tubeGroupId ?? `tube:${id}`;
      const group = tubeGroups.get(groupId) ?? [];
      group.push(id);
      tubeGroups.set(groupId, group);
    }
    for (const group of tubeGroups.values()) group.sort();
    const primaryTubeGroup = [...tubeGroups.entries()].sort((left, right) => {
      const leftScore = instanceById.get(left[1][0])?.arrangement?.tubeScoreMm2 ?? 0;
      const rightScore = instanceById.get(right[1][0])?.arrangement?.tubeScoreMm2 ?? 0;
      return rightScore - leftScore || left[0].localeCompare(right[0]);
    })[0];
    const shellComponent = tubeGroups.size === 0
      && componentSupportsSurfaceShell(component, constraintsByPair);
    if (shellComponent) {
      for (const id of component) {
        const arrangement = instanceById.get(id)?.arrangement;
        if (arrangement?.mapping === "rigid-panel") arrangement.mapping = "multipanel-surface-shell";
      }
    }

    const roots = primaryTubeGroup?.[1] ?? component.slice(0, 1);
    const placed = new Set(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const fixedId = queue.shift()!;
      for (const movingId of [...(adjacency.get(fixedId) ?? [])].sort()) {
        if (placed.has(movingId)) continue;
        const fixed = instanceById.get(fixedId);
        const moving = instanceById.get(movingId);
        if (!fixed || !moving) continue;
        const movingTubeGroupId = moving.arrangement?.mapping === "seam-derived-tube"
          ? moving.arrangement.tubeGroupId ?? `tube:${moving.id}`
          : undefined;
        const movingTubeGroup = movingTubeGroupId ? tubeGroups.get(movingTubeGroupId) : undefined;
        if (movingTubeGroup && movingTubeGroup.some((id) => !placed.has(id))) {
          const translation = averageTubeGroupTranslation(
            state.positions,
            state.stitchConstraints,
            placed,
            new Set(movingTubeGroup),
          );
          for (const memberId of movingTubeGroup) {
            const member = instanceById.get(memberId);
            if (!member) continue;
            translateRigidPanel(state.positions, member, translation);
            const center = member.arrangement?.tubeCenter;
            if (center) member.arrangement!.tubeCenter = add3(center, translation);
            placed.add(memberId);
            queue.push(memberId);
          }
          continue;
        }

        const groupMap = constraintsByPair.get(instancePairKey(fixedId, movingId));
        const relationGroups = [...(groupMap?.entries() ?? [])].sort(
          (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]),
        );
        const primaryConstraints = relationGroups[0]?.[1] ?? [];
        const diagnostic = alignRigidPanelToSeam(
          state.positions,
          primaryConstraints,
          fixedId,
          movingId,
          fixed,
          moving,
        );
        if (diagnostic && shellComponent) {
          const relatedConstraints = collectConstraintsToPlaced(
            movingId,
            placed,
            constraintsByPair,
          );
          const baseAngle = Math.PI * 2 / Math.max(3, component.length);
          const extraAngle = developSurfacePanel(
            state.positions,
            moving,
            diagnostic.parentMidpoint,
            diagnostic.seamTangent,
            relatedConstraints,
            baseAngle,
          );
          diagnostic.transform.developAngleRad += extraAngle;
          if (moving.arrangement) {
            moving.arrangement.flipWinding = shouldFlipWinding(
              state.positions,
              moving,
              moving.arrangement.outwardNormal,
            );
          }
        }
        if (diagnostic) diagnostics.push(diagnostic);
        placed.add(movingId);
        queue.push(movingId);
      }
    }
  }
  return diagnostics;
}

function componentSupportsSurfaceShell(
  component: readonly string[],
  constraintsByPair: ReadonlyMap<string, ReadonlyMap<string, GarmentAssemblyState["stitchConstraints"]>>,
): boolean {
  if (component.length < 2) return false;
  const members = new Set(component);
  let relationCount = 0;
  let hasParallelMaterialRelations = false;
  for (const [pair, groups] of constraintsByPair) {
    const [first, second] = pair.split("\u0000");
    if (!members.has(first) || !members.has(second)) continue;
    relationCount += groups.size;
    if (groups.size > 1) hasParallelMaterialRelations = true;
  }
  const cycleRank = Math.max(0, relationCount - component.length + 1);
  return hasParallelMaterialRelations || cycleRank > 0;
}

function collectConstraintsToPlaced(
  movingId: string,
  placed: ReadonlySet<string>,
  constraintsByPair: ReadonlyMap<string, ReadonlyMap<string, GarmentAssemblyState["stitchConstraints"]>>,
): GarmentAssemblyState["stitchConstraints"] {
  const constraints: GarmentAssemblyState["stitchConstraints"] = [];
  for (const fixedId of [...placed].sort()) {
    const groups = constraintsByPair.get(instancePairKey(movingId, fixedId));
    if (!groups) continue;
    for (const [, relation] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      constraints.push(...relation);
    }
  }
  return constraints;
}

function developSurfacePanel(
  positions: Float32Array,
  moving: AssemblyPanelInstance,
  seamOrigin: AvatarVector3,
  seamAxis: AvatarVector3,
  constraints: GarmentAssemblyState["stitchConstraints"],
  baseAngle: number,
): number {
  if (constraints.length === 0) return 0;
  const original = captureRigidPanelPositions(positions, moving);
  const candidates = [0.25, -0.25, 0.5, -0.5, 1, -1].map((factor) => baseAngle * factor);
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAngle = candidates[0];
  let bestPositions = original;

  for (const angle of candidates) {
    restoreRigidPanelPositions(positions, moving, original);
    rotateRigidPanelAroundLine(positions, moving, seamOrigin, seamAxis, angle);
    const translation = bestTranslationToPlacedRelations(positions, moving.id, constraints);
    translateRigidPanel(positions, moving, translation);
    const score = structuralRelationResidualScore(positions, constraints);
    if (score < bestScore - 1e-12) {
      bestScore = score;
      bestAngle = angle;
      bestPositions = captureRigidPanelPositions(positions, moving);
    }
  }
  restoreRigidPanelPositions(positions, moving, bestPositions);
  return bestAngle;
}

function captureRigidPanelPositions(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): Float32Array {
  const snapshot = new Float32Array(instance.vertexCount * 3);
  const start = instance.particleStart * 3;
  snapshot.set(positions.subarray(start, start + snapshot.length));
  return snapshot;
}

function restoreRigidPanelPositions(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  snapshot: Float32Array,
): void {
  positions.set(snapshot, instance.particleStart * 3);
}

function bestTranslationToPlacedRelations(
  positions: Float32Array,
  movingId: string,
  constraints: GarmentAssemblyState["stitchConstraints"],
): AvatarVector3 {
  const translation: AvatarVector3 = [0, 0, 0];
  let count = 0;
  for (const constraint of constraints) {
    if (!constraint.instanceA || !constraint.instanceB) continue;
    const first = evaluateReference(positions, constraint.a);
    const second = evaluateReference(positions, constraint.b);
    if (constraint.instanceA === movingId) {
      translation[0] += second[0] - first[0];
      translation[1] += second[1] - first[1];
      translation[2] += second[2] - first[2];
      count += 1;
    } else if (constraint.instanceB === movingId) {
      translation[0] += first[0] - second[0];
      translation[1] += first[1] - second[1];
      translation[2] += first[2] - second[2];
      count += 1;
    }
  }
  return count > 0
    ? translation.map((value) => value / count) as AvatarVector3
    : [0, 0, 0];
}

function structuralRelationResidualScore(
  positions: Float32Array,
  constraints: GarmentAssemblyState["stitchConstraints"],
): number {
  let score = 0;
  let count = 0;
  for (const constraint of constraints) {
    const first = evaluateReference(positions, constraint.a);
    const second = evaluateReference(positions, constraint.b);
    const distance = Math.hypot(
      second[0] - first[0],
      second[1] - first[1],
      second[2] - first[2],
    );
    const residual = distance - Math.max(0, constraint.restDistance);
    score += residual * residual;
    count += 1;
  }
  return count > 0 ? score / count : Number.POSITIVE_INFINITY;
}

'''
s = s[:start] + new_block + s[end:]

# Add component-level diagnostics before panelCenter, after seam alignment helpers are available.
marker = 'function panelCenter(positions: Float32Array, instance: AssemblyPanelInstance): AvatarVector3 {'
diag = r'''function buildSpatialAssemblyDiagnostics(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  residualAudit: InitialSeamResidualAudit,
): SpatialAssemblyComponentDiagnostic[] {
  const adjacency = new Map<string, Set<string>>(
    state.instances.map((instance) => [instance.id, new Set<string>()]),
  );
  const relationKeys = new Set<string>();
  for (const constraint of state.stitchConstraints) {
    if (!constraint.instanceA || !constraint.instanceB || constraint.instanceA === constraint.instanceB) continue;
    adjacency.get(constraint.instanceA)?.add(constraint.instanceB);
    adjacency.get(constraint.instanceB)?.add(constraint.instanceA);
    relationKeys.add(`${instancePairKey(constraint.instanceA, constraint.instanceB)}\u0001${constraint.seamGroupId}`);
  }
  const usedEdges = new Set<string>();
  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    for (const range of [...seamSideRanges(seam, "first"), ...seamSideRanges(seam, "second")]) {
      usedEdges.add(`${range.pieceId}\u0000${range.edgeId}`);
    }
  }

  const result: SpatialAssemblyComponentDiagnostic[] = [];
  const visited = new Set<string>();
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const instanceIds: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      instanceIds.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    instanceIds.sort();
    const members = new Set(instanceIds);
    const componentRelations = [...relationKeys].filter((key) => {
      const pair = key.split("\u0001")[0];
      const [first, second] = pair.split("\u0000");
      return members.has(first) && members.has(second);
    });
    const instances = state.instances.filter((instance) => members.has(instance.id));
    const mappings = new Set(instances.map((instance) => instance.arrangement?.mapping));
    const strategy: SpatialAssemblyComponentDiagnostic["strategy"] = mappings.has("seam-derived-tube")
      ? "seam-derived-tube"
      : mappings.has("multipanel-surface-shell")
        ? "multipanel-surface-shell"
        : "rigid-fallback";
    const reason = strategy === "seam-derived-tube"
      ? "analytical-longitudinal-cycle"
      : strategy === "multipanel-surface-shell"
        ? "multigraph-cycle-or-parallel-material-relations"
        : "insufficient-surface-constraints";
    const groups = residualAudit.groups.filter((group) => group.instanceIds.some((id) => members.has(id)));
    const sampleWeight = groups.reduce((sum, group) => sum + group.sampleCount, 0);
    const finalMeanResidualMm = sampleWeight > 0
      ? groups.reduce((sum, group) => sum + group.meanResidualMm * group.sampleCount, 0) / sampleWeight
      : 0;
    const finalMaxResidualMm = groups.reduce((maximum, group) => Math.max(maximum, group.maxResidualMm), 0);
    let freeBoundaryCount = 0;
    for (const instance of instances) {
      for (const edge of getPatternEdges(instance.topology.sourcePiece)) {
        if (!usedEdges.has(`${instance.pieceId}\u0000${edge.id}`)) freeBoundaryCount += 1;
      }
    }
    result.push({
      componentId: instanceIds.join("|"),
      instanceIds,
      strategy,
      reason,
      structuralSeamGroupCount: groups.filter((group) => group.classification === "structural-alignment").length,
      freeBoundaryCount,
      detectedCycles: Math.max(0, componentRelations.length - instanceIds.length + 1),
      poseConstraintCount: componentRelations.length,
      finalMeanResidualMm,
      finalMaxResidualMm,
    });
  }
  return result;
}

'''
if diag not in s:
    s = s.replace(marker, diag + marker)

p.write_text(s)
print('Prompt 10.5 surface-shell patch applied')
