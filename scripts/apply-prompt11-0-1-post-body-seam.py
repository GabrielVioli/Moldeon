from pathlib import Path

path = Path("apps/web/src/physics/xpbd.ts")
text = path.read_text(encoding="utf-8")
old = '''  profile.bodyCollisionMs = performance.now() - phaseStarted;\n  enforcePins(state);\n  finalizeBodyContactDiagnostics(state.body);\n'''
new = '''  profile.bodyCollisionMs = performance.now() - phaseStarted;\n  enforcePins(state);\n  // Body projection runs once for performance; close material seams once more\n  // afterwards so a large dressing depenetration cannot be the final operator\n  // that re-opens darts or structural closures.\n  phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n  enforcePins(state);\n  finalizeBodyContactDiagnostics(state.body);\n'''
if text.count(old) != 1:
    raise RuntimeError(f"post-body seam marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
