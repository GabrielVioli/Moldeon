import {
  createDefaultFabricSource,
  parseFabricSources,
  type FabricSource,
} from "./fabric";

export interface PatternPoint {
  id: string;
  xMm: number;
  yMm: number;
  handleIn?: PatternVector;
  handleOut?: PatternVector;
}

export interface PatternVector {
  xMm: number;
  yMm: number;
}

export interface BodyMeasurements {
  heightMm: number;
  bustMm: number;
  waistMm: number;
  hipMm: number;
  shoulderWidthMm: number;
  torsoLengthMm: number;
  armLengthMm: number;
  inseamMm: number;
  bicepMm?: number;
  wristMm?: number;
  thighMm?: number;
  calfMm?: number;
}

export type BodyType = "feminine" | "masculine";
export type PreviewRegion = "torso" | "waist" | "hip" | "arm" | "leg";
export type PreviewSurface = "front" | "back" | "side";
export type PreviewBodySide = "center" | "left" | "right";

export interface PatternPreviewPlacement {
  id: string;
  pieceId: string;
  region: PreviewRegion;
  surface: PreviewSurface;
  bodySide: PreviewBodySide;
  rotationDeg: number;
  offsetXMm: number;
  offsetYMm: number;
  offsetZMm: number;
  scale: number;
  mirrorX?: boolean;
}

export interface EdgeRange {
  pieceId: string;
  edgeId: string;
  // normalized param along the edge, 0 <= startT <= endT <= 1
  startT: number;
  endT: number;
}

export type SeamDirection = "same" | "opposite";
export type SeamTreatment = "standard" | "ease" | "gather" | "stretch" | "intentional-mismatch";

export interface Seam {
  id: string;
  first: EdgeRange;
  second: EdgeRange;
  // direction: whether second is stitched in parametric same/opposite direction
  direction: SeamDirection;
  easeRatio: number; // placeholder for future easing
  type: string; // e.g. 'standard'
  name?: string;
  treatment?: SeamTreatment;
}

export type SegmentRole =
  | "shoulder" | "neckline" | "frontArmhole" | "backArmhole" | "sideSeam"
  | "waist" | "hem" | "sleeveCapFront" | "sleeveCapBack" | "inseam"
  | "outseam" | "frontCrotch" | "backCrotch" | "dartLeg" | "fold" | "other";

export interface PatternNode extends PatternVector { id: string; }

export interface PatternSegment {
  id: string;
  startNodeId: string;
  endNodeId: string;
  kind: "line" | "cubic";
  control1?: PatternVector;
  control2?: PatternVector;
  role: SegmentRole;
  smoothStart?: boolean;
  smoothEnd?: boolean;
}

export interface PatternContour {
  id: string;
  segmentIds: string[];
  closed: boolean;
}

export type InternalLinePurpose = "cut" | "fold" | "dart-center" | "pocket" | "topstitch" | "reference";

export interface PatternInternalLine {
  id: string;
  pieceId: string;
  points: PatternPoint[];
  curved: boolean;
  purpose: InternalLinePurpose;
}

export interface PatternDart {
  id: string;
  pieceId: string;
  apex: PatternVector;
  legA: PatternVector;
  legB: PatternVector;
  centerLine: { start: PatternVector; end: PatternVector };
  widthMm: number;
  lengthMm: number;
  directionDeg: number;
  closed: boolean;
}

export type AssemblyPieceRole = "front" | "back" | "sleeve" | "waist" | "leg" | "collar" | "custom";
export type AssemblyOutwardSide = "front" | "back";

export interface AssemblyPlacement {
  pieceId: string;
  role: AssemblyPieceRole;
  outwardSide: AssemblyOutwardSide;
  positionMm: [number, number, number];
  rotationDeg: [number, number, number];
  flipped: boolean;
  source: "template" | "inferred" | "manual";
}

export interface GarmentEase {
  bustMm: number;
  waistMm: number;
  hipMm: number;
  sleeveMm: number;
}

export type EdgeFinish = "raw" | "hem" | "binding" | "facing" | "elastic";

export interface Guide {
  id: string;
  orientation: "horizontal" | "vertical";
  positionMm: number;
}

export interface PatternEdge {
  id: string;
  pieceId: string;
  startPointId: string;
  endPointId: string;
  role?: SegmentRole;
}

export interface PatternPiece {
  id: string;
  name: string;
  seamAllowanceMm: number;
  cutQuantity?: number;
  cutOnFold?: boolean;
  fabricId?: string;
  previewPlacements?: PatternPreviewPlacement[];
  edgeFinishes?: Record<string, EdgeFinish>;
  points: PatternPoint[];
  formatVersion?: 2;
  nodes?: PatternNode[];
  segments?: PatternSegment[];
  contours?: PatternContour[];
  internalLines?: PatternInternalLine[];
  darts?: PatternDart[];
  grainline?: { start: PatternVector; end: PatternVector };
  annotations?: Array<{
    id: string;
    label: string;
    xMm: number;
    yMm: number;
  }>;
  // guides remain piece-local
  guides?: Guide[];
}

export interface PieceWorkspaceTransform {
  pieceId: string;
  xMm: number;
  yMm: number;
  rotationDeg: number;
}

export type SeamIssueCode =
  | "piece-not-found"
  | "edge-not-found"
  | "invalid-range"
  | "empty-range"
  | "duplicate-seam"
  | "invalid-self-seam"
  | "length-mismatch";

export interface SeamValidationIssue {
  code: SeamIssueCode;
  message: string;
  seamId: string;
}

export interface PieceWorkspaceState {
  pieceId: string;
  transform: PieceWorkspaceTransform;
  visible: boolean;
  locked: boolean;
}

export interface DraftContour {
  id: string;
  name: string;
  points: PatternPoint[];
  closed: boolean;
}

