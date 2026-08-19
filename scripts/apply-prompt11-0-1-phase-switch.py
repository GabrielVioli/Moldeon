from pathlib import Path

path = Path("apps/web/src/physics/bodyCollision.ts")
text = path.read_text(encoding="utf-8")
old = '''  normalImpulseSpeed: Float32Array;\n  contactSkinM: number;\n'''
new = '''  normalImpulseSpeed: Float32Array;\n  contactSkinM: number;\n  grossDepenetrationEnabled: boolean;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"body runtime field marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''    normalImpulseSpeed: new Float32Array(particleHalfThicknessM.length),\n    contactSkinM,\n'''
new = '''    normalImpulseSpeed: new Float32Array(particleHalfThicknessM.length),\n    contactSkinM,\n    grossDepenetrationEnabled: true,\n'''
if text.count(old) != 1:
    raise RuntimeError(f"body runtime init marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''    const grossPenetration = !contact.swept && contact.penetrationM > localLimit;\n'''
new = '''    const grossPenetration = body.grossDepenetrationEnabled\n      && !contact.swept\n      && contact.penetrationM > localLimit;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"gross penetration marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''      const maximumSweepCorrection = Math.max(input.maximumCorrectionM, 12 * input.fixedTimeStep);\n'''
new = '''      const maximumSweepCorrection = body.grossDepenetrationEnabled\n        ? input.maximumCorrectionM\n        : localLimit;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"swept correction marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
