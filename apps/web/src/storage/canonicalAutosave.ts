import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import type { PatternDocumentV3 } from "../domain/patternDocumentV3.types";
import { createProjectPayloadChecksum } from "./projectPersistenceCore";

export const CANONICAL_AUTOSAVE_VERSION = 3 as const;

export interface CanonicalAutosaveRecord {
  version: 3;
  document: PatternDocumentV3;
  activePatternId?: string;
  savedAt: string;
  revision: number;
  checksum: string;
}

export interface SerializeCanonicalAutosaveOptions {
  revision: number;
  savedAt?: string;
}

export class CanonicalAutosaveParseError extends Error {
  readonly source: unknown;

  constructor(message: string, source?: unknown) {
    super(message);
    this.name = "CanonicalAutosaveParseError";
    this.source = source;
  }
}

/**
 * Serializes the canonical V3 document directly. No GarmentDraft projection
 * is allowed in this path, so V3-only semantics cannot disappear on autosave.
 */
export function serializeCanonicalAutosave(
  document: PatternDocumentV3,
  options: SerializeCanonicalAutosaveOptions,
): string {
  assertRevision(options.revision);
  const canonical = parsePatternDocumentV3(document);
  const savedAt = options.savedAt ?? new Date().toISOString();
  assertIsoDate(savedAt);
  const activePatternId = canonical.workspace.activePatternId;

  const record: CanonicalAutosaveRecord = {
    version: CANONICAL_AUTOSAVE_VERSION,
    document: canonical,
    ...(activePatternId ? { activePatternId } : {}),
    savedAt,
    revision: options.revision,
    checksum: createProjectPayloadChecksum(canonical),
  };

  return JSON.stringify(record);
}

/**
 * Reads both the new revisioned envelope and the already-existing V3
 * autosave shape. Older V3 envelopes simply start at revision 0 and receive
 * a computed checksum in memory.
 */
export function parseCanonicalAutosave(
  serialized: string,
): CanonicalAutosaveRecord {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new CanonicalAutosaveParseError(
      "O autosave canônico não contém JSON válido.",
      error,
    );
  }

  if (!isRecord(value) || value.version !== CANONICAL_AUTOSAVE_VERSION) {
    throw new CanonicalAutosaveParseError(
      "O autosave não é um documento canônico V3.",
      value,
    );
  }

  let document: PatternDocumentV3;
  try {
    document = parsePatternDocumentV3(value.document);
  } catch (error) {
    throw new CanonicalAutosaveParseError(
      "O PatternDocumentV3 armazenado no autosave é inválido.",
      error,
    );
  }

  const savedAt = readNonEmptyString(value.savedAt, "A data do autosave");
  assertIsoDate(savedAt);
  const revision =
    value.revision === undefined ? 0 : readRevision(value.revision);
  const checksum = createProjectPayloadChecksum(document);

  if (value.checksum !== undefined) {
    const storedChecksum = readNonEmptyString(
      value.checksum,
      "O checksum do autosave",
    );
    if (storedChecksum !== checksum) {
      throw new CanonicalAutosaveParseError(
        "O autosave falhou na verificação de integridade.",
        value,
      );
    }
  }

  const activePatternId = readOptionalString(value.activePatternId);
  if (
    activePatternId &&
    !document.patternDefinitions.some((pattern) => pattern.id === activePatternId)
  ) {
    throw new CanonicalAutosaveParseError(
      `A peça ativa ${activePatternId} não existe no documento salvo.`,
      value,
    );
  }

  return {
    version: CANONICAL_AUTOSAVE_VERSION,
    document,
    ...(activePatternId ? { activePatternId } : {}),
    savedAt,
    revision,
    checksum,
  };
}

function readRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CanonicalAutosaveParseError(
      "A revisão do autosave precisa ser um inteiro não negativo.",
      value,
    );
  }
  return value as number;
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError(
      "A revisão do autosave precisa ser um inteiro não negativo.",
    );
  }
}

function assertIsoDate(value: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new CanonicalAutosaveParseError(
      "A data do autosave é inválida.",
      value,
    );
  }
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CanonicalAutosaveParseError(`${label} é inválido.`, value);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return readNonEmptyString(value, "A peça ativa do autosave");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
