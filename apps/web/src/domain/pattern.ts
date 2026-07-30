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
}

export type PreviewRegion = "torso" | "lower" | "leg" | "sleeve";
export type PreviewSurface = "front" | "back";
export type PreviewBodySide = "center" | "left" | "right";

export interface PatternPreviewPlacement {
  region: PreviewRegion;
  surface: PreviewSurface;
  bodySide: PreviewBodySide;
  mirrorX?: boolean;
}

export interface PatternPiece {
  id: string;
  name: string;
  seamAllowanceMm: number;
  cutQuantity?: number;
  cutOnFold?: boolean;
  previewPlacements?: PatternPreviewPlacement[];
  points: PatternPoint[];
}

export interface GarmentDraft {
  id: string;
  templateId: string;
  name: string;
  description: string;
  measurements: BodyMeasurements;
  pieces: PatternPiece[];
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
  const previewPlacements =
    value.previewPlacements === undefined
      ? undefined
      : parsePreviewPlacements(value.previewPlacements);

  return {
    id,
    name,
    seamAllowanceMm,
    ...(cutQuantity === undefined ? {} : { cutQuantity }),
    ...(cutOnFold === undefined ? {} : { cutOnFold }),
    ...(previewPlacements === undefined ? {} : { previewPlacements }),
    points,
  };
}

export function parseBodyMeasurements(value: unknown): BodyMeasurements {
  if (!isRecord(value)) {
    throw new TypeError("As medidas corporais precisam ser um objeto.");
  }

  const measurements = {
    heightMm: readFiniteNumber(value.heightMm, "A altura"),
    bustMm: readFiniteNumber(value.bustMm, "A medida de busto ou tórax"),
    waistMm: readFiniteNumber(value.waistMm, "A medida de cintura"),
    hipMm: readFiniteNumber(value.hipMm, "A medida de quadril"),
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

  const pieces = value.pieces.map(parsePatternPiece);
  const pieceIds = new Set(pieces.map((piece) => piece.id));
  if (pieceIds.size !== pieces.length) {
    throw new TypeError("As peças do projeto precisam ter identificadores únicos.");
  }

  return {
    id: readString(value.id, "O identificador do projeto"),
    templateId: readString(value.templateId, "O identificador do molde-base"),
    name: readString(value.name, "O nome do projeto"),
    description: readString(value.description, "A descrição do projeto"),
    measurements: parseBodyMeasurements(value.measurements),
    pieces,
  };
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
