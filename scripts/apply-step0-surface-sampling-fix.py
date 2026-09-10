from pathlib import Path

path = Path("apps/web/src/viewport/ArrangementWorkspace.ts")
text = path.read_text(encoding="utf-8")

old = '''  mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  local.push(center.x, center.y, center.z);

  const index = mesh.geometry.getIndex();'''
new = '''  // Body barriers must sample the garment SURFACE only. A bounding-box center
  // is not a surface point once a sewn panel becomes a tube: it lies inside the
  // hollow garment volume (and, correctly, inside the avatar). Treating that
  // synthetic point as garment geometry made Ajustar montagem "detect" a body
  // penetration that did not exist and could trigger a destructive second solve.
  // Vertices and triangle centroids below are actual surface samples and give
  // the same coverage without inventing volume-interior contacts.
  const index = mesh.geometry.getIndex();'''
if old not in text:
    raise SystemExit("bounding-box center sampling block not found")
text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("Removed non-surface bounding-box-center body-barrier sample")
