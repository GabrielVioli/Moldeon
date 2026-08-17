import {
  edgeRangeLength,
  getPatternEdges,
  seamSideRanges,
  type GarmentDraft,
  type PatternEdge,
  type PatternPiece,
  type Seam,
  type SeamDirection,
  type SeamTreatment,
  type SegmentRole,
} from "./pattern";
import { buildGuidedSleeveAssemblySeams } from "./sleeveSystem";

interface SeamDefinition {
  key: string;
  name: string;
  firstPiece: PatternPiece;
  firstEdge: PatternEdge;
  secondPiece: PatternPiece;
  secondEdge: PatternEdge;
  direction: SeamDirection;
  treatment?: SeamTreatment;
}

/**
 * Retorna uma versão do documento com as costuras estruturais do molde-base.
 *
 * Costuras personalizadas nomeadas que não usam bordas reservadas são
 * preservadas. Costuras genéricas como "Costura" e "Costura 4" são removidas
 * durante o reparo, pois normalmente são tentativas manuais incompatíveis com
 * a semântica do molde-base.
 */
export function resolveTemplateAssemblyGarment(
  garment: GarmentDraft,
): GarmentDraft {
  const canonical = buildTemplateAssemblySeams(garment);

  if (canonical.length === 0) {
    return garment;
  }

  const reservedEdges = new Set(
    canonical.flatMap((seam) =>
      [...seamSideRanges(seam, "first"), ...seamSideRanges(seam, "second")]
        .map((range) => edgeReferenceKey(range.pieceId, range.edgeId))),
  );
  const existingByPair = new Map(
    (garment.seams ?? []).map((seam) => [seamPairKey(seam), seam]),
  );
  const preservedCustom = (garment.seams ?? []).filter((seam) =>
    !isGenericSeamName(seam.name) &&
    [...seamSideRanges(seam, "first"), ...seamSideRanges(seam, "second")]
      .every((range) => !reservedEdges.has(edgeReferenceKey(range.pieceId, range.edgeId))),
  );
  const resolvedCanonical = canonical.map((seam) => {
    const existing = existingByPair.get(seamPairKey(seam));

    if (!existing) return seam;

    const treatment = existing.treatment ?? seam.treatment ?? "standard";

    return {
      ...seam,
      id: existing.id,
      name: existing.name?.trim() || seam.name,
      treatment,
      type: treatment,
      easeRatio: seam.easeRatio,
    };
  });

  return {
    ...garment,
    seams: [...preservedCustom, ...resolvedCanonical],
  };
}

export function buildTemplateAssemblySeams(
  garment: Pick<GarmentDraft, "pieces">,
): Seam[] {
  const topSeams = buildGuidedSleeveAssemblySeams(garment.pieces);
  if (topSeams.length > 0) return topSeams;

  const trouserDefinitions = buildTrouserDefinitions(garment.pieces);

  if (trouserDefinitions.length > 0) {
    return [
      ...trouserDefinitions.map(createSeam),
      ...buildTrouserPairedCopyClosures(garment.pieces),
    ];
  }

  const skirtDefinitions = buildSkirtDefinitions(garment.pieces);
  return skirtDefinitions.map(createSeam);
}

export function templateAssemblyNeedsRepair(
  garment: GarmentDraft,
): boolean {
  const resolved = resolveTemplateAssemblyGarment(garment);
  return seamSetSignature(resolved.seams) !== seamSetSignature(garment.seams);
}

export function seamSetSignature(
  seams: readonly Seam[] | undefined,
): string {
  return [...(seams ?? [])]
    .map((seam) => [
      seamPairKey(seam),
      seam.direction,
      seam.treatment ?? "standard",
    ].join("/"))
    .sort()
    .join("|");
}

export function groupSeamsByRelation(
  seams: readonly Seam[] | undefined,
): Seam[][] {
  const groups = new Map<string, Seam[]>();
  for (const seam of seams ?? []) {
    const key = seam.groupId?.trim() || seam.id;
    const group = groups.get(key);
    if (group) group.push(seam);
    else groups.set(key, [seam]);
  }
  return [...groups.values()];
}

export function seamRelationLabel(group: readonly Seam[]): string {
  return (group[0]?.name ?? "Costura").replace(/ · trecho \d+$/, "");
}

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

