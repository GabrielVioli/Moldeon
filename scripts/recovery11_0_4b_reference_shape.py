from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

old = '''const DEFAULT_VISUAL_RESOLUTION = [40, 82, 34] as const;
const DEFAULT_COLLISION_RESOLUTION = [28, 58, 24] as const;
'''
new = '''// Reference-shape calibration targets the canonical technical mannequin:
// pronounced but integrated bust, narrow waist, broad pelvis/glutes and full
// proximal thighs. Circumferences stay metric-driven; only volume distribution
// changes. Both LODs sample this exact same field.
const DEFAULT_VISUAL_RESOLUTION = [44, 92, 38] as const;
const DEFAULT_COLLISION_RESOLUTION = [30, 64, 26] as const;
'''
if old not in text:
    raise RuntimeError("resolution block not found")
text = text.replace(old, new, 1)

old = '''  const hipHalf = Math.max(0.055, m.fullHipMm * 0.000085);
  const hipLeft: HumanBodyVector3 = [-hipHalf, crotchY + 0.045, -0.008];
  const hipRight: HumanBodyVector3 = [hipHalf, crotchY + 0.045, -0.008];
  const kneeLeft: HumanBodyVector3 = [-hipHalf * 0.82, kneeY, 0.002];
  const kneeRight: HumanBodyVector3 = [hipHalf * 0.82, kneeY, 0.002];
  const ankleLeft: HumanBodyVector3 = [-hipHalf * 0.78, ankleY, 0.006];
  const ankleRight: HumanBodyVector3 = [hipHalf * 0.78, ankleY, 0.006];
'''
new = '''  // The leg roots sit close enough to create a natural groin while the
  // implicit crotch carve produces the actual bifurcation. This avoids the
  // old mannequin look where two capsule legs begin outside the pelvis.
  const hipHalf = Math.max(0.052, Math.min(m.fullHipMm * 0.000078, m.shoulderWidthMm * 0.000205));
  const hipLeft: HumanBodyVector3 = [-hipHalf, crotchY + 0.055, -0.010];
  const hipRight: HumanBodyVector3 = [hipHalf, crotchY + 0.055, -0.010];
  const kneeLeft: HumanBodyVector3 = [-hipHalf * 0.78, kneeY, 0.004];
  const kneeRight: HumanBodyVector3 = [hipHalf * 0.78, kneeY, 0.004];
  const ankleLeft: HumanBodyVector3 = [-hipHalf * 0.72, ankleY, 0.010];
  const ankleRight: HumanBodyVector3 = [hipHalf * 0.72, ankleY, 0.010];
'''
if old not in text:
    raise RuntimeError("leg frame block not found")
text = text.replace(old, new, 1)

