from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"expected exactly one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_section(path: str, start: str, end: str, replacement: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    first = text.find(start)
    if first < 0:
        raise RuntimeError(f"start marker not found in {path}: {start[:60]}")
    last = text.find(end, first)
    if last < 0:
        raise RuntimeError(f"end marker not found in {path}: {end[:60]}")
    target.write_text(text[:first] + replacement + text[last:], encoding="utf-8")


# Remove the Prompt 11 emergency support pins. Explicit assembly anchors remain
# available to callers, but body registration no longer freezes sampled garment
# boundaries into a membrane.
replace_once(
    "apps/web/src/physics/GarmentXpbdAdapter.ts",
    '''  if (options.pinAssemblyAnchors === true) {\n    const seenPins = new Set<number>();\n    const appendPin = (particleIndex: number, x: number, y: number, z: number) => {\n      if (seenPins.has(particleIndex)) return;\n      seenPins.add(particleIndex);\n      pinIndices.push(particleIndex);\n      pinTargets.push(x, y, z);\n      inverseMasses[particleIndex] = 0;\n    };\n\n    for (const anchor of state.anchorConstraints) {\n      appendPin(anchor.particleIndex, anchor.targetX, anchor.targetY, anchor.targetZ);\n    }\n    for (const instance of state.instances) {\n      if (instance.placement.region === "custom" || instance.placement.surface === "custom") continue;\n      for (const localIndex of selectInstanceSupportVertices(instance)) {\n        const particleIndex = instance.particleStart + localIndex;\n        appendPin(\n          particleIndex,\n          positions[particleIndex * 3],\n          positions[particleIndex * 3 + 1],\n          positions[particleIndex * 3 + 2],\n        );\n      }\n    }\n  }\n''',
    '''  if (options.pinAssemblyAnchors === true) {\n    const seenPins = new Set<number>();\n    for (const anchor of state.anchorConstraints) {\n      if (seenPins.has(anchor.particleIndex)) continue;\n      seenPins.add(anchor.particleIndex);\n      pinIndices.push(anchor.particleIndex);\n      pinTargets.push(anchor.targetX, anchor.targetY, anchor.targetZ);\n      inverseMasses[anchor.particleIndex] = 0;\n    }\n  }\n''',
)

replace_section(
    "apps/web/src/physics/GarmentXpbdAdapter.ts",
    "function selectInstanceSupportVertices(",
    "export function xpbdInitializationTransferables",
    "export function xpbdInitializationTransferables",
)

# Body registration must not silently multiply the XPBD solver budget. The body
# is an inequality projection, not a reason to pin the garment or triple all
# stretch/shear/bend/seam iterations.
replace_once(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    '''        bodyCollisionEnabled: registration.status === "registered" && this.devSettings.bodyCollisionEnabled,\n        pinAssemblyAnchors: registration.status === "registered",\n        config: {\n          gravity: this.scaledGravity(),\n          maximumSubsteps: settings.substeps,\n          iterations: registration.status === "registered" ? Math.max(settings.iterations, 24) : settings.iterations,\n          ...(registration.status === "registered" ? { maximumVelocity: 1 } : {}),\n        },\n''',
    '''        bodyCollisionEnabled: registration.status === "registered" && this.devSettings.bodyCollisionEnabled,\n        config: {\n          gravity: this.scaledGravity(),\n          maximumSubsteps: settings.substeps,\n          iterations: settings.iterations,\n        },\n''',
)

