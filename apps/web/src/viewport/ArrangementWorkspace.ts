import * as THREE from "three";
import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";
import { anchorById } from "../avatar/AvatarParametricModel";
import {
  closestBodySurfacePoint,
  raycastBodySurface,
  resolveBodySurfaceAttachment,
  type BodySurfaceFrame,
} from "../avatar/BodySurfaceQuery";
import type { HumanBodyMesh } from "../avatar/HumanBodyModel";
import type { PatternPreviewPlacement } from "../domain/pattern";
import type { PanelArrangementAnchorV3 } from "../domain/patternDocumentV3.types";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";

export type ArrangementVisualState = "POSICIONAR" | "AJUSTADO" | "SIMULADO";

export interface ArrangementTransform {
  positionM: [number, number, number];
  orientationDeg: [number, number, number];
}

export interface StagingPanelBounds {
  instanceId: string;
  sizeM: [number, number, number];
}

export interface ArrangementCommit {
  instanceId: string;
  positionMm: [number, number, number];
  orientationDeg: [number, number, number];
  surfaceAttachment?: NonNullable<PanelArrangementAnchorV3["surfaceAttachment"]>;
}

export interface SurfaceCandidatePolicy {
  enterDistanceM: number;
  exitDistanceM: number;
  maxCandidateJumpM: number;
}

export interface SurfaceConformOptions {
  clearanceMm?: number;
  captureDistanceMm?: number;
  maximumVertexProjectionDistanceMm?: number;
  maximumMetricDistortion?: number;
  minimumProjectedVertexRatio?: number;
}

export interface SurfaceConformResult {
  conformed: boolean;
  metricDistortionMax: number;
  minimumClearanceMm: number;
  projectedVertexRatio: number;
  anchorTangentialDisplacementMm: number;
  anchorNormalDisplacementMm: number;
  surfaceAttachment?: ArrangementCommit["surfaceAttachment"];
  reason?: "surface-unavailable" | "too-far" | "coverage" | "metric" | "clearance" | "placement";
}

export interface BodyBarrierState {
  localSamples: Float32Array;
  previousDesiredWorld: Float32Array;
  previousConstrainedWorld: Float32Array;
  contact?: BodyBarrierContact;
}

interface BodyBarrierContact {
  sample: number;
  attachment: NonNullable<ArrangementCommit["surfaceAttachment"]>;
  surfacePoint: [number, number, number];
  outwardNormal: [number, number, number];
}

interface BodyBarrierCandidate extends BodyBarrierContact {
  source: "crossing" | "persistent" | "nearest";
  signedClearanceM: number;
  penetrationM: number;
  crossingFraction: number;
}

export interface BodyBarrierOptions {
  clearanceMm?: number;
  maximumQueryDistanceM?: number;
}

export interface BodyBarrierResult {
  corrected: boolean;
  maximumCorrectionMm: number;
  minimumSignedClearanceMm: number;
  sampledPoints: number;
  correctionWorld: [number, number, number];
  correctionNormalMm: number;
  correctionTangentialMm: number;
  responsibleSample?: number;
  contactSource?: "crossing" | "persistent" | "nearest";
  contactSurfacePoint?: [number, number, number];
  contactOutwardNormal?: [number, number, number];
  surfaceAttachment?: ArrangementCommit["surfaceAttachment"];
}

export interface RigidBodyBarrierGroupState {
  contactKey?: string;
}

export interface RigidBodyBarrierMember {
  key: string;
  mesh: THREE.Mesh;
  state: BodyBarrierState;
  priority?: number;
}

export interface BodyClearanceAudit {
  minimumSignedClearanceMm: number;
  penetratingSamples: number;
  sampledPoints: number;
}

export const DEFAULT_SURFACE_CANDIDATE_POLICY: SurfaceCandidatePolicy = {
  enterDistanceM: 0.16,
  exitDistanceM: 0.24,
  maxCandidateJumpM: 0.14,
};

export function arrangementVisualState(
  placement: PatternPreviewPlacement | undefined,
  simulated: boolean,
): ArrangementVisualState {
  if (simulated) return "SIMULADO";
  return placement?.presentationMode === "authored" ? "AJUSTADO" : "POSICIONAR";
}

export function createCameraDragPlane(
  grabPointWorld: THREE.Vector3,
  cameraDirectionWorld: THREE.Vector3,
): THREE.Plane {
  const normal = cameraDirectionWorld.clone();
  if (normal.lengthSq() <= 1e-12) normal.set(0, 0, -1);
  normal.normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, grabPointWorld);
}

export function intersectPointerRayWithDragPlane(
  ray: THREE.Ray,
  plane: THREE.Plane,
): THREE.Vector3 | null {
  return ray.intersectPlane(plane, new THREE.Vector3());
}

export function createAxisDragPlane(
  grabPointWorld: THREE.Vector3,
  axisWorld: THREE.Vector3,
  cameraDirectionWorld: THREE.Vector3,
): THREE.Plane {
  const axis = axisWorld.clone().normalize();
  let normal = cameraDirectionWorld.clone().addScaledVector(axis, -cameraDirectionWorld.dot(axis));
  if (normal.lengthSq() <= 1e-10) {
    const fallback = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    normal = fallback.addScaledVector(axis, -fallback.dot(axis));
  }
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), grabPointWorld);
}

/** Parameter of the closest point on a frozen world axis to a pointer ray. */
export function closestRayAxisParameter(
  ray: THREE.Ray,
  axisOriginWorld: THREE.Vector3,
  axisWorld: THREE.Vector3,
): number | null {
  const axis = axisWorld.clone();
  if (axis.lengthSq() <= 1e-12 || ray.direction.lengthSq() <= 1e-12) return null;
  axis.normalize();
  const direction = ray.direction.clone().normalize();
  const betweenOrigins = ray.origin.clone().sub(axisOriginWorld);
  const axisRayDot = direction.dot(axis);
  const denominator = 1 - axisRayDot * axisRayDot;
  if (denominator <= 1e-5) return null;
  const rayOriginProjection = direction.dot(betweenOrigins);
  const axisOriginProjection = axis.dot(betweenOrigins);
  const parameter = (axisOriginProjection - axisRayDot * rayOriginProjection) / denominator;
  return Number.isFinite(parameter) ? parameter : null;
}

