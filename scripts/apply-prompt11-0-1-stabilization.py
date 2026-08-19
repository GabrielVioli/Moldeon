from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"expected exactly one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/physics/GarmentXpbdAdapter.ts",
    '''  if (options.pinAssemblyAnchors === true) {\n    const seenPins = new Set<number>();\n    const appendPin = (particleIndex: number, x: number, y: number, z: number) => {\n      if (seenPins.has(particleIndex)) return;\n      seenPins.add(particleIndex);\n      pinIndices.push(particleIndex);\n      pinTargets.push(x, y, z);\n      inverseMasses[particleIndex] = 0;\n    };\n\n    for (const anchor of state.anchorConstraints) {\n      appendPin(anchor.particleIndex, anchor.targetX, anchor.targetY, anchor.targetZ);\n    }\n    for (const instance of state.instances) {\n      if (instance.placement.region === "custom" || instance.placement.surface === "custom") continue;\n      for (const localIndex of selectInstanceSupportVertices(instance)) {\n        const particleIndex = instance.particleStart + localIndex;\n        appendPin(\n          particleIndex,\n          positions[particleIndex * 3],\n          positions[particleIndex * 3 + 1],\n          positions[particleIndex * 3 + 2],\n        );\n      }\n    }\n  }\n''',
    '''  if (options.pinAssemblyAnchors === true) {\n    const seenPins = new Set<number>();\n    for (const anchor of state.anchorConstraints) {\n      if (seenPins.has(anchor.particleIndex)) continue;\n      seenPins.add(anchor.particleIndex);\n      pinIndices.push(anchor.particleIndex);\n      pinTargets.push(anchor.targetX, anchor.targetY, anchor.targetZ);\n      inverseMasses[anchor.particleIndex] = 0;\n    }\n  }\n''',
)

replace_once(
    "apps/web/src/physics/GarmentXpbdAdapter.ts",
    '''function selectInstanceSupportVertices(instance: AssemblyPanelInstance): number[] {\n  const boundary = [...instance.topology.boundaryVertices];\n  if (boundary.length <= 16) return boundary;\n  const xOf = (localIndex: number) => instance.topology.positions2DMm[localIndex * 2];\n  const yOf = (localIndex: number) => instance.topology.positions2DMm[localIndex * 2 + 1];\n  const topY = Math.min(...boundary.map(yOf));\n  const minX = Math.min(...boundary.map(xOf));\n  const maxX = Math.max(...boundary.map(xOf));\n  const sideTolerance = Math.max(8, (maxX - minX) * 0.04);\n  const topBand = boundary\n    .filter((localIndex) => yOf(localIndex) <= topY + 12)\n    .sort((left, right) => xOf(left) - xOf(right));\n  const sideRails = boundary\n    .filter((localIndex) => xOf(localIndex) <= minX + sideTolerance || xOf(localIndex) >= maxX - sideTolerance)\n    .sort((left, right) => yOf(left) - yOf(right));\n  const anchors = [\n    ...sampleEvenly(topBand.length >= 2 ? topBand : [...boundary].sort((left, right) => yOf(left) - yOf(right)).slice(0, 2), 8),\n    ...sampleEvenly(sideRails, 8),\n  ];\n  return uniqueNumbers(anchors);\n}\n\nfunction sampleEvenly(values: readonly number[], maximum: number): number[] {\n  if (values.length <= maximum) return [...values];\n  const result: number[] = [];\n  for (let index = 0; index < maximum; index += 1) {\n    const sourceIndex = Math.round(index * (values.length - 1) / Math.max(1, maximum - 1));\n    const value = values[sourceIndex];\n    if (!result.includes(value)) result.push(value);\n  }\n  return result;\n}\n\nfunction uniqueNumbers(values: readonly number[]): number[] {\n  return [...new Set(values)];\n}\n''',
    "",
)

replace_once(
    "apps/web/src/viewport/GlobalThreeViewport.ts",
    '''        bodyCollisionEnabled: registration.status === "registered" && this.devSettings.bodyCollisionEnabled,\n        pinAssemblyAnchors: registration.status === "registered",\n        config: {\n          gravity: this.scaledGravity(),\n          maximumSubsteps: settings.substeps,\n          iterations: registration.status === "registered" ? Math.max(settings.iterations, 24) : settings.iterations,\n          ...(registration.status === "registered" ? { maximumVelocity: 1 } : {}),\n        },\n''',
    '''        bodyCollisionEnabled: registration.status === "registered" && this.devSettings.bodyCollisionEnabled,\n        config: {\n          gravity: this.scaledGravity(),\n          maximumSubsteps: settings.substeps,\n          iterations: settings.iterations,\n        },\n''',
)
