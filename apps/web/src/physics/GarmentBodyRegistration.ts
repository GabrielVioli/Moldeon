import {
  resolveAvatarAnchor,
  type AvatarParametricModel,
  type AvatarVector3,
} from "../avatar/AvatarParametricModel";
import { HUMAN_BODY_FRAME } from "../avatar/HumanBodyModel";
import type {
  AssemblyPanelInstance,
  GarmentAssemblyState,
} from "../garment3d/GarmentAssembly";
import { classifyCoarseStitch } from "../garment3d/CoarseSeamConstraints";
import type { SimulationBodyTransform } from "./bodyCollision";

const EPSILON = 1e-9;
const METERS_PER_MM = 0.001;

export type GarmentRegistrationStatus = "registered" | "body-placement-required";

export interface GarmentRegistrationIslandTransform {
  instanceIds: string[];
  transform: SimulationBodyTransform;
  source: "semantic-body-placement";
}

export interface GarmentRegistrationDiagnostic {
  status: GarmentRegistrationStatus;
  source: "semantic-body-placement" | "semantic-structural-islands" | "unavailable";
  transform: SimulationBodyTransform;
  islandTransforms: GarmentRegistrationIslandTransform[];
  garmentForward: AvatarVector3;
  garmentUp: AvatarVector3;
  garmentRight: AvatarVector3;
  bodyForward: AvatarVector3;
  bodyUp: AvatarVector3;
  bodyRight: AvatarVector3;
  registrationRotationDeg: AvatarVector3;
  registrationTranslationMm: AvatarVector3;
  registrationDeterminant: number;
  registeredInstanceIds: string[];
  structuralIslandCount: number;
  registrationIslandCount: number;
  panelOutwardConsistency: number;
  flippedPanelCount: number;
  negativeTransformCount: number;
  residualMeanM: number;
  residualMaxM: number;
  registrationAmbiguities: string[];
  warning?: string;
}

interface SemanticSample {
  instance: AssemblyPanelInstance;
  centroid: AvatarVector3;
  materialUp: AvatarVector3;
  geometricNormal: AvatarVector3 | null;
  targetCentroid: AvatarVector3;
  targetOutward: AvatarVector3;
  targetUp: AvatarVector3;
  weight: number;
}

/**
 * Resolves one proper rigid transform from the assembled material frame into
 * the canonical anatomical frame. The body stays fixed. No scale, reflection,
 * template name or camera state participates in this operation.
 */
