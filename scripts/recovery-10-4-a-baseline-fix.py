from pathlib import Path
p=Path('apps/web/src/physics/xpbd.ts')
s=p.read_text()
s=s.replace('  integrationMs: number;\n  stretchMs: number;\n  shearMs: number;\n  bendMs: number;\n  seamMs: number;\n  velocityUpdateMs: number;\n  validationMs: number;\n  solverStepTotalMs: number;\n  iterations: number;\n  maximumSubsteps: number;\n}', '  integrationMs?: number;\n  stretchMs?: number;\n  shearMs?: number;\n  bendMs?: number;\n  seamMs?: number;\n  velocityUpdateMs?: number;\n  validationMs?: number;\n  solverStepTotalMs?: number;\n  iterations?: number;\n  maximumSubsteps?: number;\n}', 1)
s=s.replace('function validateStateShape(input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid">): void {', 'function validateStateShape(input: Omit<XpbdState, "correctionLimits" | "stablePositions" | "maximumCorrectionApplied" | "accumulator" | "stepCount" | "invalid" | "profile">): void {')
p.write_text(s)
