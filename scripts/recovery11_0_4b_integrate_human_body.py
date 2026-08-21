from pathlib import Path

path = Path("apps/web/src/avatar/AvatarParametricModel.ts")
text = path.read_text(encoding="utf-8")

old_import = 'import { createMeasurementProfile, measurementProfileToBodyMeasurements, type MeasurementOrigin } from "../domain/parametricMeasurements";\n'
new_import = 'import type { MeasurementOrigin } from "../domain/parametricMeasurements";\nimport { buildHumanBodyModel, type HumanBodyModel } from "./HumanBodyModel";\n'
if old_import not in text:
    raise RuntimeError("AvatarParametricModel measurement import not found")
text = text.replace(old_import, new_import, 1)

needle = 'export interface AvatarParametricModel {\n  version: "avatar-parametric@1";\n'
replacement = 'export interface AvatarParametricModel {\n  version: "avatar-parametric@1";\n  humanBody: HumanBodyModel;\n'
if needle not in text:
    raise RuntimeError("AvatarParametricModel interface marker not found")
text = text.replace(needle, replacement, 1)

start = text.index('export function buildAvatarParametricModel(\n')
end = text.index('export function resolveAvatarAnchor(\n')
new_builder = r'''export function buildAvatarParametricModel(
  input: BodyMeasurements,
  bodyType: BodyType,
): AvatarParametricModel {
  // The canonical female surface is now the single metric/anatomical source.
  // Legacy arrangement APIs remain as an adapter so Phase-0 garment assembly
  // can migrate without reintroducing a second body definition.
  const humanBody = buildHumanBodyModel(input);
  const body = humanBody.measurements;
  const measurementOrigins = { ...humanBody.measurementSources } as Record<string, MeasurementOrigin>;
  const measurements: AvatarResolvedMeasurements = {
    heightMm: body.heightMm,
    bustMm: body.bustMm,
    waistMm: body.waistMm,
    hipMm: body.fullHipMm,
    shoulderWidthMm: body.shoulderWidthMm,
    torsoLengthMm: body.torsoLengthMm,
    armLengthMm: body.armLengthMm,
    bicepMm: body.bicepMm,
    wristMm: body.wristMm,
    inseamMm: body.inseamMm,
    thighMm: body.thighMm,
    calfMm: body.calfMm,
    ankleMm: body.ankleMm,
  };

  const position = (id: keyof typeof humanBody.landmarks): AvatarVector3 =>
    [...humanBody.landmarks[id].position] as AvatarVector3;
  const joint = (id: string): AvatarVector3 => {
    const value = humanBody.joints[id];
    if (!value) throw new Error(`HumanBody joint ausente: ${id}`);
    return [...value.position] as AvatarVector3;
  };

  const ankleLeft = position("ankle-left");
  const kneeLeft = position("knee-left");
  const crotchLeft = position("inseam-top-left");
  const hipFront = position("full-hip-front");
  const waistFront = position("center-front-waist");
  const bustLeft = position("bust-apex-left");
  const shoulderLeft = joint("shoulder-left");
  const neckBase = position("neck-base-center");
  const headTop = position("head-top");
  const landmarks: AvatarLandmarks = {
    groundY: 0,
    ankleY: ankleLeft[1],
    kneeY: kneeLeft[1],
    crotchY: crotchLeft[1],
    hipY: hipFront[1],
    waistY: waistFront[1],
    bustY: bustLeft[1],
    shoulderY: shoulderLeft[1],
    neckY: neckBase[1],
    headCenterY: (neckBase[1] + headTop[1]) * 0.55,
    headTopY: headTop[1],
  };

  const joints: AvatarJoints = {
    shoulderLeft,
    shoulderRight: joint("shoulder-right"),
    elbowLeft: joint("elbow-left"),
    elbowRight: joint("elbow-right"),
    wristLeft: joint("wrist-left"),
    wristRight: joint("wrist-right"),
    hipLeft: joint("hip-left"),
    hipRight: joint("hip-right"),
    kneeLeft: joint("knee-left"),
    kneeRight: joint("knee-right"),
    ankleLeft: joint("ankle-left"),
    ankleRight: joint("ankle-right"),
  };

  const stationIds = ["crotch", "full-hip", "waist", "bust", "shoulder"] as const;
  const torsoStations: AvatarTorsoStation[] = stationIds.map((id) => {
    const section = humanBody.crossSections.find((candidate) => candidate.id === id);
    if (!section) throw new Error(`HumanBody cross-section ausente: ${id}`);
    return {
      y: section.yM,
      halfWidth: section.halfWidthM,
      halfDepth: (section.frontDepthM + section.backDepthM) * 0.5,
    };
  });

  const armVector = [
    joints.wristRight[0] - joints.shoulderRight[0],
    joints.wristRight[1] - joints.shoulderRight[1],
  ] as const;
  const legVector = [
    joints.ankleRight[0] - joints.hipRight[0],
    joints.ankleRight[1] - joints.hipRight[1],
  ] as const;
  const armPoseAngleDeg = Math.atan2(Math.abs(armVector[0]), Math.abs(armVector[1])) * 180 / Math.PI;
  const legPoseAngleDeg = Math.atan2(Math.abs(legVector[0]), Math.abs(legVector[1])) * 180 / Math.PI;

  const model: AvatarParametricModel = {
    version: "avatar-parametric@1",
    humanBody,
    bodyType,
    measurements,
    measurementOrigins,
    landmarks,
    joints,
    torsoStations,
    anchors: [],
    armPoseAngleDeg,
    legPoseAngleDeg,
  };
  model.anchors = createAnchors(model);
  return model;
}

'''
text = text[:start] + new_builder + text[end:]
path.write_text(text, encoding="utf-8")
print(f"patched {path}")

