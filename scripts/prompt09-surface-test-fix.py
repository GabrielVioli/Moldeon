from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/web/src/garment3d/SemanticAvatarArrangement.test.ts"
source = path.read_text(encoding="utf-8")
old = '    expect(skirt.coveredAvatarPartNames.has("avatar:calf-left")).toBe(false);\n'
if source.count(old) != 1:
    raise SystemExit(f"skirt calf assertion not found exactly once: {source.count(old)}")
source = source.replace(old, '    expect(skirt.coveredAvatarPartNames.has("avatar:foot-left")).toBe(false);\n', 1)
path.write_text(source, encoding="utf-8")
print("Prompt 9 skirt coverage expectation aligned")
