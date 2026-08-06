from pathlib import Path
import re

ROOT = Path(".")


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    found = source.count(old)
    if found < count:
        raise SystemExit(f"{path}: expected {count} occurrences, found {found}: {old[:120]!r}")
    target.write_text(source.replace(old, new, count), encoding="utf-8")


def regex(path: str, pattern: str, replacement: str, count: int = 1) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    updated, matches = re.subn(pattern, replacement, source, count=count, flags=re.S)
    if matches != count:
        raise SystemExit(f"{path}: expected {count} regex matches, found {matches}: {pattern[:120]!r}")
    target.write_text(updated, encoding="utf-8")


CATALOG = "apps/web/src/patterns/templateCatalog.ts"
replace(
    CATALOG,
    'import {\n  BASE_PATTERN_METADATA,\n  draftBasePattern,\n  isBasePatternTemplateId,\n  type PatternValidationStatus,\n} from "./basePatternDrafting";\n',
    'import {\n  BASE_PATTERN_METADATA,\n  draftBasePattern,\n  isBasePatternTemplateId,\n  type PatternValidationStatus,\n} from "./basePatternDrafting";\nimport {\n  draftTrouserPattern,\n  TROUSER_PATTERN_METADATA,\n} from "./trouserPatternDrafting";\n',
)
replace(
    CATALOG,
    '  formulaVersion: string;\n}\n',
    '  formulaVersion: string;\n  instanceExpansion?: string[];\n}\n',
)
replace(
    CATALOG,
    '  "straight-pants": "straight-pants@1",\n',
    '  "straight-pants": TROUSER_PATTERN_METADATA.templateVersion,\n',
)
old_pants_card = '''  {
    id: "straight-pants",
    name: "Calça reta",
    category: "Parte de baixo",
    description: "Perna reta e gancho simplificado para edição.",
    pieces: "Frente e costas",
    status: "available",
    validationStatus: "experimental",
    reviewNotes: ["Fora do escopo do Prompt 6; o gerador de calça permanece simplificado e sem revisão manual."],
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["straight-pants"],
    requiredMeasurements: ["cintura", "quadril", "altura", "entrepernas"],
    estimatedMeasurements: ["gancho", "coxa", "joelho", "barra"],
  },
'''
new_pants_card = '''  {
    id: "straight-pants",
    name: "Calça reta",
    category: "Parte de baixo",
    description: "Base paramétrica com frente, costas e ganchos construídos separadamente.",
    pieces: "2 definições editáveis · 4 instâncias físicas",
    status: "available",
    validationStatus: TROUSER_PATTERN_METADATA.validationStatus,
    reviewNotes: TROUSER_PATTERN_METADATA.notes,
    formulaVersion: TEMPLATE_FORMULA_VERSIONS["straight-pants"],
    requiredMeasurements: ["cintura", "quadril", "gancho sentado", "coxa", "joelho", "entrepernas"],
    estimatedMeasurements: ["profundidade do gancho", "assento", "queda de cintura", "tornozelo"],
    instanceExpansion: [
      "Frente · cortar 2x → frente esquerda e frente direita",
      "Costas · cortar 2x → costas esquerda e costas direita",
    ],
  },
'''
replace(CATALOG, old_pants_card, new_pants_card)
replace(
    CATALOG,
    '  const baseDraft = isBasePatternTemplateId(templateId)\n    ? draftBasePattern(templateId, measurements)\n    : undefined;\n',
    '  const parametricDraft = isBasePatternTemplateId(templateId)\n    ? draftBasePattern(templateId, measurements)\n    : templateId === "straight-pants"\n      ? draftTrouserPattern(measurements)\n      : undefined;\n',
)
replace(CATALOG, '  const pieces = (baseDraft?.pieces ?? generator(measurements)).map((piece) => ({\n', '  const pieces = (parametricDraft?.pieces ?? generator(measurements)).map((piece) => ({\n')
replace(CATALOG, '      variables: baseDraft?.variables ?? [],\n', '      variables: parametricDraft?.variables ?? [],\n')
replace(CATALOG, '      constructionGraph: baseDraft?.constructionGraph\n', '      constructionGraph: parametricDraft?.constructionGraph\n')
replace(CATALOG, '        ...(baseDraft ? {\n          constructionSystem: baseDraft.metadata.constructionSystem,\n          validationStatus: baseDraft.metadata.validationStatus,\n          componentValidation: baseDraft.metadata.componentStatus,\n          requiredMeasurements: baseDraft.metadata.requiredMeasurements,\n          estimatedMeasurements: baseDraft.metadata.estimatedMeasurements,\n          ease: baseDraft.metadata.ease,\n          limits: baseDraft.metadata.limits,\n          manualReview: baseDraft.metadata.manualReview,\n', '        ...(parametricDraft ? {\n          constructionSystem: parametricDraft.metadata.constructionSystem,\n          validationStatus: parametricDraft.metadata.validationStatus,\n          componentValidation: parametricDraft.metadata.componentStatus,\n          requiredMeasurements: parametricDraft.metadata.requiredMeasurements,\n          estimatedMeasurements: parametricDraft.metadata.estimatedMeasurements,\n          ease: parametricDraft.metadata.ease,\n          limits: parametricDraft.metadata.limits,\n          manualReview: parametricDraft.metadata.manualReview,\n')
replace(CATALOG, '    ease: baseDraft?.ease ?? { bustMm: 80, waistMm: 60, hipMm: 80, sleeveMm: 50 },\n', '    ease: parametricDraft?.ease ?? { bustMm: 80, waistMm: 60, hipMm: 80, sleeveMm: 50 },\n')
replace(CATALOG, '  "straight-pants": createPantsPieces,\n', '  "straight-pants": (measurements) => draftTrouserPattern(measurements).pieces,\n')
regex(
    CATALOG,
    r'function createPantsPieces\(measurements: BodyMeasurements\): PatternPiece\[\] \{.*?\n\}\n\nfunction createJacketPieces',
    'function createJacketPieces',
)

