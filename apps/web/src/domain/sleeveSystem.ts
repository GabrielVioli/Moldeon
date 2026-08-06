import {
  edgeRangeLength,
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type EdgeRange,
  type GarmentDraft,
  type PatternEdge,
  type PatternPiece,
  type PatternPoint,
  type PatternPreviewPlacement,
  type PatternVector,
  type Seam,
  type SegmentRole,
} from "./pattern";

export type SleeveType = "short" | "long";
export type SleeveCompatibilityStatus = "compatible" | "warning" | "error";

export interface SleeveBodyCandidate {
  pieceId: string;
  pieceName: string;
  role: "front" | "back";
  armholeRole: "frontArmhole" | "backArmhole";
  armholeEdgeIds: string[];
  shoulderEdgeId?: string;
  sideEdgeId?: string;
  armholeLengthMm: number;
}

export interface SleeveBodyDetection {
  frontCandidates: SleeveBodyCandidate[];
  backCandidates: SleeveBodyCandidate[];
  selectedFrontId?: string;
  selectedBackId?: string;
  ambiguous: boolean;
  existingSleeveIds: string[];
  diagnostics: SleeveDiagnostic[];
}

export interface SleeveDraftSettings {
  type: SleeveType;
  lengthMm: number;
  bicepCircumferenceMm: number;
  cuffCircumferenceMm: number;
  capHeightMm: number;
  capEaseMm: number;
  rotationDeg: number;
}

export interface SleeveToleranceRules {
  minimumEaseMm: number;
  warningMaximumEaseMm: number;
  errorMaximumEaseMm: number;
  arcSolveToleranceMm: number;
  sideDifferenceWarningMm: number;
}

export interface SleeveLandmarkPair {
  id: string;
  label: string;
  bodyPieceId: string;
  bodyConnectorRole: "frontArmhole" | "backArmhole";
  bodyArcPosition: number;
  sleeveConnectorRole: "sleeveCapFront" | "sleeveCapBack";
  sleeveArcPosition: number;
  kind: "underarm" | "notch" | "shoulder";
}

export interface SleeveCompatibility {
  status: SleeveCompatibilityStatus;
  frontArmholeMm: number;
  backArmholeMm: number;
  totalArmholeMm: number;
  frontCapMm: number;
  backCapMm: number;
  totalCapMm: number;
  frontDifferenceMm: number;
  backDifferenceMm: number;
  totalDifferenceMm: number;
  configuredEaseMm: number;
  easePercent: number;
  tolerances: SleeveToleranceRules;
  landmarkPairs: SleeveLandmarkPair[];
  diagnostics: SleeveDiagnostic[];
}

export type SleeveDiagnosticCode =
  | "missing-front"
  | "missing-back"
  | "ambiguous-front"
  | "ambiguous-back"
  | "same-body-definition"
  | "missing-shoulder"
  | "missing-underarm"
  | "existing-sleeve"
  | "invalid-settings"
  | "cap-chord-exceeds-target"
  | "cap-deficit"
  | "cap-excess-warning"
  | "cap-excess-error"
  | "front-back-imbalance";

export interface SleeveDiagnostic {
  code: SleeveDiagnosticCode;
  severity: "info" | "warning" | "error";
  message: string;
  pieceId?: string;
  connectorRole?: SegmentRole;
}

export interface GuidedSleeveDraft {
  sleevePiece: PatternPiece;
  seams: Seam[];
  frontPieceId: string;
  backPieceId: string;
  compatibility: SleeveCompatibility;
  settings: SleeveDraftSettings;
  sourceSignature: string;
}

interface ResolvedSleeveBody {
  front: PatternPiece;
  back: PatternPiece;
  frontArmholeEdges: PatternEdge[];
  backArmholeEdges: PatternEdge[];
  frontLengthMm: number;
  backLengthMm: number;
  frontNotchPosition: number;
  backNotchPositions: [number, number];
  armholeVerticalSpanMm: number;
}

interface CubicCurve {
  p0: PatternVector;
  c1: PatternVector;
  c2: PatternVector;
  p3: PatternVector;
}

interface GeneratedCap {
  points: PatternPoint[];
  frontLengthMm: number;
  backLengthMm: number;
  frontNotchPosition: number;
  backNotchPositions: [number, number];
  diagnostics: SleeveDiagnostic[];
}

export const SLEEVE_SYSTEM_VERSION = "guided-sleeve@1";

export function detectSleeveBody(
  pieces: readonly PatternPiece[],
): SleeveBodyDetection {
  const frontCandidates = pieces
    .filter((piece) => hasRole(piece, "frontArmhole"))
    .map((piece) => bodyCandidate(piece, "front"));
  const backCandidates = pieces
    .filter((piece) => hasRole(piece, "backArmhole"))
    .map((piece) => bodyCandidate(piece, "back"));
  const existingSleeveIds = pieces
    .filter((piece) => hasRole(piece, "sleeveCapFront") && hasRole(piece, "sleeveCapBack"))
    .map((piece) => piece.id);
  const diagnostics: SleeveDiagnostic[] = [];

  if (frontCandidates.length === 0) {
    diagnostics.push({
      code: "missing-front",
      severity: "error",
      message: "Nenhuma cava frontal semântica foi encontrada.",
      connectorRole: "frontArmhole",
    });
  } else if (frontCandidates.length > 1) {
    diagnostics.push({
      code: "ambiguous-front",
      severity: "warning",
      message: `${frontCandidates.length} frentes possuem cava frontal. Confirme a definição correta.`,
      connectorRole: "frontArmhole",
    });
  }

  if (backCandidates.length === 0) {
    diagnostics.push({
      code: "missing-back",
      severity: "error",
      message: "Nenhuma cava traseira semântica foi encontrada.",
      connectorRole: "backArmhole",
    });
  } else if (backCandidates.length > 1) {
    diagnostics.push({
      code: "ambiguous-back",
      severity: "warning",
      message: `${backCandidates.length} costas possuem cava traseira. Confirme a definição correta.`,
      connectorRole: "backArmhole",
    });
  }

  if (existingSleeveIds.length > 0) {
    diagnostics.push({
      code: "existing-sleeve",
      severity: "info",
      message: `O projeto já possui ${existingSleeveIds.length} definição(ões) de manga. A substituição exige confirmação explícita.`,
    });
  }

  return {
    frontCandidates,
    backCandidates,
    selectedFrontId: frontCandidates.length === 1 ? frontCandidates[0].pieceId : undefined,
    selectedBackId: backCandidates.length === 1 ? backCandidates[0].pieceId : undefined,
    ambiguous: frontCandidates.length !== 1 || backCandidates.length !== 1,
    existingSleeveIds,
    diagnostics,
  };
}

