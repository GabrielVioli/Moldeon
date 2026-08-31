import * as THREE from "three";
import type { AvatarParametricModel } from "../avatar/AvatarParametricModel";
import { anchorById } from "../avatar/AvatarParametricModel";
import { resolveBodySurfaceAttachment } from "../avatar/BodySurfaceQuery";
import type { PatternPreviewPlacement } from "../domain/pattern";
import type { PanelArrangementAnchorV3 } from "../domain/patternDocumentV3.types";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";

export type ArrangementVisualState = "POSICIONAR" | "AJUSTADO" | "SIMULADO";

export interface ArrangementTransform {
  positionM: [number, number, number];
  orientationDeg: [number, number, number];
}

export interface ArrangementCommit {
  instanceId: string;
  positionMm: [number, number, number];
  orientationDeg: [number, number, number];
  surfaceAttachment?: NonNullable<PanelArrangementAnchorV3["surfaceAttachment"]>;
}

export function arrangementVisualState(
  placement: PatternPreviewPlacement | undefined,
  simulated: boolean,
): ArrangementVisualState {
  if (simulated) return "SIMULADO";
  return placement?.presentationMode === "authored" ? "AJUSTADO" : "POSICIONAR";
}

export function resolveArrangementTransform(
  placement: PatternPreviewPlacement,
  avatar: AvatarParametricModel,
): ArrangementTransform {
  if (placement.surfaceAttachment) {
    const frame = resolveBodySurfaceAttachment(avatar.humanBody.visualMesh, placement.surfaceAttachment);
    if (frame) {
      return {
        positionM: frame.position,
        orientationDeg: placement.orientationDeg ?? frameEulerDeg(frame.tangent, frame.axis, frame.outwardNormal),
      };
    }
  }
  if (placement.positionMm) {
    return {
      positionM: placement.positionMm.map((value) => value * 0.001) as [number, number, number],
      orientationDeg: placement.orientationDeg ?? [0, 0, placement.rotationDeg],
    };
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
    positionM: (placement.positionMm ?? [-900, 1_350, 0]).map((value) => value * 0.001) as [number, number, number],
    orientationDeg: placement.orientationDeg ?? [0, 0, 0],
  };
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
