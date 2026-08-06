from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    start = source.find(start_marker)
    end = source.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit(f"{path}: markers not found: {start_marker!r} / {end_marker!r}")
    target.write_text(source[:start] + replacement.rstrip() + "\n\n" + source[end:], encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


arrangement = "apps/web/src/garment3d/SemanticAvatarArrangement.ts"
replace_once(
    arrangement,
    "  applyMinimalSeamStabilization(state, visibleInstanceIds, 2, 0.004);",
    "  applyMinimalSeamStabilization(state, visibleInstanceIds, 1, 0.0015);",
)

replace_between(
    arrangement,
    "function mapTorsoSurface(",
    "function mapArm(",
    r'''function mapTorsoSurface(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  piece: PatternPiece,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const foldX = findFoldCoordinate(piece, instance);
  const sideSign = instance.placement.bodySide === "left" ? -1 : 1;
  const surfaceSign = instance.placement.surface === "back" ? -1 : 1;
  const scale = validScale(instance.placement.scale);
  const topY = instance.placement.region === "torso"
    ? avatar.landmarks.shoulderY + 0.012
    : avatar.landmarks.waistY + 0.008;
  const rotation = instance.placement.rotationDeg * Math.PI / 180;
  const patternHalfWidth = Math.max(
    1,
    ...Array.from({ length: instance.vertexCount }, (_, local) => {
      const x = instance.topology.positions2DMm[local * 2];
      return Math.abs(x - (piece.cutOnFold ? foldX : centerX));
    }),
  );
  const shoulderDepthRange = Math.max(
    0.08,
    avatar.landmarks.shoulderY - avatar.landmarks.bustY,
  );

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    const sourceX = piece.cutOnFold && instance.placement.bodySide !== "center"
      ? sideSign * Math.abs(xMm - foldX)
      : xMm - centerX;
    const sourceY = yMm - bounds.minY;
    const rotatedX = sourceX * Math.cos(rotation) - sourceY * Math.sin(rotation);
    const rotatedY = sourceX * Math.sin(rotation) + sourceY * Math.cos(rotation);
    const worldY = topY - rotatedY * METERS_PER_MM * scale - instance.placement.offsetYMm * METERS_PER_MM;
    const axes = sampleTorsoAxes(avatar, worldY);
    const normalizedAcross = clamp01(Math.abs(rotatedX) / patternHalfWidth);
    const angle = normalizedAcross * Math.PI * 0.5;
    const xDirection = rotatedX < 0 ? -1 : rotatedX > 0 ? 1 : instance.placement.bodySide === "left" ? -1 : 1;
    const shoulderProgress = instance.placement.region === "torso"
      ? clamp01((topY - worldY) / shoulderDepthRange)
      : 1;
    const depthScale = instance.placement.region === "torso"
      ? lerp(0.16, 1, smoothstep(shoulderProgress))
      : 1;
    const radialWidth = axes.halfWidth + anchor.initialMarginM * 0.62;
    const radialDepth = axes.halfDepth * depthScale + anchor.initialMarginM;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = xDirection * Math.sin(angle) * radialWidth + instance.placement.offsetXMm * METERS_PER_MM;
    positions[offset + 1] = worldY;
    positions[offset + 2] = surfaceSign * Math.cos(angle) * radialDepth + instance.placement.offsetZMm * METERS_PER_MM;
  }
}''',
)

replace_between(
    arrangement,
    "function mapArm(",
    "function mapLeg(",
    r'''function mapArm(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const width = Math.max(1, bounds.width);
  const scale = validScale(instance.placement.scale);
  const sideSign = instance.placement.bodySide === "left" ? -1 : 1;
  const frontAxis: AvatarVector3 = [0, 0, 1];
  const radialOut = normalize3([
    sideSign * (frontAxis[1] * anchor.axis[2] - frontAxis[2] * anchor.axis[1]),
    sideSign * (frontAxis[2] * anchor.axis[0] - frontAxis[0] * anchor.axis[2]),
    sideSign * (frontAxis[0] * anchor.axis[1] - frontAxis[1] * anchor.axis[0]),
  ]);
  const patternRadius = width * METERS_PER_MM * scale / (Math.PI * 2);
  const rotation = instance.placement.rotationDeg * Math.PI / 180;

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    let u = clamp01((xMm - bounds.minX) / width);
    if (instance.placement.mirrorX) u = 1 - u;
    const distance = Math.max(0, (yMm - bounds.minY) * METERS_PER_MM * scale - instance.placement.offsetYMm * METERS_PER_MM);
    const center = addScaled3(anchor.position, anchor.axis, distance);
    const radius = Math.max(sampleArmRadius(avatar, distance) + anchor.initialMarginM, patternRadius * 0.9);
    const angle = (u - 0.5) * Math.PI * 2 + rotation;
    const aroundOut = Math.cos(angle) * radius;
    const aroundFront = Math.sin(angle) * radius;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = center[0] + radialOut[0] * aroundOut + frontAxis[0] * aroundFront + instance.placement.offsetXMm * METERS_PER_MM;
    positions[offset + 1] = center[1] + radialOut[1] * aroundOut + frontAxis[1] * aroundFront;
    positions[offset + 2] = center[2] + radialOut[2] * aroundOut + frontAxis[2] * aroundFront + instance.placement.offsetZMm * METERS_PER_MM;
  }
}''',
)

replace_once(
    arrangement,
    '''function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
''',
    '''function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function smoothstep(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}
''',
)

visual = "apps/web/src/viewport/AvatarVisual.ts"
replace_once(
    visual,
    '''  addCapsule(group, "avatar:upper-arm-left", model.joints.shoulderLeft, model.joints.elbowLeft, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-left", model.joints.elbowLeft, model.joints.wristLeft, forearmRadius, material, segments, options);
  addCapsule(group, "avatar:upper-arm-right", model.joints.shoulderRight, model.joints.elbowRight, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-right", model.joints.elbowRight, model.joints.wristRight, forearmRadius, material, segments, options);''',
    '''  addCapsule(group, "avatar:upper-arm-left", model.joints.shoulderLeft, model.joints.elbowLeft, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-left", model.joints.elbowLeft, model.joints.wristLeft, forearmRadius, material, segments, options);
  addCapsule(group, "avatar:upper-arm-right", model.joints.shoulderRight, model.joints.elbowRight, upperArmRadius, material, segments, options);
  addCapsule(group, "avatar:forearm-right", model.joints.elbowRight, model.joints.wristRight, forearmRadius, material, segments, options);
  addEllipsoid(group, "avatar:shoulder-left", model.joints.shoulderLeft, [upperArmRadius * 1.08, upperArmRadius * 1.08, upperArmRadius * 1.08], material, segments, options);
  addEllipsoid(group, "avatar:shoulder-right", model.joints.shoulderRight, [upperArmRadius * 1.08, upperArmRadius * 1.08, upperArmRadius * 1.08], material, segments, options);
  addEllipsoid(group, "avatar:elbow-left", model.joints.elbowLeft, [forearmRadius * 1.12, forearmRadius * 1.12, forearmRadius * 1.12], material, segments, options);
  addEllipsoid(group, "avatar:elbow-right", model.joints.elbowRight, [forearmRadius * 1.12, forearmRadius * 1.12, forearmRadius * 1.12], material, segments, options);''',
)
replace_once(
    visual,
    '''  addCapsule(group, "avatar:thigh-left", model.joints.hipLeft, model.joints.kneeLeft, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-left", model.joints.kneeLeft, model.joints.ankleLeft, calfRadius, material, segments, options);
  addCapsule(group, "avatar:thigh-right", model.joints.hipRight, model.joints.kneeRight, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-right", model.joints.kneeRight, model.joints.ankleRight, calfRadius, material, segments, options);''',
    '''  addCapsule(group, "avatar:thigh-left", model.joints.hipLeft, model.joints.kneeLeft, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-left", model.joints.kneeLeft, model.joints.ankleLeft, calfRadius, material, segments, options);
  addCapsule(group, "avatar:thigh-right", model.joints.hipRight, model.joints.kneeRight, thighRadius, material, segments, options);
  addCapsule(group, "avatar:calf-right", model.joints.kneeRight, model.joints.ankleRight, calfRadius, material, segments, options);
  addEllipsoid(group, "avatar:hip-left", model.joints.hipLeft, [thighRadius * 1.03, thighRadius * 1.03, thighRadius * 1.03], material, segments, options);
  addEllipsoid(group, "avatar:hip-right", model.joints.hipRight, [thighRadius * 1.03, thighRadius * 1.03, thighRadius * 1.03], material, segments, options);
  addEllipsoid(group, "avatar:knee-left", model.joints.kneeLeft, [calfRadius * 1.08, calfRadius * 1.08, calfRadius * 1.08], material, segments, options);
  addEllipsoid(group, "avatar:knee-right", model.joints.kneeRight, [calfRadius * 1.08, calfRadius * 1.08, calfRadius * 1.08], material, segments, options);''',
)

styles = ROOT / "apps/web/src/styles.css"
style_source = styles.read_text(encoding="utf-8")
mobile_rule = r'''

@media (max-width: 760px) {
  .preview-panel.workspace-view.is-mobile-active {
    align-self: stretch;
    min-height: 360px;
    height: 100%;
    overflow: hidden;
  }

  .preview-panel.workspace-view.is-mobile-active .viewport-host {
    min-height: 360px;
    height: 100%;
  }
}
'''
if "min-height: 360px;\n    height: 100%;\n    overflow: hidden;" not in style_source:
    styles.write_text(style_source.rstrip() + mobile_rule.rstrip() + "\n", encoding="utf-8")

audit = ROOT / "scripts/prompt09-browser-audit.mjs"
audit_source = audit.read_text(encoding="utf-8")
audit_source = audit_source.replace(
    '''    const instanceCount = Number(inspection.dataset.garmentInstanceCount);
    const errorCount = Number(inspection.dataset.arrangementErrorCount);''',
    '''    const screenshot = `${scenario.label}.png`;
    await page.screenshot({ path: `${artifactDir}/${screenshot}`, fullPage: false });
    const instanceCount = Number(inspection.dataset.garmentInstanceCount);
    const errorCount = Number(inspection.dataset.arrangementErrorCount);''',
)
audit_source = audit_source.replace(
    '''    if (!inspection.canvasBox || inspection.canvasBox.width < 240 || inspection.canvasBox.height < 300) throw new Error(`${scenario.label}: canvas sem área adequada`);''',
    '''    if (!inspection.canvasBox || inspection.canvasBox.width < 240 || inspection.canvasBox.height < 300) throw new Error(`${scenario.label}: canvas sem área adequada ${JSON.stringify({ hostBox: inspection.hostBox, canvasBox: inspection.canvasBox })}`);''',
)
audit_source = audit_source.replace(
    '''    const screenshot = `${scenario.label}.png`;
    await page.screenshot({ path: `${artifactDir}/${screenshot}`, fullPage: false });
    results.push({''',
    '''    results.push({''',
)
audit.write_text(audit_source, encoding="utf-8")

print("Prompt 9 visual surface mapping fixed")