export function canAddGuidedSleeve(pieces: readonly PatternPiece[]): boolean {
  const detection = detectSleeveBody(pieces);
  return detection.frontCandidates.length > 0 && detection.backCandidates.length > 0;
}

export function createDefaultSleeveSettings(
  garment: Pick<GarmentDraft, "pieces" | "measurements" | "ease">,
  frontPieceId: string,
  backPieceId: string,
  type: SleeveType = "short",
): SleeveDraftSettings {
  const body = resolveSleeveBody(garment.pieces, frontPieceId, backPieceId);
  const armLength = finitePositive(garment.measurements.armLengthMm, 590);
  const bodyBicep = finitePositive(garment.measurements.bicepMm, 320);
  const bodyWrist = finitePositive(garment.measurements.wristMm, 170);
  const sleeveEase = finiteNonNegative(garment.ease?.sleeveMm, 55);
  const totalArmhole = body.frontLengthMm + body.backLengthMm;
  const capEaseMm = roundMm(clamp(totalArmhole * 0.025, 6, 16));
  const minimumLength = body.armholeVerticalSpanMm + 75;
  const lengthMm = type === "long"
    ? Math.max(minimumLength, armLength)
    : Math.max(minimumLength, armLength * 0.31);
  const bicepCircumferenceMm = bodyBicep + sleeveEase;
  const cuffCircumferenceMm = type === "long"
    ? bodyWrist + 45
    : Math.max(bodyBicep + sleeveEase * 0.65, bicepCircumferenceMm * 0.82);
  const halfWidth = bicepCircumferenceMm / 2;
  const capHeightLimit = Math.sqrt(Math.max(1, (Math.min(body.frontLengthMm, body.backLengthMm) + capEaseMm * 0.45) ** 2 - (halfWidth * 0.5) ** 2));
  const capHeightMm = clamp(
    body.armholeVerticalSpanMm * 0.72,
    90,
    Math.max(92, capHeightLimit * 0.82),
  );

  return sanitizeSleeveSettings({
    type,
    lengthMm,
    bicepCircumferenceMm,
    cuffCircumferenceMm,
    capHeightMm,
    capEaseMm,
    rotationDeg: 0,
  });
}

export function draftGuidedSleeve(
  garment: Pick<GarmentDraft, "pieces" | "measurements" | "fabrics" | "ease">,
  frontPieceId: string,
  backPieceId: string,
  settingsValue: SleeveDraftSettings,
): GuidedSleeveDraft {
  const body = resolveSleeveBody(garment.pieces, frontPieceId, backPieceId);
  const settings = sanitizeSleeveSettings(settingsValue);
  const sourceSignature = sleeveSourceSignature(body.front, body.back, settings);
  const pieceId = stableSleevePieceId(frontPieceId, backPieceId);
  const cap = generateSleeveCap(body, settings);
  const sleevePiece = createSleevePiece(
    pieceId,
    cap,
    settings,
    garment.fabrics[0]?.id ?? body.front.fabricId ?? body.back.fabricId,
  );
  const compatibility = analyzeGeneratedSleeve(body, sleevePiece, settings, cap.diagnostics);
  const seams = buildGuidedSleeveSeams(body, sleevePiece, compatibility);

  return {
    sleevePiece,
    seams,
    frontPieceId,
    backPieceId,
    compatibility,
    settings,
    sourceSignature,
  };
}

export function analyzeSleeveCompatibility(
  garment: Pick<GarmentDraft, "pieces" | "measurements" | "fabrics" | "ease">,
  frontPieceId: string,
  backPieceId: string,
  settings: SleeveDraftSettings,
): SleeveCompatibility {
  return draftGuidedSleeve(garment, frontPieceId, backPieceId, settings).compatibility;
}

export function stableSleevePieceId(frontPieceId: string, backPieceId: string): string {
  return `guided-sleeve:${stableToken(frontPieceId)}:${stableToken(backPieceId)}`;
}

export function isSleevePiece(piece: PatternPiece): boolean {
  return hasRole(piece, "sleeveCapFront") && hasRole(piece, "sleeveCapBack");
}

function resolveSleeveBody(
  pieces: readonly PatternPiece[],
  frontPieceId: string,
  backPieceId: string,
): ResolvedSleeveBody {
  if (frontPieceId === backPieceId) {
    throw new RangeError("Frente e costas da manga precisam ser definições diferentes.");
  }
  const front = pieces.find((piece) => piece.id === frontPieceId);
  const back = pieces.find((piece) => piece.id === backPieceId);
  if (!front || !hasRole(front, "frontArmhole")) {
    throw new RangeError(`A definição ${frontPieceId} não possui cava frontal válida.`);
  }
  if (!back || !hasRole(back, "backArmhole")) {
    throw new RangeError(`A definição ${backPieceId} não possui cava traseira válida.`);
  }
  const frontArmholeEdges = edgesWithRole(front, "frontArmhole");
  const backArmholeEdges = edgesWithRole(back, "backArmhole");
  if (!firstEdge(front, "shoulder") || !firstEdge(back, "shoulder")) {
    throw new RangeError("O corpo precisa possuir ombros semânticos para orientar a manga.");
  }
  if (!firstEdge(front, "sideSeam") || !firstEdge(back, "sideSeam")) {
    throw new RangeError("O corpo precisa possuir laterais semânticas para localizar as axilas.");
  }
  const frontLengthMm = roleLength(front, "frontArmhole");
  const backLengthMm = roleLength(back, "backArmhole");
  if (frontLengthMm <= 0 || backLengthMm <= 0) {
    throw new RangeError("As cavas precisam possuir comprimento de arco positivo.");
  }
  return {
    front,
    back,
    frontArmholeEdges,
    backArmholeEdges,
    frontLengthMm,
    backLengthMm,
    frontNotchPosition: connectorBoundaryPosition(front, "frontArmhole", 0.58),
    backNotchPositions: backConnectorNotchPositions(back),
    armholeVerticalSpanMm: Math.max(
      roleVerticalSpan(front, "frontArmhole"),
      roleVerticalSpan(back, "backArmhole"),
    ),
  };
}

