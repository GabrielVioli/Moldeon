import {
  type GarmentDraft,
  type PatternSnapshot,
  parsePatternSnapshot,
} from "../domain/pattern";
import {
  garmentDraftToPatternDocumentV3,
  migratePatternProject,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
} from "../domain/patternDocumentV3";
import type {
  PatternDocumentMigrationWarning,
  PatternDocumentV3,
  PatternProjectSourceVersion,
} from "../domain/patternDocumentV3.types";

type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

const AUTOSAVE_FILENAME = "moldeon-autosave.json";
const LEGACY_AUTOSAVE_FILENAME = "moreoris-autosave.json";
const AUTOSAVE_STORAGE_KEY = "moldeon-autosave";
const LEGACY_AUTOSAVE_STORAGE_KEY = "moreoris-autosave";
const MIGRATION_BACKUP_FILENAME = "moldeon-autosave-pre-v3-backup.json";
const MIGRATION_BACKUP_STORAGE_KEY = "moldeon-autosave:pre-v3-backup";

export interface LoadedAutosave {
  document: ParsedAutosave;
  method: "opfs" | "localStorage";
  migrationBackup?: {
    sourceVersion: PatternProjectSourceVersion | 1;
    location: string;
  };
}

export type ParsedAutosave =
  | { kind: "snapshot"; snapshot: PatternSnapshot; sourceVersion: 1 }
  | {
      kind: "garment";
      garment: GarmentDraft;
      activePieceId: string;
      patternDocument: PatternDocumentV3;
      sourceVersion: 2 | 3;
      migrationWarnings: PatternDocumentMigrationWarning[];
    };

export class AutosaveParseError extends Error {
  readonly source: unknown;

  constructor(message: string, source?: unknown) {
    super(message);
    this.name = "AutosaveParseError";
    this.source = source;
  }
}