export function resolveGarmentBodyRegistration(
  state: Pick<GarmentAssemblyState, "positions" | "instances" | "stitchConstraints">,
  avatar: AvatarParametricModel,
): GarmentRegistrationDiagnostic {
  const samples = state.instances.flatMap((instance) => {
    if (instance.placement.region === "custom" || instance.placement.surface === "custom") return [];
    const anchor = resolveAvatarAnchor(avatar, instance.placement);
    if (!anchor) return [];
    const centroid = instanceCentroid(state.positions, instance);
    const materialUp = materialAxis(state.positions, instance, "up");
    const geometricNormal = instanceMeanTriangleNormal(state.positions, instance);
    const materialCenter = materialCentroid(instance);
    const bounds = instance.topology.boundsMm;
    const acrossM = (materialCenter[0] - (bounds.minX + bounds.maxX) * 0.5)
      * METERS_PER_MM * (instance.placement.mirrorX ? -1 : 1);
    const downM = (materialCenter[1] - bounds.minY) * METERS_PER_MM;
    const rotation = instance.placement.rotationDeg * Math.PI / 180;
    const rotatedAcross = acrossM * Math.cos(rotation) - downM * Math.sin(rotation);
    const rotatedDown = acrossM * Math.sin(rotation) + downM * Math.cos(rotation);
    const targetCentroid = add3(
      semanticAnchorOrigin(avatar, instance, anchor.position),
      add3(
        scale3(
          anchor.tangent,
          semanticAcrossOffsetM(instance, state.instances, rotatedAcross)
            + instance.placement.offsetXMm * METERS_PER_MM,
        ),
        add3(
          scale3(anchor.axis, rotatedDown + instance.placement.offsetYMm * METERS_PER_MM),
          scale3(anchor.outwardNormal, anchor.initialMarginM + instance.placement.offsetZMm * METERS_PER_MM),
        ),
      ),
    );
    const area = Math.max(1, bounds.width * bounds.height);
    return [{
      instance,
      centroid,
      materialUp,
      geometricNormal,
      targetCentroid,
      targetOutward: normalize3(anchor.outwardNormal),
      targetUp: normalize3(scale3(anchor.axis, -1)),
      weight: area,
    } satisfies SemanticSample];
  });

  const ambiguities: string[] = [];
  if (samples.length === 0) {
    ambiguities.push("Nenhuma PanelInstance possui body placement confirmado suficiente para registration.");
    return unavailableDiagnostic(state, ambiguities);
  }

  // Registration is a global shell decision.  Sleeves, cuffs, collars and
  // waistbands are structural dependants and must not rotate a valid torso or
  // lower-body shell merely because their tessellation has more vertices.
  const authoritySamples = selectRegistrationAuthority(samples);

  const sourceUp = weightedDirection(authoritySamples, (sample) => sample.materialUp);
  if (!sourceUp) {
    ambiguities.push("Os placements não definem eixos material/anatômico independentes suficientes.");
    return unavailableDiagnostic(state, ambiguities);
  }
  const sourceForward = deriveGarmentForward(authoritySamples, sourceUp);
  if (!sourceForward) {
    ambiguities.push("Os placements não definem eixos material/anatômico independentes suficientes.");
    return unavailableDiagnostic(state, ambiguities);
  }
  const geometricRight = normalize3(cross3(sourceUp, sourceForward));
  const semanticRight = deriveGarmentRight(authoritySamples, sourceUp, sourceForward);
  if (semanticRight && dot3(geometricRight, semanticRight) < 0.1) {
    ambiguities.push("A pose espacial possui quiralidade incompatível com frente/costas e esquerda/direita.");
    return unavailableDiagnostic(state, ambiguities, 1);
  }
  const sourceRight = semanticRight ?? geometricRight;
  const orthogonalForward = normalize3(cross3(sourceRight, sourceUp));
  if (length3(sourceRight) <= EPSILON || length3(orthogonalForward) <= EPSILON) {
    ambiguities.push("A base semântica do garment é degenerada.");
    return unavailableDiagnostic(state, ambiguities);
  }

  const rotationMatrix = basisRotation(
    sourceRight,
    sourceUp,
    orthogonalForward,
    HUMAN_BODY_FRAME.right,
    HUMAN_BODY_FRAME.up,
    HUMAN_BODY_FRAME.front,
  );
  const determinant = determinant3(rotationMatrix);
  if (!Number.isFinite(determinant) || determinant < 0.999 || determinant > 1.001) {
    ambiguities.push(`A registration exigiria reflection ou escala (det=${determinant}).`);
    return unavailableDiagnostic(state, ambiguities, determinant < 0 ? 1 : 0);
  }
  const quaternion = quaternionFromMatrix(rotationMatrix);

  const shellCentroid = weightedCentroid(authoritySamples)!;
  const rotatedShellCentroid = rotateByQuaternion(shellCentroid, quaternion);
  const rotatedTopY = maximumRegisteredY(state.positions, authoritySamples, quaternion);
  const translation: AvatarVector3 = [
    -rotatedShellCentroid[0],
    registrationTopY(avatar, authoritySamples) - rotatedTopY,
    -rotatedShellCentroid[2],
  ];

  const residuals = authoritySamples.map((sample) => {
    const registered = add3(rotateByQuaternion(sample.centroid, quaternion), translation);
    return distance3(registered, sample.targetCentroid);
  });
  const outwardDots = samples.flatMap((sample) => {
    if (!sample.geometricNormal) return [];
    const registered = rotateByQuaternion(sample.geometricNormal, quaternion);
    return [dot3(registered, sample.targetOutward)];
  });
  const flippedPanelCount = outwardDots.filter((dot) => dot < 0).length;
  const globalTransform = { translation, rotation: quaternion } satisfies SimulationBodyTransform;
  return {
    status: "registered",
    source: "semantic-body-placement",
    transform: globalTransform,
    islandTransforms: [],
    garmentForward: orthogonalForward,
    garmentUp: sourceUp,
    garmentRight: sourceRight,
    bodyForward: [...HUMAN_BODY_FRAME.front],
    bodyUp: [...HUMAN_BODY_FRAME.up],
    bodyRight: [...HUMAN_BODY_FRAME.right],
    registrationRotationDeg: quaternionToEulerDeg(quaternion),
    registrationTranslationMm: scale3(translation, 1000),
    registrationDeterminant: determinant,
    registeredInstanceIds: samples.map((sample) => sample.instance.id),
    structuralIslandCount: countStructuralIslands(state),
    registrationIslandCount: 1,
    // applyGarmentBodyRegistration corrects winding per instance.  This is
    // the consistency of the final rendering/physics contract; the number of
    // raw corrections remains explicit in flippedPanelCount.
    panelOutwardConsistency: 1,
    flippedPanelCount,
    negativeTransformCount: 0,
    residualMeanM: residuals.reduce((sum, value) => sum + value, 0) / Math.max(1, residuals.length),
    residualMaxM: residuals.length > 0 ? Math.max(...residuals) : 0,
    registrationAmbiguities: ambiguities,
  };
}

