from pathlib import Path

path = Path("apps/web/src/physics/bodyCollision.ts")
text = path.read_text(encoding="utf-8")
old = '''      const limit = grossPenetration ? input.maximumCorrectionM : localLimit;\n'''
new = '''      const limit = localLimit;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"regular body correction limit marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''      const maximumSweepCorrection = Math.max(input.maximumCorrectionM, 12 * input.fixedTimeStep);\n'''
new = '''      const maximumSweepCorrection = Math.max(\n        1e-6,\n        Math.min(input.maximumCorrectionM, input.correctionLimits[particle] || input.maximumCorrectionM),\n      );\n'''
if text.count(old) != 1:
    raise RuntimeError(f"swept body correction limit marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
