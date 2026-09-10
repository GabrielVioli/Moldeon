from pathlib import Path

path = Path("apps/web/src/viewport/SewingStep0.ts")
text = path.read_text(encoding="utf-8")

start = text.index("function buildBodyAwareSelfSeamWorldPositions(")
end = text.index("\nfunction nearestWorldVertexIndex(", start)

replacement = r'''function buildBodyAwareSelfSeamWorldPositions(
  solvedState: GarmentAssemblyState,
  instance: GarmentAssemblyState["instances"][number],
  currentWorld: Float32Array,
  section: HumanBodyCrossSection,
  rootSurface: BodySurfaceFrame,
  fit: SewingStep0BodyFit,
  clearanceM: number,
): Float32Array | null {
  // The coarse/isometric assembly already produced the sewn intrinsic shape.
  // Do not rebuild that shape from a body profile here. Doing so made a second
  // solver responsible for creating the garment again and introduced material
  // strain before contact handling. Keep the solved shape rigid and use the
  // authored material frame only to register its pose against the body.
  void clearanceM;
  const materialCircumferenceM = (fit.materialCircumferenceMm ?? 0) * 0.001;
  const requiredCircumferenceM = (fit.requiredCircumferenceMm ?? 0) * 0.001;
  if (materialCircumferenceM <= 0 || requiredCircumferenceM <= 0) return null;
  if (requiredCircumferenceM / materialCircumferenceM
    > 1 + STEP0_MAXIMUM_MATERIAL_STRETCH_PERCENT / 100 + 1e-6) return null;

  const seams = physicalSelfSeamConstraints(solvedState, instance.id);
  if (seams.length < 2) return null;
  const material = instance.topology.positions2DMm;
  const solvedWorld = sliceInstancePositions(solvedState, instance.id);
  if (!material || material.length !== instance.vertexCount * 2 || !solvedWorld) return null;
  if (solvedWorld.length !== currentWorld.length) return null;

  let across = new THREE.Vector2();
  let acrossSamples = 0;
  for (const seam of seams) {
    const a = weightedMaterialPoint2D(instance, seam.a);
    const b = weightedMaterialPoint2D(instance, seam.b);
    if (!a || !b) continue;
    const delta = b.sub(a);
    if (delta.lengthSq() <= 1e-8) continue;
    across.add(delta.normalize());
    acrossSamples += 1;
  }
  if (acrossSamples === 0 || across.lengthSq() <= 1e-8) return null;
  across.normalize();
  const materialAxis = new THREE.Vector2(-across.y, across.x);

  const currentCentroid = centroidOfPositions(currentWorld);
  const anchorVertex = nearestWorldVertexIndex(currentWorld, currentCentroid);
  const anchorMaterial = new THREE.Vector2(material[anchorVertex * 2], material[anchorVertex * 2 + 1]);

  let targetAxis = section.normal
    ? new THREE.Vector3(...section.normal)
    : new THREE.Vector3(0, 1, 0);
  if (targetAxis.lengthSq() <= 1e-10) targetAxis.set(0, 1, 0);
  targetAxis.normalize();
  const currentAxis = materialDirectionInWorld(currentWorld, material, anchorMaterial, materialAxis);
  if (currentAxis.lengthSq() > 1e-10 && targetAxis.dot(currentAxis) < 0) targetAxis.negate();

  let outward = new THREE.Vector3(...rootSurface.outwardNormal);
  outward.addScaledVector(targetAxis, -outward.dot(targetAxis));
  if (outward.lengthSq() <= 1e-10) outward.set(0, 0, 1).addScaledVector(targetAxis, -targetAxis.z);
  if (outward.lengthSq() <= 1e-10) return null;
  outward.normalize();

  let solvedAxis = materialDirectionInWorld(solvedWorld, material, anchorMaterial, materialAxis);
  if (solvedAxis.lengthSq() <= 1e-10) return null;
  solvedAxis.normalize();
  if (solvedAxis.dot(targetAxis) < 0) solvedAxis.negate();

  const solvedCentroid = centroidOfPositions(solvedWorld);
  const solvedAnchor = new THREE.Vector3(
    solvedWorld[anchorVertex * 3],
    solvedWorld[anchorVertex * 3 + 1],
    solvedWorld[anchorVertex * 3 + 2],
  );
  const currentAnchor = new THREE.Vector3(
    currentWorld[anchorVertex * 3],
    currentWorld[anchorVertex * 3 + 1],
    currentWorld[anchorVertex * 3 + 2],
  );

  const alignAxis = new THREE.Quaternion().setFromUnitVectors(solvedAxis, targetAxis);
  const solvedAnchorOffset = solvedAnchor.clone().sub(solvedCentroid).applyQuaternion(alignAxis);
  const solvedAnchorRadial = solvedAnchorOffset.clone()
    .addScaledVector(targetAxis, -solvedAnchorOffset.dot(targetAxis));
  if (solvedAnchorRadial.lengthSq() <= 1e-10) return null;
  solvedAnchorRadial.normalize();

  const cross = new THREE.Vector3().crossVectors(solvedAnchorRadial, outward);
  const signedAngle = Math.atan2(
    targetAxis.dot(cross),
    THREE.MathUtils.clamp(solvedAnchorRadial.dot(outward), -1, 1),
  );
  const faceAuthoredSide = new THREE.Quaternion().setFromAxisAngle(targetAxis, signedAngle);
  const rotation = faceAuthoredSide.multiply(alignAxis);

  // Keep the authored material anchor fixed. For a front-authored flat panel,
  // this naturally moves the centre of the newly closed tube inward while the
  // user's chosen body location remains the point of attachment.
  const registeredAnchorOffset = solvedAnchor.clone().sub(solvedCentroid).applyQuaternion(rotation);
  const translation = currentAnchor.clone().sub(registeredAnchorOffset);
  const result = new Float32Array(solvedWorld.length);
  const point = new THREE.Vector3();
  for (let offset = 0; offset < solvedWorld.length; offset += 3) {
    point.set(solvedWorld[offset], solvedWorld[offset + 1], solvedWorld[offset + 2])
      .sub(solvedCentroid)
      .applyQuaternion(rotation)
      .add(translation);
    result[offset] = point.x;
    result[offset + 1] = point.y;
    result[offset + 2] = point.z;
  }
  return [...result].every(Number.isFinite) ? result : null;
}
'''

text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")
print("Applied rigid solved-shape STEP-0 body registration patch")
