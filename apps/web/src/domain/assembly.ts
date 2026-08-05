import {
  edgeRangeLength,
  getPatternEdges,
  validateSeam,
  type AssemblyPlacement,
  type EdgeRange,
  type GarmentDraft,
  type PatternPiece,
  type Seam,
  type SeamDirection,
  type SeamTreatment,
} from "./pattern";
import {
  classifyPatternEdge,
  type ClassifiedPatternEdge,
} from "./edgeClassification";
import {
  samplePatternContour,
  triangulatePatternContour,
} from "./polygonGeometry";

export interface SeamCompatibility {
  compatible: boolean;
  firstLengthMm: number;
  secondLengthMm: number;
  differenceMm: number;
  differencePercent: number;
  recommendedTreatment: SeamTreatment;
  recommendedDirection: SeamDirection;
  message: string;
}

export interface AssemblyGraph {
  connectedComponents: string[][];

  /** Bordas ainda sem costura que, pela função, deveriam ser conectadas. */
  openEdges: Array<{ pieceId: string; edgeId: string }>;

  /** Decotes, barras, cinturas, acabamentos e dobras. */
  intentionalOpenEdges: ClassifiedPatternEdge[];

  /** Bordas sem função suficiente para decidir automaticamente. */
  undefinedEdges: ClassifiedPatternEdge[];

  issues: string[];
  warnings: string[];
  validSeamIds: string[];
}

export interface Garment3DEligibility {
  canPreviewGarment: boolean;
  canDressBody: boolean;
  issues: string[];
  warnings: string[];
  connectedPieceIds: string[];
}

export type WorkspaceMode = "modeling" | "assembly" | "fitting";

export function validateSeamForAssembly(
  seam: Seam,
  garment: Pick<GarmentDraft, "pieces" | "seams">,
) {
  return validateSeam(seam, garment).filter(
    (issue) =>
      issue.code !== "length-mismatch" ||
      (seam.treatment ?? "standard") === "standard",
  );
}

export function analyzeSeamCompatibility(
  garment: Pick<GarmentDraft, "pieces">,
  first: EdgeRange,
  second: EdgeRange,
): SeamCompatibility {
  const firstPiece = garment.pieces.find(
    (piece) => piece.id === first.pieceId,
  );
  const secondPiece = garment.pieces.find(
    (piece) => piece.id === second.pieceId,
  );
  const firstLengthMm = firstPiece
    ? edgeRangeLength(firstPiece, first)
    : 0;
  const secondLengthMm = secondPiece
    ? edgeRangeLength(secondPiece, second)
    : 0;
  const differenceMm = Math.abs(firstLengthMm - secondLengthMm);
  const referenceLength = Math.max(firstLengthMm, secondLengthMm, 1);
  const differencePercent = (differenceMm / referenceLength) * 100;
  const identicalRange = rangesAreIdentical(first, second);

  let recommendedTreatment: SeamTreatment = "standard";
  if (differenceMm > 5 && differencePercent > 2) {
    if (differencePercent <= 8) {
      recommendedTreatment = "ease";
    } else if (differencePercent <= 20) {
      recommendedTreatment =
        firstLengthMm > secondLengthMm ? "gather" : "stretch";
    } else {
      recommendedTreatment = "intentional-mismatch";
    }
  }

  const compatible =
    firstLengthMm > 0 &&
    secondLengthMm > 0 &&
    !identicalRange;

  const treatmentLabel: Record<SeamTreatment, string> = {
    standard: "costura padrão",
    ease: "distribuição de folga",
    gather: "franzido",
    stretch: "acomodação por elasticidade",
    "intentional-mismatch": "diferença intencional",
  };

  return {
    compatible,
    firstLengthMm,
    secondLengthMm,
    differenceMm,
    differencePercent,
    recommendedTreatment,
    recommendedDirection: "opposite",
    message: compatible
      ? `Diferença de ${differenceMm.toFixed(1)} mm (${differencePercent.toFixed(1)}%): ${treatmentLabel[recommendedTreatment]}.`
      : identicalRange
        ? "Escolha duas faixas diferentes para criar a costura."
        : "Escolha duas bordas válidas.",
  };
}