export interface GarmentDraft {
  id: string;
  templateId: string;
  name: string;
  description: string;
  bodyType: BodyType;
  measurements: BodyMeasurements;
  fabrics: FabricSource[];
  pieces: PatternPiece[];
  // seams now live at the garment level
  seams?: Seam[];
  // workspace transforms for arranging pieces on the prancheta (visual only)
  workspaceTransforms?: PieceWorkspaceTransform[];
  workspaceStates?: PieceWorkspaceState[];
  assemblyPlacements?: AssemblyPlacement[];
  ease?: GarmentEase;
}

export interface PatternSnapshot {
  piece: PatternPiece;
  areaMm2: number;
  perimeterMm: number;
  issues: string[];
}

export interface PatternEngineFacade {
  readonly backend: "wasm" | "typescript";
  snapshot(): PatternSnapshot;
  restorePiece(piece: PatternPiece): PatternSnapshot;
  movePoint(pointId: string, xMm: number, yMm: number): PatternSnapshot;
  moveHandle(
    pointId: string,
    handle: "in" | "out",
    xMm: number,
    yMm: number,
  ): PatternSnapshot;
  setSegmentCurve(pointId: string, enabled: boolean): PatternSnapshot;
  setSeamAllowance(valueMm: number): PatternSnapshot;
  reset(): PatternSnapshot;
}

export function createPatternPieceFromDraft(draft: DraftContour): PatternPiece {
  if (!draft.closed || draft.points.length < 3) {
    throw new TypeError("O contorno precisa estar fechado e ter pelo menos três pontos.");
  }
  return migrateLegacyPieceToSegments({
    id: draft.id,
    name: draft.name,
    seamAllowanceMm: 10,
    points: draft.points.map((point) => structuredClone(point)),
  });
}

export function duplicatePatternPiece(
  piece: PatternPiece,
  options: { mirrored?: boolean; newId?: string; name?: string } = {},
): PatternPiece {
  const clone = structuredClone(piece);
  const newId = options.newId ?? createDocumentId("piece");
  const newName = options.name ?? `${piece.name} – cópia`;
  const points = options.mirrored ? mirrorPatternPoints(clone.points) : clone.points;
  const { previewPlacements: _placements, nodes: _nodes, segments: _segments, contours: _contours, formatVersion: _formatVersion, ...copyable } = clone;

  return migrateLegacyPieceToSegments({
    ...copyable,
    id: newId,
    name: newName,
    points: points.map((point, index) => ({
      ...point,
      id: createDocumentId(`${newId}:point-${index + 1}`),
      handleIn: point.handleIn ? { ...point.handleIn } : undefined,
      handleOut: point.handleOut ? { ...point.handleOut } : undefined,
    })),
  });
}

export function mirrorPatternPoints(points: readonly PatternPoint[]): PatternPoint[] {
  const minX = Math.min(...points.map((point) => point.xMm));
  const maxX = Math.max(...points.map((point) => point.xMm));
  const centerX = (minX + maxX) / 2;
  const mirrored = points.map((point) => ({
    ...point,
    xMm: centerX * 2 - point.xMm,
    handleIn: point.handleIn
      ? {
          xMm: -point.handleIn.xMm,
          yMm: point.handleIn.yMm,
        }
      : undefined,
    handleOut: point.handleOut
      ? {
          xMm: -point.handleOut.xMm,
          yMm: point.handleOut.yMm,
        }
      : undefined,
  }));
  return mirrored.reverse().map((point) => ({
    ...point,
    handleIn: point.handleOut ? { ...point.handleOut } : undefined,
    handleOut: point.handleIn ? { ...point.handleIn } : undefined,
  }));
}

export function createDocumentId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function parsePatternPiece(value: unknown): PatternPiece {
  if (!isRecord(value)) throw new TypeError("O molde precisa ser um objeto.");

  const id = readString(value.id, "O identificador do molde");
  const name = readString(value.name, "O nome do molde");
  const seamAllowanceMm = readFiniteNumber(
    value.seamAllowanceMm,
    "A margem de costura",
  );

  if (seamAllowanceMm < 0) {
    throw new TypeError("A margem de costura não pode ser negativa.");
  }

  if (!Array.isArray(value.points) || value.points.length < 3) {
    throw new TypeError("O contorno precisa ter pelo menos três pontos.");
  }

  const points = value.points.map(parsePatternPoint);
  const cutQuantity =
    value.cutQuantity === undefined
      ? undefined
      : readPositiveInteger(value.cutQuantity, "A quantidade de corte");
  const cutOnFold =
    value.cutOnFold === undefined
      ? undefined
      : readBoolean(value.cutOnFold, "A indicação de corte na dobra");
  const fabricId =
    value.fabricId === undefined
      ? undefined
      : readString(value.fabricId, "O tecido da peça");
  const previewPlacements =
    value.previewPlacements === undefined
      ? undefined
      : parsePreviewPlacements(value.previewPlacements).map((placement) => ({
          ...placement,
          pieceId: placement.pieceId === "legacy-piece" ? id : placement.pieceId,
        }));
  let edgeFinishes: Record<string, EdgeFinish> | undefined;
  if (value.edgeFinishes !== undefined) {
    if (!isRecord(value.edgeFinishes)) throw new TypeError("Os acabamentos de borda são inválidos.");
    edgeFinishes = {};
    for (const [edgeId, finish] of Object.entries(value.edgeFinishes)) {
      edgeFinishes[edgeId] = readEnum(finish, ["raw", "hem", "binding", "facing", "elastic"] as const, `O acabamento ${edgeId}`);
    }
  }

  const grainline = value.grainline === undefined ? undefined : parseGrainline(value.grainline);
  const annotations = value.annotations === undefined ? undefined : parseAnnotations(value.annotations);
  const internalLines = value.internalLines === undefined ? undefined : parseInternalLines(value.internalLines, id);
  const darts = value.darts === undefined ? undefined : parseDarts(value.darts, id);
  const segmentModel = parseSegmentModel(value, id, points);

  // parse optional guides
  let guides: Guide[] | undefined;
  if (value.guides !== undefined) {
    if (!Array.isArray(value.guides)) throw new TypeError("A lista de guias é inválida.");
    guides = value.guides.map((g, index) => {
      if (!isRecord(g)) throw new TypeError(`A guia ${index + 1} é inválida.`);
      const gid = readString(g.id ?? `guide-${index + 1}`, `O identificador da guia ${index + 1}`);
      const orientation = readEnum(g.orientation, ["horizontal", "vertical"] as const, `A orientação da guia ${index + 1}`);
      const positionMm = readFiniteNumber(g.positionMm, `A posição da guia ${index + 1}`);
      return { id: gid, orientation, positionMm } as Guide;
    });
  }

  return syncLegacyPointsFromSegments(migrateLegacyPieceToSegments({
    id,
    name,
    seamAllowanceMm,
    ...(cutQuantity === undefined ? {} : { cutQuantity }),
    ...(cutOnFold === undefined ? {} : { cutOnFold }),
    ...(fabricId === undefined ? {} : { fabricId }),
    ...(previewPlacements === undefined ? {} : { previewPlacements }),
    ...(edgeFinishes === undefined ? {} : { edgeFinishes }),
    points,
    ...(internalLines === undefined ? {} : { internalLines }),
    ...(darts === undefined ? {} : { darts }),
    ...(grainline === undefined ? {} : { grainline }),
    ...(annotations === undefined ? {} : { annotations }),
    ...(guides === undefined ? {} : { guides }),
    ...segmentModel,
  }));
}

