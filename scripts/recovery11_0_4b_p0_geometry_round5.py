from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

needle = "  const sealed = sealBoundaryLoops(welded.positions, welded.indices, welded.regionIds);\n"
if text.count(needle) != 1:
    raise RuntimeError(f"round5 expected one seal call, found {text.count(needle)}")
text = text.replace(
    needle,
    "  // The positional weld is the topology repair. Do not cap numerical loops\n"
    "  // with centroid fans: those caps can create degenerate/non-manifold faces.\n",
    1,
)

for old, new in (
    ("signedVolume(sealed.positions, sealed.indices)", "signedVolume(welded.positions, welded.indices)"),
    ("sealed.indices.length", "welded.indices.length"),
    ("sealed.indices[offset + 1]", "welded.indices[offset + 1]"),
    ("sealed.indices[offset + 2]", "welded.indices[offset + 2]"),
    ("Float32Array.from(sealed.positions)", "Float32Array.from(welded.positions)"),
    ("buildVertexNormals(sealed.positions, sealed.indices)", "buildVertexNormals(welded.positions, welded.indices)"),
    ("Uint32Array.from(sealed.indices)", "Uint32Array.from(welded.indices)"),
    ("regionIds: sealed.regionIds", "regionIds: welded.regionIds"),
    ("computeBounds(sealed.positions)", "computeBounds(welded.positions)"),
):
    if old not in text:
        raise RuntimeError(f"round5 marker missing: {old}")
    text = text.replace(old, new)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
