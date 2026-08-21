from pathlib import Path

path = Path("apps/web/src/garment3d/IsometricSurfaceAssembly.ts")
text = path.read_text(encoding="utf-8")
old = '''  const independentCycle = enumerateBestCycle(independentIds);
  if (independentCycle.length > 0) return independentCycle;
  const allCycle = enumerateBestCycle(component.meshIds);
'''
new = '''  const independentCycle = enumerateBestCycle(independentIds);
  if (independentCycle.length > 0) return independentCycle;

  // A one-panel self-closed shell is already a complete structural cycle.
  // When local islands are attached to it, seeding all disconnected islands as
  // one circumference makes the attachment redefine the parent's radius and
  // candidate branch. Keep the largest self-closed material shell as the seed
  // owner; remaining islands are developed independently and attached later.
  const dominantSelfClosed = [...selfClosed].sort((left, right) => {
    const areaDelta = (coarse.byInstanceId.get(right)?.materialAreaM2 ?? 0)
      - (coarse.byInstanceId.get(left)?.materialAreaM2 ?? 0);
    return Math.abs(areaDelta) > 1e-12 ? areaDelta : left.localeCompare(right);
  })[0];
  if (dominantSelfClosed) return [dominantSelfClosed];

  const allCycle = enumerateBestCycle(component.meshIds);
'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"dominant self-closed seed: expected one match, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print(f"patched {path}")
