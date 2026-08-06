from pathlib import Path

file_path = Path("apps/web/src/patterns/trouserPatternDrafting.ts")
text = file_path.read_text(encoding="utf-8")
old = '        "inseam",\n        "inseam",\n        "inseam",\n        isFront ? "frontCrotch" : "backCrotch",\n'
new = '        "inseam",\n        "inseam",\n        isFront ? "frontCrotch" : "backCrotch",\n        isFront ? "frontCrotch" : "backCrotch",\n'
if old not in text:
    raise SystemExit("trouser role sequence not found")
file_path.write_text(text.replace(old, new, 1), encoding="utf-8")
