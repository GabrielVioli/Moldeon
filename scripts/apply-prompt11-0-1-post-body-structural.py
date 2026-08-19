from pathlib import Path

path = Path("apps/web/src/physics/xpbd.ts")
text = path.read_text(encoding="utf-8")
old = '''  profile.bodyCollisionMs = performance.now() - phaseStarted;\n  enforcePins(state);\n  finalizeBodyContactDiagnostics(state.body);\n'''
new = '''  profile.bodyCollisionMs = performance.now() - phaseStarted;\n  enforcePins(state);\n  // Body collision is intentionally evaluated once per step. Re-project one\n  // structural XPBD pass afterwards so contact correction cannot be the final\n  // operator that leaves stretch/shear/seams outside their material manifold.\n  phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;\n  phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;\n  phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n  phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n  enforcePins(state);\n  finalizeBodyContactDiagnostics(state.body);\n'''
if text.count(old) != 1:
    raise RuntimeError(f"post-body structural marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