function buildTrouserPairedCopyClosures(
  pieces: readonly PatternPiece[],
): Seam[] {
  const result: Seam[] = [];
  const definitions: Array<{ role: "frontCrotch" | "backCrotch"; key: string; name: string }> = [
    { role: "frontCrotch", key: "trouser-front-rise", name: "Fechamento do gancho frontal" },
    { role: "backCrotch", key: "trouser-back-rise", name: "Fechamento do gancho traseiro" },
  ];
  for (const definition of definitions) {
    const piece = pieces.find((candidate) => hasRole(candidate, definition.role));
    if (!piece || (piece.cutQuantity ?? 1) < 2) continue;
    const edges = edgesWithRole(piece, definition.role);
    if (edges.length === 0) continue;
    const ranges = edges.map((edge) => ({
      pieceId: piece.id,
      edgeId: edge.id,
      startT: 0,
      endT: 1,
    }));
    const first = ranges[0];
    result.push({
      id: `template-seam:${definition.key}`,
      groupId: `template-seam:${definition.key}`,
      name: definition.name,
      first,
      second: { ...first },
      firstRanges: ranges.map((range) => ({ ...range })),
      secondRanges: ranges.map((range) => ({ ...range })),
      direction: "same",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      canonicalTreatment: "standard",
      distribution: "uniform",
      targetRatio: 1,
      slackMm: 0,
      physicalPairing: "paired-copies",
      active: true,
    });
  }
  return result;
}

function buildSkirtDefinitions(
  pieces: readonly PatternPiece[],
): SeamDefinition[] {
  const candidates = pieces.filter(
    (piece) =>
      hasRole(piece, "waist") &&
      hasRole(piece, "hem") &&
      hasRole(piece, "sideSeam") &&
      !hasRole(piece, "frontArmhole") &&
      !hasRole(piece, "backArmhole"),
  );

  if (candidates.length !== 2) return [];

  const firstSide = firstEdge(candidates[0], "sideSeam");
  const secondSide = firstEdge(candidates[1], "sideSeam");

  if (!firstSide || !secondSide) return [];

  return [
    {
      key: "skirt-side",
      name: "Laterais da saia",
      firstPiece: candidates[0],
      firstEdge: firstSide,
      secondPiece: candidates[1],
      secondEdge: secondSide,
      direction: "same",
      treatment: "standard",
    },
  ];
}

function createSeam(definition: SeamDefinition): Seam {
  const first = {
    pieceId: definition.firstPiece.id,
    edgeId: definition.firstEdge.id,
    startT: 0,
    endT: 1,
  };
  const second = {
    pieceId: definition.secondPiece.id,
    edgeId: definition.secondEdge.id,
    startT: 0,
    endT: 1,
  };
  const firstLength = edgeRangeLength(definition.firstPiece, first);
  const secondLength = edgeRangeLength(definition.secondPiece, second);
  const difference = Math.abs(firstLength - secondLength);
  const reference = Math.max(firstLength, secondLength, 1);
  const treatment = definition.treatment ?? "standard";

  return {
    id: `template-seam:${definition.key}`,
    name: definition.name,
    first,
    second,
    direction: definition.direction,
    easeRatio: difference / reference,
    type: treatment,
    treatment,
  };
}

function hasRole(piece: PatternPiece, role: SegmentRole): boolean {
  return getPatternEdges(piece).some((edge) => edge.role === role);
}

function firstEdge(
  piece: PatternPiece,
  role: SegmentRole,
): PatternEdge | undefined {
  return edgesWithRole(piece, role)[0];
}

function edgesWithRole(
  piece: PatternPiece,
  role: SegmentRole,
): PatternEdge[] {
  return getPatternEdges(piece).filter((edge) => edge.role === role);
}

function edgeReferenceKey(pieceId: string, edgeId: string): string {
  return `${pieceId}/${edgeId}`;
}

function seamPairKey(seam: Seam): string {
  const first = seamSideRanges(seam, "first").map((range) => edgeReferenceKey(range.pieceId, range.edgeId)).join(">");
  const second = seamSideRanges(seam, "second").map((range) => edgeReferenceKey(range.pieceId, range.edgeId)).join(">");
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function isGenericSeamName(name: string | undefined): boolean {
  const normalized = (name ?? "").trim().toLocaleLowerCase("pt-BR");
  return normalized === "" || /^costura(?:\s+\d+)?$/.test(normalized);
}