function selectRegistrationAuthority(samples: readonly SemanticSample[]): SemanticSample[] {
  const byRegion = (region: string) => samples.filter((sample) => sample.instance.placement.region === region);
  for (const region of ["torso", "hip", "leg", "arm", "neck", "waist"]) {
    const candidates = byRegion(region);
    if (candidates.length > 0) return candidates;
  }
  return [...samples];
}

function semanticAnchorOrigin(
  avatar: AvatarParametricModel,
  instance: AssemblyPanelInstance,
  anchorPosition: AvatarVector3,
): AvatarVector3 {
  const origin: AvatarVector3 = [...anchorPosition];
  // Preview anchors describe a surface point.  A material chart, however,
  // starts at its upper boundary.  Aligning a torso chart's minY to the bust
  // anchor placed an otherwise correct bodice one full half-panel too low.
  if (instance.placement.region === "torso") origin[1] = avatar.landmarks.shoulderY;
  else if (instance.placement.region === "hip" || instance.placement.region === "waist") {
    origin[1] = avatar.landmarks.waistY;
  }
  return origin;
}

function registrationTopY(
  avatar: AvatarParametricModel,
  samples: readonly SemanticSample[],
): number {
  const region = samples[0]?.instance.placement.region;
  if (region === "torso" || region === "arm" || region === "neck") return avatar.landmarks.shoulderY;
  if (region === "hip" || region === "waist") return avatar.landmarks.waistY;
  if (region === "leg") return avatar.landmarks.hipY;
  return avatar.landmarks.waistY;
}

function semanticAcrossOffsetM(
  instance: AssemblyPanelInstance,
  instances: readonly AssemblyPanelInstance[],
  fallbackM: number,
): number {
  const siblings = instances.filter((candidate) =>
    candidate.id !== instance.id
    && candidate.pieceId === instance.pieceId
    && candidate.placement.region === instance.placement.region
    && candidate.placement.surface === instance.placement.surface
    && candidate.placement.bodyAnchorId === instance.placement.bodyAnchorId);
  const hasOppositeSide = siblings.some((candidate) =>
    (instance.placement.bodySide === "left" && candidate.placement.bodySide === "right")
    || (instance.placement.bodySide === "right" && candidate.placement.bodySide === "left"));
  if (hasOppositeSide) {
    if (instance.placement.bodySide === "left") return -instance.topology.boundsMm.width * 0.5 * METERS_PER_MM;
    if (instance.placement.bodySide === "right") return instance.topology.boundsMm.width * 0.5 * METERS_PER_MM;
  }
  return fallbackM;
}