export function axisParameterOnDragPlane(
  ray: THREE.Ray,
  plane: THREE.Plane,
  axisOriginWorld: THREE.Vector3,
  axisWorld: THREE.Vector3,
): number | null {
  const point = ray.intersectPlane(plane, new THREE.Vector3());
  if (!point) return null;
  const axis = axisWorld.clone();
  if (axis.lengthSq() <= 1e-12) return null;
  return point.sub(axisOriginWorld).dot(axis.normalize());
}

export function perspectiveWorldUnitsPerPixel(
  depthAlongViewM: number,
  verticalFovDeg: number,
  viewportHeightPx: number,
): number {
  const depth = Math.max(1e-4, Math.abs(depthAlongViewM));
  const height = Math.max(1, viewportHeightPx);
  return 2 * depth * Math.tan(THREE.MathUtils.degToRad(verticalFovDeg * 0.5)) / height;
}

export function signedRotationAngle(
  startDirection: THREE.Vector3,
  currentDirection: THREE.Vector3,
  axisWorld: THREE.Vector3,
): number {
  const start = startDirection.clone().normalize();
  const current = currentDirection.clone().normalize();
  const axis = axisWorld.clone().normalize();
  const cross = new THREE.Vector3().crossVectors(start, current);
  return Math.atan2(axis.dot(cross), THREE.MathUtils.clamp(start.dot(current), -1, 1));
}

export function unwrapRotationAngle(previousRaw: number, currentRaw: number, accumulated: number): number {
  let delta = currentRaw - previousRaw;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return accumulated + delta;
}

export function applyFrozenRigidTranslation(
  mesh: THREE.Mesh,
  initialPosition: THREE.Vector3,
  initialQuaternion: THREE.Quaternion,
  deltaWorld: THREE.Vector3,
): void {
  mesh.position.copy(initialPosition).add(deltaWorld);
  mesh.quaternion.copy(initialQuaternion);
  mesh.updateMatrixWorld(true);
}

export function applyFrozenRigidRotation(
  mesh: THREE.Mesh,
  initialPosition: THREE.Vector3,
  initialQuaternion: THREE.Quaternion,
  pivotWorld: THREE.Vector3,
  rotationWorld: THREE.Quaternion,
): void {
  const relative = initialPosition.clone().sub(pivotWorld).applyQuaternion(rotationWorld);
  mesh.position.copy(pivotWorld).add(relative);
  mesh.quaternion.copy(rotationWorld).multiply(initialQuaternion);
  mesh.updateMatrixWorld(true);
}

export function createBodyBarrierState(mesh: THREE.Mesh, maximumSamples = 20): BodyBarrierState {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const local: number[] = [];
  const point = new THREE.Vector3();
  const count = Math.max(1, position.count);
  const vertexBudget = Math.max(4, Math.floor(maximumSamples * 0.6));
  const vertexStep = Math.max(1, Math.floor(count / vertexBudget));
  for (let index = 0; index < count && local.length / 3 < vertexBudget; index += vertexStep) {
    point.fromBufferAttribute(position, index);
    local.push(point.x, point.y, point.z);
  }

  mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  local.push(center.x, center.y, center.z);

  const index = mesh.geometry.getIndex();
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  const triangleBudget = Math.max(0, maximumSamples - local.length / 3);
  const triangleStep = Math.max(1, Math.floor(Math.max(1, triangleCount) / Math.max(1, triangleBudget)));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount && local.length / 3 < maximumSamples; triangle += triangleStep) {
    const base = triangle * 3;
    a.fromBufferAttribute(position, index ? index.getX(base) : base);
    b.fromBufferAttribute(position, index ? index.getX(base + 1) : base + 1);
    c.fromBufferAttribute(position, index ? index.getX(base + 2) : base + 2);
    point.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    local.push(point.x, point.y, point.z);
  }

  const localSamples = Float32Array.from(local);
  const previousDesiredWorld = new Float32Array(localSamples.length);
  const previousConstrainedWorld = new Float32Array(localSamples.length);
  writeBarrierWorldSamples(mesh, localSamples, previousDesiredWorld);
  previousConstrainedWorld.set(previousDesiredWorld);
  return { localSamples, previousDesiredWorld, previousConstrainedWorld };
}

export function refreshBodyBarrierState(mesh: THREE.Mesh, state: BodyBarrierState): void {
  writeBarrierWorldSamples(mesh, state.localSamples, state.previousConstrainedWorld);
}

/**
 * Cheap unilateral rigid-body constraint for Montar. Outside the body the
 * authored transform is untouched. Only inward/crossing motion is removed;
 * tangential sliding and motion away from the surface remain free.
 */
