from pathlib import Path

path = Path("apps/web/src/physics/bodyCollision.ts")
text = path.read_text(encoding="utf-8")
old = '''    let correction = Math.hypot(correctionX, correctionY, correctionZ);\n    if (!contact.swept) {\n      const localLimit = Math.max(1e-6, Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM));\n      const limit = contact.penetrationM > localLimit ? input.maximumCorrectionM : localLimit;\n'''
new = '''    let correction = Math.hypot(correctionX, correctionY, correctionZ);\n    const localLimit = Math.max(1e-6, Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM));\n    const grossPenetration = !contact.swept && contact.penetrationM > localLimit;\n    if (!contact.swept) {\n      const limit = grossPenetration ? input.maximumCorrectionM : localLimit;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"body correction marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''    body.normalImpulseSpeed[particle] = Math.max(body.normalImpulseSpeed[particle], inwardSpeed);\n'''
new = '''    const settledContactImpulseSpeed = !contact.swept && !grossPenetration\n      ? correction / Math.max(input.fixedTimeStep, EPSILON)\n      : 0;\n    body.normalImpulseSpeed[particle] = Math.max(\n      body.normalImpulseSpeed[particle],\n      inwardSpeed,\n      settledContactImpulseSpeed,\n    );\n'''
if text.count(old) != 1:
    raise RuntimeError(f"friction impulse marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
