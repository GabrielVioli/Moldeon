from pathlib import Path

path = Path("apps/web/src/physics/xpbd.ts")
text = path.read_text(encoding="utf-8")
old = '''const EPSILON = 1e-9;\n'''
new = '''const EPSILON = 1e-9;\nconst STRUCTURAL_CORRECTION_FRACTION = 0.1;\nconst HARD_SEAM_CORRECTION_SCALE = 1 / STRUCTURAL_CORRECTION_FRACTION;\n'''
if text.count(old) != 1:
    raise RuntimeError(f"epsilon marker mismatch: {text.count(old)}")
text = text.replace(old, new, 1)
old = '''const q=limits[p]*relax/wg;if(q<mm)mm=q;'''
new = '''const q=limits[p]*relax*HARD_SEAM_CORRECTION_SCALE/wg;if(q<mm)mm=q;'''
if text.count(old) != 1:
    raise RuntimeError(f"seam correction marker mismatch: {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
