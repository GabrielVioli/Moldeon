from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"expected exactly one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/physics/bodyCollision.test.ts",
    '''    expect(predicted.every(Number.isFinite)).toBe(true);\n    expect(Math.hypot(...predicted)).toBeLessThanOrEqual(0.020001);\n''',
    '''    expect(predicted.every(Number.isFinite)).toBe(true);\n    expect(Math.hypot(...predicted)).toBeGreaterThan(0.02);\n    expect(Math.hypot(...predicted)).toBeLessThanOrEqual(0.035001);\n    expect(body.normalImpulseSpeed[0]).toBe(0);\n''',
)

replace_once(
    "apps/web/src/physics/bodyCollisionRegistration.test.ts",
    '''    const xpbd = createXpbdWorkerState(buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {\n      bodyColliders,\n      bodyCollisionEnabled: true,\n      pinAssemblyAnchors: true,\n      config: { gravity: [0, -9.81, 0], iterations: 24, maximumSubsteps: 6, maximumVelocity: 1 },\n    }));\n''',
    '''    const xpbd = createXpbdWorkerState(buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {\n      bodyColliders,\n      bodyCollisionEnabled: true,\n      config: {\n        gravity: [0, -9.81, 0],\n        iterations: input.assemblyDocument.simulationSettings.iterations,\n        maximumSubsteps: input.assemblyDocument.simulationSettings.substeps,\n      },\n    }));\n''',
)

replace_once(
    "apps/web/src/physics/bodyCollisionRegistration.test.ts",
    '''    expect(registration.status).toBe("registered");\n    expect(registration.registeredInstanceIds.length).toBeGreaterThan(0);\n''',
    '''    expect(registration.status).toBe("registered");\n    expect(registration.source).toBe("lower-shell-top-plane");\n    expect(registration.registeredInstanceIds.length).toBeGreaterThan(0);\n''',
)
