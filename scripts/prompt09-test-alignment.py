from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/domain/assembly.test.ts",
    '''  it("shows valid pieces before costuring and reserves body fitting for assembled garments", () => {
    const draft = garment();
    expect(evaluateGarment3DEligibility(draft)).toMatchObject({
      canPreviewGarment: true,
      canDressBody: false,
      connectedPieceIds: ["front", "back"],
    });
    draft.seams = [seamFor(draft)];
    expect(evaluateGarment3DEligibility(draft)).toMatchObject({
      canPreviewGarment: true,
      canDressBody: true,
      connectedPieceIds: ["front", "back"],
    });
  });''',
    '''  it("authorizes the always-dressed viewport for valid anchored pieces before and after sewing", () => {
    const draft = garment();
    expect(evaluateGarment3DEligibility(draft)).toMatchObject({
      canPreviewGarment: true,
      canDressBody: true,
      connectedPieceIds: ["front", "back"],
    });
    draft.seams = [seamFor(draft)];
    expect(evaluateGarment3DEligibility(draft)).toMatchObject({
      canPreviewGarment: true,
      canDressBody: true,
      connectedPieceIds: ["front", "back"],
    });
  });''',
)

replace_once(
    "apps/web/src/domain/assembly.test.ts",
    '''  it("does not authorize loading Three.js before both eligibility and an explicit request", () => {
    const draft = garment();
    draft.seams = [seamFor(draft)];
    const eligibility = evaluateGarment3DEligibility(draft);
    expect(shouldLoadThreeViewport(eligibility, false, "assembly")).toBe(false);
    expect(shouldLoadThreeViewport(eligibility, true, "assembly")).toBe(true);
    expect(
      shouldLoadThreeViewport(
        { ...eligibility, canDressBody: false },
        true,
        "fitting",
      ),
    ).toBe(false);
  });''',
    '''  it("loads Three.js only after eligibility and an explicit request, independent of legacy fitting flags", () => {
    const draft = garment();
    draft.seams = [seamFor(draft)];
    const eligibility = evaluateGarment3DEligibility(draft);
    expect(shouldLoadThreeViewport(eligibility, false, "assembly")).toBe(false);
    expect(shouldLoadThreeViewport(eligibility, true, "assembly")).toBe(true);
    expect(
      shouldLoadThreeViewport(
        { ...eligibility, canDressBody: false },
        true,
        "fitting",
      ),
    ).toBe(true);
  });''',
)

replace_once(
    "apps/web/src/garment3d/PhysicalGarmentAssembly.test.ts",
    '''  it("duplica uma costura lateral para os lados esquerdo e direito", () => {''',
    '''  it("duplica uma costura lateral por lado e mantém a expansão física neutra antes dos anchors", () => {''',
)
replace_once(
    "apps/web/src/garment3d/PhysicalGarmentAssembly.test.ts",
    '''    expect(
      averageInstanceZ(
        state.initialPositions,
        frontInstance.particleStart,
        frontInstance.vertexCount,
      ),
    ).toBeGreaterThan(0);
    expect(
      averageInstanceZ(
        state.initialPositions,
        backInstance.particleStart,
        backInstance.vertexCount,
      ),
    ).toBeLessThan(0);''',
    '''    expect(
      averageInstanceZ(
        state.initialPositions,
        frontInstance.particleStart,
        frontInstance.vertexCount,
      ),
    ).toBeCloseTo(0, 7);
    expect(
      averageInstanceZ(
        state.initialPositions,
        backInstance.particleStart,
        backInstance.vertexCount,
      ),
    ).toBeCloseTo(0, 7);''',
)

replace_once(
    "apps/web/src/garment3d/SemanticAvatarArrangement.test.ts",
    '''    const invalid: GarmentDraft = {
      ...garment,
      pieces: garment.pieces.map((piece) => piece.id === invalidPieceId ? { ...piece, previewPlacements: [] } : piece),
      assemblyPlacements: garment.assemblyPlacements?.filter((placement) => placement.pieceId !== invalidPieceId),
    };
    const result = buildSemanticAvatarArrangement(
      invalid.pieces.map(createPatternSnapshot),
      invalid,
      buildAvatarParametricModel(invalid.measurements, invalid.bodyType),
    );''',
    '''    const snapshots = garment.pieces.map(createPatternSnapshot);
    const invalid: GarmentDraft = {
      ...garment,
      pieces: garment.pieces.map((piece) => piece.id === invalidPieceId ? { ...piece, previewPlacements: [] } : piece),
      assemblyPlacements: garment.assemblyPlacements?.filter((placement) => placement.pieceId !== invalidPieceId),
    };
    const result = buildSemanticAvatarArrangement(
      snapshots,
      invalid,
      buildAvatarParametricModel(invalid.measurements, invalid.bodyType),
    );''',
)

print("Prompt 9 legacy tests aligned")