function bodyCandidate(
  piece: PatternPiece,
  role: "front" | "back",
): SleeveBodyCandidate {
  const armholeRole = role === "front" ? "frontArmhole" : "backArmhole";
  return {
    pieceId: piece.id,
    pieceName: piece.name,
    role,
    armholeRole,
    armholeEdgeIds: edgesWithRole(piece, armholeRole).map((edge) => edge.id),
    shoulderEdgeId: firstEdge(piece, "shoulder")?.id,
    sideEdgeId: firstEdge(piece, "sideSeam")?.id,
    armholeLengthMm: roundMm(roleLength(piece, armholeRole)),
  };
}

function sanitizeSleeveSettings(settings: SleeveDraftSettings): SleeveDraftSettings {
  const type: SleeveType = settings.type === "long" ? "long" : "short";
  const capHeightMm = clamp(finitePositive(settings.capHeightMm, 120), 55, 260);
  return {
    type,
    lengthMm: roundMm(clamp(finitePositive(settings.lengthMm, type === "long" ? 600 : 230), capHeightMm + 55, 950)),
    bicepCircumferenceMm: roundMm(clamp(finitePositive(settings.bicepCircumferenceMm, 370), 220, 900)),
    cuffCircumferenceMm: roundMm(clamp(finitePositive(settings.cuffCircumferenceMm, type === "long" ? 215 : 330), 120, 900)),
    capHeightMm: roundMm(capHeightMm),
    capEaseMm: roundMm(clamp(finiteNumber(settings.capEaseMm, 10), -35, 65)),
    rotationDeg: roundMm(clamp(finiteNumber(settings.rotationDeg, 0), -25, 25)),
  };
}

function generateSleeveCap(
  body: ResolvedSleeveBody,
  settings: SleeveDraftSettings,
): GeneratedCap {
  const diagnostics: SleeveDiagnostic[] = [];
  const halfWidth = settings.bicepCircumferenceMm / 4;
  const apexRatio = clamp(0.5 + settings.rotationDeg * 0.0024, 0.44, 0.56);
  const apex = { xMm: halfWidth * 2 * apexRatio, yMm: 0 };
  const frontUnderarm = { xMm: 0, yMm: settings.capHeightMm };
  const backUnderarm = { xMm: halfWidth * 2, yMm: settings.capHeightMm };
  const frontEaseShare = clamp(0.42 - settings.rotationDeg * 0.002, 0.34, 0.50);
  const frontTarget = body.frontLengthMm + settings.capEaseMm * frontEaseShare;
  const backTarget = body.backLengthMm + settings.capEaseMm * (1 - frontEaseShare);
  const frontCurve = solveCapCubic(frontUnderarm, apex, frontTarget, "front", diagnostics);
  const backCurve = solveCapCubic(apex, backUnderarm, backTarget, "back", diagnostics);
  const frontNotchT = clamp(0.60 + settings.rotationDeg * 0.0015, 0.54, 0.66);
  const backNotch1T = clamp(0.34 + settings.rotationDeg * 0.001, 0.29, 0.39);
  const backNotch2T = clamp(0.67 + settings.rotationDeg * 0.0012, 0.61, 0.73);
  const frontSegments = splitCubicAtMany(frontCurve, [frontNotchT]);
  const backSegments = splitCubicAtMany(backCurve, [backNotch1T, backNotch2T]);
  const capPoints = cubicChainToPatternPoints(
    [
      { id: "underarm-front", curve: frontSegments[0] },
      { id: "front-notch", curve: frontSegments[1] },
      { id: "apex", curve: backSegments[0] },
      { id: "back-notch-1", curve: backSegments[1] },
      { id: "back-notch-2", curve: backSegments[2] },
    ],
    "underarm-back",
  );

  return {
    points: capPoints,
    frontLengthMm: cubicArcLength(frontCurve),
    backLengthMm: cubicArcLength(backCurve),
    frontNotchPosition: frontNotchT,
    backNotchPositions: [backNotch1T, backNotch2T],
    diagnostics,
  };
}