function maximumRegisteredY(
  positions: Float32Array,
  samples: readonly SemanticSample[],
  rotation: readonly [number, number, number, number],
): number {
  let maximum = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    for (let local = 0; local < sample.instance.vertexCount; local += 1) {
      const offset = (sample.instance.particleStart + local) * 3;
      const rotated = rotateByQuaternion(
        [positions[offset], positions[offset + 1], positions[offset + 2]],
        rotation,
      );
      maximum = Math.max(maximum, rotated[1]);
    }
  }
  return Number.isFinite(maximum) ? maximum : 0;
}

/** Applies a registration without changing topology or any material rest data. */
export function applyGarmentBodyRegistration(
  state: GarmentAssemblyState,
  diagnostic: GarmentRegistrationDiagnostic,
): void {
  if (diagnostic.status !== "registered") return;
  const { transform } = diagnostic;
  transformPositionBuffer(state.positions, transform);
  transformPositionBuffer(state.initialPositions, transform);
  transformPositionBuffer(state.previousPositions, transform);
  for (const anchor of state.anchorConstraints) {
    const target = transformPoint([anchor.targetX, anchor.targetY, anchor.targetZ], transform);
    anchor.targetX = target[0];
    anchor.targetY = target[1];
    anchor.targetZ = target[2];
  }
  const islandTransformByInstance = new Map(
    diagnostic.islandTransforms.flatMap((island) =>
      island.instanceIds.map((instanceId) => [instanceId, island.transform] as const)),
  );
  for (const instance of state.instances) {
    const islandTransform = islandTransformByInstance.get(instance.id);
    if (!islandTransform) continue;
    transformPositionRange(state.positions, instance, islandTransform);
    transformPositionRange(state.initialPositions, instance, islandTransform);
    transformPositionRange(state.previousPositions, instance, islandTransform);
    for (const anchor of state.anchorConstraints) {
      if (
        anchor.particleIndex < instance.particleStart
        || anchor.particleIndex >= instance.particleStart + instance.vertexCount
      ) continue;
      const target = transformPoint([anchor.targetX, anchor.targetY, anchor.targetZ], islandTransform);
      anchor.targetX = target[0];
      anchor.targetY = target[1];
      anchor.targetZ = target[2];
    }
  }
  for (const instance of state.instances) {
    const islandTransform = islandTransformByInstance.get(instance.id);
    const expected = resolveExpectedOutward(instance, diagnostic, state.positions);
    const geometric = instanceMeanTriangleNormal(state.positions, instance);
    const flipWinding = Boolean(geometric && expected && dot3(geometric, expected) < 0);
    if (instance.arrangement) {
      instance.arrangement.outwardNormal = expected ?? normalize3(geometric ?? diagnostic.bodyForward);
      instance.arrangement.axis = normalize3(materialAxis(state.positions, instance, "down"));
      if (instance.arrangement.tubeCenter) {
        const globallyRegistered = transformPoint(instance.arrangement.tubeCenter, transform);
        instance.arrangement.tubeCenter = islandTransform
          ? transformPoint(globallyRegistered, islandTransform)
          : globallyRegistered;
      }
      instance.arrangement.flipWinding = flipWinding;
    } else {
      const axis = normalize3(materialAxis(state.positions, instance, "down"));
      instance.arrangement = {
        anchorId: instance.placement.bodyAnchorId ?? `semantic:${instance.id}`,
        outwardNormal: expected ?? normalize3(geometric ?? HUMAN_BODY_FRAME.front),
        axis,
        bodySide: instance.placement.bodySide,
        marginM: 0,
        mapping: "rigid-panel",
        flipWinding,
      };
    }
  }
}