# Replace centroid-to-anchor registration for a confirmed closed lower shell.
# A skirt/trouser shell is registered by its upper world extent to the avatar
# waist plane and by its assembled X/Z center to the avatar centerline. This is
# semantic (hip/waist + opposing front/back surfaces), never a garment-name rule.
Path("apps/web/src/physics/BodyCollisionRegistration.ts").write_text('''import { resolveAvatarAnchor, type AvatarParametricModel } from "../avatar/AvatarParametricModel";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { IDENTITY_BODY_TRANSFORM, type SimulationBodyTransform } from "./bodyCollision";

export type BodyRegistrationStatus = "registered" | "body-placement-required";

export interface SimulationBodyRegistration {
  status: BodyRegistrationStatus;
  transform: SimulationBodyTransform;
  source: "placement-anchors" | "lower-shell-top-plane" | "unavailable";
  registeredInstanceIds: string[];
  residualMeanM: number;
  residualMaxM: number;
  warning?: string;
}

interface RegistrationPair {
  instanceId: string;
  region: string;
  surface: string;
  neutralPlacement: boolean;
  garment: [number, number, number];
  body: [number, number, number];
}

/**
 * Registers the static parametric body into the coarse/fine garment world.
 *
 * Body placement stays separate from assembly and collision. Confirmed closed
 * lower shells use their assembled upper plane as the waist reference; other
 * placements retain the generic anchor fit. No garment/template name is read.
 */
export function resolveSimulationBodyRegistration(
  state: Pick<GarmentAssemblyState, "positions" | "instances">,
  avatar: AvatarParametricModel,
): SimulationBodyRegistration {
  const correspondences: RegistrationPair[] = [];

  for (const instance of state.instances) {
    if (instance.placement.region === "custom" || instance.placement.surface === "custom") continue;
    const anchor = resolveAvatarAnchor(avatar, instance.placement);
    if (!anchor) continue;
    const garment = instanceCentroid(state.positions, instance.particleStart, instance.vertexCount);
    const body: [number, number, number] = [
      anchor.position[0] + instance.placement.offsetXMm * 0.001,
      anchor.position[1] + instance.placement.offsetYMm * 0.001,
      anchor.position[2] + instance.placement.offsetZMm * 0.001,
    ];
    correspondences.push({
      instanceId: instance.id,
      region: instance.placement.region,
      surface: instance.placement.surface,
      neutralPlacement: instance.placement.offsetXMm === 0
        && instance.placement.offsetYMm === 0
        && instance.placement.offsetZMm === 0
        && instance.placement.rotationDeg === 0,
      garment,
      body,
    });
  }

  if (correspondences.length === 0) {
    return {
      status: "body-placement-required",
      transform: IDENTITY_BODY_TRANSFORM,
      source: "unavailable",
      registeredInstanceIds: [],
      residualMeanM: 0,
      residualMaxM: 0,
      warning: "body-placement-required: o documento não possui placement corporal confirmado suficiente para registrar corpo e roupa.",
    };
  }

  const surfaces = new Set(correspondences.map((pair) => pair.surface));
  const isClosedLowerShell = correspondences.length >= 2
    && correspondences.every((pair) => (pair.region === "hip" || pair.region === "waist") && pair.neutralPlacement)
    && surfaces.has("front")
    && surfaces.has("back");
  if (isClosedLowerShell) return registerClosedLowerShell(state, avatar, correspondences);

  return registerByPlacementAnchors(correspondences);
}

function registerClosedLowerShell(
  state: Pick<GarmentAssemblyState, "positions" | "instances">,
  avatar: AvatarParametricModel,
  correspondences: readonly RegistrationPair[],
): SimulationBodyRegistration {
  const registered = new Set(correspondences.map((pair) => pair.instanceId));
  let sumX = 0;
  let sumZ = 0;
  let particleCount = 0;
  let garmentTopY = Number.NEGATIVE_INFINITY;
  const instanceTopY: number[] = [];

  for (const instance of state.instances) {
    if (!registered.has(instance.id)) continue;
    let topY = Number.NEGATIVE_INFINITY;
    for (let local = 0; local < instance.vertexCount; local += 1) {
      const offset = (instance.particleStart + local) * 3;
      sumX += state.positions[offset];
      sumZ += state.positions[offset + 2];
      particleCount += 1;
      topY = Math.max(topY, state.positions[offset + 1]);
    }
    if (Number.isFinite(topY)) {
      instanceTopY.push(topY);
      garmentTopY = Math.max(garmentTopY, topY);
    }
  }

  const count = Math.max(1, particleCount);
  const translation: [number, number, number] = [
    sumX / count,
    garmentTopY - avatar.landmarks.waistY,
    sumZ / count,
  ];
  const registeredWaistY = avatar.landmarks.waistY + translation[1];
  const residuals = instanceTopY.map((topY) => Math.abs(topY - registeredWaistY));

  return {
    status: "registered",
    transform: { translation, rotation: [0, 0, 0, 1] },
    source: "lower-shell-top-plane",
    registeredInstanceIds: correspondences.map((pair) => pair.instanceId),
    residualMeanM: residuals.length > 0 ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length : 0,
    residualMaxM: residuals.length > 0 ? Math.max(...residuals) : 0,
  };
}

function registerByPlacementAnchors(correspondences: readonly RegistrationPair[]): SimulationBodyRegistration {
  const translation: [number, number, number] = [0, 0, 0];
  for (const pair of correspondences) {
    translation[0] += pair.garment[0] - pair.body[0];
    translation[1] += pair.garment[1] - pair.body[1];
    translation[2] += pair.garment[2] - pair.body[2];
  }
  translation[0] /= correspondences.length;
  translation[1] /= correspondences.length;
  translation[2] /= correspondences.length;

  let residualTotal = 0;
  let residualMaxM = 0;
  for (const pair of correspondences) {
    const dx = pair.body[0] + translation[0] - pair.garment[0];
    const dy = pair.body[1] + translation[1] - pair.garment[1];
    const dz = pair.body[2] + translation[2] - pair.garment[2];
    const residual = Math.hypot(dx, dy, dz);
    residualTotal += residual;
    residualMaxM = Math.max(residualMaxM, residual);
  }

  return {
    status: "registered",
    transform: { translation, rotation: [0, 0, 0, 1] },
    source: "placement-anchors",
    registeredInstanceIds: correspondences.map((pair) => pair.instanceId),
    residualMeanM: residualTotal / correspondences.length,
    residualMaxM,
  };
}

function instanceCentroid(
  positions: Float32Array,
  particleStart: number,
  vertexCount: number,
): [number, number, number] {
  const centroid: [number, number, number] = [0, 0, 0];
  const count = Math.max(1, vertexCount);
  for (let local = 0; local < vertexCount; local += 1) {
    const offset = (particleStart + local) * 3;
    centroid[0] += positions[offset];
    centroid[1] += positions[offset + 1];
    centroid[2] += positions[offset + 2];
  }
  return [centroid[0] / count, centroid[1] / count, centroid[2] / count];
}
''', encoding="utf-8")

