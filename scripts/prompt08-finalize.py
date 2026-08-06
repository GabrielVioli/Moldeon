from pathlib import Path

ROOT = Path(".")


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    found = source.count(old)
    if found < count:
        raise SystemExit(f"{path}: expected {count} occurrences, found {found}: {old[:120]!r}")
    target.write_text(source.replace(old, new, count), encoding="utf-8")


# Make body confirmation directly addressable in browser audits.
replace(
    "apps/web/src/components/SleeveWizardDialog.tsx",
    '<input type="checkbox" checked={confirmed} onChange={(event) => onConfirmedChange(event.currentTarget.checked)} />',
    '<input type="checkbox" checked={confirmed} onChange={(event) => onConfirmedChange(event.currentTarget.checked)} data-testid="sleeve-confirm-body" />',
)

# Keep the guided action available on mobile instead of silently hiding it.
replace(
    "apps/web/src/styles.css",
    '  .toolbar-actions .sleeve-button { display: none; }\n',
    '''  .toolbar-actions .sleeve-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 104px;
    padding: 0 9px;
    font-size: 10px;
    white-space: nowrap;
  }
''',
)

# Add connector coverage and canonical document validation assertions.
TEST = "apps/web/src/domain/sleeveSystem.test.ts"
replace(
    TEST,
    'import { garmentDraftToPatternDocumentV3 } from "./patternDocumentV3";\nimport { getPatternEdges, type GarmentDraft, type PatternPiece } from "./pattern";\n',
    'import { garmentDraftToPatternDocumentV3, validatePatternDocumentV3 } from "./patternDocumentV3";\nimport { edgeRangeLength, getPatternEdges, type GarmentDraft, type PatternPiece } from "./pattern";\n',
)
replace(
    TEST,
    '    expect(document.panelInstances.filter((instance) => instance.sourcePatternId === draft.sleevePiece.id).map((instance) => [\n',
    '    expect(validatePatternDocumentV3(document)).toEqual([]);\n    expect(document.panelInstances.filter((instance) => instance.sourcePatternId === draft.sleevePiece.id).map((instance) => [\n',
)
coverage_test = '''
  it("covers every front and back armhole and cap interval exactly once", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const draft = draftGuidedSleeve(
      garment,
      front.id,
      back.id,
      createDefaultSleeveSettings(garment, front.id, back.id, "short"),
    );
    const groups = [
      {
        id: "guided-sleeve:front-armhole",
        body: front,
        bodyRole: "frontArmhole" as const,
        capRole: "sleeveCapFront" as const,
      },
      {
        id: "guided-sleeve:back-armhole",
        body: back,
        bodyRole: "backArmhole" as const,
        capRole: "sleeveCapBack" as const,
      },
    ];
    for (const group of groups) {
      const seams = draft.seams.filter((seam) => seam.groupId === group.id);
      const bodyCoverage = seams.reduce(
        (sum, seam) => sum + edgeRangeLength(group.body, seam.first),
        0,
      );
      const capCoverage = seams.reduce(
        (sum, seam) => sum + edgeRangeLength(draft.sleevePiece, seam.second),
        0,
      );
      expect(bodyCoverage, `${group.id}/body`).toBeCloseTo(roleArcLength(group.body, group.bodyRole), 1);
      expect(capCoverage, `${group.id}/cap`).toBeCloseTo(roleArcLength(draft.sleevePiece, group.capRole), 1);
      expect(seams.every((seam) => seam.first.startT < seam.first.endT && seam.second.startT < seam.second.endT)).toBe(true);
    }
  });

'''
replace(
    TEST,
    '  it("updates from changed shoulder and armhole geometry", () => {\n',
    coverage_test + '  it("updates from changed shoulder and armhole geometry", () => {\n',
)
helper = '''
function roleArcLength(
  piece: PatternPiece,
  role: "frontArmhole" | "backArmhole" | "sleeveCapFront" | "sleeveCapBack",
): number {
  return getPatternEdges(piece)
    .filter((edge) => edge.role === role)
    .reduce((sum, edge) => sum + edgeRangeLength(piece, {
      pieceId: piece.id,
      edgeId: edge.id,
      startT: 0,
      endT: 1,
    }), 0);
}

'''
replace(TEST, 'function bounds(piece: PatternPiece) {\n', helper + 'function bounds(piece: PatternPiece) {\n')

print("Prompt 8 hardening patch applied")
