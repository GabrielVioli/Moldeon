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
 * The attachment samples are hard anchors. Between two anchors the 2D
 * material distance is authoritative, so a circular arc of that exact length
 * is constructed instead of using the shorter spatial chord. Extruding the
 * resulting arclength-parameterized boundary along the opening-plane normal
 * yields a generalized cylinder with the same first fundamental form as the
 * rectangular 2D strip. No scale and no iterative closure are involved.
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

  // The opening must be close to planar for one rectangular strip to attach
  // isometrically as a generalized cylinder with a constant extrusion axis.
  const planeResidualM = collapsed.reduce(
    (maximum, sample) => Math.max(maximum, Math.abs(dot(sub(sample.target, center), extrusion))),
    0,
  );
  if (planeResidualM > Math.max(0.0015, materialSpanMm * 0.001 * 0.01)) return null;

  // Validate every anchor interval before writing any vertex. A target chord
  // longer than its authored material interval is geometrically impossible
  // without stretch, so this mapper refuses rather than silently scaling.
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
  return prescribedArcPoint(
    first.target,
    second.target,
    materialSpanMm * 0.001,
    u,
    planeNormal,
    loopCenter,
  );
}

/** Point on the minor circular arc with prescribed arclength. */
function prescribedArcPoint(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  arcLengthM: number,
  u: number,
  planeNormal: readonly [number, number, number],
  loopCenter: readonly [number, number, number],
): readonly [number, number, number] {
  const chord = sub(second, first);
  const chordLength = length3(chord);
  if (arcLengthM <= EPS || chordLength <= EPS) return first;
  if (arcLengthM - chordLength <= Math.max(1e-8, arcLengthM * 1e-6)) {
    return add(first, scale(chord, u));
  }

  const ratio = clamp(chordLength / arcLengthM, 1e-9, 1);
  let low = 1e-6;
  let high = Math.PI * 1.999;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const theta = (low + high) * 0.5;
    const current = 2 * Math.sin(theta * 0.5) / theta;
    if (current > ratio) low = theta;
    else high = theta;
  }
  const theta = (low + high) * 0.5;
  const radius = arcLengthM / theta;
  const halfChord = chordLength * 0.5;
  const centerDistance = Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const tangent = scale(chord, 1 / chordLength);
  let bulge = normalize(cross(planeNormal, tangent));
  const midpoint = scale(add(first, second), 0.5);
  const radial = sub(midpoint, loopCenter);
  if (dot(bulge, radial) < 0) bulge = scale(bulge, -1);
  const circleCenter = sub(midpoint, scale(bulge, centerDistance));
  const phi = (u - 0.5) * theta;
  return add(
    circleCenter,
    add(
      scale(tangent, Math.sin(phi) * radius),
      scale(bulge, Math.cos(phi) * radius),
    ),
  );
}

function realignCurrentStructuralIslandsByAttachments(
  component: Component,
  coarse: CoarseAssemblySet,
): void {'''
replace_once(anchor, helper, "length-preserving developable attachment mapping")

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
