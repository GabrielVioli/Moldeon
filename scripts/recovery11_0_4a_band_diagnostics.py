from pathlib import Path

path = Path("apps/web/src/physics/waistbandZeroEnergyRecovery.test.ts")
text = path.read_text(encoding="utf-8")
old = '''      bandJoinMeanMm: bandJoin?.meanResidualMm,
      bandJoinMaxMm: bandJoin?.maxResidualMm,
      bandIntrinsic,'''
new = '''      bandJoinMeanMm: bandJoin?.meanResidualMm,
      bandJoinMaxMm: bandJoin?.maxResidualMm,
      bandJoinWorstSample: bandJoin?.worstSample,
      bandIntrinsic,'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"worst band seam diagnostic: expected one match, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print(f"patched {path}")
