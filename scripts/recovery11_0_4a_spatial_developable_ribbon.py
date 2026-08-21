from pathlib import Path

path = Path("apps/web/src/garment3d/IsometricSurfaceAssembly.ts")
text = path.read_text(encoding="utf-8")

old = '''  if (planeResidualM > Math.max(0.0015, materialSpanMm * 0.001 * 0.01)) return null;'''
new = '''  if (planeResidualM > Math.max(0.0015, materialSpanMm * 0.001 * 0.01)) {
    return mapAttachedClosedStripToSpatialRibbon(
      id,
      mesh,
      current,
      axis,
      collapsed,
      attachments,
      positions,
      placed,
    );
  }'''
if text.count(old) != 1:
    raise RuntimeError(f"plane fallback anchor: expected one match, found {text.count(old)}")
text = text.replace(old, new, 1)

anchor = '''function polygonPlaneNormal(\n'''
insert = r'''function mapAttachedClosedStripToSpatialRibbon(
  id: string,
  mesh: CoarseAssemblyMesh,
  current: Float32Array,
  axis: ReturnType<typeof acrossAxis>,
  samples: readonly AttachedBoundarySample[],
  attachments: readonly CoarseSeamConstraint[],
  positions: ReadonlyMap<string, Float32Array>,
  placed: ReadonlySet<string>,
): Float32Array | null {
  if (samples.length < 4) return null;
  const loopCenter = centroidOfPointList(samples.map((sample) => sample.target));
  const attachmentAlongMm = samples.reduce((sum, sample) => sum + sample.alongMm, 0) / samples.length;

  // A spatial opening can only be a zero-energy boundary if every authored
  // material interval can reach its two fixed endpoints. This is an exact
  // geometric feasibility test, never a relaxation allowance.
  for (let index = 0; index + 1 < samples.length; index += 1) {
    const requiredM = (samples[index + 1].acrossMm - samples[index].acrossMm) * 0.001;
    const chordM = length3(sub(samples[index + 1].target, samples[index].target));
    if (requiredM <= EPS || chordM > requiredM * (1 + 2e-6)) return null;
  }

  const localPoints: Array<readonly [number, number, number]> = [];
  const targetPoints: Array<readonly [number, number, number]> = [];
  for (const seam of attachments) {
    const localIsA = seam.instanceA === id && placed.has(seam.instanceB);
    const localIsB = seam.instanceB === id && placed.has(seam.instanceA);
    if (!localIsA && !localIsB) continue;
    const localBinding = localIsA ? seam.a : seam.b;
    const fixedId = localIsA ? seam.instanceB : seam.instanceA;
    const fixedBinding = localIsA ? seam.b : seam.a;
    const fixed = positions.get(fixedId);
    if (!fixed) continue;
    localPoints.push(evaluateBindingOnPositions(current, localBinding));
    targetPoints.push(evaluateBindingOnPositions(fixed, fixedBinding));
  }
  if (localPoints.length < 3) return null;
  const guide = transformPositionsRigidly(current, bestRigidPointFit(localPoints, targetPoints));

  const result = new Float32Array(current.length);
  const known = new Uint8Array(current.length / 3);
  let seamVertexCount = 0;
  const rowToleranceMm = 0.002;
  for (let vertexIndex = 0; vertexIndex < mesh.materialPositionsMm.length / 2; vertexIndex += 1) {
    const x = mesh.materialPositionsMm[vertexIndex * 2];
    const y = mesh.materialPositionsMm[vertexIndex * 2 + 1];
    const acrossMm = axis.acrossIsX ? x : y;
    const alongMm = axis.acrossIsX ? y : x;
    if (Math.abs(alongMm - attachmentAlongMm) > rowToleranceMm) continue;
    const point = evaluateSpatialLengthPreservingBoundary(samples, acrossMm, loopCenter);
    if (!point) return null;
    const offset = vertexIndex * 3;
    result[offset] = point[0];
    result[offset + 1] = point[1];
    result[offset + 2] = point[2];
    known[vertexIndex] = 1;
    seamVertexCount += 1;
  }
  if (seamVertexCount < 3) return null;

  // The structured coarse strip is one transverse cell. Starting from the
  // fixed seam row, unfold each adjacent material triangle by exact sphere
  // intersection. Every placed edge therefore keeps its authored 2D length;
  // the only choice is the fold side, selected from the rigid guide.
  const triangleCount = mesh.triangles.length / 3;
  let progressed = true;
  for (let pass = 0; pass < triangleCount + 4 && progressed; pass += 1) {
    progressed = false;
    for (let tri = 0; tri < triangleCount; tri += 1) {
      const vertices = [
        mesh.triangles[tri * 3],
        mesh.triangles[tri * 3 + 1],
        mesh.triangles[tri * 3 + 2],
      ];
      const missing = vertices.filter((vertexIndex) => known[vertexIndex] === 0);
      if (missing.length !== 1) continue;
      const targetIndex = missing[0];
      const fixed = vertices.filter((vertexIndex) => vertexIndex !== targetIndex);
      const placedPoint = trilaterateMaterialTriangleVertex(
        mesh,
        result,
        guide,
        fixed[0],
        fixed[1],
        targetIndex,
      );
      if (!placedPoint) return null;
      const offset = targetIndex * 3;
      result[offset] = placedPoint[0];
      result[offset + 1] = placedPoint[1];
      result[offset + 2] = placedPoint[2];
      known[targetIndex] = 1;
      progressed = true;
    }
  }
  if ([...known].some((value) => value === 0)) return null;

  let maximumRelative = 0;
  for (const edge of mesh.metricEdges) {
    const currentLength = length3(sub(vertex(result, edge.b), vertex(result, edge.a)));
    if (edge.restLengthM <= EPS) continue;
    maximumRelative = Math.max(
      maximumRelative,
      Math.abs(currentLength - edge.restLengthM) / edge.restLengthM,
    );
  }
  if (maximumRelative > 2e-5) return null;
  return result;
}

function evaluateSpatialLengthPreservingBoundary(
  samples: readonly AttachedBoundarySample[],
  acrossMm: number,
  loopCenter: readonly [number, number, number],
): readonly [number, number, number] | null {
  if (acrossMm <= samples[0].acrossMm + 1e-6) return samples[0].target;
  if (acrossMm >= samples[samples.length - 1].acrossMm - 1e-6) return samples[samples.length - 1].target;
  let upper = 1;
  while (upper < samples.length && samples[upper].acrossMm < acrossMm) upper += 1;
  const first = samples[upper - 1];
  const second = samples[Math.min(upper, samples.length - 1)];
  const materialSpanMm = second.acrossMm - first.acrossMm;
  if (materialSpanMm <= 1e-9) return null;
  const authoredLengthM = materialSpanMm * 0.001;
  const chord = sub(second.target, first.target);
  const chordLength = length3(chord);
  if (chordLength <= EPS || chordLength > authoredLengthM * (1 + 2e-6)) return null;
  const midpoint = scale(add(first.target, second.target), 0.5);
  const tangent = scale(chord, 1 / chordLength);
  let radial = sub(midpoint, loopCenter);
  radial = sub(radial, scale(tangent, dot(radial, tangent)));
  if (length3(radial) <= EPS) {
    const previous = samples[Math.max(0, upper - 2)].target;
    const next = samples[Math.min(samples.length - 1, upper + 1)].target;
    radial = cross(tangent, sub(next, previous));
  }
  if (length3(radial) <= EPS) return null;
  const bulge = normalize(radial);
  const halfLength = authoredLengthM * 0.5;
  const halfChord = chordLength * 0.5;
  const height = Math.sqrt(Math.max(0, halfLength * halfLength - halfChord * halfChord));
  const hinge = add(midpoint, scale(bulge, height));
  const u = clamp((acrossMm - first.acrossMm) / materialSpanMm, 0, 1);
  if (u <= 0.5) return add(first.target, scale(sub(hinge, first.target), u * 2));
  return add(hinge, scale(sub(second.target, hinge), (u - 0.5) * 2));
}

function trilaterateMaterialTriangleVertex(
  mesh: CoarseAssemblyMesh,
  positions: Float32Array,
  guide: Float32Array,
  firstIndex: number,
  secondIndex: number,
  targetIndex: number,
): readonly [number, number, number] | null {
  const first = vertex(positions, firstIndex);
  const second = vertex(positions, secondIndex);
  const chord = sub(second, first);
  const d = length3(chord);
  if (d <= EPS) return null;
  const radiusFirst = materialVertexDistanceM(mesh, firstIndex, targetIndex);
  const radiusSecond = materialVertexDistanceM(mesh, secondIndex, targetIndex);
  if (radiusFirst <= EPS || radiusSecond <= EPS) return null;
  if (d > radiusFirst + radiusSecond + 2e-7) return null;
  if (d < Math.abs(radiusFirst - radiusSecond) - 2e-7) return null;
  const axis = scale(chord, 1 / d);
  const x = (radiusFirst * radiusFirst - radiusSecond * radiusSecond + d * d) / (2 * d);
  const heightSquared = radiusFirst * radiusFirst - x * x;
  if (heightSquared < -2e-10) return null;
  const circleCenter = add(first, scale(axis, x));
  const guideTarget = vertex(guide, targetIndex);
  let direction = sub(guideTarget, circleCenter);
  direction = sub(direction, scale(axis, dot(direction, axis)));
  if (length3(direction) <= EPS) {
    const guideFirst = vertex(guide, firstIndex);
    const guideSecond = vertex(guide, secondIndex);
    direction = cross(axis, sub(guideSecond, guideFirst));
  }
  if (length3(direction) <= EPS) return null;
  return add(circleCenter, scale(normalize(direction), Math.sqrt(Math.max(0, heightSquared))));
}

function materialVertexDistanceM(
  mesh: CoarseAssemblyMesh,
  firstIndex: number,
  secondIndex: number,
): number {
  const dx = (mesh.materialPositionsMm[secondIndex * 2] - mesh.materialPositionsMm[firstIndex * 2]) * 0.001;
  const dy = (mesh.materialPositionsMm[secondIndex * 2 + 1] - mesh.materialPositionsMm[firstIndex * 2 + 1]) * 0.001;
  return Math.hypot(dx, dy);
}

'''
if text.count(anchor) != 1:
    raise RuntimeError(f"polygonPlaneNormal anchor: expected one match, found {text.count(anchor)}")
text = text.replace(anchor, insert + anchor, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
