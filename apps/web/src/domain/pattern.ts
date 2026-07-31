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
}

export type BodyType = "feminine" | "masculine";
export type PreviewRegion = "torso" | "lower" | "leg" | "sleeve";
export type PreviewSurface = "front" | "back";
export type PreviewBodySide = "center" | "left" | "right";

export interface PatternPreviewPlacement {
  region: PreviewRegion;
  surface: PreviewSurface;
  bodySide: PreviewBodySide;
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

export interface Seam {
  id: string;
  first: EdgeRange;
  second: EdgeRange;
  // direction: whether second is stitched in parametric same/opposite direction
  direction: SeamDirection;
  easeRatio: number; // placeholder for future easing
  type: string; // e.g. 'standard'
}

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
}

export interface PatternPiece {
  id: string;
  name: string;
  seamAllowanceMm: number;
  cutQuantity?: number;
  cutOnFold?: boolean;
  fabricId?: string;
  previewPlacements?: PatternPreviewPlacement[];
  points: PatternPoint[];
  // guides remain piece-local
  guides?: Guide[];
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
      : parsePreviewPlacements(value.previewPlacements);

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

  return {
    id,
    name,
    seamAllowanceMm,
    ...(cutQuantity === undefined ? {} : { cutQuantity }),
    ...(cutOnFold === undefined ? {} : { cutOnFold }),
    ...(fabricId === undefined ? {} : { fabricId }),
    ...(previewPlacements === undefined ? {} : { previewPlacements }),
    points,
    ...(guides === undefined ? {} : { guides }),
  };
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
      if (!seamIds.has(id)) {
        seams.push({ id, first, second, direction, easeRatio, type } as any);
        seamIds.add(id);
      }
    }
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
        seams.push({ id, first, second, direction, easeRatio: 0, type: "standard" } as any);
        seamIds.add(id);
      } catch (e) {
        // skip invalid legacy seam but keep project loadable
        // collect nothing here; validation will report issues later
      }
    }
  }

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
  };
}

// helpers for legacy -> new migration use edge ids
export function makeEdgeId(pieceId: string, startPointId: string, endPointId: string) {
  return `${pieceId}:edge:${startPointId}->${endPointId}`;
}

export function getPatternEdges(piece: PatternPiece): PatternEdge[] {
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
    const region = readEnum(
      placement.region,
      ["torso", "lower", "leg", "sleeve"] as const,
      `A região da posição ${index + 1}`,
    );
    const surface = readEnum(
      placement.surface,
      ["front", "back"] as const,
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
      region,
      surface,
      bodySide,
      ...(mirrorX === undefined ? {} : { mirrorX }),
    };
  });
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
