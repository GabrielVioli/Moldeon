import { PatternSnapshot, parsePatternSnapshot } from "../domain/pattern";

type StorageManagerWithDirectory = StorageManager & {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
};

const AUTOSAVE_FILENAME = "moldeon-autosave.json";
const LEGACY_AUTOSAVE_FILENAME = "moreoris-autosave.json";
const AUTOSAVE_STORAGE_KEY = "moldeon-autosave";
const LEGACY_AUTOSAVE_STORAGE_KEY = "moreoris-autosave";

export interface LoadedAutosave {
  snapshot: PatternSnapshot;
  method: "opfs" | "localStorage";
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
          const snapshot = parseAutosave(await file.text());
          if (snapshot) return { snapshot, method: "opfs" };
        } catch (error) {
          if (!isMissingFile(error)) throw error;
        }
      }
    } catch (error) {
      console.info("Não foi possível restaurar o autosave via OPFS.", error);
    }
  }

  try {
    for (const key of [AUTOSAVE_STORAGE_KEY, LEGACY_AUTOSAVE_STORAGE_KEY]) {
      const serialized = localStorage.getItem(key);
      const snapshot = serialized ? parseAutosave(serialized) : null;
      if (snapshot) return { snapshot, method: "localStorage" };
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
  snapshot: PatternSnapshot,
): Promise<"opfs" | "localStorage"> {
  const serialized = JSON.stringify({
    version: 1,
    snapshot,
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

export function parseAutosave(serialized: string): PatternSnapshot | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.savedAt !== "string"
    ) {
      return null;
    }
    return parsePatternSnapshot(value.snapshot);
  } catch {
    return null;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
