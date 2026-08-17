from pathlib import Path
path = Path('apps/web/src/garment3d/ConstraintSpatialAssembly.ts')
text = path.read_text()
old = '''        assemblySolveMs: nowMs() - componentStartedAt,\n        ...metrics,\n        strategy,'''
new = '''        assemblySolveMs: nowMs() - componentStartedAt,\n        beforeMeanResidualMm: metrics.meanResidualMm,\n        beforeMaxResidualMm: metrics.maxResidualMm,\n        ...metrics,\n        strategy,'''
assert old in text
path.write_text(text.replace(old, new, 1))
print('Prompt 10.6 fix1 applied')