viewport = Path("apps/web/src/viewport/GlobalThreeViewport.ts")
text = viewport.read_text(encoding="utf-8")
old_asset_import = '''import {
  approvedAvatarForBody,
  AVATAR_NOT_CONFIGURED_MESSAGE,
} from "../avatar/ApprovedAvatarAsset";
import { loadApprovedAvatar } from "../avatar/ApprovedAvatarLoader";
'''
if old_asset_import not in text:
    raise RuntimeError("approved avatar imports not found")
text = text.replace(old_asset_import, "", 1)
text = text.replace('import type { BodyType } from "../domain/pattern";\n', "", 1)
old_call = '    const avatarConfiguration = this.configureApprovedAvatar(input.document.body.type);\n'
new_call = '    const avatarConfiguration = this.configureCanonicalAvatar(avatarModel);\n'
if old_call not in text:
    raise RuntimeError("configureApprovedAvatar call not found")
text = text.replace(old_call, new_call, 1)

method_start = text.index('  private configureApprovedAvatar(\n')
method_end = text.index('  private resize(): void {\n', method_start)
new_method = r'''  private configureCanonicalAvatar(
    avatarModel: AvatarParametricModel,
  ): { changed: boolean; warning?: string } {
    const body = avatarModel.humanBody;
    const signature = `canonical:${body.version}:${JSON.stringify(body.measurements)}`;
    if (signature === this.avatarSignature) return { changed: false };

    this.avatarLoadController?.abort();
    this.avatarLoadController = null;
    this.clearAvatar();
    this.avatarSignature = signature;
    const visual = createAvatarVisual(avatarModel, {
      radialSegments: 24,
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
    });
    this.avatarGroup.add(visual);
    this.host.dataset.avatarVisible = "true";
    this.host.dataset.avatarStatus = "ready";
    this.host.dataset.avatarAssetId = body.version;
    this.host.dataset.avatarInspection = JSON.stringify({
      source: "canonical-procedural-human-body",
      visualVertices: body.visualMesh.positions.length / 3,
      visualTriangles: body.visualMesh.indices.length / 3,
      collisionVertices: body.collisionMesh.positions.length / 3,
      collisionTriangles: body.collisionMesh.indices.length / 3,
      diagnostics: body.diagnostics,
    });
    return { changed: true };
  }

'''
text = text[:method_start] + new_method + text[method_end:]
viewport.write_text(text, encoding="utf-8")
print(f"patched {viewport}")
