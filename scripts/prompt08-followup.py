from pathlib import Path

path = Path("apps/web/src/domain/sleeveSystem.test.ts")
source = path.read_text(encoding="utf-8")
old = '''    expect(new Set(draft.seams.map((seam) => seam.groupId))).toEqual(new Set([
      "guided-sleeve:front-armhole",
      "guided-sleeve:back-armhole",
      "guided-sleeve:underarm",
    ]));
'''
new = '''    expect(new Set(draft.seams.map((seam) => seam.groupId))).toEqual(new Set([
      "guided-sleeve:front-armhole",
      "guided-sleeve:back-armhole",
      "guided-sleeve:underarm",
      "guided-sleeve:body-shoulder",
      "guided-sleeve:body-side",
    ]));
'''
if source.count(old) != 1:
    raise SystemExit("sleeve seam group expectation not found")
path.write_text(source.replace(old, new, 1), encoding="utf-8")

path = Path("apps/web/src/state/sleeveSystemStore.test.ts")
source = path.read_text(encoding="utf-8")
old = '    expect(undone.garment.seams?.some((seam) => seam.groupId?.startsWith("guided-sleeve:"))).toBe(false);\n'
new = '    expect(undone.garment.seams?.some((seam) => seam.groupId?.startsWith("guided-sleeve:")) ?? false).toBe(false);\n'
if source.count(old) != 1:
    raise SystemExit("store undo seam expectation not found")
path.write_text(source.replace(old, new, 1), encoding="utf-8")

print("Prompt 8 test expectations aligned")
