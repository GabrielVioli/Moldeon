from pathlib import Path
path = Path('apps/web/src/garment3d/ConstraintSpatialAssembly.ts')
text = path.read_text()

old = '''    const candidates: Array<{\n      name: string;\n      positions: Float32Array;\n      intrinsicMode: "existing-embedding" | "euclidean";\n    }> = [\n      {\n        name: "legacy-geometric-seed",\n        positions: new Float32Array(legacyStatePositions),\n        intrinsicMode: "existing-embedding",\n      },'''
new = '''    const candidates: Array<{\n      name: string;\n      positions: Float32Array;\n      intrinsicMode: "existing-embedding" | "euclidean";\n      optimize: boolean;\n    }> = [\n      {\n        name: "validated-existing-embedding",\n        positions: new Float32Array(legacyStatePositions),\n        intrinsicMode: "existing-embedding",\n        optimize: false,\n      },\n      {\n        name: "legacy-geometric-seed",\n        positions: new Float32Array(legacyStatePositions),\n        intrinsicMode: "existing-embedding",\n        optimize: true,\n      },'''
assert old in text
text = text.replace(old, new, 1)
text = text.replace('''        intrinsicMode: "euclidean",\n      },\n    ];''', '''        intrinsicMode: "euclidean",\n        optimize: true,\n      },\n    ];''', 1)
text = text.replace('''        intrinsicMode: "euclidean",\n      });\n      candidates.push({\n        name: "material-flat-hinge-negative",''', '''        intrinsicMode: "euclidean",\n        optimize: true,\n      });\n      candidates.push({\n        name: "material-flat-hinge-negative",''', 1)
text = text.replace('''        intrinsicMode: "euclidean",\n      });\n    }\n\n    let best:''', '''        intrinsicMode: "euclidean",\n        optimize: true,\n      });\n    }\n\n    let best:''', 1)

old = '''    for (const candidate of candidates) {\n      const solved = optimizeCandidate(\n        state,\n        candidate.positions,\n        component,\n        relations,\n        options,\n        candidate.name,\n        candidate.intrinsicMode,\n      );'''
new = '''    for (const candidate of candidates) {\n      const solved = candidate.optimize\n        ? optimizeCandidate(\n            state,\n            candidate.positions,\n            component,\n            relations,\n            options,\n            candidate.name,\n            candidate.intrinsicMode,\n          )\n        : evaluateFrozenCandidate(\n            state,\n            candidate.positions,\n            component,\n            relations,\n            candidate.name,\n            candidate.intrinsicMode,\n          );'''
assert old in text
text = text.replace(old, new, 1)

marker = '''function optimizeCandidate(\n  state: GarmentAssemblyState,'''
helper = '''function evaluateFrozenCandidate(\n  state: GarmentAssemblyState,\n  positions: Float32Array,\n  component: GarmentSpatialConstraintComponent,\n  relations: readonly GarmentSpatialConstraintRelation[],\n  name: string,\n  intrinsicMode: "existing-embedding" | "euclidean",\n): CandidateSolution {\n  const frozen = new Float32Array(positions);\n  const metrics = evaluateCandidateMetrics(state, frozen, component, relations, intrinsicMode);\n  const poses = new Map<string, Pose>(component.nodeIds.map((id) => [id, clonePose(IDENTITY_POSE)]));\n  return {\n    name,\n    positions: frozen,\n    poses,\n    score: objectiveScore(component, metrics),\n    ...metrics,\n  };\n}\n\n'''
assert marker in text
text = text.replace(marker, helper + marker, 1)
path.write_text(text)
print('Prompt 10.6 frozen validated candidate applied')