function parseSegmentModel(value: Record<string, unknown>, pieceId: string, points: PatternPoint[]): Partial<PatternPiece> {
  if (value.formatVersion !== 2 || !Array.isArray(value.nodes) || !Array.isArray(value.segments) || !Array.isArray(value.contours)) return {};
  const nodes = value.nodes.map((node, index): PatternNode => {
    if (!isRecord(node)) throw new TypeError(`O nó ${index + 1} é inválido.`);
    return { id: readString(node.id, "O identificador do nó"), xMm: readFiniteNumber(node.xMm, "O X do nó"), yMm: readFiniteNumber(node.yMm, "O Y do nó") };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const roles = ["shoulder", "neckline", "frontArmhole", "backArmhole", "sideSeam", "waist", "hem", "sleeveCapFront", "sleeveCapBack", "inseam", "outseam", "frontCrotch", "backCrotch", "dartLeg", "fold", "other"] as const;
  const segments = value.segments.map((segment, index): PatternSegment => {
    if (!isRecord(segment)) throw new TypeError(`O segmento ${index + 1} é inválido.`);
    const startNodeId = readString(segment.startNodeId, "O início do segmento"); const endNodeId = readString(segment.endNodeId, "O fim do segmento");
    if (!nodeIds.has(startNodeId) || !nodeIds.has(endNodeId)) throw new TypeError("O segmento aponta para um nó inexistente.");
    const kind = readEnum(segment.kind, ["line", "cubic"] as const, "O tipo do segmento");
    return { id: readString(segment.id, "O identificador do segmento"), startNodeId, endNodeId, kind, role: readEnum(segment.role ?? "other", roles, "A função do segmento"), ...(kind === "cubic" ? { control1: parseVector(segment.control1, "O primeiro controle"), control2: parseVector(segment.control2, "O segundo controle") } : {}), ...(segment.smoothStart === true ? { smoothStart: true } : {}), ...(segment.smoothEnd === true ? { smoothEnd: true } : {}) };
  });
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const contours = value.contours.map((contour, index): PatternContour => {
    if (!isRecord(contour) || !Array.isArray(contour.segmentIds)) throw new TypeError(`O contorno ${index + 1} é inválido.`);
    const ids = contour.segmentIds.map((id) => readString(id, "O segmento do contorno"));
    if (ids.some((id) => !segmentIds.has(id))) throw new TypeError("O contorno aponta para um segmento inexistente.");
    return { id: readString(contour.id ?? `${pieceId}:contour`, "O identificador do contorno"), segmentIds: ids, closed: readBoolean(contour.closed, "O fechamento do contorno") };
  });
  const pointIds = new Set(points.map((point) => point.id));
  if (nodes.some((node) => !pointIds.has(node.id))) throw new TypeError("Os nós e pontos legados precisam representar o mesmo contorno.");
  return { formatVersion: 2, nodes, segments, contours };
}

function parseGrainline(value: unknown): NonNullable<PatternPiece["grainline"]> {
  if (!isRecord(value) || !isRecord(value.start) || !isRecord(value.end)) throw new TypeError("O fio da peça é inválido.");
  return {
    start: { xMm: readFiniteNumber(value.start.xMm, "O X inicial do fio"), yMm: readFiniteNumber(value.start.yMm, "O Y inicial do fio") },
    end: { xMm: readFiniteNumber(value.end.xMm, "O X final do fio"), yMm: readFiniteNumber(value.end.yMm, "O Y final do fio") },
  };
}

function parseAnnotations(value: unknown): NonNullable<PatternPiece["annotations"]> {
  if (!Array.isArray(value)) throw new TypeError("As anotações da peça são inválidas.");
  return value.map((annotation, index) => {
    if (!isRecord(annotation)) throw new TypeError(`A anotação ${index + 1} é inválida.`);
    return { id: readString(annotation.id, "O id da anotação"), label: readString(annotation.label, "O texto da anotação"), xMm: readFiniteNumber(annotation.xMm, "O X da anotação"), yMm: readFiniteNumber(annotation.yMm, "O Y da anotação") };
  });
}

// new: parse an EdgeRange in the new format
function parseEdgeRangeNew(value: unknown, label: string) {
  if (!isRecord(value)) throw new TypeError(`${label} precisa ser um objeto.`);
  const pieceId = readString(value.pieceId, `${label}: pieceId`);
  const edgeId = readString(value.edgeId, `${label}: edgeId`);
  const startT = readFiniteNumber(value.startT, `${label}: startT`);
  const endT = readFiniteNumber(value.endT, `${label}: endT`);
  if (!(startT >= 0 && startT <= 1 && endT >= 0 && endT <= 1 && startT <= endT)) {
    throw new TypeError(`${label}: startT/endT precisam satisfazer 0 <= startT <= endT <= 1`);
  }
  return { pieceId, edgeId, startT, endT };
}

export function parseBodyMeasurements(value: unknown): BodyMeasurements {
  if (!isRecord(value)) {
    throw new TypeError("As medidas corporais precisam ser um objeto.");
  }

  const heightMm = readFiniteNumber(value.heightMm, "A altura");
  const bustMm = readFiniteNumber(value.bustMm, "A medida de busto ou tórax");
  const waistMm = readFiniteNumber(value.waistMm, "A medida de cintura");
  const hipMm = readFiniteNumber(value.hipMm, "A medida de quadril");
  const measurements = {
    heightMm,
    bustMm,
    waistMm,
    hipMm,
    shoulderWidthMm: readOptionalPositiveNumber(
      value.shoulderWidthMm,
      heightMm * 0.238,
      "A largura de ombros",
    ),
    torsoLengthMm: readOptionalPositiveNumber(
      value.torsoLengthMm,
      heightMm * 0.262,
      "O comprimento do tronco",
    ),
    armLengthMm: readOptionalPositiveNumber(
      value.armLengthMm,
      heightMm * 0.35,
      "O comprimento do braço",
    ),
    inseamMm: readOptionalPositiveNumber(
      value.inseamMm,
      heightMm * 0.465,
      "A medida de entreperna",
    ),
    ...(value.bicepMm === undefined ? {} : { bicepMm: readOptionalPositiveNumber(value.bicepMm, bustMm * 0.33, "A medida de bíceps") }),
    ...(value.wristMm === undefined ? {} : { wristMm: readOptionalPositiveNumber(value.wristMm, bustMm * 0.18, "A medida de punho") }),
    ...(value.thighMm === undefined ? {} : { thighMm: readOptionalPositiveNumber(value.thighMm, hipMm * 0.58, "A medida de coxa") }),
    ...(value.calfMm === undefined ? {} : { calfMm: readOptionalPositiveNumber(value.calfMm, hipMm * 0.38, "A medida de panturrilha") }),
  };
  if (Object.values(measurements).some((measurement) => measurement <= 0)) {
    throw new TypeError("As medidas corporais precisam ser maiores que zero.");
  }
  return measurements;
}

export function parseGarmentDraft(value: unknown): GarmentDraft {
  if (!isRecord(value)) {
    throw new TypeError("O projeto de roupa precisa ser um objeto.");
  }
  if (!Array.isArray(value.pieces) || value.pieces.length === 0) {
    throw new TypeError("O projeto precisa ter pelo menos uma peça.");
  }

  // keep raw pieces for legacy migration (some older documents may include seams per-piece)
  const rawPieces: unknown[] = value.pieces as unknown[];
  const pieces = rawPieces.map(parsePatternPiece);
  const pieceIds = new Set(pieces.map((piece) => piece.id));
  if (pieceIds.size !== pieces.length) {
    throw new TypeError("As peças do projeto precisam ter identificadores únicos.");
  }

  const fabrics = parseFabricSources(value.fabrics);
  const fallbackFabricId = fabrics[0]?.id ?? createDefaultFabricSource().id;
  const fabricIds = new Set(fabrics.map((fabric) => fabric.id));
  const normalizedPieces = pieces.map((piece) => ({
    ...piece,
    fabricId:
      piece.fabricId && fabricIds.has(piece.fabricId)
        ? piece.fabricId
        : fallbackFabricId,
  }));

  // Parse seams at root (new format) if present
  const seams: Seam[] = [];
  const seamIds = new Set<string>();
  if (value.seams !== undefined) {
    if (!Array.isArray(value.seams)) throw new TypeError("A lista de costuras é inválida.");
    for (let i = 0; i < value.seams.length; i += 1) {
      const s = value.seams[i];
      if (!isRecord(s)) throw new TypeError(`A costura ${i + 1} é inválida.`);
      const id = readString(s.id ?? `seam-${i + 1}`, `O identificador da costura ${i + 1}`);
      const first = parseEdgeRangeNew(s.first, `A primeira faixa da costura ${i + 1}`);
      const second = parseEdgeRangeNew(s.second, `A segunda faixa da costura ${i + 1}`);
      const direction = s.direction === undefined ? "same" : readEnum(s.direction, ["same", "opposite"] as const, `A direção da costura ${i + 1}`);
      const easeRatio = s.easeRatio === undefined ? 0 : readFiniteNumber(s.easeRatio, `O easeRatio da costura ${i + 1}`);
      const type = s.type === undefined ? "standard" : readString(s.type, `O tipo da costura ${i + 1}`);
      const name = s.name === undefined ? `Costura ${i + 1}` : readString(s.name, `O nome da costura ${i + 1}`);
      const treatment = s.treatment === undefined
        ? (type === "standard" ? "standard" : "intentional-mismatch")
        : readEnum(s.treatment, ["standard", "ease", "gather", "stretch", "intentional-mismatch"] as const, `O tratamento da costura ${i + 1}`);
      if (!seamIds.has(id)) {
        seams.push({ id, first, second, direction, easeRatio, type, name, treatment });
        seamIds.add(id);
      }
    }
  }

  // Parse workspace transforms if present (compatibility); otherwise we'll generate defaults later
  let workspaceTransforms: PieceWorkspaceTransform[] | undefined;
  if (value.workspaceTransforms !== undefined) {
    if (!Array.isArray(value.workspaceTransforms)) throw new TypeError("workspaceTransforms inválido.");
    workspaceTransforms = value.workspaceTransforms.map((t, idx) => {
      if (!isRecord(t)) throw new TypeError(`workspaceTransforms[${idx}] inválido.`);
      const pieceId = readString(t.pieceId, `workspaceTransforms[${idx}].pieceId`);
      const xMm = readFiniteNumber(t.xMm, `workspaceTransforms[${idx}].xMm`);
      const yMm = readFiniteNumber(t.yMm, `workspaceTransforms[${idx}].yMm`);
      const rotationDeg = readFiniteNumber(t.rotationDeg, `workspaceTransforms[${idx}].rotationDeg`);
      return { pieceId, xMm, yMm, rotationDeg } as PieceWorkspaceTransform;
    });
  }

  let workspaceStates: PieceWorkspaceState[] | undefined;
  if (value.workspaceStates !== undefined) {
    if (!Array.isArray(value.workspaceStates)) {
      throw new TypeError("workspaceStates inválido.");
    }
    workspaceStates = value.workspaceStates.map((candidate, index) => {
      if (!isRecord(candidate) || !isRecord(candidate.transform)) {
        throw new TypeError(`workspaceStates[${index}] inválido.`);
      }
      const pieceId = readString(candidate.pieceId, `workspaceStates[${index}].pieceId`);
      return {
        pieceId,
        transform: {
          pieceId,
          xMm: readFiniteNumber(candidate.transform.xMm, `workspaceStates[${index}].transform.xMm`),
          yMm: readFiniteNumber(candidate.transform.yMm, `workspaceStates[${index}].transform.yMm`),
          rotationDeg: readFiniteNumber(candidate.transform.rotationDeg, `workspaceStates[${index}].transform.rotationDeg`),
        },
        visible:
          candidate.visible === undefined
            ? true
            : readBoolean(candidate.visible, `workspaceStates[${index}].visible`),
        locked:
          candidate.locked === undefined
            ? false
            : readBoolean(candidate.locked, `workspaceStates[${index}].locked`),
      };
    });
  }

  // Migrate legacy per-piece seams if present in rawPieces
  for (let pIdx = 0; pIdx < rawPieces.length; pIdx += 1) {
    const raw = rawPieces[pIdx] as Record<string, unknown>;
    const piece = normalizedPieces[pIdx];
    if (!isRecord(raw)) continue;
    if (!raw.seams) continue;
    if (!Array.isArray(raw.seams)) continue;
    for (let si = 0; si < raw.seams.length; si += 1) {
      const legacy = raw.seams[si];
      if (!isRecord(legacy)) continue;
      const id = typeof legacy.id === "string" && legacy.id.length > 0 ? legacy.id : `${piece.id}:seam-${si + 1}`;
      if (seamIds.has(id)) continue; // avoid dup

      // legacy ranges have startPointId, t0, t1 (local to piece)
      const parseLegacyRange = (rng: unknown) => {
        if (!isRecord(rng)) throw new TypeError("Faixa de costura legado inválida.");
        const startPointId = readString(rng.startPointId, "startPointId");
        const t0 = readFiniteNumber(rng.t0, "t0");
        const t1 = readFiniteNumber(rng.t1, "t1");
        if (!(t0 >= 0 && t0 <= 1 && t1 >= 0 && t1 <= 1 && t0 <= t1)) {
          throw new TypeError("t0/t1 inválidos no legado");
        }
        // derive edgeId from piece: segment startPointId -> next point
        const points = piece.points;
        const startIndex = points.findIndex((pt) => pt.id === startPointId);
        if (startIndex < 0) throw new TypeError("startPointId não encontrado ao migrar costura");
        const endPointId = points[(startIndex + 1) % points.length].id;
        const edgeId = makeEdgeId(piece.id, startPointId, endPointId);
        return { pieceId: piece.id, edgeId, startT: t0, endT: t1 };
      };

      try {
        const first = parseLegacyRange(legacy.first);
        const second = parseLegacyRange(legacy.second);
        const direction = legacy.direction === "reverse" ? "opposite" : "same";
        seams.push({ id, first, second, direction, easeRatio: 0, type: "standard" });
        seamIds.add(id);
      } catch (e) {
        // skip invalid legacy seam but keep project loadable
        // collect nothing here; validation will report issues later
      }
    }
  }

  const transforms = workspaceTransforms ?? [];

  const assemblyPlacements = parseAssemblyPlacements(value.assemblyPlacements, pieceIds);
  const ease = parseGarmentEase(value.ease);

  return {
    id: readString(value.id, "O identificador do projeto"),
    templateId: readString(value.templateId, "O identificador do molde-base"),
    name: readString(value.name, "O nome do projeto"),
    description: readString(value.description, "A descrição do projeto"),
    bodyType:
      value.bodyType === undefined
        ? "feminine"
        : readEnum(
            value.bodyType,
            ["feminine", "masculine"] as const,
            "O tipo de corpo",
          ),
    measurements: parseBodyMeasurements(value.measurements),
    fabrics,
    pieces: normalizedPieces,
    ...(seams.length === 0 ? {} : { seams }),
    ...(transforms.length === 0 ? {} : { workspaceTransforms: transforms }),
    ...(workspaceStates === undefined ? {} : { workspaceStates }),
    ...(assemblyPlacements === undefined ? {} : { assemblyPlacements }),
    ...(ease === undefined ? {} : { ease }),
  };
}

function parseVector(value: unknown, label: string): PatternVector {
  if (!isRecord(value)) throw new TypeError(`${label} é inválido.`);
  return { xMm: readFiniteNumber(value.xMm, `${label}: X`), yMm: readFiniteNumber(value.yMm, `${label}: Y`) };
}

function parseInternalLines(value: unknown, pieceId: string): PatternInternalLine[] {
  if (!Array.isArray(value)) throw new TypeError("As linhas internas são inválidas.");
  return value.map((line, index) => {
    if (!isRecord(line) || !Array.isArray(line.points) || line.points.length < 2) throw new TypeError(`A linha interna ${index + 1} é inválida.`);
    return {
      id: readString(line.id, `O id da linha interna ${index + 1}`),
      pieceId,
      points: line.points.map(parsePatternPoint),
      curved: line.curved === undefined ? false : readBoolean(line.curved, "A curva da linha interna"),
      purpose: readEnum(line.purpose, ["cut", "fold", "dart-center", "pocket", "topstitch", "reference"] as const, "A finalidade da linha interna"),
    };
  });
}

function parseDarts(value: unknown, pieceId: string): PatternDart[] {
  if (!Array.isArray(value)) throw new TypeError("As pences são inválidas.");
  return value.map((dart, index) => {
    if (!isRecord(dart) || !isRecord(dart.centerLine)) throw new TypeError(`A pence ${index + 1} é inválida.`);
    return {
      id: readString(dart.id, `O id da pence ${index + 1}`), pieceId,
      apex: parseVector(dart.apex, "O ápice da pence"),
      legA: parseVector(dart.legA, "A primeira perna da pence"),
      legB: parseVector(dart.legB, "A segunda perna da pence"),
      centerLine: { start: parseVector(dart.centerLine.start, "O início do centro da pence"), end: parseVector(dart.centerLine.end, "O fim do centro da pence") },
      widthMm: readFiniteNumber(dart.widthMm, "A largura da pence"),
      lengthMm: readFiniteNumber(dart.lengthMm, "O comprimento da pence"),
      directionDeg: readFiniteNumber(dart.directionDeg, "A direção da pence"),
      closed: readBoolean(dart.closed, "O estado da pence"),
    };
  });
}

function parseAssemblyPlacements(value: unknown, pieceIds: Set<string>): AssemblyPlacement[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("As posições de montagem são inválidas.");
  return value.map((candidate, index) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.positionMm) || !Array.isArray(candidate.rotationDeg)) {
      throw new TypeError(`A posição de montagem ${index + 1} é inválida.`);
    }
    const pieceId = readString(candidate.pieceId, `A peça da posição ${index + 1}`);
    if (!pieceIds.has(pieceId)) throw new TypeError(`A posição ${index + 1} referencia uma peça inexistente.`);
    const tuple = (raw: unknown[], label: string): [number, number, number] => {
      if (raw.length !== 3) throw new TypeError(`${label} precisa ter três valores.`);
      return raw.map((item, tupleIndex) => readFiniteNumber(item, `${label}[${tupleIndex}]`)) as [number, number, number];
    };
    return {
      pieceId,
      role: readEnum(candidate.role, ["front", "back", "sleeve", "waist", "leg", "collar", "custom"] as const, `O papel da posição ${index + 1}`),
      outwardSide: readEnum(candidate.outwardSide, ["front", "back"] as const, `O lado externo da posição ${index + 1}`),
      positionMm: tuple(candidate.positionMm, `A posição ${index + 1}`),
      rotationDeg: tuple(candidate.rotationDeg, `A rotação ${index + 1}`),
      flipped: readBoolean(candidate.flipped, `O espelhamento da posição ${index + 1}`),
      source: readEnum(candidate.source, ["template", "inferred", "manual"] as const, `A origem da posição ${index + 1}`),
    };
  });
}