old = '''  return [
    section("crotch", "crotch", frame.crotchY, crotchCirc, 1.38, 1.02, 0.98, 0.004, 0.00, 0.03, 0.24),
    section("full-hip", "full-hip", frame.fullHipY, m.fullHipMm, 1.46, 0.92, 1.08, 0.000, 0.050, 0.060, 0.26),
    section("high-hip", "high-hip", frame.highHipY, m.highHipMm, 1.43, 1.02, 1.00, 0.008, 0.018, 0.022, 0.24),
    section("abdomen", "abdomen", lerp(frame.highHipY, frame.waistY, 0.46), abdomenCirc, 1.33, 1.08, 0.96, 0.012, 0.000, 0.000, 0.22),
    section("waist", "waist", frame.waistY, m.waistMm, 1.34, 1.02, 0.98, 0.004, 0.000, 0.000, 0.22),
    section("underbust", "underbust", frame.underbustY, m.underbustMm, 1.32, 1.04, 0.96, 0.006, 0.008, 0.000, 0.21),
    section("bust", "chest-front", frame.bustY, m.bustMm, 1.30, 1.02, 0.92, 0.010, 0.050, 0.000, clamp(m.bustPointDistanceMm / m.bustMm, 0.16, 0.27)),
    section("upper-chest", "chest-front", frame.upperChestY, upperChestCirc, 1.42, 0.96, 1.02, 0.004, 0.014, 0.000, 0.22),
    section("shoulder", "back-upper", frame.shoulderY, shoulderCirc, 1.70, 0.88, 1.12, -0.002, 0.000, 0.000, 0.22),
  ];
'''
new = '''  return [
    // Ratios below describe distribution only. section() rescales every shape
    // back to its authored target circumference after the reference profile is
    // applied, so the silhouette can be curvier without lying about measures.
    section("crotch", "crotch", frame.crotchY, crotchCirc, 1.42, 1.00, 1.02, 0.002, 0.00, 0.045, 0.27),
    section("full-hip", "full-hip", frame.fullHipY, m.fullHipMm, 1.58, 0.88, 1.18, -0.006, 0.035, 0.125, 0.29),
    section("high-hip", "high-hip", frame.highHipY, m.highHipMm, 1.51, 0.98, 1.08, 0.002, 0.018, 0.055, 0.27),
    section("abdomen", "abdomen", lerp(frame.highHipY, frame.waistY, 0.46), abdomenCirc, 1.31, 1.09, 0.97, 0.012, 0.000, 0.000, 0.22),
    section("waist", "waist", frame.waistY, m.waistMm, 1.31, 1.03, 0.97, 0.004, 0.000, 0.000, 0.22),
    section("underbust", "underbust", frame.underbustY, m.underbustMm, 1.31, 1.04, 0.96, 0.005, 0.010, 0.000, 0.22),
    section("bust", "chest-front", frame.bustY, m.bustMm, 1.27, 0.98, 0.89, 0.006, 0.110, 0.000, clamp(m.bustPointDistanceMm / m.bustMm, 0.18, 0.29)),
    section("upper-chest", "chest-front", frame.upperChestY, upperChestCirc, 1.45, 0.93, 1.04, 0.000, 0.018, 0.000, 0.23),
    section("shoulder", "back-upper", frame.shoulderY, shoulderCirc, 1.78, 0.84, 1.12, -0.005, 0.000, 0.000, 0.22),
  ];
'''
if old not in text:
    raise RuntimeError("torso reference stations not found")
text = text.replace(old, new, 1)

old = '''  const armField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const shoulder = side < 0 ? frame.shoulderLeft : frame.shoulderRight;
    const elbow = side < 0 ? frame.elbowLeft : frame.elbowRight;
    const wrist = side < 0 ? frame.wristLeft : frame.wristRight;
    const upper = sweptEllipseField([x, y, z], shoulder, elbow, upperArmAxes[0], upperArmAxes[1], elbowAxes[0], elbowAxes[1]);
    const lower = sweptEllipseField([x, y, z], elbow, wrist, elbowAxes[0], elbowAxes[1], wristAxes[0], wristAxes[1]);
    const handCenter: HumanBodyVector3 = [wrist[0] + side * wristAxes[0] * 0.08, wrist[1] - handLength * 0.43, wrist[2] + handLength * 0.04];
    const hand = ellipsoidField(x, y, z, handCenter, [wristAxes[0] * 1.15, handLength * 0.46, wristAxes[1] * 0.78]);
    return smoothMin(smoothMin(upper, lower, 0.010), hand, 0.008);
  };
'''
new = '''  const armField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const shoulder = side < 0 ? frame.shoulderLeft : frame.shoulderRight;
    const elbow = side < 0 ? frame.elbowLeft : frame.elbowRight;
    const wrist = side < 0 ? frame.wristLeft : frame.wristRight;
    const upper = sweptEllipseField([x, y, z], shoulder, elbow, upperArmAxes[0] * 1.04, upperArmAxes[1] * 1.08, elbowAxes[0], elbowAxes[1]);
    const lower = sweptEllipseField([x, y, z], elbow, wrist, elbowAxes[0], elbowAxes[1], wristAxes[0], wristAxes[1]);
    // Deltoid/clavicle bridge is part of the same implicit surface. It creates
    // the soft shoulder-to-arm transition visible in the reference instead of
    // a sphere glued to a capsule.
    const shoulderCapCenter: HumanBodyVector3 = [shoulder[0] * 0.965, shoulder[1] - 0.025, shoulder[2] - 0.004];
    const shoulderCap = ellipsoidField(
      x,
      y,
      z,
      shoulderCapCenter,
      [upperArmAxes[0] * 1.35, upperArmAxes[0] * 1.22, upperArmAxes[1] * 1.18],
    );
    const handCenter: HumanBodyVector3 = [wrist[0] + side * wristAxes[0] * 0.08, wrist[1] - handLength * 0.43, wrist[2] + handLength * 0.04];
    const hand = ellipsoidField(x, y, z, handCenter, [wristAxes[0] * 1.15, handLength * 0.46, wristAxes[1] * 0.78]);
    return smoothMin(smoothMin(smoothMin(upper, lower, 0.012), shoulderCap, 0.020), hand, 0.008);
  };
'''
if old not in text:
    raise RuntimeError("arm field block not found")