export function buildAssemblyGraph(
  garment: Pick<GarmentDraft, "pieces" | "seams">,
): AssemblyGraph {
  const pieceIds = new Set(garment.pieces.map((piece) => piece.id));
  const adjacency = new Map<string, Set<string>>(
    garment.pieces.map((piece) => [piece.id, new Set()]),
  );
  const usedEdges = new Set<string>();
  const issues: string[] = [];
  const warnings: string[] = [];
  const validSeamIds: string[] = [];

  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    if (rangesAreIdentical(seam.first, seam.second)) {
      issues.push(
        `${seam.name ?? seam.id}: a mesma faixa não pode ser costurada sobre ela mesma.`,
      );
      continue;
    }

    const seamIssues = validateSeamForAssembly(seam, garment).filter(
      (issue) => issue.code !== "invalid-self-seam",
    );

    if (seamIssues.length > 0) {
      issues.push(
        ...seamIssues.map(
          (issue) => `${seam.name ?? seam.id}: ${issue.message}`,
        ),
      );
      continue;
    }

    if (
      !pieceIds.has(seam.first.pieceId) ||
      !pieceIds.has(seam.second.pieceId)
    ) {
      continue;
    }

    if (seam.first.pieceId !== seam.second.pieceId) {
      adjacency.get(seam.first.pieceId)?.add(seam.second.pieceId);
      adjacency.get(seam.second.pieceId)?.add(seam.first.pieceId);
    }

    if (seam.first.startT === 0 && seam.first.endT === 1) {
      usedEdges.add(`${seam.first.pieceId}/${seam.first.edgeId}`);
    }
    if (seam.second.startT === 0 && seam.second.endT === 1) {
      usedEdges.add(`${seam.second.pieceId}/${seam.second.edgeId}`);
    }

    validSeamIds.push(seam.id);

    if ((seam.treatment ?? "standard") === "intentional-mismatch") {
      warnings.push(
        `${seam.name ?? seam.id}: diferença de comprimento marcada como intencional.`,
      );
    }
  }

  const connectedComponents: string[][] = [];
  const visited = new Set<string>();

  for (const piece of garment.pieces) {
    if (visited.has(piece.id)) continue;

    const component: string[] = [];
    const queue = [piece.id];
    visited.add(piece.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    connectedComponents.push(component);
  }

  connectedComponents.sort((left, right) => right.length - left.length);

  const unusedClassifiedEdges = garment.pieces.flatMap((piece) =>
    getPatternEdges(piece)
      .filter((edge) => !usedEdges.has(`${piece.id}/${edge.id}`))
      .map((edge) => classifyPatternEdge(piece, edge)),
  );

  const requiredOpenEdges = unusedClassifiedEdges.filter(
    (edge) => edge.classification === "must-sew",
  );
  const intentionalOpenEdges = unusedClassifiedEdges.filter(
    (edge) =>
      edge.classification === "intentional-open" ||
      edge.classification === "finished-open" ||
      edge.classification === "fold",
  );
  const undefinedEdges = unusedClassifiedEdges.filter(
    (edge) => edge.classification === "undefined",
  );

  const openEdges = requiredOpenEdges.map(({ pieceId, edgeId }) => ({
    pieceId,
    edgeId,
  }));

  if (openEdges.length > 0) {
    warnings.push(
      `${openEdges.length} borda(s) que deveriam ser costuradas ainda estão abertas.`,
    );
  }

  return {
    connectedComponents,
    openEdges,
    intentionalOpenEdges,
    undefinedEdges,
    issues,
    warnings,
    validSeamIds,
  };
}