function createSleevePiece(
  id: string,
  cap: GeneratedCap,
  settings: SleeveDraftSettings,
  fabricId: string | undefined,
): PatternPiece {
  const capWidth = settings.bicepCircumferenceMm / 2;
  const cuffWidth = Math.min(capWidth * 1.04, settings.cuffCircumferenceMm / 2);
  const cuffInset = (capWidth - cuffWidth) / 2;
  const cuffY = settings.lengthMm;
  const points = [
    ...cap.points,
    point("cuff-back", capWidth - cuffInset, cuffY),
    point("cuff-front", cuffInset, cuffY),
  ];
  const piece = migrateLegacyPieceToSegments({
    id,
    name: settings.type === "long" ? "Manga longa guiada" : "Manga curta guiada",
    seamAllowanceMm: 10,
    cutQuantity: 2,
    cutOnFold: false,
    ...(fabricId ? { fabricId } : {}),
    previewPlacements: [
      placement(id, "left", false, settings.rotationDeg),
      placement(id, "right", true, -settings.rotationDeg),
    ],
    points: points.map((current) => ({
      ...current,
      id: `${id}:${current.id}`,
    })),
    grainline: {
      start: { xMm: capWidth / 2, yMm: settings.capHeightMm + 22 },
      end: { xMm: capWidth / 2, yMm: cuffY - 24 },
    },
    internalLines: [
      referenceLine(`${id}:bicep-line`, id, "Linha do bíceps", 0, settings.capHeightMm, capWidth, settings.capHeightMm),
      ...(settings.type === "long"
        ? [referenceLine(
            `${id}:elbow-line`,
            id,
            "Linha do cotovelo",
            cuffInset * 0.45,
            settings.capHeightMm + (cuffY - settings.capHeightMm) * 0.56,
            capWidth - cuffInset * 0.45,
            settings.capHeightMm + (cuffY - settings.capHeightMm) * 0.56,
          )]
        : []),
    ],
    annotations: [
      { id: `${id}:front-underarm`, label: "Axila frontal", xMm: 8, yMm: settings.capHeightMm + 16 },
      { id: `${id}:front-notch`, label: "Pique frontal", xMm: cap.points[1].xMm, yMm: cap.points[1].yMm - 12 },
      { id: `${id}:shoulder`, label: "Ápice e marca de ombro", xMm: cap.points[2].xMm + 8, yMm: 14 },
      { id: `${id}:back-notch-1`, label: "Primeiro pique traseiro", xMm: cap.points[3].xMm, yMm: cap.points[3].yMm - 12 },
      { id: `${id}:back-notch-2`, label: "Segundo pique traseiro", xMm: cap.points[4].xMm, yMm: cap.points[4].yMm - 12 },
      { id: `${id}:back-underarm`, label: "Axila traseira", xMm: capWidth - 8, yMm: settings.capHeightMm + 16 },
      { id: `${id}:instances`, label: "Cortar 2x: manga esquerda e direita", xMm: capWidth / 2 + 10, yMm: cuffY - 54 },
    ],
  });
  piece.segments = piece.segments?.map((segment, index) => ({
    ...segment,
    role: ([
      "sleeveCapFront",
      "sleeveCapFront",
      "sleeveCapBack",
      "sleeveCapBack",
      "sleeveCapBack",
      "sideSeam",
      "hem",
      "sideSeam",
    ] as SegmentRole[])[index] ?? "other",
  }));
  return piece;
}

function analyzeGeneratedSleeve(
  body: ResolvedSleeveBody,
  sleeve: PatternPiece,
  settings: SleeveDraftSettings,
  initialDiagnostics: readonly SleeveDiagnostic[],
): SleeveCompatibility {
  const frontCapMm = roleLength(sleeve, "sleeveCapFront");
  const backCapMm = roleLength(sleeve, "sleeveCapBack");
  const totalArmholeMm = body.frontLengthMm + body.backLengthMm;
  const totalCapMm = frontCapMm + backCapMm;
  const totalDifferenceMm = totalCapMm - totalArmholeMm;
  const easePercent = totalDifferenceMm / Math.max(totalArmholeMm, 1) * 100;
  const tolerances = sleeveToleranceRules(totalArmholeMm);
  const diagnostics = [...initialDiagnostics];

  if (totalDifferenceMm < tolerances.minimumEaseMm) {
    diagnostics.push({
      code: "cap-deficit",
      severity: "error",
      message: `A cabeça está ${roundMm(Math.abs(totalDifferenceMm))} mm menor que as cavas. O mínimo permitido é ${roundMm(tolerances.minimumEaseMm)} mm.`,
    });
  } else if (totalDifferenceMm > tolerances.errorMaximumEaseMm) {
    diagnostics.push({
      code: "cap-excess-error",
      severity: "error",
      message: `A cabeça possui ${roundMm(totalDifferenceMm)} mm de excesso. O limite desta base é ${roundMm(tolerances.errorMaximumEaseMm)} mm.`,
    });
  } else if (totalDifferenceMm > tolerances.warningMaximumEaseMm) {
    diagnostics.push({
      code: "cap-excess-warning",
      severity: "warning",
      message: `A folga de cabeça é ${roundMm(totalDifferenceMm)} mm e exige distribuição cuidadosa na região superior.`,
    });
  }

  const sideDifference = Math.abs(
    (frontCapMm - body.frontLengthMm) - (backCapMm - body.backLengthMm),
  );
  if (sideDifference > tolerances.sideDifferenceWarningMm) {
    diagnostics.push({
      code: "front-back-imbalance",
      severity: "warning",
      message: `A distribuição frontal/traseira da folga difere ${roundMm(sideDifference)} mm. Confira a rotação e os piques.`,
    });
  }

  const status: SleeveCompatibilityStatus = diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? "error"
    : diagnostics.some((diagnostic) => diagnostic.severity === "warning")
      ? "warning"
      : "compatible";

  return {
    status,
    frontArmholeMm: roundMm(body.frontLengthMm),
    backArmholeMm: roundMm(body.backLengthMm),
    totalArmholeMm: roundMm(totalArmholeMm),
    frontCapMm: roundMm(frontCapMm),
    backCapMm: roundMm(backCapMm),
    totalCapMm: roundMm(totalCapMm),
    frontDifferenceMm: roundMm(frontCapMm - body.frontLengthMm),
    backDifferenceMm: roundMm(backCapMm - body.backLengthMm),
    totalDifferenceMm: roundMm(totalDifferenceMm),
    configuredEaseMm: settings.capEaseMm,
    easePercent: roundMm(easePercent),
    tolerances,
    landmarkPairs: buildLandmarkPairs(body, sleeve),
    diagnostics,
  };
}

