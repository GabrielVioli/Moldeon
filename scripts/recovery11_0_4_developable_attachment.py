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
helper = '''interface AttachedBoundarySample {
  acrossMm: number;
  alongMm: number;
  target: readonly [number, number, number];
}

/**
 * Develop a one-panel, self-closed narrow strip directly from an already
 * solved attachment opening. The parent island is immutable.
 *
 * Seam samples are hard anchors. The attachment-aware material topology adds
 * one unconstrained hinge column halfway between each pair of anchors. That
 * hinge is placed so the two straight 3D segments each retain exactly half of
 * the authored 2D interval length. The fine topology is a nested refinement of
 * these same facets, so coarse-to-fine transfer preserves the discrete metric
 * consumed by XPBD. No scale and no iterative closure are involved.
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
  const samples: AttachedBoundarySample[] = [];
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
      acrossMm: material.across,
      alongMm: material.along,
      target: evaluateBindingOnPositions(fixed, fixedBinding),
    });
  }
  if (samples.length < 4) return null;
  samples.sort((left, right) => left.acrossMm - right.acrossMm || left.alongMm - right.alongMm);

  const collapsed: AttachedBoundarySample[] = [];
  for (const sample of samples) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && Math.abs(previous.acrossMm - sample.acrossMm) <= 1e-4) {
      previous.alongMm = (previous.alongMm + sample.alongMm) * 0.5;
      previous.target = scale(add(previous.target, sample.target), 0.5);
    } else {
      collapsed.push({ ...sample });
    }
  }
  if (collapsed.length < 4) return null;

  const materialAcrossValues: number[] = [];
  for (let vertexIndex = 0; vertexIndex < mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
    const x = mesh.materialPositionsMm[vertexIndex * 2];
    const y = mesh.materialPositionsMm[vertexIndex * 2 + 1];
    materialAcrossValues.push(axis.acrossIsX ? x : y);
  }
  const materialMin = Math.min(...materialAcrossValues);
  const materialMax = Math.max(...materialAcrossValues);
  const materialSpanMm = materialMax - materialMin;
  const sampledSpanMm = collapsed[collapsed.length - 1].acrossMm - collapsed[0].acrossMm;
  const alongValues = collapsed.map((sample) => sample.alongMm);
  const alongSpanMm = Math.max(...alongValues) - Math.min(...alongValues);
  if (materialSpanMm <= 1 || sampledSpanMm < materialSpanMm * 0.9) return null;
  if (alongSpanMm > Math.max(2, materialSpanMm * 0.02)) return null;

  const center = centroidOfPointList(collapsed.map((sample) => sample.target));
  let extrusion = polygonPlaneNormal(collapsed.map((sample) => sample.target), center);
  if (length3(extrusion) <= EPS) return null;
  const currentFrame = materialSurfaceFrame(mesh, current);
  if (currentFrame) {
    const materialAlong = axis.acrossIsX ? currentFrame.y : currentFrame.x;
    if (dot(extrusion, materialAlong) < 0) extrusion = scale(extrusion, -1);
  }

  const planeResidualM = collapsed.reduce(
    (maximum, sample) => Math.max(maximum, Math.abs(dot(sub(sample.target, center), extrusion))),
    0,
  );
  if (planeResidualM > Math.max(0.0015, materialSpanMm * 0.001 * 0.01)) return null;

  for (let index = 0; index + 1 < collapsed.length; index += 1) {
    const requiredM = (collapsed[index + 1].acrossMm - collapsed[index].acrossMm) * 0.001;
    const chordM = length3(sub(collapsed[index + 1].target, collapsed[index].target));
    if (requiredM <= EPS || chordM > requiredM * 1.0005) return null;
  }

  const attachmentAlongMm = collapsed.reduce((sum, sample) => sum + sample.alongMm, 0) / collapsed.length;
  const result = new Float32Array(mesh.materialPositionsMm.length / 2 * 3);
  for (let vertexIndex = 0; vertexIndex < mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
    const x = mesh.materialPositionsMm[vertexIndex * 2];
    const y = mesh.materialPositionsMm[vertexIndex * 2 + 1];
    const acrossMm = axis.acrossIsX ? x : y;
    const alongMm = axis.acrossIsX ? y : x;
    const boundary = evaluateLengthPreservingAttachedBoundary(
      collapsed,
      acrossMm,
      extrusion,
      center,
    );
    const point = add(boundary, scale(extrusion, (alongMm - attachmentAlongMm) * 0.001));
    const offset = vertexIndex * 3;
    result[offset] = point[0];
    result[offset + 1] = point[1];
    result[offset + 2] = point[2];
  }
  return result;
}

function polygonPlaneNormal(
  points: readonly (readonly [number, number, number])[],
  center: readonly [number, number, number],
): readonly [number, number, number] {
  let normal: readonly [number, number, number] = [0, 0, 0];
  for (let index = 0; index + 1 < points.length; index += 1) {
    normal = add(
      normal,
      cross(sub(points[index], center), sub(points[index + 1], center)),
    );
  }
  return normalize(normal);
}

function evaluateLengthPreservingAttachedBoundary(
  samples: readonly AttachedBoundarySample[],
  acrossMm: number,
  planeNormal: readonly [number, number, number],
  loopCenter: readonly [number, number, number],
): readonly [number, number, number] {
  if (acrossMm <= samples[0].acrossMm) return samples[0].target;
  if (acrossMm >= samples[samples.length - 1].acrossMm) return samples[samples.length - 1].target;
  let upper = 1;
  while (upper < samples.length && samples[upper].acrossMm < acrossMm) upper += 1;
  const first = samples[upper - 1];
  const second = samples[Math.min(upper, samples.length - 1)];
  const materialSpanMm = second.acrossMm - first.acrossMm;
  if (materialSpanMm <= 1e-9) return scale(add(first.target, second.target), 0.5);
  const u = clamp((acrossMm - first.acrossMm) / materialSpanMm, 0, 1);
  return prescribedHingePolylinePoint(
    first.target,
    second.target,
    materialSpanMm * 0.001,
    u,
    planeNormal,
    loopCenter,
  );
}

/**
 * Two straight segments with exact total authored length. u=0.5 is the
 * topology hinge introduced between the two seam-anchor columns.
 */
function prescribedHingePolylinePoint(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  authoredLengthM: number,
  u: number,
  planeNormal: readonly [number, number, number],
  loopCenter: readonly [number, number, number],
): readonly [number, number, number] {
  const chord = sub(second, first);
  const chordLength = length3(chord);
  if (authoredLengthM <= EPS || chordLength <= EPS) return first;
  const midpoint = scale(add(first, second), 0.5);
  const halfLength = authoredLengthM * 0.5;
  const halfChord = chordLength * 0.5;
  if (halfLength <= halfChord * (1 + 1e-7)) return add(first, scale(chord, u));
  const tangent = scale(chord, 1 / chordLength);
  let bulge = normalize(cross(planeNormal, tangent));
  const radial = sub(midpoint, loopCenter);
  if (dot(bulge, radial) < 0) bulge = scale(bulge, -1);
  const height = Math.sqrt(Math.max(0, halfLength * halfLength - halfChord * halfChord));
  const hinge = add(midpoint, scale(bulge, height));
  if (u <= 0.5) return add(first, scale(sub(hinge, first), u * 2));
  return add(hinge, scale(sub(second, hinge), (u - 0.5) * 2));
}

function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {'''
replace_once(anchor, helper, "length-preserving developable attachment mapping")

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