function parseGarmentEase(value: unknown): GarmentEase | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError("As folgas da roupa são inválidas.");
  return {
    bustMm: readFiniteNumber(value.bustMm, "A folga de busto"),
    waistMm: readFiniteNumber(value.waistMm, "A folga de cintura"),
    hipMm: readFiniteNumber(value.hipMm, "A folga de quadril"),
    sleeveMm: readFiniteNumber(value.sleeveMm, "A folga de manga"),
  };
}

// helpers for legacy -> new migration use edge ids
export function makeEdgeId(pieceId: string, startPointId: string, endPointId: string) {
  return `${pieceId}:edge:${startPointId}->${endPointId}`;
}

export function migrateLegacyPieceToSegments(piece: PatternPiece): PatternPiece {
  if (piece.formatVersion === 2 && piece.nodes?.length && piece.segments?.length && piece.contours?.length) return piece;
  const nodes = piece.points.map(({ id, xMm, yMm }) => ({ id, xMm, yMm }));
  const segments = piece.points.map((start, index): PatternSegment => {
    const end = piece.points[(index + 1) % piece.points.length];
    const cubic = Boolean(start.handleOut || end.handleIn);
    return {
      id: makeEdgeId(piece.id, start.id, end.id), startNodeId: start.id, endNodeId: end.id,
      kind: cubic ? "cubic" : "line", role: "other",
      ...(cubic ? {
        control1: { xMm: start.xMm + (start.handleOut?.xMm ?? 0), yMm: start.yMm + (start.handleOut?.yMm ?? 0) },
        control2: { xMm: end.xMm + (end.handleIn?.xMm ?? 0), yMm: end.yMm + (end.handleIn?.yMm ?? 0) },
      } : {}),
    };
  });
  return { ...piece, formatVersion: 2, nodes, segments, contours: [{ id: `${piece.id}:contour`, segmentIds: segments.map((segment) => segment.id), closed: true }] };
}