function buildGuidedSleeveSeams(
  body: ResolvedSleeveBody,
  sleeve: PatternPiece,
  compatibility: SleeveCompatibility,
): Seam[] {
  const seams: Seam[] = [];
  appendMappedConnectorSeams(
    seams,
    body.front,
    "frontArmhole",
    [body.frontNotchPosition],
    sleeve,
    "sleeveCapFront",
    [connectorBoundaryPosition(sleeve, "sleeveCapFront", 0.60)],
    "guided-sleeve:front-armhole",
    "Cava frontal",
    "opposite",
    true,
  );
  appendMappedConnectorSeams(
    seams,
    body.back,
    "backArmhole",
    body.backNotchPositions,
    sleeve,
    "sleeveCapBack",
    connectorInternalBoundaryPositions(sleeve, "sleeveCapBack"),
    "guided-sleeve:back-armhole",
    "Cava traseira",
    "same",
    false,
  );

  const sideEdges = edgesWithRole(sleeve, "sideSeam");
  if (sideEdges.length >= 2) {
    seams.push(seam(
      "guided-sleeve:underarm",
      "guided-sleeve:underarm",
      "Costura inferior das mangas",
      fullRange(sleeve.id, sideEdges[0].id),
      fullRange(sleeve.id, sideEdges[1].id),
      "opposite",
      "standard",
    ));
  }

  const frontShoulder = firstEdge(body.front, "shoulder");
  const backShoulder = firstEdge(body.back, "shoulder");
  if (frontShoulder && backShoulder) {
    seams.push(seam(
      "guided-sleeve:body-shoulder",
      "guided-sleeve:body-shoulder",
      "Ombros do corpo",
      fullRange(body.front.id, frontShoulder.id),
      fullRange(body.back.id, backShoulder.id),
      "same",
      "standard",
    ));
  }
  const frontSide = firstEdge(body.front, "sideSeam");
  const backSide = firstEdge(body.back, "sideSeam");
  if (frontSide && backSide) {
    seams.push(seam(
      "guided-sleeve:body-side",
      "guided-sleeve:body-side",
      "Laterais do corpo",
      fullRange(body.front.id, frontSide.id),
      fullRange(body.back.id, backSide.id),
      "same",
      "standard",
    ));
  }

  return seams.map((current) => ({
    ...current,
    easeRatio: current.treatment === "ease"
      ? Math.abs(compatibility.totalDifferenceMm) / Math.max(compatibility.totalArmholeMm, 1)
      : 0,
  }));
}

function appendMappedConnectorSeams(
  target: Seam[],
  firstPiece: PatternPiece,
  firstRole: SegmentRole,
  firstLandmarks: readonly number[],
  secondPiece: PatternPiece,
  secondRole: SegmentRole,
  secondLandmarks: readonly number[],
  groupId: string,
  label: string,
  direction: Seam["direction"],
  reverseSecondIntervals: boolean,
): void {
  const firstBoundaries = connectorLandmarkBoundaries(firstLandmarks);
  const secondBoundaries = connectorLandmarkBoundaries(secondLandmarks);
  const intervalCount = Math.min(firstBoundaries.length, secondBoundaries.length) - 1;
  const firstEdgeBoundaries = connectorEdgeBoundaryPositions(firstPiece, firstRole);
  const secondEdgeBoundaries = connectorEdgeBoundaryPositions(secondPiece, secondRole);
  let sequence = 0;

  for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
    const secondIntervalIndex = reverseSecondIntervals
      ? intervalCount - intervalIndex - 1
      : intervalIndex;
    const firstStart = firstBoundaries[intervalIndex];
    const firstEnd = firstBoundaries[intervalIndex + 1];
    const secondStart = secondBoundaries[secondIntervalIndex];
    const secondEnd = secondBoundaries[secondIntervalIndex + 1];
    const firstSpan = firstEnd - firstStart;
    const secondSpan = secondEnd - secondStart;
    if (firstSpan <= 1e-9 || secondSpan <= 1e-9) continue;

    const localBoundaries = new Set<number>([0, 1]);
    for (const boundary of firstEdgeBoundaries) {
      if (boundary > firstStart + 1e-9 && boundary < firstEnd - 1e-9) {
        localBoundaries.add(roundArcT((boundary - firstStart) / firstSpan));
      }
    }
    for (const boundary of secondEdgeBoundaries) {
      if (boundary > secondStart + 1e-9 && boundary < secondEnd - 1e-9) {
        const local = (boundary - secondStart) / secondSpan;
        localBoundaries.add(roundArcT(direction === "opposite" ? 1 - local : local));
      }
    }

    const ordered = [...localBoundaries].sort((left, right) => left - right);
    for (let localIndex = 0; localIndex < ordered.length - 1; localIndex += 1) {
      const localStart = ordered[localIndex];
      const localEnd = ordered[localIndex + 1];
      if (localEnd - localStart <= 1e-9) continue;
      const firstGlobalStart = firstStart + firstSpan * localStart;
      const firstGlobalEnd = firstStart + firstSpan * localEnd;
      const secondGlobalStart = direction === "opposite"
        ? secondStart + secondSpan * (1 - localEnd)
        : secondStart + secondSpan * localStart;
      const secondGlobalEnd = direction === "opposite"
        ? secondStart + secondSpan * (1 - localStart)
        : secondStart + secondSpan * localEnd;
      const first = connectorRangeAt(
        firstPiece,
        firstRole,
        firstGlobalStart,
        firstGlobalEnd,
      );
      const second = connectorRangeAt(
        secondPiece,
        secondRole,
        secondGlobalStart,
        secondGlobalEnd,
      );
      if (!first || !second) continue;
      sequence += 1;
      target.push(seam(
        `${groupId}:${sequence}`,
        groupId,
        `${label} · trecho ${sequence}`,
        first,
        second,
        direction,
        "ease",
      ));
    }
  }
}

function connectorLandmarkBoundaries(values: readonly number[]): number[] {
  return [...new Set([
    0,
    ...values.map((value) => roundArcT(clamp(value, 0.001, 0.999))),
    1,
  ])].sort((left, right) => left - right);
}

function connectorEdgeBoundaryPositions(
  piece: PatternPiece,
  role: SegmentRole,
): number[] {
  const edges = edgesWithRole(piece, role);
  const lengths = edges.map((edge) => edgeLength(piece, edge));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || edges.length < 2) return [];
  let cursor = 0;
  return lengths.slice(0, -1).map((length) => {
    cursor += length;
    return roundArcT(cursor / total);
  });
}