export function constrainMeshOutsideBody(
  mesh: THREE.Mesh,
  body: HumanBodyMesh,
  state: BodyBarrierState,
  options: BodyBarrierOptions = {},
): BodyBarrierResult {
  const clearanceMm = Math.max(1, options.clearanceMm ?? 8);
  const clearanceM = clearanceMm * 0.001;
  const maximumQueryDistanceM = Math.max(clearanceM * 2, options.maximumQueryDistanceM ?? 0.08);
  const sampleCount = Math.floor(state.localSamples.length / 3);
  const desired = new THREE.Vector3();
  const previousConstrained = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let minimumSignedClearanceM = Number.POSITIVE_INFINITY;
  const candidates: BodyBarrierCandidate[] = [];
  const rawDesiredWorld = new Float32Array(state.localSamples.length);
  const persistentFrame = state.contact
    ? resolveBodySurfaceAttachment(body, { ...state.contact.attachment, normalOffsetMm: 0 })
    : null;

  mesh.updateMatrixWorld(true);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    readBarrierWorldSample(mesh, state.localSamples, sample, desired);
    const offset = sample * 3;
    rawDesiredWorld[offset] = desired.x;
    rawDesiredWorld[offset + 1] = desired.y;
    rawDesiredWorld[offset + 2] = desired.z;
    previousConstrained.set(
      state.previousConstrainedWorld[offset],
      state.previousConstrainedWorld[offset + 1],
      state.previousConstrainedWorld[offset + 2],
    );
    movement.copy(desired).sub(previousConstrained);
    const travel = movement.length();

    if (travel > 1e-7) {
      const direction = movement.clone().multiplyScalar(1 / travel);
      const hit = raycastBodySurface(
        body,
        [previousConstrained.x, previousConstrained.y, previousConstrained.z],
        [direction.x, direction.y, direction.z],
        0,
        travel + clearanceM * 2,
      );
      if (hit) {
        normal.set(...hit.outwardNormal).normalize();
        if (direction.dot(normal) < -1e-5) {
          surface.set(...hit.position);
          const signed = desired.clone().sub(surface).dot(normal);
          if (signed < clearanceM) {
            candidates.push(bodyBarrierCandidate(sample, hit, "crossing", signed, clearanceM, travel > 0
              ? surface.distanceTo(previousConstrained) / travel
              : 0));
          }
        }
      }
    }

    const nearest = closestBodySurfacePoint(
      body,
      [desired.x, desired.y, desired.z],
      0,
      maximumQueryDistanceM,
    );
    if (nearest) {
      surface.set(...nearest.position);
      normal.set(...nearest.outwardNormal).normalize();
      const signed = desired.clone().sub(surface).dot(normal);
      minimumSignedClearanceM = Math.min(minimumSignedClearanceM, signed);
      if (signed < clearanceM) {
        candidates.push(bodyBarrierCandidate(sample, nearest, "nearest", signed, clearanceM, 1));
      }
    }
  }

  if (state.contact && persistentFrame) {
    const sample = state.contact.sample;
    const offset = sample * 3;
    if (offset + 2 < rawDesiredWorld.length) {
      desired.set(rawDesiredWorld[offset], rawDesiredWorld[offset + 1], rawDesiredWorld[offset + 2]);
      surface.set(...persistentFrame.position);
      normal.set(...persistentFrame.outwardNormal).normalize();
      const signed = desired.clone().sub(surface).dot(normal);
      const localNearest = closestBodySurfacePoint(body, [desired.x, desired.y, desired.z], 0, maximumQueryDistanceM);
      const continuousNearest = localNearest
        && new THREE.Vector3(...localNearest.position).distanceTo(surface) <= 0.05
        && new THREE.Vector3(...localNearest.outwardNormal).normalize().dot(normal) >= 0.35;
      const contactFrame = continuousNearest ? localNearest : persistentFrame;
      const contactSurface = new THREE.Vector3(...contactFrame.position);
      const contactNormal = new THREE.Vector3(...contactFrame.outwardNormal).normalize();
      const contactSigned = desired.clone().sub(contactSurface).dot(contactNormal);
      if (continuousNearest) {
        state.contact = {
          sample,
          attachment: { ...contactFrame.attachment, barycentric: [...contactFrame.attachment.barycentric], normalOffsetMm: 0 },
          surfacePoint: [...contactFrame.position],
          outwardNormal: [...contactFrame.outwardNormal],
        };
      }
      minimumSignedClearanceM = Math.min(minimumSignedClearanceM, contactSigned);
      if (contactSigned < clearanceM) {
        candidates.push(bodyBarrierCandidate(sample, contactFrame, "persistent", contactSigned, clearanceM, 0));
      } else if (signed > maximumQueryDistanceM) {
        state.contact = undefined;
      }
    }
  }

  const crossings = candidates.filter((candidate) => candidate.source === "crossing");
  const persistent = candidates.filter((candidate) => candidate.source === "persistent");
  const primary = persistent[0]
    ?? crossings.sort((left, right) => left.crossingFraction - right.crossingFraction)[0]
    ?? candidates.filter((candidate) => candidate.source === "nearest")
      .sort((left, right) => left.penetrationM - right.penetrationM)[0];
  const correction = new THREE.Vector3();
  if (primary) {
    const primaryNormal = new THREE.Vector3(...primary.outwardNormal).normalize();
    let correctionAlongPrimaryM = primary.penetrationM;
    for (const candidate of candidates) {
      const candidateNormal = new THREE.Vector3(...candidate.outwardNormal).normalize();
      const alignment = candidateNormal.dot(primaryNormal);
      if (alignment < 0.5) continue;
      correctionAlongPrimaryM = Math.max(correctionAlongPrimaryM, candidate.penetrationM / alignment);
    }
    correction.copy(primaryNormal).multiplyScalar(correctionAlongPrimaryM);
    mesh.position.add(correction);
    mesh.updateMatrixWorld(true);
    state.contact = {
      sample: primary.sample,
      attachment: { ...primary.attachment, barycentric: [...primary.attachment.barycentric], normalOffsetMm: 0 },
      surfacePoint: [...primary.surfacePoint],
      outwardNormal: [...primary.outwardNormal],
    };
  }

  state.previousDesiredWorld.set(rawDesiredWorld);
  writeBarrierWorldSamples(mesh, state.localSamples, state.previousConstrainedWorld);
  const primaryNormal = primary ? new THREE.Vector3(...primary.outwardNormal).normalize() : new THREE.Vector3();
  const normalCorrectionM = primary ? correction.dot(primaryNormal) : 0;
  const tangentialCorrectionM = primary
    ? correction.clone().addScaledVector(primaryNormal, -normalCorrectionM).length()
    : 0;
  return {
    corrected: correction.lengthSq() > 1e-14,
    maximumCorrectionMm: correction.length() * 1_000,
    minimumSignedClearanceMm: Number.isFinite(minimumSignedClearanceM) ? minimumSignedClearanceM * 1_000 : clearanceMm,
    sampledPoints: sampleCount,
    correctionWorld: [correction.x, correction.y, correction.z],
    correctionNormalMm: normalCorrectionM * 1_000,
    correctionTangentialMm: tangentialCorrectionM * 1_000,
    ...(primary ? {
      responsibleSample: primary.sample,
      contactSource: primary.source,
      contactSurfacePoint: [...primary.surfacePoint],
      contactOutwardNormal: [...primary.outwardNormal],
      surfaceAttachment: {
        ...primary.attachment,
        barycentric: [...primary.attachment.barycentric],
        normalOffsetMm: clearanceMm,
      },
    } : {}),
  };
}

