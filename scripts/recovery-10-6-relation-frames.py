from pathlib import Path

root = Path('.')

# Preserve seam direction in each generated stitch correspondence.
path = root / 'apps/web/src/garment3d/GarmentAssembly.ts'
text = path.read_text()
old = '''  slackMm: number;\n  a: GlobalPointReference;'''
new = '''  slackMm: number;\n  /** Original material correspondence direction from the canonical SeamGroup. */\n  direction?: "same" | "opposite";\n  a: GlobalPointReference;'''
assert old in text
text = text.replace(old, new, 1)
old = '''          slackMm,\n          a,\n          b,'''
new = '''          slackMm,\n          direction: seam.direction,\n          a,\n          b,'''
assert old in text
text = text.replace(old, new, 1)
path.write_text(text)

# Material graph relations now carry explicit local frames, not only sampled positions.
path = root / 'apps/web/src/garment3d/ConstraintSpatialAssembly.ts'
text = path.read_text()
old = '''  characteristicLengthM: number;\n  treatment: string;\n  targetRatio: number;\n  slackMm: number;\n}'''
new = '''  characteristicLengthM: number;\n  treatment: string;\n  targetRatio: number;\n  slackMm: number;\n  direction: "same" | "opposite";\n  /** Tangentes no espaço material 2D do painel, embutidas em XY. */\n  localTangentA: Vec3;\n  localTangentB: Vec3;\n  /** Vetores laterais do contorno no espaço material, derivados das tangentes. */\n  localBoundaryOrientationA: Vec3;\n  localBoundaryOrientationB: Vec3;\n}'''
assert old in text
text = text.replace(old, new, 1)

old = '''    relationMap.set(relationId, {\n      id: relationId,\n      seamGroupId: stitch.seamGroupId || stitch.seamId,\n      panelA: normalized.panelA,\n      panelB: normalized.panelB,\n      samples: [sample],\n      classification,\n      structuralWeight: classificationWeight(classification),\n      characteristicLengthM: characteristicLengthFromStitch(stitch),\n      treatment: stitch.treatment,\n      targetRatio: stitch.targetRatio,\n      slackMm: stitch.slackMm,\n    });'''
new = '''    relationMap.set(relationId, {\n      id: relationId,\n      seamGroupId: stitch.seamGroupId || stitch.seamId,\n      panelA: normalized.panelA,\n      panelB: normalized.panelB,\n      samples: [sample],\n      classification,\n      structuralWeight: classificationWeight(classification),\n      characteristicLengthM: characteristicLengthFromStitch(stitch),\n      treatment: stitch.treatment,\n      targetRatio: stitch.targetRatio,\n      slackMm: stitch.slackMm,\n      direction: stitch.direction ?? "same",\n      localTangentA: [0, 0, 0],\n      localTangentB: [0, 0, 0],\n      localBoundaryOrientationA: [0, 0, 0],\n      localBoundaryOrientationB: [0, 0, 0],\n    });'''
assert old in text
text = text.replace(old, new, 1)

old = '''  const relations = [...relationMap.values()]\n    .map((relation) => ({\n      ...relation,\n      samples: [...relation.samples].sort((left, right) => left.progress - right.progress || left.id.localeCompare(right.id)),\n      characteristicLengthM: Math.max(\n        0.001,\n        relation.characteristicLengthM,\n        sampledRelationLength(state.positions, relation),\n      ),\n    }))'''
new = '''  const relations = [...relationMap.values()]\n    .map((relation) => {\n      const samples = [...relation.samples].sort((left, right) => left.progress - right.progress || left.id.localeCompare(right.id));\n      const panelA = instanceById.get(relation.panelA);\n      const panelB = instanceById.get(relation.panelB);\n      const localTangentA = panelA ? localMaterialTangent(panelA, samples, "a") : [0, 0, 0] as Vec3;\n      const localTangentB = panelB ? localMaterialTangent(panelB, samples, "b") : [0, 0, 0] as Vec3;\n      return {\n        ...relation,\n        samples,\n        characteristicLengthM: Math.max(\n          0.001,\n          relation.characteristicLengthM,\n          sampledRelationLength(state.positions, relation),\n        ),\n        localTangentA,\n        localTangentB,\n        localBoundaryOrientationA: [-localTangentA[1], localTangentA[0], 0] as Vec3,\n        localBoundaryOrientationB: [-localTangentB[1], localTangentB[0], 0] as Vec3,\n      };\n    })'''
assert old in text
text = text.replace(old, new, 1)

marker = '''function sampledRelationLength(\n  positions: Float32Array,\n  relation: GarmentSpatialConstraintRelation,\n): number {'''
helper = '''function localMaterialTangent(\n  instance: AssemblyPanelInstance,\n  samples: readonly SpatialConstraintSample[],\n  side: "a" | "b",\n): Vec3 {\n  if (samples.length < 2) return [0, 0, 0];\n  const first = evaluateLocalReference(instance, samples[0][side]);\n  const last = evaluateLocalReference(instance, samples[samples.length - 1][side]);\n  return normalize(subtract(last, first));\n}\n\nfunction evaluateLocalReference(\n  instance: AssemblyPanelInstance,\n  reference: GlobalPointReference,\n): Vec3 {\n  let result: Vec3 = [0, 0, 0];\n  let total = 0;\n  for (let index = 0; index < reference.particleIndices.length; index += 1) {\n    const globalParticle = reference.particleIndices[index];\n    const local = globalParticle - instance.particleStart;\n    if (local < 0 || local >= instance.vertexCount) continue;\n    const weight = reference.weights[index] ?? 0;\n    result = add(result, [\n      instance.topology.positions2DMm[local * 2] * 0.001 * weight,\n      -instance.topology.positions2DMm[local * 2 + 1] * 0.001 * weight,\n      0,\n    ]);\n    total += weight;\n  }\n  return total > EPS && Math.abs(total - 1) > 1e-8 ? scale(result, 1 / total) : result;\n}\n\n'''
assert marker in text
text = text.replace(marker, helper + marker, 1)
path.write_text(text)
print('Prompt 10.6 material relation frames applied')