export function syncLegacyPointsFromSegments(piece: PatternPiece): PatternPiece {
  if (!piece.nodes?.length || !piece.segments?.length) return piece;
  const nodeMap = new Map(piece.nodes.map((node) => [node.id, node]));
  const ordered = piece.contours?.[0]?.segmentIds.map((id) => piece.segments!.find((segment) => segment.id === id)).filter((segment): segment is PatternSegment => Boolean(segment)) ?? piece.segments;
  const points = ordered.map((segment) => {
    const node = nodeMap.get(segment.startNodeId)!;
    const previous = ordered.find((candidate) => candidate.endNodeId === node.id);
    return {
      id: node.id, xMm: node.xMm, yMm: node.yMm,
      ...(previous?.kind === "cubic" && previous.control2 ? { handleIn: { xMm: previous.control2.xMm - node.xMm, yMm: previous.control2.yMm - node.yMm } } : {}),
      ...(segment.kind === "cubic" && segment.control1 ? { handleOut: { xMm: segment.control1.xMm - node.xMm, yMm: segment.control1.yMm - node.yMm } } : {}),
    } satisfies PatternPoint;
  });
  return { ...piece, points };
}

export function getPatternEdges(piece: PatternPiece): PatternEdge[] {
  if (piece.segments?.length) return piece.segments.map((segment) => ({ id: segment.id, pieceId: piece.id, startPointId: segment.startNodeId, endPointId: segment.endNodeId, role: segment.role }));
  const edges: PatternEdge[] = [];
  const pts = piece.points;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    edges.push({ id: makeEdgeId(piece.id, a.id, b.id), pieceId: piece.id, startPointId: a.id, endPointId: b.id });
  }
  return edges;
}

