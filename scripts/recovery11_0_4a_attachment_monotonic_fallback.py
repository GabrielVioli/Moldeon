from pathlib import Path

path = Path("apps/web/src/garment3d/IsometricSurfaceAssembly.ts")
text = path.read_text(encoding="utf-8")
old = r'''      const fit = bestRigidPointFit(sourcePoints, targetPoints);
      for (const id of island) {
        const source = positions.get(id);
        if (source) positions.set(id, transformPositionsRigidly(source, fit));
        placed.add(id);
      }'''
new = r'''      const fit = bestRigidPointFit(sourcePoints, targetPoints);
      const beforeResidual = attachmentIslandResidualSquared(
        islandSet,
        selectedAttachments,
        positions,
      );
      const fitted = new Map<string, Float32Array>();
      for (const id of island) {
        const source = positions.get(id);
        if (source) fitted.set(id, transformPositionsRigidly(source, fit));
      }
      const trialPositions = new Map(positions);
      for (const [id, values] of fitted) trialPositions.set(id, values);
      const afterResidual = attachmentIslandResidualSquared(
        islandSet,
        selectedAttachments,
        trialPositions,
      );
      if (afterResidual + 1e-14 < beforeResidual) {
        for (const [id, values] of fitted) positions.set(id, values);
      }
      for (const id of island) placed.add(id);'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"attachment rigid fallback: expected one match, found {count}")
text = text.replace(old, new, 1)

anchor = '''function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {'''
helper = r'''function attachmentIslandResidualSquared(
  island: ReadonlySet<string>,
  attachments: readonly CoarseSeamConstraint[],
  positions: ReadonlyMap<string, Float32Array>,
): number {
  let sum = 0;
  let count = 0;
  for (const seam of attachments) {
    const localIsA = island.has(seam.instanceA) && !island.has(seam.instanceB);
    const localIsB = island.has(seam.instanceB) && !island.has(seam.instanceA);
    if (!localIsA && !localIsB) continue;
    const aPositions = positions.get(seam.instanceA);
    const bPositions = positions.get(seam.instanceB);
    if (!aPositions || !bPositions) continue;
    const pa = evaluateBindingOnPositions(aPositions, seam.a);
    const pb = evaluateBindingOnPositions(bPositions, seam.b);
    const distance = length3(sub(pb, pa));
    const residual = Math.max(0, distance - Math.max(0, seam.restDistanceM));
    sum += residual * residual;
    count += 1;
  }
  return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
}

'''+anchor
count = text.count(anchor)
if count != 1:
    raise RuntimeError(f"attachment residual helper anchor: expected one match, found {count}")
text = text.replace(anchor, helper, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