function connectorRangeAt(
  piece: PatternPiece,
  role: SegmentRole,
  normalizedStart: number,
  normalizedEnd: number,
): EdgeRange | undefined {
  const edges = edgesWithRole(piece, role);
  const lengths = edges.map((edge) => edgeLength(piece, edge));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || edges.length === 0) return undefined;
  const startDistance = clamp(normalizedStart, 0, 1) * total;
  const endDistance = clamp(normalizedEnd, 0, 1) * total;
  const midpoint = (startDistance + endDistance) / 2;
  let cursor = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const length = lengths[index];
    const next = cursor + length;
    if (midpoint <= next + 1e-7 || index === edges.length - 1) {
      const localStart = clamp(startDistance - cursor, 0, length);
      const localEnd = clamp(endDistance - cursor, 0, length);
      const startT = edgeTAtArcDistance(piece, edge, localStart, length);
      const endT = edgeTAtArcDistance(piece, edge, localEnd, length);
      if (endT - startT <= 1e-9) return undefined;
      return {
        pieceId: piece.id,
        edgeId: edge.id,
        startT: roundArcT(startT),
        endT: roundArcT(endT),
      };
    }
    cursor = next;
  }
  return undefined;
}

function edgeTAtArcDistance(
  piece: PatternPiece,
  edge: PatternEdge,
  requestedDistance: number,
  edgeLengthMm: number,
): number {
  if (requestedDistance <= 1e-9) return 0;
  if (requestedDistance >= edgeLengthMm - 1e-9) return 1;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 44; iteration += 1) {
    const middle = (low + high) / 2;
    const length = preciseEdgeArcLength(piece, edge, 0, middle, 128);
    if (length < requestedDistance) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function roundArcT(value: number): number {
  return Math.round(clamp(value, 0, 1) * 1_000_000_000) / 1_000_000_000;
}

function buildLandmarkPairs(
  body: ResolvedSleeveBody,
  sleeve: PatternPiece,
): SleeveLandmarkPair[] {
  const frontSleeveNotch = connectorBoundaryPosition(sleeve, "sleeveCapFront", 0.60);
  const backSleeveNotches = connectorInternalBoundaryPositions(sleeve, "sleeveCapBack");
  return [
    {
      id: "front-underarm",
      label: "Axila frontal",
      bodyPieceId: body.front.id,
      bodyConnectorRole: "frontArmhole",
      bodyArcPosition: 1,
      sleeveConnectorRole: "sleeveCapFront",
      sleeveArcPosition: 0,
      kind: "underarm",
    },
    {
      id: "front-notch",
      label: "Pique frontal",
      bodyPieceId: body.front.id,
      bodyConnectorRole: "frontArmhole",
      bodyArcPosition: roundRatio(body.frontNotchPosition),
      sleeveConnectorRole: "sleeveCapFront",
      sleeveArcPosition: roundRatio(frontSleeveNotch),
      kind: "notch",
    },
    {
      id: "shoulder-front",
      label: "Ombro frontal ↔ ápice",
      bodyPieceId: body.front.id,
      bodyConnectorRole: "frontArmhole",
      bodyArcPosition: 0,
      sleeveConnectorRole: "sleeveCapFront",
      sleeveArcPosition: 1,
      kind: "shoulder",
    },
    {
      id: "shoulder-back",
      label: "Ombro traseiro ↔ ápice",
      bodyPieceId: body.back.id,
      bodyConnectorRole: "backArmhole",
      bodyArcPosition: 0,
      sleeveConnectorRole: "sleeveCapBack",
      sleeveArcPosition: 0,
      kind: "shoulder",
    },
    {
      id: "back-notch-1",
      label: "Primeiro pique traseiro",
      bodyPieceId: body.back.id,
      bodyConnectorRole: "backArmhole",
      bodyArcPosition: roundRatio(body.backNotchPositions[0]),
      sleeveConnectorRole: "sleeveCapBack",
      sleeveArcPosition: roundRatio(backSleeveNotches[0] ?? 0.34),
      kind: "notch",
    },
    {
      id: "back-notch-2",
      label: "Segundo pique traseiro",
      bodyPieceId: body.back.id,
      bodyConnectorRole: "backArmhole",
      bodyArcPosition: roundRatio(body.backNotchPositions[1]),
      sleeveConnectorRole: "sleeveCapBack",
      sleeveArcPosition: roundRatio(backSleeveNotches[1] ?? 0.67),
      kind: "notch",
    },
    {
      id: "back-underarm",
      label: "Axila traseira",
      bodyPieceId: body.back.id,
      bodyConnectorRole: "backArmhole",
      bodyArcPosition: 1,
      sleeveConnectorRole: "sleeveCapBack",
      sleeveArcPosition: 1,
      kind: "underarm",
    },
  ];
}

function sleeveToleranceRules(totalArmholeMm: number): SleeveToleranceRules {
  return {
    minimumEaseMm: -2,
    warningMaximumEaseMm: roundMm(Math.min(18, totalArmholeMm * 0.045)),
    errorMaximumEaseMm: roundMm(Math.min(28, totalArmholeMm * 0.07)),
    arcSolveToleranceMm: 0.35,
    sideDifferenceWarningMm: roundMm(Math.min(10, totalArmholeMm * 0.022)),
  };
}

function solveCapCubic(
  start: PatternVector,
  end: PatternVector,
  requestedLengthMm: number,
  side: "front" | "back",
  diagnostics: SleeveDiagnostic[],
): CubicCurve {
  const chord = distance(start, end);
  const target = Math.max(chord + 0.15, requestedLengthMm);
  if (requestedLengthMm < chord - 0.1) {
    diagnostics.push({
      code: "cap-chord-exceeds-target",
      severity: "error",
      message: `A altura da cabeça faz o arco ${side === "front" ? "frontal" : "traseiro"} exigir ao menos ${roundMm(chord)} mm, acima dos ${roundMm(requestedLengthMm)} mm disponíveis. Reduza a altura ou aumente o bíceps/folga.`,
    });
  }
  let low = 0;
  let high = Math.max(24, chord * 0.45);
  while (cubicArcLength(capCubic(start, end, high, side)) < target && high < chord * 8) {
    high *= 1.7;
  }
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const length = cubicArcLength(capCubic(start, end, middle, side));
    if (length < target) low = middle;
    else high = middle;
  }
  return capCubic(start, end, (low + high) / 2, side);
}