export async function loadAutosave(): Promise<LoadedAutosave | null> {
  const storage = navigator.storage as StorageManagerWithDirectory | undefined;

  if (storage && typeof storage.getDirectory === "function") {
    try {
      const root = await storage.getDirectory();

      for (const filename of [AUTOSAVE_FILENAME, LEGACY_AUTOSAVE_FILENAME]) {
        try {
          const handle = await root.getFileHandle(filename);
          const file = await handle.getFile();
          const serialized = await file.text();
          const document = parseAutosaveOrThrow(serialized);
          const migrationBackup =
            document.sourceVersion === 3
              ? undefined
              : await ensureOpfsMigrationBackup(
                  root,
                  serialized,
                  document.sourceVersion,
                );
          return {
            document,
            method: "opfs",
            ...(migrationBackup === undefined ? {} : { migrationBackup }),
          };
        } catch (error) {
          if (!isMissingFile(error)) {
            console.info(
              `Não foi possível restaurar ${filename} via OPFS.`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.info("Não foi possível restaurar o autosave via OPFS.", error);
    }
  }

  try {
    for (const key of [AUTOSAVE_STORAGE_KEY, LEGACY_AUTOSAVE_STORAGE_KEY]) {
      const serialized = localStorage.getItem(key);
      if (!serialized) continue;
      try {
        const document = parseAutosaveOrThrow(serialized);
        const migrationBackup =
          document.sourceVersion === 3
            ? undefined
            : ensureLocalStorageMigrationBackup(
                serialized,
                document.sourceVersion,
              );
        return {
          document,
          method: "localStorage",
          ...(migrationBackup === undefined ? {} : { migrationBackup }),
        };
      } catch (error) {
        console.info(`Não foi possível restaurar ${key}.`, error);
      }
    }
    return null;
  } catch (error) {
    console.info(
      "Não foi possível restaurar o autosave via localStorage.",
      error,
    );
    return null;
  }
}

export async function saveAutosave(
  garment: GarmentDraft,
  activePieceId: string,
): Promise<"opfs" | "localStorage"> {
  const document = garmentDraftToPatternDocumentV3(garment, {
    activePatternId: activePieceId,
  });
  const serialized = JSON.stringify({
    version: 3,
    document,
    activePatternId: activePieceId,
    savedAt: new Date().toISOString(),
  });
  const storage = navigator.storage as StorageManagerWithDirectory | undefined;

  if (storage && typeof storage.getDirectory === "function") {
    try {
      const root = await storage.getDirectory();
      const handle = await root.getFileHandle(AUTOSAVE_FILENAME, {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(serialized);
      await writable.close();
      return "opfs";
    } catch (error) {
      console.info("OPFS indisponível; usando localStorage.", error);
    }
  }

  localStorage.setItem(AUTOSAVE_STORAGE_KEY, serialized);
  return "localStorage";
}

export function parseAutosave(serialized: string): ParsedAutosave | null {
  try {
    return parseAutosaveOrThrow(serialized);
  } catch {
    return null;
  }
}

export function parseAutosaveOrThrow(serialized: string): ParsedAutosave {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new AutosaveParseError("O autosave não contém JSON válido.", error);
  }
  if (!isRecord(value) || typeof value.savedAt !== "string") {
    throw new AutosaveParseError(
      "O autosave não possui data e estrutura reconhecíveis.",
      value,
    );
  }

  if (value.version === 1) {
    try {
      return {
        kind: "snapshot",
        snapshot: parsePatternSnapshot(value.snapshot),
        sourceVersion: 1,
      };
    } catch (error) {
      throw new AutosaveParseError(
        "O snapshot legado do autosave é inválido.",
        error,
      );
    }
  }

  if (value.version === 2 && typeof value.activePieceId === "string") {
    const migration = migratePatternProject({
      formatVersion: 2,
      garment: value.garment,
      activePieceId: value.activePieceId,
    });
    const garment = patternDocumentV3ToGarmentDraft(migration.document);
    assertActivePattern(garment, value.activePieceId);
    return {
      kind: "garment",
      garment,
      activePieceId: value.activePieceId,
      patternDocument: migration.document,
      sourceVersion: 2,
      migrationWarnings: migration.warnings,
    };
  }

  if (value.version === 3) {
    const document = parsePatternDocumentV3(value.document);
    const activePieceId =
      value.activePatternId === undefined
        ? document.workspace.activePatternId ?? document.patternDefinitions[0]?.id
        : readString(value.activePatternId, "A peça ativa do autosave V3");
    if (!activePieceId) {
      throw new AutosaveParseError(
        "O autosave V3 não possui uma definição de molde ativa.",
      );
    }
    const garment = patternDocumentV3ToGarmentDraft(document);
    assertActivePattern(garment, activePieceId);
    return {
      kind: "garment",
      garment,
      activePieceId,
      patternDocument: document,
      sourceVersion: 3,
      migrationWarnings: [],
    };
  }

  throw new AutosaveParseError(
    `A versão de autosave ${String(value.version)} não é suportada.`,
    value,
  );
}

async function ensureOpfsMigrationBackup(
  root: FileSystemDirectoryHandle,
  serialized: string,
  sourceVersion: PatternProjectSourceVersion | 1,
): Promise<NonNullable<LoadedAutosave["migrationBackup"]>> {
  try {
    await root.getFileHandle(MIGRATION_BACKUP_FILENAME);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    const handle = await root.getFileHandle(MIGRATION_BACKUP_FILENAME, {
      create: true,
    });
    const writable = await handle.createWritable();
    await writable.write(serialized);
    await writable.close();
  }
  return {
    sourceVersion,
    location: MIGRATION_BACKUP_FILENAME,
  };
}

function ensureLocalStorageMigrationBackup(
  serialized: string,
  sourceVersion: PatternProjectSourceVersion | 1,
): NonNullable<LoadedAutosave["migrationBackup"]> {
  if (localStorage.getItem(MIGRATION_BACKUP_STORAGE_KEY) === null) {
    localStorage.setItem(MIGRATION_BACKUP_STORAGE_KEY, serialized);
  }
  return {
    sourceVersion,
    location: MIGRATION_BACKUP_STORAGE_KEY,
  };
}

function assertActivePattern(
  garment: GarmentDraft,
  activePieceId: string,
): void {
  if (!garment.pieces.some((piece) => piece.id === activePieceId)) {
    throw new AutosaveParseError(
      `A peça ativa ${activePieceId} não existe no documento restaurado.`,
    );
  }
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AutosaveParseError(`${label} precisa ser um texto não vazio.`);
  }
  return value;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
