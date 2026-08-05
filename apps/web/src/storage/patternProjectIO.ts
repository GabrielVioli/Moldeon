import {
  migratePatternProject,
  parsePatternDocumentV3,
  serializePatternDocumentV3,
} from "../domain/patternDocumentV3";
import type {
  PatternDocumentMigrationResult,
  PatternDocumentV3,
} from "../domain/patternDocumentV3.types";

export const MOLDEON_PROJECT_MIME_TYPE =
  "application/vnd.moldeon.pattern-document+json";
export const MOLDEON_PROJECT_EXTENSION = ".moldeon";

export interface ImportedPatternProject {
  document: PatternDocumentV3;
  migration: Omit<PatternDocumentMigrationResult, "document">;
  originalSerialized: string;
}

export function exportPatternProject(document: PatternDocumentV3): string {
  return serializePatternDocumentV3(parsePatternDocumentV3(document));
}

export function importPatternProject(serialized: string): ImportedPatternProject {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new TypeError(
      `O arquivo de projeto não contém JSON válido: ${readableError(error)}`,
    );
  }
  const migration = migratePatternProject(value);
  return {
    document: migration.document,
    migration: {
      sourceVersion: migration.sourceVersion,
      warnings: migration.warnings,
    },
    originalSerialized: serialized,
  };
}

export function createPatternProjectBlob(
  document: PatternDocumentV3,
): Blob {
  return new Blob([exportPatternProject(document)], {
    type: MOLDEON_PROJECT_MIME_TYPE,
  });
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
