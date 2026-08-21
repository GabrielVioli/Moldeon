from pathlib import Path

path = Path("apps/web/src/physics/xpbd.ts")
text = path.read_text(encoding="utf-8")

old = '''  const seamCount = state.seams.restDistances.length;
  for (let index = 0; index < seamCount; index += 1) {
    const distance = seamDistance(state.positions, state.seams, index);'''
new = '''  const seamCount = state.seams.restDistances.length;
  // Uniform free flight is represented analytically as rest pose + one common
  // translation. At tens of metres, subtracting two Float32 world coordinates
  // injects quantization into otherwise invariant seam/material diagnostics.
  // Measure in the exact rest frame while that analytic branch is active.
  const diagnosticPositions = state.zeroEnergyFreeFlightActive
    ? state.restPositions
    : state.positions;
  for (let index = 0; index < seamCount; index += 1) {
    const distance = seamDistance(diagnosticPositions, state.seams, index);'''
if text.count(old) != 1:
    raise RuntimeError(f"diagnostic seam positions: expected one match, found {text.count(old)}")
text = text.replace(old, new, 1)

start = text.index('function measureMaterialMetrics(state: XpbdState, captureReferenceNormals = false): MaterialMetricsSnapshot {')
end = text.index('\nfunction accumulateMaterialGroup(', start)
section = text[start:end]
needle = 'function measureMaterialMetrics(state: XpbdState, captureReferenceNormals = false): MaterialMetricsSnapshot {\n'
replacement = needle + '''  const metricPositions = state.zeroEnergyFreeFlightActive
    ? state.restPositions
    : state.positions;
'''
if section.count(needle) != 1:
    raise RuntimeError("measureMaterialMetrics signature not found exactly once")
section = section.replace(needle, replacement, 1)
section = section.replace('state.positions[', 'metricPositions[')
text = text[:start] + section + text[end:]

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
