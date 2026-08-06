import {
  edgeRangeLength,
  getPatternEdges,
  type GarmentDraft,
  type PatternEdge,
  type PatternPiece,
  type Seam,
  type SeamDirection,
  type SeamTreatment,
  type SegmentRole,
} from "./pattern";

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
    canonical.flatMap((seam) => [
      edgeReferenceKey(seam.first.pieceId, seam.first.edgeId),
      edgeReferenceKey(seam.second.pieceId, seam.second.edgeId),
    ]),
  );
  const existingByPair = new Map(
    (garment.seams ?? []).map((seam) => [seamPairKey(seam), seam]),
  );
  const preservedCustom = (garment.seams ?? []).filter((seam) =>
    !isGenericSeamName(seam.name) &&
    !reservedEdges.has(edgeReferenceKey(seam.first.pieceId, seam.first.edgeId)) &&
    !reservedEdges.has(edgeReferenceKey(seam.second.pieceId, seam.second.edgeId)),
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
  const topDefinitions = buildTopDefinitions(garment.pieces);

  if (topDefinitions.length > 0) {
    return topDefinitions.map(createSeam);
  }

  const trouserDefinitions = buildTrouserDefinitions(garment.pieces);

  if (trouserDefinitions.length > 0) {
    return trouserDefinitions.map(createSeam);
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

function buildTopDefinitions(
  pieces: readonly PatternPiece[],
): SeamDefinition[] {
  const front = pieces.find((piece) => hasRole(piece, "frontArmhole"));
  const back = pieces.find((piece) => hasRole(piece, "backArmhole"));
  const sleeve = pieces.find(
    (piece) => hasRole(piece, "sleeveCapFront") && hasRole(piece, "sleeveCapBack"),
  );

  if (!front || !back || !sleeve) return [];

  const frontShoulder = firstEdge(front, "shoulder");
  const backShoulder = firstEdge(back, "shoulder");
  const frontSide = firstEdge(front, "sideSeam");
  const backSide = firstEdge(back, "sideSeam");
  const frontArmhole = firstEdge(front, "frontArmhole");
  const backArmhole = firstEdge(back, "backArmhole");
  const sleeveCapFront = firstEdge(sleeve, "sleeveCapFront");
  const sleeveCapBack = firstEdge(sleeve, "sleeveCapBack");
  const sleeveSides = edgesWithRole(sleeve, "sideSeam");

  if (
    !frontShoulder ||
    !backShoulder ||
    !frontSide ||
    !backSide ||
    !frontArmhole ||
    !backArmhole ||
    !sleeveCapFront ||
    !sleeveCapBack ||
    sleeveSides.length < 2
  ) {
    return [];
  }

  return [
    {
      key: "shoulder",
      name: "Ombros",
      firstPiece: front,
      firstEdge: frontShoulder,
      secondPiece: back,
      secondEdge: backShoulder,
      direction: "same",
      treatment: "standard",
    },
    {
      key: "body-side",
      name: "Laterais do corpo",
      firstPiece: front,
      firstEdge: frontSide,
      secondPiece: back,
      secondEdge: backSide,
      direction: "same",
      treatment: "standard",
    },
    {
      key: "sleeve-underarm",
      name: "Costura inferior das mangas",
      firstPiece: sleeve,
      firstEdge: sleeveSides[0],
      secondPiece: sleeve,
      secondEdge: sleeveSides[1],
      direction: "opposite",
      treatment: "standard",
    },
    {
      key: "front-armhole",
      name: "Cava frontal",
      firstPiece: front,
      firstEdge: frontArmhole,
      secondPiece: sleeve,
      secondEdge: sleeveCapFront,
      direction: "opposite",
      treatment: "ease",
    },
    {
      key: "back-armhole",
      name: "Cava traseira",
      firstPiece: back,
      firstEdge: backArmhole,
      secondPiece: sleeve,
      secondEdge: sleeveCapBack,
      direction: "same",
      treatment: "ease",
    },
  ];
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
  const first = edgeReferenceKey(seam.first.pieceId, seam.first.edgeId);
  const second = edgeReferenceKey(seam.second.pieceId, seam.second.edgeId);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function isGenericSeamName(name: string | undefined): boolean {
  const normalized = (name ?? "").trim().toLocaleLowerCase("pt-BR");
  return normalized === "" || /^costura(?:\s+\d+)?$/.test(normalized);
}