function capCubic(
  start: PatternVector,
  end: PatternVector,
  offset: number,
  side: "front" | "back",
): CubicCurve {
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const chord = Math.max(0.001, Math.hypot(dx, dy));
  const normal = { xMm: dy / chord, yMm: -dx / chord };
  const firstT = side === "front" ? 0.27 : 0.25;
  const secondT = side === "front" ? 0.72 : 0.70;
  const firstWeight = side === "front" ? 0.70 : 1.08;
  const secondWeight = side === "front" ? 1.08 : 0.72;
  return {
    p0: { ...start },
    c1: add(lerp(start, end, firstT), scale(normal, offset * firstWeight)),
    c2: add(lerp(start, end, secondT), scale(normal, offset * secondWeight)),
    p3: { ...end },
  };
}

function splitCubicAtMany(curve: CubicCurve, positions: readonly number[]): CubicCurve[] {
  const sorted = [...positions].map((value) => clamp(value, 0.001, 0.999)).sort((a, b) => a - b);
  const result: CubicCurve[] = [];
  let current = curve;
  let consumed = 0;
  for (const absoluteT of sorted) {
    const localT = (absoluteT - consumed) / Math.max(1e-9, 1 - consumed);
    const [left, right] = splitCubic(current, localT);
    result.push(left);
    current = right;
    consumed = absoluteT;
  }
  result.push(current);
  return result;
}

function splitCubic(curve: CubicCurve, t: number): [CubicCurve, CubicCurve] {
  const p01 = lerp(curve.p0, curve.c1, t);
  const p12 = lerp(curve.c1, curve.c2, t);
  const p23 = lerp(curve.c2, curve.p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p = lerp(p012, p123, t);
  return [
    { p0: curve.p0, c1: p01, c2: p012, p3: p },
    { p0: p, c1: p123, c2: p23, p3: curve.p3 },
  ];
}

function cubicChainToPatternPoints(
  namedSegments: readonly { id: string; curve: CubicCurve }[],
  endId: string,
): PatternPoint[] {
  if (namedSegments.length === 0) return [];
  const points: PatternPoint[] = namedSegments.map((entry, index) => {
    const previous = index > 0 ? namedSegments[index - 1].curve : undefined;
    return {
      id: entry.id,
      xMm: roundMm(entry.curve.p0.xMm),
      yMm: roundMm(entry.curve.p0.yMm),
      ...(previous
        ? { handleIn: relative(entry.curve.p0, previous.c2) }
        : {}),
      handleOut: relative(entry.curve.p0, entry.curve.c1),
    };
  });
  const finalCurve = namedSegments[namedSegments.length - 1].curve;
  points.push({
    id: endId,
    xMm: roundMm(finalCurve.p3.xMm),
    yMm: roundMm(finalCurve.p3.yMm),
    handleIn: relative(finalCurve.p3, finalCurve.c2),
  });
  return points;
}

function cubicArcLength(curve: CubicCurve, samples = 96): number {
  let length = 0;
  let previous = curve.p0;
  for (let index = 1; index <= samples; index += 1) {
    const pointValue = cubicPoint(curve, index / samples);
    length += distance(previous, pointValue);
    previous = pointValue;
  }
  return length;
}

function cubicPoint(curve: CubicCurve, t: number): PatternVector {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    xMm: curve.p0.xMm * a + curve.c1.xMm * b + curve.c2.xMm * c + curve.p3.xMm * d,
    yMm: curve.p0.yMm * a + curve.c1.yMm * b + curve.c2.yMm * c + curve.p3.yMm * d,
  };
}

function connectorBoundaryPosition(
  piece: PatternPiece,
  role: SegmentRole,
  fallback: number,
): number {
  const positions = connectorInternalBoundaryPositions(piece, role);
  if (positions.length === 0) return fallback;
  return positions[Math.floor((positions.length - 1) / 2)];
}

function connectorInternalBoundaryPositions(
  piece: PatternPiece,
  role: SegmentRole,
): number[] {
  const edges = edgesWithRole(piece, role);
  const lengths = edges.map((edge) => edgeLength(piece, edge));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || edges.length < 2) return [];
  let cursor = 0;
  return lengths.slice(0, -1).map((length) => {
    cursor += length;
    return cursor / total;
  });
}

function backConnectorNotchPositions(piece: PatternPiece): [number, number] {
  const edges = edgesWithRole(piece, "backArmhole");
  const lengths = edges.map((edge) => edgeLength(piece, edge));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0.38, 0.66];
  if (edges.length === 1) return [0.42, 0.68];
  const firstEnd = lengths[0] / total;
  const first = firstEnd * 0.74;
  const second = firstEnd + (1 - firstEnd) * 0.28;
  return [clamp(first, 0.18, 0.60), clamp(second, 0.42, 0.86)];
}

function roleLength(piece: PatternPiece, role: SegmentRole): number {
  return edgesWithRole(piece, role).reduce((sum, edge) => sum + edgeLength(piece, edge), 0);
}

function edgeLength(piece: PatternPiece, edge: PatternEdge): number {
  return preciseEdgeArcLength(piece, edge, 0, 1, 192);
}

function preciseEdgeArcLength(
  piece: PatternPiece,
  edge: PatternEdge,
  startT: number,
  endT: number,
  samples: number,
): number {
  const start = clamp(startT, 0, 1);
  const end = clamp(endT, 0, 1);
  if (end <= start) return 0;
  let previous = preciseEdgePointAt(piece, edge, start);
  let length = 0;
  for (let index = 1; index <= samples; index += 1) {
    const t = start + (end - start) * (index / samples);
    const current = preciseEdgePointAt(piece, edge, t);
    length += distance(previous, current);
    previous = current;
  }
  return length;
}

