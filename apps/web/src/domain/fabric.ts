export type FabricPresetId =
  | "viscose"
  | "cotton"
  | "knit"
  | "denim"
  | "leather";

export interface FabricPhysics {
  weightGsm: number;
  thicknessMm: number;
  stretchWarpPercent: number;
  stretchWeftPercent: number;
  bending: number;
  friction: number;
}

export interface FabricSource {
  id: string;
  name: string;
  presetId: FabricPresetId;
  color: string;
  widthMm: number;
  lengthMm: number;
  quantity: number;
  physics: FabricPhysics;
}

export interface FabricPreset {
  id: FabricPresetId;
  name: string;
  description: string;
  color: string;
  physics: FabricPhysics;
}

export const FABRIC_PRESETS: readonly FabricPreset[] = [
  {
    id: "viscose",
    name: "Viscose fluida",
    description: "Leve, macia e com bastante movimento.",
    color: "#8c5368",
    physics: {
      weightGsm: 145,
      thicknessMm: 0.32,
      stretchWarpPercent: 3,
      stretchWeftPercent: 5,
      bending: 0.14,
      friction: 0.34,
    },
  },
  {
    id: "cotton",
    name: "Algodão plano",
    description: "Estrutura média e caimento equilibrado.",
    color: "#c7ad79",
    physics: {
      weightGsm: 165,
      thicknessMm: 0.42,
      stretchWarpPercent: 2,
      stretchWeftPercent: 3,
      bending: 0.46,
      friction: 0.5,
    },
  },
  {
    id: "knit",
    name: "Malha",
    description: "Elástica, confortável e próxima ao corpo.",
    color: "#667f86",
    physics: {
      weightGsm: 190,
      thicknessMm: 0.55,
      stretchWarpPercent: 18,
      stretchWeftPercent: 32,
      bending: 0.25,
      friction: 0.42,
    },
  },
  {
    id: "denim",
    name: "Jeans",
    description: "Pesado, encorpado e com dobras mais firmes.",
    color: "#3f5f78",
    physics: {
      weightGsm: 360,
      thicknessMm: 0.82,
      stretchWarpPercent: 1,
      stretchWeftPercent: 2,
      bending: 0.82,
      friction: 0.68,
    },
  },
  {
    id: "leather",
    name: "Couro sintético",
    description: "Espesso, pouco elástico e bem estruturado.",
    color: "#4b382e",
    physics: {
      weightGsm: 520,
      thicknessMm: 0.95,
      stretchWarpPercent: 1,
      stretchWeftPercent: 2,
      bending: 0.94,
      friction: 0.72,
    },
  },
] as const;

export function createFabricSource(
  presetId: FabricPresetId = "cotton",
  index = 0,
): FabricSource {
  const preset = fabricPreset(presetId);
  const suffix = index > 0 ? ` ${index + 1}` : "";
  return {
    id: `fabric-${presetId}-${createShortId()}`,
    name: `${preset.name}${suffix}`,
    presetId,
    color: preset.color,
    widthMm: 1400,
    lengthMm: 1000,
    quantity: 1,
    physics: { ...preset.physics },
  };
}

export function applyFabricPreset(
  source: FabricSource,
  presetId: FabricPresetId,
): FabricSource {
  const preset = fabricPreset(presetId);
  return {
    ...source,
    name: preset.name,
    presetId,
    color: preset.color,
    physics: { ...preset.physics },
  };
}

export function fabricPreset(presetId: FabricPresetId): FabricPreset {
  const preset = FABRIC_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) throw new RangeError("Tecido desconhecido.");
  return preset;
}

export function parseFabricSources(value: unknown): FabricSource[] {
  if (value === undefined) return [createDefaultFabricSource()];
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("O projeto precisa ter pelo menos um tecido.");
  }

  const sources = value.map(parseFabricSource);
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new TypeError("Os tecidos precisam ter identificadores únicos.");
  }
  return sources;
}

export function createDefaultFabricSource(): FabricSource {
  return {
    id: "fabric-primary",
    name: "Algodão plano",
    presetId: "cotton",
    color: "#c7ad79",
    widthMm: 1400,
    lengthMm: 1000,
    quantity: 1,
    physics: { ...fabricPreset("cotton").physics },
  };
}

export function availableFabricAreaMm2(source: FabricSource): number {
  return source.widthMm * source.lengthMm * source.quantity;
}

export function fabricDrapeFactor(source: FabricSource): number {
  const weightFactor = clamp(source.physics.weightGsm / 420, 0.2, 1.35);
  const flexibility = 1 - clamp(source.physics.bending, 0, 1);
  return clamp(flexibility * 0.78 + weightFactor * 0.22, 0.08, 1);
}

function parseFabricSource(value: unknown, index: number): FabricSource {
  if (!isRecord(value)) {
    throw new TypeError(`O tecido ${index + 1} precisa ser um objeto.`);
  }

  const presetId = readPresetId(value.presetId, index);
  return {
    id: readString(value.id, `O identificador do tecido ${index + 1}`),
    name: readString(value.name, `O nome do tecido ${index + 1}`),
    presetId,
    color: readColor(value.color, index),
    widthMm: readPositiveNumber(value.widthMm, `A largura do tecido ${index + 1}`),
    lengthMm: readPositiveNumber(
      value.lengthMm,
      `O comprimento do tecido ${index + 1}`,
    ),
    quantity: readPositiveInteger(
      value.quantity,
      `A quantidade do tecido ${index + 1}`,
    ),
    physics: parseFabricPhysics(value.physics, index),
  };
}

function parseFabricPhysics(value: unknown, index: number): FabricPhysics {
  if (!isRecord(value)) {
    throw new TypeError(`As propriedades do tecido ${index + 1} são inválidas.`);
  }

  const physics = {
    weightGsm: readPositiveNumber(value.weightGsm, "A gramatura"),
    thicknessMm: readPositiveNumber(value.thicknessMm, "A espessura"),
    stretchWarpPercent: readNonNegativeNumber(
      value.stretchWarpPercent,
      "O alongamento no urdume",
    ),
    stretchWeftPercent: readNonNegativeNumber(
      value.stretchWeftPercent,
      "O alongamento na trama",
    ),
    bending: readNonNegativeNumber(value.bending, "A rigidez"),
    friction: readNonNegativeNumber(value.friction, "O atrito"),
  };
  if (physics.bending > 1 || physics.friction > 1) {
    throw new TypeError("Rigidez e atrito precisam estar entre zero e um.");
  }
  return physics;
}

function readPresetId(value: unknown, index: number): FabricPresetId {
  if (
    typeof value !== "string" ||
    !FABRIC_PRESETS.some((preset) => preset.id === value)
  ) {
    throw new TypeError(`O tipo do tecido ${index + 1} é inválido.`);
  }
  return value as FabricPresetId;
}

function readColor(value: unknown, index: number): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new TypeError(`A cor do tecido ${index + 1} é inválida.`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} precisa ser um texto não vazio.`);
  }
  return value;
}

function readPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} precisa ser um número maior que zero.`);
  }
  return value;
}

function readNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} não pode ser negativo.`);
  }
  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} precisa ser um inteiro positivo.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createShortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
