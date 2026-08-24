from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

old = '''  const torsoField = (x: number, y: number, z: number): number => {
    if (y < sections[0].yM - 0.04 || y > sections[sections.length - 1].yM + 0.04) return 1;
    const s = interpolateCrossSection(sections, y);
    const absX = Math.abs(x);
    if (absX > s.halfWidthM) return absX - s.halfWidthM;
    const normalizedX = clamp(absX / Math.max(s.halfWidthM, 1e-6), 0, 1);
    const vertical = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
    const sigma = Math.max(s.halfWidthM * 0.18, 1e-4);
    const lobeX = (absX - s.lobeHalfDistanceM) / sigma;
    const lobeWeight = Math.exp(-(lobeX * lobeX));
    const front = s.centerZM + s.frontDepthM * vertical + s.frontLobeM * lobeWeight * Math.pow(vertical, 0.72);
    const back = s.centerZM - s.backDepthM * vertical - s.backLobeM * lobeWeight * Math.pow(vertical, 0.72);
    if (z > front) return z - front;
    if (z < back) return back - z;
    return -Math.min(front - z, z - back, s.halfWidthM - absX);
  };
'''
new = '''  const torsoField = (x: number, y: number, z: number): number => {
    const lowerY = sections[0].yM - 0.04;
    const upperY = sections[sections.length - 1].yM + 0.04;
    const sampleY = clamp(y, sections[0].yM, sections[sections.length - 1].yM);
    const s = interpolateCrossSection(sections, sampleY);
    const absX = Math.abs(x);
    const normalizedX = clamp(absX / Math.max(s.halfWidthM, 1e-6), 0, 1);
    const vertical = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX));
    const sigma = Math.max(s.halfWidthM * 0.18, 1e-4);
    const lobeX = (absX - s.lobeHalfDistanceM) / sigma;
    const lobeWeight = Math.exp(-(lobeX * lobeX));
    const front = s.centerZM + s.frontDepthM * vertical + s.frontLobeM * lobeWeight * Math.pow(vertical, 0.72);
    const back = s.centerZM - s.backDepthM * vertical - s.backLobeM * lobeWeight * Math.pow(vertical, 0.72);
    const radial = Math.max(z - front, back - z, absX - s.halfWidthM);
    const axial = Math.max(lowerY - y, y - upperY);
    return Math.max(radial, axial);
  };
'''
if text.count(old) != 1:
    raise RuntimeError(f"torsoField block mismatch: {text.count(old)}")
text = text.replace(old, new, 1)

pairs = [
    ('[0, f.crotchY - 0.062, 0.016]', '[0, f.crotchY - 0.090, 0.016]'),
    ('[Math.max(0.018, Math.abs(f.hipRight[0]) * 0.38), 0.180, Math.max(0.180, m.crotchDepthMm * 0.00082)]',
     '[Math.max(0.018, Math.abs(f.hipRight[0]) * 0.38), 0.105, Math.max(0.190, m.crotchDepthMm * 0.00082)]'),
    ('if (y <= f.crotchY + 0.018) body = Math.max(body, -separator);',
     '// Closed boolean subtraction avoids an implicit-field seam at the crotch cutoff.\n    body = Math.max(body, -separator);'),
    ('  const quantize = (value: number) => Math.round(value * 5e4);',
     '  const quantize = (value: number) => Math.round(value * 1e8);'),
]
for old_value, new_value in pairs:
    if text.count(old_value) != 1:
        raise RuntimeError(f"round6 marker mismatch {old_value[:60]!r}: {text.count(old_value)}")
    text = text.replace(old_value, new_value, 1)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
