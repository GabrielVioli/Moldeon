from pathlib import Path

step0_path = Path("apps/web/src/viewport/SewingStep0.ts")
text = step0_path.read_text(encoding="utf-8")

if "interface ExactBodyWrapProfile" not in text:
    text = text.replace(
        '  bodyFit?: SewingStep0BodyFit | null;\n}',
        '  bodyFit?: SewingStep0BodyFit | null;\n  body?: HumanBodyMesh | null;\n}',
        1,
    )
    text = text.replace(
        '      options.bodyFit,\n      options.bodyClearanceM ?? 0.0005,\n    )',
        '      options.bodyFit,\n      options.body ?? null,\n      options.bodyClearanceM ?? 0.0005,\n    )',
        1,
    )

    start = text.index('function buildBodyAwareSelfSeamWorldPositions(')
    end = text.index('\nfunction nearestWorldVertexIndex(', start)
    replacement = r'''function buildBodyAwareSelfSeamWorldPositions(
  solvedState: GarmentAssemblyState,
  instance: GarmentAssemblyState["instances"][number],
  currentWorld: Float32Array,
  section: HumanBodyCrossSection,
  rootSurface: BodySurfaceFrame,
  fit: SewingStep0BodyFit,
  body: HumanBodyMesh | null,
  clearanceM: number,
): Float32Array | null {
  const materialCircumferenceM = (fit.materialCircumferenceMm ?? 0) * 0.001;
  const requiredCircumferenceM = (fit.requiredCircumferenceMm ?? 0) * 0.001;
  if (materialCircumferenceM <= 0 || requiredCircumferenceM <= 0) return null;
  const seams = physicalSelfSeamConstraints(solvedState, instance.id);
  if (seams.length < 2) return null;
  const material = instance.topology.positions2DMm;
  if (!material || material.length !== instance.vertexCount * 2) return null;

  let across = new THREE.Vector2();
  let acrossSamples = 0;
  for (const seam of seams) {
    const a = weightedMaterialPoint2D(instance, seam.a);
    const b = weightedMaterialPoint2D(instance, seam.b);
    if (!a || !b) continue;
    const delta = b.sub(a);
    if (delta.lengthSq() <= 1e-8) continue;
    across.add(delta.normalize());
    acrossSamples += 1;
  }
  if (acrossSamples === 0 || across.lengthSq() <= 1e-8) return null;
  across.normalize();
  const materialAxis = new THREE.Vector2(-across.y, across.x);

  const anchorVertex = nearestWorldVertexIndex(currentWorld, centroidOfPositions(currentWorld));
  const anchorMaterial = new THREE.Vector2(material[anchorVertex * 2], material[anchorVertex * 2 + 1]);
  const currentAxis = materialDirectionInWorld(currentWorld, material, anchorMaterial, materialAxis);
  let targetAxis = section.normal
    ? new THREE.Vector3(...section.normal)
    : new THREE.Vector3(0, 1, 0);
  if (targetAxis.lengthSq() <= 1e-10) targetAxis.set(0, 1, 0);
  targetAxis.normalize();
  if (currentAxis.lengthSq() > 1e-10 && targetAxis.dot(currentAxis) < 0) targetAxis.negate();

  let outward = new THREE.Vector3(...rootSurface.outwardNormal);
  outward.addScaledVector(targetAxis, -outward.dot(targetAxis));
  if (outward.lengthSq() <= 1e-10) outward.set(0, 0, 1).addScaledVector(targetAxis, -targetAxis.z);
  if (outward.lengthSq() <= 1e-10) return null;
  outward.normalize();
  const around = new THREE.Vector3().crossVectors(targetAxis, outward).normalize();
  if (around.lengthSq() <= 1e-10) return null;

  const sectionCenter = section.centerM
    ? new THREE.Vector3(...section.centerM)
    : new THREE.Vector3(0, section.yM, section.centerZM);
  const currentAnchor = new THREE.Vector3(
    currentWorld[anchorVertex * 3],
    currentWorld[anchorVertex * 3 + 1],
    currentWorld[anchorVertex * 3 + 2],
  );
  const axialAnchor = currentAnchor.clone().sub(sectionCenter).dot(targetAxis);

  // The old registration approximated the human section with a symmetric
  // ellipse. That preserved seam length but could still cut through glute/side
  // lobes, while wasting ease on empty directions. Prefer the exact visual-body
  // plane contour and spend any authored ease by a uniform radial offset.
  const exactProfile = body
    ? buildExactBodyWrapProfile(
      body,
      sectionCenter,
      targetAxis,
      around,
      outward,
      section.actualCircumferenceMm * 0.001,
      materialCircumferenceM,
      clearanceM,
    )
    : null;

  let ellipseTable: EllipseArcTable | null = null;
  let ellipseSemiTangentM = 0;
  let ellipseSemiOutwardM = 0;
  if (!exactProfile) {
    const baseTangentM = Math.max(0.005, section.halfWidthM + clearanceM);
    const baseOutwardM = Math.max(0.005, Math.max(section.frontDepthM, section.backDepthM) + clearanceM);
    const targetCircumferenceM = Math.max(materialCircumferenceM, requiredCircumferenceM);
    const baseCircumferenceM = ellipseCircumference(baseTangentM, baseOutwardM);
    if (!Number.isFinite(baseCircumferenceM) || baseCircumferenceM <= 1e-9) return null;
    const sectionScale = targetCircumferenceM / baseCircumferenceM;
    ellipseSemiTangentM = baseTangentM * sectionScale;
    ellipseSemiOutwardM = baseOutwardM * sectionScale;
    ellipseTable = buildEllipseArcTable(ellipseSemiTangentM, ellipseSemiOutwardM);
    const stretchRatio = targetCircumferenceM / materialCircumferenceM;
    if (stretchRatio > 1 + STEP0_MAXIMUM_MATERIAL_STRETCH_PERCENT / 100 + 1e-6) return null;
  }

  const result = new Float32Array(instance.vertexCount * 3);
  const point = new THREE.Vector3();
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const materialPoint = new THREE.Vector2(material[local * 2], material[local * 2 + 1]).sub(anchorMaterial);
    const signedArcM = materialPoint.dot(across) * 0.001;
    const axialM = materialPoint.dot(materialAxis) * 0.001;
    let radial: THREE.Vector2;
    if (exactProfile) {
      radial = bodyWrapProfilePointAtSignedArc(exactProfile, signedArcM);
    } else {
      const angle = ellipseAngleAtSignedArc(signedArcM, ellipseTable!);
      radial = new THREE.Vector2(
        ellipseSemiTangentM * Math.sin(angle),
        ellipseSemiOutwardM * Math.cos(angle),
      );
    }
    point.copy(sectionCenter)
      .addScaledVector(targetAxis, axialAnchor + axialM)
      .addScaledVector(around, radial.x)
      .addScaledVector(outward, radial.y);
    result[local * 3] = point.x;
    result[local * 3 + 1] = point.y;
    result[local * 3 + 2] = point.z;
  }
  return result;
}

interface ExactBodyWrapProfile {
  points: THREE.Vector2[];
  cumulativeM: Float64Array;
  circumferenceM: number;
  sourceCircumferenceM: number;
  radialEaseM: number;
}

function buildExactBodyWrapProfile(
  body: HumanBodyMesh,
  centre: THREE.Vector3,
  axis: THREE.Vector3,
  around: THREE.Vector3,
  outward: THREE.Vector3,
  expectedCircumferenceM: number,
  materialCircumferenceM: number,
  clearanceM: number,
): ExactBodyWrapProfile | null {
  const segments = intersectBodyPlaneSegments(body, centre, axis, around, outward);
  if (segments.length < 8) return null;
  const components = connectedPlaneComponents(segments);
  if (components.length === 0) return null;

  let source: THREE.Vector2[] | null = null;
  let sourceCircumferenceM = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const component of components) {
    if (component.length < 8) continue;
    const ordered = [...component].sort((left, right) =>
      Math.atan2(left.x, left.y) - Math.atan2(right.x, right.y),
    );
    const circumferenceM = polylineCircumference(ordered);
    if (!Number.isFinite(circumferenceM) || circumferenceM <= 0.05) continue;
    const containsCentre = polygonContainsOrigin(ordered);
    const relativeError = expectedCircumferenceM > 1e-6
      ? Math.abs(circumferenceM - expectedCircumferenceM) / expectedCircumferenceM
      : 0;
    const score = relativeError + (containsCentre ? 0 : 10);
    if (score < bestScore) {
      bestScore = score;
      source = ordered;
      sourceCircumferenceM = circumferenceM;
    }
  }
  if (!source || source.length < 8 || bestScore >= 10) return null;

  // Put material arc zero at the authored-facing surface. Sorting by atan2(x,z)
  // already gives the positive arc direction along `around`.
  let frontIndex = 0;
  for (let index = 1; index < source.length; index += 1) {
    if (source[index].y > source[frontIndex].y) frontIndex = index;
  }
  source = [...source.slice(frontIndex), ...source.slice(0, frontIndex)];

  const inflate = (radialEaseM: number): THREE.Vector2[] => source!.map((value) => {
    const radius = value.length();
    if (radius <= 1e-8) return value.clone();
    return value.clone().multiplyScalar((radius + clearanceM + radialEaseM) / radius);
  });

  const clearanceProfile = inflate(0);
  const clearanceCircumferenceM = polylineCircumference(clearanceProfile);
  // A profile that is already longer than the material by more than a tiny
  // numerical tolerance cannot be fitted without violating the 2% material
  // contract. The quantitative preflight will explain truly undersized loops.
  if (clearanceCircumferenceM > materialCircumferenceM + 0.0005) return null;

  let low = 0;
  let high = Math.max(0.002, (materialCircumferenceM - clearanceCircumferenceM) / (Math.PI * 2) * 2 + 0.002);
  while (polylineCircumference(inflate(high)) < materialCircumferenceM && high < 0.25) high *= 2;
  for (let iteration = 0; iteration < 42; iteration += 1) {
    const middle = (low + high) * 0.5;
    if (polylineCircumference(inflate(middle)) < materialCircumferenceM) low = middle;
    else high = middle;
  }
  const radialEaseM = (low + high) * 0.5;
  const points = inflate(radialEaseM);
  const table = buildClosedPolylineArcTable(points);
  if (!table || Math.abs(table.circumferenceM - materialCircumferenceM) > 0.00075) return null;
  return {
    points,
    cumulativeM: table.cumulativeM,
    circumferenceM: table.circumferenceM,
    sourceCircumferenceM,
    radialEaseM,
  };
}

function intersectBodyPlaneSegments(
  body: HumanBodyMesh,
  centre: THREE.Vector3,
  axis: THREE.Vector3,
  around: THREE.Vector3,
  outward: THREE.Vector3,
): Array<[THREE.Vector2, THREE.Vector2]> {
  const segments: Array<[THREE.Vector2, THREE.Vector2]> = [];
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const relative = new THREE.Vector3();
  const intersections: THREE.Vector3[] = [];
  const edgePairs = [[0, 1], [1, 2], [2, 0]] as const;
  const planeEpsilon = 1e-8;
  for (let triangle = 0; triangle * 3 + 2 < body.indices.length; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = body.indices[triangle * 3 + corner];
      const offset = vertex * 3;
      vertices[corner].set(body.positions[offset], body.positions[offset + 1], body.positions[offset + 2]);
    }
    const distances = vertices.map((value) => relative.copy(value).sub(centre).dot(axis));
    intersections.length = 0;
    for (const [first, second] of edgePairs) {
      const da = distances[first];
      const db = distances[second];
      if (Math.abs(da) <= planeEpsilon && Math.abs(db) <= planeEpsilon) continue;
      if ((da > planeEpsilon && db > planeEpsilon) || (da < -planeEpsilon && db < -planeEpsilon)) continue;
      const denominator = da - db;
      if (Math.abs(denominator) <= 1e-12) continue;
      const t = THREE.MathUtils.clamp(da / denominator, 0, 1);
      const point = vertices[first].clone().lerp(vertices[second], t);
      if (intersections.every((existing) => existing.distanceToSquared(point) > 1e-14)) intersections.push(point);
    }
    if (intersections.length < 2) continue;
    let first = intersections[0];
    let second = intersections[1];
    let farthestSq = first.distanceToSquared(second);
    for (let a = 0; a < intersections.length; a += 1) {
      for (let b = a + 1; b < intersections.length; b += 1) {
        const distanceSq = intersections[a].distanceToSquared(intersections[b]);
        if (distanceSq > farthestSq) {
          farthestSq = distanceSq;
          first = intersections[a];
          second = intersections[b];
        }
      }
    }
    if (farthestSq <= 1e-14) continue;
    const to2D = (value: THREE.Vector3): THREE.Vector2 => {
      relative.copy(value).sub(centre);
      return new THREE.Vector2(relative.dot(around), relative.dot(outward));
    };
    segments.push([to2D(first), to2D(second)]);
  }
  return segments;
}

function connectedPlaneComponents(
  segments: readonly [THREE.Vector2, THREE.Vector2][],
): THREE.Vector2[][] {
  const toleranceM = 0.00015;
  const keyFor = (point: THREE.Vector2) => `${Math.round(point.x / toleranceM)}:${Math.round(point.y / toleranceM)}`;
  const points = new Map<string, { sum: THREE.Vector2; count: number }>();
  const adjacency = new Map<string, Set<string>>();
  const addPoint = (key: string, point: THREE.Vector2) => {
    const current = points.get(key);
    if (current) {
      current.sum.add(point);
      current.count += 1;
    } else {
      points.set(key, { sum: point.clone(), count: 1 });
    }
    if (!adjacency.has(key)) adjacency.set(key, new Set());
  };
  for (const [a, b] of segments) {
    const ka = keyFor(a);
    const kb = keyFor(b);
    if (ka === kb) continue;
    addPoint(ka, a);
    addPoint(kb, b);
    adjacency.get(ka)!.add(kb);
    adjacency.get(kb)!.add(ka);
  }
  const components: THREE.Vector2[][] = [];
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const stack = [start];
    const keys: string[] = [];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      keys.push(key);
      for (const next of adjacency.get(key) ?? []) if (!visited.has(next)) stack.push(next);
    }
    components.push(keys.map((key) => {
      const entry = points.get(key)!;
      return entry.sum.clone().multiplyScalar(1 / entry.count);
    }));
  }
  return components;
}

function polygonContainsOrigin(points: readonly THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const intersects = (a.y > 0) !== (b.y > 0)
      && 0 < (b.x - a.x) * (-a.y) / ((b.y - a.y) || 1e-12) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polylineCircumference(points: readonly THREE.Vector2[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    total += points[index].distanceTo(points[(index + 1) % points.length]);
  }
  return total;
}

function buildClosedPolylineArcTable(
  points: readonly THREE.Vector2[],
): { cumulativeM: Float64Array; circumferenceM: number } | null {
  if (points.length < 3) return null;
  const cumulativeM = new Float64Array(points.length + 1);
  for (let index = 0; index < points.length; index += 1) {
    cumulativeM[index + 1] = cumulativeM[index] + points[index].distanceTo(points[(index + 1) % points.length]);
  }
  const circumferenceM = cumulativeM[points.length];
  return Number.isFinite(circumferenceM) && circumferenceM > 1e-6
    ? { cumulativeM, circumferenceM }
    : null;
}

function bodyWrapProfilePointAtSignedArc(profile: ExactBodyWrapProfile, signedArcM: number): THREE.Vector2 {
  let target = signedArcM % profile.circumferenceM;
  if (target < 0) target += profile.circumferenceM;
  let low = 0;
  let high = profile.points.length;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (profile.cumulativeM[middle] <= target) low = middle;
    else high = middle;
  }
  const start = profile.points[low % profile.points.length];
  const end = profile.points[(low + 1) % profile.points.length];
  const span = profile.cumulativeM[low + 1] - profile.cumulativeM[low];
  const ratio = span > 1e-12 ? (target - profile.cumulativeM[low]) / span : 0;
  return start.clone().lerp(end, ratio);
}
'''
    text = text[:start] + replacement + text[end:]
    step0_path.write_text(text, encoding="utf-8")

viewport_path = Path("apps/web/src/viewport/GlobalThreeViewport.ts")
viewport = viewport_path.read_text(encoding="utf-8")
needle = '          bodyFit,\n        },\n      );'
if needle in viewport and '          bodyFit,\n          body,\n        },\n      );' not in viewport:
    viewport = viewport.replace(needle, '          bodyFit,\n          body,\n        },\n      );', 1)
    viewport_path.write_text(viewport, encoding="utf-8")

print("Applied exact visual-body cross-section STEP-0 profile patch")
