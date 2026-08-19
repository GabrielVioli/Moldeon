from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"expected one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_section(path: str, start: str, end: str, replacement: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    first = text.find(start)
    if first < 0:
        raise RuntimeError(f"start marker missing in {path}")
    last = text.find(end, first)
    if last < 0:
        raise RuntimeError(f"end marker missing in {path}")
    target.write_text(text[:first] + replacement + text[last:], encoding="utf-8")


replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  contactRegionIndex: Int16Array;\n  normalImpulseSpeed: Float32Array;\n''',
    '''  contactRegionIndex: Int16Array;\n  normalImpulseSpeed: Float32Array;\n  pointCandidateIndices: Uint16Array;\n  pointCandidateCounts: Uint16Array;\n  sweptCandidateIndices: Uint16Array;\n  sweptCandidateCounts: Uint16Array;\n  contactSurfacePoints: Float32Array;\n  contactPenetrations: Float32Array;\n  contactSwept: Uint8Array;\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  bodyContactsByRegion: Record<string, number>;\n}\n''',
    '''  bodyContactsByRegion: Record<string, number>;\n  broadphaseMs: number;\n  narrowphaseMs: number;\n  projectionMs: number;\n  frictionMs: number;\n}\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''    contactRegionIndex: new Int16Array(particleHalfThicknessM.length).fill(-1),\n    normalImpulseSpeed: new Float32Array(particleHalfThicknessM.length),\n    contactSkinM,\n''',
    '''    contactRegionIndex: new Int16Array(particleHalfThicknessM.length).fill(-1),\n    normalImpulseSpeed: new Float32Array(particleHalfThicknessM.length),\n    pointCandidateIndices: new Uint16Array(particleHalfThicknessM.length * Math.max(1, colliders.kinds.length)),\n    pointCandidateCounts: new Uint16Array(particleHalfThicknessM.length),\n    sweptCandidateIndices: new Uint16Array(particleHalfThicknessM.length * Math.max(1, colliders.kinds.length)),\n    sweptCandidateCounts: new Uint16Array(particleHalfThicknessM.length),\n    contactSurfacePoints: new Float32Array(particleHalfThicknessM.length * 3),\n    contactPenetrations: new Float32Array(particleHalfThicknessM.length),\n    contactSwept: new Uint8Array(particleHalfThicknessM.length),\n    contactSkinM,\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''    bodyContactsByRegion: {},\n  };\n}\n''',
    '''    bodyContactsByRegion: {},\n    broadphaseMs: 0,\n    narrowphaseMs: 0,\n    projectionMs: 0,\n    frictionMs: 0,\n  };\n}\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  body.normalImpulseSpeed.fill(0);\n  body.bodyContactCount = 0;\n''',
    '''  body.normalImpulseSpeed.fill(0);\n  body.pointCandidateCounts.fill(0);\n  body.sweptCandidateCounts.fill(0);\n  body.contactPenetrations.fill(0);\n  body.contactSwept.fill(0);\n  body.bodyContactCount = 0;\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  body.bodyContactsByRegion = {};\n}\n''',
    '''  body.bodyContactsByRegion = {};\n  body.broadphaseMs = 0;\n  body.narrowphaseMs = 0;\n  body.projectionMs = 0;\n  body.frictionMs = 0;\n}\n''',
)

replace_section(
    "apps/web/src/physics/bodyCollision.ts",
    "export function solveBodyCollisions(input: BodyCollisionSolveInput): void {",
    "export function finalizeBodyContactDiagnostics",
    '''export function solveBodyCollisions(input: BodyCollisionSolveInput): void {
  const { body } = input;
  if (!body.enabled || body.colliders.kinds.length === 0) return;
  const particleCount = input.predictedPositions.length / 3;
  const colliderCount = body.colliders.kinds.length;
  if (body.particleHalfThicknessM.length !== particleCount || body.particleFriction.length !== particleCount) {
    throw new RangeError("Body collision particle buffers não correspondem ao garment state.");
  }
  if (input.velocities && input.velocities.length !== input.predictedPositions.length) {
    throw new RangeError("Body collision velocity buffer não corresponde ao garment state.");
  }
  if (body.pointCandidateIndices.length < particleCount * colliderCount || body.sweptCandidateIndices.length < particleCount * colliderCount) {
    throw new RangeError("Body collision broadphase buffers não correspondem ao collider set.");
  }

  let phaseStarted = performance.now();
  for (let particle = 0; particle < particleCount; particle += 1) {
    body.pointCandidateCounts[particle] = 0;
    body.sweptCandidateCounts[particle] = 0;
    if (input.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const point: [number, number, number] = [
      input.predictedPositions[offset],
      input.predictedPositions[offset + 1],
      input.predictedPositions[offset + 2],
    ];
    const previous: [number, number, number] = [
      input.previousPositions[offset],
      input.previousPositions[offset + 1],
      input.previousPositions[offset + 2],
    ];
    const radius = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const base = particle * colliderCount;
    let pointCount = 0;
    let sweptCount = 0;
    for (let collider = 0; collider < colliderCount; collider += 1) {
      if (pointOverlapsPackedColliderAabb(point, body.colliders, collider, radius)) {
        body.pointCandidateIndices[base + pointCount] = collider;
        pointCount += 1;
      }
      if (input.allowSwept && segmentOverlapsPackedColliderAabb(previous, point, body.colliders, collider, radius)) {
        body.sweptCandidateIndices[base + sweptCount] = collider;
        sweptCount += 1;
      }
    }
    body.pointCandidateCounts[particle] = pointCount;
    body.sweptCandidateCounts[particle] = sweptCount;
  }
  body.broadphaseMs = performance.now() - phaseStarted;

  phaseStarted = performance.now();
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (input.inverseMasses[particle] <= 0) continue;
    const offset = particle * 3;
    const point: [number, number, number] = [
      input.predictedPositions[offset],
      input.predictedPositions[offset + 1],
      input.predictedPositions[offset + 2],
    ];
    const previous: [number, number, number] = [
      input.previousPositions[offset],
      input.previousPositions[offset + 1],
      input.previousPositions[offset + 2],
    ];
    const radius = body.particleHalfThicknessM[particle] + body.contactSkinM;
    const base = particle * colliderCount;
    let contact: BodyContactQuery | null = null;
    for (let candidate = 0; candidate < body.pointCandidateCounts[particle]; candidate += 1) {
      const colliderIndex = body.pointCandidateIndices[base + candidate];
      const queried = queryPackedColliderNarrowphase(point, body.colliders, colliderIndex, radius);
      if (queried && (!contact || queried.penetrationM > contact.penetrationM)) contact = queried;
    }
    if (!contact && input.allowSwept) {
      let earliest: (BodyContactQuery & { t: number }) | null = null;
      for (let candidate = 0; candidate < body.sweptCandidateCounts[particle]; candidate += 1) {
        const colliderIndex = body.sweptCandidateIndices[base + candidate];
        const queried = sweptPackedCollider(previous, point, body.colliders, colliderIndex, radius);
        if (queried && (!earliest || queried.t < earliest.t)) earliest = queried;
      }
      if (earliest) {
        const { t: _t, ...sweptContact } = earliest;
        contact = sweptContact;
      }
    }
    if (!contact) continue;
    body.contactMask[particle] = 1;
    body.contactRegionIndex[particle] = contact.colliderIndex;
    body.contactNormals[offset] = contact.normal[0];
    body.contactNormals[offset + 1] = contact.normal[1];
    body.contactNormals[offset + 2] = contact.normal[2];
    body.contactSurfacePoints[offset] = contact.surfacePoint[0];
    body.contactSurfacePoints[offset + 1] = contact.surfacePoint[1];
    body.contactSurfacePoints[offset + 2] = contact.surfacePoint[2];
    body.contactPenetrations[particle] = contact.penetrationM;
    body.contactSwept[particle] = contact.swept ? 1 : 0;
  }
  body.narrowphaseMs = performance.now() - phaseStarted;

  phaseStarted = performance.now();
  for (let particle = 0; particle < particleCount; particle += 1) {
    if (!body.contactMask[particle]) continue;
    const offset = particle * 3;
    const pointX = input.predictedPositions[offset];
    const pointY = input.predictedPositions[offset + 1];
    const pointZ = input.predictedPositions[offset + 2];
    const previousX = input.previousPositions[offset];
    const previousY = input.previousPositions[offset + 1];
    const previousZ = input.previousPositions[offset + 2];
    const penetrationM = body.contactPenetrations[particle];
    const swept = body.contactSwept[particle] === 1;
    body.maximumBodyPenetrationM = Math.max(body.maximumBodyPenetrationM, penetrationM);

    let correctionX = body.contactSurfacePoints[offset] - pointX;
    let correctionY = body.contactSurfacePoints[offset + 1] - pointY;
    let correctionZ = body.contactSurfacePoints[offset + 2] - pointZ;
    let correction = Math.hypot(correctionX, correctionY, correctionZ);
    const localLimit = Math.max(
      1e-6,
      Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM),
    );
    const grossPenetration = body.grossDepenetrationEnabled && !swept && penetrationM > localLimit;
    const limit = swept
      ? body.grossDepenetrationEnabled ? input.maximumCorrectionM : localLimit
      : grossPenetration ? input.maximumCorrectionM : localLimit;
    if (correction > limit) {
      const scale = limit / correction;
      correctionX *= scale;
      correctionY *= scale;
      correctionZ *= scale;
      correction = limit;
    }
    if (swept) body.sweptContactCount += 1;

    const vx = input.velocities
      ? input.velocities[offset]
      : (pointX - previousX) / Math.max(input.fixedTimeStep, EPSILON);
    const vy = input.velocities
      ? input.velocities[offset + 1]
      : (pointY - previousY) / Math.max(input.fixedTimeStep, EPSILON);
    const vz = input.velocities
      ? input.velocities[offset + 2]
      : (pointZ - previousZ) / Math.max(input.fixedTimeStep, EPSILON);
    const nx = body.contactNormals[offset];
    const ny = body.contactNormals[offset + 1];
    const nz = body.contactNormals[offset + 2];
    const inwardSpeed = Math.max(0, -(vx * nx + vy * ny + vz * nz));

    input.predictedPositions[offset] += correctionX;
    input.predictedPositions[offset + 1] += correctionY;
    input.predictedPositions[offset + 2] += correctionZ;
    body.contactCorrections[offset] += correctionX;
    body.contactCorrections[offset + 1] += correctionY;
    body.contactCorrections[offset + 2] += correctionZ;
    body.maximumBodyCorrectionM = Math.max(body.maximumBodyCorrectionM, correction);
    const settledContactImpulseSpeed = !swept && !grossPenetration
      ? correction / Math.max(input.fixedTimeStep, EPSILON)
      : 0;
    body.normalImpulseSpeed[particle] = Math.max(
      body.normalImpulseSpeed[particle],
      inwardSpeed,
      settledContactImpulseSpeed,
    );
  }
  body.projectionMs = performance.now() - phaseStarted;
}