function unavailableDiagnostic(
  state: Pick<GarmentAssemblyState, "instances" | "stitchConstraints">,
  ambiguities: string[],
  negativeTransformCount = 0,
): GarmentRegistrationDiagnostic {
  return {
    status: "body-placement-required",
    source: "unavailable",
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0, 1] },
    islandTransforms: [],
    garmentForward: [0, 0, 0],
    garmentUp: [0, 0, 0],
    garmentRight: [0, 0, 0],
    bodyForward: [...HUMAN_BODY_FRAME.front],
    bodyUp: [...HUMAN_BODY_FRAME.up],
    bodyRight: [...HUMAN_BODY_FRAME.right],
    registrationRotationDeg: [0, 0, 0],
    registrationTranslationMm: [0, 0, 0],
    registrationDeterminant: negativeTransformCount > 0 ? -1 : 1,
    registeredInstanceIds: [],
    structuralIslandCount: countStructuralIslands(state),
    registrationIslandCount: 0,
    panelOutwardConsistency: 0,
    flippedPanelCount: 0,
    negativeTransformCount,
    residualMeanM: 0,
    residualMaxM: 0,
    registrationAmbiguities: ambiguities,
    warning: `body-placement-required: ${ambiguities.join(" ")}`,
  };
}

function resolveExpectedOutward(
  instance: AssemblyPanelInstance,
  diagnostic: GarmentRegistrationDiagnostic,
  positions: Float32Array,
): AvatarVector3 | null {
  const surface = instance.placement.surface;
  if (surface === "front") return [...HUMAN_BODY_FRAME.front];
  if (surface === "back") return scale3(HUMAN_BODY_FRAME.front, -1);
  if (surface === "side") {
    if (instance.placement.bodySide === "left") return scale3(HUMAN_BODY_FRAME.right, -1);
    if (instance.placement.bodySide === "right") return [...HUMAN_BODY_FRAME.right];
  }
  const normal = instanceMeanTriangleNormal(positions, instance);
  return normal ? normalize3(normal) : diagnostic.bodyForward;
}

function deriveGarmentForward(samples: readonly SemanticSample[], up: AvatarVector3): AvatarVector3 | null {
  const front = weightedCentroid(samples.filter((sample) => sample.instance.placement.surface === "front"));
  const back = weightedCentroid(samples.filter((sample) => sample.instance.placement.surface === "back"));
  let forward: AvatarVector3 | null = front && back ? subtract3(front, back) : null;
  if (!forward || length3(projectOntoPlane(forward, up)) <= EPSILON) {
    forward = weightedDirection(samples.flatMap((sample) => {
      if (!sample.geometricNormal) return [];
      const surface = sample.instance.placement.surface;
      if (surface !== "front" && surface !== "back") return [];
      const sign = surface === "front" ? 1 : -1;
      return [{ ...sample, geometricNormal: scale3(sample.geometricNormal, sign) }];
    }), (sample) => sample.geometricNormal ?? [0, 0, 0]);
  }
  if (!forward) return null;
  const planar = projectOntoPlane(forward, up);
  return length3(planar) > EPSILON ? normalize3(planar) : null;
}

function deriveGarmentRight(
  samples: readonly SemanticSample[],
  up: AvatarVector3,
  forward: AvatarVector3,
): AvatarVector3 | null {
  const right = weightedCentroid(samples.filter((sample) => sample.instance.placement.bodySide === "right"));
  const left = weightedCentroid(samples.filter((sample) => sample.instance.placement.bodySide === "left"));
  if (!right || !left) return null;
  let lateral = subtract3(right, left);
  lateral = subtract3(lateral, scale3(up, dot3(lateral, up)));
  lateral = subtract3(lateral, scale3(forward, dot3(lateral, forward)));
  return length3(lateral) > EPSILON ? normalize3(lateral) : null;
}