function bodyBarrierCandidate(
  sample: number,
  frame: BodySurfaceFrame,
  source: BodyBarrierCandidate["source"],
  signedClearanceM: number,
  clearanceM: number,
  crossingFraction: number,
): BodyBarrierCandidate {
  return {
    sample,
    source,
    signedClearanceM,
    penetrationM: Math.max(0, clearanceM - signedClearanceM),
    crossingFraction,
    attachment: { ...frame.attachment, barycentric: [...frame.attachment.barycentric], normalOffsetMm: 0 },
    surfacePoint: [...frame.position],
    outwardNormal: [...frame.outwardNormal],
  };
}

/** Applies at most one temporally stable correction to an entire rigid selection. */
export function constrainRigidMeshGroupOutsideBody(
  members: readonly RigidBodyBarrierMember[],
  body: HumanBodyMesh,
  groupState: RigidBodyBarrierGroupState,
  options: BodyBarrierOptions = {},
): { key: string; result: BodyBarrierResult } | null {
  const ordered = [...members].sort((left, right) => {
    const priority = (member: RigidBodyBarrierMember) => member.key === groupState.contactKey
      ? 0
      : 1 + (member.priority ?? 0);
    return priority(left) - priority(right) || left.key.localeCompare(right.key);
  });
  let diagnostic: { key: string; result: BodyBarrierResult } | null = null;
  for (const member of ordered) {
    const before = member.mesh.position.clone();
    const result = constrainMeshOutsideBody(member.mesh, body, member.state, options);
    diagnostic ??= { key: member.key, result };
    const correction = member.mesh.position.clone().sub(before);
    if (correction.lengthSq() <= 1e-12) continue;
    groupState.contactKey = member.key;
    for (const companion of ordered) {
      if (companion.key === member.key) continue;
      companion.mesh.position.add(correction);
      companion.mesh.updateMatrixWorld(true);
    }
    for (const refreshed of ordered) refreshBodyBarrierState(refreshed.mesh, refreshed.state);
    return { key: member.key, result };
  }
  groupState.contactKey = ordered.find((member) => member.key === groupState.contactKey && member.state.contact)?.key
    ?? ordered.find((member) => member.state.contact)?.key;
  return diagnostic;
}

export function auditMeshBodyClearance(
  mesh: THREE.Mesh,
  body: HumanBodyMesh,
  requiredClearanceMm = 1,
  maximumSamples = 96,
): BodyClearanceAudit {
  const state = createBodyBarrierState(mesh, maximumSamples);
  const queryLimitM = 0.55;
  const point = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let minimumSignedClearanceMm = Number.POSITIVE_INFINITY;
  let penetratingSamples = 0;
  const sampleCount = Math.floor(state.localSamples.length / 3);
  mesh.updateMatrixWorld(true);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    readBarrierWorldSample(mesh, state.localSamples, sample, point);
    const nearest = closestBodySurfacePoint(body, [point.x, point.y, point.z], 0, queryLimitM);
    if (!nearest) continue;
    surface.set(...nearest.position);
    normal.set(...nearest.outwardNormal).normalize();
    const signedMm = point.clone().sub(surface).dot(normal) * 1_000;
    minimumSignedClearanceMm = Math.min(minimumSignedClearanceMm, signedMm);
    if (signedMm < requiredClearanceMm) penetratingSamples += 1;
  }
  return {
    minimumSignedClearanceMm: Number.isFinite(minimumSignedClearanceMm) ? minimumSignedClearanceMm : Number.POSITIVE_INFINITY,
    penetratingSamples,
    sampledPoints: sampleCount,
  };
}

function readBarrierWorldSample(
  mesh: THREE.Mesh,
  localSamples: Float32Array,
  sample: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const offset = sample * 3;
  target.set(localSamples[offset], localSamples[offset + 1], localSamples[offset + 2]);
  return target.applyMatrix4(mesh.matrixWorld);
}

function writeBarrierWorldSamples(
  mesh: THREE.Mesh,
  localSamples: Float32Array,
  target: Float32Array,
): void {
  mesh.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const sampleCount = Math.floor(localSamples.length / 3);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    readBarrierWorldSample(mesh, localSamples, sample, point);
    const offset = sample * 3;
    target[offset] = point.x;
    target[offset + 1] = point.y;
    target[offset + 2] = point.z;
  }
}

