from pathlib import Path

path = Path("apps/web/src/physics/GarmentXpbdAdapter.ts")
text = path.read_text(encoding="utf-8")
old = '''  const lengthA = Math.hypot(dart.apex.xMm - dart.legA.xMm, dart.apex.yMm - dart.legA.yMm);\n  const lengthB = Math.hypot(dart.apex.xMm - dart.legB.xMm, dart.apex.yMm - dart.legB.yMm);\n  const typicalEdgeMm = typicalPanelEdgeLengthMm(instance);\n  const sampleCount = clampInteger(\n    Math.ceil(Math.max(lengthA, lengthB) / Math.max(typicalEdgeMm, 1)),\n    2,\n    32,\n  );\n  const result: Array<{ first: GlobalPointReference; second: GlobalPointReference }> = [];\n  const seen = new Set<string>();\n  // sample=0 is the canonical dart-foot constraint; sampleCount is the common apex.\n  for (let sample = 1; sample < sampleCount; sample += 1) {\n    const t = sample / sampleCount;\n'''
new = '''  const probeCount = clampInteger(\n    Math.ceil(Math.sqrt(Math.max(1, instance.vertexCount))) * 3,\n    24,\n    192,\n  );\n  const result: Array<{ first: GlobalPointReference; second: GlobalPointReference }> = [];\n  const seen = new Set<string>();\n  // Probe the material legs densely, then keep only distinct mesh-particle pairs.\n  // t=0 is the canonical dart-foot constraint; t=1 is the common apex.\n  for (let sample = 1; sample < probeCount; sample += 1) {\n    const t = sample / probeCount;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"dart chain sampling marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
