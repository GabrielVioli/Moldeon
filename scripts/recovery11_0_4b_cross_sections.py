from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

old = '''export interface HumanBodyCrossSection {
  id: string;
  region: HumanBodyRegionId;
  yM: number;
  targetCircumferenceMm: number;
'''
new = '''export interface HumanBodyCrossSection {
  id: string;
  region: HumanBodyRegionId;
  yM: number;
  centerM?: HumanBodyVector3;
  normal?: HumanBodyVector3;
  targetCircumferenceMm: number;
'''
if old not in text:
    raise RuntimeError("cross-section interface marker not found")
text = text.replace(old, new, 1)

old = '''  const frame = buildAnatomyFrame(measurements);
  const crossSections = buildTorsoCrossSections(measurements, frame);
  const field = buildAnatomyField(measurements, frame, crossSections);
  const visualMesh = polygonizeAnatomy(field, visualResolution);
  const collisionMesh = polygonizeAnatomy(field, collisionResolution);
  const joints = buildJoints(frame);
  const landmarks = buildLandmarks(measurements, frame, crossSections);
'''
new = '''  const frame = buildAnatomyFrame(measurements);
  const torsoCrossSections = buildTorsoCrossSections(measurements, frame);
  const crossSections = [...torsoCrossSections, ...buildLimbCrossSections(measurements, frame)];
  const field = buildAnatomyField(measurements, frame, torsoCrossSections);
  const visualMesh = polygonizeAnatomy(field, visualResolution);
  const collisionMesh = polygonizeAnatomy(field, collisionResolution);
  const joints = buildJoints(frame);
  const landmarks = buildLandmarks(measurements, frame, torsoCrossSections);
'''
if old not in text:
    raise RuntimeError("build model cross-section block not found")
text = text.replace(old, new, 1)

marker = 'function section(\n'
index = text.index(marker)
addition = r'''function buildLimbCrossSections(
  m: HumanBodyMeasurements,
  frame: AnatomyFrame,
): HumanBodyCrossSection[] {
  const make = (
    id: string,
    region: HumanBodyRegionId,
    center: HumanBodyVector3,
    normal: HumanBodyVector3,
    circumferenceMm: number,
    ratio: number,
  ): HumanBodyCrossSection => {
    const axes = ellipseAxesForPerimeter(circumferenceMm * 0.001, ratio);
    return {
      id,
      region,
      yM: center[1],
      centerM: [...center] as HumanBodyVector3,
      normal: normalize(normal),
      targetCircumferenceMm: circumferenceMm,
      halfWidthM: axes[0],
      frontDepthM: axes[1],
      backDepthM: axes[1],
      centerZM: center[2],
      frontLobeM: 0,
      backLobeM: 0,
      lobeHalfDistanceM: 0,
    };
  };
  const leftArmAxis = normalize(sub(frame.elbowLeft, frame.shoulderLeft));
  const rightArmAxis = normalize(sub(frame.elbowRight, frame.shoulderRight));
  const leftForearmAxis = normalize(sub(frame.wristLeft, frame.elbowLeft));
  const rightForearmAxis = normalize(sub(frame.wristRight, frame.elbowRight));
  const leftLegAxis = normalize(sub(frame.kneeLeft, frame.hipLeft));
  const rightLegAxis = normalize(sub(frame.kneeRight, frame.hipRight));
  const leftCalfAxis = normalize(sub(frame.ankleLeft, frame.kneeLeft));
  const rightCalfAxis = normalize(sub(frame.ankleRight, frame.kneeRight));
  const thighLeft = addScaled(frame.hipLeft, sub(frame.kneeLeft, frame.hipLeft), 0.18);
  const thighRight = addScaled(frame.hipRight, sub(frame.kneeRight, frame.hipRight), 0.18);
  const calfLeft = addScaled(frame.kneeLeft, sub(frame.ankleLeft, frame.kneeLeft), 0.48);
  const calfRight = addScaled(frame.kneeRight, sub(frame.ankleRight, frame.kneeRight), 0.48);
  return [
    make("upper-arm-left", "upper-arm-left", addScaled(frame.shoulderLeft, sub(frame.elbowLeft, frame.shoulderLeft), 0.30), leftArmAxis, m.bicepMm, 1.08),
    make("upper-arm-right", "upper-arm-right", addScaled(frame.shoulderRight, sub(frame.elbowRight, frame.shoulderRight), 0.30), rightArmAxis, m.bicepMm, 1.08),
    make("elbow-left", "forearm-left", frame.elbowLeft, leftForearmAxis, m.elbowMm, 1.06),
    make("elbow-right", "forearm-right", frame.elbowRight, rightForearmAxis, m.elbowMm, 1.06),
    make("wrist-left", "wrist-left", frame.wristLeft, leftForearmAxis, m.wristMm, 1.04),
    make("wrist-right", "wrist-right", frame.wristRight, rightForearmAxis, m.wristMm, 1.04),
    make("thigh-left", "thigh-left", thighLeft, leftLegAxis, m.thighMm, 1.12),
    make("thigh-right", "thigh-right", thighRight, rightLegAxis, m.thighMm, 1.12),
    make("knee-left", "knee-left", frame.kneeLeft, leftCalfAxis, m.kneeMm, 1.06),
    make("knee-right", "knee-right", frame.kneeRight, rightCalfAxis, m.kneeMm, 1.06),
    make("calf-left", "calf-left", calfLeft, leftCalfAxis, m.calfMm, 1.08),
    make("calf-right", "calf-right", calfRight, rightCalfAxis, m.calfMm, 1.08),
    make("ankle-left", "ankle-left", frame.ankleLeft, leftCalfAxis, m.ankleMm, 1.04),
    make("ankle-right", "ankle-right", frame.ankleRight, rightCalfAxis, m.ankleMm, 1.04),
  ];
}

'''
text = text[:index] + addition + text[index:]

# The torso adapter must not accidentally pick a limb section with a matching
# broad region; it already searches by explicit ids, so no further change is needed.
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
