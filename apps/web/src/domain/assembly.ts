import {
  edgeRangeLength,
  getPatternEdges,
  validateSeam,
  type AssemblyPlacement,
  type BodyAnchorId,
  type BodyPlacementRegion,
  type BodyPlacementRole,
  type BodyPlacementSide,
  type BodyPlacementSurface,
  type EdgeRange,
  type GarmentDraft,
  type GarmentDressingRegion,
  type PatternPiece,
  type Seam,
  type SeamDirection,
  type SeamTreatment,
} from "./pattern";
import type { PanelInstanceV3, PatternDocumentV3 } from "./patternDocumentV3.types";
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
  canOpenViewport: boolean;
  canPreviewGarment: boolean;
  canDressBody: boolean;
  issues: string[];
  warnings: string[];
  connectedPieceIds: string[];
  includedPieceIds: string[];
  missingClassificationPieceIds: string[];
}

export interface DressingPreflight {
  canDress: boolean;
  requiresRegion: boolean;
  requiresFrontReference: boolean;
  issues: string[];
  warnings: string[];
  includedPieceIds: string[];
  frontCandidatePieceIds: string[];
  resolvedFrontReferencePieceId?: string;
}

export interface BodyPlacementSuggestion {
  role: BodyPlacementRole;
  region: BodyPlacementRegion;
  surface: BodyPlacementSurface;
  bodySide: BodyPlacementSide;
  anchorId: BodyAnchorId;
  reason: string;
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

export function evaluateDressingPreflight(garment: GarmentDraft): DressingPreflight {
  const includedPieces = visibleIncludedPieces(garment);
  const includedIds = new Set(includedPieces.map((piece) => piece.id));
  const issues: string[] = [];
  const warnings: string[] = [];

  if (includedPieces.length === 0) {
    issues.push("Desenhe pelo menos uma peça antes de provar.");
  }

  for (const piece of includedPieces) {
    if (!triangulatePatternContour(samplePatternContour(piece.points)).ok) {
      issues.push(`${piece.name}: o contorno precisa ser corrigido antes de provar.`);
    }
  }

  const includedSeams = (garment.seams ?? []).filter(
    (seam) => seam.active !== false
      && includedIds.has(seam.first.pieceId)
      && includedIds.has(seam.second.pieceId),
  );
  const graph = buildAssemblyGraph({ pieces: includedPieces, seams: includedSeams });
  issues.push(...graph.issues);

  if (includedPieces.length > 0 && graph.validSeamIds.length === 0) {
    issues.push("Costure as bordas que formam a roupa antes de provar.");
  }
  if (graph.validSeamIds.length > 0 && graph.connectedComponents.length > 1) {
    issues.push("Há peças sem conexão com o conjunto principal. Costure-as ou oculte-as antes de provar.");
  }
  warnings.push(...graph.warnings);

  const requiresRegion = includedPieces.length > 0 && garment.dressing?.region === undefined;
  const inferredFront = inferFrontReference(includedPieces);
  const configuredFront = garment.dressing?.frontReferencePieceId;
  const resolvedFrontReferencePieceId = configuredFront && includedIds.has(configuredFront)
    ? configuredFront
    : inferredFront;
  const requiresFrontReference = includedPieces.length > 1
    && graph.connectedComponents.length === 1
    && resolvedFrontReferencePieceId === undefined;

  return {
    canDress: issues.length === 0 && !requiresRegion && !requiresFrontReference,
    requiresRegion,
    requiresFrontReference,
    issues: unique(issues),
    warnings: unique(warnings),
    includedPieceIds: includedPieces.map((piece) => piece.id),
    frontCandidatePieceIds: graph.connectedComponents[0] ?? includedPieces.map((piece) => piece.id),
    ...(resolvedFrontReferencePieceId === undefined ? {} : { resolvedFrontReferencePieceId }),
  };
}

/**
 * Converte somente o conjunto de prova em placements derivados. A geometria e
 * as decisões avançadas por painel continuam no documento V3 autoritativo.
 */
export function deriveDressingPanelInstances(
  document: PatternDocumentV3,
  garment: GarmentDraft,
): PanelInstanceV3[] {
  const preflight = evaluateDressingPreflight(garment);
  const region = garment.dressing?.region;
  const frontReference = preflight.resolvedFrontReferencePieceId;
  if (!preflight.canDress || !region || !frontReference) return document.panelInstances;

  const includedIds = new Set(preflight.includedPieceIds);
  const orderedPieceIds = orderConnectedPieces(garment, frontReference, includedIds);
  const surfaceByPieceId = new Map<string, "front" | "back">();
  if (orderedPieceIds.length === 2) {
    surfaceByPieceId.set(orderedPieceIds[0], "front");
    surfaceByPieceId.set(orderedPieceIds[1], "back");
  } else {
    orderedPieceIds.forEach((pieceId, index) => {
      surfaceByPieceId.set(pieceId, index === 0 || index < orderedPieceIds.length / 2 ? "front" : "back");
    });
  }

  const placementRegion = previewRegionFor(region);
  return document.panelInstances.map((instance) => {
    if (!includedIds.has(instance.sourcePatternId)) return instance;
    const definition = document.patternDefinitions.find((candidate) => candidate.id === instance.sourcePatternId);
    if (!definition || definition.bodyPlacement.includeIn3D === false) return instance;
    const surface = surfaceByPieceId.get(instance.sourcePatternId) ?? "front";
    const bodySide = placementRegion === "arm"
      ? instance.copyIndex % 2 === 0 ? "left" : "right"
      : "center";
    const bodyAnchorId = anchorFor(placementRegion, surface, bodySide);
    return {
      ...instance,
      placementStatus: "confirmed",
      bodySide,
      surface,
      includedIn3D: true,
      arrangementAnchor: {
        id: `${instance.id}:dressing`,
        bodyAnchorId,
        region: placementRegion,
        surface,
        bodySide,
        rotationDeg: 0,
        offsetXMm: 0,
        offsetYMm: 0,
        offsetZMm: 25,
        scale: 1,
        source: "inferred",
      },
    };
  });
}

export function evaluateGarment3DEligibility(
  garment: GarmentDraft,
): Garment3DEligibility {
  const preflight = evaluateDressingPreflight(garment);
  const issues: string[] = [];
  const warnings: string[] = [];
  const triangulatable = new Set<string>();

  const visibleIds = new Set((garment.workspaceStates ?? [])
    .filter((entry) => entry.visible)
    .map((entry) => entry.pieceId));
  const includedPieces = garment.pieces.filter((piece) =>
    (garment.workspaceStates === undefined || visibleIds.has(piece.id))
    && piece.bodyPlacement?.includeIn3D !== false,
  );

  for (const piece of includedPieces) {
    const result = triangulatePatternContour(
      samplePatternContour(piece.points),
    );

    if (result.ok) {
      triangulatable.add(piece.id);
    } else {
      issues.push(`${piece.name}: contorno não triangulável.`);
    }
  }

  const includedIds = new Set(includedPieces.map((piece) => piece.id));
  const graph = buildAssemblyGraph({
    pieces: includedPieces,
    seams: (garment.seams ?? []).filter((seam) => includedIds.has(seam.first.pieceId) && includedIds.has(seam.second.pieceId)),
  });
  issues.push(...graph.issues);
  issues.push(...preflight.issues);
  warnings.push(...graph.warnings);

  /*
   * Toda peça válida participa do preview, mesmo que ainda esteja em um
   * componente desconectado. O nome do campo é mantido por compatibilidade.
   */
  const connectedPieceIds = includedPieces
    .filter((piece) => triangulatable.has(piece.id))
    .map((piece) => piece.id);

  const canPreviewGarment = connectedPieceIds.length > 0;

  if (!canPreviewGarment) {
    issues.push("Crie pelo menos uma peça válida e triangulável.");
  }

  if (graph.validSeamIds.length === 0 && canPreviewGarment) {
    warnings.push(
      "Nenhuma costura válida foi criada. O manequim exibirá somente instâncias com anchors válidos e informará componentes desconectados.",
    );
  }

  warnings.push(...preflight.warnings);
  if (preflight.requiresRegion) warnings.push("Escolha onde esta roupa será vestida.");
  if (preflight.requiresFrontReference) warnings.push("Selecione qual peça inicia na frente do corpo.");

  return {
    canOpenViewport: true,
    canPreviewGarment,
    canDressBody: canPreviewGarment && preflight.canDress && issues.length === 0,
    issues: unique(issues),
    warnings: unique(warnings),
    connectedPieceIds,
    includedPieceIds: includedPieces.map((piece) => piece.id),
    missingClassificationPieceIds: [],
  };
}

export function shouldLoadThreeViewport(
  eligibility: Garment3DEligibility,
  requested: boolean,
  mode: WorkspaceMode,
): boolean {
  void mode;
  return requested && eligibility.canOpenViewport;
}

/**
 * Sugestão efêmera baseada somente em semântica explícita de segmentos.
 * O retorno nunca é gravado no documento por esta função.
 */
export function suggestBodyPlacement(piece: PatternPiece): BodyPlacementSuggestion | null {
  const roles = new Set(piece.segments?.map((segment) => segment.role) ?? []);
  if (roles.has("sleeveCapFront") || roles.has("sleeveCapBack")) {
    return { role: "sleeve", region: "arm", surface: "side", bodySide: "left", anchorId: "arm-left", reason: "A peça possui conectores explícitos de cabeça de manga." };
  }
  if (roles.has("inseam") || roles.has("outseam")) {
    const back = roles.has("backCrotch");
    return { role: back ? "leg-back" : "leg-front", region: "leg", surface: back ? "back" : "front", bodySide: "left", anchorId: "leg-left", reason: "A peça possui conectores explícitos de perna." };
  }
  if (roles.has("backArmhole")) {
    return { role: "back", region: "torso", surface: "back", bodySide: "center", anchorId: "torso-back", reason: "A peça possui conector explícito de cava traseira." };
  }
  if (roles.has("frontArmhole")) {
    return { role: "front", region: "torso", surface: "front", bodySide: "center", anchorId: "torso-front", reason: "A peça possui conector explícito de cava frontal." };
  }
  return null;
}

export function inferAssemblyPlacement(
  piece: PatternPiece,
  index = 0,
): AssemblyPlacement {
  const roles = new Set(piece.segments?.map((segment) => segment.role) ?? []);
  const role = roles.has("backArmhole")
    ? "back"
    : roles.has("sleeveCapFront") || roles.has("sleeveCapBack")
      ? "sleeve"
      : roles.has("inseam") || roles.has("outseam")
        ? "leg"
        : roles.has("waist") && roles.has("hem") && !roles.has("frontArmhole")
          ? "waist"
          : roles.has("frontArmhole")
            ? "front"
            : "custom";
  const outwardSide = role === "back" ? "back" : "front";
  return {
    pieceId: piece.id,
    role,
    outwardSide,
    positionMm: [0, 0, 0],
    rotationDeg: [0, 0, 0],
    flipped: false,
    source: role === "custom" ? "manual" : "inferred",
  };
}

function visibleIncludedPieces(garment: GarmentDraft): PatternPiece[] {
  const workspaceByPieceId = new Map((garment.workspaceStates ?? []).map((entry) => [entry.pieceId, entry]));
  return garment.pieces.filter((piece) => {
    const workspace = workspaceByPieceId.get(piece.id);
    return (workspace?.visible ?? true) && piece.bodyPlacement?.includeIn3D !== false;
  });
}

function inferFrontReference(pieces: readonly PatternPiece[]): string | undefined {
  if (pieces.length === 1) return pieces[0]?.id;
  const candidates = pieces.filter((piece) => {
    const roles = new Set(piece.segments?.map((segment) => segment.role) ?? []);
    return roles.has("frontArmhole") && !roles.has("backArmhole");
  });
  return candidates.length === 1 ? candidates[0].id : undefined;
}

function orderConnectedPieces(
  garment: GarmentDraft,
  firstPieceId: string,
  includedIds: ReadonlySet<string>,
): string[] {
  const adjacency = new Map<string, Set<string>>([...includedIds].map((pieceId) => [pieceId, new Set()]));
  for (const seam of garment.seams ?? []) {
    if (seam.active === false || !includedIds.has(seam.first.pieceId) || !includedIds.has(seam.second.pieceId)) continue;
    adjacency.get(seam.first.pieceId)?.add(seam.second.pieceId);
    adjacency.get(seam.second.pieceId)?.add(seam.first.pieceId);
  }
  const result: string[] = [];
  const visited = new Set<string>([firstPieceId]);
  const queue = [firstPieceId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  for (const pieceId of includedIds) if (!visited.has(pieceId)) result.push(pieceId);
  return result;
}

function previewRegionFor(region: GarmentDressingRegion): "torso" | "hip" | "arm" | "neck" | "custom" {
  if (region === "lower") return "hip";
  if (region === "arm") return "arm";
  if (region === "neck") return "neck";
  if (region === "custom") return "custom";
  return "torso";
}

function anchorFor(
  region: "torso" | "hip" | "arm" | "neck" | "custom",
  surface: "front" | "back",
  bodySide: "center" | "left" | "right",
): BodyAnchorId {
  if (region === "arm") return bodySide === "right" ? "arm-right" : "arm-left";
  if (region === "neck") return "neck";
  if (region === "hip") return surface === "back" ? "hip-back" : "hip-front";
  return surface === "back" ? "torso-back" : "torso-front";
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