# Static positional depenetration must not be interpreted as Coulomb impulse.
# Gross overlaps may use the existing global correction cap instead of the tiny
# structural per-particle trust region; shallow contacts keep that local limit.
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  fixedTimeStep: number;\n  body: BodyCollisionRuntimeState;\n''',
    '''  fixedTimeStep: number;\n  velocities?: Float32Array;\n  body: BodyCollisionRuntimeState;\n''',
)

replace_section(
    "apps/web/src/physics/bodyCollision.ts",
    "export function solveBodyCollisions(input: BodyCollisionSolveInput): void {",
    "export function finalizeBodyContactDiagnostics",
    '''export function solveBodyCollisions(input: BodyCollisionSolveInput): void {
  const { body } = input;
  if (!body.enabled || body.colliders.kinds.length === 0) return;
  const particleCount = input.predictedPositions.length / 3;
  if (body.particleHalfThicknessM.length !== particleCount || body.particleFriction.length !== particleCount) {
    throw new RangeError("Body collision particle buffers não correspondem ao garment state.");
  }
  if (input.velocities && input.velocities.length !== input.predictedPositions.length) {
    throw new RangeError("Body collision velocity buffer não corresponde ao garment state.");
  }

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
    let contact = deepestBodyContact(point, body.colliders, radius);
    if (!contact && input.allowSwept) contact = earliestSweptBodyContact(previous, point, body.colliders, radius);
    if (!contact) continue;

    body.maximumBodyPenetrationM = Math.max(body.maximumBodyPenetrationM, contact.penetrationM);
    let correctionX = contact.surfacePoint[0] - point[0];
    let correctionY = contact.surfacePoint[1] - point[1];
    let correctionZ = contact.surfacePoint[2] - point[2];
    let correction = Math.hypot(correctionX, correctionY, correctionZ);
    if (!contact.swept) {
      const localLimit = Math.max(1e-6, Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM));
      const limit = contact.penetrationM > localLimit ? input.maximumCorrectionM : localLimit;
      if (correction > limit) {
        const scale = limit / correction;
        correctionX *= scale;
        correctionY *= scale;
        correctionZ *= scale;
        correction = limit;
      }
    } else {
      const maximumSweepCorrection = Math.max(input.maximumCorrectionM, 12 * input.fixedTimeStep);
      if (correction > maximumSweepCorrection) {
        const scale = maximumSweepCorrection / correction;
        correctionX *= scale;
        correctionY *= scale;
        correctionZ *= scale;
        correction = maximumSweepCorrection;
      }
      body.sweptContactCount += 1;
    }

    const vx = input.velocities
      ? input.velocities[offset]
      : (point[0] - previous[0]) / Math.max(input.fixedTimeStep, EPSILON);
    const vy = input.velocities
      ? input.velocities[offset + 1]
      : (point[1] - previous[1]) / Math.max(input.fixedTimeStep, EPSILON);
    const vz = input.velocities
      ? input.velocities[offset + 2]
      : (point[2] - previous[2]) / Math.max(input.fixedTimeStep, EPSILON);
    const inwardSpeed = Math.max(0, -(vx * contact.normal[0] + vy * contact.normal[1] + vz * contact.normal[2]));

    input.predictedPositions[offset] += correctionX;
    input.predictedPositions[offset + 1] += correctionY;
    input.predictedPositions[offset + 2] += correctionZ;
    body.maximumBodyCorrectionM = Math.max(body.maximumBodyCorrectionM, correction);
    body.contactMask[particle] = 1;
    body.contactRegionIndex[particle] = contact.colliderIndex;
    body.contactNormals[offset] = contact.normal[0];
    body.contactNormals[offset + 1] = contact.normal[1];
    body.contactNormals[offset + 2] = contact.normal[2];
    body.normalImpulseSpeed[particle] = Math.max(body.normalImpulseSpeed[particle], inwardSpeed);
  }
}