function preciseEdgePointAt(
  piece: PatternPiece,
  edge: PatternEdge,
  t: number,
): PatternVector {
  const start = piece.points.find((pointValue) => pointValue.id === edge.startPointId);
  const end = piece.points.find((pointValue) => pointValue.id === edge.endPointId);
  if (!start || !end) {
    throw new RangeError(`A borda ${edge.id} referencia pontos ausentes.`);
  }
  const segment = piece.segments?.find((candidate) => candidate.id === edge.id);
  const cubic = segment?.kind === "cubic" || Boolean(start.handleOut || end.handleIn);
  if (!cubic) return lerp(start, end, t);
  const control1 = segment?.kind === "cubic" && segment.control1
    ? segment.control1
    : {
        xMm: start.xMm + (start.handleOut?.xMm ?? 0),
        yMm: start.yMm + (start.handleOut?.yMm ?? 0),
      };
  const control2 = segment?.kind === "cubic" && segment.control2
    ? segment.control2
    : {
        xMm: end.xMm + (end.handleIn?.xMm ?? 0),
        yMm: end.yMm + (end.handleIn?.yMm ?? 0),
      };
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    xMm: start.xMm * a + control1.xMm * b + control2.xMm * c + end.xMm * d,
    yMm: start.yMm * a + control1.yMm * b + control2.yMm * c + end.yMm * d,
  };
}

function roleVerticalSpan(piece: PatternPiece, role: SegmentRole): number {
  const pointIds = new Set(edgesWithRole(piece, role).flatMap((edge) => [edge.startPointId, edge.endPointId]));
  const ys = piece.points.filter((pointValue) => pointIds.has(pointValue.id)).map((pointValue) => pointValue.yMm);
  return ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0;
}

function edgesWithRole(piece: PatternPiece, role: SegmentRole): PatternEdge[] {
  return getPatternEdges(piece).filter((edge) => edge.role === role);
}

function firstEdge(piece: PatternPiece, role: SegmentRole): PatternEdge | undefined {
  return edgesWithRole(piece, role)[0];
}

function hasRole(piece: PatternPiece, role: SegmentRole): boolean {
  return firstEdge(piece, role) !== undefined;
}

function fullRange(pieceId: string, edgeId: string): EdgeRange {
  return { pieceId, edgeId, startT: 0, endT: 1 };
}

function seam(
  id: string,
  groupId: string,
  name: string,
  first: EdgeRange,
  second: EdgeRange,
  direction: Seam["direction"],
  treatment: NonNullable<Seam["treatment"]>,
): Seam {
  return {
    id,
    groupId,
    name,
    first,
    second,
    direction,
    treatment,
    type: treatment,
    easeRatio: 0,
    active: true,
  };
}

function sleeveSourceSignature(
  front: PatternPiece,
  back: PatternPiece,
  settings: SleeveDraftSettings,
): string {
  return JSON.stringify({
    version: SLEEVE_SYSTEM_VERSION,
    front: geometrySignature(front, "frontArmhole"),
    back: geometrySignature(back, "backArmhole"),
    settings,
  });
}

function geometrySignature(piece: PatternPiece, role: SegmentRole): string {
  const relevantEdges = edgesWithRole(piece, role);
  const pointIds = new Set(relevantEdges.flatMap((edge) => [edge.startPointId, edge.endPointId]));
  return [
    piece.id,
    relevantEdges.map((edge) => `${edge.id}:${edge.role}`).join("|"),
    piece.points
      .filter((pointValue) => pointIds.has(pointValue.id))
      .map((pointValue) => `${pointValue.id}:${roundMm(pointValue.xMm)}:${roundMm(pointValue.yMm)}:${vectorSignature(pointValue.handleIn)}:${vectorSignature(pointValue.handleOut)}`)
      .join("|"),
  ].join("#");
}

function vectorSignature(vector: PatternVector | undefined): string {
  return vector ? `${roundMm(vector.xMm)},${roundMm(vector.yMm)}` : "-";
}

function stableToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || "pattern";
}

function placement(
  pieceId: string,
  bodySide: "left" | "right",
  mirrorX: boolean,
  rotationDeg: number,
): PatternPreviewPlacement {
  return {
    id: `${pieceId}:placement:${bodySide}`,
    pieceId,
    region: "arm",
    surface: "front",
    bodySide,
    rotationDeg,
    offsetXMm: 0,
    offsetYMm: 0,
    offsetZMm: 0,
    scale: 1,
    mirrorX,
  };
}

function referenceLine(
  id: string,
  pieceId: string,
  name: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): NonNullable<PatternPiece["internalLines"]>[number] {
  return {
    id,
    pieceId,
    name,
    nodes: [point("start", x1, y1), point("end", x2, y2)],
    segments: [{ id: `${id}:segment`, startNodeId: "start", endNodeId: "end", kind: "line" }],
    purpose: "reference",
    visible: true,
    locked: true,
    metadata: { source: SLEEVE_SYSTEM_VERSION, label: name, version: 1 },
  };
}

function point(id: string, xMm: number, yMm: number): PatternPoint {
  return { id, xMm: roundMm(xMm), yMm: roundMm(yMm) };
}

function relative(origin: PatternVector, control: PatternVector): PatternVector {
  return { xMm: roundMm(control.xMm - origin.xMm), yMm: roundMm(control.yMm - origin.yMm) };
}

function lerp(first: PatternVector, second: PatternVector, t: number): PatternVector {
  return {
    xMm: first.xMm + (second.xMm - first.xMm) * t,
    yMm: first.yMm + (second.yMm - first.yMm) * t,
  };
}

function add(first: PatternVector, second: PatternVector): PatternVector {
  return { xMm: first.xMm + second.xMm, yMm: first.yMm + second.yMm };
}

function scale(vector: PatternVector, factor: number): PatternVector {
  return { xMm: vector.xMm * factor, yMm: vector.yMm * factor };
}

function distance(first: PatternVector, second: PatternVector): number {
  return Math.hypot(second.xMm - first.xMm, second.yMm - first.yMm);
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundRatio(value: number): number {
  return Math.round(clamp(value, 0, 1) * 1_000_000) / 1_000_000;
}
