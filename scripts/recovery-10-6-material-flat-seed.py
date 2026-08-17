from pathlib import Path
path = Path('apps/web/src/garment3d/ConstraintSpatialAssembly.ts')
text = path.read_text()
old = '''  const baseStatePositions = new Float32Array(state.positions);\n  const allPoses = new Map<string, Pose>();'''
new = '''  const legacyStatePositions = new Float32Array(state.positions);\n  // `initialPositions` is the material-preserving physical-panel state emitted by\n  // GarmentAssembly before semantic/tube mappings bend individual panels. It is\n  // a first-class seed so a legacy analytical embedding cannot win merely because\n  // it already curved a panel while preloading structural strain.\n  const intrinsicFlatStatePositions = new Float32Array(state.initialPositions);\n  const allPoses = new Map<string, Pose>();'''
assert old in text
text = text.replace(old, new, 1)
text = text.replace('        baseStatePositions,\n        component,\n        relations,\n      );', '        legacyStatePositions,\n        component,\n        relations,\n      );', 1)
old = '''    const beforeMetrics = evaluateCandidateMetrics(\n      state,\n      baseStatePositions,\n      component,\n      relations,\n    );\n    const candidates: Array<{ name: string; positions: Float32Array }> = [\n      { name: "legacy-geometric-seed", positions: new Float32Array(baseStatePositions) },\n    ];\n    if (component.supportsSpatialShell) {\n      candidates.push({\n        name: "constraint-hinge-positive",\n        positions: buildSpreadSeed(baseStatePositions, state, component, relations, 1),\n      });\n      candidates.push({\n        name: "constraint-hinge-negative",\n        positions: buildSpreadSeed(baseStatePositions, state, component, relations, -1),\n      });\n    }'''
new = '''    const beforeMetrics = evaluateCandidateMetrics(\n      state,\n      legacyStatePositions,\n      component,\n      relations,\n    );\n    const candidates: Array<{ name: string; positions: Float32Array }> = [\n      { name: "legacy-geometric-seed", positions: new Float32Array(legacyStatePositions) },\n      { name: "material-flat-seed", positions: new Float32Array(intrinsicFlatStatePositions) },\n    ];\n    if (component.supportsSpatialShell) {\n      candidates.push({\n        name: "material-flat-hinge-positive",\n        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, 1),\n      });\n      candidates.push({\n        name: "material-flat-hinge-negative",\n        positions: buildSpreadSeed(intrinsicFlatStatePositions, state, component, relations, -1),\n      });\n    }'''
assert old in text
text = text.replace(old, new, 1)
path.write_text(text)
print('Prompt 10.6 material-flat candidate seeds applied')
