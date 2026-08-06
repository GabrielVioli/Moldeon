import * as THREE from "three";
import type { AvatarParametricModel, AvatarVector3 } from "../avatar/AvatarParametricModel";
import { sampleArmRadius, sampleLegRadius, sampleTorsoAxes } from "../avatar/AvatarParametricModel";

export interface AvatarVisualOptions {
  radialSegments: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

export function createAvatarVisual(
  model: AvatarParametricModel,
  options: AvatarVisualOptions,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "avatar:visual";
  const segments = Math.max(8, Math.min(28, Math.round(options.radialSegments)));
  const material = new THREE.MeshStandardMaterial({
    color: model.bodyType === "feminine" ? 0xcbb9aa : 0xc4b5a8,
    roughness: 0.82,
    metalness: 0,
  });
  const bust = sampleTorsoAxes(model, model.landmarks.bustY);
  const waist = sampleTorsoAxes(model, model.landmarks.waistY);
  const hip = sampleTorsoAxes(model, model.landmarks.hipY);

  addEllipsoid(
    group,
    "avatar:chest",
    [0, (model.landmarks.shoulderY + model.landmarks.bustY) / 2, 0],
    [bust.halfWidth, Math.max(0.09, (model.landmarks.shoulderY - model.landmarks.bustY) * 0.78), bust.halfDepth],
    material,
    segments,
    options,
  );
  addEllipsoid(
    group,
    "avatar:abdomen",
    [0, (model.landmarks.bustY + model.landmarks.waistY) / 2, 0],
    [(bust.halfWidth + waist.halfWidth) * 0.49, Math.max(0.09, (model.landmarks.bustY - model.landmarks.waistY) * 0.72), (bust.halfDepth + waist.halfDepth) * 0.49],
    material,
    segments,
    options,
  );
  addEllipsoid(
    group,
    "avatar:pelvis",
    [0, (model.landmarks.waistY + model.landmarks.crotchY) / 2, 0],
    [hip.halfWidth, Math.max(0.11, (model.landmarks.waistY - model.landmarks.crotchY) * 0.66), hip.halfDepth],
    material,
    segments,
    options,
  );

  const neckRadius = Math.max(0.035, model.measurements.bustMm * 0.000043);
  addCapsule(group, "avatar:neck", [0, model.landmarks.shoulderY + 0.015, 0], [0, model.landmarks.neckY + 0.02, 0], neckRadius, material, segments, options);
  const headHeight = Math.max(0.18, model.landmarks.headTopY - model.landmarks.neckY);
  addEllipsoid(
    group,
    "avatar:head",
    [0, model.landmarks.headCenterY, 0],
    [headHeight * 0.28, headHeight * 0.48, headHeight * 0.34],
    material,
    segments,
    options,
  );

  const upperArmRadius = sampleArmRadius(model, 0.06);
  const forearmRadius = sampleArmRadius(model, model.measurements.armLengthMm * 0.0007);
  addCapsule(group, "avatar:upper-arm-left", model.joints.shoulderLeft, model.joints.elbowLeft, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-left", model.joints.elbowLeft, model.joints.wristLeft, forearmRadius, material, segments, options);
  addCapsule(group, "avatar:upper-arm-right", model.joints.shoulderRight, model.joints.elbowRight, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-right", model.joints.elbowRight, model.joints.wristRight, forearmRadius, material, segments, options);
  addEllipsoid(group, "avatar:shoulder-left", model.joints.shoulderLeft, [upperArmRadius * 1.08, upperArmRadius * 1.08, upperArmRadius * 1.08], material, segments, options);
  addEllipsoid(group, "avatar:shoulder-right", model.joints.shoulderRight, [upperArmRadius * 1.08, upperArmRadius * 1.08, upperArmRadius * 1.08], material, segments, options);
  addEllipsoid(group, "avatar:elbow-left", model.joints.elbowLeft, [forearmRadius * 1.12, forearmRadius * 1.12, forearmRadius * 1.12], material, segments, options);
  addEllipsoid(group, "avatar:elbow-right", model.joints.elbowRight, [forearmRadius * 1.12, forearmRadius * 1.12, forearmRadius * 1.12], material, segments, options);
  addEllipsoid(group, "avatar:hand-left", model.joints.wristLeft, [forearmRadius * 0.78, forearmRadius * 1.5, forearmRadius * 0.48], material, segments, options);
  addEllipsoid(group, "avatar:hand-right", model.joints.wristRight, [forearmRadius * 0.78, forearmRadius * 1.5, forearmRadius * 0.48], material, segments, options);

  const thighRadius = sampleLegRadius(model, model.landmarks.crotchY - 0.04);
  const calfRadius = sampleLegRadius(model, model.landmarks.kneeY - 0.08);
  addCapsule(group, "avatar:thigh-left", model.joints.hipLeft, model.joints.kneeLeft, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-left", model.joints.kneeLeft, model.joints.ankleLeft, calfRadius, material, segments, options);
  addCapsule(group, "avatar:thigh-right", model.joints.hipRight, model.joints.kneeRight, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-right", model.joints.kneeRight, model.joints.ankleRight, calfRadius, material, segments, options);
  addEllipsoid(group, "avatar:hip-left", model.joints.hipLeft, [thighRadius * 1.03, thighRadius * 1.03, thighRadius * 1.03], material, segments, options);
  addEllipsoid(group, "avatar:hip-right", model.joints.hipRight, [thighRadius * 1.03, thighRadius * 1.03, thighRadius * 1.03], material, segments, options);
  addEllipsoid(group, "avatar:knee-left", model.joints.kneeLeft, [calfRadius * 1.08, calfRadius * 1.08, calfRadius * 1.08], material, segments, options);
  addEllipsoid(group, "avatar:knee-right", model.joints.kneeRight, [calfRadius * 1.08, calfRadius * 1.08, calfRadius * 1.08], material, segments, options);
  const footLength = Math.max(0.19, model.measurements.heightMm * 0.000135);
  addEllipsoid(group, "avatar:foot-left", [model.joints.ankleLeft[0], model.landmarks.ankleY * 0.48, footLength * 0.18], [calfRadius * 0.9, model.landmarks.ankleY * 0.48, footLength * 0.5], material, segments, options);
  addEllipsoid(group, "avatar:foot-right", [model.joints.ankleRight[0], model.landmarks.ankleY * 0.48, footLength * 0.18], [calfRadius * 0.9, model.landmarks.ankleY * 0.48, footLength * 0.5], material, segments, options);

  return group;
}

function addEllipsoid(
  group: THREE.Group,
  name: string,
  center: AvatarVector3,
  radii: AvatarVector3,
  material: THREE.Material,
  segments: number,
  options: AvatarVisualOptions,
): void {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(6, Math.floor(segments * 0.72)));
  geometry.scale(Math.max(0.001, radii[0]), Math.max(0.001, radii[1]), Math.max(0.001, radii[2]));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(center[0], center[1], center[2]);
  mesh.castShadow = options.castShadow;
  mesh.receiveShadow = options.receiveShadow;
  group.add(mesh);
}

function addCapsule(
  group: THREE.Group,
  name: string,
  start: AvatarVector3,
  end: AvatarVector3,
  radius: number,
  material: THREE.Material,
  segments: number,
  options: AvatarVisualOptions,
): void {
  const direction = new THREE.Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const distance = direction.length();
  if (distance <= 1e-6) return;
  const geometry = new THREE.CapsuleGeometry(
    Math.max(0.005, radius),
    Math.max(0.001, distance - radius * 2),
    Math.max(4, Math.floor(segments * 0.45)),
    segments,
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = options.castShadow;
  mesh.receiveShadow = options.receiveShadow;
  group.add(mesh);
}