export function getEdgeById(piece: PatternPiece, edgeId: string): PatternEdge | undefined {
  return getPatternEdges(piece).find((e) => e.id === edgeId);
}

import { samplePatternSegment } from "./polygonGeometry";

export function edgeLength(piece: PatternPiece, edgeId: string): number {
  const edge = getEdgeById(piece, edgeId);
  if (!edge) return 0;
  const startIndex = piece.points.findIndex((p) => p.id === edge.startPointId);
  if (startIndex < 0) return 0;
  // sample the segment between startIndex and startIndex+1
  const p0 = piece.points[startIndex];
  const p1 = piece.points[(startIndex + 1) % piece.points.length];
  const samples = samplePatternSegment(p0, p1);
  let len = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    const dx = b.xMm - a.xMm;
    const dy = b.yMm - a.yMm;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export function sampleEdgeRange(piece: PatternPiece, edgeRange: EdgeRange): PatternPoint[] {
  // edgeRange here expected to reference pieceId === piece.id and have edgeId
  const edge = getEdgeById(piece, edgeRange.edgeId);
  if (!edge) return [];
  const startIndex = piece.points.findIndex((p) => p.id === edge.startPointId);
  if (startIndex < 0) return [];
  const p0 = piece.points[startIndex];
  const p1 = piece.points[(startIndex + 1) % piece.points.length];
  const samples = samplePatternSegment(p0, p1);
  const n = samples.length;
  if (edgeRange.startT === 0 && edgeRange.endT === 1) return samples;
  const si = Math.floor(edgeRange.startT * (n - 1));
  const ei = Math.ceil(edgeRange.endT * (n - 1));
  const seg = samples.slice(si, ei + 1);
  // For better endpoints, interpolate at fractional positions
  return seg;
}

export function edgeRangeLength(piece: PatternPiece, edgeRange: EdgeRange): number {
  const pts = sampleEdgeRange(piece, edgeRange);
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.xMm - a.xMm;
    const dy = b.yMm - a.yMm;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export function parsePatternSnapshot(value: unknown): PatternSnapshot {
  if (!isRecord(value)) throw new TypeError("O snapshot precisa ser um objeto.");

  const areaMm2 = readFiniteNumber(value.areaMm2, "A área");
  const perimeterMm = readFiniteNumber(value.perimeterMm, "O perímetro");
  if (areaMm2 < 0 || perimeterMm < 0) {
    throw new TypeError("As métricas do molde não podem ser negativas.");
  }

  if (
    !Array.isArray(value.issues) ||
    !value.issues.every((issue): issue is string => typeof issue === "string")
  ) {
    throw new TypeError("A lista de validação do molde é inválida.");
  }

  return {
    piece: parsePatternPiece(value.piece),
    areaMm2,
    perimeterMm,
    issues: [...value.issues],
  };
}

export function distanceMm(a: PatternPoint, b: PatternPoint): number {
  return Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
}

export function polygonAreaMm2(points: PatternPoint[]): number {
  let twiceArea = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.xMm * next.yMm - next.xMm * current.yMm;
  }

  return Math.abs(twiceArea) / 2;
}

export function polygonPerimeterMm(points: PatternPoint[]): number {
  return points.reduce((total, current, index) => {
    const next = points[(index + 1) % points.length];
    return total + distanceMm(current, next);
  }, 0);
}

function parsePatternPoint(value: unknown, index: number): PatternPoint {
  if (!isRecord(value)) {
    throw new TypeError(`O ponto ${index + 1} precisa ser um objeto.`);
  }

  const point: PatternPoint = {
    id: readString(value.id, `O identificador do ponto ${index + 1}`),
    xMm: readFiniteNumber(value.xMm, `A coordenada X do ponto ${index + 1}`),
    yMm: readFiniteNumber(value.yMm, `A coordenada Y do ponto ${index + 1}`),
  };

  const handleIn = parseOptionalVector(
    value.handleIn,
    `A alça de entrada do ponto ${index + 1}`,
  );
  const handleOut = parseOptionalVector(
    value.handleOut,
    `A alça de saída do ponto ${index + 1}`,
  );
  if (handleIn) point.handleIn = handleIn;
  if (handleOut) point.handleOut = handleOut;
  return point;
}

function parseOptionalVector(
  value: unknown,
  label: string,
): PatternVector | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError(`${label} precisa ser um objeto.`);

  return {
    xMm: readFiniteNumber(value.xMm, `${label}: X`),
    yMm: readFiniteNumber(value.yMm, `${label}: Y`),
  };
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} precisa ser um texto não vazio.`);
  }
  return value;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} precisa ser um número finito.`);
  }
  return value;
}

