from pathlib import Path

path = Path("apps/web/src/garment3d/IsometricSurfaceAssembly.ts")
text = path.read_text(encoding="utf-8")
replacements = [
    (
        '  if (samples.length < 4) return null;',
        '  if (samples.length < 4) { console.log("MOLDEON_11_0_4A_MAPPER_REJECT", JSON.stringify({ id, reason: "samples", samples: samples.length })); return null; }',
    ),
    (
        '  if (collapsed.length < 4) return null;',
        '  if (collapsed.length < 4) { console.log("MOLDEON_11_0_4A_MAPPER_REJECT", JSON.stringify({ id, reason: "collapsed", collapsed: collapsed.length })); return null; }',
    ),
    (
        '  if (materialSpanMm <= 1 || sampledSpanMm < materialSpanMm * 0.9) return null;',
        '  if (materialSpanMm <= 1 || sampledSpanMm < materialSpanMm * 0.9) { console.log("MOLDEON_11_0_4A_MAPPER_REJECT", JSON.stringify({ id, reason: "span", materialSpanMm, sampledSpanMm })); return null; }',
    ),
    (
        '  if (alongSpanMm > Math.max(2, materialSpanMm * 0.02)) return null;',
        '  if (alongSpanMm > Math.max(2, materialSpanMm * 0.02)) { console.log("MOLDEON_11_0_4A_MAPPER_REJECT", JSON.stringify({ id, reason: "along-span", materialSpanMm, alongSpanMm })); return null; }',
    ),
    (
        '  if (length3(extrusion) <= EPS) return null;',
        '  if (length3(extrusion) <= EPS) { console.log("MOLDEON_11_0_4A_MAPPER_REJECT", JSON.stringify({ id, reason: "normal" })); return null; }',
    ),
    (
        '  if (planeResidualM > Math.max(0.0015, materialSpanMm * 0.001 * 0.01)) return null;',
        '  if (planeResidualM > Math.max(0.0015, materialSpanMm * 0.001 * 0.01)) { console.log("MOLDEON_11_0_4A_MAPPER_REJECT", JSON.stringify({ id, reason: "plane", planeResidualM, limitM: Math.max(0.0015, materialSpanMm * 0.001 * 0.01), materialSpanMm })); return null; }',
    ),
    (
        '    if (requiredM <= EPS || chordM > requiredM * 1.0005) return null;',
        '    if (requiredM <= EPS || chordM > requiredM * 1.0005) { console.log("MOLDEON_11_0_4A_MAPPER_REJECT", JSON.stringify({ id, reason: "chord", index, requiredM, chordM, ratio: requiredM > EPS ? chordM / requiredM : null })); return null; }',
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"mapper diagnostic {old[:40]}: expected one match, found {count}")
    text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