text = text.replace(old, new, 1)

old = '''  const legField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const hip = side < 0 ? frame.hipLeft : frame.hipRight;
    const knee = side < 0 ? frame.kneeLeft : frame.kneeRight;
    const ankle = side < 0 ? frame.ankleLeft : frame.ankleRight;
    const upper = sweptEllipseField([x, y, z], hip, knee, thighAxes[0], thighAxes[1], kneeAxes[0], kneeAxes[1]);
    const lower = sweptEllipseField([x, y, z], knee, ankle, kneeAxes[0], kneeAxes[1], ankleAxes[0], ankleAxes[1], 0.12, calfAxes);
    const footCenter: HumanBodyVector3 = [ankle[0], Math.max(0.025, frame.ankleY * 0.48), footLength * 0.34];
    const foot = ellipsoidField(x, y, z, footCenter, [ankleAxes[0] * 1.02, Math.max(0.025, frame.ankleY * 0.50), footLength * 0.55]);
    return smoothMin(smoothMin(upper, lower, 0.012), foot, 0.010);
  };
'''
new = '''  const legField = (side: -1 | 1, x: number, y: number, z: number): number => {
    const hip = side < 0 ? frame.hipLeft : frame.hipRight;
    const knee = side < 0 ? frame.kneeLeft : frame.kneeRight;
    const ankle = side < 0 ? frame.ankleLeft : frame.ankleRight;
    // Full proximal thigh with a gradual taper is a defining part of the target
    // mannequin silhouette. The bulge uses the measured thigh ellipse as its
    // maximum section instead of scaling the whole leg.
    const thighRootAxes: readonly [number, number] = [thighAxes[0] * 0.94, thighAxes[1] * 0.96];
    const upper = sweptEllipseField(
      [x, y, z],
      hip,
      knee,
      thighRootAxes[0],
      thighRootAxes[1],
      kneeAxes[0],
      kneeAxes[1],
      0.88,
      thighAxes,
    );
    const lower = sweptEllipseField([x, y, z], knee, ankle, kneeAxes[0], kneeAxes[1], ankleAxes[0], ankleAxes[1], 0.72, calfAxes);
    const footCenter: HumanBodyVector3 = [ankle[0], Math.max(0.025, frame.ankleY * 0.48), footLength * 0.34];
    const foot = ellipsoidField(x, y, z, footCenter, [ankleAxes[0] * 1.02, Math.max(0.025, frame.ankleY * 0.50), footLength * 0.55]);
    return smoothMin(smoothMin(upper, lower, 0.014), foot, 0.010);
  };
'''
if old not in text:
    raise RuntimeError("leg field block not found")
text = text.replace(old, new, 1)

old = '''    const separator = ellipsoidField(
      x,
      y,
      z,
      [0, frame.crotchY - 0.055, 0.020],
      [Math.max(0.018, Math.abs(frame.hipRight[0]) * 0.42), 0.155, Math.max(0.075, m.crotchDepthMm * 0.00038)],
    );
    if (y <= frame.crotchY + 0.025) body = Math.max(body, -separator);
'''
new = '''    const separator = ellipsoidField(
      x,
      y,
      z,
      [0, frame.crotchY - 0.062, 0.016],
      [Math.max(0.016, Math.abs(frame.hipRight[0]) * 0.34), 0.175, Math.max(0.070, m.crotchDepthMm * 0.00036)],
    );
    if (y <= frame.crotchY + 0.030) body = Math.max(body, -separator);
'''
if old not in text:
    raise RuntimeError("crotch separator block not found")
text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
