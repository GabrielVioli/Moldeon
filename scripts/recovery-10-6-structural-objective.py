from pathlib import Path
path = Path('apps/web/src/garment3d/ConstraintSpatialAssembly.ts')
text = path.read_text()
old = '''    const w = Math.max(0.05, relation.structuralWeight);\n    weightedResidualM += mean * w;\n    weightedNormalized += normalized * w;\n    weightTotal += w;\n    maxResidualM = Math.max(maxResidualM, maximum);'''
new = '''    const w = relation.structuralWeight;\n    if (w > 0) {\n      weightedResidualM += mean * w;\n      weightedNormalized += normalized * w;\n      weightTotal += w;\n    }\n    maxResidualM = Math.max(maxResidualM, maximum);'''
assert old in text
path.write_text(text.replace(old, new, 1))
print('Prompt 10.6 structural-only global residual weighting applied')