function readOptionalPositiveNumber(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return Math.round(fallback);
  const parsed = readFiniteNumber(value, label);
  if (parsed <= 0) {
    throw new TypeError(`${label} precisa ser maior que zero.`);
  }
  return parsed;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} precisa ser um inteiro positivo.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} precisa ser verdadeiro ou falso.`);
  }
  return value;
}

function parsePreviewPlacements(value: unknown): PatternPreviewPlacement[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("A peça precisa ter ao menos uma posição de prévia.");
  }
  return value.map((placement, index) => {
    if (!isRecord(placement)) {
      throw new TypeError(`A posição de prévia ${index + 1} é inválida.`);
    }
    const legacyRegion = readEnum(
      placement.region,
      ["torso", "waist", "hip", "arm", "leg", "lower", "sleeve"] as const,
      `A região da posição ${index + 1}`,
    );
    const region: PreviewRegion =
      legacyRegion === "lower"
        ? "hip"
        : legacyRegion === "sleeve"
          ? "arm"
          : legacyRegion;
    const surface = readEnum(
      placement.surface,
      ["front", "back", "side"] as const,
      `A face da posição ${index + 1}`,
    );
    const bodySide = readEnum(
      placement.bodySide,
      ["center", "left", "right"] as const,
      `O lado da posição ${index + 1}`,
    );
    const mirrorX =
      placement.mirrorX === undefined
        ? undefined
        : readBoolean(placement.mirrorX, `O espelhamento da posição ${index + 1}`);
    return {
      id:
        placement.id === undefined
          ? createDocumentId("placement")
          : readString(placement.id, `O identificador da posição ${index + 1}`),
      pieceId:
        placement.pieceId === undefined
          ? "legacy-piece"
          : readString(placement.pieceId, `A peça da posição ${index + 1}`),
      region,
      surface,
      bodySide,
      rotationDeg:
        placement.rotationDeg === undefined
          ? 0
          : readFiniteNumber(placement.rotationDeg, `A rotação da posição ${index + 1}`),
      offsetXMm:
        placement.offsetXMm === undefined
          ? 0
          : readFiniteNumber(placement.offsetXMm, `O deslocamento X da posição ${index + 1}`),
      offsetYMm:
        placement.offsetYMm === undefined
          ? 0
          : readFiniteNumber(placement.offsetYMm, `O deslocamento Y da posição ${index + 1}`),
      offsetZMm:
        placement.offsetZMm === undefined
          ? 25
          : readFiniteNumber(placement.offsetZMm, `O afastamento da posição ${index + 1}`),
      scale:
        placement.scale === undefined
          ? 1
          : readOptionalPositiveNumber(placement.scale, 1, `A escala da posição ${index + 1}`),
      ...(mirrorX === undefined ? {} : { mirrorX }),
    };
  });
}

export function validateSeam(
  seam: Seam,
  garment: Pick<GarmentDraft, "pieces" | "seams">,
): SeamValidationIssue[] {
  const issues: SeamValidationIssue[] = [];
  const ranges = [seam.first, seam.second] as const;
  const resolved: Array<{ piece: PatternPiece; range: EdgeRange } | null> = [];

  for (const range of ranges) {
    const piece = garment.pieces.find((candidate) => candidate.id === range.pieceId);
    if (!piece) {
      issues.push(issue("piece-not-found", seam.id, `A peça ${range.pieceId} não existe.`));
      resolved.push(null);
      continue;
    }
    if (!getEdgeById(piece, range.edgeId)) {
      issues.push(issue("edge-not-found", seam.id, `A borda ${range.edgeId} não existe.`));
      resolved.push(null);
      continue;
    }
    if (
      !Number.isFinite(range.startT) ||
      !Number.isFinite(range.endT) ||
      range.startT < 0 ||
      range.endT > 1 ||
      range.startT > range.endT
    ) {
      issues.push(issue("invalid-range", seam.id, "O intervalo da costura deve estar entre 0 e 1."));
    } else if (range.endT - range.startT <= 1e-6) {
      issues.push(issue("empty-range", seam.id, "O intervalo da costura está vazio."));
    }
    resolved.push({ piece, range });
  }

  if (
    seam.first.pieceId === seam.second.pieceId &&
    seam.first.edgeId === seam.second.edgeId
  ) {
    issues.push(issue("invalid-self-seam", seam.id, "Uma borda não pode ser costurada nela mesma."));
  }

  const duplicate = (garment.seams ?? []).some(
    (candidate) =>
      candidate.id !== seam.id &&
      ((rangesEqual(candidate.first, seam.first) && rangesEqual(candidate.second, seam.second)) ||
        (rangesEqual(candidate.first, seam.second) && rangesEqual(candidate.second, seam.first))),
  );
  if (duplicate) {
    issues.push(issue("duplicate-seam", seam.id, "Esta costura já existe."));
  }

  if (resolved[0] && resolved[1] && !issues.some((candidate) => candidate.code === "invalid-range")) {
    const firstLength = edgeRangeLength(resolved[0].piece, resolved[0].range);
    const secondLength = edgeRangeLength(resolved[1].piece, resolved[1].range);
    const difference = Math.abs(firstLength - secondLength);
    const tolerance = Math.max(10, Math.max(firstLength, secondLength) * 0.15);
    if (difference > tolerance) {
      issues.push(
        issue(
          "length-mismatch",
          seam.id,
          `Diferença excessiva de comprimento: ${difference.toFixed(1)} mm.`,
        ),
      );
    }
  }

  return issues;
}

function issue(code: SeamIssueCode, seamId: string, message: string): SeamValidationIssue {
  return { code, seamId, message };
}

function rangesEqual(left: EdgeRange, right: EdgeRange): boolean {
  return (
    left.pieceId === right.pieceId &&
    left.edgeId === right.edgeId &&
    left.startT === right.startT &&
    left.endT === right.endT
  );
}

export function createPreviewPlacement(
  pieceId: string,
  update: Partial<Omit<PatternPreviewPlacement, "id" | "pieceId">> = {},
): PatternPreviewPlacement {
  return {
    id: createDocumentId("placement"),
    pieceId,
    region: "torso",
    surface: "front",
    bodySide: "center",
    rotationDeg: 0,
    offsetXMm: 0,
    offsetYMm: 0,
    offsetZMm: 25,
    scale: 1,
    ...update,
  };
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} é inválida.`);
  }
  return value as T[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