''',
)

# Solve structural XPBD at the document-requested iteration count, then project
# the body inequality once. Body cost is therefore independent from stretch /
# shear / bend iteration tuning and cannot accidentally multiply 24x.
replace_once(
    "apps/web/src/physics/xpbd.ts",
    '''  for (let iteration = 0; iteration < state.config.iterations; iteration += 1) {\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now();\n    solveBodyCollisions({ predictedPositions: state.predictedPositions, previousPositions: state.previousPositions, inverseMasses: state.inverseMasses, correctionLimits: state.correctionLimits, maximumCorrectionM: state.config.maximumCorrection, fixedTimeStep: dt, body: state.body, allowSwept: iteration === 0 });\n    profile.bodyCollisionMs += performance.now() - phaseStarted;\n    enforcePins(state);\n  }\n\n  finalizeBodyContactDiagnostics(state.body);\n''',
    '''  for (let iteration = 0; iteration < state.config.iterations; iteration += 1) {\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n    enforcePins(state);\n  }\n\n  phaseStarted = performance.now();\n  solveBodyCollisions({ predictedPositions: state.predictedPositions, previousPositions: state.previousPositions, velocities: state.velocities, inverseMasses: state.inverseMasses, correctionLimits: state.correctionLimits, maximumCorrectionM: state.config.maximumCorrection, fixedTimeStep: dt, body: state.body, allowSwept: true });\n  profile.bodyCollisionMs = performance.now() - phaseStarted;\n  enforcePins(state);\n  finalizeBodyContactDiagnostics(state.body);\n''',
)
