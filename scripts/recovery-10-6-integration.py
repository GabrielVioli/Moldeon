from pathlib import Path

root = Path('.')

garment = root / 'apps/web/src/garment3d/GarmentAssembly.ts'
text = garment.read_text()
old = 'mapping: "rigid-panel" | "body-surface" | "local-tube" | "anatomical-half-tube" | "seam-derived-tube" | "multipanel-surface-shell";'
new = 'mapping: "rigid-panel" | "body-surface" | "local-tube" | "anatomical-half-tube" | "seam-derived-tube" | "multipanel-surface-shell" | "constraint-spatial-shell";'
assert old in text
text = text.replace(old, new, 1)
garment.write_text(text)

semantic = root / 'apps/web/src/garment3d/SemanticAvatarArrangement.ts'
text = semantic.read_text()
old = 'import { buildPhysicalGarmentAssembly } from "./PhysicalGarmentAssembly";\nimport type { ResolvedAssemblyInput } from "./ResolvedAssemblyInput";'
new = 'import { buildPhysicalGarmentAssembly } from "./PhysicalGarmentAssembly";\nimport {\n  solveGarmentSpatialConstraints,\n  type ConstraintSpatialAssemblyResult,\n} from "./ConstraintSpatialAssembly";\nimport type { ResolvedAssemblyInput } from "./ResolvedAssemblyInput";'
assert old in text
text = text.replace(old, new, 1)

old = '  spatialAssemblyDiagnostics: SpatialAssemblyComponentDiagnostic[];\n  initialSeamResidualAudit: {'
new = '  spatialAssemblyDiagnostics: SpatialAssemblyComponentDiagnostic[];\n  constraintSpatialAssembly: ConstraintSpatialAssemblyResult;\n  initialSeamResidualAudit: {'
assert old in text
text = text.replace(old, new, 1)

old = '  strategy: "seam-derived-tube" | "multipanel-surface-shell" | "rigid-fallback";\n  reason: string;\n  structuralSeamGroupCount: number;\n  freeBoundaryCount: number;\n  detectedCycles: number;\n  poseConstraintCount: number;\n  finalMeanResidualMm: number;\n  finalMaxResidualMm: number;'
new = '  strategy: "constraint-spatial-shell" | "seam-derived-tube" | "multipanel-surface-shell" | "rigid-fallback";\n  reason: string;\n  structuralSeamGroupCount: number;\n  freeBoundaryCount: number;\n  detectedCycles: number;\n  poseConstraintCount: number;\n  finalMeanResidualMm: number;\n  finalMaxResidualMm: number;\n  assemblySolveMs?: number;\n  nonPlanarityRad?: number;\n  coarseOverlapScore?: number;\n  normalizedResidual?: number;\n  intrinsicDistortion?: number;'
assert old in text
text = text.replace(old, new, 1)

old = '''  const seamPlacementDiagnostics = placeConnectedPanelsRigidly(state, visibleInstanceIds);\n  const beforeTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);\n  const tubeAlignment = alignSecondaryTubeGroups(state);\n  const afterTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);\n  const spatialAssemblyDiagnostics = buildSpatialAssemblyDiagnostics(\n    state,\n    resolvedGarment,\n    afterTubeAlignment,\n  );'''
new = '''  // Prompt 10.6: legacy rigid propagation and analytical tube alignment are\n  // seeds only. The final pose is reconciled globally from the full material\n  // constraint multigraph before XPBD sees the garment.\n  const seamPlacementDiagnostics = placeConnectedPanelsRigidly(state, visibleInstanceIds);\n  const beforeTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);\n  const tubeAlignment = alignSecondaryTubeGroups(state);\n  const constraintSpatialAssembly = solveGarmentSpatialConstraints(state, visibleInstanceIds);\n  const afterTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);\n  const spatialAssemblyDiagnostics = buildSpatialAssemblyDiagnostics(\n    state,\n    resolvedGarment,\n    afterTubeAlignment,\n    constraintSpatialAssembly,\n  );'''
assert old in text
text = text.replace(old, new, 1)

