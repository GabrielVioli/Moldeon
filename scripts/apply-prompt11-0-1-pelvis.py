from pathlib import Path

path = Path("apps/web/src/avatar/AvatarCollisionModel.ts")
text = path.read_text(encoding="utf-8")
old = '''  const hip = sampleTorsoAxes(model, model.landmarks.hipY);\n  const headHeight = Math.max(0.18, model.landmarks.headTopY - model.landmarks.neckY);\n'''
new = '''  const hip = sampleTorsoAxes(model, model.landmarks.hipY);\n  const pelvisHalfHeight = pelvisVerticalRadius(\n    model.landmarks.waistY,\n    model.landmarks.hipY,\n    model.landmarks.crotchY,\n    waist.halfWidth,\n    waist.halfDepth,\n    hip.halfWidth,\n    hip.halfDepth,\n  );\n  const headHeight = Math.max(0.18, model.landmarks.headTopY - model.landmarks.neckY);\n'''
if text.count(old) != 1:
    raise RuntimeError(f"pelvis setup marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''      {\n        id: "collision:pelvis",\n        kind: "ellipsoid",\n        center: [0, (model.landmarks.waistY + model.landmarks.crotchY) / 2, 0],\n        radii: [hip.halfWidth, (model.landmarks.waistY - model.landmarks.crotchY) * 0.58, hip.halfDepth],\n        region: "hip",\n      },\n'''
new = '''      {\n        id: "collision:pelvis",\n        kind: "ellipsoid",\n        center: [0, model.landmarks.hipY, 0],\n        radii: [hip.halfWidth, pelvisHalfHeight, hip.halfDepth],\n        region: "hip",\n      },\n'''
if text.count(old) != 1:
    raise RuntimeError(f"pelvis proxy marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
text += '''\nfunction pelvisVerticalRadius(\n  waistY: number,\n  hipY: number,\n  crotchY: number,\n  waistHalfWidth: number,\n  waistHalfDepth: number,\n  hipHalfWidth: number,\n  hipHalfDepth: number,\n): number {\n  const waistOffset = Math.abs(waistY - hipY);\n  const crotchOffset = Math.abs(hipY - crotchY);\n  const widthRadius = ellipsoidRadiusForCrossSection(waistOffset, waistHalfWidth, hipHalfWidth);\n  const depthRadius = ellipsoidRadiusForCrossSection(waistOffset, waistHalfDepth, hipHalfDepth);\n  return Math.max(waistOffset, crotchOffset, widthRadius, depthRadius, 1e-4);\n}\n\nfunction ellipsoidRadiusForCrossSection(\n  verticalOffset: number,\n  targetHalfAxis: number,\n  maximumHalfAxis: number,\n): number {\n  if (verticalOffset <= 1e-9 || maximumHalfAxis <= 1e-9) return verticalOffset;\n  const ratio = Math.min(0.999999, Math.max(0, targetHalfAxis / maximumHalfAxis));\n  const denominator = Math.sqrt(Math.max(1e-9, 1 - ratio * ratio));\n  return verticalOffset / denominator;\n}\n'''
path.write_text(text, encoding="utf-8")
