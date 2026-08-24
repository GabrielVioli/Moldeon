from pathlib import Path

path = Path("apps/web/src/avatar/HumanBodyModel.ts")
text = path.read_text(encoding="utf-8")

old = '''  const visualMesh = polygonizeAnatomy(field, visualResolution);
  const collisionMesh = polygonizeAnatomy(field, collisionResolution);
'''
new = '''  const visualMesh = calibrateCriticalSections(
    polygonizeAnatomy(field, visualResolution),
    torsoSections,
  );
  const collisionMesh = calibrateCriticalSections(
    polygonizeAnatomy(field, collisionResolution),
    torsoSections,
  );
'''
if old not in text:
    raise RuntimeError("calibration-only build block not found")
text = text.replace(old, new, 1)

marker = '''function buildVertexNormals(positions: readonly number[], indices: readonly number[]): Float32Array {'''
if marker not in text:
    raise RuntimeError("calibration-only normal marker not found")
helper = r'''
function calibrateCriticalSections(
  mesh: HumanBodyMesh,
  sections: readonly HumanBodyCrossSection[],
): HumanBodyMesh {
  const positions = new Float32Array(mesh.positions);
  const critical = ["bust", "waist", "full-hip"] as const;
  for (const id of critical) {
    const sectionValue = sectionById(sections, id);
    const currentMm = measureMeshCircumferenceAtY({ ...mesh, positions }, sectionValue.yM) * 1000;
    if (!Number.isFinite(currentMm) || currentMm <= 1e-6) continue;
    const factor = sectionValue.targetCircumferenceMm / currentMm;
    const plateauM = 0.012;
    const influenceM = id === "waist" ? 0.042 : 0.036;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      const y = positions[vertex * 3 + 1];
      const distanceY = Math.abs(y - sectionValue.yM);
      if (distanceY >= influenceM) continue;
      const weight = distanceY <= plateauM
        ? 1
        : smoothstep(1 - (distanceY - plateauM) / (influenceM - plateauM));
      const localScale = 1 + (factor - 1) * weight;
      positions[vertex * 3] *= localScale;
      positions[vertex * 3 + 2] = sectionValue.centerZM
        + (positions[vertex * 3 + 2] - sectionValue.centerZM) * localScale;
    }
  }
  const positionsArray = Array.from(positions);
  const indicesArray = Array.from(mesh.indices);
  return {
    ...mesh,
    positions,
    normals: buildVertexNormals(positionsArray, indicesArray),
    bounds: computeBounds(positionsArray),
  };
}

'''
text = text.replace(marker, helper + marker, 1)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
