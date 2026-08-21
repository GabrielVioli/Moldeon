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
'''    if (sourcePoints.length > 0) {
      const fit = bestRigidPointFit(sourcePoints, targetPoints);
      for (const id of island) {
        const source = positions.get(id);
        if (source) positions.set(id, transformPositionsRigidly(source, fit));
        placed.add(id);
      }
    }''',
'''    if (sourcePoints.length > 0) {
      if (island.length === 1) {
        const id = island[0];
        const developed = mapAttachedClosedStripToBoundary(
          id,
          selectedAttachments,
          component,
          coarse,
          positions,
          placed,
        );
        if (developed) {
          positions.set(id, developed);
          placed.add(id);
          continue;
        }
      }
      const fit = bestRigidPointFit(sourcePoints, targetPoints);
      for (const id of island) {
        const source = positions.get(id);
        if (source) positions.set(id, transformPositionsRigidly(source, fit));
        placed.add(id);
      }
    }''',
"develop closed strip before rigid fallback",
)

anchor = '''function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {'''
helper = '''/**
 * Develop a one-panel, self-closed strip directly from the already solved
 * attachment boundary. The test is purely geometric/topological: the local
 * attachment samples must span the strip's closed material direction while
 * remaining approximately constant in the transverse direction.
 *
 * This creates a generalized cylinder: attachment curve + constant extrusion
 * direction. No scale is introduced and the parent island is never moved.
 */
function mapAttachedClosedStripToBoundary(
  id: string,
  attachments: readonly CoarseSeamConstraint[],
  component: Component,
  coarse: CoarseAssemblySet,
  positions: Map<string, Float32Array>,
  placed: ReadonlySet<string>,
): Float32Array | null {
  const mesh = coarse.byInstanceId.get(id);
  const current = positions.get(id);
  if (!mesh || !current) return null;
  const selfSeams = selfStructuralSeams(component, id);
  if (selfSeams.length < 2) return null;
  const axis = acrossAxis(mesh, selfSeams);
  const samples: Array<{
    across: number;
    along: number;
    target: readonly [number, number, number];
  }> = [];
  for (const seam of attachments) {
    const localIsA = seam.instanceA === id && placed.has(seam.instanceB);
    const localIsB = seam.instanceB === id && placed.has(seam.instanceA);
    if (!localIsA && !localIsB) continue;
    const localBinding = localIsA ? seam.a : seam.b;
    const fixedId = localIsA ? seam.instanceB : seam.instanceA;
    const fixedBinding = localIsA ? seam.b : seam.a;
    const fixed = positions.get(fixedId);
    if (!fixed) continue;
    const material = materialAxisSample(localBinding, axis);
    samples.push({
      across: material.across,
      along: material.along,
      target: evaluateBindingOnPositions(fixed, fixedBinding),
    });
  }
  if (samples.length < 4) return null;
  samples.sort((left, right) => left.across - right.across || left.along - right.along);
  const acrossSpan = samples[samples.length - 1].across - samples[0].across;
  const alongValues = samples.map((sample) => sample.along);
  const alongSpan = Math.max(...alongValues) - Math.min(...alongValues);
  if (acrossSpan < 10 || alongSpan > Math.max(2, acrossSpan * 0.02)) return null;

  const materialAcrossValues: number[] = [];
  for (let vertexIndex = 0; vertexIndex < mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
    const x = mesh.materialPositionsMm[vertexIndex * 2];
    const y = mesh.materialPositionsMm[vertexIndex * 2 + 1];
    materialAcrossValues.push(axis.acrossIsX ? x : y);
  }
  const materialAcrossSpan = Math.max(...materialAcrossValues) - Math.min(...materialAcrossValues);
  if (materialAcrossSpan <= 1 || acrossSpan / materialAcrossSpan < 0.9) return null;

  const collapsed: typeof samples = [];
  for (const sample of samples) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && Math.abs(previous.across - sample.across) <= 1e-5) {
      previous.along = (previous.along + sample.along) * 0.5;
      previous.target = scale(add(previous.target, sample.target), 0.5);
    } else {
      collapsed.push({ ...sample });
    }
  }
  if (collapsed.length < 3) return null;
  const attachmentAlong = collapsed.reduce((sum, sample) => sum + sample.along, 0) / collapsed.length;
  const center = centroidOfPointList(collapsed.map((sample) => sample.target));
  let normal: readonly [number, number, number] = [0, 0, 0];
  for (let index = 0; index < collapsed.length - 1; index += 1) {
    normal = add(
      normal,
      cross(sub(collapsed[index].target, center), sub(collapsed[index + 1].target, center)),
    );
  }
  normal = normalize(normal);
  if (length3(normal) <= EPS) return null;

  const frame = materialSurfaceFrame(mesh, current);
  if (frame) {
    const existingAlong = axis.acrossIsX ? frame.y : frame.x;
    if (dot(normal, existingAlong) < 0) normal = scale(normal, -1);
  }

  const result = new Float32Array(mesh.materialPositionsMm.length / 2 * 3);
  for (let vertexIndex = 0; vertexIndex < mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
    const x = mesh.materialPositionsMm[vertexIndex * 2];
    const y = mesh.materialPositionsMm[vertexIndex * 2 + 1];
    const across = axis.acrossIsX ? x : y;
    const along = axis.acrossIsX ? y : x;
    const boundary = interpolateAttachedBoundary(collapsed, across);
    const point = add(boundary, scale(normal, (along - attachmentAlong) * 0.001));
    const offset = vertexIndex * 3;
    result[offset] = point[0];
    result[offset + 1] = point[1];
    result[offset + 2] = point[2];
  }
  return result;
}

function interpolateAttachedBoundary(
  samples: readonly {
    across: number;
    target: readonly [number, number, number];
  }[],
  across: number,
): readonly [number, number, number] {
  if (across <= samples[0].across) return samples[0].target;
  if (across >= samples[samples.length - 1].across) return samples[samples.length - 1].target;
  let upper = 1;
  while (upper < samples.length && samples[upper].across < across) upper += 1;
  const lower = samples[upper - 1];
  const next = samples[Math.min(upper, samples.length - 1)];
  const span = next.across - lower.across;
  if (span <= 1e-9) return scale(add(lower.target, next.target), 0.5);
  const t = (across - lower.across) / span;
  return add(lower.target, scale(sub(next.target, lower.target), t));
}

function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {'''
replace_once(anchor, helper, "developable attachment mapping helpers")

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