export function updateSurfaceCandidate(
  previous: BodySurfaceFrame | undefined,
  next: BodySurfaceFrame | null,
  freeGrabPointWorld: THREE.Vector3,
  policy: SurfaceCandidatePolicy = DEFAULT_SURFACE_CANDIDATE_POLICY,
): BodySurfaceFrame | undefined {
  const previousPosition = previous ? new THREE.Vector3(...previous.position) : null;
  const nextPosition = next ? new THREE.Vector3(...next.position) : null;
  const previousDistance = previousPosition?.distanceTo(freeGrabPointWorld) ?? Number.POSITIVE_INFINITY;
  const nextDistance = nextPosition?.distanceTo(freeGrabPointWorld) ?? Number.POSITIVE_INFINITY;

  if (!previous) {
    return next && nextDistance <= policy.enterDistanceM ? next : undefined;
  }

  if (next && nextDistance <= policy.exitDistanceM && nextPosition && previousPosition) {
    const candidateJump = nextPosition.distanceTo(previousPosition);
    if (candidateJump <= policy.maxCandidateJumpM || previousDistance > policy.exitDistanceM) return next;
  }

  if (previousDistance <= policy.exitDistanceM) return previous;
  return next && nextDistance <= policy.enterDistanceM ? next : undefined;
}

export function resolveArrangementTransform(
  placement: PatternPreviewPlacement,
  avatar: AvatarParametricModel,
): ArrangementTransform {
  // A direct 3D arrangement is authoritative. A surface attachment records the
  // local body neighbourhood used by conform; it must not replace the authored
  // rigid transform when both are present.
  if (placement.positionMm) {
    return {
      positionM: placement.positionMm.map((value) => value * 0.001) as [number, number, number],
      orientationDeg: placement.orientationDeg ?? [0, 0, placement.rotationDeg],
    };
  }
  if (placement.surfaceAttachment) {
    const frame = resolveBodySurfaceAttachment(avatar.humanBody.visualMesh, placement.surfaceAttachment);
    if (frame) {
      return {
        positionM: frame.position,
        orientationDeg: placement.orientationDeg ?? frameEulerDeg(frame.tangent, frame.axis, frame.outwardNormal),
      };
    }
  }
  if (placement.bodyAnchorId) {
    const anchor = anchorById(avatar, placement.bodyAnchorId);
    if (anchor) {
      const position = new THREE.Vector3(...anchor.position)
        .addScaledVector(new THREE.Vector3(...anchor.tangent), placement.offsetXMm * 0.001)
        .addScaledVector(new THREE.Vector3(...anchor.axis), placement.offsetYMm * 0.001)
        .addScaledVector(
          new THREE.Vector3(...anchor.outwardNormal),
          anchor.initialMarginM + placement.offsetZMm * 0.001,
        );
      return {
        positionM: [position.x, position.y, position.z],
        orientationDeg: placement.orientationDeg
          ?? frameEulerDeg(anchor.tangent, anchor.axis, anchor.outwardNormal, placement.rotationDeg),
      };
    }
  }
  return {
    positionM: bodyCenter(avatar.humanBody.visualMesh),
    orientationDeg: placement.orientationDeg ?? [0, 0, 0],
  };
}

/**
 * Runtime-only tray for panels without confirmed placement. The packing is
 * derived from canonical identities, real panel bounds and the current body;
 * it never becomes an arrangementAnchor and never changes panel scale.
 */
export function resolveDeterministicStagingLayout(
  panels: readonly StagingPanelBounds[],
  body: HumanBodyMesh,
): Map<string, ArrangementTransform> {
  const ordered = panels
    .map((panel) => ({
      instanceId: panel.instanceId,
      width: Math.max(0.001, Math.abs(panel.sizeM[0])),
      height: Math.max(0.001, Math.abs(panel.sizeM[1])),
      depth: Math.max(0, Math.abs(panel.sizeM[2])),
    }))
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  const bodyHeight = Math.max(0.4, body.bounds.max[1] - body.bounds.min[1]);
  const verticalMargin = Math.min(0.12, bodyHeight * 0.06);
  const bottom = body.bounds.min[1] + verticalMargin;
  const top = body.bounds.max[1] - verticalMargin;
  const availableHeight = Math.max(0.2, top - bottom);
  const centerY = (body.bounds.min[1] + body.bounds.max[1]) * 0.5;
  const horizontalGap = Math.max(0.055, bodyHeight * 0.032);
  const verticalGap = Math.max(0.045, bodyHeight * 0.026);
  const frontClearance = Math.max(0.05, bodyHeight * 0.03);
  const result = new Map<string, ArrangementTransform>();

  layoutStagingSide(ordered.filter((_, index) => index % 2 === 0), -1);
  layoutStagingSide(ordered.filter((_, index) => index % 2 === 1), 1);
  return result;

  function layoutStagingSide(
    sidePanels: typeof ordered,
    side: -1 | 1,
  ): void {
    const lanes: Array<{ panels: typeof ordered; width: number; height: number }> = [];
    for (const panel of sidePanels) {
      let lane = lanes[lanes.length - 1];
      const nextHeight = lane
        ? lane.height + verticalGap + panel.height
        : panel.height;
      if (!lane || (lane.panels.length > 0 && nextHeight > availableHeight)) {
        lane = { panels: [], width: 0, height: 0 };
        lanes.push(lane);
      }
      lane.height += (lane.panels.length > 0 ? verticalGap : 0) + panel.height;
      lane.width = Math.max(lane.width, panel.width);
      lane.panels.push(panel);
    }

    let outwardOffset = 0;
    for (const lane of lanes) {
      let cursorY = centerY + lane.height * 0.5;
      for (const panel of lane.panels) {
        const y = lane.height > availableHeight
          ? centerY
          : cursorY - panel.height * 0.5;
        if (lane.height <= availableHeight) cursorY -= panel.height + verticalGap;
        const bodyEdge = side < 0 ? body.bounds.min[0] : body.bounds.max[0];
        const x = bodyEdge + side * (horizontalGap + outwardOffset + panel.width * 0.5);
        result.set(panel.instanceId, {
          positionM: [
            x,
            y,
            body.bounds.max[2] + frontClearance + panel.depth * 0.5,
          ],
          orientationDeg: [0, 0, 0],
        });
      }
      outwardOffset += lane.width + horizontalGap;
    }
  }
}

