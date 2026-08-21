from pathlib import Path

path = Path("apps/web/src/garment3d/PhysicalGarmentAssembly.ts")
text = path.read_text(encoding="utf-8")
old = r'''  const start = [...occurrences].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!start) return null;
  const first = traverseOpeningCycle(start, true, byClass, occurrences.length);
  const second = traverseOpeningCycle(start, false, byClass, occurrences.length);
  if (!first && !second) return null;
  if (!first) return assignOpeningArcs(second!);
  if (!second) return assignOpeningArcs(first);
  const signature = (items: readonly { occurrence: PhysicalOpeningOccurrence; forward: boolean }[]) =>
    items.map((item) => `${item.occurrence.id}:${item.forward ? "+" : "-"}`).join("|");
  return assignOpeningArcs(signature(first) <= signature(second) ? first : second);'''
new = r'''  const start = [...occurrences].sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!start) return null;
  const first = traverseOpeningCycle(start, true, byClass, occurrences.length);
  const second = traverseOpeningCycle(start, false, byClass, occurrences.length);
  const traversals = [first, second].filter(
    (items): items is Array<{ occurrence: PhysicalOpeningOccurrence; forward: boolean }> => Boolean(items),
  );
  if (traversals.length === 0) return null;
  const variants = traversals.flatMap((items) =>
    items.map((_item, offset) => [...items.slice(offset), ...items.slice(0, offset)]));
  const requested = Number.parseInt(process.env.MOLDEON_OPENING_VARIANT ?? "0", 10);
  const index = Number.isFinite(requested)
    ? Math.min(variants.length - 1, Math.max(0, requested))
    : 0;
  const selected = variants[index];
  console.log("MOLDEON_11_0_4A_OPENING_VARIANT", JSON.stringify({
    requested: index,
    variantCount: variants.length,
    order: selected.map((item) => ({
      id: item.occurrence.id,
      forward: item.forward,
      lengthMm: item.occurrence.lengthMm,
    })),
  }));
  return assignOpeningArcs(selected);'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"opening variant selector: expected one match, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print(f"patched {path}")