DIALOG = "apps/web/src/components/PatternLibraryDialog.tsx"
replace(
    DIALOG,
    '                <small>{template.pieces}</small>\n',
    '                <small>{template.pieces}</small>\n                {template.instanceExpansion?.map((line) => (\n                  <small className="template-instance-expansion" key={line}>{line}</small>\n                ))}\n',
)

MEASUREMENTS = "apps/web/src/domain/parametricMeasurements.ts"
replace(
    MEASUREMENTS,
    '    sideSeamToleranceMm: number;\n    minimumCurveSeparationMm: number;\n',
    '    sideSeamToleranceMm: number;\n    inseamToleranceMm?: number;\n    minimumCurveSeparationMm: number;\n',
)

SEAMS = "apps/web/src/domain/templateAssemblySeams.ts"
replace(
    SEAMS,
    '  const skirtDefinitions = buildSkirtDefinitions(garment.pieces);\n  return skirtDefinitions.map(createSeam);\n',
    '  const trouserDefinitions = buildTrouserDefinitions(garment.pieces);\n\n  if (trouserDefinitions.length > 0) {\n    return trouserDefinitions.map(createSeam);\n  }\n\n  const skirtDefinitions = buildSkirtDefinitions(garment.pieces);\n  return skirtDefinitions.map(createSeam);\n',
)
trouser_builder = '''
function buildTrouserDefinitions(
  pieces: readonly PatternPiece[],
): SeamDefinition[] {
  const front = pieces.find(
    (piece) => hasRole(piece, "frontCrotch") && !hasRole(piece, "backCrotch"),
  );
  const back = pieces.find(
    (piece) => hasRole(piece, "backCrotch") && !hasRole(piece, "frontCrotch"),
  );
  if (!front || !back) return [];

  const frontOutseams = edgesWithRole(front, "outseam");
  const backOutseams = edgesWithRole(back, "outseam");
  const frontInseams = edgesWithRole(front, "inseam");
  const backInseams = edgesWithRole(back, "inseam");
  if (
    frontOutseams.length === 0 ||
    frontOutseams.length !== backOutseams.length ||
    frontInseams.length === 0 ||
    frontInseams.length !== backInseams.length
  ) {
    return [];
  }

  return [
    ...frontOutseams.map((edge, index): SeamDefinition => ({
      key: `trouser-outseam-${index + 1}`,
      name: `Laterais das pernas ${index + 1}/${frontOutseams.length}`,
      firstPiece: front,
      firstEdge: edge,
      secondPiece: back,
      secondEdge: backOutseams[index],
      direction: "same",
      treatment: "ease",
    })),
    ...frontInseams.map((edge, index): SeamDefinition => ({
      key: `trouser-inseam-${index + 1}`,
      name: `Entrepernas ${index + 1}/${frontInseams.length}`,
      firstPiece: front,
      firstEdge: edge,
      secondPiece: back,
      secondEdge: backInseams[index],
      direction: "same",
      treatment: "ease",
    })),
  ];
}

'''
replace(SEAMS, 'function buildSkirtDefinitions(\n', trouser_builder + 'function buildSkirtDefinitions(\n')

CATALOG_TEST = "apps/web/src/patterns/templateCatalog.test.ts"
replace(
    CATALOG_TEST,
    '    expect(pants.pieces.find((piece) => piece.name === "Costas")?.darts).toHaveLength(1);\n',
    '    expect(pants.pieces.every((piece) => piece.darts?.length === 1)).toBe(true);\n    expect(pants.parametric?.templateVersion).toBe("straight-pants@2");\n    expect(PATTERN_TEMPLATES.find((template) => template.id === "straight-pants")?.instanceExpansion).toHaveLength(2);\n',
)

SEAM_TEST = "apps/web/src/domain/templateAssemblySeams.test.ts"
insert_test = '''
  it("creates complete definition-level outseam and inseam ranges for trousers", () => {
    const garment = createGarmentFromTemplate(
      "straight-pants",
      DEFAULT_BODY_MEASUREMENTS,
    );
    const seams = buildTemplateAssemblySeams(garment);
    const roles = seams.map((seam) => {
      const firstPiece = garment.pieces.find((piece) => piece.id === seam.first.pieceId)!;
      const secondPiece = garment.pieces.find((piece) => piece.id === seam.second.pieceId)!;
      const firstRole = getPatternEdges(firstPiece).find((edge) => edge.id === seam.first.edgeId)?.role;
      const secondRole = getPatternEdges(secondPiece).find((edge) => edge.id === seam.second.edgeId)?.role;
      return `${firstRole}/${secondRole}`;
    });
    expect(seams.length).toBeGreaterThanOrEqual(6);
    expect(roles.filter((role) => role === "outseam/outseam").length).toBeGreaterThanOrEqual(3);
    expect(roles.filter((role) => role === "inseam/inseam").length).toBeGreaterThanOrEqual(2);
    expect(roles.some((role) => /Crotch/.test(role))).toBe(false);
  });

'''
replace(SEAM_TEST, '  it("replaces incompatible template-edge seams and preserves unrelated custom seams", () => {\n', insert_test + '  it("replaces incompatible template-edge seams and preserves unrelated custom seams", () => {\n')

print("Prompt 7 integration patch applied")
