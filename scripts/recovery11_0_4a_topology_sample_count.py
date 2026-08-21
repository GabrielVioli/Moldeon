from pathlib import Path

path = Path("apps/web/src/garment3d/PhysicalGarmentAssembly.ts")
text = path.read_text(encoding="utf-8")
old = r'''    const progresses = [...new Set(group
      .map((constraint) => constraint.progress)
      .filter((value): value is number => Number.isFinite(value))
      .map((value) => Math.round(value * 1e9) / 1e9))]
      .sort((left, right) => left - right);
    const sampleCount = progresses.length;
    if (sampleCount < 4) continue;'''
new = r'''    const inheritedProgresses = [...new Set(group
      .map((constraint) => constraint.progress)
      .filter((value): value is number => Number.isFinite(value))
      .map((value) => Math.round(value * 1e9) / 1e9))]
      .sort((left, right) => left - right);
    const structuredStops = attachmentPlan.instance.structuredAttachmentPlan?.stopsT ?? [];
    // The structured plan is [anchor, midpoint, anchor, ...]. The physical
    // cut-on-fold planner may contribute two material sectors that share one
    // endpoint, so this count is authoritative for the nested coarse/fine
    // topology instead of the pre-expansion logical seam progress count.
    const topologyAnchorCount = structuredStops.length >= 3
      ? Math.floor((structuredStops.length + 1) / 2)
      : 0;
    const sampleCount = Math.max(inheritedProgresses.length, topologyAnchorCount);
    if (sampleCount < 4) continue;'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"physical attachment sample count: expected one match, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print(f"patched {path}")
