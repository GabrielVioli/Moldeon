from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "apps/web/src/viewport/SewingStep0Placement.test.ts"
text = path.read_text(encoding="utf-8")
text = text.replace(
    '  measureCurrentSewingStep0MaterialDistortion,\n  meshWorldMaterialAnchor,\n',
    '  measureCurrentSewingStep0MaterialDistortion,\n  meshWorldCentroid,\n  meshWorldMaterialAnchor,\n',
    1,
)

first_pattern = re.compile(r'''  it\("closes the current 435 x 227 mm editor panel without pretending it fits around the body", \(\) => \{.*?  \}, 15_000\);\n\n  it\("transplants the proven global self-seam shape into the authored workspace", \(\) => \{''', re.S)
first_replacement = '''  it("closes and body-centers the current 435 x 227 mm editor panel without body fitting", () => {
    const fixture = editorAuthoredRectangleFixture(435, 227);
    const solved = buildCoarseIsometricAssembly(fixture.input.assemblyDocument);
    const avatar = buildAvatarParametricModel(fixture.input.document.measurements.values, fixture.input.document.body.type);
    const authoredCenter = meshWorldCentroid(fixture.mesh.mesh);
    const section = avatar.humanBody.crossSections.reduce((best, candidate) =>
      Math.abs(candidate.yM - authoredCenter.y) < Math.abs(best.yM - authoredCenter.y) ? candidate : best,
    );
    const applied = applySewingStep0SolvedComponent(
      fixture.state,
      solved.state,
      [fixture.mesh],
      fixture.target,
      { bodySection: section },
    );
    expect(applied).not.toBeNull();
    expect(applied!.registrationMode).toBe("body-centered-rigid");
    refreshMeshFromAssembly(fixture.mesh, fixture.state);
    const local = fixture.mesh.mesh.geometry.getAttribute("position").array as Float32Array;
    const residual = measureCurrentSewingStep0Residual(fixture.state, [fixture.mesh], fixture.target)!;
    const metric = measureCurrentSewingStep0MaterialDistortion(fixture.state, [fixture.mesh], fixture.target)!;
    const finalCenter = meshWorldCentroid(fixture.mesh.mesh);
    const sectionCenter = section.centerM ?? [0, section.yM, section.centerZM];
    expect(componentSpan(local, 2)).toBeGreaterThan(0.1);
    expect(residual.maximumM).toBeLessThan(0.005);
    expect(metric).toBeLessThan(0.02);
    expect(Math.abs(finalCenter.x - sectionCenter[0])).toBeLessThan(0.005);
    expect(Math.abs(finalCenter.z - sectionCenter[2])).toBeLessThan(0.005);
    // 435 mm may be physically too small for this body region. Montar still
    // assembles and centers it; Provar/XPBD owns collision and fitting.
  }, 15_000);

  it("transplants the proven global self-seam shape into the authored workspace", () => {'''
text, count = first_pattern.subn(first_replacement, text, count=1)
if count != 1:
    raise RuntimeError(f"first STEP-0 placement test replacement expected 1, got {count}")

second_pattern = re.compile(r'''  it\("transplants the proven global self-seam shape into the authored workspace", \(\) => \{.*?  \}, 15_000\);\n\n  it\("improves sewn boundaries without replacing either manually authored transform", \(\) => \{''', re.S)
second_replacement = '''  it("transplants the proven global self-seam shape into the authored workspace", () => {
    const fixture = editorAuthoredRectangleFixture();
    const solved = buildCoarseIsometricAssembly(fixture.input.assemblyDocument);
    const avatar = buildAvatarParametricModel(fixture.input.document.measurements.values, fixture.input.document.body.type);
    const authoredCenter = meshWorldCentroid(fixture.mesh.mesh);
    const section = avatar.humanBody.crossSections.reduce((best, candidate) =>
      Math.abs(candidate.yM - authoredCenter.y) < Math.abs(best.yM - authoredCenter.y) ? candidate : best,
    );
    const applied = applySewingStep0SolvedComponent(
      fixture.state,
      solved.state,
      [fixture.mesh],
      fixture.target,
      { bodySection: section },
    );
    expect(applied).not.toBeNull();
    expect(applied!.registrationMode).toBe("body-centered-rigid");
    refreshMeshFromAssembly(fixture.mesh, fixture.state);
    const residual = measureCurrentSewingStep0Residual(fixture.state, [fixture.mesh], fixture.target);
    const metric = measureCurrentSewingStep0MaterialDistortion(fixture.state, [fixture.mesh], fixture.target);
    const local = fixture.mesh.mesh.geometry.getAttribute("position").array as Float32Array;
    const finalCenter = meshWorldCentroid(fixture.mesh.mesh);
    const sectionCenter = section.centerM ?? [0, section.yM, section.centerZM];
    expect(solved.assembly.components[0]?.selectedSeed).toContain("developable");
    expect(solved.assembly.metrics.structuralSeamMaxMm).toBeLessThan(0.5);
    expect(residual!.maximumM).toBeLessThan(0.005);
    expect(metric!).toBeLessThan(0.02);
    expect(componentSpan(local, 2)).toBeGreaterThan(0.3);
    expect(Math.abs(finalCenter.x - sectionCenter[0])).toBeLessThan(0.005);
    expect(Math.abs(finalCenter.z - sectionCenter[2])).toBeLessThan(0.005);

    const accepted = new Float32Array(
      fixture.mesh.mesh.geometry.getAttribute("position").array as Float32Array,
    );
    const repeated = applySewingStep0SolvedComponent(
      fixture.state,
      solved.state,
      [fixture.mesh],
      fixture.target,
      { bodySection: section },
    );
    expect(repeated).not.toBeNull();
    refreshMeshFromAssembly(fixture.mesh, fixture.state);
    const repeatedLocal = fixture.mesh.mesh.geometry.getAttribute("position").array as Float32Array;
    expect(maximumPositionDelta(accepted, repeatedLocal)).toBeLessThan(0.002);
  }, 15_000);

  it("improves sewn boundaries without replacing either manually authored transform", () => {'''
text, count = second_pattern.subn(second_replacement, text, count=1)
if count != 1:
    raise RuntimeError(f"second STEP-0 placement test replacement expected 1, got {count}")

path.write_text(text, encoding="utf-8")
print("Aligned STEP-0 placement tests with preassembly contract.")
