from pathlib import Path

path = Path("apps/web/src/physics/xpbd.ts")
text = path.read_text(encoding="utf-8")
old = '''    const speed = Math.hypot(vx, vy, vz);\n    if (speed > maximumVelocity) {\n      const scale = maximumVelocity / speed;\n      vx *= scale;\n      vy *= scale;\n      vz *= scale;\n    }\n'''
new = '''    const speed = Math.hypot(vx, vy, vz);\n    // CFL-style mesh stability: a particle must not cross more than its local\n    // structural edge scale in one fixed step. correctionLimits are defined\n    // as 10% of the smallest incident structural edge, so x10 recovers that\n    // local edge length without a garment- or scene-specific speed constant.\n    const localEdgeLengthM = state.correctionLimits[particle] * 10;\n    const localMaximumVelocity = localEdgeLengthM > EPSILON\n      ? Math.min(maximumVelocity, localEdgeLengthM / dt)\n      : maximumVelocity;\n    if (speed > localMaximumVelocity) {\n      const scale = localMaximumVelocity / speed;\n      vx *= scale;\n      vy *= scale;\n      vz *= scale;\n    }\n'''
if text.count(old) != 1:
    raise RuntimeError(f"velocity clamp marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
