from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"expected exactly one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  contactNormals: Float32Array;\n  contactMask: Uint8Array;\n''',
    '''  contactNormals: Float32Array;\n  contactCorrections: Float32Array;\n  contactMask: Uint8Array;\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''    contactNormals: new Float32Array(particleHalfThicknessM.length * 3),\n    contactMask: new Uint8Array(particleHalfThicknessM.length),\n''',
    '''    contactNormals: new Float32Array(particleHalfThicknessM.length * 3),\n    contactCorrections: new Float32Array(particleHalfThicknessM.length * 3),\n    contactMask: new Uint8Array(particleHalfThicknessM.length),\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''  body.contactNormals.fill(0);\n  body.contactMask.fill(0);\n''',
    '''  body.contactNormals.fill(0);\n  body.contactCorrections.fill(0);\n  body.contactMask.fill(0);\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''    body.contactNormals[offset] = contact.normal[0];\n    body.contactNormals[offset + 1] = contact.normal[1];\n    body.contactNormals[offset + 2] = contact.normal[2];\n''',
    '''    body.contactNormals[offset] = contact.normal[0];\n    body.contactNormals[offset + 1] = contact.normal[1];\n    body.contactNormals[offset + 2] = contact.normal[2];\n    body.contactCorrections[offset] += correctionX;\n    body.contactCorrections[offset + 1] += correctionY;\n    body.contactCorrections[offset + 2] += correctionZ;\n''',
)
replace_once(
    "apps/web/src/physics/bodyCollision.ts",
    '''export function applyBodyContactVelocities(velocities: Float32Array, body: BodyCollisionRuntimeState): void {\n  body.frictionContactCount = 0;\n  for (let particle = 0; particle < body.contactMask.length; particle += 1) {\n    if (!body.contactMask[particle]) continue;\n    const offset = particle * 3;\n    const friction = body.particleFriction[particle];\n    const next = applyBodyContactVelocity(\n      [velocities[offset], velocities[offset + 1], velocities[offset + 2]],\n''',
    '''export function applyBodyContactVelocities(\n  velocities: Float32Array,\n  body: BodyCollisionRuntimeState,\n  fixedTimeStep = 1,\n): void {\n  body.frictionContactCount = 0;\n  const inverseDt = 1 / Math.max(fixedTimeStep, EPSILON);\n  for (let particle = 0; particle < body.contactMask.length; particle += 1) {\n    if (!body.contactMask[particle]) continue;\n    const offset = particle * 3;\n    const friction = body.particleFriction[particle];\n    const physicalVelocity: [number, number, number] = [\n      velocities[offset] - body.contactCorrections[offset] * inverseDt,\n      velocities[offset + 1] - body.contactCorrections[offset + 1] * inverseDt,\n      velocities[offset + 2] - body.contactCorrections[offset + 2] * inverseDt,\n    ];\n    const next = applyBodyContactVelocity(\n      physicalVelocity,\n''',
)
replace_once(
    "apps/web/src/physics/xpbd.ts",
    '''  applyBodyContactVelocities(state.velocities, state.body);\n''',
    '''  applyBodyContactVelocities(state.velocities, state.body, dt);\n''',
)