''',
)

body = Path("apps/web/src/physics/bodyCollision.ts")
text = body.read_text(encoding="utf-8")
marker = '''export function queryPackedCollider(\n'''
helper = '''function queryPackedColliderNarrowphase(\n  point: readonly [number, number, number],\n  colliders: PackedBodyColliders,\n  colliderIndex: number,\n  particleRadiusM = 0,\n): BodyContactQuery | null {\n  const offset = colliderIndex * BODY_COLLIDER_STRIDE;\n  const region = colliders.regions[colliderIndex] ?? "unknown";\n  const kind = colliders.kinds[colliderIndex];\n  if (kind === BODY_COLLIDER_ELLIPSOID) {\n    return pointEllipsoidContact(\n      point,\n      [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]],\n      [colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]],\n      particleRadiusM,\n      colliderIndex,\n      region,\n    );\n  }\n  if (kind === BODY_COLLIDER_CAPSULE) {\n    return pointCapsuleContact(\n      point,\n      [colliders.data[offset], colliders.data[offset + 1], colliders.data[offset + 2]],\n      [colliders.data[offset + 3], colliders.data[offset + 4], colliders.data[offset + 5]],\n      colliders.data[offset + 6] + particleRadiusM,\n      colliderIndex,\n      region,\n    );\n  }\n  return null;\n}\n\n'''
if text.count(marker) != 1:
    raise RuntimeError(f"narrowphase helper marker mismatch: {text.count(marker)}")
body.write_text(text.replace(marker, helper + marker, 1), encoding="utf-8")

replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''export function applyBodyContactVelocities(\n  velocities: Float32Array,\n  body: BodyCollisionRuntimeState,\n  fixedTimeStep = 1,\n): void {\n  body.frictionContactCount = 0;\n''',
    '''export function applyBodyContactVelocities(\n  velocities: Float32Array,\n  body: BodyCollisionRuntimeState,\n  fixedTimeStep = 1,\n): void {\n  const phaseStarted = performance.now();\n  body.frictionContactCount = 0;\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''    if (friction > 0 && body.normalImpulseSpeed[particle] > 0) body.frictionContactCount += 1;\n  }\n}\n''',
    '''    if (friction > 0 && body.normalImpulseSpeed[particle] > 0) body.frictionContactCount += 1;\n  }\n  body.frictionMs = performance.now() - phaseStarted;\n}\n''',
)