old = '    seamPlacementDiagnostics,\n    spatialAssemblyDiagnostics,\n    initialSeamResidualAudit: {'
new = '    seamPlacementDiagnostics,\n    spatialAssemblyDiagnostics,\n    constraintSpatialAssembly,\n    initialSeamResidualAudit: {'
assert old in text
text = text.replace(old, new, 1)

old = '''function buildSpatialAssemblyDiagnostics(\n  state: GarmentAssemblyState,\n  garment: GarmentDraft,\n  residualAudit: InitialSeamResidualAudit,\n): SpatialAssemblyComponentDiagnostic[] {'''
new = '''function buildSpatialAssemblyDiagnostics(\n  state: GarmentAssemblyState,\n  garment: GarmentDraft,\n  residualAudit: InitialSeamResidualAudit,\n  constraintSolve: ConstraintSpatialAssemblyResult,\n): SpatialAssemblyComponentDiagnostic[] {'''
assert old in text
text = text.replace(old, new, 1)

old = '''    const instances = state.instances.filter((instance) => members.has(instance.id));\n    const mappings = new Set(instances.map((instance) => instance.arrangement?.mapping));\n    const strategy: SpatialAssemblyComponentDiagnostic["strategy"] = mappings.has("seam-derived-tube")\n      ? "seam-derived-tube"\n      : mappings.has("multipanel-surface-shell")\n        ? "multipanel-surface-shell"\n        : "rigid-fallback";\n    const reason = strategy === "seam-derived-tube"\n      ? "analytical-longitudinal-cycle"\n      : strategy === "multipanel-surface-shell"\n        ? "multigraph-cycle-or-parallel-material-relations"\n        : "insufficient-surface-constraints";'''
new = '''    const instances = state.instances.filter((instance) => members.has(instance.id));\n    const mappings = new Set(instances.map((instance) => instance.arrangement?.mapping));\n    const solverComponent = constraintSolve.components.find((candidate) => candidate.componentId === instanceIds.join("|"));\n    const strategy: SpatialAssemblyComponentDiagnostic["strategy"] = mappings.has("constraint-spatial-shell")\n      ? "constraint-spatial-shell"\n      : mappings.has("seam-derived-tube")\n        ? "seam-derived-tube"\n        : mappings.has("multipanel-surface-shell")\n          ? "multipanel-surface-shell"\n          : "rigid-fallback";\n    const reason = strategy === "constraint-spatial-shell"\n      ? solverComponent?.reason ?? "global-material-constraint-pose-optimization"\n      : strategy === "seam-derived-tube"\n        ? "analytical-longitudinal-cycle"\n        : strategy === "multipanel-surface-shell"\n          ? "multigraph-cycle-or-parallel-material-relations"\n          : "insufficient-surface-constraints";'''
assert old in text
text = text.replace(old, new, 1)

old = '''      poseConstraintCount: componentRelations.length,\n      finalMeanResidualMm,\n      finalMaxResidualMm,\n    });'''
new = '''      poseConstraintCount: solverComponent?.constraintCount ?? componentRelations.length,\n      finalMeanResidualMm,\n      finalMaxResidualMm,\n      assemblySolveMs: solverComponent?.assemblySolveMs,\n      nonPlanarityRad: solverComponent?.nonPlanarityRad,\n      coarseOverlapScore: solverComponent?.coarseOverlapScore,\n      normalizedResidual: solverComponent?.normalizedResidual,\n      intrinsicDistortion: solverComponent?.intrinsicDistortion,\n    });'''
assert old in text
text = text.replace(old, new, 1)
semantic.write_text(text)

oldtest = root / 'apps/web/src/garment3d/generalGarmentSpatialAssembly.test.ts'
text = oldtest.read_text()
text = text.replace('expect(spatial.strategy).toBe("multipanel-surface-shell");', 'expect(spatial.strategy).toBe("constraint-spatial-shell");')
text = text.replace('expect(result.arrangement.spatialAssemblyDiagnostics.every((component) => component.strategy === "rigid-fallback")).toBe(true);', 'expect(result.arrangement.constraintSpatialAssembly.components.every((component) => component.strategy === "underconstrained-open")).toBe(true);')
oldtest.write_text(text)

print('Prompt 10.6 integration patch applied')
