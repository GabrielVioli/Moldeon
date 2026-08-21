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
'''    polishZeroEnergyPose(component, coarse, options);
    realignCurrentStructuralIslandsByAttachments(component, coarse);
    let finalMetrics = measureComponentMetrics(component, coarse);''',
'''    polishZeroEnergyPose(component, coarse, options);
    realignCurrentStructuralIslandsByAttachments(component, coarse);
    polishAttachmentIslands(component, coarse, options);
    let finalMetrics = measureComponentMetrics(component, coarse);''',
"attachment polish invocation",
)

anchor = '''function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {
  if (component.attachmentGroupIds.size === 0) return;
  const current = snapshotCandidate("attachment-realign", component, coarse);
  const aligned = alignStructuralIslandsByAttachments(component, coarse, current);
  setComponentPositions(component, coarse, aligned.positions);
}

function structuralIslands(component: Component): string[][] {'''
replacement = '''function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {
  if (component.attachmentGroupIds.size === 0) return;
  const current = snapshotCandidate("attachment-realign", component, coarse);
  const aligned = alignStructuralIslandsByAttachments(component, coarse, current);
  setComponentPositions(component, coarse, aligned.positions);
}

/**
 * Conform each attached structural island to an already solved neighbour while
 * keeping that neighbour immutable. The local island may bend along its
 * triangulation hinges, but every material edge is restored after attachment
 * projection. This is assembly-time developable shaping, not XPBD and not
 * scale: the dominant shell never moves to purchase a local attachment.
 */
function polishAttachmentIslands(
  component: Component,
  coarse: CoarseAssemblySet,
  options: IsometricAssemblyOptions,
): void {
  if (component.attachmentGroupIds.size === 0) return;
  const islands = structuralIslands(component);
  if (islands.length < 2) return;
  islands.sort((left, right) =>
    structuralIslandScore(right, component, coarse) - structuralIslandScore(left, component, coarse)
    || left.join("|").localeCompare(right.join("|")),
  );
  const placed = new Set(islands[0]);
  const remaining = islands.slice(1);
  const iterations = Math.max(
    0,
    Math.min(4_000, Math.round(options.zeroEnergyIterations ?? DEFAULT_ZERO_ENERGY_ITERATIONS)),
  );

  while (remaining.length > 0) {
    let selectedIndex = -1;
    let attachments: CoarseSeamConstraint[] = [];
    for (let index = 0; index < remaining.length; index += 1) {
      const local = new Set(remaining[index]);
      const bridges = component.seams.filter((seam) =>
        component.attachmentGroupIds.has(seam.seamGroupId)
        && ((local.has(seam.instanceA) && placed.has(seam.instanceB))
          || (local.has(seam.instanceB) && placed.has(seam.instanceA))));
      if (bridges.length > attachments.length) {
        selectedIndex = index;
        attachments = bridges;
      }
    }
    if (selectedIndex < 0 || attachments.length === 0) break;

    const island = remaining.splice(selectedIndex, 1)[0];
    const local = new Set(island);
    const localClosures = component.seams.filter((seam) =>
      local.has(seam.instanceA)
      && local.has(seam.instanceB)
      && ((seam.classification === "structural-alignment"
          && !component.attachmentGroupIds.has(seam.seamGroupId))
        || seam.classification === "local-shaping-closure"));

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const reverse = iteration % 2 === 1;
      for (const id of island) projectMetricEdgesSequential(coarse.byInstanceId.get(id)!, reverse);
      projectClosuresSequential(coarse, localClosures, reverse);
      projectAnchoredAttachmentClosures(coarse, attachments, local, placed, reverse);
      for (const id of island) projectMetricEdgesSequential(coarse.byInstanceId.get(id)!, !reverse);
      projectClosuresSequential(coarse, localClosures, !reverse);
      projectAnchoredAttachmentClosures(coarse, attachments, local, placed, !reverse);

      if (iteration >= 24 && iteration % 8 === 7) {
        const residual = attachmentIslandResidual(coarse, island, localClosures, attachments, local, placed);
        if (residual.maximumMetricRelative <= ZERO_ENERGY_METRIC_TOLERANCE
          && residual.maximumClosureM <= ZERO_ENERGY_SEAM_TOLERANCE_M) break;
      }
    }
    for (const id of island) placed.add(id);
  }
}

function projectAnchoredAttachmentClosures(
  coarse: CoarseAssemblySet,
  attachments: readonly CoarseSeamConstraint[],
  local: ReadonlySet<string>,
  placed: ReadonlySet<string>,
  reverse: boolean,
): void {
  for (let cursor = 0; cursor < attachments.length; cursor += 1) {
    const seam = attachments[reverse ? attachments.length - 1 - cursor : cursor];
    const localIsA = local.has(seam.instanceA) && placed.has(seam.instanceB);
    const localIsB = local.has(seam.instanceB) && placed.has(seam.instanceA);
    if (!localIsA && !localIsB) continue;
    const localMesh = coarse.byInstanceId.get(localIsA ? seam.instanceA : seam.instanceB);
    const fixedMesh = coarse.byInstanceId.get(localIsA ? seam.instanceB : seam.instanceA);
    if (!localMesh || !fixedMesh) continue;
    const localBinding = localIsA ? seam.a : seam.b;
    const fixedBinding = localIsA ? seam.b : seam.a;
    const localPoint = evaluateCoarseBinding(localMesh, localBinding);
    const fixedPoint = evaluateCoarseBinding(fixedMesh, fixedBinding);
    const delta = sub(fixedPoint, localPoint);
    const distance = length3(delta);
    if (distance <= EPS) continue;
    const rest = Math.max(0, seam.restDistanceM);
    const excess = distance - rest;
    if (Math.abs(excess) <= EPS) continue;
    const correction = scale(
      delta,
      excess / distance * ZERO_ENERGY_SEAM_RELAXATION * 2,
    );
    translateBinding(localMesh, localBinding, correction);
  }
}

function attachmentIslandResidual(
  coarse: CoarseAssemblySet,
  island: readonly string[],
  localClosures: readonly CoarseSeamConstraint[],
  attachments: readonly CoarseSeamConstraint[],
  local: ReadonlySet<string>,
  placed: ReadonlySet<string>,
): { maximumMetricRelative: number; maximumClosureM: number } {
  let maximumMetricRelative = 0;
  let maximumClosureM = 0;
  for (const id of island) {
    const mesh = coarse.byInstanceId.get(id)!;
    for (const edge of mesh.metricEdges) {
      if (edge.restLengthM <= EPS) continue;
      const current = length3(sub(vertex(mesh.positions, edge.b), vertex(mesh.positions, edge.a)));
      maximumMetricRelative = Math.max(
        maximumMetricRelative,
        Math.abs(current - edge.restLengthM) / edge.restLengthM,
      );
    }
  }
  for (const seam of [...localClosures, ...attachments]) {
    if (componentSeamIsOutsidePlacement(seam, local, placed)) continue;
    const meshA = coarse.byInstanceId.get(seam.instanceA);
    const meshB = coarse.byInstanceId.get(seam.instanceB);
    if (!meshA || !meshB) continue;
    const distance = length3(sub(
      evaluateCoarseBinding(meshB, seam.b),
      evaluateCoarseBinding(meshA, seam.a),
    ));
    maximumClosureM = Math.max(
      maximumClosureM,
      Math.abs(distance - Math.max(0, seam.restDistanceM)),
    );
  }
  return { maximumMetricRelative, maximumClosureM };
}

function componentSeamIsOutsidePlacement(
  seam: CoarseSeamConstraint,
  local: ReadonlySet<string>,
  placed: ReadonlySet<string>,
): boolean {
  if (local.has(seam.instanceA) && local.has(seam.instanceB)) return false;
  return !((local.has(seam.instanceA) && placed.has(seam.instanceB))
    || (local.has(seam.instanceB) && placed.has(seam.instanceA)));
}

function structuralIslands(component: Component): string[][] {'''
replace_once(anchor, replacement, "local attachment polish helpers")

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
