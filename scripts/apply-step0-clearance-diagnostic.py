from pathlib import Path

path = Path("apps/web/src/viewport/ArrangementWorkspace.ts")
text = path.read_text(encoding="utf-8")

text = text.replace(
'''export interface BodyClearanceAudit {
  minimumSignedClearanceMm: number;
  penetratingSamples: number;
  sampledPoints: number;
}''',
'''export interface BodyClearanceAudit {
  minimumSignedClearanceMm: number;
  penetratingSamples: number;
  sampledPoints: number;
  /** DEV/audit evidence for the worst sampled contact. */
  worstSample?: number;
  worstPointWorld?: [number, number, number];
  worstSurfaceWorld?: [number, number, number];
  worstSurfaceNormal?: [number, number, number];
  worstTriangleIndex?: number;
  worstRegionIds?: string[];
}''',
1,
)

old = '''  let minimumSignedClearanceMm = Number.POSITIVE_INFINITY;
  let penetratingSamples = 0;
  const sampleCount = Math.floor(state.localSamples.length / 3);'''
new = '''  let minimumSignedClearanceMm = Number.POSITIVE_INFINITY;
  let penetratingSamples = 0;
  let worstSample: number | undefined;
  let worstPointWorld: [number, number, number] | undefined;
  let worstSurfaceWorld: [number, number, number] | undefined;
  let worstSurfaceNormal: [number, number, number] | undefined;
  let worstTriangleIndex: number | undefined;
  let worstRegionIds: string[] | undefined;
  const sampleCount = Math.floor(state.localSamples.length / 3);'''
if old not in text:
    raise SystemExit("audit locals marker not found")
text = text.replace(old, new, 1)

old = '''    const signedMm = point.clone().sub(surface).dot(normal) * 1_000;
    minimumSignedClearanceMm = Math.min(minimumSignedClearanceMm, signedMm);
    if (signedMm < requiredClearanceMm) penetratingSamples += 1;'''
new = '''    const signedMm = point.clone().sub(surface).dot(normal) * 1_000;
    if (signedMm < minimumSignedClearanceMm) {
      minimumSignedClearanceMm = signedMm;
      worstSample = sample;
      worstPointWorld = [point.x, point.y, point.z];
      worstSurfaceWorld = [...nearest.position];
      worstSurfaceNormal = [...nearest.outwardNormal];
      worstTriangleIndex = nearest.attachment.triangleIndex;
      const base = nearest.attachment.triangleIndex * 3;
      const regions = new Set<string>();
      for (let corner = 0; corner < 3; corner += 1) {
        const vertexIndex = body.indices[base + corner];
        const region = body.regionIds[vertexIndex];
        if (region) regions.add(region);
      }
      worstRegionIds = [...regions];
    }
    if (signedMm < requiredClearanceMm) penetratingSamples += 1;'''
if old not in text:
    raise SystemExit("audit signed marker not found")
text = text.replace(old, new, 1)

old = '''  return {
    minimumSignedClearanceMm: Number.isFinite(minimumSignedClearanceMm) ? minimumSignedClearanceMm : Number.POSITIVE_INFINITY,
    penetratingSamples,
    sampledPoints: sampleCount,
  };'''
new = '''  return {
    minimumSignedClearanceMm: Number.isFinite(minimumSignedClearanceMm) ? minimumSignedClearanceMm : Number.POSITIVE_INFINITY,
    penetratingSamples,
    sampledPoints: sampleCount,
    worstSample,
    worstPointWorld,
    worstSurfaceWorld,
    worstSurfaceNormal,
    worstTriangleIndex,
    worstRegionIds,
  };'''
if old not in text:
    raise SystemExit("audit return marker not found")
text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("Applied STEP-0 worst-clearance diagnostic")
