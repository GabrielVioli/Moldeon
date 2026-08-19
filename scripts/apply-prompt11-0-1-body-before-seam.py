from pathlib import Path

path = Path("apps/web/src/physics/xpbd.ts")
text = path.read_text(encoding="utf-8")
old = '''    phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now();\n    solveBodyCollisions({ predictedPositions: state.predictedPositions, previousPositions: state.previousPositions, inverseMasses: state.inverseMasses, correctionLimits: state.correctionLimits, maximumCorrectionM: state.config.maximumCorrection, fixedTimeStep: dt, body: state.body, allowSwept: iteration === 0 });\n    profile.bodyCollisionMs += performance.now() - phaseStarted;\n    enforcePins(state);\n'''
new = '''    phaseStarted = performance.now(); solveDistanceSet(state, dt, 1); profile.bendMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now();\n    solveBodyCollisions({ predictedPositions: state.predictedPositions, previousPositions: state.previousPositions, inverseMasses: state.inverseMasses, correctionLimits: state.correctionLimits, maximumCorrectionM: state.config.maximumCorrection, fixedTimeStep: dt, body: state.body, allowSwept: iteration === 0 });\n    profile.bodyCollisionMs += performance.now() - phaseStarted;\n    phaseStarted = performance.now(); solveSeamSet(state, dt); profile.seamMs += performance.now() - phaseStarted;\n    enforcePins(state);\n'''
if text.count(old) != 1:
    raise RuntimeError(f"XPBD phase ordering marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