export function evaluateGarment3DEligibility(
  garment: GarmentDraft,
): Garment3DEligibility {
  const issues: string[] = [];
  const warnings: string[] = [];
  const triangulatable = new Set<string>();

  for (const piece of garment.pieces) {
    const result = triangulatePatternContour(
      samplePatternContour(piece.points),
    );

    if (result.ok) {
      triangulatable.add(piece.id);
    } else {
      issues.push(`${piece.name}: contorno não triangulável.`);
    }
  }

  const graph = buildAssemblyGraph(garment);
  issues.push(...graph.issues);
  warnings.push(...graph.warnings);

  /*
   * Toda peça válida participa do preview, mesmo que ainda esteja em um
   * componente desconectado. O nome do campo é mantido por compatibilidade.
   */
  const connectedPieceIds = garment.pieces
    .filter((piece) => triangulatable.has(piece.id))
    .map((piece) => piece.id);

  const canPreviewGarment = connectedPieceIds.length > 0;

  if (!canPreviewGarment) {
    issues.push("Crie pelo menos uma peça válida e triangulável.");
  }

  if (graph.validSeamIds.length === 0 && canPreviewGarment) {
    warnings.push(
      "Nenhuma costura válida foi criada. As peças serão mostradas separadamente.",
    );
  }

  const placementIds = new Set(
    (garment.assemblyPlacements ?? []).map(
      (placement) => placement.pieceId,
    ),
  );
  const missingPlacements = connectedPieceIds.filter(
    (pieceId) => !placementIds.has(pieceId),
  );

  if (canPreviewGarment && missingPlacements.length > 0) {
    warnings.push(
      `Defina a posição de montagem de ${missingPlacements.length} peça(s) antes da Prova.`,
    );
  }

  return {
    canPreviewGarment,
    canDressBody:
      canPreviewGarment &&
      graph.validSeamIds.length > 0 &&
      missingPlacements.length === 0,
    issues: unique(issues),
    warnings: unique(warnings),
    connectedPieceIds,
  };
}

export function shouldLoadThreeViewport(
  eligibility: Garment3DEligibility,
  requested: boolean,
  mode: WorkspaceMode,
): boolean {
  if (!requested || !eligibility.canPreviewGarment) return false;
  return mode !== "fitting" || eligibility.canDressBody;
}

export function inferAssemblyPlacement(
  piece: PatternPiece,
  index = 0,
): AssemblyPlacement {
  const normalized = piece.name.toLocaleLowerCase("pt-BR");
  const roles = new Set(piece.segments?.map((segment) => segment.role) ?? []);
  const role =
    normalized.includes("costas") || roles.has("backArmhole")
      ? "back"
      : normalized.includes("manga") ||
          roles.has("sleeveCapFront") ||
          roles.has("sleeveCapBack")
        ? "sleeve"
        : normalized.includes("perna") ||
            normalized.includes("calça") ||
            roles.has("inseam") ||
            roles.has("outseam")
          ? "leg"
          : normalized.includes("saia") ||
              normalized.includes("cintura")
            ? "waist"
            : normalized.includes("gola")
              ? "collar"
              : normalized.includes("frente")
                ? "front"
                : "custom";
  const outwardSide = role === "back" ? "back" : "front";

  return {
    pieceId: piece.id,
    role,
    outwardSide,
    positionMm: [
      (index % 3 - 1) * 180,
      role === "leg" || role === "waist" ? -260 : 120,
      outwardSide === "back" ? -90 : 90,
    ],
    rotationDeg: [0, outwardSide === "back" ? 180 : 0, 0],
    flipped: false,
    source: "inferred",
  };
}

function rangesAreIdentical(first: EdgeRange, second: EdgeRange): boolean {
  return (
    first.pieceId === second.pieceId &&
    first.edgeId === second.edgeId &&
    Math.abs(first.startT - second.startT) <= 1e-7 &&
    Math.abs(first.endT - second.endT) <= 1e-7
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
