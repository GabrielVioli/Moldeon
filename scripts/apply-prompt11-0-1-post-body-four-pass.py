from pathlib import Path

path = Path("apps/web/src/physics/xpbd.ts")
text = path.read_text(encoding="utf-8")
old = '''  phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;\n  phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;\n  phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n  phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n  enforcePins(state);\n  finalizeBodyContactDiagnostics(state.body);\n'''
new = '''  for (let postBodyIteration = 0; postBodyIteration < 4; postBodyIteration += 1) {\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 0); profile.stretchMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveShearSet(state, dt); profile.shearMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n    enforcePins(state);\n  }\n  finalizeBodyContactDiagnostics(state.body);\n'''
if text.count(old) != 1:
    raise RuntimeError(f"post-body one-pass marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
