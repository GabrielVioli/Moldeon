export interface PatternPoint {
  id: string;
  xMm: number;
  yMm: number;
}

export interface PatternPiece {
  id: string;
  name: string;
  seamAllowanceMm: number;
  points: PatternPoint[];
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
  return { id, name, seamAllowanceMm, points };
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

  return {
    id: readString(value.id, `O identificador do ponto ${index + 1}`),
    xMm: readFiniteNumber(value.xMm, `A coordenada X do ponto ${index + 1}`),
    yMm: readFiniteNumber(value.yMm, `A coordenada Y do ponto ${index + 1}`),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