replace_once(
    "apps/web/src/physics/xpbd.ts",
    '''  bodyCollisionMs?: number;\n  iterations?: number;\n''',
    '''  bodyCollisionMs?: number;\n  bodyBroadphaseMs?: number;\n  bodyNarrowphaseMs?: number;\n  bodyProjectionMs?: number;\n  bodyFrictionMs?: number;\n  bodyDressingStepsRemaining?: number;\n  bodyInitialDressingSteps?: number;\n  iterations?: number;\n''',
)
replace_once(
    "apps/web/src/physics/xpbd.ts",
    '''    bodyCollisionMs: state.profile.bodyCollisionMs,\n    iterations: state.config.iterations,\n''',
    '''    bodyCollisionMs: state.profile.bodyCollisionMs,\n    bodyBroadphaseMs: state.body.broadphaseMs,\n    bodyNarrowphaseMs: state.body.narrowphaseMs,\n    bodyProjectionMs: state.body.projectionMs,\n    bodyFrictionMs: state.body.frictionMs,\n    bodyDressingStepsRemaining: state.body.dressingStepsRemaining,\n    bodyInitialDressingSteps: state.body.initialDressingSteps,\n    iterations: state.config.iterations,\n''',
)

replace_once(
    "apps/web/src/viewport/GarmentViewport.tsx",
    '''            <dt>Body collision ms</dt><dd>{formatMetric(telemetry?.bodyCollisionMs)}</dd>\n            <dt>Friction contacts</dt><dd>{telemetry?.frictionContactCount ?? 0}</dd>\n''',
    '''            <dt>Body collision ms</dt><dd>{formatMetric(telemetry?.bodyCollisionMs)}</dd>\n            <dt>Body broadphase ms</dt><dd>{formatMetric(telemetry?.bodyBroadphaseMs)}</dd>\n            <dt>Body narrowphase ms</dt><dd>{formatMetric(telemetry?.bodyNarrowphaseMs)}</dd>\n            <dt>Body projection ms</dt><dd>{formatMetric(telemetry?.bodyProjectionMs)}</dd>\n            <dt>Body friction ms</dt><dd>{formatMetric(telemetry?.bodyFrictionMs)}</dd>\n            <dt>Dressing steps</dt><dd>{telemetry?.bodyDressingStepsRemaining ?? 0} / {telemetry?.bodyInitialDressingSteps ?? 0}</dd>\n            <dt>Friction contacts</dt><dd>{telemetry?.frictionContactCount ?? 0}</dd>\n''',
)