function bodyCenter(body: HumanBodyMesh): [number, number, number] {
  return [
    (body.bounds.min[0] + body.bounds.max[0]) * 0.5,
    (body.bounds.min[1] + body.bounds.max[1]) * 0.5,
    (body.bounds.min[2] + body.bounds.max[2]) * 0.5,
  ];
}

export function placeMeshCentroid(
  mesh: THREE.Mesh,
  transform: ArrangementTransform,
): void {
  mesh.geometry.computeBoundingBox();
  const localCenter = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  mesh.quaternion.setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(transform.orientationDeg[0]),
    THREE.MathUtils.degToRad(transform.orientationDeg[1]),
    THREE.MathUtils.degToRad(transform.orientationDeg[2]),
    "XYZ",
  ));
  const rotatedCenter = localCenter.clone().applyQuaternion(mesh.quaternion);
  mesh.position.set(...transform.positionM).sub(rotatedCenter);
  mesh.scale.setScalar(1);
  mesh.updateMatrixWorld(true);
}

export function restoreMeshMaterialGeometry(
  mesh: THREE.Mesh,
  positions: Float32Array,
): void {
  const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  if (attribute.count * 3 !== positions.length) return;
  (attribute.array as Float32Array).set(positions);
  attribute.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

/**
 * One-shot geometric body conform used only after an explicit Adjust action.
 * The current Object3D transform is the authored placement and is never
 * replaced by a body frame. Only vertex-level curvature may change.
 */
export function adjustMeshToBodySurface(
  mesh: THREE.Mesh,
  body: HumanBodyMesh,
  attachmentValue: NonNullable<PanelArrangementAnchorV3["surfaceAttachment"]>,
  materialReferencePositions?: Float32Array,
  options: SurfaceConformOptions = {},
): SurfaceConformResult {
  const targetClearanceMm = Math.max(1, options.clearanceMm ?? attachmentValue.normalOffsetMm ?? 12);
  const captureDistanceMm = Math.max(targetClearanceMm, options.captureDistanceMm ?? 240);
  const maximumVertexProjectionDistanceMm = Math.max(
    captureDistanceMm,
    options.maximumVertexProjectionDistanceMm ?? 240,
  );
  const maximumMetricDistortion = options.maximumMetricDistortion ?? 0.008;
  const minimumProjectedVertexRatio = options.minimumProjectedVertexRatio ?? 0.65;
  const positionAttribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const positions = positionAttribute.array as Float32Array;
  const originalPositions = new Float32Array(positions);
  const originalMeshPosition = mesh.position.clone();
  const originalMeshQuaternion = mesh.quaternion.clone();
  const originalMeshScale = mesh.scale.clone();

  const restoreExactInput = (): void => {
    positions.set(originalPositions);
    positionAttribute.needsUpdate = true;
    mesh.position.copy(originalMeshPosition);
    mesh.quaternion.copy(originalMeshQuaternion);
    mesh.scale.copy(originalMeshScale);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.updateMatrixWorld(true);
  };

  const translateWorld = (deltaWorld: THREE.Vector3): void => {
    if (deltaWorld.lengthSq() <= 1e-18) return;
    const worldOrigin = mesh.getWorldPosition(new THREE.Vector3()).add(deltaWorld);
    if (mesh.parent) {
      mesh.parent.updateMatrixWorld(true);
      mesh.parent.worldToLocal(worldOrigin);
    }
    mesh.position.copy(worldOrigin);
    mesh.updateMatrixWorld(true);
  };

  // Mover/Girar author the body region. Adjust may only change depth along the
  // local body normal plus vertex-level curvature; it must not slide the panel
  // tangentially, recenter it, or alter its authored orientation.
  mesh.updateMatrixWorld(true);
  mesh.geometry.computeBoundingBox();
  const originalLocalAnchor = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  const authoredAnchorWorld = mesh.localToWorld(originalLocalAnchor.clone());
  const frame = closestBodySurfacePoint(
    body,
    [authoredAnchorWorld.x, authoredAnchorWorld.y, authoredAnchorWorld.z],
    0,
    captureDistanceMm * 0.001,
  );
  if (!frame) {
    return {
      conformed: false,
      metricDistortionMax: 0,
      minimumClearanceMm: 0,
      projectedVertexRatio: 0,
      anchorTangentialDisplacementMm: 0,
      anchorNormalDisplacementMm: 0,
      reason: "too-far",
    };
  }

  const bodyNormal = new THREE.Vector3(...frame.outwardNormal).normalize();
  const rawAnchorSurface = new THREE.Vector3(...frame.position);
  const authoredNormalOffsetMm = authoredAnchorWorld.clone().sub(rawAnchorSurface).dot(bodyNormal) * 1_000;
  if (!Number.isFinite(authoredNormalOffsetMm)) {
    restoreExactInput();
    return {
      conformed: false,
      metricDistortionMax: 0,
      minimumClearanceMm: 0,
      projectedVertexRatio: 0,
      anchorTangentialDisplacementMm: 0,
      anchorNormalDisplacementMm: 0,
      reason: "surface-unavailable",
    };
  }

  // This is the only rigid translation Adjust is allowed to introduce. It makes
  // a panel visibly floating in front of the correct body region actually reach
  // the skin shell while preserving its tangential placement.
  const requestedNormalShiftMm = targetClearanceMm - authoredNormalOffsetMm;
  const targetAnchorWorld = authoredAnchorWorld.clone().addScaledVector(
    bodyNormal,
    requestedNormalShiftMm * 0.001,
  );

  // Restore the immutable material geometry, but keep the currently authored
  // world anchor. This also makes repeated Adjust operations deterministic.
  if (materialReferencePositions) {
    restoreMeshMaterialGeometry(mesh, materialReferencePositions);
    mesh.updateMatrixWorld(true);
    mesh.geometry.computeBoundingBox();
    const restoredLocalAnchor = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    const restoredAnchorWorld = mesh.localToWorld(restoredLocalAnchor.clone());
    translateWorld(authoredAnchorWorld.clone().sub(restoredAnchorWorld));
  }
  translateWorld(bodyNormal.clone().multiplyScalar(requestedNormalShiftMm * 0.001));

  const flatPositions = new Float32Array(positions);
  const metricReference = materialReferencePositions && materialReferencePositions.length === positions.length
    ? materialReferencePositions
    : flatPositions;
  let projected = 0;
  let minimumClearanceMm = Number.POSITIVE_INFINITY;
  const world = new THREE.Vector3();
  const localTarget = new THREE.Vector3();

  mesh.updateMatrixWorld(true);
  for (let index = 0; index < positionAttribute.count; index += 1) {
    world.fromBufferAttribute(positionAttribute, index).applyMatrix4(mesh.matrixWorld);
    const hit = closestBodySurfacePoint(
      body,
      [world.x, world.y, world.z],
      targetClearanceMm,
      maximumVertexProjectionDistanceMm * 0.001,
    );
    if (!hit) continue;
    const hitNormal = new THREE.Vector3(...hit.outwardNormal).normalize();
    // Nearby opposite-facing surfaces (back/front or the other side of a limb)
    // are not part of the local conform patch selected by the current placement.
    if (hitNormal.dot(bodyNormal) < -0.25) continue;

    const target = new THREE.Vector3(...hit.position);
    localTarget.copy(target);
    mesh.worldToLocal(localTarget);
    positions[index * 3] = localTarget.x;
    positions[index * 3 + 1] = localTarget.y;
    positions[index * 3 + 2] = localTarget.z;

    const surfacePoint = target.clone().addScaledVector(hitNormal, -hit.attachment.normalOffsetMm * 0.001);
    minimumClearanceMm = Math.min(
      minimumClearanceMm,
      target.clone().sub(surfacePoint).dot(hitNormal) * 1_000,
    );
    projected += 1;
  }

  const projectedVertexRatio = positionAttribute.count > 0 ? projected / positionAttribute.count : 0;
  positionAttribute.needsUpdate = true;

  // Projection can contain a small rigid component. Remove that component
  // relative to the desired skin-shell anchor. The final anchor therefore has
  // zero tangential drift and exactly the intentional normal move.
  mesh.geometry.computeBoundingBox();
  const conformedLocalAnchor = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  const conformedAnchorWorld = mesh.localToWorld(conformedLocalAnchor.clone());
  const anchorError = conformedAnchorWorld.clone().sub(targetAnchorWorld);
  if (anchorError.lengthSq() > 1e-16) {
    const inverseLinear = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld.clone().invert());
    const localCorrection = anchorError.clone().multiplyScalar(-1).applyMatrix3(inverseLinear);
    for (let index = 0; index < positionAttribute.count; index += 1) {
      positions[index * 3] += localCorrection.x;
      positions[index * 3 + 1] += localCorrection.y;
      positions[index * 3 + 2] += localCorrection.z;
    }
    positionAttribute.needsUpdate = true;
  }

  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  const finalLocalAnchor = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  const finalAnchorWorld = mesh.localToWorld(finalLocalAnchor.clone());
  const finalAnchorDisplacement = finalAnchorWorld.clone().sub(authoredAnchorWorld);
  const anchorNormalComponent = finalAnchorDisplacement.dot(bodyNormal);
  const anchorNormalDisplacementMm = anchorNormalComponent * 1_000;
  const anchorTangentialDisplacementMm = finalAnchorDisplacement
    .clone()
    .addScaledVector(bodyNormal, -anchorNormalComponent)
    .length() * 1_000;

  const metricDistortionMax = maximumEdgeMetricDistortion(mesh.geometry, metricReference, positions);
  const requiredClearanceMm = Math.max(0.5, targetClearanceMm * 0.5);
  const exteriorAudit = auditMeshBodyClearance(
    mesh,
    body,
    requiredClearanceMm,
    Math.max(96, positionAttribute.count),
  );
  minimumClearanceMm = Math.min(minimumClearanceMm, exteriorAudit.minimumSignedClearanceMm);
  const clearanceValid = Number.isFinite(minimumClearanceMm)
    && minimumClearanceMm >= requiredClearanceMm
    && exteriorAudit.penetratingSamples === 0;
  const coverageValid = projectedVertexRatio >= minimumProjectedVertexRatio;
  const metricValid = metricDistortionMax <= maximumMetricDistortion;
  const tangentialPlacementValid = anchorTangentialDisplacementMm <= 0.05;
  const normalPlacementValid = Math.abs(anchorNormalDisplacementMm - requestedNormalShiftMm) <= 0.05;

  if (!coverageValid || !metricValid || !clearanceValid || !tangentialPlacementValid || !normalPlacementValid) {
    restoreExactInput();
    return {
      conformed: false,
      metricDistortionMax,
      minimumClearanceMm,
      projectedVertexRatio,
      anchorTangentialDisplacementMm,
      anchorNormalDisplacementMm,
      reason: !coverageValid
        ? "coverage"
        : !metricValid
          ? "metric"
          : !clearanceValid
            ? "clearance"
            : "placement",
    };
  }

  mesh.updateMatrixWorld(true);
  return {
    conformed: true,
    metricDistortionMax,
    minimumClearanceMm,
    projectedVertexRatio,
    anchorTangentialDisplacementMm,
    anchorNormalDisplacementMm,
    surfaceAttachment: {
      ...frame.attachment,
      barycentric: [...frame.attachment.barycentric],
      normalOffsetMm: targetClearanceMm,
    },
  };
}

