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
'''    setComponentPositions(component, coarse, best.candidate.positions);
    const prePolish = snapshotCandidate("pre-zero-energy-polish", component, coarse);
    polishZeroEnergyPose(component, coarse, options);
    realignCurrentStructuralIslandsByAttachments(component, coarse);
    let finalMetrics = measureComponentMetrics(component, coarse);
    if (!zeroEnergyPolishPreservesMaterial(best.metrics, finalMetrics)) {
      // An incompatible/under-resolved constraint system must never purchase a
      // smaller seam residual by damaging the material surface. Keep the
      // readable isometric candidate and report its residual explicitly.
      setComponentPositions(component, coarse, prePolish.positions);
      finalMetrics = best.metrics;
    }''',
'''    setComponentPositions(component, coarse, best.candidate.positions);
    polishStructuralRelationsRigidly(component, coarse);
    realignCurrentStructuralIslandsByAttachments(component, coarse);
    const rigidMetrics = measureComponentMetrics(component, coarse);
    const prePolish = snapshotCandidate("pre-zero-energy-polish", component, coarse);
    let finalMetrics = rigidMetrics;
    // Vertex-level projection is a last resort only while a hard closure is
    // still visibly open. Once rigid pose alone brings the assembly inside the
    // Phase-A seam gate, preserve that isometric material state verbatim.
    if (rigidMetrics.structuralSeamMaxMm >= 0.5
      || maximumLocalShapingResidual(component, coarse) >= 0.0005) {
      polishZeroEnergyPose(component, coarse, options);
      realignCurrentStructuralIslandsByAttachments(component, coarse);
      finalMetrics = measureComponentMetrics(component, coarse);
      if (!zeroEnergyPolishPreservesMaterial(rigidMetrics, finalMetrics)) {
        // An incompatible/under-resolved constraint system must never purchase a
        // smaller seam residual by damaging the material surface. Keep the
        // readable isometric candidate and report its residual explicitly.
        setComponentPositions(component, coarse, prePolish.positions);
        finalMetrics = rigidMetrics;
      }
    }''',
"rigid structural polish before vertex projection",
)

anchor = '''function preAlignComponentRigidTranslations(
  component: Component,
  coarse: CoarseAssemblySet,
): void {'''
helper = '''/**
 * Close inter-panel structural relations with whole-panel O(3) transforms.
 * Material vertices are never moved relative to one another here. Attachment
 * seam-groups are excluded, and one deterministic panel per structural island
 * remains the gauge anchor.
 */
function polishStructuralRelationsRigidly(
  component: Component,
  coarse: CoarseAssemblySet,
): void {
  const islands = structuralIslands(component);
  for (const ids of islands) {
    if (ids.length < 2) continue;
    const members = new Set(ids);
    const seams = component.seams.filter((seam) =>
      seam.classification === "structural-alignment"
      && !component.attachmentGroupIds.has(seam.seamGroupId)
      && seam.instanceA !== seam.instanceB
      && members.has(seam.instanceA)
      && members.has(seam.instanceB));
    if (seams.length === 0) continue;

    const anchor = [...ids].sort((left, right) => {
      const areaDelta = (coarse.byInstanceId.get(right)?.materialAreaM2 ?? 0)
        - (coarse.byInstanceId.get(left)?.materialAreaM2 ?? 0);
      return Math.abs(areaDelta) > 1e-12 ? areaDelta : left.localeCompare(right);
    })[0];
    const movable = [...ids].filter((id) => id !== anchor).sort();

    for (let iteration = 0; iteration < 512; iteration += 1) {
      for (const id of movable) {
        const local = coarse.byInstanceId.get(id);
        if (!local) continue;
        const relevant = seams.filter((seam) => seam.instanceA === id || seam.instanceB === id);
        const sourcePoints: Array<readonly [number, number, number]> = [];
        const targetPoints: Array<readonly [number, number, number]> = [];
        for (const seam of relevant) {
          const localBinding = seam.instanceA === id ? seam.a : seam.b;
          const fixedId = seam.instanceA === id ? seam.instanceB : seam.instanceA;
          const fixedBinding = seam.instanceA === id ? seam.b : seam.a;
          const fixed = coarse.byInstanceId.get(fixedId);
          if (!fixed) continue;
          sourcePoints.push(evaluateCoarseBinding(local, localBinding));
          targetPoints.push(evaluateCoarseBinding(fixed, fixedBinding));
        }
        if (sourcePoints.length < 2) continue;
        const fit = dampRigidPointFit(bestRigidPointFit(sourcePoints, targetPoints), 0.72);
        local.positions.set(transformPositionsRigidly(local.positions, fit));
      }
      if (iteration >= 12 && iteration % 4 === 3) {
        let maximum = 0;
        for (const seam of seams) {
          const a = coarse.byInstanceId.get(seam.instanceA);
          const b = coarse.byInstanceId.get(seam.instanceB);
          if (!a || !b) continue;
          maximum = Math.max(maximum, Math.max(0,
            length3(sub(evaluateCoarseBinding(b, seam.b), evaluateCoarseBinding(a, seam.a)))
              - Math.max(0, seam.restDistanceM)));
        }
        if (maximum < 0.00035) break;
      }
    }
  }
}

function preAlignComponentRigidTranslations(
  component: Component,
  coarse: CoarseAssemblySet,
): void {'''
replace_once(anchor, helper, "rigid structural relation solver")

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