function materialAxis(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  direction: "up" | "down",
): AvatarVector3 {
  const centroid = instanceCentroid(positions, instance);
  const material = instance.topology.positions2DMm;
  let meanY = 0;
  for (let local = 0; local < instance.vertexCount; local += 1) meanY += material[local * 2 + 1];
  meanY /= Math.max(1, instance.vertexCount);
  const axis: AvatarVector3 = [0, 0, 0];
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const scalar = material[local * 2 + 1] - meanY;
    const offset = (instance.particleStart + local) * 3;
    axis[0] += (positions[offset] - centroid[0]) * scalar;
    axis[1] += (positions[offset + 1] - centroid[1]) * scalar;
    axis[2] += (positions[offset + 2] - centroid[2]) * scalar;
  }
  const down = normalize3(axis);
  return direction === "down" ? down : scale3(down, -1);
}

function materialCentroid(instance: AssemblyPanelInstance): readonly [number, number] {
  let x = 0;
  let y = 0;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    x += instance.topology.positions2DMm[local * 2];
    y += instance.topology.positions2DMm[local * 2 + 1];
  }
  return [x / Math.max(1, instance.vertexCount), y / Math.max(1, instance.vertexCount)];
}

function instanceCentroid(
  positions: Float32Array,
  instance: Pick<AssemblyPanelInstance, "particleStart" | "vertexCount">,
): AvatarVector3 {
  const result: AvatarVector3 = [0, 0, 0];
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    result[0] += positions[offset];
    result[1] += positions[offset + 1];
    result[2] += positions[offset + 2];
  }
  const count = Math.max(1, instance.vertexCount);
  return [result[0] / count, result[1] / count, result[2] / count];
}

function instanceMeanTriangleNormal(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
): AvatarVector3 | null {
  const normal: AvatarVector3 = [0, 0, 0];
  const triangles = instance.topology.triangles;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const a = (instance.particleStart + triangles[offset]) * 3;
    const b = (instance.particleStart + triangles[offset + 1]) * 3;
    const c = (instance.particleStart + triangles[offset + 2]) * 3;
    const ab: AvatarVector3 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac: AvatarVector3 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const cross = crossRaw(ab, ac);
    normal[0] += cross[0];
    normal[1] += cross[1];
    normal[2] += cross[2];
  }
  return length3(normal) > EPSILON ? normalize3(normal) : null;
}

function weightedDirection<T extends { weight: number }>(
  samples: readonly T[],
  read: (sample: T) => readonly [number, number, number],
): AvatarVector3 | null {
  const result: AvatarVector3 = [0, 0, 0];
  for (const sample of samples) {
    const vector = read(sample);
    result[0] += vector[0] * sample.weight;
    result[1] += vector[1] * sample.weight;
    result[2] += vector[2] * sample.weight;
  }
  return length3(result) > EPSILON ? normalize3(result) : null;
}

function weightedCentroid(samples: readonly SemanticSample[]): AvatarVector3 | null {
  if (samples.length === 0) return null;
  const result: AvatarVector3 = [0, 0, 0];
  let weight = 0;
  for (const sample of samples) {
    result[0] += sample.centroid[0] * sample.weight;
    result[1] += sample.centroid[1] * sample.weight;
    result[2] += sample.centroid[2] * sample.weight;
    weight += sample.weight;
  }
  return scale3(result, 1 / Math.max(EPSILON, weight));
}

function countStructuralIslands(
  state: Pick<GarmentAssemblyState, "instances" | "stitchConstraints">,
): number {
  const adjacency = new Map(state.instances.map((instance) => [instance.id, new Set<string>()]));
  for (const stitch of state.stitchConstraints) {
    if (!stitch.instanceA || !stitch.instanceB || stitch.instanceA === stitch.instanceB) continue;
    if (classifyCoarseStitch(stitch) === "intentional-mismatch") continue;
    adjacency.get(stitch.instanceA)?.add(stitch.instanceB);
    adjacency.get(stitch.instanceB)?.add(stitch.instanceA);
  }
  const visited = new Set<string>();
  let count = 0;
  for (const id of [...adjacency.keys()].sort()) {
    if (visited.has(id)) continue;
    count += 1;
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return count;
}

function basisRotation(
  sourceRight: AvatarVector3,
  sourceUp: AvatarVector3,
  sourceForward: AvatarVector3,
  targetRight: readonly [number, number, number],
  targetUp: readonly [number, number, number],
  targetForward: readonly [number, number, number],
): readonly [number, number, number, number, number, number, number, number, number] {
  const source = [sourceRight, sourceUp, sourceForward] as const;
  const target = [targetRight, targetUp, targetForward] as const;
  const matrix = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      matrix[row * 3 + column] = target[0][row] * source[0][column]
        + target[1][row] * source[1][column]
        + target[2][row] * source[2][column];
    }
  }
  return matrix as unknown as readonly [number, number, number, number, number, number, number, number, number];
}