export function captureMeshArrangement(
  instanceId: string,
  mesh: THREE.Mesh,
  surfaceAttachment?: ArrangementCommit["surfaceAttachment"],
): ArrangementCommit {
  mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  mesh.localToWorld(center);
  const euler = new THREE.Euler().setFromQuaternion(mesh.quaternion, "XYZ");
  return {
    instanceId,
    positionMm: [center.x * 1_000, center.y * 1_000, center.z * 1_000],
    orientationDeg: [
      THREE.MathUtils.radToDeg(euler.x),
      THREE.MathUtils.radToDeg(euler.y),
      THREE.MathUtils.radToDeg(euler.z),
    ],
    ...(surfaceAttachment ? { surfaceAttachment: structuredClone(surfaceAttachment) } : {}),
  };
}

/** Applies authored rigid poses to STEP 0 without changing material lengths. */
export function applyAuthoredArrangementToAssemblyState(
  state: GarmentAssemblyState,
  input: ResolvedAssemblyInput,
  avatar: AvatarParametricModel,
): void {
  const placements = new Map(
    input.garmentProjection.pieces.flatMap((piece) =>
      (piece.previewPlacements ?? []).map((placement) => [placement.id, placement] as const),
    ),
  );
  for (const instance of state.instances) {
    const placement = placements.get(instance.id);
    if (!placement || placement.presentationMode !== "authored") continue;
    const transform = resolveArrangementTransform(placement, avatar);
    const start = instance.particleStart;
    const count = instance.vertexCount;
    if (count === 0) continue;
    const center = assemblyInstanceCentroid(state.positions, start, count);
    const currentOrientation = materialFrameQuaternion(state.positions, instance);
    const targetOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(transform.orientationDeg[0]),
      THREE.MathUtils.degToRad(transform.orientationDeg[1]),
      THREE.MathUtils.degToRad(transform.orientationDeg[2]),
      "XYZ",
    ));
    const rotation = targetOrientation.multiply(currentOrientation.invert());
    for (const buffer of [state.positions, state.initialPositions, state.previousPositions]) {
      for (let local = 0; local < count; local += 1) {
        const offset = (start + local) * 3;
        const point = new THREE.Vector3(buffer[offset], buffer[offset + 1], buffer[offset + 2])
          .sub(center)
          .applyQuaternion(rotation)
          .add(new THREE.Vector3(...transform.positionM));
        buffer[offset] = point.x;
        buffer[offset + 1] = point.y;
        buffer[offset + 2] = point.z;
      }
    }
  }
}

