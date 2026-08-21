from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

pairs = [
    (
        'const DEFAULT_VISUAL_RESOLUTION = [48, 92, 42] as const;\n// Keep the same Y stations in both LODs so circumference sampling hits the\n// same anatomical interpolation planes. X/Z stay cheaper for fitting.\nconst DEFAULT_COLLISION_RESOLUTION = [38, 92, 34] as const;',
        'const DEFAULT_VISUAL_RESOLUTION = [64, 96, 56] as const;\nconst DEFAULT_COLLISION_RESOLUTION = [56, 96, 48] as const;',
    ),
    (
        'section("bust", "chest-front", f.bustY, m.bustMm, 1.27, 1.035, 0.89, 0.006, 0.082, 0, clamp(m.bustPointDistanceMm / m.bustMm, 0.18, 0.29)),',
        'section("bust", "chest-front", f.bustY, m.bustMm, 1.27, 0.98, 0.89, 0.006, 0.110, 0, clamp(m.bustPointDistanceMm / m.bustMm, 0.18, 0.29)),',
    ),
    (
        '      min: [-xExtent, -0.055, -zBack - 0.075],\n      max: [xExtent, f.heightM + 0.095, zFront + 0.075],',
        '      min: [-xExtent, -0.03, -zBack - 0.055],\n      max: [xExtent, f.heightM + 0.03, zFront + 0.055],',
    ),
    (
        '  const headRY = Math.max(0.09, f.heightM - f.headCenterY);',
        '  const headRY = Math.max(0.06, f.heightM - f.headCenterY);',
    ),
]

for old, new in pairs:
    if old not in text:
        raise RuntimeError(f"round2 block missing: {old[:80]!r}")
    text = text.replace(old, new, 1)

old = '        values[latticeId(ix, iy, iz)] = field.sample(min[0] + ix * sx, min[1] + iy * sy, min[2] + iz * sz);'
new = '''        const id = latticeId(ix, iy, iz);
        const sampled = field.sample(min[0] + ix * sx, min[1] + iy * sy, min[2] + iz * sz);
        values[id] = Math.abs(sampled) <= 1e-10 ? 1e-10 : sampled;'''
if old not in text:
    raise RuntimeError("round2 lattice sample missing")
text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
