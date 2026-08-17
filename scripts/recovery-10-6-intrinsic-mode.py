from pathlib import Path
path = Path('apps/web/src/garment3d/ConstraintSpatialAssembly.ts')
text = path.read_text()

old = '''    const candidates: Array<{ name: string; positions: Float32Array }> = [\n      { name: "legacy-geometric-seed", positions: new Float32Array(legacyStatePositions) },\n      { name: "material-flat-seed", positions: new Float32Array(intrinsicFlatStatePositions) },\n    ];'''
new = '''    const candidates: Array<{\n      name: string;\n      positions: Float32Array;\n      intrinsicMode: "existing-embedding" | "euclidean";\n    }> = [\n      {\n        name: "legacy-geometric-seed",\n        positions: new Float32Array(legacyStatePositions),\n        intrinsicMode: "existing-embedding",\n      },\n      {\n        name: "material-flat-seed",\n        positions: new Float32Array(intrinsicFlatStatePositions),\n        intrinsicMode: "euclidean",\n      },\n    ];'''
assert old in text
text = text.replace(old, new, 1)
old = '''      candidates.push({\n        name: "material-flat-hinge-positive",\n        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, 1),\n      });\n      candidates.push({\n        name: "material-flat-hinge-negative",\n        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, -1),\n      });'''
new = '''      candidates.push({\n        name: "material-flat-hinge-positive",\n        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, 1),\n        intrinsicMode: "euclidean",\n      });\n      candidates.push({\n        name: "material-flat-hinge-negative",\n        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, -1),\n        intrinsicMode: "euclidean",\n      });'''
assert old in text
text = text.replace(old, new, 1)
old = '''        candidate.name,\n      );'''
new = '''        candidate.name,\n        candidate.intrinsicMode,\n      );'''
assert old in text
text = text.replace(old, new, 1)
old = '''      if (!instance?.arrangement) continue;\n      instance.arrangement.outwardNormal = representativeNormal(state.positions, instance);\n      instance.arrangement.mapping = "constraint-spatial-shell";'''
new = '''      if (!instance?.arrangement) continue;\n      instance.arrangement.outwardNormal = representativeNormal(state.positions, instance);\n      // The component strategy is constraint-based, but a validated analytical\n      // embedding remains an internal representation of this individual panel.\n      // Keeping it prevents the global solver from erasing geodesic/isometric\n      // metadata for self-seam tubes and bands.\n      if (instance.arrangement.mapping !== "seam-derived-tube") {\n        instance.arrangement.mapping = "constraint-spatial-shell";\n      }'''
assert old in text
text = text.replace(old, new, 1)
old = '''  options: ConstraintSpatialAssemblyOptions,\n  name: string,\n): CandidateSolution {'''
new = '''  options: ConstraintSpatialAssemblyOptions,\n  name: string,\n  intrinsicMode: "existing-embedding" | "euclidean",\n): CandidateSolution {'''
assert old in text
text = text.replace(old, new, 1)
old = '''      const metrics = evaluateCandidateMetrics(state, scratch, component, relations);'''
new = '''      const metrics = evaluateCandidateMetrics(state, scratch, component, relations, intrinsicMode);'''
assert old in text
text = text.replace(old, new, 1)
old = '''  const metrics = evaluateCandidateMetrics(state, positions, component, relations);'''
new = '''  const metrics = evaluateCandidateMetrics(state, positions, component, relations, intrinsicMode);'''
assert old in text
text = text.replace(old, new, 1)
old = '''  component: GarmentSpatialConstraintComponent,\n  relations: readonly GarmentSpatialConstraintRelation[],\n): Omit<CandidateSolution, "name" | "positions" | "poses" | "score"> {'''
new = '''  component: GarmentSpatialConstraintComponent,\n  relations: readonly GarmentSpatialConstraintRelation[],\n  intrinsicMode: "existing-embedding" | "euclidean" = "existing-embedding",\n): Omit<CandidateSolution, "name" | "positions" | "poses" | "score"> {'''
assert old in text
text = text.replace(old, new, 1)
old = '''  const intrinsic = measureIntrinsicDistortion({\n    positions,\n    structuralConstraints: state.structuralConstraints,\n    instances: state.instances,\n  });\n  return {\n    normalizedResidual: weightTotal > 0 ? weightedNormalized / weightTotal : 0,\n    meanResidualMm: weightTotal > 0 ? weightedResidualM / weightTotal * 1000 : 0,\n    maxResidualMm: maxResidualM * 1000,\n    nonPlanarityRad: componentNonPlanarity(positions, state, component),\n    coarseOverlapScore: componentOverlapScore(positions, state, component),\n    intrinsicDistortion: intrinsic.maxRelativeDistortion,'''
new = '''  const intrinsicDistortion = intrinsicMode === "existing-embedding"\n    ? measureIntrinsicDistortion({\n        positions,\n        structuralConstraints: state.structuralConstraints,\n        instances: state.instances,\n      }).maxRelativeDistortion\n    : measurePhysicalEuclideanIntrinsicDistortion(positions, state, component);\n  return {\n    normalizedResidual: weightTotal > 0 ? weightedNormalized / weightTotal : 0,\n    meanResidualMm: weightTotal > 0 ? weightedResidualM / weightTotal * 1000 : 0,\n    maxResidualMm: maxResidualM * 1000,\n    nonPlanarityRad: componentNonPlanarity(positions, state, component),\n    coarseOverlapScore: componentOverlapScore(positions, state, component),\n    intrinsicDistortion,'''
assert old in text
text = text.replace(old, new, 1)
marker = '''function componentNonPlanarity(\n  positions: Float32Array,'''
helper = '''function measurePhysicalEuclideanIntrinsicDistortion(\n  positions: Float32Array,\n  state: GarmentAssemblyState,\n  component: GarmentSpatialConstraintComponent,\n): number {\n  const members = new Set(component.nodeIds);\n  const instanceByParticle = new Map<number, string>();\n  for (const instance of state.instances) {\n    if (!members.has(instance.id)) continue;\n    for (let local = 0; local < instance.vertexCount; local += 1) {\n      instanceByParticle.set(instance.particleStart + local, instance.id);\n    }\n  }\n  let maximum = 0;\n  for (const constraint of state.structuralConstraints) {\n    const instanceA = instanceByParticle.get(constraint.a);\n    const instanceB = instanceByParticle.get(constraint.b);\n    if (!instanceA || instanceA !== instanceB || constraint.restLength <= EPS) continue;\n    const offsetA = constraint.a * 3;\n    const offsetB = constraint.b * 3;\n    const current = Math.hypot(\n      positions[offsetB] - positions[offsetA],\n      positions[offsetB + 1] - positions[offsetA + 1],\n      positions[offsetB + 2] - positions[offsetA + 2],\n    );\n    maximum = Math.max(maximum, Math.abs(current - constraint.restLength) / constraint.restLength);\n  }\n  return maximum;\n}\n\n'''
assert marker in text
text = text.replace(marker, helper + marker, 1)
path.write_text(text)
print('Prompt 10.6 candidate-specific intrinsic metrics applied')