function maximumEdgeMetricDistortion(
  geometry: THREE.BufferGeometry,
  referencePositions: Float32Array,
  candidatePositions: Float32Array,
): number {
  if (referencePositions.length !== candidatePositions.length) return Number.POSITIVE_INFINITY;
  const edges = uniqueGeometryEdges(geometry);
  let maximum = 0;
  for (const [first, second] of edges) {
    const referenceLength = pointDistance(referencePositions, first, second);
    if (referenceLength <= 1e-9) continue;
    const candidateLength = pointDistance(candidatePositions, first, second);
    maximum = Math.max(maximum, Math.abs(candidateLength / referenceLength - 1));
  }
  return maximum;
}

function uniqueGeometryEdges(geometry: THREE.BufferGeometry): Array<[number, number]> {
  const positionCount = geometry.getAttribute("position").count;
  const index = geometry.index;
  const edgeKeys = new Set<string>();
  const edges: Array<[number, number]> = [];
  const add = (firstValue: number, secondValue: number) => {
    const first = Math.min(firstValue, secondValue);
    const second = Math.max(firstValue, secondValue);
    const key = `${first}:${second}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push([first, second]);
  };
  const triangleCount = index ? index.count / 3 : Math.floor(positionCount / 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = index ? index.getX(triangle * 3) : triangle * 3;
    const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    add(a, b);
    add(b, c);
    add(c, a);
  }
  return edges;
}

function pointDistance(values: Float32Array, first: number, second: number): number {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  return Math.hypot(
    values[firstOffset] - values[secondOffset],
    values[firstOffset + 1] - values[secondOffset + 1],
    values[firstOffset + 2] - values[secondOffset + 2],
  );
}

function assemblyInstanceCentroid(
  positions: Float32Array,
  start: number,
  count: number,
): THREE.Vector3 {
  const center = new THREE.Vector3();
  for (let local = 0; local < count; local += 1) {
    const offset = (start + local) * 3;
    center.x += positions[offset];
    center.y += positions[offset + 1];
    center.z += positions[offset + 2];
  }
  return center.multiplyScalar(1 / count);
}

function materialFrameQuaternion(
  positions: Float32Array,
  instance: GarmentAssemblyState["instances"][number],
): THREE.Quaternion {
  const center = assemblyInstanceCentroid(positions, instance.particleStart, instance.vertexCount);
  const material = instance.topology.positions2DMm;
  let meanU = 0;
  let meanV = 0;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    meanU += material[local * 2];
    meanV += material[local * 2 + 1];
  }
  meanU /= instance.vertexCount;
  meanV /= instance.vertexCount;
  const x = new THREE.Vector3();
  const y = new THREE.Vector3();
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const point = new THREE.Vector3(positions[offset], positions[offset + 1], positions[offset + 2]).sub(center);
    x.addScaledVector(point, material[local * 2] - meanU);
    y.addScaledVector(point, material[local * 2 + 1] - meanV);
  }
  if (x.lengthSq() <= 1e-12) x.set(1, 0, 0);
  x.normalize();
  y.addScaledVector(x, -y.dot(x));
  if (y.lengthSq() <= 1e-12) y.set(0, 1, 0);
  y.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function frameEulerDeg(
  tangentValue: readonly [number, number, number],
  axisValue: readonly [number, number, number],
  normalValue: readonly [number, number, number],
  rollDeg = 0,
): [number, number, number] {
  const tangent = new THREE.Vector3(...tangentValue).normalize();
  const axis = new THREE.Vector3(...axisValue).normalize();
  const normal = new THREE.Vector3(...normalValue).normalize();
  const basis = new THREE.Matrix4().makeBasis(tangent, axis, normal);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
  quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(rollDeg)));
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ];
}