function quaternionFromMatrix(m: readonly number[]): readonly [number, number, number, number] {
  const trace = m[0] + m[4] + m[8];
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m[7] - m[5]) / s;
    y = (m[2] - m[6]) / s;
    z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s;
    x = 0.25 * s;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = 0.25 * s;
    z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = 0.25 * s;
  }
  const length = Math.hypot(x, y, z, w);
  return [x / length, y / length, z / length, w / length];
}

function quaternionToEulerDeg(q: readonly [number, number, number, number]): AvatarVector3 {
  const [x, y, z, w] = q;
  const sinX = 2 * (w * x + y * z);
  const cosX = 1 - 2 * (x * x + y * y);
  const sinY = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const sinZ = 2 * (w * z + x * y);
  const cosZ = 1 - 2 * (y * y + z * z);
  return [
    Math.atan2(sinX, cosX) * 180 / Math.PI,
    Math.asin(sinY) * 180 / Math.PI,
    Math.atan2(sinZ, cosZ) * 180 / Math.PI,
  ];
}

function transformPositionBuffer(values: Float32Array, transform: SimulationBodyTransform): void {
  for (let offset = 0; offset < values.length; offset += 3) {
    const point = transformPoint([values[offset], values[offset + 1], values[offset + 2]], transform);
    values[offset] = point[0];
    values[offset + 1] = point[1];
    values[offset + 2] = point[2];
  }
}

function transformPositionRange(
  values: Float32Array,
  instance: Pick<AssemblyPanelInstance, "particleStart" | "vertexCount">,
  transform: SimulationBodyTransform,
): void {
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const point = transformPoint([values[offset], values[offset + 1], values[offset + 2]], transform);
    values[offset] = point[0];
    values[offset + 1] = point[1];
    values[offset + 2] = point[2];
  }
}

function transformPoint(point: AvatarVector3, transform: SimulationBodyTransform): AvatarVector3 {
  return add3(rotateByQuaternion(point, transform.rotation), transform.translation);
}

function rotateByQuaternion(point: readonly [number, number, number], q: readonly [number, number, number, number]): AvatarVector3 {
  const [qx, qy, qz, qw] = q;
  const ix = qw * point[0] + qy * point[2] - qz * point[1];
  const iy = qw * point[1] + qz * point[0] - qx * point[2];
  const iz = qw * point[2] + qx * point[1] - qy * point[0];
  const iw = -qx * point[0] - qy * point[1] - qz * point[2];
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function determinant3(m: readonly number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function projectOntoPlane(vector: AvatarVector3, normal: AvatarVector3): AvatarVector3 {
  return subtract3(vector, scale3(normal, dot3(vector, normal)));
}

function cross3(a: readonly number[], b: readonly number[]): AvatarVector3 {
  return normalize3(crossRaw(a, b));
}

function crossRaw(a: readonly number[], b: readonly number[]): AvatarVector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length3(a: readonly number[]): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize3(a: readonly number[]): AvatarVector3 {
  const length = length3(a);
  return length > EPSILON ? [a[0] / length, a[1] / length, a[2] / length] : [0, 0, 0];
}

function add3(a: readonly number[], b: readonly number[]): AvatarVector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract3(a: readonly number[], b: readonly number[]): AvatarVector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a: readonly number[], scale: number): AvatarVector3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function distance3(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
