from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"expected one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  grossDepenetrationEnabled: boolean;\n  bodyContactCount: number;\n''',
    '''  grossDepenetrationEnabled: boolean;\n  dressingStepsRemaining: number;\n  initialDressingSteps: number;\n  bodyContactCount: number;\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''    grossDepenetrationEnabled: true,\n    bodyContactCount: 0,\n''',
    '''    grossDepenetrationEnabled: true,\n    dressingStepsRemaining: 0,\n    initialDressingSteps: 0,\n    bodyContactCount: 0,\n''',
)

body_path = Path("apps/web/src/physics/bodyCollision.ts")
body_text = body_path.read_text(encoding="utf-8")
marker = '''export function resetBodyContactStep(body: BodyCollisionRuntimeState): void {\n'''
helper = '''export function initializeBodyDressing(\n  body: BodyCollisionRuntimeState,\n  positions: Float32Array,\n  maximumCorrectionM: number,\n): void {\n  body.dressingStepsRemaining = 0;\n  body.initialDressingSteps = 0;\n  body.grossDepenetrationEnabled = false;\n  if (!body.enabled || body.colliders.kinds.length === 0 || !Number.isFinite(maximumCorrectionM) || maximumCorrectionM <= 0) return;\n\n  let maximumPenetrationM = 0;\n  const particleCount = positions.length / 3;\n  for (let particle = 0; particle < particleCount; particle += 1) {\n    const offset = particle * 3;\n    const contact = deepestBodyContact(\n      [positions[offset], positions[offset + 1], positions[offset + 2]],\n      body.colliders,\n      body.particleHalfThicknessM[particle] + body.contactSkinM,\n    );\n    if (contact) maximumPenetrationM = Math.max(maximumPenetrationM, contact.penetrationM);\n  }\n  if (maximumPenetrationM <= EPSILON) return;\n\n  // Each gross projection is capped by maximumCorrectionM. Two passes per\n  // theoretical minimum leave room for structural constraints to relax between\n  // depenetrations without a garment-specific staging duration.\n  const minimumGrossPasses = Math.ceil(maximumPenetrationM / maximumCorrectionM);\n  body.initialDressingSteps = Math.max(1, minimumGrossPasses * 2);\n  body.dressingStepsRemaining = body.initialDressingSteps;\n  body.grossDepenetrationEnabled = true;\n}\n\n'''
if body_text.count(marker) != 1:
    raise RuntimeError(f"body dressing insertion marker mismatch: {body_text.count(marker)}")
body_path.write_text(body_text.replace(marker, helper + marker, 1), encoding="utf-8")

xpbd = Path("apps/web/src/physics/xpbd.ts")
text = xpbd.read_text(encoding="utf-8")
old = '''import { applyBodyContactVelocities, createBodyCollisionRuntimeState, finalizeBodyContactDiagnostics, resetBodyContactStep, solveBodyCollisions, type BodyCollisionRuntimeState } from "./bodyCollision";\n'''
new = '''import { applyBodyContactVelocities, createBodyCollisionRuntimeState, finalizeBodyContactDiagnostics, initializeBodyDressing, resetBodyContactStep, solveBodyCollisions, type BodyCollisionRuntimeState } from "./bodyCollision";\n'''
if text.count(old) != 1:
    raise RuntimeError(f"body import marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''  return {\n    ...input,\n    body,\n    correctionLimits: buildParticleCorrectionLimits(\n      input.positions.length / 3,\n      input.distances,\n      input.config.maximumCorrection,\n    ),\n    stablePositions: new Float32Array(input.positions),\n    maximumCorrectionApplied: 0,\n    accumulator: 0,\n    stepCount: 0,\n    invalid: false,\n    profile: { integrationMs: 0, stretchMs: 0, shearMs: 0, bendMs: 0, seamMs: 0, velocityUpdateMs: 0, validationMs: 0, solverStepTotalMs: 0, bodyCollisionMs: 0 },\n  };\n'''
new = '''  const correctionLimits = buildParticleCorrectionLimits(\n    input.positions.length / 3,\n    input.distances,\n    input.config.maximumCorrection,\n  );\n  const state: XpbdState = {\n    ...input,\n    body,\n    correctionLimits,\n    stablePositions: new Float32Array(input.positions),\n    maximumCorrectionApplied: 0,\n    accumulator: 0,\n    stepCount: 0,\n    invalid: false,\n    profile: { integrationMs: 0, stretchMs: 0, shearMs: 0, bendMs: 0, seamMs: 0, velocityUpdateMs: 0, validationMs: 0, solverStepTotalMs: 0, bodyCollisionMs: 0 },\n  };\n  initializeBodyDressing(body, state.positions, state.config.maximumCorrection);\n  return state;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"create state marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''  let phaseStarted = performance.now();\n  integrate(state, dt);\n  profile.integrationMs = performance.now() - phaseStarted;\n\n  for (let iteration = 0; iteration < state.config.iterations; iteration += 1) {\n'''
new = '''  const dressingActive = state.body.enabled && state.body.dressingStepsRemaining > 0;\n  const effectiveIterations = dressingActive\n    ? Math.max(state.config.iterations, state.config.iterations * 2)\n    : state.config.iterations;\n  let phaseStarted = performance.now();\n  integrate(state, dt, dressingActive ? [0, 0, 0] : state.config.gravity);\n  profile.integrationMs = performance.now() - phaseStarted;\n\n  for (let iteration = 0; iteration < effectiveIterations; iteration += 1) {\n'''
if text.count(old) != 1:
    raise RuntimeError(f"step integration marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''  updateVelocitiesAndPositions(state, dt);\n  applyBodyContactVelocities(state.velocities, state.body);\n  profile.velocityUpdateMs = performance.now() - phaseStarted;\n  state.stepCount += 1;\n'''
new = '''  updateVelocitiesAndPositions(state, dt);\n  applyBodyContactVelocities(state.velocities, state.body);\n  if (dressingActive) {\n    state.velocities.fill(0);\n    state.previousPositions.set(state.positions);\n    state.body.dressingStepsRemaining = Math.max(0, state.body.dressingStepsRemaining - 1);\n    if (state.body.dressingStepsRemaining === 0) state.body.grossDepenetrationEnabled = false;\n  }\n  profile.velocityUpdateMs = performance.now() - phaseStarted;\n  state.stepCount += 1;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"velocity stage marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''  resetBodyContactStep(state.body);\n  resetLambdas(state);\n'''
new = '''  resetBodyContactStep(state.body);\n  initializeBodyDressing(state.body, state.positions, state.config.maximumCorrection);\n  resetLambdas(state);\n'''
if text.count(old) != 1:
    raise RuntimeError(f"reset dressing marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''function integrate(state: XpbdState, dt: number): void {\n  const [gx, gy, gz] = state.config.gravity;\n'''
new = '''function integrate(\n  state: XpbdState,\n  dt: number,\n  gravity: readonly [number, number, number] = state.config.gravity,\n): void {\n  const [gx, gy, gz] = gravity;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"integrate marker mismatch: {text.count(old)}")
xpbd.write_text(text.replace(old, new, 1), encoding="utf-8")
